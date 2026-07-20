// ════════════════════════════════════════════
//  GMAIL BRIEF  —  /api/gmail-brief
//  Re-serves the static gmail-brief.json through the /api/* auth gate
//  (functions/api/_middleware.js, X-STS-Key). Direct requests to
//  /gmail-brief.json are 404'd by functions/_middleware.js because the
//  file contains real customer email content.
//
//  env.ASSETS.fetch reads the static asset directly, bypassing the
//  functions layer, so the root middleware's block doesn't apply here.
// ════════════════════════════════════════════

export async function onRequestGet(context) {
  const assetUrl = new URL('/gmail-brief.json', context.request.url);
  const res = await context.env.ASSETS.fetch(assetUrl);
  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'brief not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
