// ════════════════════════════════════════════
//  INTAKE AI NOTE TAKER SUITE  —  tests/intake-ai-notes.js
//  Drives js/intake-ai-notes.js end to end in headless Chromium against
//  intake.html. Sections 1-8 cover the manual flow (capture → summarize →
//  fill the intake form → ask → library); sections 9-11 cover AUTO mode,
//  the day-to-day path: arm → start on the first touch of the form →
//  restart through a lull → stop and summarize inside the save → gap check
//  on the Saved overlay → re-arm for the next customer.
//
//  Two things this suite deliberately fakes:
//    · /api/claude-proxy is intercepted and answered with a fixed JSON
//      recap, so the suite never spends a token or needs a key. The point
//      is the parsing/rendering/field-mapping around the call, not the
//      model's output.
//    · The Web Speech API is replaced with a scriptable stand-in
//      (window.__fakeSay / __fakeEnd / __fakeDeny). Headless Chromium ships
//      no speech engine, and even with one there'd be no audio to feed it;
//      the stand-in drives the real onresult/onend/onerror wiring instead.
//      Sections 1-8 additionally use the panel's manual-entry box — the
//      same code path devices without SpeechRecognition fall back to.
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
  // Only a save-time run (which is handed the typed order) should produce these.
  missed: ['Deadline — she said before Sept 1, order has no deadline',
           'Sensitivity — mentioned a nickel reaction, not recorded'],
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
    // A scriptable stand-in for the Web Speech API. Headless Chromium has no
    // speech engine, and even with one there'd be no audio to feed it — this
    // exercises the real onresult/onend/onerror wiring (including the
    // mid-consult restart) with lines the test chooses.
    await page.addInitScript(() => {
      class FakeSR {
        start() { FakeSR.live = this; window.__srStarted = (window.__srStarted || 0) + 1; }
        stop() { if (FakeSR.live === this) FakeSR.live = null; if (this.onend) this.onend(); }
        abort() { this.stop(); }
      }
      window.SpeechRecognition = FakeSR;
      // One final result, shaped exactly like a real SpeechRecognitionEvent:
      // results[i][0].transcript with an isFinal flag on the entry itself.
      window.__fakeSay = text => {
        const r = FakeSR.live;
        if (!r || !r.onresult) return false;
        const entry = Object.assign([{ transcript: text }], { isFinal: true });
        r.onresult({ resultIndex: 0, results: Object.assign([entry], { length: 1 }) });
        return true;
      };
      window.__fakeEnd = () => { const r = FakeSR.live; if (r) r.stop(); };
      window.__fakeDeny = () => { const r = FakeSR.live; if (r && r.onerror) r.onerror({ error: 'not-allowed' }); };
      // Sections 1-8 are the manual flow; auto mode is switched on in 9.
      // Only seed the default — never overwrite, or the reload in 9 would
      // put it straight back to off.
      try { if (localStorage.getItem('sts-ain-auto') === null) localStorage.setItem('sts-ain-auto', '0'); } catch (e) {}
    });

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
    // The answer row renders straight away as a "…" placeholder, so wait on
    // the text landing rather than on the element existing.
    let answered = true;
    await page.waitForFunction(
      () => { const el = document.querySelector('.ain-ask-a'); return el && el.innerText.trim() !== '…'; },
      null, { timeout: 10000 },
    ).catch(() => { answered = false; });
    check('ask answers from the transcript',
      answered && (await page.locator('.ain-ask-a').innerText()).includes('ring finger'));

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

    // ── 9. AUTO MODE — the day-to-day path: starts itself on the first
    // touch of the form, stops itself when the order is saved. Sections
    // 1-8 ran with auto off (see the init script) so they stayed manual. ──
    await page.evaluate(() => {
      localStorage.setItem('sts-ain-auto', '1');
      localStorage.removeItem('sts-ain-auto-denied');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);   // boot + the arm delay

    check('auto mode does not record before the form is touched',
      await page.evaluate(() => !document.getElementById('ain-chip').classList.contains('on')));

    await page.click('#f-firstname');
    await page.waitForTimeout(200);
    check('first touch of the form starts the consult',
      await page.evaluate(() => document.getElementById('ain-chip').classList.contains('on'))
      && await page.evaluate(() => window.__srStarted > 0));

    // Speak through the fake recognition engine — this exercises the real
    // onresult/onend path, including the mid-consult restart.
    await page.evaluate(() => window.__fakeSay('She wants a size seven rose gold band with a sapphire.'));
    await page.evaluate(() => window.__fakeEnd());        // engine times out on a lull
    await page.waitForTimeout(500);
    check('recognition restarts itself after a lull',
      await page.evaluate(() => window.__srStarted >= 2 && document.getElementById('ain-chip').classList.contains('on')),
      'starts=' + await page.evaluate(() => window.__srStarted));
    await page.evaluate(() => window.__fakeSay('Needed before the first of September.'));

    // Fill the minimum the form validates on, then save.
    await page.fill('#f-firstname', 'Sarah');
    await page.fill('#f-description', 'Rose gold band');
    await page.click('#intake-save-btn');                  // opens the review modal
    await page.click('button:has-text("Skip review")');
    await page.waitForSelector('#intake-done:not(.hidden)', { timeout: 20000 });
    await page.waitForTimeout(600);

    check('saving the order stops the consult',
      await page.evaluate(() => !document.getElementById('ain-chip').classList.contains('on')));

    const saved = await page.evaluate(() => {
      const o = ORDERS[ORDERS.length - 1] || {};
      return { aiNoteId: o.aiNoteId || null, notes: o.notes || '' };
    });
    check('consult is linked to the saved order', !!saved.aiNoteId, JSON.stringify(saved.aiNoteId));
    check('recap rode along into the order notes',
      saved.notes.includes('AI consult notes') && saved.notes.includes('not entered on the order'),
      saved.notes.slice(0, 120));

    // The stubbed recap returns two `missed` entries (see FAKE_RECAP).
    const missedCard = await page.locator('#ain-missed-card').innerText();
    check('gap check surfaces on the Saved overlay',
      (await page.locator('#ain-missed-card').isVisible())
      && missedCard.includes('came up in the consult')
      && missedCard.includes('Deadline'), missedCard.slice(0, 120));

    // The panel must stack ABOVE the Saved overlay, not replace it.
    await page.click('#ain-missed-card button');
    check('gap check opens the consult over the Saved overlay',
      (await page.locator('#ai-notes').isVisible())
      && (await page.locator('#intake-done').isVisible()));
    await page.click('#ai-notes button:has-text("Close")');
    check('closing the panel lands back on the Saved overlay',
      (await page.locator('#intake-done').isVisible())
      && !(await page.locator('#ai-notes').isVisible()));

    // ── 10. Next customer re-arms without anyone pressing anything ──
    await page.click('button:has-text("New Intake")');
    await page.waitForTimeout(500);
    check('a new intake is not recording yet',
      await page.evaluate(() => !document.getElementById('ain-chip').classList.contains('on')));
    await page.click('#f-lastname');
    await page.waitForTimeout(200);
    check('auto re-arms for the next customer',
      await page.evaluate(() => document.getElementById('ain-chip').classList.contains('on')));
    await page.evaluate(async () => { await ainStopRecording({ autoSummarize: false }); });

    // ── 11. A denied mic latches auto off instead of re-prompting ──
    await page.evaluate(async () => { await ainStartRecording(); window.__fakeDeny(); });
    await page.waitForTimeout(400);
    check('a blocked mic latches auto-record off',
      await page.evaluate(() => localStorage.getItem('sts-ain-auto-denied') === '1'));

    // ── 12. Exiting mid-consult files the conversation rather than binning
    // it — discarding the ORDER is not discarding the recording. ──
    await page.evaluate(() => {
      localStorage.removeItem('sts-ain-auto-denied');
      ainSetView('library');
    });
    const before = await page.locator('.ain-lib-row').count().catch(() => 0);
    await page.evaluate(async () => {
      await ainStartRecording();
      window.__fakeSay('Bring the loupe next time, she wants to see the inclusions.');
      await ainStopForExit();
    });
    await page.evaluate(() => ainSetView('library'));
    await page.waitForTimeout(300);
    const after = await page.locator('.ain-lib-row').count();
    check('exiting mid-consult keeps the conversation', after === before + 1,
      'before=' + before + ' after=' + after);
    check('exit clears the module\'s unload guard',
      await page.evaluate(() => !ainIsRecording()));

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
