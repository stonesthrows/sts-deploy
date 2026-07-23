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
    const images = Array.isArray(body.images) ? body.images.filter(Boolean)
                  : (body.sketch ? [body.sketch] : []);
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
      options:       Array.isArray(body.options) ? body.options.map(o => ({
                       label: String(o.label || ''),
                       lines: Array.isArray(o.lines) ? o.lines : [],
                       total: Number(o.total) || 0,
                       image: o.image || null,
                       crowned: !!o.crowned,
                     })) : null,
      notesForCustomer: body.notesForCustomer || '',
      shopName:      body.shopName || 'Stones Throw Studio',
      status:        'sent',
      response:      '',
      sentAt:        new Date().toISOString(),
      respondedAt:   '',
    };
    await kv.put(KEY(token), JSON.stringify(rec));
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
    await kv.put(KEY(token), JSON.stringify(rec));
    return json({ ok: true, status: decision });
  }

  return json({ error: 'Unknown kind' }, 400);
}
