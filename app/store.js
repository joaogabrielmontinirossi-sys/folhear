'use strict';
/* Folhear — utilitários, ícones e armazenamento local (IndexedDB) */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, Math.max(1, n - 1)).trimEnd() + '…' : s; };
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const LOGO = '<svg viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="#1f5a45"/><path d="M256 150v236" stroke="#143d2f" stroke-width="20" stroke-linecap="round"/><path d="M256 152c-44-30-100-34-152-20v232c52-14 108-10 152 22z" fill="#f6efdf"/><path d="M256 152c44-30 100-34 152-20v232c-52-14-108-10-152 22z" fill="#e9dfc8"/><path d="M256 152c40-52 96-74 150-66-26 36-34 78-30 130-44-8-88 10-120 50z" fill="#fffaf0" stroke="#d0a85a" stroke-width="10" stroke-linejoin="round"/></svg>';

const IC = {
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  gear: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4',
  x: 'M6 6l12 12M18 6L6 18',
  dl: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  up: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  sync: 'M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5',
  back: 'M15 5l-7 7 7 7',
  fwd: 'M9 5l7 7-7 7',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  mark: 'M7 4h10v16l-5-4-5 4z',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  snd: 'M4 10v4h4l5 4V6l-5 4zM17 9a4 4 0 0 1 0 6',
  mute: 'M4 10v4h4l5 4V6l-5 4zM17 10l4 4M21 10l-4 4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  book: 'M12 6c-2-1.6-5-2-8-1v13c3-1 6-.6 8 1 2-1.6 5-2 8-1V5c-3-1-6-.6-8 1zM12 6v13',
  zoom: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6M11 8v6',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5',
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24"><path d="${IC[n] || ''}"/></svg>`;

const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function fmtRel(ts) {
  const diff = Date.now() - ts, min = 60000, d = new Date(ts);
  if (diff < min) return 'agora';
  if (diff < 60 * min) return `há ${Math.floor(diff / min)} min`;
  if (dayKey(ts) === dayKey(Date.now())) return `há ${Math.floor(diff / (60 * min))} h`;
  if (dayKey(ts) === dayKey(Date.now() - 864e5)) return 'ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

/* Identidade do arquivo pelo conteúdo: o mesmo arquivo recebe o mesmo id em qualquer aparelho,
   então a posição de leitura e os marcadores se encontram na sincronização. */
function fileId(u8) {
  const n = u8.length, step = Math.max(1, Math.floor(n / 1500000));
  let a = 0x811c9dc5, b = n | 0;
  for (let i = 0; i < n; i += step) {
    a = Math.imul(a ^ u8[i], 16777619);
    b = Math.imul(b ^ u8[i] ^ (i & 255), 0x5bd1e995); b ^= b >>> 13;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36) + n.toString(36);
}

const DB = (() => {
  const STORES = ['books', 'files', 'kv'];
  const SYNCED = ['books'];
  let db = null, mem = null, tomb = { id: 'tombstones', items: {} };
  const useMem = () => { mem = {}; STORES.forEach(s => mem[s] = new Map()); };
  const run = (store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode), rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
  return {
    STORES, SYNCED,
    onChange: () => {},
    tomb: () => tomb.items,
    setTomb: t => { tomb = t; },
    saveTomb: () => DB.put('kv', tomb),
    open: () => new Promise(res => {
      try {
        const rq = indexedDB.open('folhear', 1);
        rq.onupgradeneeded = () => STORES.forEach(s => rq.result.objectStoreNames.contains(s) || rq.result.createObjectStore(s, { keyPath: 'id' }));
        rq.onsuccess = () => { db = rq.result; res(); };
        rq.onerror = rq.onblocked = () => { useMem(); res(); };
      } catch (e) { useMem(); res(); }
    }),
    all: s => mem ? Promise.resolve([...mem[s].values()]) : run(s, 'readonly', o => o.getAll()),
    keys: s => mem ? Promise.resolve([...mem[s].keys()]) : run(s, 'readonly', o => o.getAllKeys()),
    get: (s, id) => mem ? Promise.resolve(mem[s].get(id)) : run(s, 'readonly', o => o.get(id)),
    // raw = gravação vinda da sincronização: não carimba a data de modificação nem dispara novo envio
    put(s, v, raw) {
      if (!raw && SYNCED.includes(s)) { v.mod = Date.now(); DB.onChange(); }
      return mem ? Promise.resolve(mem[s].set(v.id, v)) : run(s, 'readwrite', o => o.put(v)).catch(e => { console.error(e); toast('Não foi possível salvar: armazenamento cheio?'); });
    },
    del(s, id, raw) {
      if (!raw && SYNCED.includes(s)) { tomb.items[s + ':' + id] = Date.now(); DB.saveTomb(); DB.onChange(); }
      return mem ? Promise.resolve(mem[s].delete(id)) : run(s, 'readwrite', o => o.delete(id));
    },
    clear: s => mem ? Promise.resolve(mem[s].clear()) : run(s, 'readwrite', o => o.clear()),
  };
})();

/* Estado em memória. Um "book" guarda só os dados do livro (título, posição, marcadores, capa);
   o arquivo em si fica na store "files" deste aparelho e, no Windows, na pasta de sincronização. */
const S = {
  books: [],
  set: { id: 'settings', theme: 'auto', sound: true, font: 1 },
};

const GUIDE_ID = 'guia';

/* Garante o formato de um livro vindo de fora (sincronização, backup). */
function normalize(b) {
  const str = v => typeof v === 'string' ? v : '';
  b.title = str(b.title) || 'Sem título';
  b.author = str(b.author); b.fmt = str(b.fmt); b.name = str(b.name); b.thumb = str(b.thumb);
  b.size = +b.size || 0; b.pages = Math.max(1, parseInt(b.pages) || 1);
  b.aspect = clamp(+b.aspect || 2 / 3, 0.3, 3);
  b.page = clamp(parseInt(b.page) || 0, -1, b.pages - 1);
  b.frac = clamp(+b.frac || 0, 0, 1);
  b.marks = (Array.isArray(b.marks) ? b.marks : []).filter(m => m && isFinite(m.frac)).map(m => ({ frac: clamp(+m.frac, 0, 1), label: str(m.label), at: +m.at || 0 }));
  b.added = +b.added || Date.now(); b.opened = +b.opened || 0;
  return b;
}

const Store = {
  async load() {
    await DB.open();
    S.books = (await DB.all('books')).map(normalize);
    const kv = await DB.all('kv');
    const st = kv.find(k => k.id === 'settings');
    if (st) Object.assign(S.set, st);
    const tb = kv.find(k => k.id === 'tombstones');
    if (tb) DB.setTomb(tb);
    if (!st && !S.books.length) Store.seed();
  },
  // seed: true marca o guia de exemplo, descartado se a primeira sincronização já encontrar livros
  seed() {
    const b = normalize({ id: GUIDE_ID, title: 'Como folhear', author: 'Guia do Folhear', fmt: 'guia', name: '', pages: 1, page: -1, seed: true });
    S.books.push(b);
    DB.put('books', b);
  },
  saveSet: () => DB.put('kv', S.set),
};
