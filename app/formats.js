'use strict';
/* Folhear — abre cada formato e devolve um "livro": { kind, fmt, n, aspect, title, author, toc, draw(i, ctx, w, h) }.
   kind 'fixed' = páginas prontas (PDF, slides, quadrinhos, imagens); kind 'flow' = texto recomposto em páginas. */

const Formats = (() => {
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml' };
  const ACCEPT = '.pdf,.epub,.pptx,.docx,.odt,.fb2,.cbz,.txt,.md,.markdown,.html,.htm,.rtf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.avif';
  const ext = n => (/\.([a-z0-9]+)$/i.exec(n || '') || [, ''])[1].toLowerCase();
  const bare = n => String(n || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  const isImg = n => ext(n) in MIME;
  const all = (el, n) => el ? [...el.getElementsByTagName('*')].filter(c => c.localName === n) : [];
  const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };

  const loadUrl = url => new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth ? im : null); im.onerror = () => res(null); im.src = url; });
  async function loadImg(u8, mime) {
    const url = URL.createObjectURL(new Blob([u8], { type: mime || 'image/jpeg' })), im = await loadUrl(url);
    URL.revokeObjectURL(url);
    return im;
  }

  function decodeText(u8) {
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
    const head = new TextDecoder('latin1').decode(u8.subarray(0, 1024)), m = /(?:encoding|charset)\s*=\s*["']?([\w-]+)/i.exec(head);
    if (m && !/^utf-?8$/i.test(m[1])) { try { return new TextDecoder(m[1]).decode(u8); } catch (e) { } }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('windows-1252').decode(u8); }
  }

  /* ---------- livro de texto recomposto ---------- */
  async function flow(meta, blocks, toc, scale) {
    await Flow.ready();
    const b = { kind: 'flow', aspect: Flow.PW / Flow.PH, ...meta };
    let L;
    b.relayout = s => {
      L = Flow.layout(blocks, { scale: s });
      b.n = L.pages.length;
      b.toc = (toc && toc.length ? toc.map(t => ({ title: t.title, lvl: t.lvl || 1, page: L.anchors[t.key] ?? L.anchors[t.alt] })).filter(t => t.page != null && t.title) : L.heads).slice(0, 400);
    };
    b.relayout(scale || 1);
    b.draw = async (i, ctx, w, h) => Flow.draw(ctx, L.pages[i] || { ops: [] }, w, h, { n: i + 1, title: b.title || '' });
    return b;
  }

  /* ---------- PDF ---------- */
  let pdfLib = null;
  const loadPdf = () => pdfLib || (pdfLib = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'lib/pdf.min.js';
    s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js'; res(); };
    s.onerror = () => { pdfLib = null; rej(new Error('não foi possível carregar o leitor de PDF')); };
    document.head.append(s);
  }));
  async function pdf(u8) {
    await loadPdf();
    let doc;
    try { doc = await pdfjsLib.getDocument({ data: u8.slice(), isEvalSupported: false }).promise; }
    catch (e) { throw new Error(e && e.name === 'PasswordException' ? 'o PDF é protegido por senha' : 'o PDF está corrompido ou não pôde ser lido'); }
    const v = (await doc.getPage(1)).getViewport({ scale: 1 }), info = ((await doc.getMetadata().catch(() => null)) || {}).info || {};
    const toc = [];
    try {
      await (async function add(items, lvl) {
        for (const it of items || []) {
          if (toc.length >= 300) return;
          try {
            const d = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest;
            if (d && d[0] != null) toc.push({ title: String(it.title || '').trim(), lvl, page: typeof d[0] === 'object' ? await doc.getPageIndex(d[0]) : +d[0] });
          } catch (e) { }
          if (lvl < 2) await add(it.items, lvl + 1);
        }
      })(await doc.getOutline(), 1);
    } catch (e) { }
    const t = String(info.Title || '').trim();
    let chain = Promise.resolve();
    return {
      kind: 'fixed', fmt: 'pdf', n: doc.numPages, aspect: v.width / v.height, toc,
      title: !t || /\.(pdf|docx?|pptx?|indd|qxd|rtf)$/i.test(t) || /^(untitled|sem t[ií]tulo|microsoft|document\d*$)/i.test(t) ? '' : t, author: String(info.Author || '').trim(),
      // uma página por vez, na ordem dos pedidos
      draw(i, ctx, w, h) {
        return chain = chain.catch(() => { }).then(async () => {
          const pg = await doc.getPage(i + 1), v1 = pg.getViewport({ scale: 1 }), s = Math.min(w / v1.width, h / v1.height);
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
          await pg.render({ canvasContext: ctx, viewport: pg.getViewport({ scale: s, offsetX: (w - v1.width * s) / 2, offsetY: (h - v1.height * s) / 2 }) }).promise;
        });
      },
      close: () => doc.destroy(),
    };
  }

  /* ---------- imagens e quadrinhos (.cbz) ---------- */
  async function images(items) {
    const cache = new Map();
    const get = async i => {
      if (!cache.has(i)) {
        const it = items[i];
        cache.set(i, await loadImg(it.data || await it.load(), MIME[ext(it.name)]));
        if (cache.size > 6) cache.delete(cache.keys().next().value);
      }
      return cache.get(i);
    };
    const first = await get(0);
    if (!first) throw new Error('a imagem não pôde ser aberta');
    return {
      kind: 'fixed', fmt: items.length > 1 ? 'cbz' : 'img', n: items.length, aspect: clamp(first.naturalWidth / first.naturalHeight, 0.45, 2.2), toc: [],
      async draw(i, ctx, w, h) {
        const im = await get(i);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        if (!im) return;
        const s = Math.min(w / im.naturalWidth, h / im.naturalHeight), dw = im.naturalWidth * s, dh = im.naturalHeight * s;
        ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
      },
    };
  }

  /* ---------- EPUB ---------- */
  async function epub(z, scale) {
    const cont = await z.xml('META-INF/container.xml'), root = cont && all(cont, 'rootfile')[0];
    const opfPath = root ? root.getAttribute('full-path') : z.names.find(n => /\.opf$/i.test(n)), opf = opfPath && await z.xml(opfPath);
    if (!opf) throw new Error('o EPUB está incompleto');
    const man = new Map();
    for (const it of all(opf, 'item')) man.set(it.getAttribute('id'), { href: Zip.resolve(opfPath, dec(it.getAttribute('href') || '')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
    const spine = all(opf, 'itemref').map(r => man.get(r.getAttribute('idref'))).filter(x => x && !/image|css|font/.test(x.type));
    const meta = n => ((all(opf, n)[0] || {}).textContent || '').trim();
    const imgs = new Map();
    const img = base => async src => {
      if (/^data:image/i.test(src)) return loadUrl(src);
      if (/^[a-z]+:/i.test(src)) return null;
      const p = Zip.resolve(base, dec(src));
      if (!imgs.has(p)) { const d = MIME[ext(p)] ? await z.bytes(p) : null; imgs.set(p, d ? await loadImg(d, MIME[ext(p)]) : null); }
      return imgs.get(p);
    };
    const blocks = [];
    for (const s of spine) {
      const txt = await z.text(s.href);
      if (!txt) continue;
      let doc = new DOMParser().parseFromString(txt, 'application/xhtml+xml');
      if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(txt, 'text/html');
      blocks.push({ k: 'break', ids: [s.href] });
      blocks.push(...await Flow.fromHtml(all(doc, 'body')[0] || doc.documentElement, { img: img(s.href), prefix: s.href + '#' }));
    }
    if (!blocks.some(b => b.k !== 'break')) throw new Error('o EPUB não tem texto legível (pode estar protegido por DRM)');

    const toc = [];
    const add = (title, href, base, lvl) => {
      const [p, h] = dec(href || '').split('#'), path = p ? Zip.resolve(base, p) : base;
      toc.push({ title: String(title).replace(/\s+/g, ' ').trim(), lvl, key: h ? path + '#' + h : path, alt: path });
    };
    const nav = [...man.values()].find(m => /\bnav\b/.test(m.props)), ncx = [...man.values()].find(m => /ncx/.test(m.type));
    try {
      if (nav) {
        const d = await z.xml(nav.href), n = d && all(d, 'nav')[0];
        for (const a of all(n, 'a')) { let lvl = 0; for (let e = a; e && e !== n; e = e.parentNode) if (e.localName === 'ol') lvl++; if (lvl <= 2) add(a.textContent, a.getAttribute('href'), nav.href, Math.max(1, lvl)); }
      }
      if (!toc.length && ncx) {
        const d = await z.xml(ncx.href);
        for (const p of all(d, 'navPoint')) { let lvl = 0; for (let e = p; e; e = e.parentNode) if (e.localName === 'navPoint') lvl++; const c = all(p, 'content')[0]; if (lvl <= 2 && c) add((all(p, 'text')[0] || {}).textContent || '', c.getAttribute('src'), ncx.href, lvl); }
      }
    } catch (e) { }

    const cm = all(opf, 'meta').find(m => m.getAttribute('name') === 'cover'), ci = [...man.values()].find(m => /cover-image/.test(m.props)) || (cm && man.get(cm.getAttribute('content')));
    const b = await flow({ fmt: 'epub', title: meta('title'), author: meta('creator') }, blocks, toc, scale);
    if (ci && MIME[ext(ci.href)]) b.coverImg = await img('')(ci.href);
    return b;
  }

  /* ---------- Word (.docx) ---------- */
  async function docx(z, scale) {
    const doc = await z.xml('word/document.xml'), rdoc = await z.xml('word/_rels/document.xml.rels'), sdoc = await z.xml('word/styles.xml'), core = await z.xml('docProps/core.xml');
    const rels = {}, heading = {};
    for (const r of all(rdoc, 'Relationship')) rels[r.getAttribute('Id')] = Zip.resolve('word/document.xml', r.getAttribute('Target') || '');
    const kid = (el, n) => { if (el) for (const c of el.children) if (c.localName === n) return c; return null; };
    const val = el => el ? el.getAttribute('w:val') : null;
    const on = el => !!el && val(el) !== '0' && val(el) !== 'false';
    for (const s of all(sdoc, 'style')) {
      const name = (val(kid(s, 'name')) || '').toLowerCase(), m = /^(?:heading|t[ií]tulo)\s*(\d)/.exec(name);
      if (m) heading[s.getAttribute('w:styleId')] = Math.min(3, +m[1]); else if (name === 'title' || name === 'título') heading[s.getAttribute('w:styleId')] = 1; else if (/^subt[ií]t/.test(name)) heading[s.getAttribute('w:styleId')] = 2;
    }
    const blocks = [];
    async function para(p) {
      const pPr = kid(p, 'pPr'), lvl = heading[val(kid(pPr, 'pStyle')) || ''], jc = val(kid(pPr, 'jc'));
      const b = { k: lvl ? 'h' + lvl : kid(pPr, 'numPr') ? 'li' : 'p', runs: [], depth: 1, al: jc === 'center' ? 'c' : jc === 'right' || jc === 'end' ? 'r' : undefined }, pics = [];
      if (b.k === 'li') b.marker = '•';
      let brk = false;
      async function runs(el) {
        for (const r of el.children) {
          if (r.localName !== 'r') { if (/^(hyperlink|ins|smartTag|sdt|sdtContent|fldSimple)$/.test(r.localName)) await runs(r); continue; }
          const rPr = kid(r, 'rPr'), st = { b: on(kid(rPr, 'b')), i: on(kid(rPr, 'i')), sup: val(kid(rPr, 'vertAlign')) === 'superscript' };
          for (const c of r.children) {
            if (c.localName === 't') b.runs.push({ t: c.textContent, ...st });
            else if (c.localName === 'tab') b.runs.push({ t: '    ', ...st });
            else if (c.localName === 'br') { if (c.getAttribute('w:type') === 'page') brk = true; else b.runs.push({ br: true }); }
            else if (c.localName === 'drawing' || c.localName === 'pict') {
              const bl = all(c, 'blip')[0] || all(c, 'imagedata')[0], t = bl && rels[bl.getAttribute('r:embed') || bl.getAttribute('r:id')];
              const d = t && MIME[ext(t)] ? await z.bytes(t) : null, im = d && await loadImg(d, MIME[ext(t)]);
              if (im) pics.push(im);
            }
          }
        }
      }
      await runs(p);
      if (kid(pPr, 'pageBreakBefore')) blocks.push({ k: 'break' });
      if (b.runs.some(r => r.t && r.t.trim())) blocks.push(b);
      for (const im of pics) blocks.push({ k: 'img', img: im });
      if (brk) blocks.push({ k: 'break' });
    }
    async function body(el) {
      for (const c of el.children) {
        if (c.localName === 'p') await para(c);
        else if (c.localName === 'tbl') {
          for (const tr of all(c, 'tr')) {
            const cells = all(tr, 'tc').map(tc => all(tc, 't').map(t => t.textContent).join(' ').trim());
            if (cells.some(Boolean)) blocks.push({ k: 'row', runs: cells.flatMap((t, i) => i ? [{ t: '    ' }, { t }] : [{ t }]) });
          }
        } else if (c.localName === 'sdt' || c.localName === 'sdtContent') await body(c);
      }
    }
    await body(all(doc, 'body')[0] || doc.documentElement);
    return flow({ fmt: 'docx', title: ((all(core, 'title')[0] || {}).textContent || '').trim(), author: ((all(core, 'creator')[0] || {}).textContent || '').trim() }, blocks, null, scale);
  }

  /* ---------- LibreOffice Writer (.odt) ---------- */
  async function odt(z, scale) {
    const doc = await z.xml('content.xml'), metaDoc = await z.xml('meta.xml'), styles = {};
    for (const s of all(doc, 'style')) { const tp = all(s, 'text-properties')[0]; if (tp) styles[s.getAttribute('style:name')] = { b: tp.getAttribute('fo:font-weight') === 'bold', i: tp.getAttribute('fo:font-style') === 'italic' }; }
    const blocks = [];
    async function inline(el, st, b) {
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { b.runs.push({ t: n.nodeValue, ...st }); continue; }
        if (n.nodeType !== 1) continue;
        if (n.localName === 's') b.runs.push({ t: ' ' });
        else if (n.localName === 'tab') b.runs.push({ t: '    ' });
        else if (n.localName === 'line-break') b.runs.push({ br: true });
        else if (n.localName === 'image') { const h = n.getAttribute('xlink:href') || '', d = MIME[ext(h)] ? await z.bytes(h) : null, im = d && await loadImg(d, MIME[ext(h)]); if (im) (b.pics || (b.pics = [])).push(im); }
        else if (n.localName !== 'note') await inline(n, { ...st, ...(styles[n.getAttribute('text:style-name')] || {}) }, b);
      }
    }
    async function walk(el, li) {
      for (const c of el.children) {
        if (c.localName === 'h' || c.localName === 'p') {
          const b = { k: c.localName === 'h' ? 'h' + clamp(+c.getAttribute('text:outline-level') || 1, 1, 3) : li ? 'li' : 'p', runs: [], depth: 1 };
          if (li && !li.used) { b.marker = '•'; li.used = true; }
          await inline(c, styles[c.getAttribute('text:style-name')] || {}, b);
          if (b.runs.some(r => r.t && r.t.trim())) blocks.push(b);
          for (const im of b.pics || []) blocks.push({ k: 'img', img: im });
        } else if (c.localName === 'list-item') await walk(c, { used: false });
        else if (c.localName === 'table-row') { const cells = all(c, 'table-cell').map(t => t.textContent.trim()); if (cells.some(Boolean)) blocks.push({ k: 'row', runs: cells.flatMap((t, i) => i ? [{ t: '    ' }, { t }] : [{ t }]) }); }
        else await walk(c, li);
      }
    }
    await walk(all(doc, 'text')[0] || doc.documentElement, null);
    return flow({ fmt: 'odt', title: ((all(metaDoc, 'title')[0] || {}).textContent || '').trim(), author: ((all(metaDoc, 'creator')[0] || {}).textContent || '').trim() }, blocks, null, scale);
  }

  /* ---------- FictionBook (.fb2) ---------- */
  async function fb2(text, scale) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('o arquivo FB2 está corrompido');
    const bins = new Map(), blocks = [];
    for (const b of all(doc, 'binary')) bins.set(b.getAttribute('id'), `data:${b.getAttribute('content-type') || 'image/jpeg'};base64,${b.textContent.replace(/\s+/g, '')}`);
    const image = async el => { const id = (el.getAttribute('l:href') || el.getAttribute('xlink:href') || el.getAttribute('href') || '').replace(/^#/, ''); return bins.has(id) ? loadUrl(bins.get(id)) : null; };
    function inline(el, st, b) {
      for (const n of el.childNodes) {
        if (n.nodeType === 3) b.runs.push({ t: n.nodeValue.replace(/\s+/g, ' '), ...st });
        else if (n.nodeType === 1) inline(n, { ...st, b: st.b || n.localName === 'strong', i: st.i || n.localName === 'emphasis', sup: st.sup || n.localName === 'sup', m: st.m || n.localName === 'code' }, b);
      }
    }
    async function walk(el, depth, q) {
      for (const c of el.children) {
        const n = c.localName;
        if (n === 'section') { if (depth === 0) blocks.push({ k: 'break' }); await walk(c, depth + 1, q); }
        else if (n === 'title') { const b = { k: depth <= 1 ? 'h1' : 'h2', runs: [] }; all(c, 'p').forEach((p, i) => { if (i) b.runs.push({ br: true }); inline(p, {}, b); }); if (b.runs.length) blocks.push(b); }
        else if (n === 'p' || n === 'subtitle' || n === 'v' || n === 'text-author') { const b = { k: n === 'subtitle' ? 'h3' : n === 'v' ? 'row' : 'p', runs: [], q, al: n === 'text-author' ? 'r' : undefined }; inline(c, { i: n === 'text-author' }, b); if (b.runs.some(r => r.t.trim())) blocks.push(b); }
        else if (n === 'image') { const im = await image(c); if (im) blocks.push({ k: 'img', img: im }); }
        else if (n === 'epigraph' || n === 'cite' || n === 'poem' || n === 'stanza' || n === 'annotation') await walk(c, depth, n === 'stanza' ? q : 1);
      }
    }
    for (const b of all(doc, 'body')) await walk(b, 0, 0);
    const ti = all(doc, 'title-info')[0], au = ti && all(ti, 'author')[0], cover = ti && all(all(ti, 'coverpage')[0], 'image')[0];
    const book = await flow({ fmt: 'fb2', title: ((all(ti, 'book-title')[0] || {}).textContent || '').trim(), author: au ? [...au.children].filter(c => /name$/.test(c.localName)).map(c => c.textContent.trim()).join(' ') : '' }, blocks, null, scale);
    if (cover) book.coverImg = await image(cover);
    return book;
  }

  /* ---------- texto puro, Markdown, RTF e HTML ---------- */
  function txtBlocks(t, hard) {
    const lines = t.replace(/\r\n?/g, '\n').split('\n'), full = lines.filter(l => l.trim()), lens = full.map(l => l.length).sort((a, b) => a - b);
    // texto com quebra de linha fixa (cada linha com até ~80 letras): junta as linhas até a linha em branco
    const join = !hard && lens.length > 8 && lens[Math.floor(lens.length * 0.95)] <= 100 && lines.length - full.length >= full.length / 40;
    const blocks = [];
    let buf = [];
    const flush = () => { if (buf.length) { blocks.push({ k: 'p', runs: [{ t: buf.join(' ') }] }); buf = []; } };
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) { flush(); continue; }
      if (l.length < 70 && /^(cap[ií]tulo|chapter|parte|part|livro|book|pr[oó]logo|ep[ií]logo|prologue|epilogue|introdu[cç][aã]o|pref[aá]cio)\b/i.test(l)) { flush(); blocks.push({ k: 'h1', runs: [{ t: l }] }); continue; }
      buf.push(l);
      if (!join) flush();
    }
    flush();
    return blocks;
  }
  function mdToHtml(t) {
    const inl = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => `<b>${a || b}</b>`).replace(/\*([^*\n]+)\*/g, '<i>$1</i>').replace(/(^|[^\w])_([^_\n]+)_(?![\w])/g, '$1<i>$2</i>');
    const out = [];
    let para = [], list = null, quote = [], code = null;
    const end = () => {
      if (para.length) { out.push('<p>' + inl(para.join(' ')) + '</p>'); para = []; }
      if (list) { out.push(`</${list}>`); list = null; }
      if (quote.length) { out.push('<blockquote><p>' + inl(quote.join(' ')) + '</p></blockquote>'); quote = []; }
    };
    for (const raw of t.replace(/\r\n?/g, '\n').split('\n')) {
      let m;
      if (code !== null) { if (/^\s*```/.test(raw)) { out.push('<pre>' + esc(code.join('\n')) + '</pre>'); code = null; } else code.push(raw); continue; }
      if (/^\s*```/.test(raw)) { end(); code = []; }
      else if (!raw.trim()) end();
      else if ((m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(raw))) { end(); out.push(`<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`); }
      else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) { end(); out.push('<hr>'); }
      else if ((m = /^\s*>\s?(.*)$/.exec(raw))) { if (para.length || list) end(); quote.push(m[1]); }
      else if ((m = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(raw))) { const tag = m[1] ? 'ol' : 'ul'; if (para.length || quote.length || (list && list !== tag)) end(); if (!list) { out.push(`<${tag}>`); list = tag; } out.push('<li>' + inl(m[2]) + '</li>'); }
      else { if (list || quote.length) end(); para.push(raw.trim()); }
    }
    if (code !== null) out.push('<pre>' + esc(code.join('\n')) + '</pre>');
    end();
    return out.join('\n');
  }
  function rtfText(s) {
    const one = new TextDecoder('windows-1252'), stack = [];
    let out = '', i = 0, ignore = false;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '{') { stack.push(ignore); i++; }
      else if (ch === '}') { ignore = stack.pop() || false; i++; }
      else if (ch === '\\') {
        const m = /^\\([a-z]+)(-?\d+)? ?|^\\'([0-9a-f]{2})|^\\([^a-z])/i.exec(s.slice(i, i + 48));
        if (!m) { i++; continue; }
        i += m[0].length;
        if (m[3]) { if (!ignore) out += one.decode(Uint8Array.of(parseInt(m[3], 16))); }
        else if (m[4]) { if (m[4] === '*') ignore = true; else if (!ignore) out += m[4] === '~' ? ' ' : '\\{}'.includes(m[4]) ? m[4] : ''; }
        else if (/^(fonttbl|colortbl|stylesheet|info|pict|header|footer|footnote|themedata|datastore|generator|listtable|listoverridetable|rsidtbl|xmlnstbl|object|fldinst)$/.test(m[1])) ignore = true;
        else if (!ignore) {
          if (/^(par|line|sect|page)$/.test(m[1])) out += '\n';
          else if (m[1] === 'tab') out += '    ';
          else if (m[1] === 'u' && m[2]) { out += String.fromCharCode((+m[2] + 65536) % 65536); if (s.startsWith("\\'", i)) i += 4; else if (s[i] !== '\\' && s[i] !== '{' && s[i] !== '}') i++; }
        }
      } else { if (!ignore && ch !== '\r' && ch !== '\n') out += ch; i++; }
    }
    return out;
  }
  async function textual(u8, e, scale) {
    const t = decodeText(u8);
    const html = async (src, fmt) => {
      const doc = new DOMParser().parseFromString(src, 'text/html');
      return flow({ fmt, title: fmt === 'html' ? (doc.title || '').trim() : '' }, await Flow.fromHtml(doc.body, { img: s => /^data:image/i.test(s) ? loadUrl(s) : null }), null, scale);
    };
    if (e === 'fb2' || /<FictionBook[\s>]/.test(t.slice(0, 2000))) return fb2(t, scale);
    if (e === 'rtf' || t.startsWith('{\\rtf')) return flow({ fmt: 'rtf' }, txtBlocks(rtfText(t), true), null, scale);
    if (/^x?html?$/.test(e) || /^\s*<(!doctype html|html[\s>])/i.test(t.slice(0, 500))) return html(t, 'html');
    if (e === 'md' || e === 'markdown') return html(mdToHtml(t), 'md');
    if ((t.slice(0, 4000).match(/\0/g) || []).length > 4) throw new Error('este formato não é suportado. Formatos aceitos: PDF, EPUB, PPTX, DOCX, ODT, FB2, CBZ, TXT, Markdown, HTML, RTF e imagens');
    return flow({ fmt: 'txt' }, txtBlocks(t), null, scale);
  }

  /* ---------- entrada única ---------- */
  async function open(name, buf, o = {}) {
    const u8 = new Uint8Array(buf), e = ext(name), head = String.fromCharCode(...u8.subarray(0, 12));
    let b;
    if (head.startsWith('%PDF') || e === 'pdf') b = await pdf(u8);
    else if (u8[0] === 0x50 && u8[1] === 0x4b) {
      const z = Zip.open(u8), mt = (await z.text('mimetype')) || '';
      if (z.has('META-INF/container.xml') || /epub/.test(mt)) b = await epub(z, o.scale);
      else if (z.has('ppt/presentation.xml')) b = await Pptx.open(z);
      else if (z.has('word/document.xml')) b = await docx(z, o.scale);
      else if (z.has('content.xml') && /opendocument\.text/.test(mt)) b = await odt(z, o.scale);
      else if (z.has('content.xml') || z.has('xl/workbook.xml')) throw new Error('planilhas e apresentações do LibreOffice não são suportadas. Exporte em PDF e abra o PDF');
      else {
        const pics = z.names.filter(n => isImg(n) && !/(^|\/)(__MACOSX|\.)/.test(n)).sort((a, c) => a.localeCompare(c, undefined, { numeric: true }));
        if (!pics.length) throw new Error('o arquivo compactado não tem páginas que o Folhear saiba abrir');
        b = await images(pics.map(n => ({ name: n, load: () => z.bytes(n) })));
        b.fmt = 'cbz';
      }
    }
    else if (u8[0] === 0xd0 && u8[1] === 0xcf) throw new Error('é um formato antigo do Office (.doc, .ppt). Abra no Word ou no PowerPoint e salve como PDF, .docx ou .pptx');
    else if (/^(mobi|azw3?|kfx|prc)$/.test(e) || head.slice(0, 4) === 'TPZ0') throw new Error('livros do Kindle (.mobi, .azw) não são suportados. Converta para EPUB');
    else if (e === 'djvu' || e === 'cbr' || e === 'rar') throw new Error(`arquivos .${e} não são suportados. Converta para PDF${e === 'djvu' ? '' : ' ou CBZ'}`);
    else if (isImg(name) || /^(\xff\xd8|\x89PNG|GIF8|BM)/.test(head) || head.slice(8, 12) === 'WEBP') b = await images([{ name: isImg(name) ? name : name + '.jpg', data: u8 }]);
    else b = await textual(u8, e, o.scale);
    b.title = b.title || bare(name);
    b.author = b.author || '';
    return b;
  }

  /* O guia que já vem na estante. */
  const guide = async scale => flow({ fmt: 'guia', title: 'Como folhear', author: 'Guia do Folhear' }, await Flow.fromHtml(new DOMParser().parseFromString(mdToHtml(GUIDE), 'text/html').body), null, scale);

  const GUIDE = `# Como folhear

Este é um livro de verdade, só que feito de luz. Ele tem capa dura, guardas, miolo e lombada, e as folhas se curvam quando você as vira. Tudo o que você abrir no Folhear ganha o mesmo tratamento: um PDF, uma apresentação de slides, um e-book, um documento do Word, uma pasta de fotos.

Vire esta página para começar. Pegue o canto da folha com o mouse ou com o dedo e puxe para o outro lado.

# Virar as páginas

Existem vários jeitos, e todos funcionam o tempo todo.

- **Arrastar a folha.** Segure em qualquer ponto da página e leve para o outro lado. A folha acompanha a sua mão: se você puxar pelo alto, ela dobra pelo canto de cima; se puxar por baixo, pelo canto de baixo. Soltando antes da metade, ela volta.
- **Tocar ou clicar.** Um toque perto da borda direita da tela avança; perto da borda esquerda, volta. Com o livro fechado, um toque na capa abre.
- **Teclado.** As setas, a barra de espaço, *Page Up* e *Page Down* viram uma folha. *Home* fecha o livro na capa e *End* leva ao fim.
- **Roda do mouse.** Cada giro vira uma folha.
- **A régua embaixo.** Arraste para folhear depressa até qualquer ponto do livro.

Com o mouse parado sobre um canto, a folha levanta um pouquinho, como quando a gente passa o polegar para sentir o papel.

## Ver de perto

Dois toques (ou dois cliques) no meio da página aproximam. Com *Ctrl* e a roda do mouse, ou com o gesto de pinça na tela, você escolhe o quanto. Enquanto a página está ampliada, arrastar move a vista em vez de virar a folha; dois toques de novo e ela volta ao tamanho normal.

## No celular

Com o aparelho em pé, o livro mostra uma página por vez, do tamanho da tela. Deitado, ele se abre em duas páginas, como na mesa.

# O que cabe dentro do livro

O Folhear abre os arquivos direto no aparelho, sem enviar nada para lugar nenhum.

- **PDF.** Cada página do arquivo vira uma página do livro, idêntica à original.
- **Slides do PowerPoint (.pptx).** O livro fica deitado, no formato dos slides. Os textos, as imagens, as formas e as tabelas são redesenhados; efeitos e gráficos complexos podem sair simplificados. Se a aparência exata importar, exporte a apresentação em PDF.
- **E-books (.epub e .fb2).** O texto é recomposto em páginas com a tipografia de um livro impresso: linhas justificadas, recuo de parágrafo, abertura de capítulo e número de página.
- **Documentos (.docx, .odt, .rtf, .txt, Markdown e HTML).** Recebem a mesma composição dos e-books.
- **Quadrinhos (.cbz) e imagens.** Cada imagem ocupa uma página. Escolhendo várias imagens de uma vez, elas viram um álbum.

Nos livros de texto, os botões **A−** e **A+** mudam o tamanho da letra, e o livro é repaginado na hora.

## Sumário e marcadores

O botão de lista abre o sumário do livro, quando o arquivo traz um. O botão de marcador guarda a página em que você está; os marcadores aparecem na mesma lista.

# A estante

Cada arquivo aberto vira um volume na estante, com capa de tecido e título dourado. A estante lembra a página em que você parou em cada livro.

Para acrescentar um livro, use **Adicionar livro** ou solte o arquivo em cima da janela.

## Sincronização

No aplicativo para Windows, a estante é gravada numa pasta do Google Drive para computador. Outro computador com o Folhear e a mesma conta do Drive recebe os livros, a página em que você parou e os marcadores.

No navegador e no celular, os livros ficam guardados no próprio aparelho. Em **Ajustes** há um backup da estante: ele leva as posições de leitura e os marcadores, e eles se encaixam sozinhos quando o mesmo arquivo é aberto no outro aparelho.

---

Bom proveito, e boa leitura.
`;

  return { open, guide, images, loadImg, MIME, ACCEPT, ext, bare, isImg };
})();
