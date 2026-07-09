// ════════════════════════════════════════════
//  SHOPIFY SYNC  —  js/shopify.js
//  Manual import of Shopify orders into the intake-website Kanban stage.
// ════════════════════════════════════════════

const SHOPIFY_PROXY = '/api/shopify-orders';
const SHOPIFY_SYNC_KEY = 'sts-shopify-last-sync';

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
    // Cap the lookback at 30 days even if the last-sync marker is missing or
    // stale — prevents a first run (or a cleared marker) from re-pulling
    // years of already-fulfilled orders in as fresh intakes.
    const maxLookback = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const stored = localStorage.getItem(SHOPIFY_SYNC_KEY);
    const since = stored && stored > maxLookback ? stored : maxLookback;
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

    // Build set of already-imported Shopify IDs
    const existingIds = new Set(ORDERS.map(o => o.id));

    // Skip orders Shopify already marks fulfilled — a legitimate new intake
    // shouldn't already be shipped, so this catches old/completed orders
    // that would otherwise slip in even within the lookback window.
    const toImport = shopifyOrders.filter(
      so => !existingIds.has(shopifyAppId(so.shopifyOrderId)) && so.fulfillmentStatus !== 'FULFILLED'
    );

    if (!toImport.length) {
      toast('No new Shopify orders', '✓');
      localStorage.setItem(SHOPIFY_SYNC_KEY, new Date().toISOString().slice(0, 10));
      return;
    }

    let imported = 0;
    for (const so of toImport) {
      const order = shopifyToOrder(so);
      ORDERS.push(order);
      const notionId = await notionCreateOrder(order);
      if (notionId) order.notionId = notionId;
      imported++;
    }

    localStorage.setItem(SHOPIFY_SYNC_KEY, new Date().toISOString().slice(0, 10));
    saveToStorage();
    renderKanban();
    toast(`Imported ${imported} Shopify order${imported !== 1 ? 's' : ''}`, '🛍️');

  } catch (e) {
    console.error('Shopify sync error', e);
    toast('Shopify sync error — see console', '✗');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻'; }
  }
}
