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

async function shopifySync() {
  const btn = document.getElementById('shopifySyncBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳'; }
  toast('Syncing Shopify orders…', '🛍️');

  try {
    const since = localStorage.getItem(SHOPIFY_SYNC_KEY) || '2020-01-01';
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

    const toImport = shopifyOrders.filter(
      so => !existingIds.has(shopifyAppId(so.shopifyOrderId))
    );

    if (!toImport.length) {
      toast('No new Shopify orders', '✓');
      localStorage.setItem(SHOPIFY_SYNC_KEY, new Date().toISOString().slice(0, 10));
      return;
    }

    let imported = 0;
    for (const so of toImport) {
      const order = {
        id:            shopifyAppId(so.shopifyOrderId),
        name:          so.name,
        email:         so.email,
        price:         so.price,
        desc:          so.desc,
        notes:         so.notes,
        stage:         'intake-website',
        orderType:     'order',
        contactSource: 'Website Order',
        takeInDate:    so.createdAt ? so.createdAt.slice(0, 10) : '',
      };
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
