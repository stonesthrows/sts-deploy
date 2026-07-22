// ════════════════════════════════════════════
//  API AUTH GATE  —  functions/api/_middleware.js
//  Runs for every /api/* request (Cloudflare Pages middleware).
//
//  Problem it solves: the /api/* proxies hold privileged tokens
//  (NOTION_TOKEN, SQUARE_TOKEN, …) and were callable by anyone on the
//  internet. This requires a shared key (X-STS-Key) on every app-facing
//  endpoint. The browser app sends it automatically (see js/api-auth.js).
//
//  ── Activation (two steps — until BOTH are done this gate is inert) ──
//   1. Set APP_SHARED_KEY in the Cloudflare Pages project env (a long
//      random string). Until it is set, requests pass through unchanged
//      so a deploy can never lock you out of your own app.
//   2. Enter the SAME value in the app under ⚙ Integrations → "App API
//      Key" on each device. It is stored in localStorage as sts-api-key.
//
//  Endpoints called by third parties (webhooks, OAuth redirects, the
//  external square-sync cron) can't send our header, so they're exempt
//  below — they carry their own verification or are inherently public.
// ════════════════════════════════════════════

const PUBLIC = new Set([
  'square-webhook',  // Square webhook — HMAC-verified inside the handler
  'sms-note',        // Twilio inbound-SMS webhook
  'etsy-auth',       // Etsy OAuth start + callback (top-level navigation)
  'square-sync',     // pinged by the external square-sync-trigger worker
  'sync-orders',     // idempotent scheduled Shopify/Etsy → Notion sync
  'timer-ping',      // trivial liveness probe, exposes nothing
  'approval',        // customer estimate-approval page — auth is the unguessable KV token
  'send-approval',   // called from intake (no api-auth); only mails the address on file for the token
]);

// Only our own deploys (prod + Pages previews) and local dev may read
// /api/* responses cross-origin. Everything else gets the canonical prod
// origin, which the browser rejects — so we never emit a wildcard.
const CANONICAL = 'https://sts-deploy.pages.dev';
function isAllowedOrigin(origin) {
  return /^https:\/\/([a-z0-9-]+\.)?sts-deploy\.pages\.dev$/.test(origin) ||
         /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function corsFor(origin) {
  return {
    'Access-Control-Allow-Origin':  isAllowedOrigin(origin) ? origin : CANONICAL,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-STS-Key',
    'Vary': 'Origin',
  };
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const origin = request.headers.get('Origin') || '';
  const cors   = corsFor(origin);

  // Answer CORS preflight centrally so every endpoint permits X-STS-Key
  // and reflects only an allowed origin (never '*').
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Auth gate. Not yet configured → fail open so an un-set env var can't
  // break the live app; enforced the moment APP_SHARED_KEY is set.
  const expected = env.APP_SHARED_KEY;
  const name = new URL(request.url).pathname   // /api/notion-orders/x → "notion-orders"
    .replace(/^\/api\//, '')
    .replace(/\/.*$/, '');
  if (expected && !PUBLIC.has(name) &&
      request.headers.get('X-STS-Key') !== expected) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...cors } }
    );
  }

  // Run the handler, then replace its per-function CORS (which was '*')
  // with the tightened origin. Skip redirects — their headers are
  // immutable and they're same-origin navigations anyway.
  const res = await next();
  if (res.status < 300 || res.status >= 400) {
    try { Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v)); }
    catch (e) { /* immutable response — leave as-is */ }
  }
  return res;
}
