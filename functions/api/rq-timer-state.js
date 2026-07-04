// ════════════════════════════════════════════
//  Restock Queue Timer State  —  /api/rq-timer-state
//  Cross-device KV store for active rq timers, keyed by restock item pid.
//  Requires KV namespace binding: STS_TIMER
//
//  Storage model: ONE KV KEY PER PID (`rq_timer:{pid}`), enumerated via
//  kv.list({prefix:'rq_timer:'}). This replaces the old single-JSON-blob
//  approach (`rq_timers`) so that two devices upserting DIFFERENT pids at
//  the same time can never race each other — each write only ever touches
//  its own key. A same-pid concurrent write is simple last-write-wins on
//  that one key, which is an acceptable outcome (see history below).
//
//  Legacy migration: any timer that was active in the OLD blob before this
//  deploy still lives at KV key `rq_timers` and won't have a per-pid key
//  yet. GET reads BOTH — the per-pid keyspace and the legacy blob — and
//  merges them (per-pid wins on conflict) so nothing already running gets
//  silently dropped. Any pid touched by a PUT (upsert or remove) is purged
//  from the legacy blob at the same time ("migrate on first write"), so a
//  stale legacy copy can never resurrect a timer that's since moved to (or
//  been removed from) the per-pid keyspace. Once every pid that was active
//  at deploy time has been touched once (started, edited, or stopped), the
//  legacy blob is fully drained and this fallback becomes a no-op.
//
//  API (unchanged from before the storage rework):
//    GET                              → { [pid]: {...} }
//    PUT { upsert: { [pid]: {...} } } → set those pids
//    PUT { remove: pid | [pids] }     → delete those pids
//    PUT { [pid]: {...}, ... }        → LEGACY full-blob shape from a stale
//                                       cached client: treated as an upsert
//                                       of every pid present (never deletes,
//                                       so an old cached build can't clobber
//                                       pids it doesn't know about).
//
//  History: 63a7b95 (naive full-blob overwrite, buggy) → 5291bc2 (frontend
//  per-pid split, device-id self-heal) → b4be8b8 (backend per-pid merge
//  instead of replace, still one blob key under the hood — narrow race
//  remained: two near-simultaneous PUTs could both read the same
//  pre-mutation blob and the second write to land would silently drop the
//  first's change) → this change (true per-pid KV keys, race eliminated).
// ════════════════════════════════════════════

const KV_PREFIX = 'rq_timer:';
const LEGACY_KEY = 'rq_timers';
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

async function readLegacyBlob(kv) {
  try {
    const val = await kv.get(LEGACY_KEY);
    const parsed = val ? JSON.parse(val) : {};
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

// Best-effort: drop these pids from the legacy blob because the per-pid
// keyspace is now authoritative for them (they were just upserted or
// removed there). Failure here is non-fatal — worst case a pid stays
// visible via the legacy fallback a little longer, it never causes data
// loss (per-pid write already succeeded, or already returned an error).
async function purgeLegacy(kv, pids) {
  if (!pids.length) return;
  try {
    const blob = await readLegacyBlob(kv);
    let changed = false;
    for (const pid of pids) {
      if (Object.prototype.hasOwnProperty.call(blob, pid)) { delete blob[pid]; changed = true; }
    }
    if (changed) await kv.put(LEGACY_KEY, JSON.stringify(blob), { expirationTtl: TTL_SECS });
  } catch (e) {
    // swallow — see comment above
  }
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
  const [perKey, legacy] = await Promise.all([readAllPerKey(kv), readLegacyBlob(kv)]);
  // Read-through migration: surface anything still only in the legacy blob;
  // the per-pid keyspace wins if a pid somehow exists in both.
  const merged = Object.assign({}, legacy, perKey);
  return json(merged);
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
      // ── New per-pid ops ──
      const touched = [];
      if (body.upsert && typeof body.upsert === 'object') {
        const pids = Object.keys(body.upsert);
        await Promise.all(pids.map((pid) => {
          touched.push(pid);
          return kv.put(KV_PREFIX + pid, JSON.stringify(body.upsert[pid]), { expirationTtl: TTL_SECS });
        }));
      }
      if (body.remove) {
        const rm = Array.isArray(body.remove) ? body.remove : [body.remove];
        await Promise.all(rm.map((pid) => {
          touched.push(pid);
          return kv.delete(KV_PREFIX + pid);
        }));
      }
      await purgeLegacy(kv, touched);
      return json({ ok: true });
    }

    // ── Legacy full-blob PUT (stale client) ──
    // Treat every key present as an upsert into the new per-pid keyspace.
    // NEVER delete — a stale cached build has no idea about pids added
    // since it loaded, so it must not be able to evict them.
    const pids = Object.keys(body);
    await Promise.all(pids.map((pid) =>
      kv.put(KV_PREFIX + pid, JSON.stringify(body[pid]), { expirationTtl: TTL_SECS })
    ));
    await purgeLegacy(kv, pids);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
