// ════════════════════════════════════════════
//  Materials Library Proxy  —  /api/materials
//  Phase 1 of the costing/inventory/replenishment build.
//  GET:    return all active + inactive materials, sorted by Name
//  POST:   upsert one material (by notionPageId if present, else
//          match-by-name, else create)
//  DELETE: archive by pageId query param
//  Requires env vars: NOTION_TOKEN, NOTION_MATERIALS_DB_ID
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const API_VERSION = 'materials-api v4 (2026-07-12)';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

// Accept NOTION_MATERIALS_DB_ID as a raw ID (with or without hyphens) or
// a full pasted Notion URL — extracts the database ID and re-hyphenates
// it into the UUID form the API requires. Query strings are cut first so
// a trailing ?v=<view id> can't be picked up; the DB ID is the last
// 32-hex run in the path.
function normDbId(raw) {
  const path = String(raw || '').trim().split('?')[0].replace(/-/g, '');
  const runs = path.match(/[0-9a-f]{32}/gi);
  if (!runs) return null;
  const s = runs[runs.length - 1].toLowerCase();
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// Full property schema. The Notion API auto-creates select OPTIONS on
// page writes but not PROPERTIES — writing to an unknown property 400s.
// ensureSchema() adds any missing properties (and converts wrong-typed
// ones), so the only manual Notion setup is creating an empty database
// and sharing it with the integration. Same pattern as notion-pipeline.js.
// 'Name' (the title property) always exists on a new database.
const MATERIAL_SCHEMA_PROPS = {
  'Category':              { select: {} },
  'Metal Type':            { select: {} },
  'Form':                  { select: {} },
  'Gauge':                 { rich_text: {} },
  'Unit':                  { select: {} },
  'Current Cost Per Unit': { number: {} },
  'Stock Level':           { number: {} },
  'Stock Confidence':      { select: {} },
  'Supplier Default':      { select: {} },
  'Active':                { checkbox: {} },
};

async function ensureSchema(h, dbId) {
  const r = await fetch(`${NOTION_API}/databases/${dbId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ properties: MATERIAL_SCHEMA_PROPS }),
  });
  return r.ok;
}

// Page write (PATCH update or POST create) that self-heals the schema:
// on a 400 for a missing or wrong-typed property, fix the database
// schema and retry once.
async function writePage(h, dbId, url, method, bodyObj) {
  const body = JSON.stringify(bodyObj);
  let r = await fetch(url, { method, headers: h, body });
  if (r.status === 400) {
    const err = await r.clone().json().catch(() => ({}));
    if (/not a property that exists|is expected to be/i.test(err.message || '') && await ensureSchema(h, dbId)) {
      r = await fetch(url, { method, headers: h, body });
    }
  }
  return r;
}

function materialToProps(m) {
  return {
    'Name':                    { title:     [{ text: { content: m.name || '' } }] },
    'Category':                { select:    m.category    ? { name: m.category }    : null },
    'Metal Type':               { select:    m.metalType   ? { name: m.metalType }   : null },
    'Form':                    { select:    m.form        ? { name: m.form }        : null },
    'Gauge':                   { rich_text: [{ text: { content: (m.gauge || '').slice(0, 200) } }] },
    'Unit':                    { select:    m.unit        ? { name: m.unit }        : null },
    'Current Cost Per Unit':   { number:    m.currentCostPerUnit ?? null },
    'Stock Level':             { number:    m.stockLevel        ?? null },
    'Stock Confidence':        { select:    m.stockConfidence ? { name: m.stockConfidence } : null },
    'Supplier Default':        { select:    m.supplierDefault ? { name: m.supplierDefault } : null },
    'Active':                  { checkbox:  m.active !== false },
  };
}

function pageToMaterial(page) {
  const p   = page.properties;
  const txt = prop => prop?.rich_text?.[0]?.plain_text || '';
  const ttl = prop => prop?.title?.[0]?.plain_text     || '';
  const sel = prop => prop?.select?.name || '';
  return {
    notionPageId:       page.id,
    name:                ttl(p['Name']),
    category:            sel(p['Category']),
    metalType:           sel(p['Metal Type']),
    form:                sel(p['Form']),
    gauge:               txt(p['Gauge']),
    unit:                sel(p['Unit']),
    currentCostPerUnit:  p['Current Cost Per Unit']?.number ?? null,
    stockLevel:          p['Stock Level']?.number ?? null,
    stockConfidence:     sel(p['Stock Confidence']),
    supplierDefault:     sel(p['Supplier Default']),
    active:              p['Active']?.checkbox !== false,
  };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Diagnostics: variable NAMES only (never values — some are secrets).
  // envKeysSeen answers "did my dashboard variable actually reach the
  // deployed function?", version answers "is the latest code even live?".
  const envKeysSeen = Object.keys(env).filter(k => /NOTION|MATERIAL/i.test(k)).sort();
  if (new URL(request.url).searchParams.get('diag') === '1') {
    return json({ version: API_VERSION, envKeysSeen });
  }

  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set', version: API_VERSION, envKeysSeen }, 500);
  // Tolerate whitespace around the variable NAME (easy to type on iPad,
  // invisible in the dashboard): match any env key that trims to it.
  const dbIdKey = Object.keys(env).find(k => k.trim() === 'NOTION_MATERIALS_DB_ID');
  if (!dbIdKey || !env[dbIdKey]) return json({ error: 'NOTION_MATERIALS_DB_ID not set', version: API_VERSION, envKeysSeen }, 500);
  const dbId = normDbId(env[dbIdKey]);
  if (!dbId) return json({ error: 'NOTION_MATERIALS_DB_ID does not contain a Notion database ID — paste the database URL or its 32-character ID' }, 500);
  const h = hdrs(token);

  // ── GET — fetch all materials ────────────────
  if (request.method === 'GET') {
    const materials = [];
    let cursor;
    do {
      const body = {
        page_size: 100,
        sorts: [{ property: 'Name', direction: 'ascending' }],
      };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
        method: 'POST', headers: h, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.message || 'Notion query failed' }, r.status);
      (d.results || []).forEach(pg => { if (!pg.archived) materials.push(pageToMaterial(pg)); });
      cursor = d.has_more ? d.next_cursor : null;
    } while (cursor);
    return json(materials);
  }

  // ── POST — upsert one material ───────────────
  if (request.method === 'POST') {
    const material = await request.json();
    if (!material.name) return json({ error: 'name required' }, 400);
    const props = materialToProps(material);

    if (material.notionPageId) {
      const r = await writePage(h, dbId, `${NOTION_API}/pages/${material.notionPageId}`, 'PATCH',
        { properties: props, archived: false });
      const d = await r.json();
      if (!r.ok) return json({ error: d.message || 'Notion patch failed' }, r.status);
      return json({ notionPageId: material.notionPageId });
    }

    const cr = await writePage(h, dbId, `${NOTION_API}/pages`, 'POST',
      { parent: { database_id: dbId }, properties: props });
    const cd = await cr.json();
    if (!cr.ok) return json({ error: cd.message || 'Notion create failed' }, cr.status);
    return json({ notionPageId: cd.id });
  }

  // ── DELETE — archive by Notion page ID ───────
  if (request.method === 'DELETE') {
    const pageId = new URL(request.url).searchParams.get('pageId');
    if (!pageId) return json({ error: 'pageId required' }, 400);
    const r = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ archived: true }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return json({ error: d.message || 'Notion archive failed' }, r.status);
    }
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
