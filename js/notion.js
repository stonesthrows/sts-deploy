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
  'sketch-needs':   'Needs Sketch',
  'sketch-wait':    'Waiting on Sketch Approval',
  'sketch':         'Sketch Approved',
  'quote':          'Estimate Sent',
  'est-appr':       'Estimate Approved',
  'deposit-wait':   'Waiting on Deposit',
  'deposit-paid':   'Deposit Paid',
  'order-mat':      'Order Materials',
  'materials':      'Waiting on Materials',
  'build':          'At the Bench',
  'contact-need':   'Need to Contact Customer',
  'contact-done':   'Contacted Customer',
  'ready-pick':     'Ready for Pickup',
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
// ════════════════════════════════════════════
async function notionCreateOrder(order) {
  try {
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
    return d.notionId || null;
  } catch(e) {
    console.warn('notionCreateOrder error', e);
    return null;
  }
}

// ════════════════════════════════════════════
//  UPDATE  —  sync full order details to Notion
//  No-op if the order has no notionId yet.
// ════════════════════════════════════════════
async function notionUpdateOrder(order) {
  if (!order.notionId) return;
  try {
    await fetch(PIPELINE_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(order),
    });
  } catch(e) {
    console.warn('notionUpdateOrder error', e);
  }
}

// ════════════════════════════════════════════
//  STAGE UPDATE  —  lightweight stage-only patch
//  Used after drag-and-drop so the round-trip is minimal.
//  No-op if notionId is missing.
// ════════════════════════════════════════════
async function notionUpdateStage(notionId, stageId) {
  if (!notionId) return;
  try {
    await fetch(PIPELINE_PROXY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ notionId, _stageOnly: true, stage: stageId }),
    });
  } catch(e) {
    console.warn('notionUpdateStage error', e);
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
      toast('Notion sync failed: ' + r.status, '✗');
      return;
    }
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

    for (const no of notionOrders) {
      // Never let a sync un-complete an order marked complete locally
      const alreadyCompleted = completedMap[no.id] || completedMap['n:' + no.notionId];
      if (alreadyCompleted) no.stage = alreadyCompleted;

      if (no.id && byAppId[no.id]) {
        // Match by App ID — update in place
        const existing = byAppId[no.id];
        Object.assign(existing, no);
        if (photoMap[existing.id]) existing.photo = photoMap[existing.id];
        updated++;
      } else if (no.notionId && byNotionId[no.notionId]) {
        // Match by Notion page ID — update in place
        const existing = byNotionId[no.notionId];
        Object.assign(existing, no);
        if (photoMap[existing.id]) existing.photo = photoMap[existing.id];
        updated++;
      } else {
        // New order from Notion — add to local array
        if (photoMap[no.id]) no.photo = photoMap[no.id];
        ORDERS.push(no);
        if (no.stage === 'complete' || no.stage === 'delivered') completedHidden.add(no.id);
        added++;
      }
    }

    saveToStorage();
    renderKanban();
    renderCustomers();
    updateCompletedToggle();
    toast('Notion sync: +' + added + ' new, ' + updated + ' updated', '✓');

  } catch(e) {
    console.error('Notion sync error', e);
    toast('Notion sync error — see console', '✗');
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = '↻ Sync Notion'; }
  }
}
