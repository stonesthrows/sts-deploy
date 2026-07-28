// ════════════════════════════════════════════
//  Customer Messages Proxy  —  /api/notion-messages
//  Cloudflare Pages Function
//  Requires env var: NOTION_TOKEN
//
//  Internal-staff Q&A thread per customer (Customer Card "Team Messages"),
//  stored as flat records in a dedicated Notion database — same shape as
//  notion-notes.js, just different properties.
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
