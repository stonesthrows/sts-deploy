// ════════════════════════════════════════════
//  Estimate Approval API  —  /api/approval
//  Cloudflare Pages Function
//  Reuses KV binding: STS_DESIGNS   (key: "approval:{token}")
//
//  The customer-facing approval page (approval.html) is public — the
//  unguessable token IS the capability, so this endpoint is exempt from
//  the X-STS-Key gate (see functions/api/_middleware.js PUBLIC set).
//
//  Record shape stored in KV:
//    {
//      token, orderId, notionPageId,
//      customerName, customerEmail,          ← never returned by GET
//      images,                               ← array of data: URLs (sketch and/or attached photos)
//      title,                                ← what the piece is
//      lines:[{label,amount}], total,        ← customer-facing charges (no cost basis) for the crowned/only option
//      options,                              ← optional [{label,lines,total,image,crowned}] from Compare (Option A/B/C)
//      notesForCustomer,
//      status: 'sent' | 'approved' | 'changes',
//      response, sentAt, respondedAt
//    }
//
//  POST kinds:
//    { kind:'create', ...record }              → studio stores a new estimate
//    { kind:'respond', token, decision, notes} → customer approves / requests changes
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

const KEY = (token) => `approval:${token}`;

// ── Square invoice draft, created the moment a customer approves ──
// Mirrors square-sync.js's location/API constants (same single-location
// business). Draft only — never calls the /publish endpoint, so nothing
// is ever sent to the customer or charged without a human reviewing it
// in Square first.
const SQUARE_API  = 'https://connect.squareup.com';
const SQUARE_VER  = '2025-01-23';
const SQ_LOCATION = 'D7EZ98V48F79A';

function sqHeaders(token) {
  return {
    'Authorization':  'Bearer ' + token,
    'Content-Type':   'application/json',
    'Square-Version': SQUARE_VER,
  };
}

async function sqFindOrCreateCustomer(token, email, name) {
  const search = await fetch(SQUARE_API + '/v2/customers/search', {
    method: 'POST', headers: sqHeaders(token),
    body: JSON.stringify({ query: { filter: { email_address: { exact: email } } } }),
  });
  const sd = await search.json().catch(() => ({}));
  if (!search.ok) throw new Error('Customer search failed: ' + (sd.errors?.[0]?.detail || search.status));
  if (sd.customers && sd.customers.length) return sd.customers[0].id;

  const create = await fetch(SQUARE_API + '/v2/customers', {
    method: 'POST', headers: sqHeaders(token),
    body: JSON.stringify({ given_name: name || 'Customer', email_address: email }),
  });
  const cd = await create.json().catch(() => ({}));
  if (!create.ok) throw new Error('Customer create failed: ' + (cd.errors?.[0]?.detail || create.status));
  return cd.customer.id;
}

// Which option the customer actually approved — its lines/total, matched
// by the label they picked; falls back to the record's top-level (single-
// estimate, no Compare) lines/total when there's nothing to match against.
function pickApprovedLines(rec) {
  const options = Array.isArray(rec.options) ? rec.options : [];
  const picked = rec.selectedOption && options.find(o => o.label === rec.selectedOption);
  const opt = picked || options.find(o => o.crowned) || options[0];
  if (opt) return { lines: opt.lines, total: opt.total };
  return { lines: rec.lines, total: rec.total };
}

async function createSquareInvoiceDraft(env, rec) {
  const token = env.SQUARE_TOKEN;
  if (!token) return { status: 'skipped', reason: 'Square not configured' };
  if (!rec.customerEmail) return { status: 'skipped', reason: 'No customer email on file' };

  const { lines } = pickApprovedLines(rec);
  if (!Array.isArray(lines) || !lines.length) return { status: 'skipped', reason: 'No line items to invoice' };

  const customerId = await sqFindOrCreateCustomer(token, rec.customerEmail, rec.customerName);

  const orderRes = await fetch(SQUARE_API + '/v2/orders', {
    method: 'POST', headers: sqHeaders(token),
    body: JSON.stringify({
      idempotency_key: rec.token + '-order',
      order: {
        location_id: SQ_LOCATION,
        customer_id: customerId,
        line_items: lines.map(ln => ({
          name: ln.label,
          quantity: '1',
          base_price_money: { amount: Math.round((ln.amount || 0) * 100), currency: 'USD' },
        })),
      },
    }),
  });
  const orderData = await orderRes.json().catch(() => ({}));
  if (!orderRes.ok) throw new Error('Order create failed: ' + (orderData.errors?.[0]?.detail || orderRes.status));

  const invRes = await fetch(SQUARE_API + '/v2/invoices', {
    method: 'POST', headers: sqHeaders(token),
    body: JSON.stringify({
      idempotency_key: rec.token + '-invoice',
      invoice: {
        order_id: orderData.order.id,
        location_id: SQ_LOCATION,
        primary_recipient: { customer_id: customerId },
        payment_requests: [{ request_type: 'BALANCE' }],
        title: rec.title || 'Custom order',
        description: 'Draft created automatically from the approved estimate — review before sending.',
      },
    }),
  });
  const invData = await invRes.json().catch(() => ({}));
  if (!invRes.ok) throw new Error('Invoice create failed: ' + (invData.errors?.[0]?.detail || invRes.status));

  return {
    status: 'created',
    invoiceId: invData.invoice.id,
    invoiceNumber: invData.invoice.invoice_number || null,
    orderId: orderData.order.id,
    createdAt: new Date().toISOString(),
  };
}

// Strip fields the customer's browser must never see.
function publicView(rec) {
  if (!rec) return null;
  const { customerEmail, notionPageId, orderId, ...safe } = rec;
  return safe;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  const token = new URL(context.request.url).searchParams.get('token');
  if (!token) return json({ error: 'Missing token' }, 400);

  const raw = await kv.get(KEY(token));
  if (!raw) return json({ error: 'Not found' }, 404);

  let rec; try { rec = JSON.parse(raw); } catch (e) { return json({ error: 'Corrupt record' }, 500); }
  return json({ approval: publicView(rec) });
}

export async function onRequestPost(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  let body; try { body = await context.request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
  const kind = body.kind;

  // ── Studio creates / overwrites an estimate snapshot ──
  if (kind === 'create') {
    const token = String(body.token || '').trim();
    if (!token || token.length < 12) return json({ error: 'Invalid token' }, 400);

    // Accept the current array shape, but fall back to a legacy single
    // `sketch` string so any in-flight link created before the gallery
    // rework still overwrites cleanly.
    const rawImages = Array.isArray(body.images) ? body.images.filter(Boolean)
                     : (body.sketch ? [body.sketch] : []);
    const options = Array.isArray(body.options) ? body.options.map(o => ({
      label: String(o.label || ''),
      lines: Array.isArray(o.lines) ? o.lines : [],
      total: Number(o.total) || 0,
      images: Array.isArray(o.images) ? o.images.filter(Boolean) : [],
      notes: String(o.notes || ''),
      crowned: !!o.crowned,
    })) : null;
    // Don't store a gallery photo twice if it's byte-identical to one
    // already attached to an option — keeps the KV value (and email/page
    // payload) smaller and avoids the customer seeing it twice over.
    const optionImages = new Set((options || []).flatMap(o => o.images));
    const images = rawImages.filter(src => !optionImages.has(src));

    const rec = {
      token,
      orderId:       body.orderId       || '',
      notionPageId:  body.notionPageId  || '',
      customerName:  body.customerName   || '',
      customerEmail: body.customerEmail  || '',
      images,
      title:         body.title          || '',
      lines:         Array.isArray(body.lines) ? body.lines : [],
      total:         Number(body.total)   || 0,
      options,
      notesForCustomer: body.notesForCustomer || '',
      shopName:      body.shopName || 'Stones Throw Studio',
      status:        'sent',
      response:      '',
      sentAt:        new Date().toISOString(),
      respondedAt:   '',
    };

    const payload = JSON.stringify(rec);
    // KV values cap at 25MiB; stay well clear of that so the failure mode
    // is a clear message instead of an opaque platform error page.
    if (payload.length > 20 * 1024 * 1024) {
      return json({ error: 'Attached photos are too large (' + Math.round(payload.length / 1024 / 1024) + 'MB) — remove one or attach smaller/fewer images and try again.' }, 413);
    }
    try {
      await kv.put(KEY(token), payload);
    } catch (e) {
      return json({ error: 'Could not save the estimate: ' + String(e.message || e) }, 500);
    }
    return json({ ok: true, token });
  }

  // ── Customer responds (approve / request changes) ──
  if (kind === 'respond') {
    const token = String(body.token || '').trim();
    if (!token) return json({ error: 'Missing token' }, 400);
    const decision = body.decision === 'approved' ? 'approved'
                   : body.decision === 'changes'  ? 'changes'
                   : null;
    if (!decision) return json({ error: 'Invalid decision' }, 400);

    const raw = await kv.get(KEY(token));
    if (!raw) return json({ error: 'Not found' }, 404);
    let rec; try { rec = JSON.parse(raw); } catch (e) { return json({ error: 'Corrupt record' }, 500); }

    rec.status      = decision;
    rec.response    = String(body.notes || '').slice(0, 4000);
    rec.respondedAt = new Date().toISOString();
    if (body.selectedOption) rec.selectedOption = String(body.selectedOption).slice(0, 200);

    // Best-effort: draft a Square invoice the moment the customer approves.
    // Never lets a Square hiccup block the customer's own approval action —
    // failures are recorded on the record for the studio to see and handle
    // manually, not surfaced to the customer.
    if (decision === 'approved' && !rec.squareInvoice) {
      try {
        rec.squareInvoice = await createSquareInvoiceDraft(context.env, rec);
      } catch (e) {
        rec.squareInvoice = { status: 'failed', error: String(e.message || e), failedAt: new Date().toISOString() };
      }
    }

    await kv.put(KEY(token), JSON.stringify(rec));
    return json({ ok: true, status: decision });
  }

  return json({ error: 'Unknown kind' }, 400);
}
