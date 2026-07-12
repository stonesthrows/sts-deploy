// ════════════════════════════════════════════
//  Notion Write Proxy  —  /api/notion-write
//  Handles POST (create/update) and DELETE for supplier orders
//  Requires env var: NOTION_TOKEN
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DB_ID      = '3929d8fb-1b0f-8043-9425-d24d2bec3544';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
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

function catSum(lineItems, cat) {
  if (!Array.isArray(lineItems)) return 0;
  return lineItems.reduce(function(s, li) {
    return s + ((li.category === cat && li.amt != null) ? (parseFloat(li.amt) || 0) : 0);
  }, 0);
}

// Split a long string into ≤2000-char rich_text segments — Notion caps each
// segment at 2000 chars. A single truncating .slice() corrupts line-item JSON
// once material-linked fields (materialId/qty/unitCost) make it longer.
function rtChunks(str) {
  var s = String(str || '');
  var out = [];
  for (var i = 0; i < s.length; i += 2000) out.push({ text: { content: s.slice(i, i + 2000) } });
  if (!out.length) out.push({ text: { content: '' } });
  return out;
}

function orderToProps(o) {
  var label = [o.sup, o.orderNum || o.invNum].filter(Boolean).join(' - ') || 'Order';
  var lineItems = o.lineItems || [];
  var props = {
    'Order Label':    { title:     [{ text: { content: label } }] },
    'App ID':         { rich_text: [{ text: { content: o.id       || '' } }] },
    'Order Number':   { rich_text: [{ text: { content: o.orderNum || '' } }] },
    'Invoice Number': { rich_text: [{ text: { content: o.invNum   || '' } }] },
    'Notes':          { rich_text: [{ text: { content: (o.notes || '').slice(0, 2000) } }] },
    'Line Items':     { rich_text: rtChunks(JSON.stringify(lineItems)) },
    'Drive File ID':  { rich_text: [{ text: { content: o.driveFileId || '' } }] },
    'Amount':         o.amt != null ? { number: o.amt } : { number: null },
    'Materials':      { number: catSum(lineItems, 'Materials') },
    'Tools':          { number: catSum(lineItems, 'Tools') },
    'Shipping':       { number: catSum(lineItems, 'Shipping') },
    'Other Amt':      { number: catSum(lineItems, 'Other') },
  };
  if (o.date) props['Date']     = { date: { start: o.date } };
  if (o.sup)  props['Supplier'] = { select: { name: o.sup } };
  return props;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  var token = context.env.NOTION_TOKEN;
  if (!token) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);
  var hdrs = notionHdrs(token);

  var order = await context.request.json();
  var props = orderToProps(order);

  // Patch existing page if we have the Notion page ID
  if (order.notionPageId) {
    var pr = await fetch(NOTION_API + '/pages/' + order.notionPageId, {
      method: 'PATCH',
      headers: hdrs,
      body: JSON.stringify({ properties: props, archived: false }),
    });
    if (!pr.ok) {
      var pe = await pr.json().catch(function() { return {}; });
      return jsonResp({ error: pe.message || 'patch failed' }, pr.status);
    }
    return jsonResp({ notionPageId: order.notionPageId });
  }

  // Create new page
  var cr = await fetch(NOTION_API + '/pages', {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify({ parent: { database_id: DB_ID }, properties: props }),
  });
  var cd = await cr.json();
  if (!cr.ok) return jsonResp({ error: cd.message || 'create failed' }, cr.status);
  return jsonResp({ notionPageId: cd.id });
}

export async function onRequestDelete(context) {
  var token = context.env.NOTION_TOKEN;
  if (!token) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);
  var hdrs = notionHdrs(token);

  var pageId = new URL(context.request.url).searchParams.get('pageId');
  if (!pageId) return jsonResp({ error: 'pageId required' }, 400);

  await fetch(NOTION_API + '/pages/' + pageId, {
    method: 'PATCH',
    headers: hdrs,
    body: JSON.stringify({ archived: true }),
  });
  return jsonResp({ ok: true });
}
