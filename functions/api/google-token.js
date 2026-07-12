// ════════════════════════════════════════════
//  Google OAuth Token Exchange  —  /api/google-token
//  Cloudflare Pages Function
//  Exchanges an authorization code (PKCE) or a refresh token for Google
//  API tokens. The OAuth client secret lives here as a server env var
//  and never reaches the browser — client_id is not secret and may
//  still be supplied by the caller (falls back to env if omitted).
//  Required env: GOOGLE_CLIENT_SECRET
//  Optional env: GOOGLE_CLIENT_ID (default client_id if caller omits one)
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (!clientSecret) {
    return jsonResp({ error: { message: 'GOOGLE_CLIENT_SECRET is not configured on the server' } }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResp({ error: { message: 'Invalid JSON body' } }, 400);
  }

  const clientId = body.client_id || env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return jsonResp({ error: { message: 'Missing client_id' } }, 400);
  }

  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });

  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.redirect_uri || !body.code_verifier) {
      return jsonResp({ error: { message: 'Missing code, redirect_uri, or code_verifier' } }, 400);
    }
    params.set('grant_type',    'authorization_code');
    params.set('code',          body.code);
    params.set('redirect_uri',  body.redirect_uri);
    params.set('code_verifier', body.code_verifier);
  } else if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) {
      return jsonResp({ error: { message: 'Missing refresh_token' } }, 400);
    }
    params.set('grant_type',    'refresh_token');
    params.set('refresh_token', body.refresh_token);
  } else {
    return jsonResp({ error: { message: 'grant_type must be authorization_code or refresh_token' } }, 400);
  }

  try {
    const upstream = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await upstream.json();
    return jsonResp(data, upstream.status);
  } catch (err) {
    return jsonResp({ error: { message: err.message || 'Token exchange error' } }, 500);
  }
}
