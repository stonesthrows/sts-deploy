// ════════════════════════════════════════════
//  Designs KV API  —  /api/designs
//  Cloudflare Pages Function
//  Requires KV binding: STS_DESIGNS
//
//  KV structure:
//    "designs:index"      → JSON array of index entries (no images)
//    "designs:item:{id}"  → JSON of full design (includes images)
//    "designs:folders"    → JSON array of folder names (Design Family
//                            folders created empty, before any design
//                            has been tagged into them — see GET ?folders=1
//                            / POST {folder} / DELETE ?folder=)
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

// ── Reference images ──────────────────────────
// A design's images live inside its own record as base64 data URLs, so the
// plain ?id= read hands back every image before the client can render a
// single line of the guide — minutes on a phone for a design carrying ten
// of them. Two extra read modes break that up:
//
//   ?slim=1  the record with the image payloads left out — everything the
//            Design Guide actually renders, in a few KB
//   ?img=N   one image, as raw bytes rather than base64 (a third smaller
//            over the wire) and cacheable on its own
//
// The plain ?id= read is untouched: the edit form re-POSTs the whole record
// and still needs the data URLs.

// Splits "data:image/jpeg;base64,AAAA…" without a regex — these strings run
// to hundreds of KB and only the short head matters.
function _parseDataUrl(s) {
  if (typeof s !== 'string' || !s.startsWith('data:')) return null;
  const comma = s.indexOf(',');
  if (comma === -1) return null;
  const head = s.slice(5, comma);
  if (!head.endsWith(';base64')) return null;
  return { type: head.slice(0, -7) || 'application/octet-stream', b64: s.slice(comma + 1) };
}

function _b64Bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// GET /api/designs           → index array [{id, name, category, thumb, imgCount, preview, createdAt, updatedAt}]
// GET /api/designs?id=xxx    → full design object (includes images)
// GET /api/designs?id=xxx&slim=1 → same record with images/thumb stripped, plus imgCount
// GET /api/designs?id=xxx&img=N  → reference image N as raw bytes
// GET /api/designs?folders=1 → array of manually-created empty folder names
export async function onRequestGet(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  const { searchParams } = new URL(context.request.url);
  const id = searchParams.get('id');

  if (searchParams.get('folders')) {
    const folders = await kv.get('designs:folders');
    return new Response(folders || '[]', { headers: { 'Content-Type': 'application/json', ...CORS } });
  }

  if (id) {
    const img  = searchParams.get('img');
    const slim = searchParams.get('slim');
    if (img !== null) return _serveImage(context, kv, id, img);

    const val = await kv.get(`designs:item:${id}`);
    if (!val) return json({ error: 'Not found' }, 404);
    if (!slim) return new Response(val, { headers: { 'Content-Type': 'application/json', ...CORS } });

    let design;
    try { design = JSON.parse(val); } catch { return json({ error: 'Corrupt design record' }, 500); }
    const { images, thumb, ...rest } = design;
    // No `images` key at all (rather than an empty array) so the client can
    // tell a slim record from a full one with no design left to load.
    return json({ ...rest, imgCount: Array.isArray(images) ? images.length : 0 });
  }

  const index = await kv.get('designs:index');
  return new Response(index || '[]', { headers: { 'Content-Type': 'application/json', ...CORS } });
}

// One reference image, decoded out of the record. Cached hard by the browser:
// the client stamps the design's updatedAt into the URL, so an edited design
// asks for a new URL instead of ever being served a stale image.
async function _serveImage(context, kv, id, nRaw) {
  const n = Number(nRaw);
  if (!Number.isInteger(n) || n < 0) return json({ error: 'Invalid image index' }, 400);

  const val = await kv.get(`designs:item:${id}`);
  if (!val) return json({ error: 'Not found' }, 404);

  let design;
  try { design = JSON.parse(val); } catch { return json({ error: 'Corrupt design record' }, 500); }

  const src = (design.images || [])[n];
  if (!src) return json({ error: 'No such image' }, 404);

  const parsed = _parseDataUrl(src);
  // Nothing in the app stores a bare URL, but a hand-edited record could —
  // hand it straight back rather than 404ing on something that does resolve.
  if (!parsed) {
    if (/^https?:\/\//i.test(src)) return Response.redirect(src, 302);
    return json({ error: 'Image is not stored inline' }, 415);
  }

  const etag = `"${id}-${n}-${design.updatedAt || '0'}-${parsed.b64.length}"`;
  if (context.request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...CORS } });
  }

  return new Response(_b64Bytes(parsed.b64), {
    headers: {
      'Content-Type':  parsed.type,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'ETag':          etag,
      ...CORS,
    },
  });
}

// POST /api/designs  body: { folder: "Name" or "Parent/Child/Grandchild" }
// Creates an empty Design Family folder (no design tagged into it yet) so it
// shows up in the Design Families grid before any design references it.
// Folders nest via '/'-delimited paths — the same string space as a
// design's `families` entries — so a folder and a family tag are the same
// thing; a path just has more than one segment.
function _normalizeFolderPath(raw) {
  return (raw || '').split('/').map(p => p.trim()).filter(Boolean).join('/');
}

async function _createFolder(kv, name) {
  const trimmed = _normalizeFolderPath(name);
  if (!trimmed) return json({ error: 'Folder name is required' }, 400);
  if (trimmed.length > 120) return json({ error: 'Folder path is too long (max 120 characters)' }, 400);

  const raw = await kv.get('designs:folders');
  let folders = [];
  try { folders = raw ? JSON.parse(raw) : []; } catch { folders = []; }
  if (!folders.some(f => f.toLowerCase() === trimmed.toLowerCase())) {
    folders.push(trimmed);
    await kv.put('designs:folders', JSON.stringify(folders));
  }
  return json({ ok: true, folders });
}

// POST /api/designs  body: full design object (may include .thumb)
// Creates or updates a design; rebuilds its index entry.
export async function onRequestPost(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  let design;
  try { design = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  if (design && !design.id && typeof design.folder === 'string') {
    return _createFolder(kv, design.folder);
  }

  if (!design || !design.id) return json({ error: 'Missing design.id' }, 400);

  // Save full design
  await kv.put(`designs:item:${design.id}`, JSON.stringify(design));

  // Build compact index entry (no full images — thumb only). BOM lines are
  // tiny ({materialId, qty}) and ride in the index so the replenishment
  // engine (Phase 6) can compute buildable quantities from one read.
  const entry = {
    id:        design.id,
    name:      design.name      || '',
    category:  design.category  || '',
    families:  Array.isArray(design.families) ? design.families : (design.family ? [design.family] : []),
    thumb:     design.thumb     || null,
    imgCount:  (design.images   || []).length,
    preview:   ((design.specs || design.instructions || '').slice(0, 120)),
    bom:       Array.isArray(design.bom) ? design.bom : [],
    wasteOverridePct: design.wasteOverridePct ?? null,
    squareItemId:     design.squareItemId   || null,
    squareItemName:   design.squareItemName || null,
    retailPriceOverride:      design.retailPriceOverride      ?? null,
    laborMinPerPieceOverride: design.laborMinPerPieceOverride ?? null,
    parLevel:             design.parLevel             ?? null,
    suggestedBatchSize:   design.suggestedBatchSize   ?? null,
    replenishmentActive:  design.replenishmentActive  !== false,
    createdAt: design.createdAt || new Date().toISOString(),
    updatedAt: design.updatedAt || new Date().toISOString(),
  };

  // Update index
  const raw = await kv.get('designs:index');
  let index = raw ? JSON.parse(raw) : [];
  const pos = index.findIndex(d => d.id === design.id);
  if (pos !== -1) {
    index[pos] = entry;
  } else {
    index.unshift(entry); // newest first
  }
  await kv.put('designs:index', JSON.stringify(index));

  return json({ ok: true });
}

// PATCH /api/designs  body: { id, ...fields }
// Merges the given fields into the stored design (images stay untouched)
// and rebuilds its index entry. Used for lightweight edits like the
// replenishment page's inline par level / batch size — a full POST would
// require round-tripping every base64 image.
const PATCHABLE = ['parLevel', 'suggestedBatchSize', 'replenishmentActive'];

export async function onRequestPatch(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  let patch;
  try { patch = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!patch || !patch.id) return json({ error: 'Missing id' }, 400);

  const raw = await kv.get(`designs:item:${patch.id}`);
  if (!raw) return json({ error: 'Not found' }, 404);
  const design = JSON.parse(raw);
  PATCHABLE.forEach(k => { if (k in patch) design[k] = patch[k]; });
  design.updatedAt = new Date().toISOString();
  await kv.put(`designs:item:${patch.id}`, JSON.stringify(design));

  const idxRaw = await kv.get('designs:index');
  if (idxRaw) {
    const index = JSON.parse(idxRaw);
    const entry = index.find(d => d.id === patch.id);
    if (entry) {
      PATCHABLE.forEach(k => { if (k in patch) entry[k] = patch[k]; });
      entry.updatedAt = design.updatedAt;
      await kv.put('designs:index', JSON.stringify(index));
    }
  }
  return json({ ok: true });
}

// DELETE /api/designs?folder=Name
// Removes a manually-created empty folder. No-op on the designs themselves —
// this key only tracks folders that don't have a design tagged into them yet.
async function _deleteFolder(kv, name) {
  const raw = await kv.get('designs:folders');
  let folders = [];
  try { folders = raw ? JSON.parse(raw) : []; } catch { folders = []; }
  folders = folders.filter(f => f.toLowerCase() !== (name || '').toLowerCase());
  await kv.put('designs:folders', JSON.stringify(folders));
  return json({ ok: true, folders });
}

// DELETE /api/designs?id=xxx
export async function onRequestDelete(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  const { searchParams } = new URL(context.request.url);
  const id = searchParams.get('id');
  const folder = searchParams.get('folder');
  if (!id && folder) return _deleteFolder(kv, folder);
  if (!id) return json({ error: 'Missing id' }, 400);

  await kv.delete(`designs:item:${id}`);

  const raw = await kv.get('designs:index');
  if (raw) {
    const index = JSON.parse(raw).filter(d => d.id !== id);
    await kv.put('designs:index', JSON.stringify(index));
  }

  return json({ ok: true });
}
