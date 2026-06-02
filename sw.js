const CACHE = 'sts-orders-v66';
const ASSETS = [
  './jewelry-workflow.html',
  './js/data.js',
  './js/app.js',
  './js/drive.js',
  './js/orders.js',
  './js/customers.js',
  './js/gmail.js',
  './js/sales.js',
  './js/production.js',
  './js/notes.js',
  './js/supplier-history.js',
  './js/clickup.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(ASSETS).catch(() => {}) // fail silently if offline at install
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Only handle same-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // These files must always be fresh — never serve from cache
  if (event.request.url.includes('gmail-brief.json')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('{}', {headers:{'Content-Type':'application/json'}}))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful GET responses
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('./jewelry-workflow.html'));
    })
  );
});
