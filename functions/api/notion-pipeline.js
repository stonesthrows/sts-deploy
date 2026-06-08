// ════════════════════════════════════════════
//  Notion Pipeline Proxy  —  /api/notion-pipeline
//  Cloudflare Pages Function
//  Handles the Custom Orders pipeline DB
//  Requires env var: NOTION_TOKEN
// ════════════════════════════════════════════

const NOTION_API  = 'https://api.notion.com/v1';
const NOTION_VER  = '2022-06-28';
const PIPELINE_DB = '62de37d7-be83-48eb-a611-f494006d8085';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Stage ID ↔ Notion Stage option name ──────────────────────
const STAGE_TO_NOTION = {
  'intake-custom':  'Custom Intake',
  'intake-repair':  'Repair Intake',
  'needs-est':      'Estimate Intake',
  'sketch-needs':   'Needs Sketch',
  'sketch-wait':    'Waiting on Sketch Approval',
  'sketch':         'Sketch Approved',
  'quote':          'Estimate Sent',
  'est-appr':       'Estimate Approved',
  'deposit-wait':   'Waiting on Deposit',
  'deposit-paid':   'Deposit Paid',
  'order-mat':      'Order Materials',
  'materials':      'Waiting on Materials',
  'build':          'At the Bench',
  'contact-need':   'Need to Contact Customer',
  'contact-done':   'Contacted Customer',
  'ready-pick':     'Ready for Pickup',
  'complete':       'Completed',
  'delivered':      'Delivered',
};

const NOTION_TO_STAGE = {};
Object.entries(STAGE_TO_NOTION).forEach(([k, v]) => {
  NOTION_TO_STAGE[v.toLowerCase()] = k;
});

const ORDER_TYPE_TO_NOTION = {
  'order':    'Custom Order',
  'estimate': 'Estimate Request',
  'repair':   'Repair',
};
const NOTION_TO_ORDER_TYPE = {};
Object.entries(ORDER_TYPE_TO_NOTION).forEach(([k, v]) => {
  NOTION_TO_ORDER_TYPE[v.toLowerCase()] = k;
});

// ── Helpers ───────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function notionHdrs(token) {
  return {
    'Authorization':  'Bearer ' + token,
    'Notion-Version': NOTION_VER,
    'Content-Type':   'application/json',
  };
}

// ── App order → Notion property payload ──────────────────────
function orderToProps(o) {
  const props = {
    'Customer Name': { title: [{ text: { content: (o.name || '').slice(0, 2000) } }] },
    'App ID':        { rich_text: [{ text: { content: o.id || '' } }] },
  };

  if (o.stage != null) {
    const stageName = STAGE_TO_NOTION[o.stage] || o.stage;
    props['Stage'] = { select: { name: stageName } };
  }
  if (o.price   != null) props['Price']       = { number: o.price || null };
  if (o.finalPrice != null) props['Final Price'] = { number: o.finalPrice };
  if (o.deadline)     props['Deadline']       = { date: { start: o.deadline } };
  if (o.completedAt)  props['Completed At']   = { date: { start: o.completedAt.slice(0, 10) } };
  if (o.email)        props['Email']          = { email: o.email };
  if (o.phone)        props['Phone']          = { phone_number: o.phone };
  if (o.desc   != null) props['Order Description'] = { rich_text: [{ text: { content: (o.desc || '').slice(0, 2000) } }] };
  if (o.materials != null) props['Materials'] = { rich_text: [{ text: { content: (o.materials || '').slice(0, 2000) } }] };
  if (o.notes  != null) props['Notes']        = { rich_text: [{ text: { content: (o.notes || '').slice(0, 2000) } }] };
  if (o.orderType)    props['Order Type']     = { select: { name: ORDER_TYPE_TO_NOTION[o.orderType] || 'Custom Order' } };
  if (o.contactSource) props['Contact Source'] = { select: { name: o.contactSource } };
  if (o.pickup)       props['Pickup Location'] = { select: { name: o.pickup } };
  if (o.paidBy)       props['Paid By']         = { select: { name: o.paidBy } };

  return props;
}

// ── Notion page → app order object ───────────────────────────
function pageToOrder(page) {
  const p   = page.properties;
  const txt = prop => prop?.rich_text?.[0]?.plain_text || '';
  const sel = prop => prop?.select?.name || '';
  const dt  = prop => prop?.date?.start  || '';
  const num = prop => (prop?.number != null ? prop.number : null);
  const eml = prop => prop?.email        || '';
  const phn = prop => prop?.phone_number || '';

  const stageRaw    = sel(p['Stage']).toLowerCase();
  const appId       = txt(p['App ID']);
  const orderTypeRaw = sel(p['Order Type']).toLowerCase();

  return {
    id:            appId || ('n_' + page.id.replace(/-/g, '')),
    notionId:      page.id,
    name:          p['Customer Name']?.title?.[0]?.plain_text || '',
    stage:         NOTION_TO_STAGE[stageRaw] || 'intake-custom',
    price:         num(p['Price'])       || 0,
    finalPrice:    num(p['Final Price']),
    deadline:      dt(p['Deadline']),
    completedAt:   dt(p['Completed At']),
    email:         eml(p['Email']),
    phone:         phn(p['Phone']),
    desc:          txt(p['Order Description']),
    materials:     txt(p['Materials']),
    notes:         txt(p['Notes']),
    orderType:     NOTION_TO_ORDER_TYPE[orderTypeRaw] || 'order',
    contactSource: sel(p['Contact Source']) || '',
    pickup:        sel(p['Pickup Location']) || '',
    paidBy:        sel(p['Paid By']) || '',
  };
}

// ── Route handlers ────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET /api/notion-pipeline  →  return all pipeline orders
export async function onRequestGet(context) {
  const token = context.env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const hdrs = notionHdrs(token);

  const orders = [];
  let cursor;
  do {
    const body = {
      page_size: 100,
      sorts: [{ property: 'Customer Name', direction: 'ascending' }],
    };
    if (cursor) body.start_cursor = cursor;
    const r = await fetch(`${NOTION_API}/databases/${PIPELINE_DB}/query`, {
      method: 'POST', headers: hdrs, body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return json({ error: err.message || 'query failed' }, r.status);
    }
    const d = await r.json();
    (d.results || []).forEach(p => { if (!p.archived) orders.push(pageToOrder(p)); });
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);

  return json(orders);
}

// POST /api/notion-pipeline  →  create or update a pipeline order
export async function onRequestPost(context) {
  const token = context.env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const hdrs = notionHdrs(token);

  const order = await context.request.json();

  // Stage-only patch (fire-and-forget from drag-and-drop)
  if (order._stageOnly) {
    if (!order.notionId) return json({ error: 'notionId required for stage patch' }, 400);
    const stageName = STAGE_TO_NOTION[order.stage] || order.stage;
    const r = await fetch(`${NOTION_API}/pages/${order.notionId}`, {
      method: 'PATCH', headers: hdrs,
      body: JSON.stringify({ properties: { 'Stage': { select: { name: stageName } } } }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return json({ error: err.message || 'stage patch failed' }, r.status);
    }
    return json({ ok: true });
  }

  const props = orderToProps(order);

  // Update existing Notion page
  if (order.notionId) {
    const r = await fetch(`${NOTION_API}/pages/${order.notionId}`, {
      method: 'PATCH', headers: hdrs,
      body: JSON.stringify({ properties: props, archived: false }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return json({ error: err.message || 'update failed' }, r.status);
    }
    return json({ notionId: order.notionId });
  }

  // Create new Notion page
  const r = await fetch(`${NOTION_API}/pages`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ parent: { database_id: PIPELINE_DB }, properties: props }),
  });
  const d = await r.json();
  if (!r.ok) return json({ error: d.message || 'create failed' }, r.status);
  return json({ notionId: d.id });
}
