'use strict';
const GSync = window.GSyncLib || { web: false, on: () => false, io: null, html: () => '', off() {}, onChange: null };
/* Folhear — estante, leitor, sons, backup e sincronização */

let view = null, cur = null, book = null, Local = new Set();
const touch = () => matchMedia('(pointer: coarse)').matches;
const FMT = { pdf: 'PDF', epub: 'EPUB', pptx: 'Slides', docx: 'Word', odt: 'ODT', fb2: 'FB2', cbz: 'Álbum', img: 'Imagem', txt: 'Texto', md: 'Markdown', html: 'HTML', rtf: 'RTF', guia: 'Guia' };

/* ---------- avisos e janelas ---------- */
let toastT;
function toast(msg, act) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (act ? `<button class="link">${esc(act.label)}</button>` : '');
  if (act) $('button', t).onclick = () => { t.classList.remove('on'); act.fn(); };
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), act ? 7000 : 4200);
}
function busy(text) { $('#busy').hidden = !text; if (text) $('#busytxt').textContent = text; }
function modal(html) {
  const el = document.createElement('div');
  el.className = 'modalwrap';
  el.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const m = { el, onclose: null, close() { el.remove(); if (m.onclose) m.onclose(); } };
  el.addEventListener('mousedown', e => { if (e.target === el) m.close(); });
  el.addEventListener('click', e => { if (e.target.closest('[data-close]')) m.close(); });
  document.body.append(el);
  const f = $('input[type=text], .btn', el);
  if (f && !touch()) f.focus();
  return m;
}
const confirmBox = (title, text, ok, danger) => new Promise(res => {
  const m = modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="foot"><button class="btn ghost" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : ''}" id="ok">${esc(ok)}</button></div>`);
  let yes = false;
  m.onclose = () => res(yes);
  $('#ok', m.el).onclick = () => { yes = true; m.close(); };
});
const pickFiles = accept => new Promise(res => {
  const inp = $('#filepick');
  inp.value = ''; inp.accept = accept;
  inp.onchange = () => res([...inp.files]);
  inp.click();
});
function applyTheme() {
  if (S.set.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.set.theme;
}

/* ---------- instalar como aplicativo (versão web) ---------- */
const Inst = { prompt: null };
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canInstall = () => !Sync.avail && !standalone() && location.protocol === 'https:' && (Inst.prompt || isIOS());
async function install() {
  if (Inst.prompt) { Inst.prompt.prompt(); await Inst.prompt.userChoice.catch(() => { }); Inst.prompt = null; renderShelf(); }
  else modal(`<h2>Instalar no iPhone ou iPad</h2><p>No Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>. O Folhear ganha um ícone e abre em tela cheia.</p><div class="foot"><button class="btn" data-close>Entendi</button></div>`);
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); Inst.prompt = e; renderShelf(); });

/* ---------- sons de papel ---------- */
const Sfx = (() => {
  let ac, noise;
  function burst(f0, f1, peak, dur, type) {
    if (!S.set.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      if (!noise) { noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const t = ac.currentTime, src = ac.createBufferSource(), flt = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noise; flt.type = type; flt.Q.value = 0.7;
      flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.22); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(flt); flt.connect(g); g.connect(ac.destination);
      src.start(t, Math.random() * 0.3, dur + 0.05);
    } catch (e) { }
  }
  return {
    flip: rigid => rigid ? burst(420, 160, 0.12, 0.5, 'bandpass') : burst(3200, 900, 0.07, 0.34, 'bandpass'),
    land: rigid => rigid ? burst(160, 70, 0.3, 0.16, 'lowpass') : burst(1400, 500, 0.03, 0.1, 'bandpass'),
  };
})();

/* ---------- estante ---------- */
function progress(b) {
  if (b.page < 0) return 'Ainda fechado';
  if (b.page >= b.pages - 2 && b.pages > 2) return 'Lido até o fim';
  return `Página ${b.page + 1} de ${b.pages}`;
}
function renderShelf() {
  if (!$('#shelf')) return;
  $('#top').innerHTML = `<div class="brand">${LOGO}<span>Folhear</span></div><div class="grow"></div>
${canInstall() ? `<button class="btn ghost" data-act="install">${ic('dl')}<span>Instalar o aplicativo</span></button>` : ''}
<button class="btn" data-act="add">${ic('plus')}<span>Adicionar livro</span></button>
<button class="icon" data-act="settings" title="${Sync.on ? (Sync.error ? 'Falha na sincronização' : Sync.last ? 'Sincronizado ' + fmtRel(Sync.last) : 'Sincronização ativa') : 'Ajustes'}" aria-label="Ajustes e sincronização">${ic(Sync.on ? 'sync' : 'gear')}</button>`;
  const list = [...S.books].sort((a, b) => (b.opened || b.added) - (a.opened || a.added));
  $('#books').innerHTML = list.map(b => {
    const away = b.fmt !== 'guia' && !Local.has(b.id), ar = (b.aspect + OV) / (1 + 2 * OV);
    return `<div class="slot"><div class="stand"><button class="vol${away ? ' away' : ''}" data-act="open" data-id="${esc(b.id)}" style="--ar:${ar.toFixed(3)}" aria-label="Abrir ${esc(b.title)}">
${b.thumb ? `<img src="${esc(b.thumb)}" alt="">` : ''}${b.marks.length ? '<i class="mk"></i>' : ''}${away ? `<span class="tag">${Sync.on ? 'Na pasta sincronizada' : 'Arquivo em outro aparelho'}</span>` : ''}</button></div>
<div class="plank"></div>
<div class="cap"><div><b>${esc(b.title)}</b><small>${esc(progress(b))} · ${FMT[b.fmt] || esc(b.fmt.toUpperCase())}</small></div><button class="icon" data-act="menu" data-id="${esc(b.id)}" aria-label="Detalhes de ${esc(b.title)}">${ic('more')}</button></div></div>`;
  }).join('') + `<div class="slot"><div class="stand"><button class="vol new" data-act="add"><span>${ic('plus')}Adicionar livro</span></button></div><div class="plank"></div><div class="cap"><div><small class="wrap">PDF, slides, e-books, documentos e imagens. Também dá para soltar o arquivo aqui.</small></div></div></div>`;
}
const shelfSoon = debounce(() => { if (!cur) renderShelf(); }, 300);

async function plateOf(bk) {
  if (bk.kind !== 'fixed') return bk.coverImg || null;
  const c = document.createElement('canvas');
  c.height = 520; c.width = Math.round(520 * bk.aspect);
  await bk.draw(0, c.getContext('2d'), c.width, c.height);
  return c;
}
async function fixThumbs() {
  await Flow.ready();
  let n = 0;
  for (const b of S.books) if (!b.thumb) { b.thumb = Covers.thumb({ id: b.id, title: b.title, author: b.author }, b.aspect); DB.put('books', b, true); n++; }
  if (n) shelfSoon();
}

async function importOne(it) {
  const buf = await it.blob.arrayBuffer(), u8 = new Uint8Array(buf), id = fileId(u8);
  const bk = await Formats.open(it.name, buf, { scale: S.set.font });
  if (it.title) bk.title = it.title;
  bk.plate = await plateOf(bk);
  let meta = S.books.find(b => b.id === id);
  if (!meta) { meta = normalize({ id, title: bk.title, author: bk.author, fmt: bk.fmt, name: it.name, size: u8.length, pages: bk.n, aspect: bk.aspect, page: -1, added: Date.now() }); S.books.push(meta); }
  meta.thumb = Covers.thumb({ id, title: meta.title, author: meta.author, plate: bk.plate }, bk.aspect);
  delete DB.tomb()['books:' + id];
  await DB.put('files', { id, name: it.name, blob: new Blob([buf]) });
  Local.add(id);
  await DB.put('books', meta);
  return { meta, bk };
}
async function addFiles(files) {
  files = [...files];
  const jsons = files.filter(f => /\.json$/i.test(f.name));
  if (jsons.length) await importBackup(jsons);
  const pics = files.filter(f => Formats.isImg(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const items = files.filter(f => !jsons.includes(f) && !pics.includes(f)).map(f => ({ name: f.name, blob: f }));
  let last = null, n = 0;
  try {
    if (pics.length > 1) {
      busy(`Montando um álbum com ${pics.length} imagens…`);
      const data = await Promise.all(pics.map(async f => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
      items.push({ name: `Álbum de ${pics.length} imagens.cbz`, blob: Zip.store(data), title: `Álbum: ${Formats.bare(pics[0].name)}` });
    } else items.push(...pics.map(f => ({ name: f.name, blob: f })));
    for (const it of items) {
      busy(`Abrindo “${cut(it.name, 48)}”…`);
      try { last = await importOne(it); n++; }
      catch (e) { console.error(e); toast(`“${cut(it.name, 36)}”: ${e.message || 'não foi possível abrir'}`); }
    }
  } finally { busy(null); }
  renderShelf();
  if (n === 1) openBook(last.meta.id, last.bk); else if (n > 1) toast(`${n} livros colocados na estante`);
}
async function removeBook(b) {
  if (!await confirmBox('Tirar da estante', `“${b.title}” sai da estante${Sync.on ? ' em todos os aparelhos sincronizados' : ''}, junto com a página em que você parou e os marcadores. O arquivo original não é afetado.`, 'Tirar da estante', true)) return;
  S.books = S.books.filter(x => x !== b);
  DB.del('books', b.id); DB.del('files', b.id); Local.delete(b.id);
  if (Sync.on) api('file/' + b.id, { method: 'DELETE' }).catch(() => { });
  renderShelf();
}
function bookMenu(b) {
  const m = modal(`<h2>Detalhes do livro</h2>
<label for="btitle">Título</label><input type="text" id="btitle" value="${esc(b.title)}" maxlength="200">
<label for="bauthor">Autor</label><input type="text" id="bauthor" value="${esc(b.author)}" maxlength="200">
<dl><dt>Formato</dt><dd>${FMT[b.fmt] || esc(b.fmt)}</dd><dt>Páginas</dt><dd>${b.pages}</dd>${b.name ? `<dt>Arquivo</dt><dd>${esc(b.name)}${b.size ? ' · ' + fmtSize(b.size) : ''}</dd>` : ''}<dt>Leitura</dt><dd>${esc(progress(b))}</dd><dt>Na estante desde</dt><dd>${new Date(b.added).toLocaleDateString('pt-BR')}</dd></dl>
<div class="foot"><button class="btn ghost" id="brm">${ic('trash')} Tirar da estante</button><span class="grow"></span><button class="btn ghost" data-close>Cancelar</button><button class="btn" id="bsave">Salvar</button></div>`);
  $('#brm', m.el).onclick = () => { m.close(); removeBook(b); };
  $('#bsave', m.el).onclick = () => {
    const t = $('#btitle', m.el).value.trim() || b.title, a = $('#bauthor', m.el).value.trim();
    if (t !== b.title || a !== b.author) { b.title = t; b.author = a; b.thumb = ''; DB.put('books', b); fixThumbs(); }
    m.close(); renderShelf();
  };
}
function missing(meta) {
  const m = modal(`<h2>O arquivo não está neste aparelho</h2><p>“${esc(meta.title)}” está na sua estante com a página em que você parou, mas o arquivo${meta.name ? ` <b>${esc(meta.name)}</b>` : ''} foi aberto em outro aparelho.</p><p class="muted">Escolha o mesmo arquivo aqui e a leitura continua de onde parou.</p><div class="foot"><button class="btn ghost" data-close>Agora não</button><button class="btn" id="pick">${ic('file')} Escolher o arquivo</button></div>`);
  $('#pick', m.el).onclick = async () => {
    const fs = await pickFiles(Formats.ACCEPT);
    if (!fs.length) return;
    m.close();
    const before = S.books.length;
    await addFiles(fs);
    if (S.books.length > before) toast('Esse é um arquivo diferente: entrou na estante como outro livro');
  };
}

/* ---------- leitor ---------- */
let idleT, saveT;
function label(st) {
  if (st.closed && st.page < 0) return 'Capa';
  if (st.mode === 'double' && st.left >= 0 && st.right >= 0) return `${st.left + 1}–${st.right + 1} de ${st.n}`;
  if (st.mode === 'double' && st.left < 0 && st.right < 0) return 'Fim';
  return `${(st.right >= 0 ? st.right : st.left >= 0 ? st.left : st.page) + 1} de ${st.n}`;
}
function onPage(st) {
  if (!cur || !st) return;
  $('#rfoot output').textContent = label(st);
  const r = $('#rfoot input');
  r.max = st.n; r.value = st.page + 1;
  $('#hint').hidden = !(st.closed && st.page < 0);
  $('[data-act=mark]').classList.toggle('on', !!markAt(st));
  if (st.page !== cur.page || st.n !== cur.pages) {
    cur.page = st.page; cur.pages = st.n; cur.frac = st.n > 1 ? Math.max(0, st.page) / (st.n - 1) : 0;
    clearTimeout(saveT);
    saveT = setTimeout(savePos, 900);
  }
}
function savePos() { clearTimeout(saveT); saveT = 0; if (cur) DB.put('books', cur); }
const pageOfMark = (m, n) => Math.round(m.frac * Math.max(0, n - 1));
const markAt = st => st.page >= 0 && cur.marks.find(m => { const p = pageOfMark(m, st.n); return p === st.page || p === st.left || p === st.right; });
function wake() {
  $('#reader').classList.remove('idle');
  clearTimeout(idleT);
  if (!touch() && $('#side').hidden) idleT = setTimeout(() => { if (!$('#rbar:hover, #rfoot:hover')) $('#reader').classList.add('idle'); }, 3500);
}
function showReader() {
  $('#shelf').hidden = true; $('#reader').hidden = false; $('#side').hidden = true;
  $('#rbar').innerHTML = `<button class="icon" data-act="shelf" title="Voltar à estante (Esc)" aria-label="Voltar à estante">${ic('back')}</button><h1>${esc(cur.title)}</h1>
${book.relayout ? `<button class="icon txt" data-act="smaller" title="Letra menor" aria-label="Letra menor">A−</button><button class="icon txt" data-act="bigger" title="Letra maior" aria-label="Letra maior">A+</button>` : ''}
<button class="icon" data-act="toc" title="Sumário e marcadores" aria-label="Sumário e marcadores">${ic('list')}</button>
<button class="icon" data-act="mark" title="Marcar esta página" aria-label="Marcar esta página">${ic('mark')}</button>
<button class="icon opt" data-act="zoom" title="Aproximar (dois cliques na página)" aria-label="Aproximar">${ic('zoom')}</button>
<button class="icon opt" data-act="sound" title="Som das páginas" aria-label="Som das páginas">${ic(S.set.sound ? 'snd' : 'mute')}</button>
<button class="icon opt" data-act="full" title="Tela cheia (F)" aria-label="Tela cheia">${ic('full')}</button>`;
  $('#rfoot').innerHTML = `<button class="icon" data-act="prev" title="Página anterior (←)" aria-label="Página anterior">${ic('back')}</button><input type="range" id="scrub" min="0" max="1" step="1" value="0" aria-label="Posição no livro"><output for="scrub"></output><button class="icon" data-act="next" title="Próxima página (→)" aria-label="Próxima página">${ic('fwd')}</button>`;
  $('#hint').textContent = touch() ? 'Toque na capa ou arraste para abrir' : 'Clique na capa ou arraste para abrir';
  const r = $('#scrub');
  r.oninput = () => { $('#rfoot output').textContent = +r.value === 0 ? 'Capa' : `${r.value} de ${r.max}`; };
  r.onchange = () => { if (+r.value === 0) view.first(); else view.goPage(+r.value - 1, true); r.blur(); };
  if (!view) {
    view = Book3D.create($('#gl'), {
      soft: /2d/.test(location.hash), // #2d força o desenho sem WebGL
      onPage, onFlip: r2 => Sfx.flip(r2), onLand: r2 => Sfx.land(r2),
      onTap: dbl => { if (!dbl) { if (touch()) $('#reader').classList.toggle('idle'); else wake(); } },
      onLost: () => toast('A placa de vídeo reiniciou o desenho', { label: 'Recarregar', fn: () => location.reload() }),
    });
  }
  wake();
}
async function openBook(id, parsed) {
  const meta = S.books.find(b => b.id === id);
  if (!meta || cur) return;
  let bk = parsed;
  try {
    if (!bk) {
      busy(`Abrindo “${cut(meta.title, 48)}”…`);
      if (meta.fmt === 'guia') bk = await Formats.guide(S.set.font);
      else {
        let f = await DB.get('files', id);
        if (!f && Sync.on) {
          busy('Buscando o arquivo na pasta sincronizada…');
          const r = await api('file/' + id);
          if (r.status === 200) { f = { id, name: meta.name, blob: await r.blob() }; await DB.put('files', f); Local.add(id); }
        }
        if (!f) { busy(null); return missing(meta); }
        bk = await Formats.open(meta.name || f.name || '', await f.blob.arrayBuffer(), { scale: S.set.font });
      }
    }
    if (bk.plate === undefined) bk.plate = await plateOf(bk);
  } catch (e) { console.error(e); busy(null); return toast(`Não foi possível abrir: ${e.message || 'erro desconhecido'}`); }
  busy(null);
  cur = meta; book = bk;
  const page = meta.page >= 0 && meta.pages !== bk.n ? Math.round(meta.frac * (bk.n - 1)) : Math.min(meta.page, bk.n - 1);
  try {
    showReader();
    view.open(bk, { page, cover: { id: meta.id, title: meta.title, author: meta.author, plate: bk.plate } });
  } catch (e) { console.error(e); cur = book = null; $('#reader').hidden = true; $('#shelf').hidden = false; return toast(e.message); }
  meta.opened = Date.now(); meta.pages = bk.n; meta.aspect = bk.aspect;
  if (!meta.thumb) meta.thumb = Covers.thumb({ id: meta.id, title: meta.title, author: meta.author, plate: bk.plate }, bk.aspect);
  if (meta.seed && meta.page >= 0) delete meta.seed;
  DB.put('books', meta);
  history.pushState({ reader: 1 }, '');
}
function closeReader(fromHistory) {
  if (!cur) return;
  if (!fromHistory && history.state && history.state.reader) return history.back();
  savePos();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  view.close();
  if (book.close) try { book.close(); } catch (e) { }
  cur = book = null;
  $('#reader').hidden = true; $('#shelf').hidden = false;
  renderShelf();
}
addEventListener('popstate', () => closeReader(true));

function setFont(d) {
  const f = clamp(Math.round((S.set.font + d) * 10) / 10, 0.7, 1.8);
  if (f === S.set.font || !book.relayout) return;
  const st = view.state(), frac = st.n > 1 ? Math.max(0, st.page) / (st.n - 1) : 0;
  S.set.font = f; Store.saveSet();
  book.relayout(f);
  view.refresh(st.page < 0 ? -1 : Math.round(frac * (book.n - 1)));
  toast(`Letra ${Math.round(f * 100)}% · ${book.n} páginas`);
}
function toggleMark() {
  const st = view.state();
  if (st.page < 0) return toast('Abra o livro numa página para marcar');
  const m = markAt(st);
  if (m) cur.marks = cur.marks.filter(x => x !== m);
  else cur.marks.push({ frac: st.n > 1 ? st.page / (st.n - 1) : 0, label: (book.toc || []).filter(t => t.page <= st.page).map(t => t.title).pop() || '', at: Date.now() });
  DB.put('books', cur);
  $('[data-act=mark]').classList.toggle('on', !m);
  toast(m ? 'Marcador retirado' : `Página ${st.page + 1} marcada`);
  if (!$('#side').hidden) renderSide();
}
function renderSide() {
  const st = view.state(), toc = book.toc || [], here = toc.filter(t => t.page <= Math.max(st.page, st.right)).pop();
  const marks = [...cur.marks].sort((a, b) => a.frac - b.frac);
  $('#side').innerHTML = `<header><h2>Sumário</h2><button class="icon" data-act="toc" aria-label="Fechar">${ic('x')}</button></header><div class="scroll">
${toc.length ? toc.map(t => `<button class="row${t.lvl > 1 ? ' l2' : ''}${t === here ? ' cur' : ''}" data-act="goto" data-page="${t.page}"><span>${esc(cut(t.title, 90))}</span><i>${t.page + 1}</i></button>`).join('') : '<p class="muted">Este arquivo não traz sumário. Use a régua embaixo para ir a qualquer página.</p>'}
<h3>Marcadores</h3>
${marks.length ? marks.map(m => { const p = pageOfMark(m, st.n); return `<button class="row" data-act="goto" data-page="${p}"><span>${esc(m.label ? cut(m.label, 70) : 'Página ' + (p + 1))}</span><i>${p + 1}</i></button>`; }).join('') : `<p class="muted">Nenhum marcador ainda. O botão de marcador, lá em cima, guarda a página aberta.</p>`}
</div>`;
}
function toggleSide() {
  const s = $('#side');
  s.hidden = !s.hidden;
  if (!s.hidden) { renderSide(); const c = $('.cur', s); if (c) c.scrollIntoView({ block: 'center' }); }
  wake();
}
const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => toast('Este aparelho não permite tela cheia aqui'));

/* ---------- backup ---------- */
const api = (path, opt = {}) => fetch('api/' + path, Object.assign({ cache: 'no-store' }, opt, { headers: { 'X-Folhear': '1' } }));
async function saveBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (touch() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast('Salvo em Downloads: ' + name);
}
const backupData = () => JSON.stringify({ app: 'folhear', version: 1, exported: Date.now(), books: S.books.filter(b => b.fmt !== 'guia') });
async function importBackup(files) {
  let total = 0;
  for (const f of files) {
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'folhear' || !Array.isArray(j.books)) throw new Error('não é um backup do Folhear');
      for (const o of j.books) {
        if (!o || !o.id || !/^[a-z0-9]+$/.test(o.id)) continue;
        normalize(o);
        const i = S.books.findIndex(x => x.id === o.id);
        if (i >= 0 && (S.books[i].mod || 0) >= (o.mod || 0)) continue;
        if (i >= 0) S.books[i] = o; else S.books.push(o);
        DB.put('books', o); total++;
      }
    } catch (e) { toast(`Falha ao importar “${f.name}”: ${e.message}`); }
  }
  if (total) toast(`${count(total, 'livro atualizado', 'livros atualizados')} na estante`);
  renderShelf();
  return total > 0;
}

/* ---------- sincronização com pasta do Google Drive (só no app de Windows) ---------- */
const Sync = { avail: false, on: false, folder: null, detected: null, drives: [], busy: false, again: false, last: 0, error: '' };
async function syncInfo(r) {
  try {
    r = r || await api('sync/info');
    if (!r.ok) throw new Error('sem API');
    const j = await r.json();
    Object.assign(Sync, { avail: true, on: j.enabled, folder: j.folder, detected: j.detected, drives: j.drives || [] });
  } catch (e) { Sync.avail = Sync.on = false; }
}
const syncSig = d => (d.books || []).map(o => o.id + ':' + (o.mod || 0)).sort().join(',') + '|' + Object.keys(d.tombstones || {}).sort().join(',');
function mergeRemote(remote) {
  const tomb = DB.tomb();
  let n = 0;
  for (const [k, ts] of Object.entries(remote.tombstones || {})) {
    const id = k.split(':')[1], i = S.books.findIndex(o => o.id === id);
    if (i >= 0 && (S.books[i].mod || 0) <= ts && !(cur && cur.id === id)) { S.books.splice(i, 1); DB.del('books', id, true); DB.del('files', id, true); Local.delete(id); n++; }
    if (!(tomb[k] >= ts)) tomb[k] = ts;
  }
  for (const o of remote.books || []) {
    if (!o || !o.id || !/^[a-z0-9]+$/.test(o.id) || (tomb['books:' + o.id] || 0) >= (o.mod || 0) || (cur && cur.id === o.id)) continue;
    const i = S.books.findIndex(x => x.id === o.id);
    if (i >= 0 && (o.mod || 0) <= (S.books[i].mod || 0)) continue;
    normalize(o);
    if (i < 0) S.books.push(o); else S.books[i] = o;
    DB.put('books', o, true); n++;
  }
  DB.saveTomb();
  return n;
}
/* Primeira sincronização num aparelho novo: troca o guia de exemplo pelo que já está no Drive. */
function dropSeed() {
  S.books.filter(o => o.seed && !(cur && cur.id === o.id)).forEach(o => { S.books = S.books.filter(x => x !== o); DB.del('books', o.id, true); });
}
/* Os arquivos dos livros vão para a subpasta "livros"; cada aparelho baixa um arquivo só quando o livro é aberto. */
async function syncFiles() {
  const r = await api('files');
  if (!r.ok) return;
  const have = new Set(await r.json());
  for (const b of S.books) {
    if (b.fmt === 'guia' || have.has(b.id) || !Local.has(b.id)) continue;
    const f = await DB.get('files', b.id);
    if (f && !(await api('file/' + b.id, { method: 'POST', body: f.blob })).ok) throw new Error('não foi possível gravar o arquivo do livro na pasta');
  }
}
async function syncNow(manual) {
  if (!Sync.on && !GSync.on()) return;
  if (Sync.busy) { Sync.again = true; return; }
  Sync.busy = true;
  try {
    const r = await (Sync.on ? api('sync') : GSync.io());
    if (!r.ok) throw new Error('não foi possível ler a pasta');
    const text = r.status === 200 ? await r.text() : '', remote = text.trim() ? JSON.parse(text) : null;
    let pulled = 0;
    if (remote && remote.app === 'folhear') {
      if (!S.set.syncedOnce && (remote.books || []).length) dropSeed();
      pulled = mergeRemote(remote);
    }
    const local = { app: 'folhear', version: 1, exported: Date.now(), books: S.books.filter(b => !b.seed), tombstones: DB.tomb() };
    if (!remote || syncSig(remote) !== syncSig(local)) {
      const w = await (Sync.on ? api('sync', { method: 'POST', body: JSON.stringify(local) }) : GSync.io({ method: 'POST', body: JSON.stringify(local) }));
      if (!w.ok) throw new Error('não foi possível gravar na pasta');
    }
    if (Sync.on) await syncFiles();
    if (!S.set.syncedOnce) { S.set.syncedOnce = true; Store.saveSet(); }
    Sync.last = Date.now(); Sync.error = '';
    if (pulled) fixThumbs();
    if (manual) toast(pulled ? `Sincronizado: ${count(pulled, 'livro atualizado', 'livros atualizados')}` : 'Sincronizado com o Google Drive');
  } catch (e) {
    console.error(e); Sync.error = e.message;
    if (manual) toast('Falha ao sincronizar: ' + e.message);
  }
  Sync.busy = false;
  shelfSoon();
  if (Sync.again) { Sync.again = false; syncSoon(); }
}
const syncSoon = debounce(() => syncNow(), 4000);
async function syncConfig(route, body) {
  await syncInfo(await api(route, { method: 'POST', body }));
  if (Sync.on) await syncNow(true); else renderShelf();
}

/* ---------- ajustes ---------- */
function settings() {
  const m = modal(`<h2>Ajustes</h2>
<label>Aparência</label><div class="seg">${[['auto', 'Automática'], ['light', 'Clara'], ['dark', 'Escura']].map(([k, t]) => `<button data-k="theme" data-v="${k}" class="${S.set.theme === k ? 'on' : ''}">${t}</button>`).join('')}</div>
<label>Som das páginas</label><div class="seg"><button data-k="sound" data-v="1" class="${S.set.sound ? 'on' : ''}">Ligado</button><button data-k="sound" data-v="" class="${S.set.sound ? '' : 'on'}">Desligado</button></div>
${Sync.avail ? `<label>Sincronização com o Google Drive</label>
<p style="margin:0 0 6px">${Sync.on ? `Ativa em <b>${esc(Sync.folder)}</b>${Sync.error ? ` · <span class="err">${esc(Sync.error)}</span>` : Sync.last ? ` · última vez ${fmtRel(Sync.last)}` : ''}` : Sync.detected ? 'Desativada.' : 'O Google Drive para computador não foi encontrado. Escolha uma pasta sincronizada (Drive, OneDrive, Dropbox…).'}</p>
<div class="row wrap">${Sync.on ? `<button class="btn ghost sm" data-k="syncnow">${ic('sync')} Sincronizar agora</button><button class="btn ghost sm" data-k="syncoff">Desativar</button>` : Sync.detected ? `<button class="btn sm" data-k="syncauto">Ativar em ${esc(Sync.detected)}</button>` : ''}<button class="btn ghost sm" data-k="syncpick">Escolher outra pasta…</button></div>
${Sync.drives.length > 1 ? `<p class="muted" style="margin-top:8px">Há mais de uma conta do Google Drive neste computador: cada unidade (G:, H:…) é uma conta.</p><div class="row wrap">${Sync.drives.map(d => `<button class="btn ghost sm" data-k="syncuse" data-path="${esc(d)}">${esc(d)}</button>`).join('')}</div>` : ''}
<p class="muted" style="margin-top:8px">O Folhear grava o arquivo folhear-sync.json (estante, páginas e marcadores) e a subpasta “livros” (os arquivos) na pasta, e o Google Drive leva para os outros computadores.</p>`
      : `${GSync.web ? GSync.html() : `<label>Sincronização</label><p class="muted">A sincronização automática pelo Google Drive funciona no aplicativo de Windows (Folhear.exe). Aqui, os livros ficam guardados neste aparelho. O backup leva a estante, as páginas em que você parou e os marcadores; ao abrir o mesmo arquivo no outro aparelho, tudo se encaixa.</p>`}`}
<label>Backup da estante</label><div class="row wrap"><button class="btn ghost sm" data-k="export">${ic('dl')} Exportar backup</button><button class="btn ghost sm" data-k="import">${ic('up')} Importar…</button></div>
<label>Este aparelho</label><div class="row wrap"><button class="btn ghost sm" data-k="wipe">${ic('trash')} Apagar tudo</button></div>
<p class="muted" style="margin-top:14px">Formatos: PDF, EPUB, PPTX, DOCX, ODT, FB2, CBZ, TXT, Markdown, HTML, RTF e imagens. Os arquivos são abertos no próprio aparelho; nada é enviado para servidores.</p>
<div class="foot"><button class="btn" data-close>Fechar</button></div>`);
  const again = () => { m.close(); settings(); };
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'theme') { S.set.theme = b.dataset.v; Store.saveSet(); applyTheme(); again(); }
    if (k === 'sound') { S.set.sound = !!b.dataset.v; Store.saveSet(); again(); }
    if (k === 'syncnow') { await syncNow(true); again(); }
    if (k === 'syncoff') { await syncConfig('sync/config', 'off'); again(); }
    if (k === 'syncauto') { await syncConfig('sync/config', 'auto'); again(); }
    if (k === 'syncuse') { await syncConfig('sync/config', b.dataset.path); again(); }
    if (k === 'syncpick') { toast('Escolha a pasta na janela que abriu'); await syncConfig('sync/choose', ''); again(); }
    if (k === 'export') saveBlob(new Blob([backupData()], { type: 'application/json' }), `folhear-backup-${dayKey(Date.now())}.json`);
    if (k === 'import') { m.close(); importBackup(await pickFiles('.json')); }
    if (k === 'wipe' && await confirmBox('Apagar tudo', 'Todos os livros, páginas marcadas e ajustes deste aparelho serão apagados. Isso não pode ser desfeito.' + (Sync.on ? ' A sincronização será desativada e a cópia no Google Drive continua lá.' : ''), 'Apagar tudo', true)) {
      if (Sync.on) await api('sync/config', { method: 'POST', body: 'off' }); GSync.off();
      await Promise.all(DB.STORES.map(s => DB.clear(s)));
      location.reload();
    }
  });
}

/* ---------- eventos ---------- */
const ACT = {
  add: async () => addFiles(await pickFiles(Formats.ACCEPT)),
  open: el => openBook(el.dataset.id),
  menu: el => { const b = S.books.find(x => x.id === el.dataset.id); if (b) bookMenu(b); },
  settings, install,
  shelf: () => closeReader(),
  prev: () => view.prev(), next: () => view.next(),
  toc: toggleSide, mark: toggleMark,
  goto: el => { view.goPage(+el.dataset.page, true); $('#side').hidden = true; },
  smaller: () => setFont(-0.1), bigger: () => setFont(0.1),
  zoom: () => view.zoomTo(view.zoom() > 1.02 ? 1 : 2.2),
  sound: el => { S.set.sound = !S.set.sound; Store.saveSet(); el.innerHTML = ic(S.set.sound ? 'snd' : 'mute'); if (S.set.sound) Sfx.flip(false); },
  full: fullscreen,
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { ACT[el.dataset.act](el); if (cur) wake(); }
});
addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const m = $$('.modalwrap').pop();
    if (m) return m.querySelector('[data-close]') ? m.querySelector('[data-close]').click() : m.remove();
  }
  if (!cur || $('.modalwrap') || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range') return;
  const k = e.key;
  if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) view.next();
  else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) view.prev();
  else if (k === 'Home') view.first();
  else if (k === 'End') view.last();
  else if (k === 'Escape') { if (!$('#side').hidden) $('#side').hidden = true; else if (view.zoom() > 1.02) view.zoomTo(1); else closeReader(); }
  else if (k === 'f' || k === 'F') fullscreen();
  else if (k === '+' || k === '=') view.zoomTo(Math.min(5, view.zoom() * 1.4));
  else if (k === '-') view.zoomTo(Math.max(1, view.zoom() / 1.4));
  else if (k === '0') view.zoomTo(1);
  else if (k === 'm' || k === 'M') toggleMark();
  else return;
  e.preventDefault();
  wake();
});
addEventListener('mousemove', () => { if (cur) wake(); });
addEventListener('resize', () => { if (view && cur) view.resize(); });
addEventListener('beforeunload', savePos);
document.addEventListener('visibilitychange', () => { if (document.hidden && saveT) savePos(); });
let dragN = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragenter', e => { if (hasFiles(e)) { e.preventDefault(); dragN++; $('#drop').hidden = !!cur; } });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#drop').hidden = true; } });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragN = 0; $('#drop').hidden = true;
  if (cur) return toast('Volte à estante para acrescentar outro livro');
  $$('.modalwrap').forEach(m => m.remove());
  addFiles(e.dataTransfer.files);
});

async function init() {
  await Store.load();
  applyTheme();
  Local = new Set(await DB.keys('files'));
  renderShelf();
  fixThumbs();
  if (location.protocol === 'https:' && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Sem modo offline:', e));
  if (/^https?:$/.test(location.protocol)) await syncInfo();
  if (Sync.avail || GSync.web) {
    GSync.onChange = () => syncNow(true);
    const first = Sync.on && !S.set.syncedOnce;
    DB.onChange = () => { if (Sync.on || GSync.on()) syncSoon(); };
    await syncNow();
    if (first && !Sync.error) toast('Sincronizando com o Google Drive: ' + Sync.folder);
    setInterval(() => syncNow(), 60000);
    addEventListener('focus', () => syncNow());
  }
  renderShelf();
}
init();
