// ════════════════════════════════════════════
//  ETSY SYNC  —  js/etsy.js
//  Manual and automatic import of Etsy receipts into the intake-website Kanban stage.
// ════════════════════════════════════════════

const ETSY_PROXY    = '/api/etsy-orders';
const ETSY_SYNC_KEY = 'sts-etsy-last-sync';
const ETSY_AUTOSYNC_KEY = 'sts-etsy-autosync-enabled';
const ETSY_AUTOSYNC_INTERVAL_KEY = 'sts-etsy-autosync-interval';

let etsyAutoSyncIntervalId = null;

function etsyAppId(receiptId) {
  return 'etsy-' + receiptId;
}

async function etsySync() {
  const btn = document.getElementById('etsySyncBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳'; }
  toast('Syncing Etsy orders…', '🛍');

  try {
    // Fixed 30-day window (not just since the last sync): already-imported
    // orders are revisited so fields added by newer proxy versions — the
    // ship-by deadline, spec'd items — can be backfilled onto them.
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const r     = await fetch(ETSY_PROXY + '?since=' + encodeURIComponent(since));

    if (r.status === 401) {
      toast('Etsy not connected — visit /api/etsy-auth?action=start', '✗');
      return;
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      toast('Etsy sync failed: ' + (err.error || r.status), '✗');
      return;
    }

    const etsyOrders = await r.json();
    if (!Array.isArray(etsyOrders)) {
      toast('Etsy sync error — unexpected response', '✗');
      return;
    }

    const byId = new Map(ORDERS.map(o => [o.id, o]));
    let imported = 0, backfilled = 0;
    for (const eo of etsyOrders) {
      const existing = byId.get(etsyAppId(eo.etsyReceiptId));
      const fresh    = etsyToOrder(eo);
      if (!existing) {
        ORDERS.push(fresh);
        const notionId = await notionCreateOrder(fresh);
        if (notionId) fresh.notionId = notionId;
        imported++;
      } else if (typeof backfillEcomOrder === 'function' && backfillEcomOrder(existing, fresh)) {
        if (existing.notionId && typeof notionUpdateOrder === 'function') {
          try { await notionUpdateOrder(existing); } catch (e) { console.warn('etsy backfill notion sync', e); }
        }
        backfilled++;
      }
    }

    localStorage.setItem(ETSY_SYNC_KEY, new Date().toISOString().slice(0, 10));
    if (!imported && !backfilled) {
      toast('No new Etsy orders', '✓');
      return;
    }
    saveToStorage();
    renderKanban();
    const bits = [];
    if (imported)   bits.push(`Imported ${imported} Etsy order${imported !== 1 ? 's' : ''}`);
    if (backfilled) bits.push(`updated ${backfilled} existing`);
    toast(bits.join(' · '), '🛍');

  } catch (e) {
    console.error('Etsy sync error', e);
    toast('Etsy sync error — see console', '✗');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻'; }
  }
}

function etsyAutoSyncEnabled() {
  return localStorage.getItem(ETSY_AUTOSYNC_KEY) === 'true';
}

function etsyAutoSyncInterval() {
  const saved = localStorage.getItem(ETSY_AUTOSYNC_INTERVAL_KEY);
  return saved ? parseInt(saved, 10) : 30; // Default 30 minutes
}

function etsySilentSync() {
  // Background sync without user-facing feedback. Only logs errors to console.
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  fetch(ETSY_PROXY + '?since=' + encodeURIComponent(since))
    .then(r => {
      if (r.status === 401) {
        console.warn('Etsy not connected for auto-sync');
        return null;
      }
      if (!r.ok) {
        console.error('Etsy auto-sync failed:', r.status);
        return null;
      }
      return r.json();
    })
    .then(etsyOrders => {
      if (!etsyOrders || !Array.isArray(etsyOrders)) return;
      const byId = new Map(ORDERS.map(o => [o.id, o]));
      let imported = 0, backfilled = 0;
      for (const eo of etsyOrders) {
        const existing = byId.get(etsyAppId(eo.etsyReceiptId));
        const fresh    = etsyToOrder(eo);
        if (!existing) {
          ORDERS.push(fresh);
          const notionId = notionCreateOrder ? notionCreateOrder(fresh).catch(() => {}) : Promise.resolve();
          imported++;
        } else if (typeof backfillEcomOrder === 'function' && backfillEcomOrder(existing, fresh)) {
          if (existing.notionId && typeof notionUpdateOrder === 'function') {
            notionUpdateOrder(existing).catch(e => console.warn('etsy backfill notion sync', e));
          }
          backfilled++;
        }
      }
      if (imported || backfilled) {
        localStorage.setItem(ETSY_SYNC_KEY, new Date().toISOString().slice(0, 10));
        saveToStorage();
        renderKanban();
        console.log('Etsy auto-sync:', imported, 'imported,', backfilled, 'updated');
      }
    })
    .catch(e => console.error('Etsy auto-sync error', e));
}

function initEtsyAutoSync() {
  // Clear any existing interval to avoid duplicates
  if (etsyAutoSyncIntervalId) {
    clearInterval(etsyAutoSyncIntervalId);
    etsyAutoSyncIntervalId = null;
  }

  if (!etsyAutoSyncEnabled()) return;

  const intervalMs = etsyAutoSyncInterval() * 60 * 1000;
  etsyAutoSyncIntervalId = setInterval(etsySilentSync, intervalMs);

  // Run once on init (after a small delay to let the page settle)
  setTimeout(etsySilentSync, 2000);
}

function stopEtsyAutoSync() {
  if (etsyAutoSyncIntervalId) {
    clearInterval(etsyAutoSyncIntervalId);
    etsyAutoSyncIntervalId = null;
  }
}
