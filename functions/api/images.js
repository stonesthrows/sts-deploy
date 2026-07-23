// ════════════════════════════════════════════
//  Order Images API  —  /api/images
//  Cloudflare Pages Function
//  Requires R2 binding: STS_IMAGES
//
//  Replaces the base64-in-Notion-property pattern (sketch, Approval Image)
//  for any future image type — one bucket, one endpoint, keyed by order,
//  no per-type dirty-hash field or _middleware.js PUBLIC whitelist entry.
//
//  Key convention:  orders/{orderId}/{slot}.{ext}
//    slot examples: sketch, approval, ref-1, ref-2, ...
//
//  GET    /api/images?key=orders/123/sketch.png   → raw image bytes
//  GET    /api/images?list=orders/123/            → JSON index of that order's images
//  PUT    /api/images?key=orders/123/ref-1.jpg     body: raw image bytes, Content-Type set
//  DELETE /api/images?key=orders/123/ref-1.jpg
//
//  Not in _middleware.js PUBLIC set — every request needs X-STS-Key once
//  APP_SHARED_KEY is set. <img src> can't send that header, so the client
//  must fetch() with the header and display via URL.createObjectURL(blob)
//  (see the upload/display helper sketch in project memory / chat).
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-STS-Key',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// Keys must live under orders/{orderId}/... — keeps the bucket from
// becoming a dumping ground and makes per-order listing/cleanup possible.
function validKey(key) {
  return typeof key === 'string' && /^orders\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(key);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET ?key=...          → stream the image back
// GET ?list=orders/{id}/ → JSON index of that order's images
export async function onRequestGet(context) {
  const r2 = context.env.STS_IMAGES;
  if (!r2) return json({ error: 'R2 binding STS_IMAGES not configured' }, 503);

  const { searchParams } = new URL(context.request.url);

  const list = searchParams.get('list');
  if (list) {
    const prefix = list.endsWith('/') ? list : list + '/';
    if (!/^orders\/[a-zA-Z0-9_-]+\/$/.test(prefix)) return json({ error: 'Invalid list prefix' }, 400);
    const listed = await r2.list({ prefix });
    return json({
      images: listed.objects.map(o => ({
        key:         o.key,
        size:        o.size,
        uploaded:    o.uploaded,
        contentType: o.httpMetadata?.contentType || null,
      })),
    });
  }

  const key = searchParams.get('key');
  if (!validKey(key)) return json({ error: 'Missing or invalid key' }, 400);

  const obj = await r2.get(key);
  if (!obj) return json({ error: 'Not found' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type':  obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'ETag':          obj.httpEtag,
      ...CORS,
    },
  });
}

// PUT ?key=orders/{orderId}/{slot}.{ext}   body: raw image bytes
export async function onRequestPut(context) {
  const r2 = context.env.STS_IMAGES;
  if (!r2) return json({ error: 'R2 binding STS_IMAGES not configured' }, 503);

  const { searchParams } = new URL(context.request.url);
  const key = searchParams.get('key');
  if (!validKey(key)) return json({ error: 'Missing or invalid key' }, 400);

  const contentType = context.request.headers.get('Content-Type') || 'application/octet-stream';
  if (!contentType.startsWith('image/')) return json({ error: 'Only image/* content types accepted' }, 400);

  await r2.put(key, context.request.body, { httpMetadata: { contentType } });
  return json({ ok: true, key });
}

// DELETE ?key=orders/{orderId}/{slot}.{ext}
export async function onRequestDelete(context) {
  const r2 = context.env.STS_IMAGES;
  if (!r2) return json({ error: 'R2 binding STS_IMAGES not configured' }, 503);

  const { searchParams } = new URL(context.request.url);
  const key = searchParams.get('key');
  if (!validKey(key)) return json({ error: 'Missing or invalid key' }, 400);

  await r2.delete(key);
  return json({ ok: true });
}
