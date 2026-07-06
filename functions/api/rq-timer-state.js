// ════════════════════════════════════════════
//  Restock Queue Timer State  —  /api/rq-timer-state
//  Cross-device KV store for active rq timers, keyed by restock item pid.
//  Requires KV namespace binding: STS_TIMER
//
//  Storage model: ONE KV KEY PER PID (`rq_timer:{pid}`), enumerated via
//  kv.list({prefix:'rq_timer:'}). Two devices upserting DIFFERENT pids at
//  the same time can never race each other — each write only ever touches
//  its own key. A same-pid concurrent write is simple last-write-wins on
//  that one key, which is an acceptable outcome.
//
//  API:
//    GET                              → { [pid]: {...} }
//    PUT { upsert: { [pid]: {...} } } → set those pids
//    PUT { remove: pid | [pids] }     → delete those pids
//    PUT { [pid]: {...}, ... }        → LEGACY full-blob shape from a stale
//                                       cached client: treated as an upsert
//                                       of every pid present (never deletes,
//                                       so an old cached build can't clobber
//                                       pids it doesn't know about).
//
//  History: this used to carry a read-through migration from an older
//  single-JSON-blob KV key (`rq_timers`). That blob was fully drained once
//  every timer active at the migration deploy had been touched once, so the
//  migration path has been removed. If a stale timer somehow lived only in
//  the old blob, the owning device re-asserts it into the per-pid keyspace
//  on its next reconcile poll (see _rqReconcileTimers self-heal), so nothing
//  running is lost. Earlier lineage: 63a7b95 → 5291bc2 → b4be8b8 →
//  952b1ee (per-pid keys + legacy migration) → this change (migration
//  removed now that the legacy blob is drained).
// ════════════════════════════════════════════

const KV_PREFIX = 'rq_timer:';
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

async function readAllPerKey(kv) {
  const state = {};
  let cursor;
  for (;;) {
    const page = cursor
      ? await kv.list({ prefix: KV_PREFIX, cursor })
      : await kv.list({ prefix: KV_PREFIX });
    await Promise.all((page.keys || []).map(async (k) => {
      const pid = k.name.slice(KV_PREFIX.length);
      try {
        const val = await kv.get(k.name);
        if (val) state[pid] = JSON.parse(val);
      } catch (e) { /* skip unparsable entry */ }
    }));
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return state;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const kv = context.env.STS_TIMER;
  if (!kv) return json({});
  return json(await readAllPerKey(kv));
}

export async function onRequestPut(context) {
  const kv = context.env.STS_TIMER;
  if (!kv) return json({ ok: true }); // silent no-op if KV not bound

  let body;
  try { body = await context.request.json(); }
  catch (e) { return json({ error: 'bad json' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'bad body' }, 400);

  try {
    if (body.upsert || body.remove) {
      // ── Per-pid ops ──
      if (body.upsert && typeof body.upsert === 'object') {
        const pids = Object.keys(body.upsert);
        await Promise.all(pids.map((pid) =>
          kv.put(KV_PREFIX + pid, JSON.stringify(body.upsert[pid]), { expirationTtl: TTL_SECS })
        ));
      }
      if (body.remove) {
        const rm = Array.isArray(body.remove) ? body.remove : [body.remove];
        await Promise.all(rm.map((pid) => kv.delete(KV_PREFIX + pid)));
      }
      return json({ ok: true });
    }

    // ── Legacy full-blob PUT (stale cached client) ──
    // Treat every key present as an upsert into the per-pid keyspace.
    // NEVER delete — a stale cached build has no idea about pids added
    // since it loaded, so it must not be able to evict them.
    const pids = Object.keys(body);
    await Promise.all(pids.map((pid) =>
      kv.put(KV_PREFIX + pid, JSON.stringify(body[pid]), { expirationTtl: TTL_SECS })
    ));
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
