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
  'order':       'Custom Order',
  'estimate':    'Estimate Request',
  'repair':      'Repair',
  'resize':      'Resize',
  'square-item': 'Square Item',
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

  // Design spec fields
  if (o.contactMethod)     props['Preferred Contact']      = { select: { name: o.contactMethod } };
  if (o.pieceType)         props['Piece Type']             = { select: { name: o.pieceType } };
  if (o.sizing    != null) props['Sizing / Dimensions']    = { rich_text: [{ text: { content: (o.sizing    || '').slice(0, 2000) } }] };
  if (o.gemstones != null) props['Gemstones / Components'] = { rich_text: [{ text: { content: (o.gemstones || '').slice(0, 2000) } }] };
  if (o.finish    != null) props['Texture / Finish']       = { multi_select: (Array.isArray(o.finish) ? o.finish : []).map(name => ({ name })) };

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
    // Design spec fields — the 'Sketch' files property is deliberately NOT
    // mapped back: Notion file URLs expire hourly, so the editable sketch
    // image (sketchImg) stays local, like order.photo.
    contactMethod: sel(p['Preferred Contact']) || '',
    pieceType:     sel(p['Piece Type']) || '',
    sizing:        txt(p['Sizing / Dimensions']),
    gemstones:     txt(p['Gemstones / Components']),
    finish:        (p['Texture / Finish']?.multi_select || []).map(t => t.name),
  };
}

// ── Sketch upload + schema self-heal ──────────────────────────

// Properties added for the design-spec/sketch feature. The Notion API
// auto-creates select/multi-select OPTIONS but not PROPERTIES — a page
// write naming an unknown property 400s. ensureSchema() adds any missing
// ones so no manual Notion setup is needed.
const NEW_SCHEMA_PROPS = {
  'Preferred Contact':      { select: {} },
  'Piece Type':             { select: {} },
  'Sizing / Dimensions':    { rich_text: {} },
  'Gemstones / Components': { rich_text: {} },
  'Texture / Finish':       { multi_select: {} },
  'Sketch':                 { files: {} },
};

async function ensureSchema(hdrs) {
  const r = await fetch(`${NOTION_API}/databases/${PIPELINE_DB}`, {
    method: 'PATCH', headers: hdrs,
    body: JSON.stringify({ properties: NEW_SCHEMA_PROPS }),
  });
  return r.ok;
}

// Page write (PATCH update or POST create) that self-heals the schema:
// on a 400 for a not-yet-existing property, add the new properties to the
// database and retry once.
async function writePage(hdrs, url, method, bodyObj) {
  const body = JSON.stringify(bodyObj);
  let r = await fetch(url, { method, headers: hdrs, body });
  if (r.status === 400) {
    const err = await r.clone().json().catch(() => ({}));
    if (/not a property that exists/i.test(err.message || '') && await ensureSchema(hdrs)) {
      r = await fetch(url, { method, headers: hdrs, body });
    }
  }
  return r;
}

// Uploads a base64 PNG dataURL via Notion's File Upload API (direct
// single-part mode) and returns the file_upload id to attach to the
// 'Sketch' files property. Throws on any failure — the caller catches so
// a sketch problem never breaks the order save itself.
async function uploadSketchToNotion(token, dataURL) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/.exec(dataURL || '');
  if (!m) throw new Error('bad sketch dataURL');
  const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  if (bytes.length > 4.5 * 1024 * 1024) throw new Error('sketch too large'); // free-plan cap is 5 MiB
  const create = await fetch(`${NOTION_API}/file_uploads`, {
    method: 'POST', headers: notionHdrs(token),
    body: JSON.stringify({ filename: 'sketch.png', content_type: m[1] }),
  });
  const cu = await create.json().catch(() => ({}));
  if (!create.ok) throw new Error(cu.message || 'file_upload create failed');
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: m[1] }), 'sketch.png');
  const send = await fetch(`${NOTION_API}/file_uploads/${cu.id}/send`, {
    method: 'POST',
    // No Content-Type — fetch sets the multipart boundary itself
    headers: { 'Authorization': 'Bearer ' + token, 'Notion-Version': NOTION_VER },
    body: fd,
  });
  if (!send.ok) {
    const e = await send.json().catch(() => ({}));
    throw new Error(e.message || 'file_upload send failed');
  }
  return cu.id;
}

// ── Sketch fetch-on-view ──────────────────────────────────────
// GET ?sketch=<notionPageId> streams the current sketch PNG for a page.
// Notion's S3 file URLs expire hourly and send no CORS headers, so the
// client can't hold onto them — this proxies fresh bytes on every view,
// which is what lets a sketch drawn on the iPad show up on desktop.
async function getSketch(hdrs, pageId) {
  if (!/^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pageId)) {
    return json({ error: 'bad page id' }, 400);
  }
  const r = await fetch(`${NOTION_API}/pages/${pageId}`, { headers: hdrs });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return json({ error: err.message || 'page fetch failed' }, r.status);
  }
  const page = await r.json();
  const f = page.properties?.['Sketch']?.files?.[0];
  const fileUrl = f && (f.file?.url || f.external?.url);
  if (!fileUrl) return json({ error: 'no-sketch' }, 404);

  const img = await fetch(fileUrl);
  if (!img.ok) return json({ error: 'file fetch failed' }, 502);
  return new Response(img.body, {
    headers: {
      ...CORS,
      'Content-Type':  img.headers.get('content-type') || 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}

// ── Route handlers ────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET /api/notion-pipeline  →  return all pipeline orders
// GET /api/notion-pipeline?sketch=<id>  →  stream that page's sketch image
export async function onRequestGet(context) {
  const token = context.env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const hdrs = notionHdrs(token);

  const sketchId = new URL(context.request.url).searchParams.get('sketch');
  if (sketchId) return getSketch(hdrs, sketchId);

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
    return json({ ok: true });
  }

  const props = orderToProps(order);

  // Sketch image → Notion File Upload API. Only when the client says the
  // sketch changed (dirty-hash check in js/notion.js), and always isolated:
  // an upload failure must never break the order save itself.
  let sketchSynced = false, sketchError = null;
  if (order._sketchChanged && order.sketchImg) {
    try {
      const fid = await uploadSketchToNotion(token, order.sketchImg);
      props['Sketch'] = { files: [{ name: 'sketch.png', type: 'file_upload', file_upload: { id: fid } }] };
      sketchSynced = true;
    } catch (e) { sketchError = e.message || String(e); }
  } else if (order._sketchChanged && !order.sketchImg) {
    props['Sketch'] = { files: [] }; // sketch was cleared — empty the property
    sketchSynced = true;
  }

  // Update existing Notion page
  if (order.notionId) {
    const r = await writePage(hdrs, `${NOTION_API}/pages/${order.notionId}`, 'PATCH',
      { properties: props, archived: false });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return json({ error: err.message || 'update failed' }, r.status);
    }
    return json({ notionId: order.notionId, sketchSynced, sketchError });
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
        const r = await writePage(hdrs, `${NOTION_API}/pages/${match.id}`, 'PATCH',
          { properties: props, archived: false });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          return json({ error: err.message || 'update failed' }, r.status);
        }
        return json({ notionId: match.id, sketchSynced, sketchError });
      }
    }
  }

  // Create new Notion page
  const r = await writePage(hdrs, `${NOTION_API}/pages`, 'POST',
    { parent: { database_id: PIPELINE_DB }, properties: props });
  const d = await r.json();
  if (!r.ok) return json({ error: d.message || 'create failed' }, r.status);
  return json({ notionId: d.id, sketchSynced, sketchError });
}
