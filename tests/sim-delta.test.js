// Simulation test: js/notion.js (delta sync merge rules).
// Run: node tests/sim-delta.test.js  (no dependencies)
const assert = require('assert');
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
global.document = { hidden: false, addEventListener: () => {}, getElementById: () => null };
global.window = { addEventListener: () => {} };
let conn = null;
global.setConnStatus = ok => { conn = ok; };
global.toast = () => {};
global.ORDERS = [];
global.completedHidden = new Set();
let saved = 0, rendered = 0;
global.saveToStorage = () => { saved++; };
global.renderKanban = () => { rendered++; };
global.updateCompletedToggle = () => {};
const dirtySet = new Set();
global.Outbox = {
  dirtyKeys: () => new Set(dirtySet),
  has: () => false,
  push: () => {},
  flush: async () => {},
};
let getScript = [];
let getUrls = [];
global.fetch = async (url, opts) => {
  if (!opts || !opts.method || opts.method === 'GET') {
    getUrls.push(url);
    const next = getScript.length ? getScript.shift() : { status: 200, json: { syncedAt: 'T0', orders: [] } };
    return { ok: next.status < 400, status: next.status, json: async () => next.json };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

// Load the real source like a <script> tag: vm.runInThisContext shares the
// global lexical environment, so the file's top-level const/function
// declarations are visible to the test code below.
const vm   = require('vm');
const path = require('path');
const fs = require('fs');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'notion.js'), 'utf8'), { filename: 'js/notion.js' });
// ═══ Appended after stubs + inlined js/notion.js ═══
(async () => {
  // ── 1. New order from Notion gets added; cursor advances ──
  getScript = [{ status: 200, json: { syncedAt: '2026-07-07T10:00:00Z', orders: [
    { id: 'a1', notionId: 'n-a1', name: 'Alice', stage: 'build', lastEdited: '2026-07-07T09:59:00Z' },
  ] } }];
  await notionDeltaSync();
  assert.strictEqual(ORDERS.length, 1, 'new order added');
  assert.strictEqual(localStorage.getItem('sts-last-sync'), '2026-07-07T10:00:00Z', 'cursor advanced');
  assert.ok(saved > 0 && rendered > 0, 'saved + rendered on change');

  // ── 2. Next poll sends ?since= with the cursor ──
  getUrls = [];
  getScript = [{ status: 200, json: { syncedAt: '2026-07-07T10:01:00Z', orders: [] } }];
  await notionDeltaSync();
  assert.ok(getUrls[0].includes('since=2026-07-07T10%3A00%3A00Z'), 'delta URL carries since cursor');

  // ── 3. Remote edit newer than local → merged in ──
  ORDERS[0].localEditedAt = Date.parse('2026-07-07T10:00:30Z');
  getScript = [{ status: 200, json: { syncedAt: '2026-07-07T10:02:00Z', orders: [
    { id: 'a1', notionId: 'n-a1', name: 'Alice', stage: 'kyle', lastEdited: '2026-07-07T10:01:00Z' },
  ] } }];
  await notionDeltaSync();
  assert.strictEqual(ORDERS[0].stage, 'kyle', 'newer remote edit wins');

  // ── 4. Local edit newer than remote stamp → remote skipped ──
  ORDERS[0].localEditedAt = Date.parse('2026-07-07T10:05:00Z');
  ORDERS[0].stage = 'stevie';
  getScript = [{ status: 200, json: { syncedAt: '2026-07-07T10:05:30Z', orders: [
    { id: 'a1', notionId: 'n-a1', name: 'Alice', stage: 'build', lastEdited: '2026-07-07T10:03:00Z' },
  ] } }];
  await notionDeltaSync();
  assert.strictEqual(ORDERS[0].stage, 'stevie', 'older remote stamp does not clobber newer local edit');

  // ── 5. Dirty order (queued write) is never touched, even if remote is newer ──
  dirtySet.add('a1');
  getScript = [{ status: 200, json: { syncedAt: '2026-07-07T10:07:00Z', orders: [
    { id: 'a1', notionId: 'n-a1', name: 'Alice', stage: 'quote', lastEdited: '2026-07-07T10:06:59Z' },
  ] } }];
  await notionDeltaSync();
  assert.strictEqual(ORDERS[0].stage, 'stevie', 'dirty order skipped');
  dirtySet.clear();

  // ── 6. Never un-complete: remote moves a locally-completed order back ──
  ORDERS[0].stage = 'complete';
  ORDERS[0].localEditedAt = 0;
  getScript = [{ status: 200, json: { syncedAt: '2026-07-07T10:09:00Z', orders: [
    { id: 'a1', notionId: 'n-a1', name: 'Alice', stage: 'build', lastEdited: '2026-07-07T10:08:00Z' },
  ] } }];
  await notionDeltaSync();
  assert.strictEqual(ORDERS[0].stage, 'complete', 'completed order stays completed');

  // ── 7. Local-only fields survive a merge that omits them ──
  ORDERS[0].stage = 'ready-pick';
  ORDERS[0].photo = 'data:jpeg-blob';
  ORDERS[0].pickup = 'Studio';
  getScript = [{ status: 200, json: { syncedAt: '2026-07-07T10:11:00Z', orders: [
    { id: 'a1', notionId: 'n-a1', name: 'Alice Updated', stage: 'ready-pick',
      photo: null, pickup: null, lastEdited: '2026-07-07T10:10:00Z' },
  ] } }];
  await notionDeltaSync();
  assert.strictEqual(ORDERS[0].photo, 'data:jpeg-blob', 'photo preserved');
  assert.strictEqual(ORDERS[0].pickup, 'Studio', 'pickup preserved');
  assert.strictEqual(ORDERS[0].name, 'Alice Updated', 'remote field change applied');

  // ── 8. Failed poll: cursor NOT advanced, conn pill red, no crash ──
  const cursorBefore = localStorage.getItem('sts-last-sync');
  getScript = [{ status: 500, json: {} }];
  await notionDeltaSync();
  assert.strictEqual(localStorage.getItem('sts-last-sync'), cursorBefore, 'cursor unchanged on failure');
  assert.strictEqual(conn, false, 'conn pill red on failure');

  // ── 9. Hidden tab / active drag: no request made ──
  getUrls = [];
  document.hidden = true;
  await notionDeltaSync();
  document.hidden = false;
  global.draggedId = 'a1';
  await notionDeltaSync();
  global.draggedId = null;
  assert.strictEqual(getUrls.length, 0, 'no polls while hidden or dragging');

  // ── 10. Legacy bare-array response still works ──
  getScript = [{ status: 200, json: [
    { id: 'b2', notionId: 'n-b2', name: 'Bob', stage: 'quote', lastEdited: '2026-07-07T10:12:00Z' },
  ] }];
  await notionDeltaSync();
  assert.ok(ORDERS.find(o => o.id === 'b2'), 'bare-array response merged');

  console.log('ALL DELTA SYNC SIMULATION TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
