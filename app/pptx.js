'use strict';
/* Folhear — desenha slides do PowerPoint (.pptx): fundo, formas, imagens, tabelas e textos com os estilos
   herdados do layout e do slide mestre. É uma aproximação; para fidelidade total, exporte a apresentação em PDF. */

const Pptx = (() => {
  const EMU = 9525, SANS = '"Segoe UI", Calibri, Arial, Helvetica, sans-serif';
  const kids = (el, n) => el ? [...el.children].filter(c => c.localName === n) : [];
  const kid = (el, n) => { if (el) for (const c of el.children) if (c.localName === n) return c; return null; };
  const desc = (el, n) => el ? [...el.getElementsByTagName('*')].filter(c => c.localName === n) : [];
  const num = (el, a, d = 0) => el && el.hasAttribute(a) ? +el.getAttribute(a) : d;
  const rid = el => el ? el.getAttribute('r:embed') || el.getAttribute('r:id') || el.getAttribute('r:link') : null;

  async function rels(z, part) {
    const i = part.lastIndexOf('/'), doc = await z.xml(part.slice(0, i) + '/_rels/' + part.slice(i + 1) + '.rels'), out = {};
    if (doc) for (const r of desc(doc, 'Relationship')) if (r.getAttribute('TargetMode') !== 'External') out[r.getAttribute('Id')] = { target: Zip.resolve(part, r.getAttribute('Target')), type: (r.getAttribute('Type') || '').split('/').pop() };
    return out;
  }

  async function open(z) {
    const pres = await z.xml('ppt/presentation.xml'), prel = await rels(z, 'ppt/presentation.xml');
    const sz = desc(pres, 'sldSz')[0], SW = num(sz, 'cx', 9144000) / EMU, SH = num(sz, 'cy', 6858000) / EMU;
    const slides = desc(pres, 'sldId').map(s => prel[rid(s)]).filter(Boolean).map(r => r.target);
    if (!slides.length) throw new Error('a apresentação não tem slides');
    const parts = new Map(), imgs = new Map();
    const part = p => { if (!parts.has(p)) parts.set(p, (async () => ({ path: p, doc: await z.xml(p), rels: await rels(z, p) }))()); return parts.get(p); };
    const relOf = (p, type) => Object.values(p.rels).find(r => r.type === type);

    async function themeOf(mas) {
      if (mas.theme) return mas.theme;
      const t = relOf(mas, 'theme'), colors = {};
      if (t) for (const c of (desc((await part(t.target)).doc, 'clrScheme')[0] || { children: [] }).children) {
        const v = c.firstElementChild;
        colors[c.localName] = v ? v.getAttribute('val') || v.getAttribute('lastClr') : '000000';
      }
      return mas.theme = colors;
    }

    /* ---------- cores e preenchimentos ---------- */
    function color(el, C) {
      if (!el) return null;
      for (const c of el.children) {
        let hex = null;
        if (c.localName === 'srgbClr') hex = c.getAttribute('val');
        else if (c.localName === 'sysClr') hex = c.getAttribute('lastClr');
        else if (c.localName === 'schemeClr') { const k = c.getAttribute('val'); hex = C.theme[{ bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }[k] || k]; }
        else if (c.localName === 'prstClr') hex = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080' }[c.getAttribute('val')];
        if (!hex) continue;
        let rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)), a = 1;
        for (const m of c.children) {
          const v = num(m, 'val', 100000) / 100000;
          if (m.localName === 'lumMod' || m.localName === 'shade') rgb = rgb.map(x => x * v);
          else if (m.localName === 'lumOff') rgb = rgb.map(x => x + 255 * v);
          else if (m.localName === 'tint') rgb = rgb.map(x => 255 - (255 - x) * v);
          else if (m.localName === 'alpha') a = v;
        }
        return `rgba(${rgb.map(x => clamp(Math.round(x), 0, 255)).join(',')},${a})`;
      }
      return null;
    }
    // Devolve uma cor, um degradê, 'none' (sem preenchimento) ou null (não definido aqui).
    function paint(g, pr, C, w, h) {
      if (!pr) return null;
      if (kid(pr, 'noFill')) return 'none';
      const solid = kid(pr, 'solidFill'), grad = kid(pr, 'gradFill');
      if (solid) return color(solid, C);
      if (grad) {
        const stops = desc(grad, 'gs').map(s => [num(s, 'pos') / 100000, color(s, C)]).filter(s => s[1]);
        if (!stops.length) return null;
        const ang = num(kid(grad, 'lin'), 'ang', 5400000) / 60000 * Math.PI / 180, lg = g.createLinearGradient(w / 2 - Math.cos(ang) * w / 2, h / 2 - Math.sin(ang) * h / 2, w / 2 + Math.cos(ang) * w / 2, h / 2 + Math.sin(ang) * h / 2);
        for (const [p, c] of stops) lg.addColorStop(clamp(p, 0, 1), c);
        return lg;
      }
      return null;
    }

    /* ---------- espaços reservados (título, corpo…) e herança ---------- */
    const phOf = sp => { const ph = desc(sp.firstElementChild, 'ph')[0]; return ph ? { type: ph.getAttribute('type'), idx: ph.getAttribute('idx') } : null; };
    const kind = t => t === 'ctrTitle' || t === 'title' ? 'title' : !t || t === 'subTitle' || t === 'obj' || t === 'body' ? 'body' : t;
    function findPh(p, ph, byIdx) {
      if (!p || !ph) return null;
      const all = [...desc(p.doc, 'sp'), ...desc(p.doc, 'pic')].map(s => [s, phOf(s)]).filter(x => x[1]);
      const hit = (byIdx && ph.idx != null && all.find(x => x[1].idx === ph.idx)) || all.find(x => (x[1].type || '') === (ph.type || '')) || all.find(x => kind(x[1].type) === kind(ph.type));
      return hit ? hit[0] : null;
    }
    function xfrmOf(sp) {
      const x = sp && (kid(kid(sp, 'spPr') || kid(sp, 'grpSpPr'), 'xfrm') || kid(sp, 'xfrm')), off = kid(x, 'off'), ext = kid(x, 'ext');
      if (!off || !ext) return null;
      const co = kid(x, 'chOff'), ce = kid(x, 'chExt');
      return { x: num(off, 'x') / EMU, y: num(off, 'y') / EMU, w: num(ext, 'cx') / EMU, h: num(ext, 'cy') / EMU, rot: num(x, 'rot') / 60000 * Math.PI / 180, flipV: x.getAttribute('flipV') === '1', flipH: x.getAttribute('flipH') === '1',
        cx: co ? num(co, 'x') / EMU : 0, cy: co ? num(co, 'y') / EMU : 0, cw: ce ? num(ce, 'cx') / EMU : 0, ch: ce ? num(ce, 'cy') / EMU : 0 };
    }

    /* ---------- texto ---------- */
    function drawText(g, tx, box, chain, bodies, C, base) {
      const bAttr = (a, d) => { for (const b of bodies) if (b && b.hasAttribute(a)) return b.getAttribute(a); return d; };
      const ins = ['lIns', 'tIns', 'rIns', 'bIns'].map((a, i) => +bAttr(a, i % 2 ? 45720 : 91440) / EMU);
      const W = box.w - ins[0] - ins[2], H = box.h - ins[1] - ins[3], wrap = bAttr('wrap', 'square') !== 'none';
      const fit = kid(bodies[0], 'normAutofit');
      const lvls = l => chain.map(c => kid(c, 'lvl' + (l + 1) + 'pPr')).filter(Boolean);
      const paras = kids(tx, 'p').map(p => {
        const pPr = kid(p, 'pPr'), lvl = num(pPr, 'lvl'), src = [pPr, ...lvls(lvl)].filter(Boolean), defs = src.map(s => s === pPr ? null : kid(s, 'defRPr')).filter(Boolean);
        const pa = (a, d) => { for (const s of src) if (s.hasAttribute(a)) return s.getAttribute(a); return d; };
        const sub = n => { for (const s of src) { const k = kid(s, n); if (k) return k; } return null; };
        const ra = (rPr, a, d) => { for (const s of [rPr, ...defs]) if (s && s.hasAttribute(a)) return s.getAttribute(a); return d; };
        const rc = rPr => { for (const s of [rPr, ...defs]) { const c = s && color(kid(s, 'solidFill'), C); if (c) return c; } return base.color; };
        const mk = (t, rPr) => { const face = (kid(rPr, 'latin') || { getAttribute: () => '' }).getAttribute('typeface') || ''; return { t, size: +ra(rPr, 'sz', base.size) / 100 * 4 / 3, b: ra(rPr, 'b', base.bold ? '1' : '0') === '1', i: ra(rPr, 'i', '0') === '1', color: rc(rPr), face: face && face[0] !== '+' ? `"${face.replace(/"/g, '')}", ` : '' }; };
        const runs = [];
        for (const r of p.children) {
          if (r.localName === 'r' || r.localName === 'fld') runs.push(mk((kid(r, 't') || {}).textContent || '', kid(r, 'rPr')));
          else if (r.localName === 'br') runs.push({ ...mk('', kid(r, 'rPr')), br: true });
        }
        const end = mk('', kid(p, 'endParaRPr'));
        let bullet = null;
        for (const s of src) {
          if (kid(s, 'buNone')) break;
          const bc = kid(s, 'buChar');
          if (bc) { bullet = /wingdings|symbol|webdings/i.test((kid(s, 'buFont') || { getAttribute: () => '' }).getAttribute('typeface') || '') ? '•' : bc.getAttribute('char'); break; }
          if (kid(s, 'buAutoNum')) { bullet = '#'; break; }
        }
        const sp = sub('lnSpc'), pct = sp && kid(sp, 'spcPct'), bef = sub('spcBef'), bp = bef && kid(bef, 'spcPts'), bc2 = bef && kid(bef, 'spcPct');
        return { runs, end, bullet: runs.some(r => r.t.trim()) ? bullet : null, align: pa('algn', 'l'), marL: +pa('marL', 0) / EMU, indent: +pa('indent', 0) / EMU,
          lnSpc: pct ? num(pct, 'val', 100000) / 100000 : 1, before: bp ? num(bp, 'val') / 100 * 4 / 3 : bc2 ? -num(bc2, 'val') / 100000 : 0 };
      });
      const font = (r, k) => `${r.i ? 'italic ' : ''}${r.b ? 700 : 400} ${Math.max(1, r.size * k)}px ${r.face}${SANS}`;
      function compose(k) {
        const lines = [];
        let auto = 0;
        for (const p of paras) {
          const size = (p.runs[0] || p.end).size * k, first = lines.length;
          const left = p.marL * (k < 1 ? Math.max(k, 0.7) : 1), x0 = p.bullet ? left : left + Math.max(0, p.indent), avail = wrap ? Math.max(20, W - x0) : 1e6;
          let line = { items: [], w: 0, h: size, x0, p }, pend = null;
          const push = () => { lines.push(line); line = { items: [], w: 0, h: size, x0: left, p }; pend = null; };
          for (const r of p.runs) {
            if (r.br) { line.h = Math.max(line.h, r.size * k); push(); continue; }
            g.font = font(r, k);
            for (const t of r.t.split(/(\s+)/)) {
              if (!t) continue;
              const w = g.measureText(t).width;
              if (/^\s+$/.test(t)) { if (line.items.length) pend = { t, w, r }; continue; }
              if (line.items.length && line.w + (pend ? pend.w : 0) + w > avail) push();
              if (pend) { line.items.push({ t: pend.t, w: pend.w, r: pend.r }); line.w += pend.w; pend = null; }
              line.items.push({ t, w, r }); line.w += w; line.h = Math.max(line.h, r.size * k);
            }
          }
          push();
          if (p.bullet === '#') auto++; else auto = 0;
          lines[first].bullet = p.bullet === '#' ? auto + '.' : p.bullet;
          lines[first].gap = lines.length > 1 && first ? (p.before < 0 ? -p.before * size : p.before * k) : 0;
        }
        let total = 0;
        for (const l of lines) { l.lh = l.h * 1.2 * l.p.lnSpc * (k < 1 ? 0.96 : 1); total += l.lh + (l.gap || 0); }
        return { lines, total };
      }
      let k = fit ? num(fit, 'fontScale', 100000) / 100000 : 1, L = compose(k);
      // O PowerPoint encolhe o texto que não cabe; sem essa informação no arquivo, encolhe aqui.
      if (!fit && wrap && H > 20) while (L.total > H * 1.04 && k > 0.5) L = compose(k -= 0.08);
      const anchor = bAttr('anchor', 't');
      let y = box.y + ins[1] + (anchor === 'ctr' ? Math.max(0, (H - L.total) / 2) : anchor === 'b' ? Math.max(0, H - L.total) : 0);
      g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      for (const l of L.lines) {
        y += l.gap || 0;
        const al = l.p.align, free = (wrap ? W : 0) - l.x0 - l.w;
        let x = box.x + ins[0] + l.x0 + (al === 'ctr' ? free / 2 : al === 'r' ? free : 0);
        const base = y + l.lh * 0.5 + l.h * 0.34;
        if (l.bullet && l.items.length) { const r = l.items[0].r; g.font = font({ ...r, i: false }, k); g.fillStyle = r.color; g.fillText(l.bullet, x + Math.min(-8, l.p.indent * (k < 1 ? Math.max(k, 0.7) : 1)), base); }
        for (const it of l.items) { g.font = font(it.r, k); g.fillStyle = it.r.color; g.fillText(it.t, x, base); x += it.w; }
        y += l.lh;
      }
    }

    /* ---------- formas ---------- */
    function shapePath(g, prst, w, h) {
      g.beginPath();
      if (prst === 'ellipse') g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else if (/^(round|snip).*Rect/i.test(prst)) { const r = Math.min(w, h) * 0.16; g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath(); }
      else if (prst === 'triangle') { g.moveTo(w / 2, 0); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); }
      else if (prst === 'rtTriangle') { g.moveTo(0, 0); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); }
      else if (prst === 'diamond') { g.moveTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.lineTo(0, h / 2); g.closePath(); }
      else if (prst === 'rightArrow') { g.moveTo(0, h * 0.25); g.lineTo(w - h * 0.5, h * 0.25); g.lineTo(w - h * 0.5, 0); g.lineTo(w, h / 2); g.lineTo(w - h * 0.5, h); g.lineTo(w - h * 0.5, h * 0.75); g.lineTo(0, h * 0.75); g.closePath(); }
      else g.rect(0, 0, w, h);
    }
    function stroke(g, ln, style, C) {
      if (ln && kid(ln, 'noFill')) return;
      const c = (ln && color(kid(ln, 'solidFill'), C)) || (style && num(kid(style, 'lnRef'), 'idx') > 0 && color(kid(style, 'lnRef'), C));
      if (!c) return;
      g.strokeStyle = c; g.lineWidth = Math.max(0.75, num(ln, 'w', 9525) / EMU); g.stroke();
    }

    function drawSp(g, sp, S) {
      const ph = phOf(sp);
      if (S.own !== S.sl && ph) return; // no layout e no mestre, os espaços reservados são só moldes
      const layPh = ph ? findPh(S.lay, ph, true) : null, masPh = ph ? findPh(S.mas, layPh ? phOf(layPh) || ph : ph, false) : null;
      const xf = xfrmOf(sp) || xfrmOf(layPh) || xfrmOf(masPh);
      if (!xf) return;
      const spPr = kid(sp, 'spPr'), style = kid(sp, 'style'), geom = kid(spPr, 'prstGeom'), prst = geom ? geom.getAttribute('prst') : 'rect';
      g.save();
      g.translate(xf.x + xf.w / 2, xf.y + xf.h / 2); g.rotate(xf.rot); g.translate(-xf.w / 2, -xf.h / 2);
      if (sp.localName === 'cxnSp' || prst === 'line' || /Connector/.test(prst)) {
        g.beginPath(); g.moveTo(xf.flipH ? xf.w : 0, xf.flipV ? xf.h : 0); g.lineTo(xf.flipH ? 0 : xf.w, xf.flipV ? 0 : xf.h);
        const ln = kid(spPr, 'ln');
        g.strokeStyle = (ln && color(kid(ln, 'solidFill'), S.C)) || (style && color(kid(style, 'lnRef'), S.C)) || '#666'; g.lineWidth = Math.max(0.75, num(ln, 'w', 9525) / EMU); g.stroke();
      } else {
        let fill = paint(g, spPr, S.C, xf.w, xf.h);
        if (fill == null) for (const p of [layPh, masPh]) if (fill == null && p) fill = paint(g, kid(p, 'spPr'), S.C, xf.w, xf.h);
        if (fill == null && style && num(kid(style, 'fillRef'), 'idx') > 0) fill = color(kid(style, 'fillRef'), S.C);
        shapePath(g, prst, xf.w, xf.h);
        if (fill && fill !== 'none') { g.fillStyle = fill; g.fill(); }
        stroke(g, kid(spPr, 'ln'), style, S.C);
        const tx = kid(sp, 'txBody');
        if (tx) {
          const t = ph ? kind(ph.type) : 'other', ts = S.mas && desc(S.mas.doc, 'txStyles')[0];
          const chain = [kid(tx, 'lstStyle'), layPh && kid(kid(layPh, 'txBody'), 'lstStyle'), masPh && kid(kid(masPh, 'txBody'), 'lstStyle'), ph && ts && kid(ts, t === 'title' ? 'titleStyle' : t === 'body' ? 'bodyStyle' : 'otherStyle')].filter(Boolean);
          const bodies = [kid(tx, 'bodyPr'), layPh && kid(kid(layPh, 'txBody'), 'bodyPr'), masPh && kid(kid(masPh, 'txBody'), 'bodyPr')].filter(Boolean);
          const fc = style && color(kid(style, 'fontRef'), S.C);
          drawText(g, tx, { x: 0, y: 0, w: xf.w, h: xf.h }, chain, bodies.length ? bodies : [tx], S.C, { size: 1800, color: fc || '#' + (S.C.theme.dk1 || '000000'), bold: false });
        }
      }
      g.restore();
    }
    function drawPic(g, pic, S) {
      const ph = phOf(pic), xf = xfrmOf(pic) || xfrmOf(ph && findPh(S.lay, ph, true));
      const im = imgs.get((S.own.rels[rid(desc(pic, 'blip')[0])] || {}).target);
      if (!xf || !im) return;
      const sr = desc(pic, 'srcRect')[0], iw = im.naturalWidth, ih = im.naturalHeight, l = num(sr, 'l') / 100000, t = num(sr, 't') / 100000, r = num(sr, 'r') / 100000, b = num(sr, 'b') / 100000;
      g.save();
      g.translate(xf.x + xf.w / 2, xf.y + xf.h / 2); g.rotate(xf.rot);
      try { g.drawImage(im, iw * l, ih * t, Math.max(1, iw * (1 - l - r)), Math.max(1, ih * (1 - t - b)), -xf.w / 2, -xf.h / 2, xf.w, xf.h); } catch (e) { }
      g.restore();
    }
    function drawFrame(g, fr, S) {
      const xf = xfrmOf(fr), tbl = desc(fr, 'tbl')[0];
      if (!xf) return;
      if (!tbl) {
        g.save(); g.setLineDash([6, 5]); g.strokeStyle = 'rgba(120,120,120,.7)'; g.lineWidth = 1; g.strokeRect(xf.x, xf.y, xf.w, xf.h);
        g.fillStyle = 'rgba(110,110,110,.9)'; g.font = `400 14px ${SANS}`; g.textAlign = 'center'; g.fillText(desc(fr, 'chart').length ? 'Gráfico' : 'Objeto incorporado', xf.x + xf.w / 2, xf.y + xf.h / 2); g.restore();
        return;
      }
      const cols = desc(kid(tbl, 'tblGrid'), 'gridCol').map(c => num(c, 'w') / EMU), head = (kid(tbl, 'tblPr') || { getAttribute: () => '' }).getAttribute('firstRow') === '1';
      let y = xf.y;
      kids(tbl, 'tr').forEach((tr, ri) => {
        const h = num(tr, 'h') / EMU;
        let x = xf.x, ci = 0;
        for (const tc of kids(tr, 'tc')) {
          const span = num(tc, 'gridSpan', 1), w = cols.slice(ci, ci + span).reduce((a, b) => a + b, 0);
          ci += span;
          if (tc.getAttribute('hMerge') !== '1' && tc.getAttribute('vMerge') !== '1') {
            const own = paint(g, kid(tc, 'tcPr'), S.C, w, h), accent = '#' + (S.C.theme.accent1 || '4472C4');
            g.fillStyle = own && own !== 'none' ? own : head && ri === 0 ? accent : ri % 2 ? 'rgba(0,0,0,.045)' : 'rgba(255,255,255,.6)';
            g.fillRect(x, y, w, h);
            g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 0.75; g.strokeRect(x, y, w, h);
            const tx = kid(tc, 'txBody');
            if (tx) drawText(g, tx, { x, y, w, h }, [], [kid(tx, 'bodyPr') || tx], S.C, { size: 1400, color: head && ri === 0 && !own ? '#fff' : '#' + (S.C.theme.dk1 || '000000'), bold: head && ri === 0 });
          }
          x += w;
        }
        y += h;
      });
    }
    function drawTree(g, tree, S) {
      for (const el of tree.children) {
        try {
          if (el.localName === 'sp' || el.localName === 'cxnSp') drawSp(g, el, S);
          else if (el.localName === 'pic') { if (S.own === S.sl || !phOf(el)) drawPic(g, el, S); }
          else if (el.localName === 'graphicFrame') drawFrame(g, el, S);
          else if (el.localName === 'grpSp') {
            const xf = xfrmOf(el);
            g.save();
            if (xf && xf.cw && xf.ch) { g.translate(xf.x, xf.y); g.scale(xf.w / xf.cw, xf.h / xf.ch); g.translate(-xf.cx, -xf.cy); }
            drawTree(g, el, S);
            g.restore();
          }
        } catch (e) { console.warn('Forma ignorada', e); }
      }
    }
    function background(g, S) {
      for (const p of [S.sl, S.lay, S.mas]) {
        const b = p && desc(p.doc, 'bg')[0], pr = kid(b, 'bgPr'), ref = kid(b, 'bgRef');
        if (!b) continue;
        const im = pr && imgs.get((p.rels[rid(desc(pr, 'blip')[0])] || {}).target), c = im ? null : pr ? paint(g, pr, S.C, SW, SH) : color(ref, S.C);
        if (im) { try { g.drawImage(im, 0, 0, SW, SH); } catch (e) { } return; }
        if (c && c !== 'none') { g.fillStyle = c; g.fillRect(0, 0, SW, SH); return; }
      }
    }

    const ready = new Map();
    function prepare(i) {
      if (!ready.has(i)) ready.set(i, (async () => {
        const sl = await part(slides[i]), lr = relOf(sl, 'slideLayout'), lay = lr ? await part(lr.target) : null, mr = lay && relOf(lay, 'slideMaster'), mas = mr ? await part(mr.target) : null;
        for (const p of [mas, lay, sl]) if (p && p.doc && !p.loaded) {
          p.loaded = true;
          for (const b of desc(p.doc, 'blip')) {
            const r = p.rels[rid(b)];
            if (!r || imgs.has(r.target)) continue;
            const mime = Formats.MIME[Formats.ext(r.target)], d = mime ? await z.bytes(r.target) : null;
            imgs.set(r.target, d ? await Formats.loadImg(d, mime) : null);
          }
        }
        return { sl, lay, mas, C: { theme: mas ? await themeOf(mas) : {} } };
      })());
      return ready.get(i);
    }

    const toc = [];
    for (let i = 0; i < slides.length; i++) {
      const p = await part(slides[i]);
      if (!p.doc) continue;
      const t = desc(p.doc, 'sp').find(s => { const ph = phOf(s); return ph && kind(ph.type) === 'title'; });
      const title = t ? desc(t, 't').map(x => x.textContent).join(' ').replace(/\s+/g, ' ').trim() : '';
      if (title) toc.push({ title, page: i, lvl: 1 });
    }
    const core = await z.xml('docProps/core.xml');

    return {
      kind: 'fixed', fmt: 'pptx', n: slides.length, aspect: SW / SH, toc,
      title: core ? (desc(core, 'title')[0] || {}).textContent || '' : '', author: core ? (desc(core, 'creator')[0] || {}).textContent || '' : '',
      async draw(i, g, w, h) {
        const P = await prepare(i), k = Math.min(w / SW, h / SH);
        g.save();
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        g.translate((w - SW * k) / 2, (h - SH * k) / 2); g.scale(k, k);
        g.beginPath(); g.rect(0, 0, SW, SH); g.clip();
        if (P.sl.doc) {
          background(g, P);
          const tree = p => p && p.doc && desc(p.doc, 'spTree')[0];
          const show = p => !p || !p.doc || p.doc.documentElement.getAttribute('showMasterSp') !== '0';
          if (tree(P.mas) && show(P.lay) && show(P.sl)) drawTree(g, tree(P.mas), { ...P, own: P.mas });
          if (tree(P.lay) && show(P.sl)) drawTree(g, tree(P.lay), { ...P, own: P.lay });
          if (tree(P.sl)) drawTree(g, tree(P.sl), { ...P, own: P.sl });
        }
        g.restore();
      },
    };
  }

  return { open };
})();
