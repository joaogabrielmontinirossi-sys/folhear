'use strict';
/* Folhear — composição de texto: transforma HTML em páginas tipografadas como num livro impresso
   (linhas justificadas, recuo de parágrafo, abertura de capítulo, cabeçalho corrente e número de página). */

const Flow = (() => {
  const PW = 600, PH = 900, M = { l: 62, r: 62, t: 84, b: 88 };
  const SERIF = '"Literata", Georgia, "Times New Roman", serif', MONO = 'Consolas, "Courier New", monospace';
  const PAPER = '#f7f2e6', INK = '#27221d', SOFT = '#7b7164';
  const CJK = /[　-鿿가-힯＀-￯]/;

  let fonts = null;
  const ready = () => fonts || (fonts = Promise.all(['400', 'italic 400', '700', 'italic 700'].map(s => document.fonts.load(`${s} 17px Literata`))).catch(e => console.warn('Fonte do livro indisponível; usando a do sistema', e)));

  const mc = document.createElement('canvas').getContext('2d'), wcache = new Map();
  let mfont = '';
  function width(s, f) {
    const k = f + '|' + s;
    let w = wcache.get(k);
    if (w === undefined) {
      if (mfont !== f) mc.font = mfont = f;
      w = mc.measureText(s).width;
      if (wcache.size > 80000) wcache.clear();
      wcache.set(k, w);
    }
    return w;
  }
  const fontOf = (r, size) => `${r.i ? 'italic ' : ''}${r.b ? 700 : 400} ${Math.round(size * 10) / 10}px ${r.m ? MONO : SERIF}`;
  const textOf = b => (b.runs || []).map(r => r.t || ' ').join('').replace(/\s+/g, ' ').trim();

  /* ---------- HTML → blocos ---------- */
  const SKIP = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'iframe', 'object', 'audio', 'video', 'form', 'button', 'input', 'select', 'textarea', 'math']);
  const BLOCKS = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'body', 'html', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'figure', 'figcaption', 'center', 'address', 'details', 'summary']);

  /* o.img(src) devolve uma imagem já carregada (ou null); o.prefix identifica as âncoras de cada capítulo. */
  async function fromHtml(root, o = {}) {
    const out = [];
    let cur = null, ids = [];
    const flush = () => {
      if (!cur) return;
      if (cur.runs.some(r => r.t && r.t.trim())) out.push(cur); else if (cur.ids) ids.push(...cur.ids);
      cur = null;
    };
    const open = c => {
      if (!cur) {
        cur = { k: c.k || 'p', runs: [], q: c.q || 0, al: c.al, depth: c.depth || 0 };
        if (c.li && c.li.marker) { cur.marker = c.li.marker; c.li.marker = null; }
        if (ids.length) { cur.ids = ids; ids = []; }
      }
      return cur;
    };
    async function walk(node, c) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          let t = n.nodeValue;
          if (!c.pre) t = t.replace(/\s+/g, ' ');
          if (!t || (!cur && !t.trim())) continue;
          open(c).runs.push({ t, b: c.b, i: c.i, m: c.m, sup: c.sup });
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.localName.toLowerCase(), css = n.getAttribute('style') || '';
        if (SKIP.has(tag) || /display:\s*none/i.test(css) || n.hasAttribute('hidden')) continue;
        const id = n.getAttribute('id') || (tag === 'a' && n.getAttribute('name'));
        if (id) (cur ? (cur.ids || (cur.ids = [])) : ids).push((o.prefix || '') + id);
        if (tag === 'br') { if (cur) cur.runs.push({ br: true }); continue; }
        if (tag === 'hr') { flush(); out.push({ k: 'hr' }); continue; }
        if (tag === 'img' || tag === 'image') {
          const src = n.getAttribute('src') || n.getAttribute('xlink:href') || n.getAttribute('href');
          const im = src && o.img ? await o.img(src) : null;
          if (im) {
            flush();
            const b = { k: 'img', img: im };
            if (ids.length) { b.ids = ids; ids = []; }
            out.push(b);
          } else if (tag === 'img' && n.getAttribute('alt')) open(c).runs.push({ t: n.getAttribute('alt'), i: true });
          continue;
        }
        const s = { ...c }, blk = BLOCKS.has(tag);
        if (/^h[1-6]$/.test(tag)) s.k = 'h' + Math.min(3, +tag[1]);
        else if (tag === 'b' || tag === 'strong') s.b = true;
        else if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn') s.i = true;
        else if (tag === 'code' || tag === 'kbd' || tag === 'tt' || tag === 'samp') s.m = true;
        else if (tag === 'sup') s.sup = true;
        else if (tag === 'pre') { s.pre = true; s.m = true; s.k = 'pre'; }
        else if (tag === 'blockquote') s.q = (c.q || 0) + 1;
        else if (tag === 'ul' || tag === 'ol') { s.list = { ord: tag === 'ol', n: 0 }; s.depth = (c.depth || 0) + 1; }
        else if (tag === 'li') { const l = c.list || { n: 0 }; l.n++; s.li = { marker: l.ord ? l.n + '.' : '•' }; s.k = 'li'; s.depth = c.depth || 1; }
        else if (tag === 'center') s.al = 'c';
        else if (tag === 'tr') s.k = 'row';
        else if (tag === 'td' || tag === 'th') { if (cur && cur.runs.length) cur.runs.push({ t: '    ' }); if (tag === 'th') s.b = true; }
        else if (tag === 'figcaption') { s.al = 'c'; s.i = true; }
        if (/text-align:\s*center/i.test(css) || n.getAttribute('align') === 'center') s.al = 'c';
        else if (/text-align:\s*right/i.test(css)) s.al = 'r';
        if (/font-style:\s*italic/i.test(css)) s.i = true;
        if (/font-weight:\s*(bold|[6-9]00)/i.test(css)) s.b = true;
        if (/(page-)?break-before:\s*(always|page)/i.test(css)) { flush(); out.push({ k: 'break' }); }
        if (blk) flush();
        await walk(n, s);
        if (blk) flush();
      }
    }
    await walk(root, {});
    flush();
    return out;
  }

  /* ---------- blocos → páginas ---------- */
  function layout(blocks, o = {}) {
    const fs = Math.round(17 * (o.scale || 1) * 10) / 10, lh = Math.round(fs * 1.5);
    const L0 = M.l, R0 = PW - M.r, BOT = PH - M.b;
    const pages = [], anchors = {}, heads = [];
    let ops = [], y = M.t, chapter = '', opening = false, prev = 'start';
    const push = () => { pages.push({ ops, chapter, opening }); ops = []; y = M.t; opening = false; };
    const room = h => { if (y + h > BOT + 0.5 && ops.length) push(); };
    const mark = b => { for (const id of b.ids || []) if (!(id in anchors)) anchors[id] = pages.length; };

    // Quebra os trechos em palavras; "sp" (espaço antes) e "brk" marcam onde a linha pode quebrar.
    function units(b, st) {
      const us = [];
      let space = false, wasCjk = false;
      for (const r of b.runs) {
        if (r.br) { us.push({ br: true }); space = false; continue; }
        const f = fontOf({ b: r.b || st.bold, i: r.i || st.italic, m: r.m }, r.sup ? st.size * 0.7 : r.m ? st.size * 0.88 : st.size);
        for (const p of r.t.split(/(\s+)/)) {
          if (!p) continue;
          if (/^\s+$/.test(p)) { space = true; continue; }
          for (const s of CJK.test(p) ? p.match(/[　-鿿가-힯＀-￯]|[^　-鿿가-힯＀-￯]+/g) : [p]) {
            const cjk = CJK.test(s);
            us.push({ s, f, w: width(s, f), sp: space, brk: cjk || wasCjk, sup: r.sup });
            space = false; wasCjk = cjk;
          }
        }
      }
      return us;
    }
    function lines(us, avail) {
      const out = [];
      let line = [], w = 0, i = 0;
      const end = last => { out.push({ items: line, w, last }); line = []; w = 0; };
      while (i < us.length) {
        const u = us[i];
        if (u.br) { end(true); i++; continue; }
        let j = i + 1, gw = u.w;
        while (j < us.length && !us[j].br && !us[j].sp && !us[j].brk) gw += us[j++].w;
        const max = avail(out.length), lead = line.length && u.sp ? us.spaceW : 0;
        if (line.length && w + lead + gw > max) { end(false); continue; }
        if (!line.length && gw > max) {
          if (u.w > max && u.s.length > 1) { // palavra maior que a linha: corta
            let k = 1;
            while (k < u.s.length - 1 && width(u.s.slice(0, k + 1), u.f) <= max) k++;
            line.push({ ...u, s: u.s.slice(0, k), w: width(u.s.slice(0, k), u.f) });
            us[i] = { ...u, s: u.s.slice(k), w: width(u.s.slice(k), u.f), sp: false, brk: true };
          } else {
            line.push(u); i++;
            if (i < us.length && !us[i].br) us[i] = { ...us[i], brk: true };
          }
          w = line[0].w; end(false);
          continue;
        }
        for (let k = i; k < j; k++) line.push(us[k]);
        w += lead + gw; i = j;
      }
      if (line.length || !out.length) end(true); else out[out.length - 1].last = true;
      return out;
    }
    function place(b, st) {
      const us = units(b, st);
      if (!us.length) return;
      const spaceW = us.spaceW = width(' ', fontOf({ b: st.bold, i: st.italic }, st.size));
      const avail = n => st.R - st.L - (n === 0 ? st.indent : 0);
      lines(us, avail).forEach((ln, n) => {
        room(st.lineH);
        if (n === 0) mark(b);
        const free = avail(n) - ln.w, gaps = ln.items.filter((u, k) => k && u.sp).length;
        let x = st.L + (n === 0 ? st.indent : 0), gap = spaceW;
        if (st.align === 'c') x += free / 2;
        else if (st.align === 'r') x += free;
        else if (st.align === 'j' && !ln.last && gaps && free / gaps < spaceW * 3.5) gap += free / gaps;
        const base = y + st.lineH * 0.5 + st.size * 0.33;
        if (n === 0 && b.marker) ops.push({ s: b.marker, x: st.L - 9 - width(b.marker, fontOf({}, st.size)), y: base, f: fontOf({}, st.size) });
        ln.items.forEach((u, k) => {
          if (k && u.sp) x += gap;
          ops.push({ s: u.s, x, y: u.sup ? base - st.size * 0.34 : base, f: u.f, c: st.color });
          x += u.w;
        });
        y += st.lineH;
      });
    }
    const gap = h => { if (ops.length) y += h; };

    for (const b of blocks) {
      if (b.k === 'break') { if (ops.length) push(); mark(b); prev = 'start'; continue; }
      const q = (b.q || 0) * 22;
      if (prev === 'li' && b.k !== 'li') gap(lh / 2);
      if (b.k === 'h1') {
        if (ops.length) push();
        y = M.t + lh * 4; opening = true;
        chapter = textOf(b);
        heads.push({ title: chapter, page: pages.length, lvl: 1 });
        place(b, { size: fs * 1.55, lineH: Math.round(lh * 1.4), L: L0, R: R0, indent: 0, align: 'c', bold: true });
        y += lh * 2;
      } else if (b.k === 'h2' || b.k === 'h3') {
        room(lh * 4);
        gap(lh);
        if (b.k === 'h2') heads.push({ title: textOf(b), page: pages.length, lvl: 2 });
        if (b.k === 'h2') { place(b, { size: fs * 1.22, lineH: Math.round(lh * 1.5), L: L0, R: R0, indent: 0, align: b.al || 'l', bold: true }); y += Math.round(lh * 0.5); }
        else place(b, { size: fs * 1.04, lineH: lh, L: L0, R: R0, indent: 0, align: b.al || 'l', bold: true, italic: true });
      } else if (b.k === 'img') {
        const maxW = R0 - L0, maxH = BOT - M.t, iw = b.img.naturalWidth || b.img.width || 1, ih = b.img.naturalHeight || b.img.height || 1;
        let k = Math.min(1, maxW / iw, maxH / ih);
        if (iw * k > maxW * 0.55) k = Math.min(maxW / iw, maxH / ih);
        if (y + ih * k > BOT) { if (BOT - y > maxH * 0.5 && (BOT - y) / (ih * k) > 0.6) k *= (BOT - y) / (ih * k); else if (ops.length) push(); }
        mark(b);
        ops.push({ img: b.img, x: L0 + (maxW - iw * k) / 2, y, w: iw * k, h: ih * k });
        y = M.t + Math.ceil((y + ih * k + lh * 0.4 - M.t) / lh) * lh;
      } else if (b.k === 'hr') {
        room(lh * 3);
        ops.push({ s: '*   *   *', x: PW / 2 - width('*   *   *', fontOf({}, fs)) / 2, y: y + lh * 1.5 + fs * 0.33, f: fontOf({}, fs), c: SOFT });
        y += lh * 3;
      } else if (b.k === 'pre') {
        const size = fs * 0.8, f = fontOf({ m: true }, size), plh = Math.round(fs * 1.2), cw = width('m', f), cols = Math.max(20, Math.floor((R0 - L0) / cw));
        gap(lh / 2);
        for (const raw of b.runs.map(r => r.br ? '\n' : r.t).join('').replace(/\t/g, '  ').replace(/\n$/, '').split('\n')) {
          for (let i = 0; i === 0 || i < raw.length; i += cols) {
            room(plh);
            if (i === 0) mark(b);
            ops.push({ s: raw.slice(i, i + cols), x: L0, y: y + plh * 0.5 + size * 0.33, f });
            y += plh;
          }
        }
        y += lh / 2;
      } else if (b.k === 'li') {
        if (prev !== 'li') gap(lh / 2);
        place(b, { size: fs, lineH: lh, L: L0 + 26 * Math.max(1, b.depth) + q, R: R0 - q, indent: 0, align: 'j' });
      } else {
        const indent = b.k === 'p' && prev === 'p' && !b.al && !q ? fs * 1.5 : 0;
        if (q && prev !== 'q') gap(lh / 2);
        place(b, { size: fs, lineH: lh, L: L0 + q, R: R0 - q, indent, align: b.k === 'row' ? 'l' : b.al || 'j' });
        if (q) y += lh / 2;
      }
      prev = b.k === 'li' ? 'li' : b.k === 'p' ? (q ? 'q' : 'p') : 'x';
    }
    if (ops.length || !pages.length) push();
    return { pages, anchors, heads };
  }

  function draw(ctx, page, w, h, meta) {
    ctx.save();
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
    ctx.scale(w / PW, h / PH);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    let f = '';
    for (const op of page.ops) {
      if (op.img) { try { ctx.drawImage(op.img, op.x, op.y, op.w, op.h); } catch (e) { } continue; }
      if (op.f !== f) ctx.font = f = op.f;
      ctx.fillStyle = op.c || INK;
      ctx.fillText(op.s, op.x, op.y);
    }
    // cabeçalho corrente (título do livro nas páginas pares, capítulo nas ímpares) e número da página
    ctx.fillStyle = SOFT; ctx.textAlign = 'center';
    if (!page.opening) { ctx.font = `italic 400 12.5px ${SERIF}`; ctx.fillText(cut(meta.n % 2 ? page.chapter || meta.title : meta.title, 64), PW / 2, 50); }
    ctx.font = `400 13px ${SERIF}`;
    ctx.fillText(String(meta.n), PW / 2, PH - 42);
    ctx.restore();
  }

  return { PW, PH, PAPER, SERIF, ready, fromHtml, layout, draw, textOf };
})();
