// ════════════════════════════════════════════
//  Push Subscription Registry  —  /api/push-subscribe
//  Cloudflare Pages Function
//  Requires env var: NOTION_TOKEN
//
//  Stores/removes browser PushSubscription objects in the "STS Push
//  Subscriptions" Notion database, one row per device. Read back by
//  notion-messages.js when a Team Message is posted, to deliver a Web
//  Push notification to every subscribed device (see js/push-notify.js
//  for the client side).
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DB_ID      = 'aa8e0af3-4981-4156-8f62-855f0a914fb0';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function hdrs(token) {
  return {
    'Authorization':  'Bearer ' + token,
    'Notion-Version': NOTION_VER,
    'Content-Type':   'application/json',
  };
}

async function findByEndpoint(h, endpoint) {
  const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      filter:    { property: 'Endpoint', title: { equals: endpoint } },
      page_size: 1,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || 'Notion query failed');
  return (d.results || [])[0] || null;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    return await _handle({ request, env });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

async function _handle({ request, env }) {
  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const h = hdrs(token);

  // ── POST — register (or refresh) a subscription ──
  if (request.method === 'POST') {
    const { endpoint, keys, ownerName } = await request.json();
    const p256dh = keys && keys.p256dh;
    const auth   = keys && keys.auth;
    if (!endpoint || !p256dh || !auth) return json({ error: 'endpoint and keys.p256dh/auth required' }, 400);

    const existing = await findByEndpoint(h, endpoint);
    const properties = {
      'Endpoint':   { title:     [{ text: { content: String(endpoint).slice(0, 2000) } }] },
      'P256dh':     { rich_text: [{ text: { content: String(p256dh).slice(0, 500) } }] },
      'Auth':       { rich_text: [{ text: { content: String(auth).slice(0, 500) } }] },
      'Owner Name': { rich_text: ownerName ? [{ text: { content: String(ownerName).slice(0, 100) } }] : [] },
    };

    if (existing) {
      const r = await fetch(`${NOTION_API}/pages/${existing.id}`, {
        method: 'PATCH', headers: h, body: JSON.stringify({ properties }),
      });
      if (!r.ok) { const d = await r.json(); return json({ error: d.message || 'update failed' }, r.status); }
      return json({ notionPageId: existing.id });
    }

    const r = await fetch(`${NOTION_API}/pages`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        parent: { database_id: DB_ID },
        properties: { ...properties, 'Created': { date: { start: new Date().toISOString() } } },
      }),
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.message || 'create failed' }, r.status);
    return json({ notionPageId: d.id });
  }

  // ── DELETE — unsubscribe this device ─────────
  if (request.method === 'DELETE') {
    const { endpoint } = await request.json();
    if (!endpoint) return json({ error: 'endpoint required' }, 400);
    const existing = await findByEndpoint(h, endpoint);
    if (!existing) return json({ ok: true }); // already gone
    const r = await fetch(`${NOTION_API}/pages/${existing.id}`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ archived: true }),
    });
    if (!r.ok) return json({ error: 'delete failed' }, r.status);
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
