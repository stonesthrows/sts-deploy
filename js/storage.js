// ════════════════════════════════════════════
//  STORAGE  —  js/storage.js  (loads before all other app modules)
//  Async key-value store on IndexedDB. Replaces localStorage for the
//  big payloads (orders with base64 photos/sketches) that were blowing
//  the ~5MB localStorage quota and failing silently.
//
//  API (all return Promises):
//    stsStoreGet(key)        → value or undefined
//    stsStoreSet(key, value) → void   (rejects on failure — callers surface it)
//    stsStoreDel(key)        → void
//
//  Values are stored via structured clone — no JSON.stringify round-trip,
//  so large base64 images cost no extra serialization memory.
//
//  If IndexedDB is unavailable (rare: some private-browsing modes), falls
//  back to localStorage with JSON — same behavior as before this module.
// ════════════════════════════════════════════

const STS_DB_NAME  = 'sts-workflow';
const STS_DB_STORE = 'kv';

let _stsDbPromise = null;

function _stsDb() {
  if (_stsDbPromise) return _stsDbPromise;
  _stsDbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(STS_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STS_DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return _stsDbPromise;
}

function _stsTx(mode, fn) {
  return _stsDb().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(STS_DB_STORE, mode);
    const req = fn(tx.objectStore(STS_DB_STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

// localStorage fallback for environments without IndexedDB
function _lsGet(key) {
  try { const v = localStorage.getItem('sts-kv-' + key); return v == null ? undefined : JSON.parse(v); }
  catch (e) { return undefined; }
}
function _lsSet(key, value) {
  localStorage.setItem('sts-kv-' + key, JSON.stringify(value)); // throws on quota — caller surfaces
}
function _lsDel(key) {
  try { localStorage.removeItem('sts-kv-' + key); } catch (e) {}
}

async function stsStoreGet(key) {
  try { return await _stsTx('readonly', s => s.get(key)); }
  catch (e) { return _lsGet(key); }
}

async function stsStoreSet(key, value) {
  try { await _stsTx('readwrite', s => s.put(value, key)); }
  catch (e) { _lsSet(key, value); }
}

async function stsStoreDel(key) {
  try { await _stsTx('readwrite', s => s.delete(key)); }
  catch (e) { _lsDel(key); }
}
