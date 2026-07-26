// ════════════════════════════════════════════
//  Customer Phone Photo Upload  —  /api/phone-upload
//  Cloudflare Pages Function
//  Reuses KV binding:  STS_DESIGNS  (key: "upload:{token}")
//  Reuses R2 binding:  STS_IMAGES   (keys: "uploads/{token}/{idx}.jpg")
//
//  Lets a customer standing at the bench put photos straight from their
//  own phone into the intake app's Reference Photos, with no app, no
//  login, and without AirDropping to Kyle's device first. Intake shows a
//  QR of /phone-upload?token=… , the customer scans it, picks photos,
//  and intake polls this endpoint and pulls them into _refPhotos.
//
//  Auth model — same shape as /api/approval: the unguessable token IS the
//  capability, so the function is exempt from the X-STS-Key gate (see the
//  PUBLIC set in functions/api/_middleware.js). Minting a token is the one
//  privileged action, so `create` re-checks APP_SHARED_KEY in-handler —
//  otherwise anyone could open sessions and write into the bucket.
//
//  The KV record is only the liveness/ownership proof; R2 is the single
//  source of truth for how many photos have landed (avoids a read-modify-
//  write race when several uploads finish at once).
//
//    POST   {kind:'create', label}      → {token, link}   (needs X-STS-Key)
//    POST   {kind:'done', token}        → customer tapped "I'm done"
//    GET    ?token=…                    → {session:{count,done,label}}
//    GET    ?token=…&idx=N              → raw image bytes (studio pull)
//    PUT    ?token=…                    → body: image bytes, assigns next slot
//    DELETE ?token=…                    → drop the session + its images
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-STS-Key',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

const KEY    = (token) => `upload:${token}`;
const PREFIX = (token) => `uploads/${token}/`;

// Mirrors RP_MAX_PHOTOS in js/intake-sheet.js — intake won't accept more
// than this into the gallery, so refuse them at the door with a message
// the customer can actually act on rather than silently dropping them.
const MAX_PHOTOS = 6;

// One session lives for a single intake conversation. Six hours is long
// enough for the appointment to run long and short enough that a link
// screenshotted off the counter is dead by evening.
const TTL_SECONDS = 6 * 60 * 60;

// Generous per-photo ceiling — the customer page downscales to 1280px
// before sending, so anything near this is a client that skipped resizing.
const MAX_BYTES = 8 * 1024 * 1024;

function validToken(token) {
  return typeof token === 'string' && /^up[a-z0-9]{16,64}$/.test(token);
}

async function loadSession(kv, token) {
  if (!validToken(token)) return null;
  const raw = await kv.get(KEY(token));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// Slot numbers come from what's already in the bucket rather than from a
// counter in KV, so two uploads finishing together can't both claim the
// same index off a stale read.
async function usedSlots(r2, token) {
  const listed = await r2.list({ prefix: PREFIX(token) });
  return listed.objects
    .map(o => parseInt(o.key.slice(PREFIX(token).length), 10))
    .filter(n => Number.isInteger(n))
    .sort((a, b) => a - b);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET ?token=…          → session status (customer page header + studio poll)
// GET ?token=…&idx=N    → raw bytes for one uploaded photo (studio pull)
export async function onRequestGet(context) {
  const kv = context.env.STS_DESIGNS;
  const r2 = context.env.STS_IMAGES;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);
  if (!r2) return json({ error: 'R2 binding STS_IMAGES not configured' }, 503);

  const { searchParams } = new URL(context.request.url);
  const token = searchParams.get('token');

  const rec = await loadSession(kv, token);
  if (!rec) return json({ error: 'This upload link has expired' }, 404);

  const idxParam = searchParams.get('idx');
  if (idxParam !== null) {
    const idx = parseInt(idxParam, 10);
    if (!Number.isInteger(idx) || idx < 0) return json({ error: 'Invalid idx' }, 400);
    const obj = await r2.get(PREFIX(token) + idx + '.jpg');
    if (!obj) return json({ error: 'Not found' }, 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type':  obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
        ...CORS,
      },
    });
  }

  const slots = await usedSlots(r2, token);
  return json({
    session: {
      token,
      label: rec.label || '',
      done:  !!rec.done,
      count: slots.length,
      slots,
      max:   MAX_PHOTOS,
    },
  });
}

export async function onRequestPost(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  let body; try { body = await context.request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }

  // ── Studio opens a session ──
  // This endpoint is exempt from the middleware auth gate so the customer's
  // phone can reach it, which makes this the one action that has to check
  // the shared key itself. Same fail-open rule as the middleware: an unset
  // APP_SHARED_KEY can't lock the studio out of its own app.
  if (body.kind === 'create') {
    const expected = context.env.APP_SHARED_KEY;
    if (expected && context.request.headers.get('X-STS-Key') !== expected) {
      return json({ error: 'unauthorized' }, 401);
    }

    const token = String(body.token || '').trim();
    if (!validToken(token)) return json({ error: 'Invalid token' }, 400);

    const rec = {
      token,
      label:     String(body.label || '').slice(0, 80),
      done:      false,
      createdAt: new Date().toISOString(),
    };
    await kv.put(KEY(token), JSON.stringify(rec), { expirationTtl: TTL_SECONDS });

    const origin = new URL(context.request.url).origin;
    return json({ ok: true, token, link: origin + '/phone-upload?token=' + token });
  }

  // ── Customer taps "I'm done" ──
  if (body.kind === 'done') {
    const rec = await loadSession(kv, body.token);
    if (!rec) return json({ error: 'This upload link has expired' }, 404);
    rec.done = true;
    // Keep whatever TTL remains rather than extending it — the studio only
    // needs the flag long enough to notice and close its dialog.
    await kv.put(KEY(rec.token), JSON.stringify(rec), { expirationTtl: TTL_SECONDS });
    return json({ ok: true });
  }

  return json({ error: 'Unknown kind' }, 400);
}

// PUT ?token=…   body: raw image bytes  → stored in the next free slot
export async function onRequestPut(context) {
  const kv = context.env.STS_DESIGNS;
  const r2 = context.env.STS_IMAGES;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);
  if (!r2) return json({ error: 'R2 binding STS_IMAGES not configured' }, 503);

  const token = new URL(context.request.url).searchParams.get('token');
  const rec = await loadSession(kv, token);
  if (!rec) return json({ error: 'This upload link has expired' }, 404);

  const contentType = context.request.headers.get('Content-Type') || '';
  if (!contentType.startsWith('image/')) return json({ error: 'Only photos can be uploaded' }, 400);

  const declared = parseInt(context.request.headers.get('Content-Length') || '0', 10);
  if (declared > MAX_BYTES) return json({ error: 'That photo is too large' }, 413);

  const slots = await usedSlots(r2, token);
  if (slots.length >= MAX_PHOTOS) {
    return json({ error: `That's all ${MAX_PHOTOS} photos — ask Kyle to remove one first`, count: slots.length }, 409);
  }
  const idx = slots.length ? slots[slots.length - 1] + 1 : 0;

  // Buffer rather than streaming so an oversized body that lied about (or
  // omitted) Content-Length is caught before it lands in the bucket.
  const bytes = await context.request.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return json({ error: 'That photo is too large' }, 413);

  await r2.put(PREFIX(token) + idx + '.jpg', bytes, { httpMetadata: { contentType } });
  return json({ ok: true, idx, count: slots.length + 1 });
}

// DELETE ?token=…  → studio pulled the photos into the order; drop the
// session so the bucket doesn't accumulate copies and the link goes dead.
export async function onRequestDelete(context) {
  const kv = context.env.STS_DESIGNS;
  const r2 = context.env.STS_IMAGES;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);
  if (!r2) return json({ error: 'R2 binding STS_IMAGES not configured' }, 503);

  const token = new URL(context.request.url).searchParams.get('token');
  if (!validToken(token)) return json({ error: 'Invalid token' }, 400);

  const listed = await r2.list({ prefix: PREFIX(token) });
  await Promise.all(listed.objects.map(o => r2.delete(o.key)));
  await kv.delete(KEY(token));
  return json({ ok: true });
}
