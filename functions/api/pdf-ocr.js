// ════════════════════════════════════════════
//  PDF OCR  —  /api/pdf-ocr
//  Cloudflare Pages Function
//  Fetches a Google Drive PDF with the user's OAuth token,
//  sends it to Cloud Vision API, returns extracted text.
//  Requires env var: VISION_API_KEY
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Encode ArrayBuffer to base64 in chunks (avoids stack overflow on large files)
function toBase64(buffer) {
  const bytes  = new Uint8Array(buffer);
  const chunk  = 8192;
  let binary   = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }
  if (context.request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const VISION_KEY = context.env.VISION_API_KEY;
  if (!VISION_KEY) return json({ error: 'VISION_API_KEY not configured' }, 500);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { fileId, accessToken } = body;
  if (!fileId || !accessToken) return json({ error: 'fileId and accessToken required' }, 400);

  // ── 1. Fetch PDF from Google Drive ──────────────────────────
  const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  let pdfResp;
  try {
    pdfResp = await fetch(driveUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    return json({ error: 'Network error fetching from Drive: ' + e.message }, 502);
  }

  if (!pdfResp.ok) {
    const msg = await pdfResp.text().catch(() => pdfResp.statusText);
    return json({ error: `Drive fetch failed (${pdfResp.status}): ${msg}` }, pdfResp.status);
  }

  const pdfBuffer = await pdfResp.arrayBuffer();
  // Vision API limit: 20 MB inline
  if (pdfBuffer.byteLength > 20 * 1024 * 1024) {
    return json({ error: 'PDF exceeds 20 MB — too large for inline Vision API request' }, 413);
  }

  const pdfBase64 = toBase64(pdfBuffer);

  // ── 2. Send to Cloud Vision API ──────────────────────────────
  const visionUrl = `https://vision.googleapis.com/v1/files:annotate?key=${VISION_KEY}`;
  let visionResp;
  try {
    visionResp = await fetch(visionUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          inputConfig: {
            content:  pdfBase64,
            mimeType: 'application/pdf',
          },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          pages: [1, 2, 3, 4, 5],  // up to 5 pages per request
        }],
      }),
    });
  } catch (e) {
    return json({ error: 'Network error calling Vision API: ' + e.message }, 502);
  }

  if (!visionResp.ok) {
    let errMsg = visionResp.statusText;
    try {
      const errData = await visionResp.json();
      errMsg = errData?.error?.message || errData?.error?.status || errMsg;
    } catch { /* keep statusText */ }
    return json({ error: `Vision API error (${visionResp.status}): ${errMsg}` }, visionResp.status);
  }

  const visionData = await visionResp.json();

  // ── 3. Extract text ──────────────────────────────────────────
  // Response shape: { responses: [{ responses: [{ fullTextAnnotation: { text } }] }] }
  const pages = [];
  try {
    const outer = visionData.responses?.[0]?.responses ?? [];
    outer.forEach((pageResp, i) => {
      const text = pageResp.fullTextAnnotation?.text?.trim() ?? '';
      if (text) pages.push({ page: i + 1, text });
    });
  } catch (e) {
    return json({ error: 'Failed to parse Vision response: ' + e.message }, 500);
  }

  const fullText = pages.map(p => p.text).join('\n\n---\n\n');
  return json({ text: fullText, pages, pageCount: pages.length });
}
