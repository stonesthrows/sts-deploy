// ════════════════════════════════════════════
//  Google Cloud Vision API Proxy  —  /api/vision-proxy
//  Cloudflare Pages Function
//  Forwards OCR requests to Google Cloud Vision to avoid browser CORS restrictions.
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
    const { apiKey, ...visionBody } = body;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: { message: 'Missing apiKey in request body' } }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    const upstream = await fetch(
      'https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(visionBody),
      }
    );

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
