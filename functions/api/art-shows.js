// ════════════════════════════════════════════
//  Art Show Deadlines KV API  —  /api/art-shows
//  Cloudflare Pages Function
//  Reuses the STS_DESIGNS KV binding (already provisioned) under its own
//  key — a manually-maintained tracker of upcoming show application
//  deadlines, fees, and requirements. Zapplication/CaFÉ block automated
//  fetches, so there is no scraper here: Kyle enters shows himself after
//  looking them up.
//
//  KV structure:
//    "artshows:list" → JSON array of show objects
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET /api/art-shows → array of show objects
export async function onRequestGet(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  const raw = await kv.get('artshows:list');
  return new Response(raw || '[]', { headers: { 'Content-Type': 'application/json', ...CORS } });
}

// POST /api/art-shows  body: full show object
// Creates (no id) or updates (has id) a show entry.
export async function onRequestPost(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  let show;
  try { show = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!show || typeof show.name !== 'string' || !show.name.trim()) {
    return json({ error: 'Missing show name' }, 400);
  }

  const raw = await kv.get('artshows:list');
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }

  const now = new Date().toISOString();
  if (show.id) {
    const pos = list.findIndex(s => s.id === show.id);
    show.updatedAt = now;
    if (pos !== -1) { show.createdAt = list[pos].createdAt || now; list[pos] = show; }
    else { show.createdAt = show.createdAt || now; list.push(show); }
  } else {
    show.id = 'as_' + now.replace(/\D/g, '') + '_' + Math.random().toString(36).slice(2, 8);
    show.createdAt = now;
    show.updatedAt = now;
    list.push(show);
  }

  await kv.put('artshows:list', JSON.stringify(list));
  return json({ ok: true, show });
}

// DELETE /api/art-shows?id=xxx
export async function onRequestDelete(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  const { searchParams } = new URL(context.request.url);
  const id = searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);

  const raw = await kv.get('artshows:list');
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  list = list.filter(s => s.id !== id);
  await kv.put('artshows:list', JSON.stringify(list));

  return json({ ok: true });
}
