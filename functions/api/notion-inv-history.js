// ════════════════════════════════════════════
//  Inventory History Proxy  —  /api/notion-inv-history
//  POST: log an inventory adjustment
//  GET:  return last entry per item ID (for cache warming)
//  Requires env var: NOTION_TOKEN
// ════════════════════════════════════════════

import { json, notionHdrs as hdrs, NOTION_API, CORS } from './_lib.js';

const DB_ID      = '0061bb3fc1994aa8a8008c69d6b2170a';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const h = hdrs(token);

  // ── POST — log an inventory change ──────────────────────────────────────────
  if (request.method === 'POST') {
    const { itemId, itemName, varName, prevQty, newQty, delta, category } = await request.json();
    if (!itemId || !itemName) return json({ error: 'itemId and itemName required' }, 400);

    const r = await fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        parent: { database_id: DB_ID },
        properties: {
          'Item Name':    { title:     [{ text: { content: String(itemName).slice(0, 2000) } }] },
          'Item ID':      { rich_text: [{ text: { content: String(itemId) } }] },
          'Variation':    { rich_text: [{ text: { content: String(varName || '') } }] },
          'Delta':        { number: delta },
          'Previous Qty': { number: prevQty },
          'New Qty':      { number: newQty },
          'Date':         { date: { start: new Date().toISOString().split('T')[0] } },
          'Category':     { rich_text: [{ text: { content: String(category || '') } }] },
        },
      }),
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.message || 'create failed' }, r.status);
    return json({ ok: true });
  }

  // ── GET — return last day's net delta per item+variation ────────────────────
  if (request.method === 'GET') {
    const lastByVar = {}; // key: itemId::varName
    let cursor;
    let pages = 0;
    do {
      const body = {
        page_size: 100,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
        method: 'POST', headers: h, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.message || 'query failed' }, r.status);
      for (const page of (d.results || [])) {
        if (page.archived) continue;
        const p      = page.properties;
        const iid    = p['Item ID']?.rich_text?.[0]?.plain_text || '';
        if (!iid) continue;
        const vname  = p['Variation']?.rich_text?.[0]?.plain_text || '';
        const key    = iid + '::' + vname;
        const isoDate = p['Date']?.date?.start || page.created_time.split('T')[0];
        const delta  = p['Delta']?.number ?? 0;
        const existing = lastByVar[key];
        if (!existing) {
          lastByVar[key] = {
            itemId: iid, varName: vname, delta, isoDate,
            category: p['Category']?.rich_text?.[0]?.plain_text || '',
          };
        } else if (isoDate === existing.isoDate) {
          // Same day as the most recent entry for this variation — accumulate.
          existing.delta += delta;
        }
      }
      cursor = d.has_more ? d.next_cursor : null;
      pages++;
    } while (cursor && pages < 10);
    return json(lastByVar);
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
