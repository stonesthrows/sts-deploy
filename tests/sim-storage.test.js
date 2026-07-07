// Simulation test: js/app.js storage layer (IndexedDB migration, mirror,
// divergence guard). Run: node tests/sim-storage.test.js  (no dependencies)
const assert = require('assert');

const ls = {};
global.localStorage = {
  getItem: k => (k in ls ? ls[k] : null),
  setItem: (k, v) => { ls[k] = String(v); },
  removeItem: k => { delete ls[k]; },
  _raw: ls,
};

// In-memory fake of the DB wrapper API from store.js
const stores = { kv: new Map(), photos: new Map() };
let failIdbWrites = false;
global.DB = {
  get:  async (s, k) => stores[s].get(k),
  set:  async (s, k, v) => { if (failIdbWrites) throw new Error('idb write fail'); stores[s].set(k, v); },
  del:  async (s, k) => { stores[s].delete(k); },
  keys: async (s) => [...stores[s].keys()],
};

let fetchCount = 0;
global.fetch = async (url) => { fetchCount++; return { blob: async () => ({ __fakeBlob: true, from: url.slice(0, 20) }) }; };

global.document = { addEventListener: () => {}, querySelectorAll: () => [], getElementById: () => null, querySelector: () => null };
global.window = { addEventListener: () => {}, matchMedia: () => ({ matches: false }) };
global.navigator = { onLine: true };
global.ORDERS = [];
global.completedHidden = new Set();
global.TODAY = new Date();
let toasts = [];
global.toast = m => toasts.push(m);
global.updateCompletedToggle = () => {};

// Load the real source like a <script> tag: vm.runInThisContext shares the
// global lexical environment, so the file's top-level const/function
// declarations are visible to the test code below.
const vm   = require('vm');
const path = require('path');
const fs = require('fs');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8'), { filename: 'js/app.js' });
// app.js declares its own toast(); re-stub it so assertions can observe calls
globalThis.toast = m => toasts.push(m);

(async () => {
  // ── 1. Fresh device: nothing anywhere → clean boot, flag set ──
  await loadFromStorage();
  assert.strictEqual(ORDERS.length, 0, 'fresh device boots empty');
  assert.strictEqual(stores.kv.get('migrated-v1'), true, 'migration flag set even when empty');

  // ── 2. Migration: photos leave the array, land in the photo store ──
  stores.kv.clear(); stores.photos.clear(); fetchCount = 0;
  ls['sts-orders'] = JSON.stringify([
    { id: 'u1', name: 'Alice', stage: 'build', photo: 'data:image/jpeg;base64,AAAA' },
    { id: 'u2', name: 'Bob',   stage: 'quote' },
  ]);
  ls['sts-hidden'] = JSON.stringify(['u9']);
  await loadFromStorage();
  assert.strictEqual(ORDERS.length, 2, 'both orders loaded');
  const alice = ORDERS.find(o => o.id === 'u1');
  assert.strictEqual(alice.photo, undefined, 'photo stripped from order object');
  assert.strictEqual(alice.hasPhoto, true, 'hasPhoto flag set');
  assert.ok(stores.photos.get('u1'), 'photo blob stored in photo store');
  assert.ok(!stores.photos.get('u2'), 'no phantom photo for Bob');
  assert.ok(completedHidden.has('u9'), 'hidden set migrated');
  assert.ok(JSON.parse(ls['sts-orders'])[0].photo, 'original localStorage untouched by migration');

  // ── 3. Second boot: no re-migration, loads from IndexedDB ──
  const fetchesBefore = fetchCount;
  ORDERS.length = 0; completedHidden.clear();
  await loadFromStorage();
  assert.strictEqual(fetchCount, fetchesBefore, 'no photo re-conversion on second boot');
  assert.strictEqual(ORDERS.length, 2, 'second boot loads from IDB');
  assert.strictEqual(ORDERS.find(o => o.id === 'u1').hasPhoto, true, 'hasPhoto survives reload');

  // ── 4. saveToStorage: mirror is photo-less, IDB gets full array, stamps written ──
  ORDERS.find(o => o.id === 'u2').photo = 'data:image/jpeg;base64,LEGACY'; // simulate stray legacy field
  await saveToStorage();
  const mirror = JSON.parse(ls['sts-orders']);
  assert.strictEqual(mirror.find(o => o.id === 'u2').photo, undefined, 'mirror strips photos');
  assert.strictEqual(mirror.find(o => o.id === 'u2').hasPhoto, true, 'mirror marks hasPhoto');
  assert.ok(stores.kv.get('savedAt') > 0, 'IDB stamp written');
  assert.ok(parseInt(ls['sts-orders-savedat']) > 0, 'mirror stamp written');

  // ── 5. Migration failure: flag unset, falls back to localStorage, data intact ──
  stores.kv.clear(); stores.photos.clear();
  ORDERS.length = 0; completedHidden.clear();
  delete ls['sts-orders-savedat'];
  ls['sts-orders'] = JSON.stringify([{ id: 'u3', name: 'Carol', stage: 'build', photo: 'data:image/jpeg;base64,BBBB' }]);
  failIdbWrites = true;
  await loadFromStorage();
  assert.strictEqual(stores.kv.get('migrated-v1'), undefined, 'flag NOT set after failed migration');
  assert.strictEqual(ORDERS.length, 1, 'fell back to localStorage');
  assert.ok(ORDERS[0].photo, 'legacy photo still present in fallback mode — nothing lost');
  failIdbWrites = false;

  // ── 6. Retry on next boot heals: migration completes this time ──
  ORDERS.length = 0;
  await loadFromStorage();
  assert.strictEqual(stores.kv.get('migrated-v1'), true, 'migration retried and completed');
  assert.strictEqual(ORDERS[0].hasPhoto, true, 'photo migrated on retry');

  // ── 7. Divergence guard: mirror newer than IDB → mirror wins ──
  ORDERS.length = 0; completedHidden.clear();
  stores.kv.set('orders', [{ id: 'stale', name: 'Stale IDB', stage: 'build' }]);
  stores.kv.set('savedAt', 1000);
  ls['sts-orders'] = JSON.stringify([{ id: 'fresh', name: 'Fresh Mirror', stage: 'build' }]);
  ls['sts-orders-savedat'] = '2000';
  await loadFromStorage();
  assert.strictEqual(ORDERS[0].id, 'fresh', 'newer mirror beats stale IndexedDB');

  // ── 8. Normal case: IDB stamp >= mirror stamp → IDB wins ──
  ORDERS.length = 0; completedHidden.clear();
  stores.kv.set('savedAt', 3000);
  await loadFromStorage();
  assert.strictEqual(ORDERS[0].id, 'stale', 'IDB preferred when its stamp is newer');

  // ── 9. Save with IDB down but mirror OK: silent (data is safe), next load uses mirror ──
  toasts = [];
  ORDERS.length = 0;
  ORDERS.push({ id: 'u5', name: 'Eve', stage: 'build' });
  failIdbWrites = true;
  await saveToStorage();
  assert.strictEqual(toasts.length, 0, 'no scary toast when mirror succeeded');
  failIdbWrites = false;
  ORDERS.length = 0; completedHidden.clear();
  await loadFromStorage();
  assert.strictEqual(ORDERS[0].id, 'u5', 'mirror (newer stamp) recovered the interrupted save');

  console.log('ALL STORAGE MIGRATION SIMULATION TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
