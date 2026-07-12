// ════════════════════════════════════════════
//  Restock Queue Meta  —  /api/restock-meta
//  Stores assignees + sort order as a JSON blob
//  in a dedicated Notion page (block = __rq_meta__)
// ════════════════════════════════════════════

import { json, notionHdrs as hdrs, NOTION_API, CORS } from './_lib.js';

const DB_ID      = 'fb115de8-4ac5-433d-84e6-1005f89ecdd2';
const META_BLOCK = '__rq_meta__';

async function findMetaPage(h) {
  const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      filter: { property: 'Block', select: { equals: META_BLOCK } },
      page_size: 1,
    }),
  });
  const d = await r.json();
  return (d.results || [])[0] || null;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const h = hdrs(token);

  // ── GET — load meta ──────────────────────────
  if (request.method === 'GET') {
    const page = await findMetaPage(h);
    if (!page) return json({});
    const raw = page.properties['Note']?.title?.[0]?.plain_text || '{}';
    try { return json(JSON.parse(raw)); }
    catch(e) { return json({}); }
  }

  // ── PUT — save meta ──────────────────────────
  if (request.method === 'PUT') {
    const body = await request.json();
    const content = JSON.stringify(body).slice(0, 2000);
    const page = await findMetaPage(h);

    if (page) {
      await fetch(`${NOTION_API}/pages/${page.id}`, {
        method: 'PATCH', headers: h,
        body: JSON.stringify({
          properties: {
            'Note':  { title: [{ text: { content } }] },
          },
        }),
      });
    } else {
      await fetch(`${NOTION_API}/pages`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          parent: { database_id: DB_ID },
          properties: {
            'Note':  { title: [{ text: { content } }] },
            'Block': { select: { name: META_BLOCK } },
            'Done':  { checkbox: false },
          },
        }),
      });
    }
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
