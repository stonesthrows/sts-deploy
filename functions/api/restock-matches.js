// ════════════════════════════════════════════
//  Restock Queue Square Matches  —  /api/restock-matches
//  Stores the chosen Square catalog match per queue item
//  { [pid]: { id, name, category, sku, isParent, variants?, modifierLists?, isCustom? } }
//  as its own JSON blob, in its own Notion page (block = __rq_matches__) —
//  deliberately separate from /api/restock-meta (assignees + order) so
//  a match-data overflow can never corrupt that unrelated, working data.
//
//  Before this store existed, the match choice lived only in each browser's
//  localStorage (sts_rqAutoMatch) — an item picked on the desktop never
//  reached the phone/iPad, which re-ran auto-match and often landed on a
//  different Square item, so the saved sizes couldn't resolve either.
// ════════════════════════════════════════════

import { json, notionHdrs as hdrs, NOTION_API, CORS } from './_lib.js';

const DB_ID         = 'fb115de8-4ac5-433d-84e6-1005f89ecdd2';
const MATCHES_BLOCK = '__rq_matches__';
// Notion title properties cap each rich_text segment at 2000 chars, but the
// array itself can hold up to 100 segments — split into chunks instead of
// capping at one segment's worth (matches carry variant lists, so they're
// the largest of the rq blobs).
const MAX_LEN       = 100 * 2000;

function toTitleChunks(str) {
  const chunks = [];
  for (let i = 0; i < str.length; i += 2000) {
    chunks.push({ text: { content: str.slice(i, i + 2000) } });
  }
  return chunks.length ? chunks : [{ text: { content: '' } }];
}

async function findMatchesPage(h) {
  const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      filter: { property: 'Block', select: { equals: MATCHES_BLOCK } },
      page_size: 1,
    }),
  });
  const d = await r.json();
  return (d.results || [])[0] || null;
}

function parsePage(page) {
  const raw = (page.properties['Note']?.title || []).map(t => t.plain_text).join('') || '{}';
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

async function writeMatches(h, page, content) {
  if (page) {
    await fetch(`${NOTION_API}/pages/${page.id}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({
        properties: {
          'Note': { title: toTitleChunks(content) },
        },
      }),
    });
  } else {
    await fetch(`${NOTION_API}/pages`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        parent: { database_id: DB_ID },
        properties: {
          'Note':  { title: toTitleChunks(content) },
          'Block': { select: { name: MATCHES_BLOCK } },
          'Done':  { checkbox: false },
        },
      }),
    });
  }
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const h = hdrs(token);

  // ── GET — load matches ────────────────────────
  if (request.method === 'GET') {
    const page = await findMatchesPage(h);
    if (!page) return json({});
    return json(parsePage(page));
  }

  // ── PUT — save the whole map ──────────────────
  if (request.method === 'PUT') {
    const body = await request.json();
    const content = JSON.stringify(body);
    // Reject instead of silently truncating — a truncated JSON blob would
    // fail to parse on the next load and wipe everything in it, not just
    // whatever didn't fit.
    if (content.length > MAX_LEN) {
      return json({ error: 'Matches data too large (' + content.length + '/' + MAX_LEN + ' chars) — not saved' }, 413);
    }
    const page = await findMatchesPage(h);
    await writeMatches(h, page, content);
    return json({ ok: true });
  }

  // ── PATCH — merge a partial update { [pid]: match | null } ──
  // Read-merge-write on the server so a client only ever sends the items it
  // actually changed — two devices editing different items can't clobber
  // each other the way whole-map PUTs from stale snapshots do.
  if (request.method === 'PATCH') {
    const patch = await request.json();
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return json({ error: 'PATCH body must be an object of { pid: match | null }' }, 400);
    }
    const page = await findMatchesPage(h);
    const current = page ? parsePage(page) : {};
    for (const pid of Object.keys(patch)) {
      if (patch[pid] === null) delete current[pid];
      else current[pid] = patch[pid];
    }
    const content = JSON.stringify(current);
    if (content.length > MAX_LEN) {
      return json({ error: 'Matches data too large (' + content.length + '/' + MAX_LEN + ' chars) — not saved' }, 413);
    }
    await writeMatches(h, page, content);
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
