// ════════════════════════════════════════════
//  INTAKE AI NOTE TAKER SUITE  —  tests/intake-ai-notes.js
//  Drives js/intake-ai-notes.js end to end in headless Chromium against
//  intake.html: capture → summarize → fill the intake form → library.
//
//  Two things this suite deliberately fakes:
//    · /api/claude-proxy is intercepted and answered with a fixed JSON
//      recap, so the suite never spends a token or needs a key. The point
//      is the parsing/rendering/field-mapping around the call, not the
//      model's output.
//    · Headless Chromium has no speech engine, so lines go in through the
//      panel's manual-entry box — the same code path real devices without
//      SpeechRecognition use, and the same segment objects the recognizer
//      would have produced.
//
//  Usage: node intake-ai-notes.js   (or via run.js with the others)
// ════════════════════════════════════════════
const { chromium } = require('playwright-core');
const { startServer } = require('./lib/server');

const CHROMIUM_PATH = require('./lib/chromium-path')();

// The recap the stubbed proxy returns. Nulls are intentional: they prove
// the "detected details" list skips anything the transcript didn't state
// instead of writing blanks into the form.
const FAKE_RECAP = {
  title: 'Sarah — rose gold engagement ring',
  overview: 'Sarah wants a rose gold solitaire with an oval sapphire.',
  key_points: ['14k rose gold', 'Oval sapphire, ~2ct', 'Size 7'],
  action_items: [
    { text: 'Source a 2ct oval sapphire', owner: 'Studio' },
    { text: 'Send inspiration photos', owner: 'Client' },
  ],
  fields: {
    customer_name: 'Sarah Johnson', email: 'sarah@example.com', phone: '5125550100',
    order_type: 'order', piece_type: 'Ring',
    job_desc: 'Custom engagement ring — rose gold',
    description: 'Rose gold solitaire with oval sapphire',
    materials: '14k rose gold', gemstones: '2ct oval sapphire',
    ring_size: 'ring size 7', stamping: null,
    deadline: '2026-09-01', pickup_location: 'Studio',
    repair_notes: null, resize_from: null, resize_to: null,
    budget: '$1,200–1,500', sensitivities: ['nickel'],
  },
};
const DETECTED_COUNT = 12;   // non-null keys in FAKE_RECAP.fields that map to a form field

async function run({ baseUrl } = {}) {
  let server = null;
  if (!baseUrl) { server = await startServer(); baseUrl = server.baseUrl; }
  const intakeUrl = baseUrl.replace(/[^/]*$/, 'intake.html');

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
    // Playwright matches routes most-recently-registered first, so the
    // catch-all has to go in BEFORE the claude-proxy handler or it wins.
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/claude-proxy', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      const isAsk = /answer questions about a single jewelry-consult/.test(body.system || '');
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: [{ text: isAsk ? 'She said her ring finger, left hand.' : JSON.stringify(FAKE_RECAP) }] }),
      });
    });

    await page.goto(intakeUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    // ── 1. Panel opens on the recorder ──
    check('module loaded', await page.evaluate(() => typeof ainOpen === 'function'));
    await page.click('#ain-chip');
    check('panel opens on the Record view',
      await page.locator('#ai-notes').isVisible() && (await page.locator('.ain-tab.on').innerText()) === 'Record');

    // ── 2. Capture lines, tagged per speaker ──
    await page.fill('#ain-manual', 'I want a rose gold engagement ring with an oval sapphire.');
    await page.click('#ain-body button:has-text("Add")');
    await page.evaluate(() => ainSetSpeaker('studio'));
    await page.fill('#ain-manual', 'Great — what size is your ring finger?');
    await page.click('#ain-body button:has-text("Add")');
    check('lines captured with speaker tags',
      (await page.locator('#ain-transcript .ain-seg').count()) === 2
      && (await page.locator('#ain-transcript .ain-seg.studio').count()) === 1);

    // ── 3. Summarize ──
    await page.click('#ain-body button:has-text("Summarize")');
    await page.waitForSelector('.ain-title');
    const summaryText = await page.locator('#ain-body').innerText();
    check('recap renders (title, key points, action items, budget)',
      (await page.locator('.ain-title').innerText()).includes('rose gold')
      && (await page.locator('.ain-list li').count()) === 3
      && (await page.locator('.ain-action').count()) === 2
      && summaryText.includes('$1,200–1,500'));

    const detected = await page.locator('.ain-fld').count();
    check('detected details skip the nulls', detected === DETECTED_COUNT, 'count=' + detected);

    // ── 4. Fill the intake form ──
    await page.click('#ain-body button:has-text("Fill the checked")');
    const vals = await page.evaluate(() => {
      const g = id => (document.getElementById(id) || {}).value;
      return {
        first: g('f-firstname'), last: g('f-lastname'), email: g('f-email'), phone: g('f-phone'),
        piece: g('f-piece-type'), type: g('f-order-type'), deadline: g('f-deadline'),
        pickup: g('f-pickup'), materials: g('f-materials'), stones: g('f-gemstones'),
      };
    });
    check('form filled from the consult',
      vals.first === 'Sarah' && vals.last === 'Johnson'
      && vals.email === 'sarah@example.com' && /\(512\)/.test(vals.phone || '')
      && vals.piece === 'Ring' && vals.type === 'order'
      && vals.deadline === '2026-09-01' && vals.pickup === 'Studio'
      && vals.materials === '14k rose gold' && vals.stones === '2ct oval sapphire',
      JSON.stringify(vals));
    check('filled rows are marked as applied',
      (await page.locator('.ain-fld.applied').count()) === DETECTED_COUNT);

    // A select whose value the dropdown doesn't offer must be left alone
    // rather than blanking the field.
    const bogus = await page.evaluate(() => {
      const el = document.getElementById('f-piece-type');
      const before = el.value;
      _ainCur.summary.fields.piece_type = 'Tiara';
      _ainApplied = {};
      ainRender();
      ainSelectAllDetected(true);
      ainApplyDetected();
      const after = el.value;
      _ainCur.summary.fields.piece_type = 'Ring';
      return { before, after };
    });
    check('an off-menu select value is ignored, not written',
      bogus.after === bogus.before, JSON.stringify(bogus));

    // ── 5. Ask the transcript ──
    await page.fill('#ain-ask-input', 'Which finger?');
    await page.click('#ain-body button:has-text("Ask")');
    await page.waitForSelector('.ain-ask-a');
    check('ask answers from the transcript',
      (await page.locator('.ain-ask-a').innerText()).includes('ring finger'));

    // ── 6. Recap reaches the order's Internal Notes exactly once ──
    await page.click('#ain-body button:has-text("Add to Internal Notes")');
    await page.click('#ain-body button:has-text("Add to Internal Notes")');
    const notes = await page.evaluate(() => document.getElementById('f-notes').value);
    check('recap appended to notes, no duplicate on a second tap',
      notes.includes('AI consult notes') && notes.includes('nickel')
      && notes.split('AI consult notes').length === 2);

    // ── 7. Library: search + persistence across a reload ──
    await page.click('.ain-tab[data-view="library"]');
    await page.fill('#ain-search', 'sapphire');
    const hit = await page.locator('.ain-lib-row').count();
    await page.fill('#ain-search', 'zzzznope');
    const miss = await page.locator('#ain-lib-list').innerText();
    check('library search matches transcript text', hit === 1 && miss.includes('No consult mentions'));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await page.click('#ain-chip');
    await page.click('.ain-tab[data-view="library"]');
    await page.waitForTimeout(400);
    const survived = await page.locator('.ain-lib-row').count();
    await page.click('.ain-lib-row');
    check('consult survives reload and reopens on its recap',
      survived === 1 && (await page.locator('.ain-title').innerText()).includes('rose gold'),
      'rows=' + survived);

    // ── 8. A new intake clears the finished consult ──
    await page.evaluate(() => { intakeReset(); ainSetView('summary'); });
    check('new intake clears the open consult',
      (await page.locator('#ain-body').innerText()).includes('No summary yet'));

    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
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
