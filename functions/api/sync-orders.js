// ════════════════════════════════════════════
//  Combined Order Auto-Sync  —  /api/sync-orders
//  Cloudflare Pages Function
//  Pulls recent Shopify + Etsy orders and pushes them into the Notion
//  pipeline DB via /api/notion-pipeline, which is idempotent on App ID —
//  safe to call repeatedly (e.g. from a daily scheduled task) without
//  any separate "last synced" cursor tracking.
// ════════════════════════════════════════════

const LOOKBACK_DAYS = 14;

// Server-side counterpart of order-normalize.js's item mapping. Items keep
// the raw title + full variant + personalization so the app can re-parse
// them into bag specs at print time (ecomPrintItems) — the SEO-title
// cleanup and spec parsing live client-side, not here.
function marketplaceLineItemsToOrderFields(lineItems) {
  const items = (lineItems || []).map(li => ({
    type:     'manual',
    name:     li.title,
    rawTitle: li.title,
    price:    li.price || 0,
    quantity: li.quantity || 1,
    ringSize: li.size || '',
    variant:  li.variant || '',
    variations: Array.isArray(li.variations) && li.variations.length ? li.variations : undefined,
    personalization: li.personalization || '',
  }));
  const desc = items
    .map(it => `${it.quantity}× ${it.name}${it.variant ? ' — ' + it.variant : (it.ringSize ? ' — Size ' + it.ringSize : '')}`
             + (it.personalization ? `\n   ✎ ${it.personalization}` : ''))
    .join('\n');
  const ringSize = items.filter(it => it.ringSize).map(it => it.ringSize).join(', ');
  return { items, desc, ringSize };
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  const since  = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);

  const result = { shopifyChecked: 0, shopifyImported: 0, etsyChecked: 0, etsyImported: 0, errors: [] };

  // ── Shopify ───────────────────────────────────────────────
  try {
    const r = await fetch(`${origin}/api/shopify-orders?since=${since}`);
    const data = await r.json();
    if (!r.ok || !Array.isArray(data)) {
      result.errors.push('shopify-orders: ' + (data?.error || r.status));
    } else {
      result.shopifyChecked = data.length;
      // Skip orders Shopify already marks fulfilled — same guard as the manual
      // Sync Shopify button, to avoid re-importing old completed orders.
      for (const so of data.filter(so => so.fulfillmentStatus !== 'FULFILLED')) {
        const { items, desc, ringSize } = marketplaceLineItemsToOrderFields(so.lineItems);
        const order = {
          id:            'shopify-' + so.shopifyOrderId,
          name:          so.name,
          email:         so.email,
          price:         so.price,
          desc:          desc || so.desc,
          items,
          ringSize,
          notes:         so.notes,
          stage:         'intake-website',
          orderType:     'order',
          contactSource: 'Website Order',
          takeIn:        so.createdAt ? so.createdAt.slice(0, 10) : '',
        };
        const pr = await fetch(`${origin}/api/notion-pipeline`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order),
        });
        if (pr.ok) result.shopifyImported++;
        else result.errors.push('shopify ' + order.id + ': notion-pipeline ' + pr.status);
      }
    }
  } catch (e) {
    result.errors.push('shopify: ' + e.message);
  }

  // ── Etsy ──────────────────────────────────────────────────
  try {
    const r = await fetch(`${origin}/api/etsy-orders?since=${since}`);
    const data = await r.json();
    if (!r.ok || !Array.isArray(data)) {
      result.errors.push('etsy-orders: ' + (data?.error || r.status));
    } else {
      result.etsyChecked = data.length;
      for (const eo of data) {
        const { items, desc, ringSize } = marketplaceLineItemsToOrderFields(eo.lineItems);
        const order = {
          id:            'etsy-' + eo.etsyReceiptId,
          name:          eo.name,
          email:         eo.email,
          price:         eo.price,
          desc:          desc || eo.desc,
          items,
          ringSize,
          notes:         eo.notes,
          stage:         'etsy-bench',
          orderType:     'order',
          contactSource: 'Etsy Message',
          takeIn:        eo.createdAt ? eo.createdAt.slice(0, 10) : '',
          addrStreet:    eo.addrStreet  || '',
          addrStreet2:   eo.addrStreet2 || '',
          addrCity:      eo.addrCity    || '',
          addrState:     eo.addrState   || '',
          addrZip:       eo.addrZip     || '',
          addrCountry:   eo.addrCountry || '',
        };
        const pr = await fetch(`${origin}/api/notion-pipeline`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order),
        });
        if (pr.ok) result.etsyImported++;
        else result.errors.push('etsy ' + order.id + ': notion-pipeline ' + pr.status);
      }
    }
  } catch (e) {
    result.errors.push('etsy: ' + e.message);
  }

  return json(result);
}
