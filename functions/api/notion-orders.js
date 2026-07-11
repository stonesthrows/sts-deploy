// ════════════════════════════════════════════
//  Notion Orders Proxy  —  /api/notion-orders
//  Cloudflare Pages Function
//  Requires env var: NOTION_TOKEN
// ════════════════════════════════════════════

import { isNotionId } from './_notion.js';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DB_ID      = '3929d8fb-1b0f-8043-9425-d24d2bec3544';

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

function catSum(lineItems, cat) {
  if (!Array.isArray(lineItems)) return 0;
  return lineItems.reduce((s, li) => s + ((li.category === cat && li.amt != null) ? (parseFloat(li.amt) || 0) : 0), 0);
}

function orderToProps(o) {
  const label = [o.sup, o.orderNum || o.invNum].filter(Boolean).join(' — ') || 'Order';
  const lineItems = o.lineItems || [];
  return {
    'Order Label':    { title:     [{ text: { content: label } }] },
    'App ID':         { rich_text: [{ text: { content: o.id       || '' } }] },
    'Order Number':   { rich_text: [{ text: { content: o.orderNum || '' } }] },
    'Invoice Number': { rich_text: [{ text: { content: o.invNum   || '' } }] },
    'Notes':          { rich_text: [{ text: { content: (o.notes   || '').slice(0, 2000) } }] },
    'Line Items':     { rich_text: [{ text: { content: JSON.stringify(lineItems).slice(0, 2000) } }] },
    'Drive File ID':  { rich_text: [{ text: { content: o.driveFileId || '' } }] },
    'Date':           o.date ? { date: { start: o.date } } : { date: null },
    'Supplier':       o.sup  ? { select: { name: o.sup } } : { select: null },
    'Amount':         o.amt  != null ? { number: o.amt } : { number: null },
    'Materials':      { number: catSum(lineItems, 'Materials') },
    'Tools':          { number: catSum(lineItems, 'Tools') },
    'Shipping':       { number: catSum(lineItems, 'Shipping') },
    'Other Amt':      { number: catSum(lineItems, 'Other') },
  };
}

function pageToOrder(page) {
  const p   = page.properties;
  const txt = (prop) => prop?.rich_text?.[0]?.plain_text || '';
  const sel = (prop) => prop?.select?.name  || '';
  const dt  = (prop) => prop?.date?.start   || '';
  const num = (prop) => (prop?.number != null ? prop.number : null);
  const appId = txt(p['App ID']);
  let lineItems = [];
  try { lineItems = JSON.parse(txt(p['Line Items']) || '[]'); } catch (e) { lineItems = []; }
  return {
    id:           appId || ('n_' + page.id.replace(/-/g, '')),
    notionPageId: page.id,
    date:         dt (p['Date']),
    sup:          sel(p['Supplier']),
    orderNum:     txt(p['Order Number']),
    invNum:       txt(p['Invoice Number']),
    amt:          num(p['Amount']),
    notes:        txt(p['Notes']),
    lineItems:    lineItems,
    driveFileId:  txt(p['Drive File ID']) || null,
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const token = context.env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const hdrs = notionHdrs(token);

  const orders = [];
  let cursor;
  do {
    const body = { page_size: 100, sorts: [{ property: 'Date', direction: 'descending' }] };
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

export async function onRequestPost(context) {
  const token = context.env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const hdrs = notionHdrs(token);

  const order = await context.request.json();
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    return json({ error: 'invalid order payload' }, 400);
  }
  const props = orderToProps(order);

  // If we already know the Notion page ID, patch it directly
  if (order.notionPageId) {
    if (!isNotionId(order.notionPageId)) return json({ error: 'invalid notionPageId' }, 400);
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

  // No notionPageId — create new page directly
  const cr = await fetch(`${NOTION_API}/pages`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ parent: { database_id: DB_ID }, properties: props }),
  });
  const cd = await cr.json();
  if (!cr.ok) return json({ error: cd.message || 'Notion create failed' }, cr.status);
  return json({ notionPageId: cd.id });
}

export async function onRequestDelete(context) {
  const token = context.env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const hdrs = notionHdrs(token);

  const pageId = new URL(context.request.url).searchParams.get('pageId');
  if (!pageId) return json({ error: 'pageId required' }, 400);
  if (!isNotionId(pageId)) return json({ error: 'invalid pageId' }, 400);
  await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: 'PATCH', headers: hdrs,
    body: JSON.stringify({ archived: true }),
  });
  return json({ ok: true });
}
