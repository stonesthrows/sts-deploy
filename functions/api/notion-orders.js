// ════════════════════════════════════════════
//  Notion Orders Proxy  —  /api/notion-orders
//  Cloudflare Pages Function
//  Requires env var: NOTION_TOKEN
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DB_ID      = 'ce32844c-fd51-4a3c-87a5-30ae79e16f8d';

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

function notionHdrs(token) {
  return {
    'Authorization':   'Bearer ' + token,
    'Notion-Version':  NOTION_VER,
    'Content-Type':    'application/json',
  };
}

function orderToProps(o) {
  const label = [o.sup, o.orderNum || o.invNum].filter(Boolean).join(' — ') || 'Order';
  return {
    'Order Label':    { title:     [{ text: { content: label } }] },
    'App ID':         { rich_text: [{ text: { content: o.id       || '' } }] },
    'Order Number':   { rich_text: [{ text: { content: o.orderNum || '' } }] },
    'Invoice Number': { rich_text: [{ text: { content: o.invNum   || '' } }] },
    'Notes':          { rich_text: [{ text: { content: (o.notes   || '').slice(0, 2000) } }] },
    'Date':           o.date ? { date: { start: o.date } } : { date: null },
    'Supplier':       o.sup  ? { select: { name: o.sup } } : { select: null },
    'Amount':         o.amt  != null ? { number: o.amt } : { number: null },
  };
}

function pageToOrder(page) {
  const p   = page.properties;
  const txt = (prop) => prop?.rich_text?.[0]?.plain_text || '';
  const sel = (prop) => prop?.select?.name  || '';
  const dt  = (prop) => prop?.date?.start   || '';
  const num = (prop) => (prop?.number != null ? prop.number : null);
  const appId = txt(p['App ID']);
  return {
    id:           appId || ('n_' + page.id.replace(/-/g, '')),
    notionPageId: page.id,
    date:         dt (p['Date']),
    sup:          sel(p['Supplier']),
    orderNum:     txt(p['Order Number']),
    invNum:       txt(p['Invoice Number']),
    amt:          num(p['Amount']),
    notes:        txt(p['Notes']),
  };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set in Cloudflare Pages env vars' }, 500);
  const hdrs = notionHdrs(token);

  // ── GET — fetch all orders ───────────────────
  if (request.method === 'GET') {
    const orders = [];
    let cursor;
    do {
      const body = {
        page_size: 100,
        sorts: [{ property: 'Date', direction: 'descending' }],
      };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
        method: 'POST', headers: hdrs, body: JSON.stringify(body),
      });
      const d = await r.json();
      (d.results || []).forEach(p => { if (!p.archived) orders.push(pageToOrder(p)); });
      cursor = d.has_more ? d.next_cursor : null;
    } while (cursor);
    return json(orders);
  }

  // ── POST — upsert one order ──────────────────
  if (request.method === 'POST') {
    const order = await request.json();
    const props = orderToProps(order);

    // If we already know the Notion page ID, patch it directly
    if (order.notionPageId) {
      const r = await fetch(`${NOTION_API}/pages/${order.notionPageId}`, {
        method: 'PATCH', headers: hdrs,
        body: JSON.stringify({ properties: props, archived: false }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return json({ error: err.message || 'Notion patch failed' }, r.status);
      }
      return json({ notionPageId: order.notionPageId });
    }

    // Search by App ID to find an existing page
    const sr = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({
        filter: { property: 'App ID', rich_text: { equals: order.id } },
        page_size: 1,
      }),
    });
    const sd  = await sr.json();
    const existing = (sd.results || []).find(p => !p.archived);

    if (existing) {
      await fetch(`${NOTION_API}/pages/${existing.id}`, {
        method: 'PATCH', headers: hdrs,
        body: JSON.stringify({ properties: props, archived: false }),
      });
      return json({ notionPageId: existing.id });
    }

    // Create new page
    const cr = await fetch(`${NOTION_API}/pages`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ parent: { database_id: DB_ID }, properties: props }),
    });
    const cd = await cr.json();
    if (!cr.ok) return json({ error: cd.message || 'Notion create failed' }, cr.status);
    return json({ notionPageId: cd.id });
  }

  // ── DELETE — archive one order by Notion page ID ──
  if (request.method === 'DELETE') {
    const pageId = new URL(request.url).searchParams.get('pageId');
    if (!pageId) return json({ error: 'pageId required' }, 400);
    await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH', headers: hdrs,
      body: JSON.stringify({ archived: true }),
    });
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
