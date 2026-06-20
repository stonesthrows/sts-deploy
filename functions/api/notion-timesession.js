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
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

export async function onRequestPatch(context) {
  var token = context.env.NOTION_TOKEN;
  if (!token) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);
  var s = await context.request.json();
  if (!s.pageId) return jsonResp({ error: 'pageId required' }, 400);
  var props = {};
  if (s.notes     != null) props['Notes']                      = { rich_text: [{ text: { content: (s.notes||'').slice(0,2000) } }] };
  if (s.stopTime  != null) props['Stop Time']                  = { date: { start: s.stopTime } };
  if (s.startTime != null) props['Start Time']                 = { date: { start: s.startTime } };
  if (s.totalMin  != null) props['Duration (min)']             = { number: s.totalMin };
  if (s.dedMin    != null) props['Clocked-Out Deducted (min)'] = { number: s.dedMin };
  if (s.netMin    != null) props['Net Work Time (min)']        = { number: s.netMin };
  if (s.pieces         != null) props['Pieces Made']       = { number: s.pieces };
  if (s.itemsJson      != null) props['Items JSON']        = { rich_text: [{ text: { content: (s.itemsJson||'').slice(0,2000) } }] };
  if (s.pushedToSquare != null) props['Pushed to Square']  = { checkbox: !!s.pushedToSquare };
  if (s.itemName       != null) props['Item Name']         = { rich_text: [{ text: { content: (s.itemName||'').slice(0,2000) } }] };

  async function notionPatch(properties) {
    return fetch(NOTION_API + '/pages/' + s.pageId, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Notion-Version': NOTION_VER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties }),
    });
  }

  var res  = await notionPatch(props);
  var data = await res.json();

  // If Notion rejected because one of the newer optional properties doesn't exist
  // on this database yet, retry with just the core fields so the rest still saves.
  if (!res.ok && data.message && (s.itemsJson != null || s.pushedToSquare != null || s.itemName != null || s.pieces != null)) {
    var core = {};
    if (s.notes     != null) core['Notes']                      = props['Notes'];
    if (s.stopTime  != null) core['Stop Time']                  = props['Stop Time'];
    if (s.startTime != null) core['Start Time']                 = props['Start Time'];
    if (s.totalMin  != null) core['Duration (min)']             = props['Duration (min)'];
    if (s.dedMin    != null) core['Clocked-Out Deducted (min)'] = props['Clocked-Out Deducted (min)'];
    if (s.netMin    != null) core['Net Work Time (min)']        = props['Net Work Time (min)'];
    if (s.pieces    != null) core['Pieces Made']                = props['Pieces Made'];
    res  = await notionPatch(core);
    data = await res.json();
    if (res.ok) {
      return jsonResp({ ok: true, warning: 'Saved core fields only — add "Items JSON" (Text), "Pushed to Square" (Checkbox), and confirm "Item Name" (Text) properties in the Notion database to save piece counts and Square links.' });
    }
  }

  if (!res.ok) return jsonResp({ error: data.message || 'Notion error ' + res.status }, res.status);
  return jsonResp({ ok: true });
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
  if (s.pieces    != null) props['Pieces Made'] = { number: s.pieces };
  if (s.itemsJson != null) props['Items JSON']  = { rich_text: [{ text: { content: (s.itemsJson||'').slice(0,2000) } }] };
  if (s.startTime)         props['Start Time']  = { date: { start: s.startTime } };
  if (s.stopTime)          props['Stop Time']   = { date: { start: s.stopTime  } };

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

  // If Notion rejected due to missing optional properties, retry without them
  if (!res.ok && data.message && (s.pieces != null || s.itemsJson != null)) {
    var propsWithout = Object.assign({}, props);
    delete propsWithout['Pieces Made'];
    delete propsWithout['Items JSON'];
    delete propsWithout['Pushed to Square'];
    res  = await notionPost(propsWithout);
    data = await res.json();
  }

  if (!res.ok) return jsonResp({ error: data.message || 'Notion error ' + res.status }, res.status);
  return jsonResp({ notionPageId: data.id });
}

export async function onRequestGet(context) {
  var token = context.env.NOTION_TOKEN;
  if (!token) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);

  var params     = new URL(context.request.url).searchParams;
  var activeOnly = params.get('active') === 'true';
  var fetchAll   = params.get('all') === 'true';

  var results = [];
  var cursor  = null;
  do {
    var queryBody = activeOnly
      ? { filter: { and: [
          { property: 'Start Time', date: { is_not_empty: true } },
          { property: 'Stop Time',  date: { is_empty: true } },
        ]}, page_size: 10 }
      : { sorts: [{ property: 'Date', direction: 'descending' }], page_size: fetchAll ? 100 : 50 };
    if (cursor) queryBody.start_cursor = cursor;

    var res = await fetch(NOTION_API + '/databases/' + DB_ID + '/query', {
      method: 'POST',
      headers: {
        'Authorization':  'Bearer ' + token,
        'Notion-Version': NOTION_VER,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify(queryBody),
    });

    var data = await res.json();
    if (!res.ok) return jsonResp({ error: data.message || 'Notion error' }, res.status);
    results = results.concat(data.results || []);
    cursor  = (fetchAll && data.has_more) ? data.next_cursor : null;
  } while (cursor);

  function txt(prop) { return prop?.rich_text?.[0]?.plain_text || ''; }
  function num(prop) { return prop?.number ?? null; }

  var sessions = results
    .filter(function(p) { return !p.archived; })
    .map(function(p) {
      var props = p.properties;
      return {
        notionPageId:  p.id,
        itemName:      props['Item Name']  ? txt(props['Item Name'])  : (props['Session']?.title?.[0]?.plain_text || ''),
        sku:           txt(props['SKU']),
        category:      txt(props['Category']),
        employeeName:  txt(props['Employee']),
        squareItemId:  txt(props['Square Item ID']),
        totalMin:      num(props['Duration (min)']),
        dedMin:        num(props['Clocked-Out Deducted (min)']),
        netMin:        num(props['Net Work Time (min)']),
        date:          props['Date']?.date?.start || null,
        notes:         txt(props['Notes']),
        pieces:        num(props['Pieces Made']),
        itemsJson:     txt(props['Items JSON']),
        pushed:        props['Pushed to Square']?.checkbox ?? false,
        startTime:     props['Start Time']?.date?.start || null,
        stopTime:      props['Stop Time']?.date?.start  || null,
      };
    });

  return jsonResp(sessions);
}
