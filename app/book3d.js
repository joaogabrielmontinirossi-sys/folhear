'use strict';
/* Folhear — o livro físico: capa dura, guardas, miolo e a folha que se curva ao virar (WebGL).
   Unidades: a altura da página vale 1; a lombada fica em x = 0; a página da direita vai de x = 0 a x = W. */

const OV = 0.032; // quanto a capa sobra além das folhas

/* ---------- capas e guardas, desenhadas em canvas ---------- */
const Covers = (() => {
  const CLOTH = ['#6d1f2a', '#1f3a5c', '#1f5a45', '#7a4a1c', '#3b3340', '#5a2248', '#1d5560', '#8a3b1e', '#2f4a2a', '#4a4f5c'];
  const colorOf = id => { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return CLOTH[h % CLOTH.length]; };
  const shade = (hex, k) => '#' + [1, 3, 5].map(i => clamp(Math.round(parseInt(hex.slice(i, i + 2), 16) * k), 0, 255).toString(16).padStart(2, '0')).join('');
  let noise = null;
  function weave(g, w, h, base) {
    if (!noise) {
      noise = document.createElement('canvas'); noise.width = noise.height = 128;
      const n = noise.getContext('2d'), d = n.createImageData(128, 128);
      for (let i = 0; i < d.data.length; i += 4) { const x = (i / 4) % 128, y = Math.floor(i / 4 / 128), v = (x % 2 ^ y % 2 ? 255 : 0), a = Math.random() * 26 + (x % 2 ? 6 : 0); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = a; }
      n.putImageData(d, 0, 0);
    }
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.save(); g.scale(Math.max(1, w / 520), Math.max(1, w / 520)); g.fillStyle = g.createPattern(noise, 'repeat'); g.fillRect(0, 0, w, h); g.restore();
    const v = g.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(255,255,255,.07)'); v.addColorStop(1, 'rgba(0,0,0,.22)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  }
  function hinge(g, w, h, right) {
    const x = right ? w * 0.925 : w * 0.055, gr = g.createLinearGradient(x, 0, x + w * 0.022, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.35, 'rgba(0,0,0,.34)'); gr.addColorStop(0.7, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x, 0, w * 0.022, h);
  }
  function wrap(g, text, max, limit) {
    const out = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (line && g.measureText(t).width > max) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    if (out.length > limit) { out.length = limit; out[limit - 1] = out[limit - 1].replace(/.{0,2}$/, '…'); }
    return out;
  }
  const gold = (g, y0, y1) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, '#f3e2a6'); gr.addColorStop(0.5, '#d2ac5c'); gr.addColorStop(1, '#b08a3e'); return gr; };

  /* id: 'cover' e 'endB' têm a lombada à esquerda; 'back' e 'endF', à direita.
     info: { id, title, author, plate (imagem da 1ª página ou da capa do e-book) } */
  function draw(g, w, h, id, info) {
    const base = colorOf(info.id), u = Math.min(w, h * 0.78);
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    if (id === 'endF' || id === 'endB') {
      weave(g, w, h, shade(base, 0.82));
      const m = u * 0.03, right = id === 'endF';
      g.fillStyle = '#e7dcc4'; g.fillRect(right ? m : 0, m, w - m, h - 2 * m);
      g.save(); g.beginPath(); g.rect(right ? m : 0, m, w - m, h - 2 * m); g.clip();
      g.strokeStyle = base; g.globalAlpha = 0.16; g.lineWidth = Math.max(1, u * 0.0035);
      const s = u * 0.075;
      g.beginPath();
      for (let d = -h; d < w + h; d += s) { g.moveTo(d, 0); g.lineTo(d + h, h); g.moveTo(d, 0); g.lineTo(d - h, h); }
      g.stroke();
      g.globalAlpha = 1;
      const gx = right ? w : 0, gr = g.createLinearGradient(gx, 0, gx + (right ? -1 : 1) * w * 0.12, 0);
      gr.addColorStop(0, 'rgba(60,40,20,.45)'); gr.addColorStop(1, 'rgba(60,40,20,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.restore();
    } else if (id === 'back') {
      weave(g, w, h, base); hinge(g, w, h, true);
      g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = u * 0.006;
      g.strokeRect(w * 0.06, h * 0.06, w * 0.83, h * 0.88);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.font = `italic 400 ${u * 0.045}px ${Flow.SERIF}`;
      g.fillText('Folhear', w * 0.475, h * 0.9);
    } else {
      weave(g, w, h, base); hinge(g, w, h, false);
      const x0 = w * 0.115, x1 = w * 0.945, y0 = h * 0.055, y1 = h * 0.945, cx = (x0 + x1) / 2, fw = x1 - x0;
      g.strokeStyle = gold(g, y0, y1); g.lineWidth = u * 0.007; g.strokeRect(x0, y0, fw, y1 - y0);
      g.lineWidth = u * 0.0025; g.strokeRect(x0 + u * 0.016, y0 + u * 0.016, fw - u * 0.032, y1 - y0 - u * 0.032);
      const title = info.title || 'Sem título', pl = info.plate, pw = pl && (pl.naturalWidth || pl.width), ph = pl && (pl.naturalHeight || pl.height);
      let ty;
      if (pw && ph) {
        const k = Math.min(fw * 0.74 / pw, (y1 - y0) * 0.6 / ph), dw = pw * k, dh = ph * k, px = cx - dw / 2, py = y0 + (y1 - y0) * 0.085;
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(px + u * 0.008, py + u * 0.012, dw, dh);
        try { g.drawImage(pl, px, py, dw, dh); } catch (e) { }
        g.strokeStyle = gold(g, py, py + dh); g.lineWidth = u * 0.004; g.strokeRect(px, py, dw, dh);
        const fs = u * 0.058;
        g.font = `700 ${fs}px ${Flow.SERIF}`; g.fillStyle = gold(g, py + dh, y1);
        const lines = wrap(g, title, fw * 0.84, 2);
        ty = py + dh + ((y1 - py - dh) - lines.length * fs * 1.25 - (info.author ? fs : 0)) / 2 + fs * 0.9;
        lines.forEach(l => { g.fillText(l, cx, ty); ty += fs * 1.25; });
        if (info.author) { g.font = `italic 400 ${fs * 0.66}px ${Flow.SERIF}`; g.fillText(cut(info.author, 46), cx, ty + fs * 0.05); }
      } else {
        let fs = u * 0.105, lines;
        do { g.font = `700 ${fs}px ${Flow.SERIF}`; lines = wrap(g, title, fw * 0.8, 6); fs *= 0.9; } while ((lines.length > 4 || lines.some(l => g.measureText(l).width > fw * 0.84)) && fs > u * 0.045);
        fs /= 0.9;
        g.fillStyle = gold(g, y0, y1);
        ty = y0 + (y1 - y0) * 0.36 - (lines.length - 1) * fs * 0.6;
        lines.forEach(l => { g.fillText(l, cx, ty); ty += fs * 1.2; });
        const oy = ty + fs * 0.25;
        g.lineWidth = u * 0.004; g.beginPath(); g.moveTo(cx - fw * 0.2, oy); g.lineTo(cx - u * 0.03, oy); g.moveTo(cx + u * 0.03, oy); g.lineTo(cx + fw * 0.2, oy); g.stroke();
        g.save(); g.translate(cx, oy); g.rotate(Math.PI / 4); g.fillRect(-u * 0.011, -u * 0.011, u * 0.022, u * 0.022); g.restore();
        if (info.author) { g.font = `italic 400 ${u * 0.05}px ${Flow.SERIF}`; g.fillText(cut(info.author, 40), cx, y0 + (y1 - y0) * 0.86); }
      }
    }
    g.restore();
  }
  /* Miniatura da capa para a estante (vai junto na sincronização). */
  function thumb(info, aspect) {
    const c = document.createElement('canvas');
    c.height = 300; c.width = Math.round(300 * (aspect + OV) / (1 + 2 * OV));
    draw(c.getContext('2d'), c.width, c.height, 'cover', info);
    return c.toDataURL('image/jpeg', 0.8);
  }
  return { draw, thumb, colorOf };
})();

const Book3D = (() => {
  const VS = `
attribute vec2 aUV;
uniform vec4 uRect;
uniform float uMode, uDir, uR, uTheta, uShadow, uCamH, uZoom;
uniform vec2 uAxis, uN, uCam, uPPU, uPan;
varying vec2 vUV; varying vec3 vNormal; varying float vZ; varying float vD;
void main() {
  vec2 q = vec2(uRect.x + aUV.x * uRect.z, uRect.y + (1.0 - aUV.y) * uRect.w);
  vec3 p = vec3(q, 0.0); vec3 nrm = vec3(0.0, 0.0, 1.0); float d = 0.0;
  if (uMode > 1.5) {
    float c = cos(uTheta), s = sin(uTheta);
    p = vec3(q.x * c, q.y, q.x * s + 0.002); nrm = vec3(-s, 0.0, c);
  } else if (uMode > 0.5) {
    d = dot(q - uAxis, uN);
    if (d > 0.0) {
      float hp = 3.14159265 * uR;
      if (d < hp) { float th = d / uR; p.xy = q + uN * (uR * sin(th) - d); p.z = uR * (1.0 - cos(th)); nrm = vec3(-uN * sin(th), cos(th)); }
      else { p.xy = q - uN * (2.0 * d - hp); p.z = 2.0 * uR; nrm = vec3(0.0, 0.0, -1.0); }
      p.z += d * 0.006;
    }
    p.z += 0.002;
  }
  p.x *= uDir; nrm.x *= uDir;
  vZ = p.z; vD = d; vUV = aUV; vNormal = nrm;
  if (uShadow > 0.5) { p.xy += p.z * vec2(0.34, -0.46); p.z = 0.0; }
  float w = 1.0 - p.z / uCamH;
  gl_Position = vec4((p.xy - uCam) * uPPU * uZoom + uPan * w, (0.4 - p.z / uCamH * 0.9) * w, w);
}`;
  const FS = `
precision highp float;
uniform sampler2D uTexF, uTexB;
uniform float uKind, uMode, uDir, uFlipF, uFlipB, uGutter, uSpineU, uR, uGhost, uGhostF;
uniform vec4 uColor; uniform vec3 uLight; uniform vec2 uGrain;
varying vec2 vUV; varying vec3 vNormal; varying float vZ; varying float vD;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  if (uKind > 3.5) { // sombra da folha que está no ar
    float a = uColor.a * clamp(vZ / 0.08, 0.0, 1.0) * smoothstep(0.0, 0.06, min(1.0 - vUV.x, min(vUV.y, 1.0 - vUV.y)));
    gl_FragColor = vec4(0.0, 0.0, 0.0, a); return;
  }
  if (uKind > 2.5) { // sombra do livro na mesa
    vec2 d = max(abs(vUV - 0.5) * 2.0 - uColor.xy, 0.0) / (1.0 - uColor.xy);
    float k = 1.0 - clamp(length(d), 0.0, 1.0);
    gl_FragColor = vec4(0.0, 0.0, 0.0, uColor.a * k * k); return;
  }
  if (uKind > 1.5) { // corte das folhas empilhadas
    float a = mix(abs(vUV.x - uSpineU), 1.0 - vUV.y, uFlipF);
    float l = fract(a * uColor.a);
    gl_FragColor = vec4(uColor.rgb * (0.80 + 0.20 * smoothstep(0.0, 0.55, l)) * (1.0 - 0.24 * a), 1.0); return;
  }
  if (uKind > 0.5) { // tecido da capa (borda que aparece sob as folhas)
    gl_FragColor = vec4(uColor.rgb * (0.93 + 0.09 * hash(floor(gl_FragCoord.xy * 0.6))), 1.0); return;
  }
  bool front = uMode < 0.5 || (gl_FrontFacing == (uDir > 0.0));
  vec2 tf = vec2(mix(vUV.x, 1.0 - vUV.x, uFlipF), vUV.y), tb = vec2(mix(vUV.x, 1.0 - vUV.x, uFlipB), vUV.y);
  vec3 cf = texture2D(uTexF, tf).rgb, cb = texture2D(uTexB, tb).rgb;
  // papel fino: o verso deixa ver, bem de leve, o que está impresso na frente
  float lf = dot(cf, vec3(0.3, 0.6, 0.1)), lb = dot(cb, vec3(0.3, 0.6, 0.1));
  cb *= 1.0 - uGhost * (1.0 - lf); cf *= 1.0 - uGhostF * (1.0 - lb);
  vec3 c = front ? cf : cb;
  float s = abs(vUV.x - uSpineU);
  float g = 1.0 - uGutter * (0.30 * exp(-s * 30.0) + 0.10 * exp(-s * 6.0));
  float lit = abs(dot(normalize(vNormal), uLight)) / uLight.z;
  float shade = 0.5 + 0.5 * min(lit, 1.0) + 0.05 * clamp(lit - 1.0, 0.0, 1.0);
  if (uMode > 0.5 && uMode < 1.5 && !front) shade *= mix(0.9, 1.0, clamp((vD - 3.14159 * uR) / (uR * 1.8 + 0.0001), 0.0, 1.0));
  c *= g * shade * (0.985 + 0.03 * hash(floor((front ? tf : tb) * uGrain)));
  gl_FragColor = vec4(c, 1.0);
}`;
  const CAM_H = 4.4, NX = 72, NY = 44, LIGHT = (() => { const v = [-0.38, 0.48, 0.79], l = Math.hypot(...v); return v.map(x => x / l); })();

  function create(canvas, cb = {}) {
    const attrs = { alpha: true, antialias: true, premultipliedAlpha: true, depth: true };
    const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
    if (!gl) throw new Error('Este aparelho não tem WebGL, necessário para desenhar o livro');
    const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const U = {};
    for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) { const u = gl.getActiveUniform(prog, i); U[u.name] = gl.getUniformLocation(prog, u.name); }
    const set = (name, ...v) => { const l = U[name]; if (l) gl['uniform' + v.length + 'f'](l, ...v); };
    gl.uniform1i(U.uTexF, 0); gl.uniform1i(U.uTexB, 1);

    const verts = new Float32Array((NX + 1) * (NY + 1) * 2), idx = new Uint16Array(NX * NY * 6);
    for (let j = 0, k = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { verts[k++] = i / NX; verts[k++] = j / NY; }
    for (let j = 0, k = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.set([a, c, b, b, c, d], k); k += 6; }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aUV');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const coarse = matchMedia('(pointer: coarse)').matches;
    const MAXTEX = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), coarse ? 2048 : 3072);

    let book = null, info = null, token = 0, tick = 0;
    let W = 2 / 3, mode = '', leaves = [], T = 0, maxPos = 0, pos = 0;
    let cw = 1, ch = 1, dpr = 1, ppu = 100, zoom = 1, texZoom = 1, panX = 0, panY = 0, camY = 0;
    let flip = null, queue = [], raf = 0, last = 0, tween = null, lastCorner = 1, dead = false;
    const pad = { t: 58, b: 66 };
    const faces = new Map(), jobs = new Map();
    let blank = null, working = false;

    /* ---------- texturas ---------- */
    function upload(src) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (gl2) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      return t;
    }
    function solid(color) { const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 4, 4); return upload(c); }
    const texPx = () => Math.round(ppu * dpr * clamp(texZoom, 1, 2.6));
    const tex = id => { const f = faces.get(id); if (f) f.used = ++tick; return f && f.tex ? f.tex : blank; };
    function want(id, prio) {
      if (!id || id === 'blank') return;
      let f = faces.get(id);
      if (!f) faces.set(id, f = { tex: null, px: 0, req: 0 });
      f.used = ++tick;
      const px = texPx();
      if (f.px < px * 0.92 && f.req !== px) { f.req = px; jobs.set(id, prio); pump(); }
      else if (jobs.has(id)) jobs.set(id, Math.min(jobs.get(id), prio));
    }
    async function pump() {
      if (working || !jobs.size || !book) return;
      working = true;
      const [id] = [...jobs].sort((a, b) => a[1] - b[1])[0], f = faces.get(id), tk = token, px = f ? f.req : 0;
      jobs.delete(id);
      if (!f) { working = false; return pump(); }
      try {
        const board = id[0] !== 'p';
        let h = board ? px * (1 + 2 * OV) : px, w = board ? px * (W + OV) : px * W;
        const k = Math.min(1, MAXTEX / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(2, Math.round(w * k)); c.height = Math.max(2, Math.round(h * k));
        const g = c.getContext('2d');
        if (board) Covers.draw(g, c.width, c.height, id, info); else await book.draw(+id.slice(1), g, c.width, c.height);
        if (tk === token && !dead) {
          if (f.tex) gl.deleteTexture(f.tex);
          f.tex = upload(c); f.px = px;
          if (faces.size > 18) { // solta as páginas que ficaram para trás
            const keep = new Set(needed().map(n => n[0]));
            for (const [k2, v] of [...faces].sort((a, b) => a[1].used - b[1].used)) { if (faces.size <= 14) break; if (!keep.has(k2) && k2[0] === 'p') { if (v.tex) gl.deleteTexture(v.tex); faces.delete(k2); jobs.delete(k2); } }
          }
          invalidate();
        }
      } catch (e) { console.error('Página não desenhada', id, e); f.px = px; }
      working = false;
      pump();
    }
    function dropFaces(only) {
      for (const [k, f] of faces) if (!only || only(k)) { if (f.tex) gl.deleteTexture(f.tex); faces.delete(k); jobs.delete(k); }
    }

    /* ---------- folhas ---------- */
    function build() {
      leaves = [{ f: 'cover', b: 'endF', rigid: true }];
      if (mode === 'double') for (let i = 0; i < book.n; i += 2) leaves.push({ f: 'p' + i, b: i + 1 < book.n ? 'p' + (i + 1) : 'blank' });
      else for (let i = 0; i < book.n; i++) leaves.push({ f: 'p' + i, b: 'blank', ghost: true });
      leaves.push({ f: 'endB', b: 'back', rigid: true });
      T = leaves.length; maxPos = mode === 'double' ? T : T - 1;
    }
    const posOf = page => page < 0 ? 0 : clamp(mode === 'double' ? 1 + Math.ceil(page / 2) : page + 1, 0, maxPos);
    function state() {
      const p = flip && flip.state !== 'peek' ? flip.to : pos, n = book.n;
      if (mode !== 'double') return { n, mode, closed: p === 0, page: p === 0 ? -1 : clamp(p - 1, 0, n - 1), left: -1, right: clamp(p - 1, 0, n - 1) };
      const r = 2 * (p - 1), l = r - 1;
      return { n, mode, closed: p === 0 || p === T, page: p === 0 ? -1 : clamp(r, 0, n - 1), left: l >= 0 && l < n && p < T ? l : -1, right: r >= 0 && r < n ? r : -1 };
    }
    const restX = p => mode !== 'double' ? (W + OV) / 2 : p === 0 ? (W + OV) / 2 : p === T ? -(W + OV) / 2 : 0;
    const lw = f => f.rigid ? W + OV : W, lh = f => f.rigid ? 0.5 + OV : 0.5;
    const prog01 = f => clamp((lw(f) - f.P.x) / (2 * lw(f)), 0, 1);

    function needed() {
      const out = [], add = (i, side, prio) => { const l = leaves[i]; if (l) out.push([l[side], prio]); };
      add(pos - 1, 'b', 0); add(pos, 'f', 0);
      if (flip) { out.push([flip.front, 0], [flip.back, 0]); add(flip.to - 1, 'b', 0); add(flip.to, 'f', 0); }
      add(pos, 'b', 1); add(pos + 1, 'f', 1); add(pos - 1, 'f', 2); add(pos - 2, 'b', 2);
      return out;
    }

    /* ---------- virar ---------- */
    function begin(to, o) {
      to = clamp(to, 0, maxPos);
      if (flip || to === pos) return false;
      const dir = to > pos ? 1 : -1, a = leaves[dir > 0 ? pos : pos - 1], z = leaves[dir > 0 ? to - 1 : to];
      const corner = o.corner || (lastCorner = -lastCorner);
      flip = { dir, from: pos, to, rigid: !!a.rigid, ghost: a.ghost ? 0.1 : 0, front: dir > 0 ? a.f : a.b, back: dir > 0 ? z.b : z.f, corner, state: o.state, t: 0, dur: o.dur || 760, goal: 1 };
      flip.P = { x: lw(flip), y: corner * lh(flip) }; flip.T = { ...flip.P };
      if (o.state === 'auto' && cb.onFlip) cb.onFlip(flip.rigid);
      invalidate();
      return true;
    }
    function go(to, fast) {
      to = clamp(to, 0, maxPos);
      if (flip && flip.state === 'peek') flip = null;
      if (flip) { queue = [to]; if (flip.state === 'auto') flip.dur = Math.min(flip.dur, 300); return; }
      if (to === pos) return;
      let first = to;
      if (Math.abs(to - pos) > 1) first = pos === 0 ? 1 : pos === T ? T - 1 : to === 0 ? 1 : to === T ? T - 1 : to;
      queue = first === to ? [] : [to];
      begin(first, { state: 'auto', dur: fast ? 420 : Math.abs(to - pos) > 1 ? 620 : 780 });
      if (cb.onPage) cb.onPage(state());
    }
    function finish(done) {
      const f = flip;
      flip = null;
      if (done && f.state !== 'peek') { pos = f.to; if (cb.onLand) cb.onLand(f.rigid); }
      if (queue.length) { const n = queue.shift(); if (n !== pos) begin(n, { state: 'auto', dur: 420 }); }
      if (cb.onPage) cb.onPage(state());
    }
    function step(dt) {
      const f = flip, w = lw(f), cy = f.corner * lh(f);
      if (f.state === 'auto') {
        f.t = Math.min(1, f.t + dt * 1000 / f.dur);
        const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
        f.P.x = w * Math.cos(Math.PI * e); f.P.y = cy - f.corner * Math.min(w * 0.36, 0.42) * Math.sin(Math.PI * e);
        if (f.t >= 1) finish(true);
        return true;
      }
      const k = 1 - Math.exp(-dt * (f.state === 'drag' ? 26 : 10)), dx = f.T.x - f.P.x, dy = f.T.y - f.P.y;
      f.P.x += dx * k; f.P.y += dy * k;
      const rest = Math.hypot(dx, dy) < 0.004;
      if (f.state === 'settle' && rest) finish(f.goal);
      return !rest || f.state === 'settle';
    }
    /* Geometria da dobra: o canto da folha vai de C até P; a folha enrola num cilindro cujo eixo
       nunca passa da lombada (a folha está costurada ali). */
    function fold(f) {
      const w = lw(f), h2 = lh(f), cy = f.corner * h2, p = { x: f.P.x, y: f.P.y };
      let dx = p.x, dy = p.y - cy, l = Math.hypot(dx, dy);
      if (l > w) { p.x = dx / l * w; p.y = cy + dy / l * w; }
      const diag = Math.hypot(w, 2 * h2);
      dx = p.x; dy = p.y + cy; l = Math.hypot(dx, dy);
      if (l > diag) { p.x = dx / l * diag; p.y = -cy + dy / l * diag; }
      const vx = w - p.x, vy = cy - p.y, L = Math.hypot(vx, vy);
      if (L < 1e-4) return { ax: w * 3, ay: 0, nx: 1, ny: 0, r: 0.01, theta: 0 };
      const nx = vx / L, ny = vy / L, pr = clamp((w - p.x) / (2 * w), 0, 1);
      const r = Math.max(0.0015, Math.min(w * 0.135, L / Math.PI, w * 0.75 * (1 - pr)));
      let A = (L - Math.PI * r) / 2;
      const ds = Math.max(-p.x * nx + (h2 - p.y) * ny, -p.x * nx + (-h2 - p.y) * ny) - A;
      if (ds > 0) A += ds;
      return { ax: p.x + nx * A, ay: p.y + ny * A, nx, ny, r, theta: Math.acos(clamp(p.x / w, -1, 1)) };
    }

    /* ---------- desenho ---------- */
    function quad(kind, x, y, w, h, o = {}) {
      set('uKind', kind); set('uRect', x, y, w, h);
      set('uMode', o.mode || 0); set('uDir', o.dir || 1); set('uShadow', o.shadow ? 1 : 0);
      set('uColor', ...(o.color || [0, 0, 0, 1]));
      set('uFlipF', o.flipF || 0); set('uFlipB', o.flipB || 0); set('uGutter', o.gutter || 0); set('uSpineU', o.spineU || 0); set('uGhost', o.ghost || 0); set('uGhostF', o.ghostF || 0);
      if (o.fold) { set('uAxis', o.fold.ax, o.fold.ay); set('uN', o.fold.nx, o.fold.ny); set('uR', o.fold.r); set('uTheta', o.fold.theta); }
      if (kind === 0) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, o.b || o.f);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, o.f);
      }
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    }
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    function side(sign, cnt, top, rigid) {
      if (cnt < 0.5) return;
      const bw = W + OV, bh = 0.5 + OV, cloth = rgb(Covers.colorOf(info.id)).map(v => v * 0.8);
      quad(1, sign > 0 ? 0 : -bw, -bh, bw, 2 * bh, { color: [...cloth, 1] });
      if (rigid) { quad(0, sign > 0 ? 0 : -bw, -bh, bw, 2 * bh, { f: tex(top), spineU: sign > 0 ? 0 : 1 }); return; }
      const t = Math.min(OV * 0.74, 0.0035 + (cnt - 1) * OV * 0.74 / Math.max(30, T - 2)), lines = clamp(Math.round((cnt - 1) * 1.2), 3, 30), paper = book.kind === 'flow' ? [0.93, 0.9, 0.82] : [0.93, 0.92, 0.89];
      quad(2, sign > 0 ? W : -W - t, -0.5, t, 1, { color: [...paper, lines], spineU: sign > 0 ? 0 : 1 });
      quad(2, sign > 0 ? 0 : -W - t, -0.5 - t * 0.55, W + t, t * 0.55, { color: [...paper, Math.max(2, lines * 0.55)], flipF: 1 });
      quad(0, sign > 0 ? 0 : -W, -0.5, W, 1, { f: tex(top), gutter: 1, spineU: sign > 0 ? 0 : 1 });
    }
    function draw(now) {
      raf = 0;
      if (dead || !book) return;
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      let busy = false;
      if (flip) busy = step(dt);
      if (tween) {
        const k = clamp((now - tween.t0) / 240, 0, 1), e = 1 - Math.pow(1 - k, 3), z = tween.z0 + (tween.z1 - tween.z0) * e;
        panX = tween.ax - (tween.ax - tween.px) * z / tween.z0; panY = tween.ay - (tween.ay - tween.py) * z / tween.z0; zoom = z;
        if (tween.z1 <= 1.001) { panX *= 1 - e; panY *= 1 - e; }
        clampPan();
        if (k >= 1) { tween = null; settleZoom(); } else busy = true;
      }
      const f = flip, s = f ? prog01(f) : 0, e = s * s * (3 - 2 * s);
      const camX = f && f.state !== 'peek' ? restX(f.from) + (restX(f.to) - restX(f.from)) * e : restX(pos);
      for (const [id, prio] of needed()) want(id, prio);

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      set('uCam', camX, camY); set('uPPU', 2 * ppu / cw, 2 * ppu / ch); set('uPan', 2 * panX / cw, 2 * panY / ch); set('uZoom', zoom); set('uCamH', CAM_H);
      set('uLight', ...LIGHT); set('uGrain', W * 620, 620); set('uR', 0.01); set('uTheta', 0); set('uAxis', 99, 0); set('uN', 1, 0);

      // o que está parado: de cada lado, a capa de baixo, o corte das folhas e a página de cima
      const moving = !!f;
      const cntL = moving ? (f.dir > 0 ? f.from : f.to) : pos, cntR = moving ? (f.dir > 0 ? T - f.to : T - f.from) : T - pos;
      const thL = moving ? f.from + (f.to - f.from) * s - (f.dir < 0 ? 1 : 0) : pos, thR = moving ? T - (f.from + (f.to - f.from) * s) - (f.dir > 0 ? 1 : 0) : T - pos;
      const topL = leaves[cntL - 1], topR = leaves[T - cntR];
      const xl = cntL > 0 || (moving && s > 0.5) ? -(W + OV) : 0, xr = cntR > 0 || (moving && s < 0.5) ? W + OV : 0, m = 0.11;
      if (xr > xl) quad(3, xl - m + 0.015, -0.5 - OV - m - 0.02, xr - xl + 2 * m, 1 + 2 * OV + 2 * m, { color: [1 - 2.3 * m / (xr - xl + 2 * m), 1 - 2.3 * m / (1 + 2 * OV + 2 * m), 0, 0.5] });
      if (topL) side(-1, Math.max(1, thL), topL.b, topL.rigid);
      if (topR) side(1, Math.max(1, thR), topR.f, topR.rigid);
      if (f) {
        const w = lw(f), h2 = lh(f), o = { mode: f.rigid ? 2 : 1, dir: f.dir, fold: fold(f), f: tex(f.front), b: tex(f.back), flipF: f.dir > 0 ? 0 : 1, flipB: f.dir > 0 ? 1 : 0, gutter: f.rigid ? 0 : 1, ghost: f.dir > 0 ? f.ghost : 0, ghostF: f.dir < 0 ? f.ghost : 0 };
        quad(4, 0, -h2, w, 2 * h2, { ...o, shadow: true, color: [0, 0, 0, 0.42] });
        gl.enable(gl.DEPTH_TEST);
        quad(0, 0, -h2, w, 2 * h2, o);
      }
      if (busy) invalidate();
    }
    function invalidate() { if (!raf && !dead) raf = requestAnimationFrame(draw); }

    /* ---------- tamanho, zoom e câmera ---------- */
    function resize() {
      const r = canvas.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      cw = r.width; ch = r.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (!book) return;
      const aw = cw - 20, ah = ch - pad.t - pad.b, bw = W + OV, bh = 1 + 2 * OV;
      const pd = Math.min(aw / (2 * bw * 1.03), ah / (bh * 1.03)), ps = Math.min(aw / (bw * 1.04), ah / (bh * 1.03));
      const m = ps > pd * 1.4 ? 'single' : 'double';
      ppu = Math.max(20, m === 'single' ? ps : pd);
      camY = (pad.t - pad.b) / 2 / ppu;
      if (m !== mode) {
        const page = mode ? state().page : null;
        mode = m; flip = null; queue = [];
        build();
        if (page != null) pos = posOf(page);
      }
      clampPan();
      invalidate();
      if (cb.onPage) cb.onPage(state());
    }
    function clampPan() {
      const mx = Math.max(0, (mode === 'double' ? W + OV : (W + OV) / 2) * ppu * zoom - cw / 2 + 40), my = Math.max(0, (0.5 + OV) * ppu * zoom - ch / 2 + 80);
      panX = clamp(panX, -mx, mx); panY = clamp(panY, -my, my);
      if (zoom <= 1.001) panX = panY = 0;
    }
    const settleZoom = debounce(() => { texZoom = zoom; invalidate(); if (cb.onZoom) cb.onZoom(zoom); }, 260);
    // sx, sy: ponto da tela (px a partir do centro, y para cima) que fica parado enquanto o zoom muda
    function zoomAt(z, sx, sy) {
      z = clamp(z, 1, 5);
      panX = sx - (sx - panX) * z / zoom; panY = sy - (sy - panY) * z / zoom; zoom = z;
      clampPan(); settleZoom(); invalidate();
    }
    function zoomTo(z, sx = 0, sy = 0) { tween = { z0: zoom, z1: clamp(z, 1, 5), ax: sx, ay: sy, px: panX, py: panY, t0: performance.now() }; invalidate(); }
    const screen = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left - cw / 2, y: ch / 2 - (e.clientY - r.top) }; };
    const toBook = e => { const s = screen(e); return { x: (s.x - panX) / (ppu * zoom) + restX(pos), y: (s.y - panY) / (ppu * zoom) + camY }; };

    /* ---------- mão: arrastar, tocar, pinçar ---------- */
    const pts = new Map();
    let gest = null, lastTap = 0, wheelAcc = 0, wheelAt = 0;
    const local = (p, dir) => ({ x: dir * p.x, y: p.y });
    function dragTarget(f, p) {
      const w = lw(f), q = local(p, f.dir);
      f.T.x = w - (f.grab.x - q.x) * w / Math.max(f.grab.x, w * 0.3);
      f.T.y = f.corner * lh(f) + (q.y - f.grab.y);
    }
    function grab(dir, p) {
      if (flip && flip.state === 'peek' && flip.dir !== dir) flip = null;
      if (!flip && !begin(pos + dir, { state: 'drag', corner: p.y >= 0 ? 1 : -1 })) return false;
      flip.state = 'drag'; flip.grab = local(p, dir);
      return true;
    }
    function cornerAt(p) { // canto do livro sob o mouse: [direção, canto] ou null
      const zx = 0.17, zy = 0.17, ay = Math.abs(p.y);
      if (ay < 0.5 - zy || ay > 0.5 + OV) return null;
      if (p.x > W - zx && p.x < W + OV && pos < maxPos) return [1, p.y > 0 ? 1 : -1];
      if (mode === 'double' && p.x < -W + zx && p.x > -W - OV && pos > 0) return [-1, p.y > 0 ? 1 : -1];
      return null;
    }
    canvas.addEventListener('pointerdown', e => {
      if (!book || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.isPrimary) pts.clear(); // um toque novo descarta dedos que ficaram sem o aviso de soltar
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { }
      pts.set(e.pointerId, screen(e));
      if (pts.size === 2) {
        if (flip && flip.state === 'drag') { flip.state = 'settle'; flip.goal = 0; flip.T = { x: lw(flip), y: flip.corner * lh(flip) }; }
        const [a, b] = [...pts.values()];
        gest = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: zoom };
        return;
      }
      gest = { type: zoom > 1.02 ? 'pan' : 'tap', s0: screen(e), p0: toBook(e), t0: performance.now(), px: panX, py: panY, moved: false, vx: 0 };
      if (gest.type === 'tap' && flip && flip.state === 'peek') { gest.type = 'drag'; grab(flip.dir, gest.p0); }
    });
    canvas.addEventListener('pointermove', e => {
      if (!book) return;
      const s = screen(e);
      if (!pts.has(e.pointerId)) { // mouse solto passando: levanta o canto
        if (e.pointerType !== 'mouse' || zoom > 1.02 || (flip && flip.state !== 'peek')) return;
        const c = cornerAt(toBook(e));
        if (c && (!flip || flip.dir !== c[0] || flip.corner !== c[1])) { flip = null; begin(pos + c[0], { state: 'peek', corner: c[1] }); }
        if (flip) {
          if (c) { const w = lw(flip); flip.T = { x: w - (flip.rigid ? 0.012 : 0.085), y: flip.corner * (lh(flip) - (flip.rigid ? 0 : 0.07)) }; }
          else { flip.state = 'settle'; flip.goal = 0; flip.T = { x: lw(flip), y: flip.corner * lh(flip) }; }
          invalidate();
        }
        return;
      }
      pts.set(e.pointerId, s);
      if (!gest) return;
      if (gest.type === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        zoomAt(gest.z0 * Math.hypot(a.x - b.x, a.y - b.y) / gest.d0, (a.x + b.x) / 2, (a.y + b.y) / 2);
        return;
      }
      const dx = s.x - gest.s0.x, dy = s.y - gest.s0.y;
      if (!gest.moved && Math.hypot(dx, dy) > 7) gest.moved = true;
      if (gest.type === 'pan') { panX = gest.px + dx; panY = gest.py + dy; clampPan(); invalidate(); }
      else if (gest.type === 'tap' && gest.moved && Math.abs(dx) > Math.abs(dy) * 0.6) {
        const dir = mode === 'double' ? (gest.p0.x >= 0 ? 1 : -1) : dx < 0 ? 1 : -1;
        if (flip && flip.state !== 'peek') return;
        if (grab(dir, gest.p0)) gest.type = 'drag';
      }
      if (gest.type === 'drag' && flip && flip.state === 'drag') {
        const now = performance.now(), p = toBook(e), q = local(p, flip.dir);
        if (gest.lq) gest.vx = (q.x - gest.lq.x) / Math.max(1, now - gest.lt) * 1000;
        gest.lq = q; gest.lt = now;
        dragTarget(flip, p);
        invalidate();
      }
    });
    function release(e) {
      if (!pts.delete(e.pointerId) || !gest) return;
      const g = gest;
      if (g.type === 'pinch') { if (!pts.size) gest = null; if (zoom < 1.04) zoomTo(1); return; }
      gest = null;
      if (g.type === 'drag' && flip && flip.state === 'drag') {
        const f = flip, s = prog01(f), goOn = e.type !== 'pointercancel' && (s > 0.3 || (g.vx < -1.1 && s > 0.04));
        f.state = 'settle'; f.goal = goOn ? 1 : 0;
        f.T = { x: goOn ? -lw(f) : lw(f), y: f.corner * lh(f) };
        if (goOn && cb.onFlip) cb.onFlip(f.rigid);
        if (goOn && cb.onPage) cb.onPage(state());
        invalidate();
        return;
      }
      if (g.moved || e.type === 'pointercancel' || performance.now() - g.t0 > 450) return;
      // toque: perto das bordas de fora vira a folha; no meio, dois toques aproximam
      const now = performance.now(), fx = (g.s0.x + cw / 2) / cw, dbl = now - lastTap < 320;
      lastTap = now;
      if (zoom > 1.02) { if (dbl) { zoomTo(1); lastTap = 0; } return; }
      if (mode === 'double' && (pos === 0 || pos === T) && !flip) go(pos === 0 ? 1 : T - 1);
      else if (fx > 0.7) go((flip && flip.state !== 'peek' ? flip.to : pos) + 1);
      else if (fx < 0.3) go((flip && flip.state !== 'peek' ? flip.to : pos) - 1);
      else if (dbl) { zoomTo(2.3, g.s0.x, g.s0.y); lastTap = 0; if (cb.onTap) cb.onTap(true); }
      else if (cb.onTap) cb.onTap(false);
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', e => { if (flip && flip.state === 'peek' && !pts.size) { flip.state = 'settle'; flip.goal = 0; flip.T = { x: lw(flip), y: flip.corner * lh(flip) }; invalidate(); } });
    canvas.addEventListener('wheel', e => {
      if (!book) return;
      e.preventDefault();
      const s = screen(e), now = performance.now();
      if (e.ctrlKey || e.metaKey) return zoomAt(zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.08 : 0.012)), s.x, s.y);
      if (zoom > 1.02) { panX -= e.deltaX; panY += e.deltaY; clampPan(); invalidate(); return; }
      if (now - wheelAt > 400) wheelAcc = 0;
      wheelAcc += (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * (e.deltaMode ? 40 : 1);
      if (Math.abs(wheelAcc) >= 50 && now - wheelAt > 230) { wheelAt = now; turn(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; }
    }, { passive: false });
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (cb.onLost) cb.onLost(); });

    function turn(d) { go((flip && flip.state !== 'peek' ? flip.to : pos) + d); }

    const api = {
      open(b, o = {}) {
        token++; dropFaces(); jobs.clear();
        book = b; info = o.cover; W = clamp(b.aspect, 0.3, 3); mode = ''; pos = 0; flip = null; queue = []; zoom = texZoom = 1; panX = panY = 0; tween = null;
        if (blank) gl.deleteTexture(blank);
        blank = solid(b.kind === 'flow' ? Flow.PAPER : '#ffffff');
        resize();
        pos = posOf(o.page == null ? -1 : o.page);
        invalidate();
        if (cb.onPage) cb.onPage(state());
      },
      /* o livro foi repaginado (mudou o tamanho da letra): redesenha tudo mantendo o ponto da leitura */
      refresh(page) { token++; dropFaces(k => k[0] === 'p'); flip = null; queue = []; build(); pos = posOf(page); invalidate(); if (cb.onPage) cb.onPage(state()); },
      recover() { token++; dropFaces(); invalidate(); },
      close() { token++; dropFaces(); jobs.clear(); book = null; flip = null; if (raf) cancelAnimationFrame(raf); raf = 0; gl.clear(gl.COLOR_BUFFER_BIT); },
      next: () => turn(1), prev: () => turn(-1),
      first: () => go(0), last: () => go(maxPos),
      goPage: (n, fast) => go(posOf(n), fast),
      state: () => book ? state() : null,
      zoom: () => zoom,
      zoomTo, resize,
      setPad(t, b) { pad.t = t; pad.b = b; resize(); },
      invalidate,
    };
    return api;
  }
  return { create };
})();
