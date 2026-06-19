// ════════════════════════════════════════════
//  Etsy OAuth 2.0 (PKCE)  —  /api/etsy-auth
//  Cloudflare Pages Function
//
//  One-time setup flow:
//    1. Visit /api/etsy-auth?action=start
//    2. Approve on Etsy
//    3. Redirected back here with ?code= — tokens stored in KV
//
//  Required env: ETSY_CLIENT_SECRET
//  Required KV binding: STS_KV
//  Etsy app must have redirect URI: https://sts-deploy.pages.dev/api/etsy-auth
// ════════════════════════════════════════════

const ETSY_CLIENT_ID  = 'jv4p59xlneoub7bzzew2m1xq';
const ETSY_OAUTH_URL  = 'https://www.etsy.com/oauth/connect';
const ETSY_TOKEN_URL  = 'https://api.etsy.com/v3/public/oauth/token';
const ETSY_API_BASE   = 'https://openapi.etsy.com/v3';
const REDIRECT_URI    = 'https://sts-deploy.pages.dev/api/etsy-auth';
const SCOPES          = 'transactions_r profile_r';

function bytesToBase64Url(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generatePKCE() {
  const rawVerifier = crypto.getRandomValues(new Uint8Array(32));
  const verifier    = bytesToBase64Url(rawVerifier);
  const digest      = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge   = bytesToBase64Url(new Uint8Array(digest));
  return { verifier, challenge };
}

function html(body) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etsy Auth</title>
     <style>body{font-family:system-ui,sans-serif;max-width:500px;margin:60px auto;padding:0 20px;text-align:center;}
     .ok{color:#2a7a2a;} .err{color:#c00;} code{background:#f3f3f3;padding:2px 6px;border-radius:4px;font-size:13px;}
     a{color:#d97706;}</style></head><body>${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const kv           = env.STS_KV;
  const clientSecret = env.ETSY_CLIENT_SECRET;

  if (!kv) return html('<h2 class="err">⚠ STS_KV binding not configured</h2><p>Add a KV namespace called <code>STS_KV</code> in Cloudflare Pages → Settings → Functions → KV namespace bindings.</p>');

  const url    = new URL(request.url);
  const action = url.searchParams.get('action');
  const code   = url.searchParams.get('code');
  const state  = url.searchParams.get('state');

  // ── Step 1: Start OAuth ──────────────────────────────────────
  if (action === 'start') {
    const { verifier, challenge } = await generatePKCE();
    const stateStr = crypto.randomUUID();

    await kv.put('etsy:pkce:verifier', verifier,  { expirationTtl: 600 });
    await kv.put('etsy:pkce:state',    stateStr,  { expirationTtl: 600 });

    const authUrl = new URL(ETSY_OAUTH_URL);
    authUrl.searchParams.set('response_type',         'code');
    authUrl.searchParams.set('redirect_uri',          REDIRECT_URI);
    authUrl.searchParams.set('scope',                 SCOPES);
    authUrl.searchParams.set('client_id',             ETSY_CLIENT_ID);
    authUrl.searchParams.set('state',                 stateStr);
    authUrl.searchParams.set('code_challenge',        challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return Response.redirect(authUrl.toString(), 302);
  }

  // ── Step 2: OAuth Callback ───────────────────────────────────
  if (code) {
    const savedState   = await kv.get('etsy:pkce:state');
    const codeVerifier = await kv.get('etsy:pkce:verifier');

    if (!savedState || state !== savedState) {
      return html('<h2 class="err">OAuth state mismatch</h2><p>Try <a href="/api/etsy-auth?action=start">starting over</a>.</p>');
    }

    // Exchange code for tokens
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     ETSY_CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      code,
      code_verifier: codeVerifier,
    });
    if (clientSecret) body.set('client_secret', clientSecret);

    const tokenRes = await fetch(ETSY_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return html(`<h2 class="err">Token exchange failed</h2><p>${err}</p><p><a href="/api/etsy-auth?action=start">Try again</a></p>`);
    }

    const tokens     = await tokenRes.json();
    const expiresAt  = Date.now() + (tokens.expires_in * 1000);

    await kv.put('etsy:access_token',  tokens.access_token);
    await kv.put('etsy:refresh_token', tokens.refresh_token);
    await kv.put('etsy:expires_at',    String(expiresAt));

    // Discover shop_id via users/me
    let shopId   = null;
    let shopName = null;
    try {
      const meRes = await fetch(`${ETSY_API_BASE}/application/users/me`, {
        headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'x-api-key': ETSY_CLIENT_ID },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        const shopsRes = await fetch(`${ETSY_API_BASE}/application/users/${me.user_id}/shops`, {
          headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'x-api-key': ETSY_CLIENT_ID },
        });
        if (shopsRes.ok) {
          const shopsData = await shopsRes.json();
          const shop = shopsData.results?.[0] || shopsData;
          shopId   = shop?.shop_id   || null;
          shopName = shop?.shop_name || null;
          if (shopId) await kv.put('etsy:shop_id', String(shopId));
        }
      }
    } catch (_) { /* non-fatal */ }

    const shopLine = shopId
      ? `<p class="ok">🏪 Shop: <strong>${shopName || shopId}</strong> (ID: ${shopId})</p>`
      : `<p class="err">⚠ Could not auto-detect shop ID. Add <code>ETSY_SHOP_ID</code> env var in Cloudflare Pages.</p>`;

    return html(`
      <h2 class="ok">✅ Etsy Connected!</h2>
      ${shopLine}
      <p>Tokens stored. You can now use the <strong>🛍 Sync Etsy</strong> button in the Order Pipeline.</p>
      <p><a href="/jewelry-workflow">← Return to app</a></p>
    `);
  }

  return html('<h2>Etsy Auth</h2><p><a href="/api/etsy-auth?action=start">Connect Etsy</a></p>');
}
