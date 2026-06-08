// ════════════════════════════════════════════
//  Notion Time-Session Proxy  —  /api/notion-timesession
//  Creates a work-session page in the STS Work Sessions database
//  Requires env var: NOTION_TOKEN
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DB_ID      = 'e59ae574e5ee4d569395e15bd56450e9';

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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestDelete(context) {
  var token = context.env.NOTION_TOKEN;
  if (!token) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);

  var pageId = new URL(context.request.url).searchParams.get('pageId');
  if (!pageId) return jsonResp({ error: 'pageId required' }, 400);

  await fetch(NOTION_API + '/pages/' + pageId, {
    method: 'PATCH',
    headers: {
      'Authorization':  'Bearer ' + token,
      'Notion-Version': NOTION_VER,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({ archived: true }),
  });
  return jsonResp({ ok: true });
}

export async function onRequestPost(context) {
  var token = context.env.NOTION_TOKEN;
  if (!token) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);

  var s = await context.request.json();

  var label = (s.itemName || '') + ' — ' + (s.employeeName || '');
  var props = {
    'Session':                      { title:     [{ text: { content: label } }] },
    'Item Name':                    { rich_text: [{ text: { content: s.itemName    || '' } }] },
    'SKU':                          { rich_text: [{ text: { content: s.sku         || '' } }] },
    'Category':                     { rich_text: [{ text: { content: s.category    || '' } }] },
    'Employee':                     { rich_text: [{ text: { content: s.employeeName|| '' } }] },
    'Square Item ID':               { rich_text: [{ text: { content: s.squareItemId|| '' } }] },
    'Duration (min)':               { number: s.totalMin    != null ? s.totalMin    : null },
    'Clocked-Out Deducted (min)':   { number: s.dedMin      != null ? s.dedMin      : null },
    'Net Work Time (min)':          { number: s.netMin      != null ? s.netMin      : null },
    'Date':                         { date:   { start: s.date || new Date().toISOString().slice(0,10) } },
    'Notes':                        { rich_text: [{ text: { content: (s.notes || '').slice(0, 2000) } }] },
  };
  if (s.pieces != null) props['Pieces Made'] = { number: s.pieces };

  async function notionPost(properties) {
    return fetch(NOTION_API + '/pages', {
      method: 'POST',
      headers: {
        'Authorization':  'Bearer ' + token,
        'Notion-Version': NOTION_VER,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ parent: { database_id: DB_ID }, properties }),
    });
  }

  var res  = await notionPost(props);
  var data = await res.json();

  // If Notion rejected because Pieces Made doesn't exist yet, retry without it
  if (!res.ok && s.pieces != null && data.message && data.message.includes('Pieces Made')) {
    var propsWithout = Object.assign({}, props);
    delete propsWithout['Pieces Made'];
    res  = await notionPost(propsWithout);
    data = await res.json();
  }

  if (!res.ok) return jsonResp({ error: data.message || 'Notion error ' + res.status }, res.status);
  return jsonResp({ notionPageId: data.id });
}
