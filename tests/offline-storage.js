// ════════════════════════════════════════════
//  OFFLINE / STORAGE SUITE  —  tests/offline-storage.js
//  Exercises the IndexedDB storage layer (js/storage.js), the service
//  worker's offline shell (sw.js), and the Notion offline write queue
//  (js/notion.js) end to end in headless Chromium.
//
//  Known limitation: tests/lib/server.js serves static files only — it
//  does not implement the Cloudflare Pages Functions under functions/api/.
//  So any /api/* request this suite triggers gets a plain 404, which the
//  app code treats as an "http-error" (server reachable, request
//  rejected) rather than a "network-error" (offline/DNS/aborted). Test 7
//  below relies on exactly that distinction: after coming back online,
//  the queued write hits the 404 and is correctly DROPPED instead of
//  retried forever — that's the behavior being verified, not a live sync
//  to real Notion.
//
//  Usage: node offline-storage.js
// ════════════════════════════════════════════
const { chromium } = require('playwright-core');
const { startServer } = require('./lib/server');

const CHROMIUM_PATH = require('./lib/chromium-path')();

async function run({ baseUrl } = {}) {
  let server = null;
  if (!baseUrl) { server = await startServer(); baseUrl = server.baseUrl; }

  const results = [];
  const check = (name, ok, detail) =>
    results.push({ ok, line: (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : '') });

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message.slice(0, 120)));

  try {
    // ── 1. Migration: seed a pre-IndexedDB localStorage payload, verify
    // it lands in IndexedDB and the old localStorage keys are cleared ──
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500); // let the async boot finish before seeding, else this races the migration
    await page.evaluate(async () => {
      localStorage.setItem('sts-orders', JSON.stringify([
        { id: 'u-test-1', name: 'Migration Test', stage: 'build', price: 100 },
      ]));
      localStorage.setItem('sts-hidden', JSON.stringify(['u-hidden-1']));
      const db = await _stsDb(); db.close(); // release the app's connection or deleteDatabase blocks forever
      await new Promise((res, rej) => {
        const req = indexedDB.deleteDatabase('sts-workflow');
        req.onsuccess = res; req.onerror = rej;
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const mig = await page.evaluate(async () => ({
      inOrders: ORDERS.some(o => o.id === 'u-test-1'),
      inIdb: ((await stsStoreGet('orders')) || []).some(o => o.id === 'u-test-1'),
      hiddenMigrated: ((await stsStoreGet('hidden')) || []).includes('u-hidden-1'),
      lsGone: localStorage.getItem('sts-orders') === null,
    }));
    check('migration localStorage -> IndexedDB', mig.inOrders && mig.inIdb && mig.lsGone && mig.hiddenMigrated, JSON.stringify(mig));

    // ── 2. Persistence: mutate, save, reload ──
    await page.evaluate(() => {
      ORDERS.push({ id: 'u-test-2', name: 'Persist Test', stage: 'kyle', price: 50 });
      saveToStorage();
    });
    await page.waitForTimeout(800); // debounce (250ms) + write
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const persisted = await page.evaluate(() => ORDERS.some(o => o.id === 'u-test-2'));
    check('IndexedDB persistence across reload', persisted);

    // ── 3. Flush on hide: a debounced save must land even if the tab is
    // backgrounded before its timer fires ──
    await page.evaluate(() => {
      ORDERS.push({ id: 'u-test-3', name: 'Flush Test', stage: 'build' });
      saveToStorage();  // schedules a debounced write
      _flushStorage();  // simulates the pagehide/visibilitychange handler firing immediately
    });
    await page.waitForTimeout(500);
    const flushed = await page.evaluate(async () => ((await stsStoreGet('orders')) || []).some(o => o.id === 'u-test-3'));
    check('flush-on-hide writes a pending debounced save', flushed);

    // ── 4. Service worker registers and caches the app shell ──
    await page.waitForTimeout(1500);
    const swReg = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg && !!(reg.active || reg.installing || reg.waiting);
    });
    check('service worker registers', swReg);

    // Reload once more so the SW actually controls the page and has had a
    // chance to cache everything fetched during that load.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const swCache = await page.evaluate(async () => {
      const cache = await caches.open('sts-shell-v1');
      const keys = (await cache.keys()).map(r => new URL(r.url).pathname);
      return {
        count: keys.length,
        hasShell: keys.includes('/jewelry-workflow.html'),
        hasCss: keys.some(k => k.startsWith('/css/')),
        hasJs: keys.some(k => k.startsWith('/js/')),
        controlled: !!navigator.serviceWorker.controller,
      };
    });
    check('shell + CSS + JS cached by the service worker', swCache.controlled && swCache.hasShell && swCache.hasCss && swCache.hasJs, JSON.stringify(swCache));

    // ── 5. Fully offline: shell loads from cache, orders load from
    // IndexedDB, tab switching still works ──
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const offline = await page.evaluate(() => ({
      hasOrders: typeof ORDERS !== 'undefined' && ORDERS.some(o => o.id === 'u-test-2'),
      tabsWork: (() => {
        try { switchTab('sales', null); return document.querySelector('.tab-panel.active').id === 'tab-sales'; }
        catch (e) { return false; }
      })(),
    }));
    check('app boots fully OFFLINE (shell + IndexedDB orders)', offline.hasOrders && offline.tabsWork, JSON.stringify(offline));

    // ── 6. A write attempted while offline queues instead of failing silently ──
    const queued = await page.evaluate(async () => {
      const o = ORDERS.find(x => x.id === 'u-test-2');
      o.notionId = 'fake-notion-id-123';
      const status = await notionUpdateStage(o.notionId, 'stevie');
      await new Promise(r => setTimeout(r, 300));
      const q = (await stsStoreGet('notion-retry')) || [];
      return { status, queuedLen: q.length };
    });
    check('offline write is queued (not lost)', queued.status === 'network-error' && queued.queuedLen === 1, JSON.stringify(queued));

    // Queue must survive a reload, not just live in memory
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const queuePersist = await page.evaluate(() => _notionRetry.size);
    check('queued write survives reload', queuePersist === 1, 'size=' + queuePersist);

    // ── 7. Back online: replay runs and the queue clears. See the file
    // header — this hits a real 404 (no /api/* locally), which the app
    // correctly treats as terminal and drops rather than retrying forever. ──
    await ctx.setOffline(false);
    const replay = await page.evaluate(async () => {
      await notionReplayQueue();
      const q = (await stsStoreGet('notion-retry')) || [];
      return { memSize: _notionRetry.size, idbLen: q.length };
    });
    check('replay on reconnect clears the queue (no infinite retry loop)', replay.memSize === 0 && replay.idbLen === 0, JSON.stringify(replay));

    // Leave IndexedDB clean for the next run
    await page.evaluate(async () => {
      const orders = ((await stsStoreGet('orders')) || []).filter(o => !String(o.id).startsWith('u-test'));
      await stsStoreSet('orders', orders);
    });

    const newErrors = pageErrors.filter(e => !e.includes("reading 'style'")); // pre-existing triplog.js boot error, unrelated to this suite
    check('no new JS errors during the suite', newErrors.length === 0, newErrors.join(' | '));

    return { pass: results.every(r => r.ok), lines: results.map(r => r.line) };
  } finally {
    await browser.close();
    if (server) server.stop();
  }
}

if (require.main === module) {
  run().then(({ pass, lines }) => {
    console.log(lines.join('\n'));
    process.exit(pass ? 0 : 1);
  }).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { run };
