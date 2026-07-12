// ════════════════════════════════════════════
//  Claude API Proxy  —  /api/claude-proxy
//  Cloudflare Pages Function
//  Forwards requests to the Anthropic API. The API key lives here as a
//  server env var and never reaches the browser.
//  Required env: ANTHROPIC_API_KEY
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
    const apiKey = context.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY is not configured on the server' } }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    // Legacy clients may still send an `apiKey` field — ignore it, the
    // server-side key is always authoritative.
    const { apiKey: _ignored, ...claudeBody } = await context.request.json();

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
