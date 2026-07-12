// ════════════════════════════════════════════
//  Notion Customers Proxy  —  /api/notion-customers
//  Cloudflare Pages Function
//  Requires env var: NOTION_TOKEN
// ════════════════════════════════════════════

import { json, notionHdrs, NOTION_API, CORS } from './_lib.js';

const DB_ID      = 'faf0854d-7495-41d1-b3a0-f117d0979b43';

function customerToProps(c) {
  return {
    'Name':         { title:        [{ text: { content: c.name || '' } }] },
    'Email':        { email:        c.email || null },
    'Phone':        { phone_number: c.phone || null },
    'Address':      { rich_text:    [{ text: { content: (c.address || '').slice(0, 2000) } }] },
    'Notes':        { rich_text:    [{ text: { content: (c.notes   || '').slice(0, 2000) } }] },
    'Total Orders': { number:       c.totalOrders ?? null },
    'Total Value':  { number:       c.totalValue  ?? null },
    'App ID':       { rich_text:    [{ text: { content: c.appId || '' } }] },
    ...(c.lastContact ? { 'Last Contact': { date: { start: c.lastContact } } } : {}),
  };
}

function pageToCustomer(page) {
  const p   = page.properties;
  const txt = prop => prop?.rich_text?.[0]?.plain_text || '';
  const ttl = prop => prop?.title?.[0]?.plain_text     || '';
  return {
    notionPageId: page.id,
    name:         ttl(p['Name']),
    email:        p['Email']?.email || '',
    phone:        p['Phone']?.phone_number || '',
    address:      txt(p['Address']),
    notes:        txt(p['Notes']),
    lastContact:  p['Last Contact']?.date?.start || '',
    totalOrders:  p['Total Orders']?.number ?? 0,
    totalValue:   p['Total Value']?.number  ?? 0,
    appId:        txt(p['App ID']),
  };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const hdrs = notionHdrs(token);

  // ── GET — fetch all customers ────────────────
  if (request.method === 'GET') {
    const customers = [];
    let cursor;
    do {
      const body = {
        page_size: 100,
        sorts: [{ property: 'Name', direction: 'ascending' }],
      };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
        method: 'POST', headers: hdrs, body: JSON.stringify(body),
      });
      const d = await r.json();
      (d.results || []).forEach(p => { if (!p.archived) customers.push(pageToCustomer(p)); });
      cursor = d.has_more ? d.next_cursor : null;
    } while (cursor);
    return json(customers);
  }

  // ── POST — upsert one customer (match by name) ──
  if (request.method === 'POST') {
    const customer = await request.json();
    const props    = customerToProps(customer);

    // If we already have the Notion page ID, patch directly
    if (customer.notionPageId) {
      const r = await fetch(`${NOTION_API}/pages/${customer.notionPageId}`, {
        method: 'PATCH', headers: hdrs,
        body: JSON.stringify({ properties: props, archived: false }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return json({ error: err.message || 'Notion patch failed' }, r.status);
      }
      return json({ notionPageId: customer.notionPageId });
    }

    // Search by name for an existing record
    const sr = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({
        filter: { property: 'Name', title: { equals: customer.name } },
        page_size: 1,
      }),
    });
    const sd       = await sr.json();
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

  // ── DELETE — archive by Notion page ID ──────
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
