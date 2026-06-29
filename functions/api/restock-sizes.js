// ════════════════════════════════════════════
//  Restock Queue Sizes  —  /api/restock-sizes
//  Stores chosen variant quantities { [pid]: { [variantId]: qty } }
//  as its own JSON blob, in its own Notion page (block = __rq_sizes__) —
//  deliberately separate from /api/restock-meta (assignees + order) so
//  a size-data overflow can never corrupt that unrelated, working data.
// ════════════════════════════════════════════

const NOTION_API  = 'https://api.notion.com/v1';
const NOTION_VER  = '2022-06-28';
const DB_ID       = 'fb115de8-4ac5-433d-84e6-1005f89ecdd2';
const SIZES_BLOCK = '__rq_sizes__';
// Notion title properties cap each rich_text segment at 2000 chars, but the
// array itself can hold up to 100 segments — split into chunks instead of
// capping at one segment's worth, or the store fills up after a couple
// dozen items and every PUT (incl. unrelated items) starts failing.
const MAX_LEN     = 100 * 2000;

function toTitleChunks(str) {
  const chunks = [];
  for (let i = 0; i < str.length; i += 2000) {
    chunks.push({ text: { content: str.slice(i, i + 2000) } });
  }
  return chunks.length ? chunks : [{ text: { content: '' } }];
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

async function findSizesPage(h) {
  const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      filter: { property: 'Block', select: { equals: SIZES_BLOCK } },
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

  // ── GET — load sizes ──────────────────────────
  if (request.method === 'GET') {
    const page = await findSizesPage(h);
    if (!page) return json({});
    const raw = (page.properties['Note']?.title || []).map(t => t.plain_text).join('') || '{}';
    try { return json(JSON.parse(raw)); }
    catch (e) { return json({}); }
  }

  // ── PUT — save sizes ──────────────────────────
  if (request.method === 'PUT') {
    const body = await request.json();
    const content = JSON.stringify(body);
    // Reject instead of silently truncating — a truncated JSON blob would
    // fail to parse on the next load and wipe everything in it, not just
    // whatever didn't fit.
    if (content.length > MAX_LEN) {
      return json({ error: 'Sizes data too large (' + content.length + '/' + MAX_LEN + ' chars) — not saved' }, 413);
    }
    const page = await findSizesPage(h);

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
            'Block': { select: { name: SIZES_BLOCK } },
            'Done':  { checkbox: false },
          },
        }),
      });
    }
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
