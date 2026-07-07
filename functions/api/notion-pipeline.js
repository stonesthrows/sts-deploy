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
  'intake-website': 'Website Order Intake',
  'sketch-needs':   'Needs Sketch',
  'sketch-wait':    'Waiting on Sketch Approval',
  'sketch':         'Sketch Approved',
  'quote':          'Estimate Sent',
  'est-appr':       'Estimate Approved',
  'deposit-wait':   'Waiting on Deposit',
  'deposit-paid':   'Deposit Paid',
  'order-mat':      'Order Materials',
  'materials':      'Waiting on Materials',
  'wait-cust-ship': 'Waiting on Customer Shipment',
  'needs-invoice':  'Needs Invoicing',
  'invoice-sent':   'Invoice Sent',
  'build':          'At the Bench',
  'kyle':           'Kyle',
  'stevie':         'Stevie',
  'vanessa':        'Vanessa',
  'etsy-bench':     'Etsy Order',
  'contact-need':   'Need to Contact Customer',
  'contact-done':   'Contacted Customer',
  'ready-pick':     'Ready for Pickup',
  'ship-out':       'Ship Out',
  'cancelled':      'Cancelled',
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
  const props = {};
  if (o.name != null) props['Customer Name'] = { title: [{ text: { content: (o.name || '').slice(0, 2000) } }] };
  if (o.id   != null) props['App ID']        = { rich_text: [{ text: { content: o.id || '' } }] };

  if (o.stage != null) {
    const stageName = STAGE_TO_NOTION[o.stage] || o.stage;
    props['Stage'] = { select: { name: stageName } };
  }
  if (o.price   != null) props['Price']       = { number: o.price || null };
  if (o.finalPrice != null) props['Final Price'] = { number: o.finalPrice };
  if (o.deadline)     props['Deadline']       = { date: { start: o.deadline } };
  // "Completed At" is the only finish-date property that exists in Notion —
  // both stage='complete' (completedAt) and stage='delivered' (deliveredAt)
  // write into it, completedAt taking priority if both are somehow set.
  if (o.completedAt)       props['Completed At'] = { date: { start: o.completedAt.slice(0, 10) } };
  else if (o.deliveredAt)  props['Completed At'] = { date: { start: o.deliveredAt.slice(0, 10) } };
  if (o.email)        props['Email']          = { email: o.email };
  if (o.phone)        props['Phone']          = { phone_number: o.phone };
  if (o.desc   != null) props['Order Description'] = { rich_text: [{ text: { content: (o.desc || '').slice(0, 2000) } }] };
  if (o.materials != null) props['Materials'] = { rich_text: [{ text: { content: (o.materials || '').slice(0, 2000) } }] };
  if (o.notes  != null) props['Notes']        = { rich_text: [{ text: { content: (o.notes || '').slice(0, 2000) } }] };
  if (o.orderType)    props['Order Type']     = { select: { name: ORDER_TYPE_TO_NOTION[o.orderType] || 'Custom Order' } };
  if (o.contactSource) props['Contact Source'] = { select: { name: o.contactSource } };
  if (o.pickup)       props['Pickup Location'] = { select: { name: o.pickup } };
  if (o.trackingNumber != null) props['Tracking Number'] = { rich_text: [{ text: { content: (o.trackingNumber || '').slice(0, 2000) } }] };
  if (o.trackingCarrier)        props['Carrier']          = { select: { name: o.trackingCarrier } };
  if (o.assignee != null) props['Assignee']     = o.assignee ? { select: { name: o.assignee } } : { select: null };
  if (o.paidBy)       props['Paid By']         = { select: { name: o.paidBy } };
  if (o.contactedAt)  props['Contacted At']    = { date: { start: o.contactedAt.slice(0, 10) } };
  if (o.cancelledAt)  props['Cancelled At']    = { date: { start: o.cancelledAt.slice(0, 10) } };
  if (o.pdfUrl)       props['PDF URL']         = { url: o.pdfUrl };

  // Address fields
  if (o.addrStreet  != null) props['Street Address'] = { rich_text: [{ text: { content: (o.addrStreet  || '').slice(0, 2000) } }] };
  if (o.addrStreet2 != null) props['Address Line 2'] = { rich_text: [{ text: { content: (o.addrStreet2 || '').slice(0, 2000) } }] };
  if (o.addrCity    != null) props['City']           = { rich_text: [{ text: { content: (o.addrCity    || '').slice(0, 2000) } }] };
  if (o.addrState   != null) props['State']          = { rich_text: [{ text: { content: (o.addrState   || '').slice(0, 2000) } }] };
  // Zip is a Notion Number property — only send it when it parses cleanly,
  // otherwise silently drop rather than erroring the whole save.
  if (o.addrZip != null && o.addrZip !== '') {
    const zipNum = parseFloat(String(o.addrZip).replace(/[^0-9.]/g, ''));
    if (!isNaN(zipNum)) props['Zip'] = { number: zipNum };
  }
  if (o.addrCountry != null) props['Country']        = { rich_text: [{ text: { content: (o.addrCountry || '').slice(0, 2000) } }] };

  // Estimate / job fields
  if (o.jobDesc        != null) props['Job Description']    = { rich_text: [{ text: { content: (o.jobDesc        || '').slice(0, 2000) } }] };
  if (o.customerNotes  != null) props['Notes for Customer'] = { rich_text: [{ text: { content: (o.customerNotes  || '').slice(0, 2000) } }] };

  // Order detail fields
  // Ring Size is a Notion text property — stores the full string as-is,
  // including multi-item orders like "6, 7.5".
  if (o.ringSize != null) props['Ring Size'] = { rich_text: [{ text: { content: (o.ringSize || '').slice(0, 2000) } }] };
  if (o.deposit    != null) props['Deposit']      = { number: o.deposit || null };
  if (o.takeIn)             props['Take-in Date'] = { date: { start: o.takeIn } };
  if (o.sketchDesc != null) props['Sketch Notes'] = { rich_text: [{ text: { content: (o.sketchDesc || '').slice(0, 2000) } }] };

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
  const stage       = NOTION_TO_STAGE[stageRaw] || 'intake-custom';
  // "Completed At" is the only finish-date property in Notion — route it to
  // completedAt or deliveredAt locally based on which stage the order is in.
  // If an order was marked Completed/Delivered by changing the Notion status
  // directly (bypassing the app's "Mark Completed" button), this date is
  // left blank — fall back to the page's last-edited time as a best guess
  // so the order doesn't silently vanish from the Order Archive.
  const completedAtSet = !!dt(p['Completed At']);
  const finishDate  = dt(p['Completed At'])
    || ((stage === 'complete' || stage === 'delivered') ? (page.last_edited_time || '').slice(0, 10) : null)
    || null;

  return {
    id:            appId || ('n_' + page.id.replace(/-/g, '')),
    notionId:      page.id,
    lastEdited:    page.last_edited_time || null,
    name:          p['Customer Name']?.title?.[0]?.plain_text || '',
    stage:         stage,
    price:         num(p['Price'])       || 0,
    finalPrice:    num(p['Final Price']),
    deadline:      dt(p['Deadline']),
    completedAt:   stage === 'complete'   ? finishDate : null,
    // True when finishDate above is a guess (last-edited fallback) rather
    // than an actual "Completed At" value — tells the client to write the
    // guessed date back to Notion so it only ever needs to be guessed once.
    dateGuessed:   (stage === 'complete' || stage === 'delivered') && !completedAtSet && !!finishDate,
    email:         eml(p['Email']),
    phone:         phn(p['Phone']),
    desc:          txt(p['Order Description']),
    materials:     txt(p['Materials']),
    notes:         txt(p['Notes']),
    orderType:     NOTION_TO_ORDER_TYPE[orderTypeRaw] || 'order',
    contactSource: sel(p['Contact Source']) || '',
    pickup:        sel(p['Pickup Location']) || null,
    assignee:      sel(p['Assignee']) || null,
    paidBy:        sel(p['Paid By']) || '',
    contactedAt:   dt(p['Contacted At'])  || null,
    deliveredAt:   stage === 'delivered'  ? finishDate : null,
    cancelledAt:   dt(p['Cancelled At'])  || null,
    pdfUrl:        p['PDF URL']?.url      || null,
    // Address fields
    addrStreet:    txt(p['Street Address']),
    addrStreet2:   txt(p['Address Line 2']),
    addrCity:      txt(p['City']),
    addrState:     txt(p['State']),
    addrZip:       (num(p['Zip']) != null ? String(num(p['Zip'])) : ''),
    addrCountry:   txt(p['Country']),
    trackingNumber:  txt(p['Tracking Number']),
    trackingCarrier: sel(p['Carrier']) || null,
    // Estimate / job fields
    jobDesc:       txt(p['Job Description']),
    customerNotes: txt(p['Notes for Customer']),
    // Order detail fields
    ringSize:      txt(p['Ring Size']),
    deposit:       num(p['Deposit']),
    takeIn:        dt(p['Take-in Date']),
    sketchDesc:    txt(p['Sketch Notes']),
  };
}

// ── Edge cache (Cloudflare KV) ──────────────────────────────────
// Full-database scans are identical across every device that opens the
// app — cache the result at the edge instead of re-scanning Notion on
// every page load. Reuses the STS_KV namespace already bound for the
// Etsy OAuth flow (functions/api/etsy-auth.js), under its own key.
const CACHE_KEY  = 'pipeline:orders:v1';
const FRESH_MS   = 30 * 1000;   // serve straight from cache below this age
const STALE_MS   = 5 * 60 * 1000; // serve-while-revalidate ceiling; miss beyond this

async function queryAllFromNotion(hdrs, filter) {
  const orders = [];
  let cursor;
  do {
    const body = {
      page_size: 100,
      sorts: [{ property: 'Customer Name', direction: 'ascending' }],
    };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const r = await fetch(`${NOTION_API}/databases/${PIPELINE_DB}/query`, {
      method: 'POST', headers: hdrs, body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      const e = new Error(err.message || 'query failed');
      e.status = r.status;
      throw e;
    }
    const d = await r.json();
    (d.results || []).forEach(p => { if (!p.archived) orders.push(pageToOrder(p)); });
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);
  return orders;
}

async function refreshCache(kv, hdrs) {
  const syncedAt = new Date().toISOString();
  const orders   = await queryAllFromNotion(hdrs, null);
  const snapshot = { at: Date.now(), syncedAt, orders };
  if (kv) await kv.put(CACHE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

// ── Route handlers ────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET /api/notion-pipeline           →  { syncedAt, orders: [all orders] }  (cached at the edge)
// GET /api/notion-pipeline?since=ISO →  { syncedAt, orders: [orders edited since] }  (never cached)
// Clients feed syncedAt back as the next request's `since` for delta pulls.
export async function onRequestGet(context) {
  const { env, request } = context;
  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const hdrs = notionHdrs(token);
  const kv   = env.STS_KV || null;

  const sinceRaw = new URL(request.url).searchParams.get('since');

  // Delta requests are already a small, cheap, filtered query — bypass the
  // cache entirely so they're never served a stale-cursor snapshot.
  if (sinceRaw) {
    const t = Date.parse(sinceRaw);
    let filter = null;
    // 2-minute overlap: Notion truncates last_edited_time to the minute, so a
    // strict boundary would miss same-minute edits. Re-delivered orders are
    // harmless — the client merge is idempotent.
    if (!isNaN(t)) {
      filter = {
        timestamp: 'last_edited_time',
        last_edited_time: { on_or_after: new Date(t - 120000).toISOString() },
      };
    }
    // Captured BEFORE the query runs, so an edit landing mid-query falls
    // after this stamp and gets re-delivered on the next delta, not skipped.
    const syncedAt = new Date().toISOString();
    try {
      const orders = await queryAllFromNotion(hdrs, filter);
      return json({ syncedAt, orders });
    } catch(e) {
      return json({ error: e.message || 'query failed' }, e.status || 500);
    }
  }

  // Full pull — no KV bound (e.g. local dev) falls straight through to Notion.
  if (!kv) {
    try {
      const syncedAt = new Date().toISOString();
      const orders   = await queryAllFromNotion(hdrs, null);
      return json({ syncedAt, orders });
    } catch(e) {
      return json({ error: e.message || 'query failed' }, e.status || 500);
    }
  }

  let cached = null;
  try { cached = await kv.get(CACHE_KEY, 'json'); } catch(e) { /* treat as miss */ }
  const age = cached ? Date.now() - cached.at : Infinity;

  if (cached && age < FRESH_MS) {
    return json({ syncedAt: cached.syncedAt, orders: cached.orders });
  }

  if (cached && age < STALE_MS) {
    // Stale-while-revalidate: answer instantly from the stale copy, refresh
    // the cache in the background for the next request.
    context.waitUntil(refreshCache(kv, hdrs).catch(e => console.error('KV refresh failed', e)));
    return json({ syncedAt: cached.syncedAt, orders: cached.orders, stale: true });
  }

  // Cold cache (first load ever, or stale beyond the ceiling) — block on a
  // fresh scan so the response is never older than STALE_MS.
  try {
    const snapshot = await refreshCache(kv, hdrs);
    return json({ syncedAt: snapshot.syncedAt, orders: snapshot.orders });
  } catch(e) {
    // Notion is down/erroring — fall back to whatever we have, however old,
    // rather than hard-failing every device at once.
    if (cached) return json({ syncedAt: cached.syncedAt, orders: cached.orders, stale: true });
    return json({ error: e.message || 'query failed' }, e.status || 500);
  }
}

// POST /api/notion-pipeline  →  create or update a pipeline order
export async function onRequestPost(context) {
  const token = context.env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const hdrs = notionHdrs(token);
  const kv   = context.env.STS_KV || null;

  // Any write invalidates the read cache so the very next GET regenerates
  // it — a write from any device makes every device's next load fresh.
  const invalidateCache = () => {
    if (kv) context.waitUntil(kv.delete(CACHE_KEY).catch(e => console.error('KV invalidate failed', e)));
  };

  const order = await context.request.json();

  // Archive (delete) a Notion page
  if (order._archive) {
    if (!order.notionId) return json({ error: 'notionId required for archive' }, 400);
    const r = await fetch(`${NOTION_API}/pages/${order.notionId}`, {
      method: 'PATCH', headers: hdrs,
      body: JSON.stringify({ archived: true }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return json({ error: err.message || 'archive failed' }, r.status);
    }
    invalidateCache();
    return json({ ok: true });
  }

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
    invalidateCache();
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
    invalidateCache();
    return json({ notionId: order.notionId });
  }

  // Idempotency guard — if a page with this App ID already exists (e.g. a
  // retried create whose response got lost, or a duplicate push from another
  // tab/device), patch that page instead of creating a second one.
  if (order.id) {
    const q = await fetch(`${NOTION_API}/databases/${PIPELINE_DB}/query`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({
        filter: { property: 'App ID', rich_text: { equals: order.id } },
        page_size: 1,
      }),
    });
    if (q.ok) {
      const qd = await q.json();
      const match = (qd.results || [])[0];
      if (match) {
        const r = await fetch(`${NOTION_API}/pages/${match.id}`, {
          method: 'PATCH', headers: hdrs,
          body: JSON.stringify({ properties: props, archived: false }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          return json({ error: err.message || 'update failed' }, r.status);
        }
        invalidateCache();
        return json({ notionId: match.id });
      }
    }
  }

  // Create new Notion page
  const r = await fetch(`${NOTION_API}/pages`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ parent: { database_id: PIPELINE_DB }, properties: props }),
  });
  const d = await r.json();
  if (!r.ok) return json({ error: d.message || 'create failed' }, r.status);
  invalidateCache();
  return json({ notionId: d.id });
}
