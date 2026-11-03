const SHELL_CACHE = 'knotgpt-shell-v1';
const RUNTIME_CACHE = 'knotgpt-runtime-0.10.30';
const SHELL = ['./', './index.html', './chat.css', './app.js', './config.js', './model-storage.js', './chat-format.js', './inference-worker.js', './logo.svg', './manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('knotgpt-shell-') && key !== SHELL_CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  const runtime = url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@mediapipe/tasks-genai@0.10.30/');
  if (runtime) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') {
        const save = cache.put(event.request, response.clone()).catch(() => {});
        event.waitUntil(save);
        await save;
      }
      return response;
    })());
    return;
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  // Network-first shell permits GitHub Pages updates; offline visits use saved assets.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok && (SHELL.some(path => new URL(path, self.registration.scope).href === url.href))) {
        event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
      }
      return response;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const home = await cache.match(new URL('./index.html', self.registration.scope));
        if (home) return home;
      }
      throw error;
    }
  })());
});
