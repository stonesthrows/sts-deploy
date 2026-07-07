// Run: cd tests && npm install && node browser-render.test.js
// Real-browser verification of upgrade #5: keyed incremental Kanban render,
// event delegation, and output escaping.
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


(async () => {
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext();

  // Seed orders including a hostile name/desc to prove escaping works
  await ctx.addInitScript(() => {
    localStorage.setItem('sts-orders', JSON.stringify([
      { id: 'u-xss', name: '<img src=x onerror="window.__xss=1">O\'Brien', stage: 'build',
        desc: 'a "quoted" <script>window.__xss2=1</script> desc', price: 100 },
      { id: 'u-a', name: 'Alice', stage: 'build',  desc: 'ring', price: 50 },
      { id: 'u-b', name: 'Bob',   stage: 'quote',  desc: 'pendant', price: 75 },
      { id: 'u-c', name: 'Carol', stage: 'contact-need', desc: 'earrings', price: 25 },
    ]));
    localStorage.setItem('sts-hidden', JSON.stringify([]));
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + ' | ' + String(e.stack).split('\n')[1]));

  await page.goto('http://localhost:3000/jewelry-workflow.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof _booted !== 'undefined' && _booted === true &&
    typeof ORDERS !== 'undefined' && ORDERS.some(o => o.id === 'u-xss'), { timeout: 15000 });

  // ── 1. Escaping: hostile payloads render as text, never execute ──
  const xss = await page.evaluate(() => ({
    executed1: window.__xss === 1,
    executed2: window.__xss2 === 1,
    nameText:  document.querySelector('#card-u-xss .o-name').textContent,
    descText:  document.querySelector('#card-u-xss .o-desc').textContent,
    injectedImg: !!document.querySelector('#card-u-xss .o-name img'),
  }));
  assert.ok(!xss.executed1 && !xss.executed2, 'no injected script executed');
  assert.ok(!xss.injectedImg, 'no injected element created from order name');
  assert.ok(xss.nameText.includes(`O'Brien`) && xss.nameText.includes('<img'), 'hostile name rendered as literal text');
  assert.ok(xss.descText.includes('<script>'), 'hostile desc rendered as literal text');
  console.log('1 PASSED: escaping — hostile order data is inert text');

  // ── 2. Cache reuse: re-render keeps the same DOM node for unchanged cards ──
  const reuse = await page.evaluate(() => {
    const before = document.getElementById('card-u-a');
    before.__marker = 'kept';
    renderKanban();
    const after = document.getElementById('card-u-a');
    return { same: before === after, marker: after.__marker };
  });
  assert.ok(reuse.same && reuse.marker === 'kept', 'unchanged card element reused across renders');
  console.log('2 PASSED: keyed cache reuses unchanged card nodes');

  // ── 3. Changed card rebuilds; unchanged neighbors still reused ──
  const rebuild = await page.evaluate(() => {
    const a = document.getElementById('card-u-a'); a.__marker = 'a';
    const x = document.getElementById('card-u-xss'); x.__marker = 'x';
    ORDERS.find(o => o.id === 'u-a').desc = 'ring RESIZED';
    renderKanban();
    return {
      aRebuilt: document.getElementById('card-u-a').__marker !== 'a',
      aText:    document.getElementById('card-u-a').querySelector('.o-desc').textContent,
      xKept:    document.getElementById('card-u-xss').__marker === 'x',
    };
  });
  assert.ok(rebuild.aRebuilt, 'edited card was rebuilt');
  assert.strictEqual(rebuild.aText, 'ring RESIZED', 'rebuilt card shows new content');
  assert.ok(rebuild.xKept, 'untouched card still reused');
  console.log('3 PASSED: only changed cards rebuild');

  // ── 4. Counts + alert dot ──
  const counts = await page.evaluate(() => {
    const bodyOf = s => document.querySelector(`.k-body[data-stage-id="${s}"]`);
    const colOf  = s => bodyOf(s).closest('.k-col');
    const subOf  = s => bodyOf(s).closest('.k-sub-wrap');
    const dot    = colOf('contact-need').querySelector('.k-alert-dot');
    return {
      benchSub:    subOf('build').querySelector('.k-sub-count').textContent,
      benchCards:  bodyOf('build').querySelectorAll('.o-card').length,
      quoteSub:    subOf('quote').querySelector('.k-sub-count').textContent,
      contactCol:  colOf('contact-need').querySelector('.k-count').textContent,
      dotShown:    dot.style.display !== 'none',
      dotCount:    dot.textContent,
      emptyHasDrop: bodyOf('sketch-needs').textContent.trim() === 'Drop here',
    };
  });
  assert.strictEqual(counts.benchSub, '2', 'bench sub-count = 2 (u-xss + u-a)');
  assert.strictEqual(counts.benchCards, 2, 'bench body has 2 cards');
  assert.strictEqual(counts.quoteSub, '1', 'quote sub-count = 1');
  assert.strictEqual(counts.contactCol, '1', 'contact column count = 1');
  assert.ok(counts.dotShown && counts.dotCount === '1', 'contact alert dot shows 1');
  assert.ok(counts.emptyHasDrop, 'empty stage shows Drop here placeholder');
  console.log('4 PASSED: counts, alert dot, empty placeholders');

  // ── 5. Delegation: chevron toggles, camera targets right order, card opens form ──
  // Dispatch real bubbling clicks (board columns scroll horizontally, so
  // some cards sit outside Playwright's visibility window — the delegation
  // path is identical either way).
  const clickIn = sel => page.evaluate(s =>
    document.querySelector(s).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), sel);

  await clickIn('#card-u-a [data-action="toggle"]');
  let collapsed = await page.evaluate(() => document.getElementById('card-u-a').classList.contains('collapsed'));
  const wasCollapsed = collapsed;
  await clickIn('#card-u-a [data-action="toggle"]');
  collapsed = await page.evaluate(() => document.getElementById('card-u-a').classList.contains('collapsed'));
  assert.ok(collapsed !== wasCollapsed, 'chevron toggle flips collapsed state both ways');

  await clickIn('#card-u-b [data-action="camera"]');
  const camTarget = await page.evaluate(() => currentPhotoOrderId);
  assert.strictEqual(camTarget, 'u-b', 'camera button targets its own order (delegated data-id)');

  await clickIn('#card-u-xss .o-name');   // click on card (not a button) → opens order form
  const editingId = await page.evaluate(() => document.getElementById('f-editing-id').value);
  assert.strictEqual(editingId, 'u-xss', 'card click opens the order in the edit form via delegation');
  console.log('5 PASSED: delegated actions route to the right order');

  // ── 6. applyStageChange moves the card between bodies incrementally ──
  const move = await page.evaluate(() => {
    const o = ORDERS.find(x => x.id === 'u-b');
    applyStageChange(o, 'materials');
    return {
      inNew: !!document.querySelector('.k-body[data-stage-id="materials"] #card-u-b'),
      inOld: !!document.querySelector('.k-body[data-stage-id="quote"] #card-u-b'),
      newSub: document.querySelector('.k-body[data-stage-id="materials"]').closest('.k-sub-wrap').querySelector('.k-sub-count').textContent,
    };
  });
  assert.ok(move.inNew && !move.inOld, 'card moved to the new stage body');
  assert.strictEqual(move.newSub, '1', 'destination sub-count updated');
  console.log('6 PASSED: stage change re-homes the card and updates counts');

  // ── 7. Scroll positions survive a render (the point of the shell design) ──
  const scroll = await page.evaluate(() => {
    switchTab('dashboard');   // test 5's card click navigated to the order form; a hidden board can't scroll
    const board = document.getElementById('kanbanBoard');
    board.scrollLeft = 120;
    const applied = board.scrollLeft;   // CSS scroll-snap may clamp the target
    renderKanban();
    return { applied, left: board.scrollLeft, built: board.dataset.built };
  });
  assert.ok(scroll.applied > 0, 'board actually scrolled before the render');
  assert.strictEqual(scroll.left, scroll.applied, 'board horizontal scroll preserved across a render');
  assert.strictEqual(scroll.built, '1', 'shell built exactly once');
  console.log('7 PASSED: scroll survives renders');

  // Ignored noise: /api/* 404s, dropped Outbox ops (static server), external
  // CDN failures in sandboxes, and the pre-existing tvInit bug (see README).
  const realErrors = errors.filter(e =>
    !e.includes('404') && !e.includes('Outbox: Notion rejected') &&
    !e.includes('ERR_TUNNEL') && !e.includes('ERR_CONNECTION') &&
    !e.includes('ERR_NAME_NOT_RESOLVED') && !e.includes('ERR_INTERNET_DISCONNECTED') &&
    !e.includes('tvInit'));
  if (realErrors.length) { console.error('Page errors:', realErrors); srv.kill(); process.exit(1); }

  await browser.close();
  srv.kill();
  console.log('ALL RENDER/DELEGATION/ESCAPING TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); srv.kill(); process.exit(1); });
