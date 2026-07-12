// ════════════════════════════════════════════
//  Restock Queue Aggregate Read  —  /api/restock-all
//  Read-only. Returns { meta, sizes, notes, matches } in ONE Notion DB query
//  instead of four separate GETs (restock-meta + restock-sizes +
//  restock-notes + restock-matches).
//  Writes are DELIBERATELY left on the separate endpoints so a size- or
//  notes-overflow can never corrupt the meta blob — see those files' headers.
// ════════════════════════════════════════════

import { json, notionHdrs as hdrs, NOTION_API, CORS } from './_lib.js';

const DB_ID       = 'fb115de8-4ac5-433d-84e6-1005f89ecdd2';
const META_BLOCK    = '__rq_meta__';
const SIZES_BLOCK   = '__rq_sizes__';
const NOTES_BLOCK   = '__rq_notes__';
const MATCHES_BLOCK = '__rq_matches__';

// Join every title rich_text segment (sizes can span up to 100 chunks) then
// parse — mirrors the read logic in restock-sizes.js / restock-notes.js.
function parseNote(page) {
  const raw = ((page.properties['Note']?.title) || []).map(t => t.plain_text).join('') || '{}';
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const h = hdrs(token);

  const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      filter: { or: [
        { property: 'Block', select: { equals: META_BLOCK } },
        { property: 'Block', select: { equals: SIZES_BLOCK } },
        { property: 'Block', select: { equals: NOTES_BLOCK } },
        { property: 'Block', select: { equals: MATCHES_BLOCK } },
      ] },
      page_size: 10,
    }),
  });
  const d = await r.json();
  const results = d.results || [];

  const byBlock = {};
  for (const page of results) {
    const block = page.properties['Block']?.select?.name;
    if (block && !byBlock[block]) byBlock[block] = parseNote(page);
  }

  return json({
    meta:    byBlock[META_BLOCK]    || {},
    sizes:   byBlock[SIZES_BLOCK]   || {},
    notes:   byBlock[NOTES_BLOCK]   || {},
    matches: byBlock[MATCHES_BLOCK] || {},
  });
}
