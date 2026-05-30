const CACHE_NAME = 'mandarin-sentence-offline-v4';
const APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'offline-assets.json',
  'static/styles.css?v=20260530-4',
  'static/app.js?v=20260530-4',
  'data/levels.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('mandarin-sentence-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const url = new URL(request.url);
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
      .catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('index.html');
        }
        return Response.error();
      })
  );
});
