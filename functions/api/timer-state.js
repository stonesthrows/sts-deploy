// ════════════════════════════════════════════
//  Timer State Proxy  —  /api/timer-state
//  Persists active timer state to Cloudflare KV so any browser can resume.
//  Requires KV namespace binding: STS_TIMER
//
//  GET    → { "0": state|null, "1": state|null }
//  PUT    → body { tid, startTime, items, employee, notes } → 200 { ok }
//  DELETE → ?tid=0  → 200 { ok }
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
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

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('KV timeout')), ms)),
  ]);
}

export async function onRequestGet(context) {
  const kv = context.env.STS_TIMER;
  if (!kv) return json({ error: 'STS_TIMER KV namespace not bound' }, 500);
  try {
    const [v0, v1] = await withTimeout(
      Promise.all([kv.get('timer_0'), kv.get('timer_1')]),
      4000
    );
    return json({
      0: v0 ? JSON.parse(v0) : null,
      1: v1 ? JSON.parse(v1) : null,
    });
  } catch(e) {
    return json({ error: e.message, 0: null, 1: null }, 500);
  }
}

export async function onRequestPut(context) {
  const kv = context.env.STS_TIMER;
  if (!kv) return json({ error: 'STS_TIMER KV namespace not bound' }, 500);
  try {
    const body = await context.request.json();
    const { tid, ...state } = body;
    if (tid === undefined || tid === null) return json({ error: 'tid required' }, 400);
    await withTimeout(kv.put(`timer_${tid}`, JSON.stringify(state), { expirationTtl: 86400 }), 4000);
    return json({ ok: true });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const kv = context.env.STS_TIMER;
  if (!kv) return json({ error: 'STS_TIMER KV namespace not bound' }, 500);
  try {
    const tid = new URL(context.request.url).searchParams.get('tid');
    if (tid === null) return json({ error: 'tid required' }, 400);
    await withTimeout(kv.delete(`timer_${tid}`), 4000);
    return json({ ok: true });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}
