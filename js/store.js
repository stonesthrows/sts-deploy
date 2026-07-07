// ════════════════════════════════════════════
//  STORE  —  js/store.js
//  IndexedDB persistence layer for orders + photos.
//
//  Why: localStorage caps out around 5 MB and fails *silently* once
//  full — a few full-size base64 photos inside the orders array was
//  enough to stop every subsequent save without any visible error.
//  IndexedDB has effectively no practical cap here, stores structured
//  data without a JSON round-trip, and keeps photos as compact JPEG
//  Blobs in their own table instead of inflating the orders array.
//
//  Layout:  db "sts", store "kv"     — 'orders', 'hidden', 'savedAt', 'migrated-v1'
//           db "sts", store "photos" — order id → JPEG Blob
//
//  localStorage keeps a photo-less MIRROR of the orders (written by
//  saveToStorage in app.js) purely as a fallback/rollback path — the
//  authoritative copy is here.
//
//  Must load after data.js and before app.js / orders.js.
// ════════════════════════════════════════════

const DB = (() => {
  let dbp = null;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const rq = indexedDB.open('sts', 1);
        rq.onupgradeneeded = () => {
          const db = rq.result;
          if (!db.objectStoreNames.contains('kv'))     db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
        };
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror   = () => reject(rq.error);
        rq.onblocked = () => reject(new Error('IndexedDB open blocked'));
      });
    }
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t  = db.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => resolve(rq && rq.result);
      t.onerror    = () => reject(t.error);
      t.onabort    = () => reject(t.error);
    });
  }
  return {
    get:  (s, k)    => tx(s, 'readonly',  os => os.get(k)),
    set:  (s, k, v) => tx(s, 'readwrite', os => os.put(v, k)),
    del:  (s, k)    => tx(s, 'readwrite', os => os.delete(k)),
    keys: (s)       => tx(s, 'readonly',  os => os.getAllKeys()),
  };
})();

// Ask the browser not to evict our data under storage pressure — iOS
// Safari can otherwise clear IndexedDB for sites left unused for weeks.
try {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
} catch(e) {}

// ════════════════════════════════════════════
//  PHOTOS  —  blob store + warm object-URL cache
//  cardHTML builds synchronously, so photo URLs are cached up front
//  (photoPreloadAll at boot) and refreshed on every put/delete.
// ════════════════════════════════════════════

const _photoUrls = new Map();   // order id → objectURL

function photoURL(orderId) {
  return _photoUrls.get(orderId) || null;
}

async function photoPut(orderId, blob) {
  await DB.set('photos', orderId, blob);
  const old = _photoUrls.get(orderId);
  if (old) URL.revokeObjectURL(old);
  _photoUrls.set(orderId, URL.createObjectURL(blob));
}

async function photoDelete(orderId) {
  await DB.del('photos', orderId);
  const old = _photoUrls.get(orderId);
  if (old) { URL.revokeObjectURL(old); _photoUrls.delete(orderId); }
}

async function photoPreloadAll() {
  try {
    const keys = await DB.keys('photos');
    for (const k of (keys || [])) {
      if (_photoUrls.has(k)) continue;
      const blob = await DB.get('photos', k);
      if (blob) _photoUrls.set(k, URL.createObjectURL(blob));
    }
  } catch(e) {
    console.warn('photoPreloadAll failed', e);
  }
}

// Downscale an image file to a bounded JPEG (~100–250 KB) before storing.
// A raw phone photo is 2–4 MB; at kanban-card / lightbox sizes the
// difference is invisible. Falls back to the original file untouched if
// the canvas pipeline is unavailable — storing big is better than losing
// the photo.
async function downscalePhoto(file, maxDim, quality) {
  maxDim  = maxDim  || 1280;
  quality = quality || 0.82;
  try {
    const bmp   = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width  * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    cvs.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return await new Promise((resolve, reject) =>
      cvs.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')),
                 'image/jpeg', quality));
  } catch(e) {
    console.warn('downscalePhoto fell back to original file', e);
    return file;
  }
}
