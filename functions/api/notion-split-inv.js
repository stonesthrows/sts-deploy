// ════════════════════════════════════════════
//  Split Inventory Proxy  —  /api/notion-split-inv
//  GET: return { [varId]: { you, georgina, pageId } } for all rows
//  Requires env vars: NOTION_TOKEN, NOTION_INVENTORY_DB_ID
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';

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

function hdrs(token) {
  return {
    'Authorization':  'Bearer ' + token,
    'Notion-Version': NOTION_VER,
    'Content-Type':   'application/json',
  };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const token = env.NOTION_TOKEN;
  const dbId  = env.NOTION_INVENTORY_DB_ID;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  if (!dbId)  return json({ error: 'NOTION_INVENTORY_DB_ID not set' }, 500);
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

  const h = hdrs(token);
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
