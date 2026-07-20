// ════════════════════════════════════════════
//  SHOPIFY SYNC  —  js/shopify.js
//  Manual import of Shopify orders into the intake-website Kanban stage.
// ════════════════════════════════════════════

const SHOPIFY_PROXY = '/api/shopify-orders';
const SHOPIFY_SYNC_KEY = 'sts-shopify-last-sync';
const SHOPIFY_SHIPMENTS_KEY = 'sts-shopify-shipments';   // localStorage cache
const SHOPIFY_SHIPMENTS_TTL = 3600000;                   // refetch after 1h

// ── Recent shipments → SHOPIFY_ORDERS (home Packages widget) ──────────
// SHOPIFY_ORDERS used to be a hardcoded snapshot in js/data.js, which put
// customer names/emails/tracking numbers in a publicly-served file. It's
// now an empty array populated here at runtime from the key-authed proxy,
// cached in localStorage so the Shopify API isn't hit on every page load.
function _shopifyShipmentEntries(orders) {
  return orders
    .filter(o => o.tracking && o.tracking.number)
    .map(o => ({
      customerName: o.name,
      name:         o.shopifyOrderName,
      tracking:     o.tracking,
    }));
}

async function shopifyLoadShipments() {
  if (typeof SHOPIFY_ORDERS === 'undefined') return;

  // Serve from cache while fresh
  try {
    const cached = JSON.parse(localStorage.getItem(SHOPIFY_SHIPMENTS_KEY) || 'null');
    if (cached && Array.isArray(cached.entries)) {
      SHOPIFY_ORDERS.length = 0;
      cached.entries.forEach(e => SHOPIFY_ORDERS.push(e));
      if (typeof _homeRefreshPackages === 'function') _homeRefreshPackages();
      if (Date.now() - (cached.at || 0) < SHOPIFY_SHIPMENTS_TTL) return;
    }
  } catch (e) {}

  try {
    // 14-day window — the widget hides shipments older than 10 days anyway
    const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const r = await fetch(SHOPIFY_PROXY + '?since=' + encodeURIComponent(since));
    if (!r.ok) return;
    const orders = await r.json();
    if (!Array.isArray(orders)) return;
    const entries = _shopifyShipmentEntries(orders);
    SHOPIFY_ORDERS.length = 0;
    entries.forEach(e => SHOPIFY_ORDERS.push(e));
    try { localStorage.setItem(SHOPIFY_SHIPMENTS_KEY, JSON.stringify({ at: Date.now(), entries })); } catch (e) {}
    if (typeof _homeRefreshPackages === 'function') _homeRefreshPackages();
  } catch (e) {
    // Best-effort — the widget just shows no Shopify shipments
  }
}

document.addEventListener('DOMContentLoaded', function () { shopifyLoadShipments(); });

// Orders imported from Shopify use id = 'shopify-<numericId>' for dedup.
function shopifyAppId(numericId) {
  return 'shopify-' + numericId;
}

// Line-item / description / address / notes mapping lives in
// js/order-normalize.js (shopifyToOrder) so all sources share one schema.

async function shopifySync() {
  const btn = document.getElementById('shopifySyncBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳'; }
  toast('Syncing Shopify orders…', '🛍️');

  try {
    // Fixed 30-day window (not just since the last sync): already-imported
    // orders are revisited so fields added by newer proxy versions — spec'd
    // items from the full variantTitle, personalization — can be backfilled
    // onto them. The FULFILLED filter below still keeps old/completed
    // orders from importing as fresh intakes.
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const r = await fetch(SHOPIFY_PROXY + '?since=' + encodeURIComponent(since));

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      toast('Shopify sync failed: ' + (err.error || r.status), '✗');
      return;
    }

    const shopifyOrders = await r.json();
    if (!Array.isArray(shopifyOrders)) {
      toast('Shopify sync error — unexpected response', '✗');
      return;
    }

    const byId = new Map(ORDERS.map(o => [o.id, o]));
    let imported = 0, backfilled = 0;
    for (const so of shopifyOrders) {
      const existing = byId.get(shopifyAppId(so.shopifyOrderId));
      if (!existing) {
        // Skip orders Shopify already marks fulfilled — a legitimate new
        // intake shouldn't already be shipped, so this catches old/completed
        // orders that would otherwise slip in within the lookback window.
        if (so.fulfillmentStatus === 'FULFILLED') continue;
        const order = shopifyToOrder(so);
        ORDERS.push(order);
        const notionId = await notionCreateOrder(order);
        if (notionId) order.notionId = notionId;
        imported++;
      } else if (typeof backfillEcomOrder === 'function' && backfillEcomOrder(existing, shopifyToOrder(so))) {
        if (existing.notionId && typeof notionUpdateOrder === 'function') {
          try { await notionUpdateOrder(existing); } catch (e) { console.warn('shopify backfill notion sync', e); }
        }
        backfilled++;
      }
    }

    localStorage.setItem(SHOPIFY_SYNC_KEY, new Date().toISOString().slice(0, 10));
    if (!imported && !backfilled) {
      toast('No new Shopify orders', '✓');
      return;
    }
    saveToStorage();
    renderKanban();
    const bits = [];
    if (imported)   bits.push(`Imported ${imported} Shopify order${imported !== 1 ? 's' : ''}`);
    if (backfilled) bits.push(`updated ${backfilled} existing`);
    toast(bits.join(' · '), '🛍️');

  } catch (e) {
    console.error('Shopify sync error', e);
    toast('Shopify sync error — see console', '✗');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻'; }
  }
}
