// ════════════════════════════════════════════
//  Shop Settings  —  /api/shop-settings
//  Phase 3+ of the costing/inventory build. Shared costing settings,
//  stored as a JSON blob in a dedicated Notion page (Block =
//  __shop_settings__) in the same DB restock-meta and prod-settings use —
//  every device reads/writes the same numbers (localStorage would be
//  per-browser).
//  Shape: {
//    wasteDefaultPct:  number|null   — shop-wide metal waste % (e.g. 12)
//    wastePctByMetal:  { sterling?: number, gold_fill?: number }
//    shopHourlyRate:   number|null   — Phase 4
//    targetMarginPct:  number|null   — Phase 4
//    marginFloorPct:   number|null   — Phase 4 margin-erosion alert
//  }
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DB_ID      = 'fb115de8-4ac5-433d-84e6-1005f89ecdd2';
const META_BLOCK = '__shop_settings__';

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

// Notion caps each title element at 2000 chars (blob stays tiny today, but
// same split/join scheme as prod-settings for consistency).
function titleBlocks(str) {
  const out = [];
  for (let i = 0; i < str.length && out.length < 100; i += 2000) {
    out.push({ text: { content: str.slice(i, i + 2000) } });
  }
  return out.length ? out : [{ text: { content: '{}' } }];
}

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

const numOrNull = v => (typeof v === 'number' && !isNaN(v) ? v : null);

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const h = hdrs(token);

  if (request.method === 'GET') {
    const page = await findMetaPage(h);
    if (!page) return json({});
    const raw = (page.properties['Note']?.title || []).map(t => t.plain_text || '').join('') || '{}';
    try { return json(JSON.parse(raw)); }
    catch (e) { return json({}); }
  }

  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'JSON object body required' }, 400);
    const byMetal = body.wastePctByMetal && typeof body.wastePctByMetal === 'object' ? body.wastePctByMetal : {};
    const content = JSON.stringify({
      wasteDefaultPct: numOrNull(body.wasteDefaultPct),
      wastePctByMetal: {
        ...(numOrNull(byMetal.sterling)  != null ? { sterling:  byMetal.sterling }  : {}),
        ...(numOrNull(byMetal.gold_fill) != null ? { gold_fill: byMetal.gold_fill } : {}),
      },
      shopHourlyRate:  numOrNull(body.shopHourlyRate),
      targetMarginPct: numOrNull(body.targetMarginPct),
      marginFloorPct:  numOrNull(body.marginFloorPct),
    });
    const page = await findMetaPage(h);

    const res = page
      ? await fetch(`${NOTION_API}/pages/${page.id}`, {
          method: 'PATCH', headers: h,
          body: JSON.stringify({ properties: { 'Note': { title: titleBlocks(content) } } }),
        })
      : await fetch(`${NOTION_API}/pages`, {
          method: 'POST', headers: h,
          body: JSON.stringify({
            parent: { database_id: DB_ID },
            properties: {
              'Note':  { title: titleBlocks(content) },
              'Block': { select: { name: META_BLOCK } },
              'Done':  { checkbox: false },
            },
          }),
        });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return json({ error: d.message || 'Notion error ' + res.status }, res.status);
    }
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
