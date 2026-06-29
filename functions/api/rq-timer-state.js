// ════════════════════════════════════════════
//  Restock Queue Timer State  —  /api/rq-timer-state
//  Cross-device KV store for active rq timers, keyed by restock item pid.
//  Requires KV namespace binding: STS_TIMER
//
//  GET → { [pid]: { startTime, employee, sessionNotionPageId, itemText, items, richMatch } }
//  PUT → body is full state object → 200 { ok }
// ════════════════════════════════════════════

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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const kv = context.env.STS_TIMER;
  if (!kv) return json({});
  try {
    const val = await kv.get('rq_timers');
    return json(val ? JSON.parse(val) : {});
  } catch(e) {
    return json({});
  }
}

export async function onRequestPut(context) {
  const kv = context.env.STS_TIMER;
  if (!kv) return json({ ok: true }); // silent no-op if KV not bound
  try {
    const body = await context.request.json();
    await kv.put('rq_timers', JSON.stringify(body), { expirationTtl: 604800 });
    return json({ ok: true });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}
