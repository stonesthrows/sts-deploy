// ════════════════════════════════════════════
//  Weekend Sales Store  —  /api/weekend-sales
//  Server-side store of per-weekend market sales aggregates, so the
//  Replenishment page's velocity math reads the same numbers on every
//  device (the Sales tab's localStorage sync is per-browser and stays
//  untouched — this store is Replenishment's own).
//
//  Lives in the STS_DESIGNS KV (already bound for /api/designs) under
//  its own key — no new Cloudflare binding to configure.
//
//  Shape:
//  {
//    weekends: {
//      "YYYY-MM-DD" (Saturday): {
//        label:        "Jul 12-13",
//        syncedAt:     ISO string,
//        final:        true once synced after the weekend ended —
//                      partial (in-progress) weekends are re-pulled and
//                      excluded from velocity until final,
//        items:        { [squareItemId]: { name, qty, revenue } }
//                      — rolled up to the PARENT item (sizes pooled),
//        uncatalogued: qty sold as custom amounts (no catalog id)
//      }
//    },
//    varMap: { [variationId]: { itemId, itemName } }
//              — variation → parent-item cache so synced weekends never
//                need their catalog lookups repeated
//  }
// ════════════════════════════════════════════

const KV_KEY = 'replenish:weekend-sales';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function load(kv) {
  const raw = await kv.get(KV_KEY);
  if (!raw) return { weekends: {}, varMap: {} };
  try {
    const d = JSON.parse(raw);
    return {
      weekends: d.weekends && typeof d.weekends === 'object' ? d.weekends : {},
      varMap:   d.varMap   && typeof d.varMap   === 'object' ? d.varMap   : {},
    };
  } catch (e) { return { weekends: {}, varMap: {} }; }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const kv = env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);
  return json(await load(kv));
}

// PATCH { weekends?: { key: entry|null }, varMap?: { varId: {itemId,itemName}|null } }
// Read-merge-write on the server (same reasoning as /api/restock-matches):
// a client only sends the weekends it just synced, so two devices syncing
// different weekends can't clobber each other.
export async function onRequestPatch({ request, env }) {
  const kv = env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  let patch;
  try { patch = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return json({ error: 'PATCH body must be an object' }, 400);
  }

  const cur = await load(kv);
  if (patch.weekends && typeof patch.weekends === 'object') {
    for (const k of Object.keys(patch.weekends)) {
      if (patch.weekends[k] === null) delete cur.weekends[k];
      else cur.weekends[k] = patch.weekends[k];
    }
  }
  if (patch.varMap && typeof patch.varMap === 'object') {
    for (const v of Object.keys(patch.varMap)) {
      if (patch.varMap[v] === null) delete cur.varMap[v];
      else cur.varMap[v] = patch.varMap[v];
    }
  }

  await kv.put(KV_KEY, JSON.stringify(cur));
  return json({ ok: true });
}
