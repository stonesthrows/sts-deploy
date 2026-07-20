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

// ── Legacy Sales-tab totals baseline ────────────────────────────
// Moved here from the publicly-served js/data.js (SQUARE_WEEKENDS) —
// function source is never served, so revenue numbers stay private.
// Merged UNDER stored totals at read time; a synced weekend with the
// same key always wins.
const LEGACY_TOTALS_LIST = [
  { weekend: "2026-01-17", label: "Jan 17-18", saturday: 59.54,   sunday: 1149.26, total: 1208.80,  num_transactions: 22 },
  { weekend: "2026-01-31", label: "Jan 31-Feb 1", saturday: 442.74, sunday: 903.32, total: 1346.06, num_transactions: 26 },
  { weekend: "2026-02-07", label: "Feb 7-8",   saturday: 1268.11, sunday: 1287.46, total: 2555.57,  num_transactions: 46 },
  { weekend: "2026-02-14", label: "Feb 14-15", saturday: 48.71,   sunday: 1290.55, total: 1339.26,  num_transactions: 24 },
  { weekend: "2026-02-21", label: "Feb 21-22", saturday: 1015.26, sunday: 1477.49, total: 2492.75,  num_transactions: 48 },
  { weekend: "2026-02-28", label: "Feb 28-Mar 1", saturday: 1052.32, sunday: 555.10, total: 1607.42, num_transactions: 30 },
  { weekend: "2026-03-07", label: "Mar 7-8",   saturday: 476.74,  sunday: 1351.22, total: 1827.96,  num_transactions: 30 },
  { weekend: "2026-03-14", label: "Mar 14-15", saturday: 574.16,  sunday: 2472.40, total: 3046.56,  num_transactions: 52 },
  { weekend: "2026-03-21", label: "Mar 21-22", saturday: 644.30,  sunday: 1898.64, total: 2542.94,  num_transactions: 44 },
  { weekend: "2026-03-28", label: "Mar 28-29", saturday: 721.58,  sunday: 1493.70, total: 2215.28,  num_transactions: 36 },
  { weekend: "2026-04-04", label: "Apr 4-5",   saturday: 0,       sunday: 506.34,  total: 506.34,   num_transactions: 12 },
  { weekend: "2026-04-11", label: "Apr 11-12", saturday: 832.42,  sunday: 2019.98, total: 2852.40,  num_transactions: 47 },
  { weekend: "2026-04-18", label: "Apr 18-19", saturday: 901.03,  sunday: 1572.76, total: 2473.79,  num_transactions: 51 },
  { weekend: "2026-04-25", label: "Apr 25-26", saturday: 996.44,  sunday: 1522.67, total: 2519.11,  num_transactions: 45 },
  { weekend: "2026-05-02", label: "May 2-3",   saturday: 2310.98, sunday: 2054.26, total: 4365.24,  num_transactions: 77 },
  { weekend: "2026-05-09", label: "May 9-10",  saturday: 1860.90, sunday: 3799.99, total: 5660.89,  num_transactions: 76 },
  { weekend: "2026-05-16", label: "May 16-17", saturday: 1016.10, sunday: 1513.28, total: 2529.38,  num_transactions: 45 },
  { weekend: "2026-05-23", label: "May 23-24", saturday: 907.12,  sunday: 1956.21, total: 2863.33,  num_transactions: 54 },
];
const LEGACY_TOTALS = {};
LEGACY_TOTALS_LIST.forEach(w => { LEGACY_TOTALS[w.weekend] = w; });

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
  if (!raw) return { weekends: {}, varMap: {}, totals: {} };
  try {
    const d = JSON.parse(raw);
    return {
      weekends: d.weekends && typeof d.weekends === 'object' ? d.weekends : {},
      varMap:   d.varMap   && typeof d.varMap   === 'object' ? d.varMap   : {},
      totals:   d.totals   && typeof d.totals   === 'object' ? d.totals   : {},
    };
  } catch (e) { return { weekends: {}, varMap: {}, totals: {} }; }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const kv = env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);
  const cur = await load(kv);
  // Sales-tab totals: legacy baseline merged under synced entries
  cur.totals = Object.assign({}, LEGACY_TOTALS, cur.totals);
  return json(cur);
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
  if (patch.totals && typeof patch.totals === 'object') {
    for (const k of Object.keys(patch.totals)) {
      if (patch.totals[k] === null) delete cur.totals[k];
      else cur.totals[k] = patch.totals[k];
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
