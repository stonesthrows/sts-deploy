// ════════════════════════════════════════════
//  ETSY SYNC  —  js/etsy.js
//  Manual import of Etsy receipts into the intake-website Kanban stage.
// ════════════════════════════════════════════

const ETSY_PROXY    = '/api/etsy-orders';
const ETSY_SYNC_KEY = 'sts-etsy-last-sync';

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
