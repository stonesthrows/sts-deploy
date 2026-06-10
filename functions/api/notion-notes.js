// ════════════════════════════════════════════
//  Notion Notes Proxy  —  /api/notion-notes
//  Cloudflare Pages Function
//  Requires env var: NOTION_TOKEN
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DB_ID      = 'fb115de8-4ac5-433d-84e6-1005f89ecdd2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

const META_BLOCK = '__rq_meta__';

function pageToNote(page) {
  const p = page.properties;
  return {
    notionPageId: page.id,
    text:    p['Note']?.title?.[0]?.plain_text || '',
    block:   p['Block']?.select?.name          || '',
    done:    p['Done']?.checkbox               || false,
    created: page.created_time,
  };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const h = hdrs(token);

  // ── GET — fetch all notes ────────────────────
  if (request.method === 'GET') {
    const notes = [];
    let cursor;
    do {
      const body = {
        page_size: 100,
        sorts: [{ property: 'Created', direction: 'ascending' }],
      };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
        method: 'POST', headers: h, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.message || 'Notion query failed', code: d.code, status: r.status }, r.status);
      (d.results || []).forEach(p => {
        if (!p.archived && p.properties['Block']?.select?.name !== META_BLOCK)
          notes.push(pageToNote(p));
      });
      cursor = d.has_more ? d.next_cursor : null;
    } while (cursor);
    return json(notes);
  }

  // ── POST — create a note ─────────────────────
  if (request.method === 'POST') {
    const { text, block } = await request.json();
    if (!text || !block) return json({ error: 'text and block required' }, 400);
    const r = await fetch(`${NOTION_API}/pages`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        parent: { database_id: DB_ID },
        properties: {
          'Note':  { title:  [{ text: { content: text.slice(0, 2000) } }] },
          'Block': { select: { name: block } },
          'Done':  { checkbox: false },
        },
      }),
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.message || 'create failed' }, r.status);
    return json({ notionPageId: d.id });
  }

  const pageId = new URL(request.url).searchParams.get('pageId');
  if (!pageId) return json({ error: 'pageId required' }, 400);

  // ── PATCH — update note fields ───────────────
  if (request.method === 'PATCH') {
    const body = await request.json();
    const props = {};
    if ('done'  in body) props['Done']  = { checkbox: !!body.done };
    if ('block' in body) props['Block'] = { select: { name: body.block } };
    if ('text'  in body) props['Note']  = { title: [{ text: { content: String(body.text).slice(0, 2000) } }] };
    const r = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ properties: props }),
    });
    if (!r.ok) return json({ error: 'patch failed' }, r.status);
    return json({ ok: true });
  }

  // ── DELETE — archive ─────────────────────────
  if (request.method === 'DELETE') {
    const r = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ archived: true }),
    });
    if (!r.ok) return json({ error: 'delete failed' }, r.status);
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
