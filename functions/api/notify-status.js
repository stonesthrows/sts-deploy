// ════════════════════════════════════════════
//  Notification Self-Check  —  /api/notify-status
//  Cloudflare Pages Function
//
//  Answers "why didn't I get notified?" without anyone reading server
//  logs. Both notify paths in notion-messages.js are deliberate silent
//  no-ops when unconfigured — a missing env var must never break sending
//  a message — which is exactly what makes a misconfiguration invisible.
//  This endpoint is where that state becomes visible.
//
//  Reports booleans and counts ONLY. No token, key or secret is ever
//  returned, and the notify phone number comes back masked. Sits behind
//  the shared X-STS-Key gate like every other non-webhook route (it is
//  absent from the PUBLIC set in functions/api/_middleware.js).
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';

// Kept in step with notion-messages.js and push-subscribe.js by hand —
// every Function in this folder redeclares its own constants rather than
// sharing a module, which is the convention here.
const MESSAGES_DB_ID = 'e5a38cb3-7845-4ee7-94e7-ef6dcebf101d';
const PUSH_DB_ID     = 'aa8e0af3-4981-4156-8f62-855f0a914fb0';

// Public half of the VAPID pair, as embedded in js/push-notify.js and
// notion-messages.js. Not secret.
const VAPID_PUBLIC_KEY = 'BPlW0roALoDK6gSXOmbPd6RA9ZSc6-NcTOgWlTpXM55SZOrAr2DhHwWc_xxnleeePq7EcQ0AUmOY-e60m-X-X_c';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Can the database be read with the token we hold? A 404 here is what a
// database that exists but was never connected to the integration looks
// like — the single most common reason this feature appears dead.
async function probeDb(token, dbId) {
  try {
    const r = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization':  'Bearer ' + token,
        'Notion-Version': NOTION_VER,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ page_size: 100 }),
    });
    const d = await r.json();
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        code: d.code || null,
        hint: (r.status === 404)
          ? 'Notion can\'t see this database — open it, ⋯ → Connections, add your integration.'
          : (d.message || 'Notion rejected the query.'),
      };
    }
    return { ok: true, rows: (d.results || []).filter(p => !p.archived).length, more: !!d.has_more };
  } catch (err) {
    return { ok: false, status: 0, hint: 'Could not reach Notion: ' + String(err) };
  }
}

// A VAPID private key that doesn't belong to the public key baked into the
// client is the nastiest failure mode here: subscribing succeeds, sending
// succeeds locally, and the push service rejects every delivery. Proven by
// signing with the private half and verifying with the public half.
async function checkVapidPair(privateKey) {
  try {
    const pub = b64urlToBytes(VAPID_PUBLIC_KEY);
    if (pub.length !== 65 || pub[0] !== 0x04) return { ok: false, hint: 'Built-in public key is malformed.' };
    const x = bytesToB64url(pub.slice(1, 33));
    const y = bytesToB64url(pub.slice(33, 65));
    const alg = { name: 'ECDSA', namedCurve: 'P-256' };

    const priv = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y, d: privateKey }, alg, false, ['sign']);
    const verifier = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y }, alg, false, ['verify']);
    const probe = new TextEncoder().encode('sts-vapid-selfcheck');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, probe);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, sig, probe);
    return ok
      ? { ok: true }
      : { ok: false, hint: 'VAPID_PRIVATE_KEY does not match the app\'s public key — push would be rejected on delivery.' };
  } catch (err) {
    // Runtimes differ on where a bad key is caught: some reject at import
    // because they check the private scalar against the public point, others
    // import happily and only fail the verify above. Either way the fix is
    // the same env var, so say both things it could be.
    return { ok: false, hint: 'VAPID_PRIVATE_KEY is not a valid P-256 key, or is not the pair of the app\'s public key. Regenerate both halves together.' };
  }
}

// Last 4 digits only — enough to tell "the right phone" from "a typo".
function maskPhone(v) {
  const s = String(v || '');
  return s.length <= 4 ? '••••' : '••••' + s.slice(-4);
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

  const token = env.NOTION_TOKEN;
  const out = {
    checkedAt: new Date().toISOString(),
    notionToken: { ok: !!token, hint: token ? null : 'NOTION_TOKEN is not set in Cloudflare Pages → Settings → Environment Variables.' },
  };

  if (token) {
    const [messages, push] = await Promise.all([
      probeDb(token, MESSAGES_DB_ID),
      probeDb(token, PUSH_DB_ID),
    ]);
    out.messagesDb = messages;
    out.pushDb     = push;
    out.subscribedDevices = push.ok ? push.rows : null;
  }

  // ── Web Push ──
  const vapid = env.VAPID_PRIVATE_KEY;
  out.webPush = vapid
    ? { ...(await checkVapidPair(vapid)), configured: true }
    : { ok: false, configured: false, hint: 'VAPID_PRIVATE_KEY is not set — push is off, and sending a message stays silent by design.' };

  // ── SMS ──
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM_NUMBER: from, TWILIO_NOTIFY_TO: to } = env;
  const missing = [
    !sid && 'TWILIO_ACCOUNT_SID', !tok && 'TWILIO_AUTH_TOKEN',
    !from && 'TWILIO_FROM_NUMBER', !to && 'TWILIO_NOTIFY_TO',
  ].filter(Boolean);
  out.sms = missing.length
    ? { ok: false, configured: false, hint: 'Not set: ' + missing.join(', ') + '. SMS is off; messages still send.' }
    : { ok: true, configured: true, to: maskPhone(to), from: maskPhone(from),
        skipAuthor: env.TWILIO_NOTIFY_SKIP_AUTHOR || null };

  // Both paths deliberately skip the person who wrote the message, which
  // reads as "notifications are broken" when you test by messaging
  // yourself. Say so here rather than leaving it to be rediscovered.
  out.note = 'You are never notified about your own messages — test from a second device with a different name in "Sending as".';

  return json(out);
}
