const CACHE = 'sts-orders-v66';

// Files that must always be fresh — network first, cache as fallback
const NETWORK_FIRST = [
  'jewelry-workflow.html',
  '/js/data.js',
  '/js/app.js',
  '/js/drive.js',
  '/js/orders.js',
  '/js/customers.js',
  '/js/gmail.js',
  '/js/sales.js',
  '/js/production.js',
  '/js/notes.js',
  '/js/supplier-history.js',
  '/js/clickup.js',
  '/js/triplog.js',
];

function isNetworkFirst(url) {
  return NETWORK_FIRST.some(p => url.includes(p)) || url.includes('gmail-brief.json');
}

self.addEventListener('install', event => {
  self.skipWaiting();
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
  if (!event.request.url.startsWith(self.location.origin)) return;

  if (isNetworkFirst(event.request.url)) {
    // Network first: always try to get the latest, fall back to cache if offline
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache first for everything else (icons, manifest, etc.)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('./jewelry-workflow.html'));
    })
  );
});
