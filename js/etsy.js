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
    const since = localStorage.getItem(ETSY_SYNC_KEY) || '2020-01-01';
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

    const existingIds = new Set(ORDERS.map(o => o.id));
    const toImport    = etsyOrders.filter(eo => !existingIds.has(etsyAppId(eo.etsyReceiptId)));

    if (!toImport.length) {
      toast('No new Etsy orders', '✓');
      localStorage.setItem(ETSY_SYNC_KEY, new Date().toISOString().slice(0, 10));
      return;
    }

    let imported = 0;
    for (const eo of toImport) {
      const order = {
        id:            etsyAppId(eo.etsyReceiptId),
        name:          eo.name,
        email:         eo.email,
        price:         eo.price,
        desc:          eo.desc,
        notes:         eo.notes,
        stage:         'intake-website',
        orderType:     'order',
        contactSource: 'Etsy Message',
        takeInDate:    eo.createdAt ? eo.createdAt.slice(0, 10) : '',
        addrStreet:    eo.addrStreet,
        addrStreet2:   eo.addrStreet2,
        addrCity:      eo.addrCity,
        addrState:     eo.addrState,
        addrZip:       eo.addrZip,
        addrCountry:   eo.addrCountry,
      };
      ORDERS.push(order);
      const notionId = await notionCreateOrder(order);
      if (notionId) order.notionId = notionId;
      imported++;
    }

    localStorage.setItem(ETSY_SYNC_KEY, new Date().toISOString().slice(0, 10));
    saveToStorage();
    renderKanban();
    toast(`Imported ${imported} Etsy order${imported !== 1 ? 's' : ''}`, '🛍');

  } catch (e) {
    console.error('Etsy sync error', e);
    toast('Etsy sync error — see console', '✗');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻'; }
  }
}
