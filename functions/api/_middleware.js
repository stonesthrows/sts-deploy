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
]);

export async function onRequest(context) {
  const { request, env, next } = context;

  // Never gate CORS preflight — each handler answers OPTIONS itself.
  if (request.method === 'OPTIONS') return next();

  // Not yet configured → fail open so an un-set env var can't break the
  // live app. The gate becomes real the moment APP_SHARED_KEY is set.
  const expected = env.APP_SHARED_KEY;
  if (!expected) return next();

  // /api/notion-orders/foo → "notion-orders"
  const name = new URL(request.url).pathname
    .replace(/^\/api\//, '')
    .replace(/\/.*$/, '');
  if (PUBLIC.has(name)) return next();

  if (request.headers.get('X-STS-Key') !== expected) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return next();
}
