// ════════════════════════════════════════════
//  SERVICE WORKER  —  offline shell for the STS workflow app
//
//  Strategy: NETWORK-FIRST for every same-origin GET except /api/*.
//  While online the SW never serves stale content — every request goes
//  to the network and the cache is just refreshed in passing (this is
//  deliberate: an earlier cache-first SW caused the "hard refresh after
//  every deploy" pain and was killed). Offline, requests fall back to
//  the last-cached copy, so the app shell + CSS/JS keep working at
//  markets with no signal. Orders live in IndexedDB, writes queue in
//  js/notion.js — this file only makes the shell itself loadable.
//
//  /api/* is never intercepted or cached: responses are private and
//  the offline write queue handles API failures at the app layer.
// ════════════════════════════════════════════

const CACHE = 'sts-shell-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;        // CDNs etc. — browser default
  if (url.pathname.startsWith('/api/')) return;      // never cache API responses

  // Page navigations (the HTML shell) have stable URLs — unlike CSS/JS, which
  // carry ?v= cache-busters — so the browser's HTTP disk cache can shadow a
  // fresh deploy even though we're network-first. Fetch navigations with
  // cache:'no-store' so every online page load gets the newest shell.
  const netReq = (req.mode === 'navigate')
    ? new Request(req.url, { cache: 'no-store', credentials: 'same-origin' })
    : req;

  event.respondWith(
    fetch(netReq)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Offline navigation to an uncached URL → serve the app shell
        if (req.mode === 'navigate') {
          const shell = await caches.match('/jewelry-workflow.html')
                     || await caches.match('/jewelry-workflow');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
