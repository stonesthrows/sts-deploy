// ════════════════════════════════════════════
//  Restock Queue Urgent Flags  —  /api/restock-urgent
//  Stores { [pid]: true } for queue items marked Urgent, as its own JSON
//  blob in its own Notion page (block = __rq_urgent__) — kept separate from
//  /api/restock-meta (assignees + order) so this store can never overflow
//  or corrupt that unrelated, working data. Same pattern as restock-notes.
// ════════════════════════════════════════════

const NOTION_API   = 'https://api.notion.com/v1';
const NOTION_VER   = '2022-06-28';
const DB_ID        = 'fb115de8-4ac5-433d-84e6-1005f89ecdd2';
const URGENT_BLOCK = '__rq_urgent__';
const MAX_LEN      = 2000; // Notion title rich_text segment limit

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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

async function findUrgentPage(h) {
  const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      filter: { property: 'Block', select: { equals: URGENT_BLOCK } },
      page_size: 1,
    }),
  });
  const d = await r.json();
  return (d.results || [])[0] || null;
}

function parsePage(page) {
  if (!page) return {};
  const raw = ((page.properties['Note']?.title) || []).map(t => t.plain_text).join('') || '{}';
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

async function writeUrgent(h, page, content) {
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
          'Block': { select: { name: URGENT_BLOCK } },
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

  // ── GET — load urgent flags ───────────────────
  if (request.method === 'GET') {
    return json(parsePage(await findUrgentPage(h)));
  }

  // ── PATCH — merge { [pid]: true | null } ──────
  // Read-merge-write on the server so two devices flagging different items
  // can't clobber each other.
  if (request.method === 'PATCH') {
    const patch = await request.json();
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return json({ error: 'PATCH body must be an object of { pid: true | null }' }, 400);
    }
    const page = await findUrgentPage(h);
    const current = parsePage(page);
    for (const pid of Object.keys(patch)) {
      if (patch[pid]) current[pid] = true;
      else delete current[pid];
    }
    const content = JSON.stringify(current);
    // Reject instead of truncating — a truncated blob would fail to parse
    // on the next load and drop every flag, not just the overflow.
    if (content.length > MAX_LEN) {
      return json({ error: 'Too many urgent items (' + content.length + '/' + MAX_LEN + ' chars) — not saved' }, 413);
    }
    await writeUrgent(h, page, content);
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
