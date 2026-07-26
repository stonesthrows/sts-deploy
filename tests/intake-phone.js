// ════════════════════════════════════════════
//  CUSTOMER PHONE HANDOFF SUITE  —  tests/intake-phone.js
//  Drives both halves of the QR photo handoff in headless Chromium:
//    · the studio side (js/intake-phone.js in intake.html) — mint a
//      session, render the QR, poll, and pull each new photo into the
//      Reference Photos gallery exactly once
//    · the customer side (phone-upload.html) — pick a photo, downscale
//      it, PUT it, and finish
//
//  /api/phone-upload is intercepted and answered by an in-memory stand-in
//  (makeApi below) that mirrors the real Function's contract: slots are
//  assigned by the server, the token is the capability, a dead token is a
//  404. lib/server.js serves static files only, so a real Function could
//  not run here even if we wanted it to (see tests/README.md) — what's
//  under test is the client wiring on both ends, not KV/R2.
//
//  Usage: node intake-phone.js   (or via run.js with the others)
// ════════════════════════════════════════════
const { chromium } = require('playwright-core');
const { startServer } = require('./lib/server');

const CHROMIUM_PATH = require('./lib/chromium-path')();

const MAX_PHOTOS = 6;
const POLL_MS    = 2500;   // must match IP_POLL_MS in js/intake-phone.js

// A stand-in for functions/api/phone-upload.js, kept deliberately close to
// the real handler's shape so a contract change on either side shows up
// here as a failure rather than a silent divergence.
function makeApi(store) {
  return async route => {
    const req    = route.request();
    const url    = new URL(req.url());
    const token  = url.searchParams.get('token');
    const method = req.method();
    const json   = (obj, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      if (body.kind === 'create') {
        store.sessions[body.token] = { label: body.label || '', done: false, slots: [] };
        store.created.push(body.token);
        return json({ ok: true, token: body.token, link: url.origin + '/phone-upload?token=' + body.token });
      }
      if (body.kind === 'done') {
        const s = store.sessions[body.token];
        if (!s) return json({ error: 'This upload link has expired' }, 404);
        s.done = true;
        return json({ ok: true });
      }
      return json({ error: 'Unknown kind' }, 400);
    }

    const s = store.sessions[token];

    if (method === 'GET') {
      if (!s) return json({ error: 'This upload link has expired' }, 404);
      const idxParam = url.searchParams.get('idx');
      if (idxParam !== null) {
        const buf = s.slots[Number(idxParam)];
        if (!buf) return json({ error: 'Not found' }, 404);
        store.reads.push(Number(idxParam));
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: buf });
      }
      return json({
        session: {
          token, label: s.label, done: s.done,
          count: s.slots.length,
          slots: s.slots.map((_, i) => i),
          max: MAX_PHOTOS,
        },
      });
    }

    if (method === 'PUT') {
      if (!s) return json({ error: 'This upload link has expired' }, 404);
      if (s.slots.length >= MAX_PHOTOS) return json({ error: `That's all ${MAX_PHOTOS} photos`, count: s.slots.length }, 409);
      s.slots.push(req.postDataBuffer());
      return json({ ok: true, idx: s.slots.length - 1, count: s.slots.length });
    }

    if (method === 'DELETE') {
      delete store.sessions[token];
      store.deletes.push(token);
      return json({ ok: true });
    }

    return json({ error: 'unhandled' }, 400);
  };
}

async function run({ baseUrl } = {}) {
  let server = null;
  if (!baseUrl) { server = await startServer(); baseUrl = server.baseUrl; }
  const intakeUrl = baseUrl.replace(/[^/]*$/, 'intake.html');
  const phoneUrl  = baseUrl.replace(/[^/]*$/, 'phone-upload.html');

  const results = [];
  const check = (name, ok, detail) =>
    results.push({ ok, line: (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : '') });

  const store = { sessions: {}, created: [], deletes: [], reads: [] };

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message.slice(0, 120)));

  try {
    // Catch-all first — Playwright matches most-recently-registered first,
    // so the phone-upload handler registered after it wins for its own path.
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/phone-upload**', makeApi(store));

    await page.goto(intakeUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    // Real JPEG bytes to hand back on the studio's pull, so the gallery
    // thumbnails are decoding actual images rather than junk.
    const jpegB64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 48; c.height = 36;
      const x = c.getContext('2d');
      x.fillStyle = '#C9983A'; x.fillRect(0, 0, 48, 36);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    });
    const jpeg = Buffer.from(jpegB64, 'base64');

    // ── 1. The Photos tab offers the handoff ──
    check('module loaded', await page.evaluate(() => typeof ipOpen === 'function'));
    await page.evaluate(() => {
      document.getElementById('f-firstname').value = 'Sarah';
      document.getElementById('f-job-desc').value = 'Rose gold engagement ring';
      psRenderPanes();
    });
    check('Photos tab shows a "from their phone" button',
      await page.evaluate(() => !!document.querySelector('#ps-pane-photos .rp-phone-btn')));

    // ── 2. Opening mints a session and renders a QR ──
    await page.evaluate(() => document.querySelector('#ps-pane-photos .rp-phone-btn').click());
    await page.waitForSelector('#ip-qr svg');
    const token = store.created[0];
    check('a session is minted on open', store.created.length === 1 && /^up[a-z0-9]{16,}$/.test(token || ''),
      'token=' + token);
    check('the QR encodes this session\'s link',
      (await page.locator('.ip-link').innerText()).includes('/phone-upload?token=' + token));
    check('the customer sees who and what the link is for',
      (store.sessions[token].label || '').includes('Sarah') &&
      store.sessions[token].label.includes('Rose gold'));
    check('the dialog is open and waiting',
      await page.evaluate(() => document.getElementById('ip-modal').classList.contains('open'))
      && (await page.locator('.ip-status').innerText()).includes('Waiting'));

    // ── 3. A photo landing on the server is pulled into the gallery ──
    store.sessions[token].slots.push(jpeg);
    await page.waitForTimeout(POLL_MS + 1200);
    check('the photo is pulled into Reference Photos',
      await page.evaluate(() => _refPhotos.length === 1 && /^data:image\/jpeg;base64,/.test(_refPhotos[0])));
    check('the gallery grid re-renders with it',
      (await page.locator('#rp-grid .rp-thumb').count()) === 1);
    check('the dialog reports the running count',
      (await page.locator('.ip-status').innerText()).includes('1 photo in'));

    // ── 4. Each slot is pulled exactly once ──
    // The poll re-reports every slot every tick, so a missing "already
    // pulled" guard would duplicate the whole gallery every 2.5 seconds.
    await page.waitForTimeout(POLL_MS + 800);
    check('an idle tick does not re-pull what it already has',
      await page.evaluate(() => _refPhotos.length === 1),
      'reads=' + store.reads.length);

    // ── 5. More photos, then the customer taps Done ──
    store.sessions[token].slots.push(jpeg, jpeg);
    store.sessions[token].done = true;
    await page.waitForTimeout(POLL_MS + 1500);
    check('the rest of the batch lands',
      await page.evaluate(() => _refPhotos.length === 3),
      'count=' + await page.evaluate(() => _refPhotos.length));
    check('the dialog reports the customer finished',
      (await page.locator('.ip-status').innerText()).includes('3 photos added'));

    // ── 6. Closing tears the session down ──
    await page.evaluate(() => ipClose());
    await page.waitForTimeout(400);
    check('the dialog closes',
      await page.evaluate(() => !document.getElementById('ip-modal').classList.contains('open')));
    check('the server-side copies are deleted', store.deletes.includes(token));
    check('polling stops once closed', await page.evaluate(() => _ipTimer === null));

    // Photos stay on the order after the handoff dialog is gone — this is
    // the whole point of the feature.
    check('the pulled photos remain on the order',
      await page.evaluate(() => _refPhotos.length === 3));

    // ── 7. A full gallery refuses to open a session ──
    await page.evaluate(() => { while (_refPhotos.length < RP_MAX_PHOTOS) _refPhotos.push(_refPhotos[0]); });
    await page.evaluate(() => ipOpen());
    await page.waitForTimeout(500);
    check('a full gallery does not open a new session',
      store.created.length === 1
      && await page.evaluate(() => !document.getElementById('ip-modal').classList.contains('open')));

    check('no page errors on the studio side', pageErrors.length === 0, pageErrors.join(' | '));

    // ════ CUSTOMER SIDE ════
    const cust = await ctx.newPage();
    cust.setDefaultTimeout(20000);
    const custErrors = [];
    cust.on('pageerror', e => custErrors.push(e.message.slice(0, 120)));
    await cust.route('**/api/phone-upload**', makeApi(store));

    // ── 8. A dead link says so instead of offering an upload ──
    await cust.goto(phoneUrl + '?token=updeadbeefdeadbeef00', { waitUntil: 'domcontentloaded' });
    await cust.waitForTimeout(600);
    check('an expired link shows the dead-link screen',
      await cust.evaluate(() => !document.getElementById('screen-dead').classList.contains('hidden')
                             && document.getElementById('screen-main').classList.contains('hidden')));

    // ── 9. A live link uploads ──
    const custToken = 'upcustomer0000000001';
    store.sessions[custToken] = { label: 'Sarah — Rose gold engagement ring', done: false, slots: [] };
    await cust.goto(phoneUrl + '?token=' + custToken, { waitUntil: 'domcontentloaded' });
    await cust.waitForSelector('#screen-main:not(.hidden)');
    check('the customer sees what the link is for',
      (await cust.locator('#job').innerText()).includes('Rose gold'));

    // Drive the real file input the way a picker would, with a real photo.
    const injectPhoto = () => cust.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 1600; c.height = 1200;           // oversized on purpose — must be downscaled
      const x = c.getContext('2d');
      x.fillStyle = '#4E7A94'; x.fillRect(0, 0, 1600, 1200);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'ref.jpg', { type: 'image/jpeg' }));
      const input = document.getElementById('file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await injectPhoto();
    await cust.waitForSelector('.thumb.sent');
    check('the photo reaches the server', store.sessions[custToken].slots.length === 1);
    check('the customer sees it went through',
      (await cust.locator('#count').innerText()).includes('1 of ' + MAX_PHOTOS + ' sent'));

    // The phone downscales before sending so the studio gets gallery-sized
    // bytes — a 1600px source must come back no wider than 1280.
    const sent = store.sessions[custToken].slots[0];
    const dims = await cust.evaluate(b64 => new Promise(res => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = 'data:image/jpeg;base64,' + b64;
    }), sent.toString('base64'));
    check('the phone downscales before sending', dims.w === 1280 && dims.h === 960,
      dims.w + '×' + dims.h);

    // ── 10. Finishing flags the session for the studio ──
    await cust.click('#done-btn');
    await cust.waitForSelector('#screen-done:not(.hidden)');
    check('finishing marks the session done', store.sessions[custToken].done === true);

    check('no page errors on the customer side', custErrors.length === 0, custErrors.join(' | '));
  } finally {
    await browser.close();
    if (server) server.stop();
  }

  return { pass: results.every(r => r.ok), lines: results.map(r => r.line) };
}

module.exports = { run };

if (require.main === module) {
  run().then(r => { console.log(r.lines.join('\n')); process.exit(r.pass ? 0 : 1); });
}
