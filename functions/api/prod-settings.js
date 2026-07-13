// ════════════════════════════════════════════
//  Production Settings  —  /api/prod-settings
//  Shared employee labor rates + per-design material costs, stored as a
//  JSON blob in a dedicated Notion page (Block = __prod_settings__) in the
//  same DB restock-meta uses. Rates used to live only in localStorage,
//  which is per-browser — timers stopped on a device where rates were
//  never typed in snapshotted wrong labor costs. This makes every device
//  read/write the same numbers.
//  Shape: { rates: { [firstName]: $/hr }, materialCosts: { [squareId|custom:name]: $/pc },
//           chainMinPerPc: minutes of chain-making per pendant (chains are
//           batch-made ahead of time; see restock.js chain-time logging) }
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DB_ID      = 'fb115de8-4ac5-433d-84e6-1005f89ecdd2';
const META_BLOCK = '__prod_settings__';

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

// Notion caps each title element at 2000 chars; the materialCosts map can
// outgrow one, so split on write and join on read (same scheme as Items JSON
// in notion-timesession.js).
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
    const content = JSON.stringify({
      rates:         body.rates && typeof body.rates === 'object' ? body.rates : {},
      materialCosts: body.materialCosts && typeof body.materialCosts === 'object' ? body.materialCosts : {},
      chainMinPerPc: (typeof body.chainMinPerPc === 'number' && isFinite(body.chainMinPerPc) && body.chainMinPerPc >= 0)
        ? body.chainMinPerPc : null,
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
