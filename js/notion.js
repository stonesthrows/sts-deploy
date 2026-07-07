// ════════════════════════════════════════════
//  NOTION PIPELINE  —  js/notion.js
//  Client-side Notion integration for the Custom Orders pipeline.
//  Replaces the retired clickup.js sync layer.
//  All API calls route through /api/notion-pipeline (Cloudflare Pages Function).
// ════════════════════════════════════════════

const PIPELINE_PROXY = '/api/notion-pipeline';

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
//  CREATE  —  push a new order to Notion
//  Returns the Notion page ID (string) or null on failure.
//  Tries immediately (callers want the id right away); on a transient
//  failure the create is queued in the Outbox and retried until it lands.
// ════════════════════════════════════════════
async function notionCreateOrder(order) {
  const body = Object.assign({}, order);
  delete body.photo; // local-only, can be MBs of base64
  try {
    const r = await fetch(PIPELINE_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.warn('notionCreateOrder failed', r.status, err);
      if (r.status === 429 || r.status >= 500) Outbox.push({ key: order.id, kind: 'create' });
      return null;
    }
    const d = await r.json();
    return d.notionId || null;
  } catch(e) {
    console.warn('notionCreateOrder error — queued for retry', e);
    Outbox.push({ key: order.id, kind: 'create' });
    return null;
  }
}

// ════════════════════════════════════════════
//  UPDATE  —  sync full order details to Notion
//  Queued through the Outbox: delivered immediately when online,
//  retried with backoff when not. An order with no Notion page yet
//  gets a create queued instead, so the edit is never stranded.
// ════════════════════════════════════════════
async function notionUpdateOrder(order) {
  if (!order || !order.id) return;
  if (!order.notionId && !Outbox.has(order.id, 'create')) {
    Outbox.push({ key: order.id, kind: 'create' });
    return;
  }
  Outbox.push({ key: order.id, kind: 'full' });
}

// ════════════════════════════════════════════
//  STAGE UPDATE  —  lightweight stage-only patch
//  Used after drag-and-drop so the round-trip is minimal.
//  Queued through the Outbox. No-op if notionId is missing (a pending
//  create carries the order's current stage anyway).
// ════════════════════════════════════════════
async function notionUpdateStage(notionId, stageId) {
  if (!notionId) return;
  const o = (typeof ORDERS !== 'undefined') ? ORDERS.find(x => x.notionId === notionId) : null;
  Outbox.push({ key: o ? o.id : notionId, kind: 'stage', notionId: notionId, stage: stageId });
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

    // Orders with a queued write still in flight — their local state wins
    // until the Outbox has delivered it, so a pull can't overwrite it.
    const dirty = (typeof Outbox !== 'undefined') ? Outbox.dirtyKeys() : new Set();

    // Fields that are local-only or should never be overwritten with empty Notion values
    const preserveIfEmpty = ['photo', 'contactedAt', 'deliveredAt'];

    for (const no of notionOrders) {
      // Never let a sync un-complete an order marked complete locally
      const alreadyCompleted = completedMap[no.id] || completedMap['n:' + no.notionId];
      if (alreadyCompleted) no.stage = alreadyCompleted;

      if (no.id && byAppId[no.id]) {
        // Match by App ID — update in place, preserving local-only fields
        const existing = byAppId[no.id];
        if (dirty.has(existing.id)) continue;
        preserveIfEmpty.forEach(f => { if (!no[f] && existing[f]) no[f] = existing[f]; });
        Object.assign(existing, no);
        updated++;
      } else if (no.notionId && byNotionId[no.notionId]) {
        // Match by Notion page ID — update in place
        const existing = byNotionId[no.notionId];
        if (dirty.has(existing.id)) continue;
        preserveIfEmpty.forEach(f => { if (!no[f] && existing[f]) no[f] = existing[f]; });
        Object.assign(existing, no);
        updated++;
      } else {
        // New order from Notion — add to local array
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
//  PUSH UNSYNCED  —  queue creates for any local orders without a notionId
//  Runs on startup so orders created offline or before Notion was wired
//  up get pushed the next time the app loads. Delivery (with retry) is
//  handled by the Outbox; this just enqueues and waits for one attempt.
// ════════════════════════════════════════════
async function notionPushUnsynced() {
  const unsynced = ORDERS.filter(o => !o.notionId);
  if (!unsynced.length) return;
  unsynced.forEach(o => Outbox.push({ key: o.id, kind: 'create' }));
  await Outbox.flush();
  const pushed = unsynced.filter(o => o.notionId).length;
  if (pushed && typeof toast === 'function') {
    toast('✓ Synced ' + pushed + ' previously-unsynced order' + (pushed > 1 ? 's' : '') + ' to Notion', '↻');
  }
  if (unsynced.length - pushed > 0 && typeof setConnStatus === 'function') setConnStatus(false);
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
      console.warn('notionStartupSync: API returned', r.status);
      return;
    }
    const notionOrders = await r.json();
    if (!Array.isArray(notionOrders) || !notionOrders.length) {
      console.warn('notionStartupSync: Notion returned 0 orders — skipping replacement to avoid data loss');
      return;
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
      if (o.pickup)      localFields[o.id].pickup      = o.pickup;
      if (o.contactedAt) localFields[o.id].contactedAt = o.contactedAt;
      if (o.deliveredAt) localFields[o.id].deliveredAt = o.deliveredAt;
      if (o.cancelledAt) localFields[o.id].cancelledAt = o.cancelledAt;
      if (o.pdfUrl)      localFields[o.id].pdfUrl      = o.pdfUrl;
    });

    // Keep any locally-created orders (id starts with 'u') not yet in Notion
    const notionIds    = new Set(notionOrders.map(o => o.id).filter(Boolean));
    const notionPageIds = new Set(notionOrders.map(o => o.notionId).filter(Boolean));
    const localOnly = ORDERS.filter(o =>
      !notionIds.has(o.id) &&
      !notionPageIds.has(o.notionId) &&
      String(o.id).startsWith('u')
    );

    // Orders with a queued write still in flight — keep the local version
    // wholesale so the pull can't overwrite a change the Outbox hasn't
    // delivered yet (Notion still has the pre-change state at this point).
    const dirty = (typeof Outbox !== 'undefined') ? Outbox.dirtyKeys() : new Set();

    // Full replacement — Notion is the source of truth
    ORDERS.length = 0;
    for (const no of notionOrders) {
      const dirtyLocal = byAppId[no.id] || (no.notionId && byNotionId[no.notionId]);
      if (dirtyLocal && dirty.has(dirtyLocal.id)) { ORDERS.push(dirtyLocal); continue; }
      const alreadyCompleted = completedMap[no.id] || completedMap['n:' + no.notionId];
      if (alreadyCompleted) no.stage = alreadyCompleted;
      // Restore local-only fields that Notion doesn't store
      const lf = localFields[no.id] || {};
      if (!no.photo       && lf.photo)       no.photo       = lf.photo;
      if (!no.pickup      && lf.pickup)      no.pickup      = lf.pickup;
      if (!no.contactedAt && lf.contactedAt) no.contactedAt = lf.contactedAt;
      if (!no.deliveredAt && lf.deliveredAt) no.deliveredAt = lf.deliveredAt;
      if (!no.cancelledAt && lf.cancelledAt) no.cancelledAt = lf.cancelledAt;
      if (!no.pdfUrl      && lf.pdfUrl)      no.pdfUrl      = lf.pdfUrl;
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
  } catch(e) {
    // Startup sync is best-effort — fail silently
  }
}
