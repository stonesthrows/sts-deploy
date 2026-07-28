// ════════════════════════════════════════════
//  Customer Messages Proxy  —  /api/notion-messages
//  Cloudflare Pages Function
//  Requires env var: NOTION_TOKEN
//
//  Internal-staff Q&A thread per customer (Customer Card "Team Messages"),
//  stored as flat records in a dedicated Notion database — same shape as
//  notion-notes.js, just different properties.
//
//  SMS notify on new message (optional): reuses the Twilio number already
//  wired for inbound SMS-to-notes (see sms-note.js). Requires env vars
//  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_NOTIFY_TO
//  — silently skipped (message send still succeeds) if any are unset, so
//  this stays a no-op until someone opts in via Cloudflare Pages env vars.
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
// "STS Customer Messages" — properties: Text (title), Customer Key,
// Customer Name, Author (rich text), Created (date).
const DB_ID      = 'e5a38cb3-7845-4ee7-94e7-ef6dcebf101d';

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

function pageToMessage(page) {
  const p = page.properties;
  return {
    notionPageId: page.id,
    text:         p['Text']?.title?.[0]?.plain_text         || '',
    customerKey:  p['Customer Key']?.rich_text?.[0]?.plain_text  || '',
    customerName: p['Customer Name']?.rich_text?.[0]?.plain_text || '',
    author:       p['Author']?.rich_text?.[0]?.plain_text        || '',
    orderId:      p['Order Id']?.rich_text?.[0]?.plain_text      || '',
    orderLabel:   p['Order Label']?.rich_text?.[0]?.plain_text   || '',
    createdAt:    p['Created']?.date?.start || page.created_time,
  };
}

// Fire-and-forget SMS via Twilio's REST API. Never throws — a notify
// failure must not fail the underlying message send. Silently no-ops if
// the Twilio env vars aren't configured, so this feature stays opt-in.
async function notifySms(env, { customerName, author, text, orderLabel }) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM_NUMBER: from, TWILIO_NOTIFY_TO: to } = env;
  if (!sid || !token || !from || !to) return;
  // Lets the notify recipient send their own messages (e.g. replying to
  // staff) without texting themselves.
  if (env.TWILIO_NOTIFY_SKIP_AUTHOR && String(author || '').trim().toLowerCase() === env.TWILIO_NOTIFY_SKIP_AUTHOR.trim().toLowerCase()) return;

  const body = `💬 ${author || 'Someone'} on ${customerName}${orderLabel ? ' (' + orderLabel + ')' : ''}: ${text}`.slice(0, 300);
  try {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(sid + ':' + token),
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
  } catch (err) {
    console.error('notion-messages SMS notify failed:', err);
  }
}

export async function onRequest({ request, env, waitUntil }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    return await _handle({ request, env, waitUntil });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

async function _handle({ request, env, waitUntil }) {
  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const h = hdrs(token);

  // ── GET — fetch all messages (client filters by customer) ───
  if (request.method === 'GET') {
    const messages = [];
    let cursor;
    do {
      const body = {
        page_size: 100,
        sorts: [{ property: 'Created', direction: 'ascending' }],
      };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
        method: 'POST', headers: h, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.message || 'Notion query failed', code: d.code, status: r.status }, r.status);
      (d.results || []).forEach(p => { if (!p.archived) messages.push(pageToMessage(p)); });
      cursor = d.has_more ? d.next_cursor : null;
    } while (cursor);
    return json(messages);
  }

  // ── POST — create a message ──────────────────
  if (request.method === 'POST') {
    const { customerKey, customerName, author, text, orderId, orderLabel, createdAt } = await request.json();
    if (!customerKey || !text) return json({ error: 'customerKey and text required' }, 400);
    const r = await fetch(`${NOTION_API}/pages`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        parent: { database_id: DB_ID },
        properties: {
          'Text':          { title:     [{ text: { content: String(text).slice(0, 2000) } }] },
          'Customer Key':  { rich_text: [{ text: { content: String(customerKey).slice(0, 200) } }] },
          'Customer Name': { rich_text: [{ text: { content: String(customerName || '').slice(0, 200) } }] },
          'Author':        { rich_text: [{ text: { content: String(author || '').slice(0, 100) } }] },
          'Order Id':      { rich_text: orderId    ? [{ text: { content: String(orderId).slice(0, 200) } }]    : [] },
          'Order Label':   { rich_text: orderLabel ? [{ text: { content: String(orderLabel).slice(0, 200) } }] : [] },
          'Created':       { date: { start: createdAt || new Date().toISOString() } },
        },
      }),
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.message || 'create failed' }, r.status);
    waitUntil(notifySms(env, { customerName, author, text, orderLabel }));
    return json({ notionPageId: d.id });
  }

  // ── DELETE — archive ─────────────────────────
  if (request.method === 'DELETE') {
    const pageId = new URL(request.url).searchParams.get('pageId');
    if (!pageId) return json({ error: 'pageId required' }, 400);
    const r = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ archived: true }),
    });
    if (!r.ok) return json({ error: 'delete failed' }, r.status);
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
