// ════════════════════════════════════════════
//  Claude API Proxy  —  /api/claude-proxy
//  Cloudflare Pages Function
//  Forwards requests to Anthropic API to avoid browser CORS restrictions.
//  API key is sent in the request body (stored in client localStorage).
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { apiKey, ...claudeBody } = body;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: { message: 'Missing apiKey in request body' } }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(claudeBody),
    });

    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: { message: err.message || 'Proxy error' } }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }
}
