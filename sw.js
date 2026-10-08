/* Folhear — service worker da versão web: guarda o app para abrir sem internet. */
const VERSION = 'folhear-1.0.1-g1-e1';
const FILES = ['./', 'index.html', 'elo.js', 'gsync.js', 'app.css', 'store.js', 'zip.js', 'flow.js', 'formats.js', 'pptx.js', 'book3d.js', 'app.js', 'logo.svg', 'manifest.webmanifest',
  'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'fonts/literata-400.woff2', 'fonts/literata-400i.woff2', 'fonts/literata-700.woff2', 'fonts/literata-700i.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Rede primeiro (para receber atualizações), cópia guardada quando estiver sem internet.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});