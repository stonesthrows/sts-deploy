// ════════════════════════════════════════════
//  Notion BGAB Proxy  —  /api/notion-bgab
//  Cloudflare Pages Function
//  Requires env var: NOTION_TOKEN
//
//  GET              → list all non-archived events (no data payload)
//  GET ?id=PAGE_ID  → single event with full data JSON
//  POST             → create event { name, type, year, data }
//  PATCH ?id=       → update { name?, type?, year?, data? }
//  DELETE ?id=      → soft delete (set Archived = true)
// ════════════════════════════════════════════

import { json, notionHdrs as hdrs, NOTION_API, CORS } from './_lib.js';

const DB_ID      = '814e07ea9b0e441bae10e2851e50697a';

// Notion rich_text has a 2000-char limit per block — split into chunks
function toRichText(str) {
  const chunks = [];
  for (let i = 0; i < str.length; i += 2000) {
    chunks.push({ text: { content: str.slice(i, i + 2000) } });
  }
  return chunks.length ? chunks : [{ text: { content: '' } }];
}

function pageToEvent(page, includeData = true) {
  const p = page.properties;
  const ev = {
    notionPageId: page.id,
    name:   p['Name']?.title?.[0]?.plain_text  || '',
    type:   p['Type']?.select?.name            || '',
    year:   p['Year']?.number                  ?? null,
  };
  if (includeData) {
    const raw = (p['Data']?.rich_text || []).map(r => r.plain_text).join('');
    try { ev.data = raw ? JSON.parse(raw) : { items: [] }; } catch { ev.data = { items: [] }; }
  }
  return ev;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    return await _handle({ request, env });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

async function _handle({ request, env }) {
  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const h   = hdrs(token);
  const url = new URL(request.url);
  const id  = url.searchParams.get('id');

  // ── GET ──────────────────────────────────────
  if (request.method === 'GET') {
    if (id) {
      // Single event with full data
      const r = await fetch(`${NOTION_API}/pages/${id}`, { headers: h });
      const d = await r.json();
      if (!r.ok) return json({ error: d.message || 'fetch failed' }, r.status);
      return json(pageToEvent(d, true));
    }

    // List all non-archived events (no data payload — too large)
    const events = [];
    let cursor;
    do {
      const body = {
        filter: { property: 'Archived', checkbox: { equals: false } },
        sorts:  [
          { property: 'Year',      direction: 'descending' },
          { property: 'created_time', direction: 'descending' },
        ],
        page_size: 100,
      };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
        method: 'POST', headers: h, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.message || 'query failed' }, r.status);
      (d.results || []).forEach(p => events.push(pageToEvent(p, false)));
      cursor = d.has_more ? d.next_cursor : null;
    } while (cursor);
    return json(events);
  }

  // ── POST — create event ───────────────────────
  if (request.method === 'POST') {
    const { name, type, year, data } = await request.json();
    if (!name || !type || !year) return json({ error: 'name, type, year required' }, 400);
    const dataStr = JSON.stringify(data || { items: [] });
    const r = await fetch(`${NOTION_API}/pages`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        parent: { database_id: DB_ID },
        properties: {
          'Name':     { title:    [{ text: { content: name } }] },
          'Type':     { select:   { name: type } },
          'Year':     { number:   year },
          'Data':     { rich_text: toRichText(dataStr) },
          'Archived': { checkbox: false },
        },
      }),
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.message || 'create failed' }, r.status);
    return json({ notionPageId: d.id });
  }

  if (!id) return json({ error: 'id required for PATCH/DELETE' }, 400);

  // ── PATCH — update event ──────────────────────
  if (request.method === 'PATCH') {
    const body  = await request.json();
    const props = {};
    if (body.name !== undefined) props['Name'] = { title:    [{ text: { content: body.name } }] };
    if (body.type !== undefined) props['Type'] = { select:   { name: body.type } };
    if (body.year !== undefined) props['Year'] = { number:   body.year };
    if (body.data !== undefined) props['Data'] = { rich_text: toRichText(JSON.stringify(body.data)) };
    const r = await fetch(`${NOTION_API}/pages/${id}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ properties: props }),
    });
    if (!r.ok) {
      const d = await r.json();
      return json({ error: d.message || 'patch failed' }, r.status);
    }
    return json({ ok: true });
  }

  // ── DELETE — soft delete (archive) ───────────
  if (request.method === 'DELETE') {
    const r = await fetch(`${NOTION_API}/pages/${id}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ properties: { 'Archived': { checkbox: true } } }),
    });
    if (!r.ok) return json({ error: 'archive failed' }, r.status);
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
