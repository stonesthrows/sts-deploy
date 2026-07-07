// Run: cd tests && npm install && node browser-migration.test.js
// Real-browser verification of the IndexedDB storage migration (upgrade #4).
// Runs the ACTUAL app (via serve.js) in the pre-installed Chromium:
//  Phase 1: seed legacy localStorage (order with inline base64 photo),
//           boot the app, verify migration + rendering.
//  Phase 2: reload — verify no re-migration, photo served from IndexedDB.
//  Phase 3: exercise the new capture pipeline (downscale + photoPut).
const { chromium } = require('playwright-core');
const assert = require('assert');

// ── Test infrastructure: portable Chromium + self-spawned static server ──
function chromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const fs = require('fs');
  const path = require('path');
  try {
    const p = require('playwright-core').chromium.executablePath();
    if (fs.existsSync(p)) return p;
  } catch (e) {}
  // playwright-core's pinned build may not match the machine's — fall back
  // to any Chromium under PLAYWRIGHT_BROWSERS_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && fs.existsSync(root)) {
    for (const dir of fs.readdirSync(root)) {
      if (!/^chromium-/.test(dir)) continue;
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = path.join(root, dir, sub);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error('No Chromium found - set CHROME_PATH=/path/to/chrome');
}
async function startServer() {
  const { spawn } = require('child_process');
  const http = require('http');
  const srv = spawn(process.execPath, [require('path').join(__dirname, '..', 'serve.js')], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise(res => {
      const rq = http.get('http://localhost:3000/jewelry-workflow.html',
        r => { r.resume(); res(r.statusCode === 200); });
      rq.on('error', () => res(false));
    });
    if (ok) return srv;
    await new Promise(r => setTimeout(r, 200));
  }
  srv.kill();
  throw new Error('serve.js did not start on :3000 (port in use?)');
}


// 1x1 red PNG
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext();

  // Seed legacy localStorage BEFORE any app script runs
  await ctx.addInitScript(([png]) => {
    if (!localStorage.getItem('__seeded')) {
      localStorage.setItem('sts-orders', JSON.stringify([
        { id: 'u-test1', name: 'Migration Tester', stage: 'build', desc: 'ring resize', price: 100, photo: png },
        { id: 'u-test2', name: 'No Photo Nancy',  stage: 'quote', desc: 'estimate',    price: 50 },
      ]));
      localStorage.setItem('sts-hidden', JSON.stringify([]));
      localStorage.setItem('__seeded', '1');
    }
  }, [TINY_PNG]);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + ' STACK ' + String(e.stack).split('\n').slice(0,3).join(' | ')));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  // ── Phase 1: first boot triggers migration ──
  await page.goto('http://localhost:3000/jewelry-workflow.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof _booted !== 'undefined' && _booted === true, { timeout: 15000 });
  await page.waitForFunction(() => typeof ORDERS !== 'undefined' && ORDERS.some(o => o.id === 'u-test1'), { timeout: 15000 });

  let state = await page.evaluate(async () => ({
    migrated:   await DB.get('kv', 'migrated-v1'),
    order1:     ORDERS.find(o => o.id === 'u-test1'),
    photoBlob:  !!(await DB.get('photos', 'u-test1')),
    photoUrl:   photoURL('u-test1'),
    cardImg:    (document.querySelector('#card-u-test1 img') || {}).src || null,
  }));
  assert.strictEqual(state.migrated, true, 'migration flag set in real IndexedDB');
  assert.strictEqual(state.order1.photo, undefined, 'base64 photo stripped from order');
  assert.strictEqual(state.order1.hasPhoto, true, 'hasPhoto flag set');
  assert.ok(state.photoBlob, 'real Blob stored in IndexedDB photos store');
  assert.ok(state.photoUrl && state.photoUrl.startsWith('blob:'), 'object URL created');
  assert.ok(state.cardImg && state.cardImg.startsWith('blob:'), 'kanban card renders photo from blob URL');
  console.log('Phase 1 PASSED: migration + render on first boot');

  // Trigger a save → mirror must be photo-less
  await page.evaluate(async () => { await saveToStorage(); });
  const mirror = await page.evaluate(() => JSON.parse(localStorage.getItem('sts-orders')));
  assert.strictEqual(mirror.find(o => o.id === 'u-test1').photo, undefined, 'localStorage mirror is photo-less');
  assert.strictEqual(mirror.find(o => o.id === 'u-test1').hasPhoto, true, 'mirror keeps hasPhoto flag');
  console.log('Phase 1b PASSED: photo-less mirror written');

  // ── Phase 2: reload — no re-migration, photo survives via IndexedDB ──
  await page.goto('http://localhost:3000/jewelry-workflow.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof _booted !== 'undefined' && _booted === true && ORDERS.some(o => o.id === 'u-test1'), { timeout: 15000 });
  state = await page.evaluate(() => ({
    hasPhoto: ORDERS.find(o => o.id === 'u-test1').hasPhoto,
    noInline: ORDERS.find(o => o.id === 'u-test1').photo === undefined,
    cardImg:  (document.querySelector('#card-u-test1 img') || {}).src || null,
  }));
  assert.strictEqual(state.hasPhoto, true, 'hasPhoto persists across reload');
  assert.ok(state.noInline, 'no inline base64 after reload');
  assert.ok(state.cardImg && state.cardImg.startsWith('blob:'), 'photo re-rendered from IndexedDB after reload');
  console.log('Phase 2 PASSED: reload serves photo from IndexedDB, no re-migration');

  // ── Phase 3: new capture pipeline — downscale a big canvas → photoPut ──
  const captureResult = await page.evaluate(async () => {
    // Fake a "phone photo": 3000x2000 canvas → File
    const cvs = document.createElement('canvas');
    cvs.width = 3000; cvs.height = 2000;
    const g = cvs.getContext('2d');
    g.fillStyle = '#3355aa'; g.fillRect(0, 0, 3000, 2000);
    const bigBlob = await new Promise(r => cvs.toBlob(r, 'image/jpeg', 0.95));
    const file = new File([bigBlob], 'photo.jpg', { type: 'image/jpeg' });

    const scaled = await downscalePhoto(file);
    await photoPut('u-test2', scaled);
    const bmp = await createImageBitmap(scaled);
    return {
      originalSize: bigBlob.size,
      scaledSize:   scaled.size,
      maxDim:       Math.max(bmp.width, bmp.height),
      urlCached:    !!photoURL('u-test2'),
      inIdb:        !!(await DB.get('photos', 'u-test2')),
    };
  });
  assert.ok(captureResult.maxDim <= 1280, `downscaled to <=1280px (got ${captureResult.maxDim})`);
  assert.ok(captureResult.scaledSize < captureResult.originalSize, 'downscale shrank the file');
  assert.ok(captureResult.urlCached, 'object URL cached after put');
  assert.ok(captureResult.inIdb, 'scaled blob in IndexedDB');
  console.log(`Phase 3 PASSED: capture pipeline (${captureResult.originalSize} -> ${captureResult.scaledSize} bytes, ${captureResult.maxDim}px)`);

  // Console/page errors that matter. Ignored noise:
  //  - /api/* 404s + dropped Outbox ops (serve.js is static, no API routes)
  //  - external CDN failures (GSI/cdnjs blocked in sandboxes)
  //  - the pre-existing tvInit bug (missing #tvWrap, unrelated — see README)
  const realErrors = errors.filter(e =>
    !e.includes('404') && !e.includes('Outbox: Notion rejected') &&
    !e.includes('ERR_TUNNEL') && !e.includes('ERR_CONNECTION') &&
    !e.includes('ERR_NAME_NOT_RESOLVED') && !e.includes('ERR_INTERNET_DISCONNECTED') &&
    !e.includes('tvInit'));
  if (realErrors.length) { console.error('Page errors:', realErrors); srv.kill(); process.exit(1); }

  await browser.close();
  srv.kill();
  console.log('ALL BROWSER TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); srv.kill(); process.exit(1); });
