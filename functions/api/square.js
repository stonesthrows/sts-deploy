// Cloudflare Pages Function — proxies Square API calls to avoid CORS
export async function onRequestPost(context) {
  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { path, method = 'GET', body, token: clientToken } = payload;

  const token = clientToken || context.env.SQUARE_TOKEN;
  if (!token) return jsonResponse({ error: 'Missing token' }, 400);
  if (!path)  return jsonResponse({ error: 'Missing path'  }, 400);

  const sqRes = await fetch('https://connect.squareup.com' + path, {
    method,
    headers: {
      'Authorization':  'Bearer ' + token,
      'Content-Type':   'application/json',
      'Square-Version': '2025-01-23',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await sqRes.json();
  return jsonResponse(data, sqRes.status);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
