// ════════════════════════════════════════════
//  Notion SOT Proxy  —  /api/notion-sot
//  GET  → load this week's order from Notion
//  POST → upsert this week's order to Notion
//  Requires env vars: NOTION_TOKEN, NOTION_SOT_DB
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
  });
}

function notionHdrs(token) {
  return {
    'Authorization':  'Bearer ' + token,
    'Notion-Version': NOTION_VER,
    'Content-Type':   'application/json',
  };
}

// Accepts a raw ID, a dashed UUID, or a full Notion page/database URL
// and pulls out the 32-hex-char database ID from wherever it's hiding.
function extractDbId(raw) {
  var m = String(raw || '').match(/[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}/);
  return m ? m[0].replace(/-/g, '') : null;
}

// A rich_text element holds at most 2000 chars, but a property can hold
// up to 100 of them — so long JSON blobs are split on write and joined on
// read instead of being cut off mid-JSON.
function toRichText(str) {
  var parts = [];
  str = String(str || '');
  for (var i = 0; i < str.length && parts.length < 100; i += 2000) {
    parts.push({ text: { content: str.slice(i, i + 2000) } });
  }
  return parts;
}
function fromRichText(prop) {
  return ((prop || {}).rich_text || []).map(function (t) { return t.plain_text; }).join('');
}

// Catalog overrides (built-in item deletes, SKU/name edits, order-page
// URLs) were added after the database was created. Add the column the
// first time it's needed rather than requiring a manual schema change.
async function ensureOverridesProp(token, dbId) {
  var r = await fetch(NOTION_API + '/databases/' + dbId, {
    method: 'PATCH',
    headers: notionHdrs(token),
    body: JSON.stringify({ properties: { Overrides: { rich_text: {} } } }),
  });
  return r.ok;
}

// Monday ISO date string → stable week key
function weekKey() {
  var now = new Date();
  var day = now.getDay();
  var mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return mon.toISOString().slice(0, 10);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// Past weeks are already one Notion page each, keyed by an ISO Monday in
// the Week title — so lexicographic sort == chronological sort. Returns
// the raw Items blobs; the caller works out what's frequent.
async function historyResp(token, dbId, limit) {
  var r = await fetch(NOTION_API + '/databases/' + dbId + '/query', {
    method: 'POST',
    headers: notionHdrs(token),
    body: JSON.stringify({
      sorts: [{ property: 'Week', direction: 'descending' }],
      page_size: Math.min(Math.max(limit, 1), 52),
    }),
  });
  if (!r.ok) {
    var e = await r.json().catch(() => ({}));
    return jsonResp({ error: e.message || 'query failed' }, r.status);
  }
  var data = await r.json();
  var cur = weekKey();
  var weeks = (data.results || []).map(function (page) {
    var titleRaw = ((page.properties.Week || {}).title || [])[0];
    return {
      week:  titleRaw ? titleRaw.plain_text.slice(0, 10) : '',
      items: fromRichText(page.properties.Items) || '{}',
    };
  }).filter(function (w) { return w.week && w.week !== cur; });
  return jsonResp({ weeks: weeks });
}

export async function onRequestGet(context) {
  var token = context.env.NOTION_TOKEN;
  var dbId  = extractDbId(context.env.NOTION_SOT_DB);
  if (!token) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);
  if (!dbId)  return jsonResp({ error: 'NOTION_SOT_DB not set or not a valid database ID' }, 500);

  var histParam = new URL(context.request.url).searchParams.get('history');
  if (histParam) return historyResp(token, dbId, Number(histParam) || 12);

  var key = weekKey();
  var r = await fetch(NOTION_API + '/databases/' + dbId + '/query', {
    method: 'POST',
    headers: notionHdrs(token),
    body: JSON.stringify({
      filter: { property: 'Week', title: { starts_with: key } },
      page_size: 1,
    }),
  });
  if (!r.ok) {
    var e = await r.json().catch(() => ({}));
    return jsonResp({ error: e.message || 'query failed' }, r.status);
  }
  var data = await r.json();
  var page = (data.results || [])[0];
  if (!page) return jsonResp({ found: false });

  var p = page.properties;
  return jsonResp({
    found: true,
    notionPageId: page.id,
    items: fromRichText(p.Items) || '{}',
    notes: fromRichText(p.Notes),
    custom: fromRichText(p.Custom) || '[]',
    customSuppliers: fromRichText(p.CustomSuppliers) || '[]',
    overrides: fromRichText(p.Overrides),
    updatedAt: (page.properties.Updated || {}).number || 0,
  });
}

export async function onRequestPost(context) {
  var token = context.env.NOTION_TOKEN;
  var dbId  = extractDbId(context.env.NOTION_SOT_DB);
  if (!token) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);
  if (!dbId)  return jsonResp({ error: 'NOTION_SOT_DB not set or not a valid database ID' }, 500);

  var body   = await context.request.json();
  var key    = body.weekKey   || weekKey();
  var items  = body.items     || '{}';
  var notes  = body.notes     || '';
  var custom = body.custom    || '[]';
  var sups   = body.customSuppliers || '[]';
  var overrides = body.overrides || '';
  var weekLabel  = body.weekLabel || key;
  var updatedAt  = Number(body.updatedAt) || Date.now();

  var props = {
    'Week':   { title:     [{ text: { content: key + ' — ' + weekLabel } }] },
    'Items':  { rich_text: toRichText(items) },
    'Notes':  { rich_text: toRichText(notes) },
    'Custom': { rich_text: toRichText(custom) },
    'CustomSuppliers': { rich_text: toRichText(sups) },
    'Updated': { number: updatedAt },
  };
  if (overrides) props.Overrides = { rich_text: toRichText(overrides) };

  var hdrs = notionHdrs(token);

  async function write() {
    if (body.notionPageId) {
      return fetch(NOTION_API + '/pages/' + body.notionPageId, {
        method: 'PATCH',
        headers: hdrs,
        body: JSON.stringify({ properties: props, archived: false }),
      });
    }
    return fetch(NOTION_API + '/pages', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ parent: { database_id: dbId }, properties: props }),
    });
  }

  var r = await write();
  var d = await r.json().catch(() => ({}));
  // Missing Overrides column → add it and retry once.
  if (!r.ok && props.Overrides && /Overrides/.test(d.message || '')) {
    if (await ensureOverridesProp(token, dbId)) {
      r = await write();
      d = await r.json().catch(() => ({}));
    }
  }
  if (!r.ok) return jsonResp({ error: d.message || 'save failed' }, r.status);
  return jsonResp({ notionPageId: body.notionPageId || d.id });
}
