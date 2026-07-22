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

const CACHE = 'sts-shell-v3';

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

  // NETWORK-FIRST: fetch the original request untouched. Do NOT reconstruct
  // navigation requests — a rebuilt Request loses the navigation's
  // redirect:'manual' mode, so a redirected navigation (e.g. Cloudflare's
  // 308 from /intake.html → /intake) yields a redirected response the browser
  // refuses to render, hanging the page. The original request preserves that.
  event.respondWith(
    fetch(req)
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
