// ════════════════════════════════════════════
//  Notion SOT Proxy  —  /api/notion-sot
//  GET  → load this week's order from Notion
//  POST → upsert this week's order to Notion
//  Requires env vars: NOTION_TOKEN, NOTION_SOT_DB
// ════════════════════════════════════════════

import { isNotionId } from './_notion.js';

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

export async function onRequestGet(context) {
  var token = context.env.NOTION_TOKEN;
  var dbId  = extractDbId(context.env.NOTION_SOT_DB);
  if (!token) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);
  if (!dbId)  return jsonResp({ error: 'NOTION_SOT_DB not set or not a valid database ID' }, 500);

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

  var itemsRaw  = ((page.properties.Items || {}).rich_text || [])[0];
  var notesRaw  = ((page.properties.Notes || {}).rich_text || [])[0];
  var customRaw = ((page.properties.Custom || {}).rich_text || [])[0];
  var supRaw    = ((page.properties.CustomSuppliers || {}).rich_text || [])[0];
  return jsonResp({
    found: true,
    notionPageId: page.id,
    items: itemsRaw ? itemsRaw.plain_text : '{}',
    notes: notesRaw ? notesRaw.plain_text : '',
    custom: customRaw ? customRaw.plain_text : '[]',
    customSuppliers: supRaw ? supRaw.plain_text : '[]',
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
  var weekLabel  = body.weekLabel || key;
  var updatedAt  = Number(body.updatedAt) || Date.now();

  var props = {
    'Week':   { title:     [{ text: { content: key + ' — ' + weekLabel } }] },
    'Items':  { rich_text: [{ text: { content: items.slice(0, 2000) } }] },
    'Notes':  { rich_text: [{ text: { content: notes.slice(0, 2000) } }] },
    'Custom': { rich_text: [{ text: { content: custom.slice(0, 2000) } }] },
    'CustomSuppliers': { rich_text: [{ text: { content: sups.slice(0, 2000) } }] },
    'Updated': { number: updatedAt },
  };

  var hdrs = notionHdrs(token);

  // Update existing page
  if (body.notionPageId) {
    if (!isNotionId(body.notionPageId)) return jsonResp({ error: 'invalid notionPageId' }, 400);
    var pr = await fetch(NOTION_API + '/pages/' + body.notionPageId, {
      method: 'PATCH',
      headers: hdrs,
      body: JSON.stringify({ properties: props, archived: false }),
    });
    if (!pr.ok) {
      var pe = await pr.json().catch(() => ({}));
      return jsonResp({ error: pe.message || 'patch failed' }, pr.status);
    }
    return jsonResp({ notionPageId: body.notionPageId });
  }

  // Create new page
  var cr = await fetch(NOTION_API + '/pages', {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify({ parent: { database_id: dbId }, properties: props }),
  });
  var cd = await cr.json();
  if (!cr.ok) return jsonResp({ error: cd.message || 'create failed' }, cr.status);
  return jsonResp({ notionPageId: cd.id });
}
