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

// GET /api/designs           → index array [{id, name, category, thumb, imgCount, preview, createdAt, updatedAt}]
// GET /api/designs?id=xxx    → full design object (includes images)
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
    const val = await kv.get(`designs:item:${id}`);
    if (!val) return json({ error: 'Not found' }, 404);
    return new Response(val, { headers: { 'Content-Type': 'application/json', ...CORS } });
  }

  const index = await kv.get('designs:index');
  return new Response(index || '[]', { headers: { 'Content-Type': 'application/json', ...CORS } });
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
