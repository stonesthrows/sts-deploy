// ════════════════════════════════════════════
//  Restock Queue Notes  —  /api/restock-notes
//  Stores free-text notes { [pid]: noteText } as its own JSON blob, in its
//  own Notion page (block = __rq_notes__) — deliberately separate from
//  /api/restock-meta (assignees + order) so a notes overflow can never
//  corrupt that unrelated, working data.
// ════════════════════════════════════════════

const NOTION_API  = 'https://api.notion.com/v1';
const NOTION_VER  = '2022-06-28';
const DB_ID       = 'fb115de8-4ac5-433d-84e6-1005f89ecdd2';
const NOTES_BLOCK = '__rq_notes__';
const MAX_LEN     = 2000; // Notion title rich_text segment limit

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

async function findNotesPage(h) {
  const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      filter: { property: 'Block', select: { equals: NOTES_BLOCK } },
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

  // ── GET — load notes ──────────────────────────
  if (request.method === 'GET') {
    const page = await findNotesPage(h);
    if (!page) return json({});
    const raw = page.properties['Note']?.title?.[0]?.plain_text || '{}';
    try { return json(JSON.parse(raw)); }
    catch (e) { return json({}); }
  }

  // ── PUT — save notes ──────────────────────────
  if (request.method === 'PUT') {
    const body = await request.json();
    const content = JSON.stringify(body);
    // Reject instead of silently truncating — a truncated JSON blob would
    // fail to parse on the next load and wipe everything in it, not just
    // whatever didn't fit.
    if (content.length > MAX_LEN) {
      return json({ error: 'Notes data too large (' + content.length + '/' + MAX_LEN + ' chars) — not saved' }, 413);
    }
    const page = await findNotesPage(h);

    if (page) {
      await fetch(`${NOTION_API}/pages/${page.id}`, {
        method: 'PATCH', headers: h,
        body: JSON.stringify({
          properties: {
            'Note': { title: [{ text: { content } }] },
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
            'Block': { select: { name: NOTES_BLOCK } },
            'Done':  { checkbox: false },
          },
        }),
      });
    }
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
