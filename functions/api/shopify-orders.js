// ════════════════════════════════════════════
//  Shopify Orders Proxy  —  /api/shopify-orders
//  Cloudflare Pages Function
//  Fetches recent orders from the Shopify Admin GraphQL API.
//  Required env vars: SHOPIFY_DOMAIN (myshopify.com domain), SHOPIFY_ADMIN_TOKEN
// ════════════════════════════════════════════

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
  const domain = context.env.SHOPIFY_DOMAIN;
  const token  = context.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) return json({ error: 'Shopify env vars not set' }, 500);

  const url   = new URL(context.request.url);
  const since = url.searchParams.get('since') || '2020-01-01';

  const query = `
    query($queryStr: String) {
      orders(first: 50, query: $queryStr, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          createdAt
          email
          note
          totalPriceSet { shopMoney { amount } }
          lineItems(first: 15) {
            nodes {
              title
              quantity
              variantTitle
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
          shippingAddress { firstName lastName address1 address2 city province country zip }
          displayFulfillmentStatus
        }
      }
    }
  `;

  const r = await fetch(`https://${domain}/admin/api/2024-01/graphql.json`, {
    method:  'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type':           'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { queryStr: `created_at:>=${since}` },
    }),
  });

  if (!r.ok) return json({ error: 'Shopify API error ' + r.status }, r.status);

  const data = await r.json();
  if (data.errors) return json({ error: data.errors[0]?.message || 'GraphQL error' }, 400);

  const orders = (data.data?.orders?.nodes || []).map(o => {
    const numericId = o.id.replace('gid://shopify/Order/', '');

    // variantTitle is the variant's option values joined by " / " (e.g.
    // "Size 7.5 / 4mm / Lined, High Polish") — no separate "Size" option is
    // exposed without the read_products scope, so pull the size segment out
    // of this text instead and strip the literal "Size" word from it.
    const lineItems = o.lineItems.nodes.map(li => {
      const sizeSeg = (li.variantTitle || '').split('/')
        .map(s => s.trim())
        .find(seg => /size/i.test(seg));
      return {
        title:    li.title,
        quantity: li.quantity,
        price:    parseFloat(li.originalUnitPriceSet?.shopMoney?.amount || 0),
        size:     sizeSeg ? sizeSeg.replace(/^size\s*/i, '').trim() : '',
      };
    });

    const linesSummary = o.lineItems.nodes
      .map(li => `${li.quantity}× ${li.title}${li.variantTitle ? ' — ' + li.variantTitle : ''}`)
      .join('\n');

    const addr = o.shippingAddress;
    const shipping = addr
      ? [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country].filter(Boolean).join(', ')
      : '';

    const customerName = (addr && (addr.firstName || addr.lastName))
      ? `${addr.firstName || ''} ${addr.lastName || ''}`.trim()
      : (o.email || 'Unknown');

    const notes = [
      `Shopify Order ${o.name}`,
      shipping ? `Ship to: ${shipping}` : '',
      o.note    ? `Note: ${o.note}`     : '',
    ].filter(Boolean).join('\n');

    return {
      shopifyOrderId: numericId,
      shopifyOrderName: o.name,
      name:   customerName,
      email:  o.email || '',
      price:  parseFloat(o.totalPriceSet?.shopMoney?.amount || 0),
      desc:   linesSummary,
      lineItems,
      notes,
      buyerNote:   o.note || '',
      addrStreet:  addr?.address1 || '',
      addrStreet2: addr?.address2 || '',
      addrCity:    addr?.city     || '',
      addrState:   addr?.province || '',
      addrZip:     addr?.zip      || '',
      addrCountry: addr?.country  || '',
      createdAt:         o.createdAt,
      fulfillmentStatus: o.displayFulfillmentStatus,
    };
  });

  return json(orders);
}
