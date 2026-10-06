'use strict';
/* Folhear — leitura de arquivos .zip (EPUB, PPTX, DOCX, ODT, CBZ) usando o descompactador do próprio navegador. */

const Zip = {
  open(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = u8.length - 22;
    for (const min = Math.max(0, u8.length - 66000); e >= min && dv.getUint32(e, true) !== 0x06054b50; e--);
    if (e < 0 || dv.getUint32(e, true) !== 0x06054b50) throw new Error('o arquivo compactado está corrompido');
    const total = dv.getUint16(e + 10, true), td = new TextDecoder(), files = new Map();
    let off = dv.getUint32(e + 16, true);
    for (let k = 0; k < total && off + 46 <= u8.length && dv.getUint32(off, true) === 0x02014b50; k++) {
      const nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
      const name = td.decode(u8.subarray(off + 46, off + 46 + nl));
      if (!name.endsWith('/')) files.set(name, { method: dv.getUint16(off + 10, true), csize: dv.getUint32(off + 20, true), lho: dv.getUint32(off + 42, true) });
      off += 46 + nl + el + cl;
    }
    const lower = new Map([...files.keys()].map(k => [k.toLowerCase(), k]));
    const find = name => {
      if (files.has(name)) return name;
      let n = name; try { n = decodeURIComponent(name); } catch (x) { }
      return files.has(n) ? n : lower.get(n.toLowerCase()) || null;
    };
    const z = {
      names: [...files.keys()],
      has: name => !!find(name),
      async bytes(name) {
        const f = files.get(find(name));
        if (!f) return null;
        const start = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true), raw = u8.subarray(start, start + f.csize);
        if (f.method === 0) return raw;
        if (f.method !== 8) throw new Error('compactação não suportada');
        return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      },
      async text(name) { const b = await z.bytes(name); return b ? new TextDecoder().decode(b).replace(/^﻿/, '') : null; },
      async xml(name) { const t = await z.text(name); return t ? new DOMParser().parseFromString(t, 'application/xml') : null; },
    };
    return z;
  },

  /* Caminho relativo dentro do zip: resolve('OEBPS/text/c1.xhtml', '../img/a.png') → 'OEBPS/img/a.png' */
  resolve(base, rel) {
    rel = rel.split('#')[0].split('?')[0];
    if (rel.startsWith('/')) return rel.slice(1);
    const out = base.split('/').slice(0, -1);
    for (const p of rel.split('/')) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
    return out.join('/');
  },

  /* Monta um zip sem compactação (usado para juntar várias imagens num álbum). */
  store(items) {
    const crcT = Zip._t || (Zip._t = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; }));
    const crc = u => { let c = ~0; for (let i = 0; i < u.length; i++) c = crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
    const te = new TextEncoder(), parts = [], dir = [];
    let off = 0;
    for (const it of items) {
      const name = te.encode(it.name), c = crc(it.data), h = new DataView(new ArrayBuffer(30)), d = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint32(14, c, true); h.setUint32(18, it.data.length, true); h.setUint32(22, it.data.length, true); h.setUint16(26, name.length, true);
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint32(16, c, true); d.setUint32(20, it.data.length, true); d.setUint32(24, it.data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, off, true);
      parts.push(new Uint8Array(h.buffer), name, it.data);
      dir.push(new Uint8Array(d.buffer), name);
      off += 30 + name.length + it.data.length;
    }
    const dsize = dir.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, items.length, true); end.setUint16(10, items.length, true); end.setUint32(12, dsize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...dir, new Uint8Array(end.buffer)], { type: 'application/zip' });
  },
};
