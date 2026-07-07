// Simulation test: js/sync.js (Outbox write queue).
// Run: node tests/sim-outbox.test.js  (no dependencies)
const fs = require('fs');
const assert = require('assert');

// ── Browser stubs ────────────────────────────────────────────
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.navigator = { onLine: true }; // no navigator.locks → fallback path
global.window = { addEventListener: () => {} };
global.document = { addEventListener: () => {}, hidden: false };
let conn = null;
global.setConnStatus = ok => { conn = ok; };
let toasts = [];
global.toast = (m) => toasts.push(m);
global.ORDERS = [];
global.saveToStorage = () => {};
global.renderKanban = () => {};

// Network stub: scripted responses per call
let script = [];
let sent = [];
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  sent.push(body);
  const next = script.length ? script.shift() : { status: 200, json: { notionId: 'n-auto' } };
  if (next.throw) throw new Error('network down');
  return { ok: next.status < 400, status: next.status, json: async () => next.json || {} };
};

// Load the real source like a <script> tag: vm.runInThisContext shares the
// global lexical environment, so the file's top-level const/function
// declarations are visible to the test code below.
const vm   = require('vm');
const path = require('path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'sync.js'), 'utf8'), { filename: 'js/sync.js' });
const Outbox = vm.runInThisContext('Outbox');   // top-level const -> pull the binding
const flushNow = () => Outbox.flush();

(async () => {
  // ── 1. Coalescing: 3 drags → 1 op; full supersedes stage ──
  navigator.onLine = false;
  Outbox.push({ key: 'u1', kind: 'stage', notionId: 'n1', stage: 'quote' });
  Outbox.push({ key: 'u1', kind: 'stage', notionId: 'n1', stage: 'build' });
  Outbox.push({ key: 'u1', kind: 'stage', notionId: 'n1', stage: 'kyle' });
  assert.strictEqual(Outbox.queue.length, 1, 'stage ops coalesce');
  assert.strictEqual(Outbox.queue[0].stage, 'kyle', 'latest stage wins');
  Outbox.push({ key: 'u1', kind: 'full' });
  assert.strictEqual(Outbox.queue.length, 1, 'full supersedes stage');
  assert.strictEqual(Outbox.queue[0].kind, 'full');
  assert.ok(Outbox.dirtyKeys().has('u1'), 'dirty set tracks pending order');

  // ── 2. Offline: nothing sent; queue persisted across "reload" ──
  await flushNow();
  assert.strictEqual(sent.length, 0, 'no sends while offline');
  Outbox.queue = []; Outbox.load(); // simulate page reload
  assert.strictEqual(Outbox.queue.length, 1, 'queue survives reload');

  // ── 3. Back online: full op flushes from live ORDERS state ──
  ORDERS.push({ id: 'u1', notionId: 'n1', name: 'Test', stage: 'kyle', photo: 'data:huge' });
  navigator.onLine = true;
  script = [{ status: 200, json: {} }];
  await flushNow();
  assert.strictEqual(sent.length, 1, 'one send after reconnect');
  assert.strictEqual(sent[0].stage, 'kyle', 'body built from live order');
  assert.strictEqual(sent[0].photo, undefined, 'photo stripped from body');
  assert.strictEqual(Outbox.queue.length, 0, 'queue drained');
  assert.strictEqual(conn, true, 'conn pill green after drain');

  // ── 4. Create adoption: offline-created order gets notionId on flush ──
  ORDERS.push({ id: 'u2', name: 'New', stage: 'intake-custom' });
  Outbox.push({ key: 'u2', kind: 'create' });
  Outbox.push({ key: 'u2', kind: 'stage', notionId: null, stage: 'x' }); // redundant w/ create
  assert.strictEqual(Outbox.queue.length, 1, 'create absorbs follow-up ops');
  script = [{ status: 200, json: { notionId: 'n2' } }];
  await flushNow();
  assert.strictEqual(ORDERS[1].notionId, 'n2', 'notionId adopted after create');
  assert.strictEqual(sent[1].notionId, undefined, 'create sent without notionId');

  // ── 5. Transient failure: retry kept in queue, backoff scheduled ──
  sent = [];
  Outbox.push({ key: 'u1', kind: 'stage', notionId: 'n1', stage: 'build' });
  script = [{ throw: true }];
  await flushNow();
  assert.strictEqual(Outbox.queue.length, 1, 'op kept after network error');
  assert.strictEqual(Outbox.queue[0].tries, 1, 'tries incremented');
  assert.strictEqual(conn, false, 'conn pill red during retry');
  script = [{ status: 500 }];
  await flushNow();
  assert.strictEqual(Outbox.queue[0].tries, 2, '5xx also retries');
  script = [{ status: 200, json: {} }];
  await flushNow();
  assert.strictEqual(Outbox.queue.length, 0, 'recovers on success');
  assert.strictEqual(conn, true);

  // ── 6. Poison op: 400 dropped loudly, does not wedge queue ──
  Outbox.push({ key: 'u1', kind: 'stage', notionId: 'n1', stage: 'bad' });
  Outbox.push({ key: 'u2', kind: 'full' });
  script = [{ status: 400, json: { error: 'validation' } }, { status: 200, json: {} }];
  sent = [];
  await flushNow();
  assert.strictEqual(Outbox.queue.length, 0, 'poison dropped, next op delivered');
  assert.strictEqual(sent.length, 2, 'both attempted');
  assert.ok(toasts.some(t => t.includes('rejected')), 'user warned about drop');

  // ── 7. Deleted order: op dropped silently ──
  Outbox.push({ key: 'gone', kind: 'full' });
  await flushNow();
  assert.strictEqual(Outbox.queue.length, 0, 'op for deleted order dropped');

  // ── 8. Mid-flight coalesce: re-drag during send is not lost ──
  ORDERS[0].stage = 'build';
  Outbox.push({ key: 'u1', kind: 'stage', notionId: 'n1', stage: 'build' });
  sent = [];
  script = [{ status: 200, json: {} }, { status: 200, json: {} }];
  const p = flushNow();
  Outbox.push({ key: 'u1', kind: 'stage', notionId: 'n1', stage: 'stevie' }); // during send
  await p;
  await flushNow(); // scheduled follow-up
  assert.ok(sent.some(b => b.stage === 'stevie'), 'newer stage from mid-flight push delivered');
  assert.strictEqual(Outbox.queue.length, 0);

  console.log('ALL OUTBOX SIMULATION TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
