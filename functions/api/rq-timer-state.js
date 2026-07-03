// ════════════════════════════════════════════
//  Restock Queue Timer State  —  /api/rq-timer-state
//  Cross-device KV store for active rq timers, keyed by restock item pid.
//  Requires KV namespace binding: STS_TIMER
//
//  KV holds the UNION of every device's active timers. Clients mutate it one
//  timer at a time so no device can ever evict another device's timer:
//    GET                              → { [pid]: {...} }
//    PUT { upsert: { [pid]: {...} } } → set those pids in the union
//    PUT { remove: pid | [pids] }     → delete those pids from the union
//    PUT { [pid]: {...}, ... }        → LEGACY full-blob from stale clients:
//                                       merge-union (add/update, NEVER delete)
//                                       so an old cached build can't clobber.
// ════════════════════════════════════════════

const KV_KEY   = 'rq_timers';
const TTL_SECS = 2592000; // 30 days — a real restock job can legitimately run
                          // for multiple days; the old 7-day TTL only survived
                          // because every reload accidentally refreshed it.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function readState(kv) {
  try {
    const val = await kv.get(KV_KEY);
    const parsed = val ? JSON.parse(val) : {};
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const kv = context.env.STS_TIMER;
  if (!kv) return json({});
  return json(await readState(kv));
}

export async function onRequestPut(context) {
  const kv = context.env.STS_TIMER;
  if (!kv) return json({ ok: true }); // silent no-op if KV not bound

  let body;
  try { body = await context.request.json(); }
  catch (e) { return json({ error: 'bad json' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'bad body' }, 400);

  const state = await readState(kv);

  if (body.upsert || body.remove) {
    // ── New per-timer ops ──
    if (body.upsert && typeof body.upsert === 'object') {
      for (const pid of Object.keys(body.upsert)) state[pid] = body.upsert[pid];
    }
    if (body.remove) {
      const rm = Array.isArray(body.remove) ? body.remove : [body.remove];
      for (const pid of rm) delete state[pid];
    }
  } else {
    // ── Legacy full-blob PUT (stale client): merge-union, never delete ──
    // so a cached build that lacks a timer can't evict it from the union.
    for (const pid of Object.keys(body)) state[pid] = body[pid];
  }

  try {
    await kv.put(KV_KEY, JSON.stringify(state), { expirationTtl: TTL_SECS });
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
