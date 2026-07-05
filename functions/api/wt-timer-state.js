// ════════════════════════════════════════════
//  Work Timer State  —  /api/wt-timer-state
//  Cross-device KV store for the 2 fixed Work Timer slots (time-tracker.html),
//  mirroring the per-key approach in ./rq-timer-state.js 1:1.
//  Requires KV namespace binding: STS_TIMER (same binding rq-timer-state.js
//  uses — no new binding needed).
//
//  Storage model: ONE KV KEY PER SLOT (`wt_timer:{tid}`, tid is "0" or "1"
//  today but nothing here assumes exactly 2), enumerated via
//  kv.list({prefix:'wt_timer:'}). Brand-new endpoint, so unlike
//  rq-timer-state.js there is no legacy blob to migrate from.
//
//  This store is a LIVE-SYNC layer only — it is not the source of truth for
//  a session's data (Notion is, via /api/notion-timesession). It just lets
//  every open tab agree, within a short poll window, on which of the 2
//  slots is currently running, who started it, and when — so a stop or
//  edit on one device is visible on another without waiting for a reload.
//
//  API (same shape as rq-timer-state.js):
//    GET                              → { [tid]: {...} }
//    PUT { upsert: { [tid]: {...} } } → set those slots
//    PUT { remove: tid | [tids] }     → delete those slots
// ════════════════════════════════════════════

const KV_PREFIX = 'wt_timer:';
const TTL_SECS = 2592000; // 30 days — matches rq-timer-state.js; a very long
                          // shift plus clock skew should never silently
                          // expire a still-running timer out from under KV.

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
      const tid = k.name.slice(KV_PREFIX.length);
      try {
        const val = await kv.get(k.name);
        if (val) state[tid] = JSON.parse(val);
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
  if (!body.upsert && !body.remove) return json({ error: 'expected upsert or remove' }, 400);

  try {
    if (body.upsert && typeof body.upsert === 'object') {
      const tids = Object.keys(body.upsert);
      await Promise.all(tids.map((tid) =>
        kv.put(KV_PREFIX + tid, JSON.stringify(body.upsert[tid]), { expirationTtl: TTL_SECS })
      ));
    }
    if (body.remove) {
      const rm = Array.isArray(body.remove) ? body.remove : [body.remove];
      await Promise.all(rm.map((tid) => kv.delete(KV_PREFIX + String(tid))));
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
