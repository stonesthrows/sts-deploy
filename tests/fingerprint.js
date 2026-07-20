// ════════════════════════════════════════════
//  FINGERPRINT SUITE  —  tests/fingerprint.js
//  Loads jewelry-workflow.html in headless Chromium and captures a
//  behavior fingerprint: which key globals exist, which tab panel
//  activates for every nav target, and a handful of computed-style
//  probes on tab-specific chrome. Diffs it against the checked-in
//  snapshot (tests/fixtures/fingerprint.json).
//
//  This exists because the monolith-split / storage-rework changes were
//  large mechanical refactors (extracting inline <style>/<script> blocks,
//  swapping localStorage for IndexedDB) where "did I silently break tab
//  X" is exactly the failure mode manual testing misses. A diff here
//  means behavior changed — go verify by hand whether that was intended.
//
//  Usage:
//    node fingerprint.js          — capture fresh, diff vs the snapshot
//    node fingerprint.js --save   — capture fresh, OVERWRITE the snapshot
//                                    (only after a deliberate behavior
//                                    change you've verified by hand)
// ════════════════════════════════════════════
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { startServer } = require('./lib/server');

const SNAPSHOT_PATH = path.join(__dirname, 'fixtures', 'fingerprint.json');
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';

// Globals that must keep existing after any refactor — pulled from every
// corner of the app (home dashboard, sidebar nav, perm jewelry calc,
// production timer, core tab switching) so a regression in any one
// extracted module shows up here.
const GLOBAL_PROBES = [
  'pjPickMetal', 'pjBuildRef', 'homeTabInit', 'sbNav', 'sbToggle',
  'timerTabInit', 'openDataMapModal', 'switchTab', 'switchParent',
  '_homeRefreshPackages', 'calRender', 'dashSquareLoad',
  'notionBackgroundSync', 'syncPillClick', 'stsStoreGet', 'stsStoreSet',
];

// Every top-level tab worth switching to, direct + nested sub-tabs.
const TAB_TARGETS = [
  'home', 'dashboard', 'production', 'customers', 'gmail', 'sales',
  'bestsellers', 'notes', 'supplier', 'order-history', 'materials',
  'to-restock', 'inv-adjust', 'prod-report', 'replenish', 'triplog',
  'pj-calc', 'pj-ref', 'calendar', 'designs', 'bgab',
];

async function capture(page) {
  return page.evaluate(async ({ GLOBAL_PROBES, TAB_TARGETS }) => {
    const r = { globals: {}, tabs: {}, styles: {} };

    GLOBAL_PROBES.forEach(name => { r.globals[name] = typeof window[name]; });

    const cs = (sel, props) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return props.map(p => s[p]).join('|');
    };
    r.styles['body']     = cs('body', ['fontFamily', 'backgroundColor', 'color']);
    r.styles['nav-tab']  = cs('.nav-tab.active', ['backgroundColor', 'color', 'padding']);
    r.styles['topbar']   = cs('.topbar', ['backgroundColor', 'position', 'height']);
    r.styles['connPill'] = cs('#connPill', ['display', 'borderRadius']);
    r.styles['botnav']   = cs('.botnav', ['display', 'position']);
    r.styles['kanban']   = cs('.k-body, .kanban', ['display']);

    for (const t of TAB_TARGETS) {
      try {
        switchTab(t, null);
        await new Promise(res => setTimeout(res, 120));
        const active = document.querySelector('.tab-panel.active');
        r.tabs[t] = active ? active.id : 'NONE';
      } catch (e) { r.tabs[t] = 'ERR:' + e.message.slice(0, 60); }
    }

    // Tab-specific style probes (need their tab active first)
    switchTab('pj-calc', null);
    r.styles['pj-wrap'] = cs('.pj-wrap', ['padding', 'maxWidth']);
    switchTab('triplog', null);
    r.styles['tl-health'] = cs('.tl-health-bar', ['display', 'gap']);

    return r;
  }, { GLOBAL_PROBES, TAB_TARGETS });
}

function diff(a, b) {
  const diffs = [];
  for (const section of ['globals', 'tabs', 'styles']) {
    const keys = new Set([...Object.keys(a[section] || {}), ...Object.keys(b[section] || {})]);
    for (const k of keys) {
      const av = JSON.stringify((a[section] || {})[k]);
      const bv = JSON.stringify((b[section] || {})[k]);
      if (av !== bv) diffs.push(section + '.' + k + ': ' + av + ' -> ' + bv);
    }
  }
  return diffs;
}

async function run({ baseUrl, save } = {}) {
  let server = null;
  if (!baseUrl) { server = await startServer(); baseUrl = server.baseUrl; }

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  const pageErrors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => pageErrors.push(e.message.slice(0, 160)));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    let current;
    try {
      current = await capture(page);
    } catch (e) {
      // A broken global (e.g. a rename/typo) throws mid-capture rather than
      // just showing up as a diff — report it the same way instead of an
      // unhandled stack trace, since that's the more likely real failure.
      return { pass: false, lines: ['FAIL  capture crashed: ' + e.message.split('\n')[0]] };
    }
    current._pageErrors = pageErrors;

    if (save) {
      fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n');
      return { pass: true, lines: ['SAVED new snapshot -> ' + SNAPSHOT_PATH] };
    }

    if (!fs.existsSync(SNAPSHOT_PATH)) {
      return { pass: false, lines: ['No snapshot at ' + SNAPSHOT_PATH + ' — run with --save first.'] };
    }
    const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    const diffs = diff(snapshot, current);
    const knownErrCount = (snapshot._pageErrors || []).length;
    const newErrors = current._pageErrors.length > knownErrCount;

    const lines = [];
    if (diffs.length) lines.push(...diffs.map(d => 'DIFF  ' + d));
    else lines.push('PASS  fingerprint matches snapshot (' +
      GLOBAL_PROBES.length + ' globals, ' + TAB_TARGETS.length + ' tabs, ' +
      Object.keys(current.styles).length + ' style probes)');
    lines.push((newErrors ? 'FAIL' : 'PASS') + '  page errors: ' +
      current._pageErrors.length + ' (snapshot had ' + knownErrCount + ')' +
      (newErrors ? ' — ' + current._pageErrors.join(' | ') : ''));

    return { pass: diffs.length === 0 && !newErrors, lines };
  } finally {
    await browser.close();
    if (server) server.stop();
  }
}

if (require.main === module) {
  const save = process.argv.includes('--save');
  run({ save }).then(({ pass, lines }) => {
    console.log(lines.join('\n'));
    process.exit(pass ? 0 : 1);
  }).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { run, capture, diff };
