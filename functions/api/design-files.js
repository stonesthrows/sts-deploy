// ════════════════════════════════════════════
//  Design Attachments API  —  /api/design-files
//  Cloudflare Pages Function
//  Requires R2 binding: STS_IMAGES (shared bucket — see functions/api/images.js)
//
//  Arbitrary files (Illustrator, PDF, zipped print files, etc.) attached to
//  a design library entry. Unlike images.js this accepts any content type.
//
//  Key convention:  designs/{designId}/{timestamp}-{filename}
//
//  GET    /api/design-files?key=designs/dsn-1/169...-file.ai   → raw file bytes
//  GET    /api/design-files?list=designs/dsn-1/                → JSON index
//  PUT    /api/design-files?key=designs/dsn-1/169...-file.ai    body: raw bytes
//  DELETE /api/design-files?key=designs/dsn-1/169...-file.ai
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

// Keys must live under designs/{designId}/... — mirrors images.js's
// orders/{orderId}/... convention so both types share one bucket safely.
function validKey(key) {
  return typeof key === 'string' && /^designs\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\- ()]+$/.test(key);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET ?key=...           → stream the file back
// GET ?list=designs/{id}/ → JSON index of that design's attachments
export async function onRequestGet(context) {
  const r2 = context.env.STS_IMAGES;
  if (!r2) return json({ error: 'R2 binding STS_IMAGES not configured' }, 503);

  const { searchParams } = new URL(context.request.url);

  const list = searchParams.get('list');
  if (list) {
    const prefix = list.endsWith('/') ? list : list + '/';
    if (!/^designs\/[a-zA-Z0-9_-]+\/$/.test(prefix)) return json({ error: 'Invalid list prefix' }, 400);
    const listed = await r2.list({ prefix });
    return json({
      files: listed.objects.map(o => ({
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
      'Content-Type':        obj.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': obj.httpMetadata?.contentDisposition || 'attachment',
      'Cache-Control':       'private, max-age=31536000, immutable',
      'ETag':                obj.httpEtag,
      ...CORS,
    },
  });
}

// PUT ?key=designs/{designId}/{filename}   body: raw file bytes
export async function onRequestPut(context) {
  const r2 = context.env.STS_IMAGES;
  if (!r2) return json({ error: 'R2 binding STS_IMAGES not configured' }, 503);

  const { searchParams } = new URL(context.request.url);
  const key = searchParams.get('key');
  if (!validKey(key)) return json({ error: 'Missing or invalid key' }, 400);

  const contentType = context.request.headers.get('Content-Type') || 'application/octet-stream';
  const filename = key.split('/').pop();

  await r2.put(key, context.request.body, {
    httpMetadata: {
      contentType,
      contentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"`,
    },
  });
  return json({ ok: true, key });
}

// DELETE ?key=designs/{designId}/{filename}
export async function onRequestDelete(context) {
  const r2 = context.env.STS_IMAGES;
  if (!r2) return json({ error: 'R2 binding STS_IMAGES not configured' }, 503);

  const { searchParams } = new URL(context.request.url);
  const key = searchParams.get('key');
  if (!validKey(key)) return json({ error: 'Missing or invalid key' }, 400);

  await r2.delete(key);
  return json({ ok: true });
}
