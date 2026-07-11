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

  const token = env.NOTION_TOKEN;
  const dbId  = env.NOTION_MATERIALS_DB_ID;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  if (!dbId)  return json({ error: 'NOTION_MATERIALS_DB_ID not set' }, 500);
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
      const r = await fetch(`${NOTION_API}/pages/${material.notionPageId}`, {
        method: 'PATCH', headers: h,
        body: JSON.stringify({ properties: props, archived: false }),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.message || 'Notion patch failed' }, r.status);
      return json({ notionPageId: material.notionPageId });
    }

    const cr = await fetch(`${NOTION_API}/pages`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ parent: { database_id: dbId }, properties: props }),
    });
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
