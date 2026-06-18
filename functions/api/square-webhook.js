// ════════════════════════════════════════════
//  Square Webhook Handler  —  /api/square-webhook
//  Listens for payment.updated events; on COMPLETED, decrements split
//  inventory in Notion based on which device handled the sale.
//
//  Required env vars:
//    SQUARE_TOKEN                 — Square API bearer token
//    SQUARE_WEBHOOK_SIGNATURE_KEY — from Square Developer Dashboard → Webhooks
//    NOTION_TOKEN                 — Notion integration token
//    NOTION_INVENTORY_DB_ID       — from square-notion-setup output
//    DEVICE_NICKNAME_YOU          — exact device name in Square for Kyle
//    DEVICE_NICKNAME_GEORGINA     — exact device name in Square for Georgina
// ════════════════════════════════════════════

const SQUARE_API = 'https://connect.squareup.com';
const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';

// ── Signature verification ────────────────────────────────────────────────────
// Square signs: HMAC-SHA256(key=sigKey, msg=webhookUrl + rawBody) → base64

async function verifySignature(sigKey, webhookUrl, rawBody, sigHeader) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sigKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(webhookUrl + rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === sigHeader;
}

function ok() {
  return new Response('OK', { status: 200 });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text();

  // Verify Square signature when key is configured
  const sigKey    = env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const sigHeader = request.headers.get('x-square-hmacsha256-signature') || '';
  if (sigKey) {
    const webhookUrl = new URL(request.url).href;
    const valid      = await verifySignature(sigKey, webhookUrl, rawBody, sigHeader);
    if (!valid) {
      console.warn('[sq-webhook] invalid signature — rejecting');
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return ok(); }

  // Square requires a 200 ACK for all webhook deliveries
  if (event.type !== 'payment.updated') return ok();

  const payment = event.data?.object?.payment;
  if (!payment) return ok();

  // Only act when payment is fully completed (event also fires on authorize/cancel)
  if (payment.status !== 'COMPLETED') return ok();

  // ── Resolve device → owner ────────────────────────────────────────────────
  const deviceName    = (payment.device_details?.device_name || '').toLowerCase();
  const youNick       = (env.DEVICE_NICKNAME_YOU      || '').toLowerCase();
  const georginaNick  = (env.DEVICE_NICKNAME_GEORGINA || '').toLowerCase();

  let propName;
  if (youNick && deviceName.includes(youNick))          propName = 'Current Stock: You';
  else if (georginaNick && deviceName.includes(georginaNick)) propName = 'Current Stock: Georgina';
  else {
    console.log(`[sq-webhook] device "${payment.device_details?.device_name}" not matched — skipping`);
    return ok();
  }

  // ── Fetch the order to get line items ─────────────────────────────────────
  const orderId = payment.order_id;
  if (!orderId) return ok();

  const sqRes = await fetch(`${SQUARE_API}/v2/orders/${orderId}`, {
    headers: {
      'Authorization':  'Bearer ' + env.SQUARE_TOKEN,
      'Square-Version': '2025-01-23',
    },
  });
  if (!sqRes.ok) {
    console.error('[sq-webhook] order fetch failed:', sqRes.status);
    return ok();
  }
  const { order } = await sqRes.json();
  const lineItems  = order?.line_items || [];

  // ── Decrement Notion stock for each line item ─────────────────────────────
  const notionHdrs = {
    'Authorization':  'Bearer ' + env.NOTION_TOKEN,
    'Notion-Version': NOTION_VER,
    'Content-Type':   'application/json',
  };
  const dbId = env.NOTION_INVENTORY_DB_ID;

  for (const item of lineItems) {
    const varId = item.catalog_object_id;
    if (!varId) continue;
    const qty = parseInt(item.quantity) || 1;

    // Find the Notion row whose SKU matches this variation ID
    const qRes = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: 'POST',
      headers: notionHdrs,
      body: JSON.stringify({
        filter: { property: 'SKU', rich_text: { equals: varId } },
        page_size: 1,
      }),
    });
    if (!qRes.ok) continue;
    const { results } = await qRes.json();
    if (!results?.length) {
      console.log(`[sq-webhook] no Notion row for SKU ${varId} — skipping`);
      continue;
    }

    const page    = results[0];
    const current = page.properties[propName]?.number ?? 0;
    const newVal  = Math.max(0, current - qty);

    await fetch(`${NOTION_API}/pages/${page.id}`, {
      method: 'PATCH',
      headers: notionHdrs,
      body: JSON.stringify({
        properties: { [propName]: { number: newVal } },
      }),
    });

    console.log(`[sq-webhook] ${propName} "${item.name}" (${varId}): ${current} → ${newVal}`);
  }

  return ok();
}
