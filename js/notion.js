// ════════════════════════════════════════════
//  NOTION PIPELINE  —  js/notion.js
//  Client-side Notion integration for the Custom Orders pipeline.
//  Replaces the retired clickup.js sync layer.
//  All API calls route through /api/notion-pipeline (Cloudflare Pages Function).
// ════════════════════════════════════════════

const PIPELINE_PROXY = '/api/notion-pipeline';

// ── Sync freshness / write-tracking state ─────────────────────
// Background pulls (see notionBackgroundSync at the bottom of this file)
// must never clobber a local change whose push hasn't landed in Notion
// yet, so every write path records itself here first.
let _notionWritesInFlight = 0;    // pushes currently on the wire
let _lastLocalWriteAt     = 0;    // ms timestamp of the most recent local mutation
let _lastPullAt           = 0;    // ms timestamp of the last successful pull
let _lastPullAttemptAt    = 0;    // throttle stamp (attempts, not successes)
const SYNC_EDIT_GRACE_MS  = 30000; // how long a local edit outranks a pull

function _noteLocalWrite(order) {
  _lastLocalWriteAt = Date.now();
  if (order) order._localEditAt = _lastLocalWriteAt;
}

// ── Stage ID ↔ Notion Stage option name ──────────────────────
const STAGE_TO_NOTION = {
  'intake-custom':  'Custom Intake',
  'intake-repair':  'Repair Intake',
  'needs-est':      'Estimate Intake',
  'intake-website': 'Website Order Intake',
  'sketch-needs':   'Needs Sketch',
  'sketch-wait':    'Waiting on Sketch Approval',
  'sketch':         'Sketch Approved',
  'quote':          'Estimate Sent',
  'est-appr':       'Estimate Approved',
  'deposit-wait':   'Waiting on Deposit',
  'deposit-paid':   'Deposit Paid',
  'order-mat':      'Order Materials',
  'materials':      'Waiting on Materials',
  'wait-cust-ship': 'Waiting on Customer Shipment',
  'needs-invoice':  'Needs Invoicing',
  'invoice-sent':   'Invoice Sent',
  'build':          'At the Bench',
  'kyle':           'Kyle',
  'stevie':         'Stevie',
  'vanessa':        'Vanessa',
  'etsy-bench':     'Etsy Order',
  'contact-need':   'Need to Contact Customer',
  'contact-done':   'Contacted Customer',
  'ready-pick':     'Ready for Pickup',
  'ship-out':       'Ship Out',
  'cancelled':      'Cancelled',
  'complete':       'Completed',
  'delivered':      'Delivered',
};

// Build reverse map: lowercase Notion name → stage ID
const NOTION_TO_STAGE = {};
Object.entries(STAGE_TO_NOTION).forEach(([k, v]) => {
  NOTION_TO_STAGE[v.toLowerCase()] = k;
});

// ════════════════════════════════════════════
//  SKETCH SYNC FLAGS  —  the design sketch (order.sketchImg, base64 PNG)
//  is uploaded to Notion's 'Sketch' files property by the pipeline proxy,
//  but only when it actually changed. sketchSyncedHash records the last
//  successfully-uploaded fingerprint; a failed upload leaves it stale so
//  the next order save retries automatically.
// ════════════════════════════════════════════
function _markSketchChanged(order) {
  if (typeof sketchHash !== 'function') return;
  const changed = (order.sketchImg && sketchHash(order.sketchImg) !== order.sketchSyncedHash)
               || (!order.sketchImg && !!order.sketchSyncedHash); // sketch was cleared
  if (changed) order._sketchChanged = true;
  else delete order._sketchChanged;
}

function _recordSketchSync(order, d) {
  if (d && d.sketchSynced && typeof sketchHash === 'function') {
    order.sketchSyncedHash = order.sketchImg ? sketchHash(order.sketchImg) : null;
    if (typeof saveToStorage === 'function') saveToStorage();
  }
  delete order._sketchChanged;
}

// Same change-detection as the sketch, for the intake app's Reference
// Photos gallery (order.refPhotos, an array of base64 dataURLs). Hashed as
// one JSON blob since the whole array re-uploads together on any change.
function _markRefPhotosChanged(order) {
  if (typeof sketchHash !== 'function') return;
  const cur = (order.refPhotos && order.refPhotos.length) ? sketchHash(JSON.stringify(order.refPhotos)) : null;
  if (cur !== (order.refPhotosSyncedHash || null)) order._refPhotosChanged = true;
  else delete order._refPhotosChanged;
}

function _recordRefPhotosSync(order, d) {
  if (d && d.refPhotosSynced && typeof sketchHash === 'function') {
    order.refPhotosSyncedHash = (order.refPhotos && order.refPhotos.length) ? sketchHash(JSON.stringify(order.refPhotos)) : null;
    if (typeof saveToStorage === 'function') saveToStorage();
  }
  delete order._refPhotosChanged;
}

// ════════════════════════════════════════════
//  CREATE  —  push a new order to Notion
//  Returns the Notion page ID (string) or null on failure.
// ════════════════════════════════════════════
async function notionCreateOrder(order) {
  _noteLocalWrite(order);
  _notionWritesInFlight++;
  try {
    _markSketchChanged(order);
    _markRefPhotosChanged(order);
    const r = await fetch(PIPELINE_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(order),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.warn('notionCreateOrder failed', r.status, err);
      return null;
    }
    const d = await r.json();
    _recordSketchSync(order, d);
    _recordRefPhotosSync(order, d);
    return d.notionId || null;
  } catch(e) {
    console.warn('notionCreateOrder error', e);
    return null;
  } finally {
    _notionWritesInFlight--;
  }
}

// ════════════════════════════════════════════
//  UPDATE  —  sync full order details to Notion
//  No-op if the order has no notionId yet.
// ════════════════════════════════════════════
async function notionUpdateOrder(order) {
  if (!order.notionId) return;
  _noteLocalWrite(order);
  _notionWritesInFlight++;
  try {
    _markSketchChanged(order);
    _markRefPhotosChanged(order);
    const r = await fetch(PIPELINE_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(order),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.error('notionUpdateOrder failed', r.status, err);
      if (typeof setConnStatus === 'function') setConnStatus(false);
      if (typeof toast === 'function') toast('⚠ Notion sync failed: ' + (err.error || r.status) + ' — local change kept, but will be overwritten by the next sync until this is fixed', '⚠', 8000);
    } else {
      const d = await r.json().catch(() => ({}));
      _recordSketchSync(order, d);
      _recordRefPhotosSync(order, d);
      if (typeof setConnStatus === 'function') setConnStatus(true);
    }
  } catch(e) {
    console.warn('notionUpdateOrder error', e);
  } finally {
    _notionWritesInFlight--;
  }
}

// ════════════════════════════════════════════
//  STAGE UPDATE  —  lightweight stage-only patch
//  Used after drag-and-drop so the round-trip is minimal.
//  No-op if notionId is missing.
// ════════════════════════════════════════════
async function notionUpdateStage(notionId, stageId) {
  if (!notionId) return;
  _noteLocalWrite(typeof ORDERS !== 'undefined' && ORDERS.find(o => o.notionId === notionId));
  _notionWritesInFlight++;
  try {
    await fetch(PIPELINE_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ notionId, _stageOnly: true, stage: stageId }),
    });
  } catch(e) {
    console.warn('notionUpdateStage error', e);
  } finally {
    _notionWritesInFlight--;
  }
}

// ════════════════════════════════════════════
//  HEAL GUESSED DATES  —  orders the API flagged as having a guessed
//  Completed At (order was marked Completed/Delivered in Notion directly,
//  bypassing the app, so the date came from last_edited_time instead).
//  Writes the guess back to Notion once so it's never re-guessed.
// ════════════════════════════════════════════
async function notionHealGuessedDates(orders) {
  const guessed = orders.filter(o => o.dateGuessed);
  for (const o of guessed) {
    delete o.dateGuessed;
    await notionUpdateOrder(o);
  }
  if (guessed.length) {
    toast('Backfilled ' + guessed.length + ' missing completion date' + (guessed.length > 1 ? 's' : '') + ' (best guess from Notion)', '📅');
  }
}

// ════════════════════════════════════════════
//  SYNC  —  pull all Notion pages → merge into ORDERS
//  Preserves: photos, completed status, completed registry.
//  Called by the ↻ Sync Notion button in the Integrations modal.
// ════════════════════════════════════════════
async function notionSyncFromNotion() {
  const syncBtn = document.getElementById('notionSyncBtn');
  if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = '⟳ Syncing…'; }
  toast('Syncing from Notion…', '⟳');

  try {
    const r = await fetch(PIPELINE_PROXY);
    if (!r.ok) {
      setConnStatus(false);
      toast('Notion sync failed: ' + r.status, '✗');
      return;
    }
    setConnStatus(true);
    const notionOrders = await r.json();

    // ── Build lookup maps for existing local orders ───────────
    const byAppId    = {};
    const byNotionId = {};
    ORDERS.forEach(o => {
      byAppId[o.id] = o;
      if (o.notionId) byNotionId[o.notionId] = o;
    });

    // ── Preserve photos and completed state ──────────────────
    const photoMap     = {};
    const completedMap = {};
    ORDERS.forEach(o => {
      if (o.photo) photoMap[o.id] = o.photo;
      if (o.stage === 'complete' || o.stage === 'delivered') {
        completedMap[o.id] = o.stage;
        if (o.notionId) completedMap['n:' + o.notionId] = o.stage;
      }
    });
    // Persistent completed registry survives full ORDERS replacement
    let completedRegistry = [];
    try { completedRegistry = JSON.parse(localStorage.getItem('sts-completed-registry') || '[]'); } catch(e) {}
    completedRegistry.forEach(entry => {
      completedMap[entry.id] = 'complete';
      if (entry.notionId) completedMap['n:' + entry.notionId] = 'complete';
    });

    let added = 0, updated = 0;

    // Fields that are local-only or should never be overwritten with empty Notion
    // values. items/jobDescMode/shippingAddress/fullyPaid/shipping don't
    // round-trip through Notion at all, so the local copy is the only copy.
    const preserveIfEmpty = ['photo', 'sketchImg', 'sketchSyncedHash', 'contactedAt', 'deliveredAt',
      'items', 'jobDescMode', 'shippingAddress', 'fullyPaid', 'shipping', 'takeIn',
      'orderKind', 'orderSource', 'sourceOrderNumber',
      // Structured intake fields (round-trip via the App Data property, but
      // never let an older/blank Notion copy erase a local value) + images
      // that live only on-device.
      'sensitivities', 'ringSizes', 'wrist', 'neck', 'styleProfile', 'gift',
      'stones', 'estimateAlternatives', 'estimate', 'sketchInkImg', 'signatureImg',
      'refPhotos', 'refPhotosSyncedHash'];

    for (const no of notionOrders) {
      // Never let a sync un-complete an order marked complete locally
      const alreadyCompleted = completedMap[no.id] || completedMap['n:' + no.notionId];
      if (alreadyCompleted) no.stage = alreadyCompleted;

      if (no.id && byAppId[no.id]) {
        // Match by App ID — update in place, preserving local-only fields
        const existing = byAppId[no.id];
        preserveIfEmpty.forEach(f => { if (!no[f] && existing[f]) no[f] = existing[f]; });
        if (typeof normalizeOrder === 'function') normalizeOrder(no);
        Object.assign(existing, no);
        updated++;
      } else if (no.notionId && byNotionId[no.notionId]) {
        // Match by Notion page ID — update in place
        const existing = byNotionId[no.notionId];
        preserveIfEmpty.forEach(f => { if (!no[f] && existing[f]) no[f] = existing[f]; });
        if (typeof normalizeOrder === 'function') normalizeOrder(no);
        Object.assign(existing, no);
        updated++;
      } else {
        // New order from Notion — add to local array
        if (typeof normalizeOrder === 'function') normalizeOrder(no);
        ORDERS.push(no);
        if (no.stage === 'complete' || no.stage === 'delivered') completedHidden.add(no.id);
        added++;
      }
    }

    await notionHealGuessedDates(notionOrders);
    saveToStorage();
    renderKanban();
    renderCustomers();
    updateCompletedToggle();
    _lastPullAt = Date.now();
    _syncPillRefresh();
    toast('Notion sync: +' + added + ' new, ' + updated + ' updated', '✓');

  } catch(e) {
    console.error('Notion sync error', e);
    setConnStatus(false);
    toast('Notion sync error — see console', '✗');
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = '↻ Sync Notion'; }
  }
}

// ════════════════════════════════════════════
//  PUSH UNSYNCED  —  push any local orders without a notionId to Notion
//  Runs on startup so orders created offline or before Notion was wired
//  up get pushed the next time the app loads on the main browser.
// ════════════════════════════════════════════
async function notionPushUnsynced() {
  const unsynced = ORDERS.filter(o => !o.notionId);
  if (!unsynced.length) return;
  let pushed = 0;
  for (const o of unsynced) {
    try {
      const notionId = await notionCreateOrder(o);
      if (notionId) { o.notionId = notionId; pushed++; }
    } catch(e) {}
  }
  if (pushed) {
    saveToStorage();
    if (typeof renderKanban === 'function') renderKanban();
    if (typeof toast === 'function') toast('✓ Synced ' + pushed + ' previously-unsynced order' + (pushed > 1 ? 's' : '') + ' to Notion', '↻');
    console.log('notionPushUnsynced: pushed ' + pushed + ' orders to Notion');
  }
  const stillUnsynced = unsynced.length - pushed;
  if (stillUnsynced > 0 && typeof setConnStatus === 'function') setConnStatus(false);
}

// ════════════════════════════════════════════
//  STARTUP SYNC  —  silent background pull on page load
//  No toasts, no button UI. Keeps all browsers in sync
//  without requiring a Claude session.
// ════════════════════════════════════════════
async function notionStartupSync() {
  try {
    const r = await fetch(PIPELINE_PROXY);
    if (!r.ok) {
      setConnStatus(false);
      _syncPillRefresh();
      console.warn('notionStartupSync: API returned', r.status);
      return false;
    }
    const notionOrders = await r.json();
    if (!Array.isArray(notionOrders) || !notionOrders.length) {
      console.warn('notionStartupSync: Notion returned 0 orders — skipping replacement to avoid data loss');
      return false;
    }
    setConnStatus(true);
    console.log('notionStartupSync: loaded', notionOrders.length, 'orders from Notion');

    const byAppId    = {};
    const byNotionId = {};
    ORDERS.forEach(o => {
      byAppId[o.id] = o;
      if (o.notionId) byNotionId[o.notionId] = o;
    });

    const photoMap     = {};
    const completedMap = {};
    ORDERS.forEach(o => {
      if (o.photo) photoMap[o.id] = o.photo;
      if (o.stage === 'complete' || o.stage === 'delivered') {
        completedMap[o.id] = o.stage;
        if (o.notionId) completedMap['n:' + o.notionId] = o.stage;
      }
    });
    let completedRegistry = [];
    try { completedRegistry = JSON.parse(localStorage.getItem('sts-completed-registry') || '[]'); } catch(e) {}
    completedRegistry.forEach(entry => {
      completedMap[entry.id] = 'complete';
      if (entry.notionId) completedMap['n:' + entry.notionId] = 'complete';
    });

    // Build lookup of local-only fields to preserve across replacement
    const localFields = {};
    ORDERS.forEach(o => {
      localFields[o.id] = {};
      if (o.photo)       localFields[o.id].photo       = o.photo;
      if (o.sketchImg)   localFields[o.id].sketchImg   = o.sketchImg;
      if (o.sketchSyncedHash) localFields[o.id].sketchSyncedHash = o.sketchSyncedHash;
      if (o.refPhotos && o.refPhotos.length) localFields[o.id].refPhotos = o.refPhotos;
      if (o.refPhotosSyncedHash) localFields[o.id].refPhotosSyncedHash = o.refPhotosSyncedHash;
      if (o.pickup)      localFields[o.id].pickup      = o.pickup;
      if (o.contactedAt) localFields[o.id].contactedAt = o.contactedAt;
      if (o.deliveredAt) localFields[o.id].deliveredAt = o.deliveredAt;
      if (o.cancelledAt) localFields[o.id].cancelledAt = o.cancelledAt;
      if (o.pdfUrl)      localFields[o.id].pdfUrl      = o.pdfUrl;
      // Fields Notion doesn't round-trip — without these, imported line
      // items, addresses, and order-kind identity vanish on every startup.
      if (o.items && o.items.length) localFields[o.id].items = o.items;
      if (o.jobDescMode)     localFields[o.id].jobDescMode     = o.jobDescMode;
      if (o.shippingAddress) localFields[o.id].shippingAddress = o.shippingAddress;
      if (o.fullyPaid != null) localFields[o.id].fullyPaid     = o.fullyPaid;
      if (o.shipping  != null) localFields[o.id].shipping      = o.shipping;
      if (o.takeIn)          localFields[o.id].takeIn          = o.takeIn;
      if (o.orderKind)       localFields[o.id].orderKind       = o.orderKind;
      if (o.orderSource)     localFields[o.id].orderSource     = o.orderSource;
      if (o.sourceOrderNumber) localFields[o.id].sourceOrderNumber = o.sourceOrderNumber;
      // Structured intake fields + on-device images — same rule as above:
      // a Notion copy without them must not erase the local ones.
      ['sensitivities', 'ringSizes', 'wrist', 'neck', 'styleProfile', 'gift',
       'stones', 'estimateAlternatives', 'estimate', 'sketchInkImg', 'signatureImg'].forEach(f => {
        const v = o[f];
        if (v == null) return;
        if (Array.isArray(v) && !v.length) return;
        localFields[o.id][f] = v;
      });
    });

    // Keep any locally-created orders (id starts with 'u') not yet in Notion
    const notionIds    = new Set(notionOrders.map(o => o.id).filter(Boolean));
    const notionPageIds = new Set(notionOrders.map(o => o.notionId).filter(Boolean));
    const localOnly = ORDERS.filter(o =>
      !notionIds.has(o.id) &&
      !notionPageIds.has(o.notionId) &&
      String(o.id).startsWith('u')
    );

    // Full replacement — Notion is the source of truth
    ORDERS.length = 0;
    for (const no of notionOrders) {
      // A local edit inside the grace window outranks this pull — its push
      // may not have landed in Notion when the GET was issued, so replacing
      // it would bounce the order back to its pre-edit state.
      const localCur = byAppId[no.id] || (no.notionId && byNotionId[no.notionId]) || null;
      if (localCur && localCur._localEditAt &&
          Date.now() - localCur._localEditAt < SYNC_EDIT_GRACE_MS) {
        ORDERS.push(localCur);
        continue;
      }
      const alreadyCompleted = completedMap[no.id] || completedMap['n:' + no.notionId];
      if (alreadyCompleted) no.stage = alreadyCompleted;
      // Restore local-only fields that Notion doesn't store
      const lf = localFields[no.id] || {};
      if (!no.photo       && lf.photo)       no.photo       = lf.photo;
      if (!no.sketchImg   && lf.sketchImg)   no.sketchImg   = lf.sketchImg;
      if (!no.sketchSyncedHash && lf.sketchSyncedHash) no.sketchSyncedHash = lf.sketchSyncedHash;
      if ((!no.refPhotos || !no.refPhotos.length) && lf.refPhotos) no.refPhotos = lf.refPhotos;
      if (!no.refPhotosSyncedHash && lf.refPhotosSyncedHash) no.refPhotosSyncedHash = lf.refPhotosSyncedHash;
      if (!no.pickup      && lf.pickup)      no.pickup      = lf.pickup;
      if (!no.contactedAt && lf.contactedAt) no.contactedAt = lf.contactedAt;
      if (!no.deliveredAt && lf.deliveredAt) no.deliveredAt = lf.deliveredAt;
      if (!no.cancelledAt && lf.cancelledAt) no.cancelledAt = lf.cancelledAt;
      if (!no.pdfUrl      && lf.pdfUrl)      no.pdfUrl      = lf.pdfUrl;
      if ((!no.items || !no.items.length) && lf.items) no.items = lf.items;
      if (!no.jobDescMode     && lf.jobDescMode)     no.jobDescMode     = lf.jobDescMode;
      if (!no.shippingAddress && lf.shippingAddress) no.shippingAddress = lf.shippingAddress;
      if (no.fullyPaid == null && lf.fullyPaid != null) no.fullyPaid    = lf.fullyPaid;
      if (no.shipping  == null && lf.shipping  != null) no.shipping     = lf.shipping;
      if (!no.takeIn          && lf.takeIn)          no.takeIn          = lf.takeIn;
      if (!no.orderKind       && lf.orderKind)       no.orderKind       = lf.orderKind;
      if (!no.orderSource     && lf.orderSource)     no.orderSource     = lf.orderSource;
      if (!no.sourceOrderNumber && lf.sourceOrderNumber) no.sourceOrderNumber = lf.sourceOrderNumber;
      ['sensitivities', 'ringSizes', 'wrist', 'neck', 'styleProfile', 'gift',
       'stones', 'estimateAlternatives', 'estimate', 'sketchInkImg', 'signatureImg'].forEach(f => {
        if (lf[f] == null) return;
        const nv = no[f];
        if (nv == null || (Array.isArray(nv) && !nv.length)) no[f] = lf[f];
      });
      if (typeof normalizeOrder === 'function') normalizeOrder(no);
      if (no.stage === 'complete' || no.stage === 'delivered') completedHidden.add(no.id);
      ORDERS.push(no);
    }
    localOnly.forEach(o => ORDERS.push(o));

    await notionHealGuessedDates(notionOrders);
    saveToStorage();
    renderKanban();
    if (typeof renderProduction === 'function') renderProduction();
    if (typeof renderCustomers === 'function') renderCustomers();
    updateCompletedToggle();
    _lastPullAt = Date.now();
    _syncPillRefresh();
    return true;
  } catch(e) {
    // Startup sync is best-effort — fail silently
    _syncPillRefresh();
    return false;
  }
}

// ════════════════════════════════════════════
//  BACKGROUND SYNC  —  keeps every device's board fresh
//  Pulls from Notion on an interval (visible tabs only) and whenever the
//  tab regains focus/visibility or the network comes back. Guarded so a
//  pull never re-renders under the user's feet or clobbers an edit whose
//  push hasn't landed yet.
// ════════════════════════════════════════════
const SYNC_INTERVAL_MS = 60000;  // periodic pull while tab is visible
const SYNC_MIN_GAP_MS  = 20000;  // floor between pulls (focus+visibility can double-fire)

// Native HTML5 drag state (kanban + production columns) — a re-render
// mid-drag would destroy the dragged element.
let _dndActive = false;

// Reason the background pull must wait, or null if it's safe to pull now.
function _syncBlocked() {
  const modal = document.getElementById('editOrderModalBg');
  if (modal && modal.classList.contains('open')) return 'order card open';
  if (_dndActive || window._touchDragActive)     return 'drag in progress';
  if (_notionWritesInFlight > 0)                 return 'saving changes';
  if (Date.now() - _lastLocalWriteAt < SYNC_EDIT_GRACE_MS) return 'recent local edit';
  return null;
}

async function notionBackgroundSync(force) {
  if (document.visibilityState === 'hidden') return;
  if (!force && Date.now() - _lastPullAttemptAt < SYNC_MIN_GAP_MS) return;
  if (_syncBlocked()) return;
  _lastPullAttemptAt = Date.now();
  await notionStartupSync();
}

// Click handler for the topbar sync pill — explicit refresh
function syncPillClick() {
  const why = _syncBlocked();
  if (why) { toast('Sync paused — ' + why, '⏸'); return; }
  toast('Refreshing from Notion…', '⟳');
  notionBackgroundSync(true);
}

// "synced Xm ago" label + stale tint on the topbar pill
function _syncPillRefresh() {
  const pill = document.getElementById('connPill');
  const age  = document.getElementById('connAge');
  if (!pill || !age) return;
  if (!_lastPullAt) { age.textContent = ''; return; }
  const mins = Math.floor((Date.now() - _lastPullAt) / 60000);
  age.textContent = mins < 1 ? 'synced just now'
                  : mins < 60 ? 'synced ' + mins + 'm ago'
                  : 'synced ' + Math.floor(mins / 60) + 'h ago';
  pill.classList.toggle('conn-stale', mins >= 5);
}

document.addEventListener('DOMContentLoaded', function () {
  document.addEventListener('dragstart', function () { _dndActive = true;  });
  document.addEventListener('dragend',   function () { _dndActive = false; });
  document.addEventListener('drop',      function () { _dndActive = false; });

  setInterval(function () { notionBackgroundSync(false); }, SYNC_INTERVAL_MS);
  setInterval(_syncPillRefresh, 30000);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') notionBackgroundSync(false);
  });
  window.addEventListener('focus',  function () { notionBackgroundSync(false); });
  window.addEventListener('online', function () { notionBackgroundSync(true);  });
});
