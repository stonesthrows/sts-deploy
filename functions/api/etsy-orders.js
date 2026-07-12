// ════════════════════════════════════════════
//  Etsy Orders Proxy  —  /api/etsy-orders
//  Cloudflare Pages Function
//  Fetches paid receipts from Etsy API v3.
//  Required KV binding: STS_KV (stores OAuth tokens + shop_id)
//  Optional env: ETSY_SHOP_ID (fallback if KV lookup fails)
// ════════════════════════════════════════════

const ETSY_CLIENT_ID = 'jv4p59xlneoub7bzzew2m1xq';
const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
const ETSY_API_BASE  = 'https://openapi.etsy.com/v3';

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

async function getAccessToken(kv, clientSecret) {
  const expiresAt   = parseInt(await kv.get('etsy:expires_at') || '0');
  const accessToken = await kv.get('etsy:access_token');

  // Still valid (with 60s buffer)
  if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;

  const refreshToken = await kv.get('etsy:refresh_token');
  if (!refreshToken) return null;

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     ETSY_CLIENT_ID,
    refresh_token: refreshToken,
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  const r = await fetch(ETSY_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) return null;

  const tokens = await r.json();
  await kv.put('etsy:access_token',  tokens.access_token);
  await kv.put('etsy:refresh_token', tokens.refresh_token);
  await kv.put('etsy:expires_at',    String(Date.now() + tokens.expires_in * 1000));

  return tokens.access_token;
}

export async function onRequestGet(context) {
  const { env } = context;
  const kv = env.STS_KV;
  if (!kv) return json({ error: 'STS_KV binding not configured' }, 500);

  const accessToken = await getAccessToken(kv, env.ETSY_CLIENT_SECRET);
  if (!accessToken) return json({ error: 'Not authenticated — visit /api/etsy-auth?action=start' }, 401);

  const shopId = await kv.get('etsy:shop_id') || env.ETSY_SHOP_ID;
  if (!shopId) return json({ error: 'Shop ID unknown — re-authenticate or set ETSY_SHOP_ID env var' }, 500);

  const url        = new URL(context.request.url);
  const sinceParam = url.searchParams.get('since');
  const minCreated = sinceParam
    ? Math.floor(new Date(sinceParam).getTime() / 1000)
    : Math.floor(Date.now() / 1000) - 86400 * 365;

  const apiKey = env.ETSY_CLIENT_SECRET ? `${ETSY_CLIENT_ID}:${env.ETSY_CLIENT_SECRET}` : ETSY_CLIENT_ID;
  const hdrs = {
    'Authorization': `Bearer ${accessToken}`,
    'x-api-key':     apiKey,
  };

  const receipts = [];
  let offset = 0;
  const limit = 25;

  while (true) {
    const apiUrl = `${ETSY_API_BASE}/application/shops/${shopId}/receipts`
      + `?limit=${limit}&offset=${offset}&min_created=${minCreated}&was_paid=true&sort_on=created&sort_order=desc`;

    const r = await fetch(apiUrl, { headers: hdrs });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return json({ error: err.error || `Etsy API error ${r.status}` }, r.status);
    }

    const data    = await r.json();
    const results = data.results || [];
    receipts.push(...results);
    if (results.length < limit) break;
    offset += limit;
  }

  const orders = receipts.map(r => {
    // Keep the variation labels ("Ring size", "Metal", "Width") — the app's
    // spec parser (order-normalize.js) uses them to map size / metal / width
    // onto the printed bag deterministically. Personalization is split out
    // into its own field so it can print in a dedicated box.
    const lineItems = (r.transactions || []).map(t => {
      const allVars = (t.variations || [])
        .map(v => ({ name: v.formatted_name || '', value: v.formatted_value || '' }))
        .filter(v => v.value);
      const isPers = v => /personali[sz]ation|engrav/i.test(v.name);
      const variations = allVars.filter(v => !isPers(v));
      return {
        title:      t.title || '',
        quantity:   t.quantity || 1,
        price:      t.price ? t.price.amount / t.price.divisor : 0,
        variations,
        variant:    variations.map(v => v.name ? `${v.name}: ${v.value}` : v.value).join('; '),
        personalization: allVars.filter(isPers).map(v => v.value).join('; '),
      };
    });

    const linesSummary = lineItems
      .map(li => `${li.quantity}× ${li.title}${li.variant ? ' — ' + li.variant : ''}`
               + (li.personalization ? `\n   ✎ ${li.personalization}` : ''))
      .join('\n');

    const shipping = [r.first_line, r.second_line, r.city, r.state, r.zip, r.country_iso]
      .filter(Boolean).join(', ');

    const price = r.grandtotal
      ? r.grandtotal.amount / r.grandtotal.divisor
      : 0;

    const notes = [
      `Etsy Order #${r.receipt_id}`,
      shipping          ? `Ship to: ${shipping}`              : '',
      r.message_from_buyer ? `Buyer note: ${r.message_from_buyer}` : '',
    ].filter(Boolean).join('\n');

    return {
      etsyReceiptId: r.receipt_id,
      name:          r.name || r.buyer_email || 'Etsy Buyer',
      email:         r.buyer_email || '',
      price,
      desc:          linesSummary,
      lineItems,
      notes,
      buyerNote:     r.message_from_buyer || '',
      createdAt:     new Date((r.created_timestamp || r.create_timestamp) * 1000).toISOString(),
      addrStreet:    r.first_line   || '',
      addrStreet2:   r.second_line  || '',
      addrCity:      r.city         || '',
      addrState:     r.state        || '',
      addrZip:       r.zip          || '',
      addrCountry:   r.country_iso  || '',
    };
  });

  return json(orders);
}
