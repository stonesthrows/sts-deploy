// ════════════════════════════════════════════
//  Split Inventory Proxy  —  /api/notion-split-inv
//  GET:   return { [varId]: { you, georgina, pageId } } for all rows
//  POST:  create a new row { varId, name, you, georgina } → { ok, pageId }
//  PATCH: update an existing row { pageId, you, georgina } → { ok }
//  Requires env vars: NOTION_TOKEN, NOTION_INVENTORY_DB_ID
// ════════════════════════════════════════════

import { json, notionHdrs as hdrs, NOTION_API, CORS } from './_lib.js';


export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const token = env.NOTION_TOKEN;
  const dbId  = env.NOTION_INVENTORY_DB_ID;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  if (!dbId)  return json({ error: 'NOTION_INVENTORY_DB_ID not set' }, 500);

  const h = hdrs(token);

  // ── PATCH — update an existing row ──────────────────────────────────────────
  if (request.method === 'PATCH') {
    const { pageId, you, georgina } = await request.json();
    if (!pageId) return json({ error: 'pageId required' }, 400);
    const r = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({
        properties: {
          'Current Stock: You':      { number: Math.max(0, you      ?? 0) },
          'Current Stock: Georgina': { number: Math.max(0, georgina ?? 0) },
        },
      }),
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.message || 'update failed' }, r.status);
    return json({ ok: true });
  }

  // ── POST — create a new row ──────────────────────────────────────────────────
  if (request.method === 'POST') {
    const { varId, name, you, georgina } = await request.json();
    if (!varId) return json({ error: 'varId required' }, 400);
    const r = await fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: {
          'Name': { title: [{ text: { content: name || varId } }] },
          'SKU':  { rich_text: [{ text: { content: varId } }] },
          'Current Stock: You':      { number: Math.max(0, you      ?? 0) },
          'Current Stock: Georgina': { number: Math.max(0, georgina ?? 0) },
        },
      }),
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.message || 'create failed' }, r.status);
    return json({ ok: true, pageId: d.id });
  }

  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

  // ── GET — return all split rows keyed by SKU (= Square varId) ───────────────
  const result = {};
  let cursor;
  let pages = 0;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const r = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: 'POST', headers: h, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.message || 'query failed' }, r.status);

    for (const page of (d.results || [])) {
      if (page.archived) continue;
      const p   = page.properties;
      const sku = p['SKU']?.rich_text?.[0]?.plain_text || '';
      if (!sku) continue;
      result[sku] = {
        you:      p['Current Stock: You']?.number ?? 0,
        georgina: p['Current Stock: Georgina']?.number ?? 0,
        pageId:   page.id,
      };
    }

    cursor = d.has_more ? d.next_cursor : null;
    pages++;
  } while (cursor && pages < 10);

  return json(result);
}
