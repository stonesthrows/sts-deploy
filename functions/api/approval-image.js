// ════════════════════════════════════════════
//  Approval Image  —  GET /api/approval-image
//  Cloudflare Pages Function
//
//  Serves a single image from an approval record as raw bytes, so the
//  emailed estimate can reference a real https:// URL instead of an inline
//  base64 data: URI. Two problems that fixes:
//    1. Most email clients strip inline data: image sources on receipt —
//       the photos wouldn't reliably show up at all.
//    2. Building + re-base64-encoding a multi-MB MIME string (several
//       photos embedded inline, then the whole message re-encoded again
//       for the Gmail API's `raw` field) risks exceeding the Worker's CPU
//       time limit, which surfaces to the studio as an opaque 503 with no
//       useful error text.
//
//  GET /api/approval-image?token=...&kind=gallery&i=<index>
//  GET /api/approval-image?token=...&kind=option&i=<option index>&j=<image index>
//  Public — same trust boundary as approval.html (the unguessable token
//  IS the capability), so no auth gate here either.
// ════════════════════════════════════════════

const KEY = (token) => `approval:${token}`;

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m || !m[2]) return null;   // only base64 data URLs are ever stored
  const mime = m[1] || 'application/octet-stream';
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
}

export async function onRequestGet(context) {
  const kv = context.env.STS_DESIGNS;
  if (!kv) return new Response('KV not configured', { status: 503 });

  const url = new URL(context.request.url);
  const token = url.searchParams.get('token');
  const kind = url.searchParams.get('kind');
  const i = parseInt(url.searchParams.get('i'), 10);
  const j = url.searchParams.has('j') ? parseInt(url.searchParams.get('j'), 10) : null;
  if (!token || !kind || Number.isNaN(i)) return new Response('Bad request', { status: 400 });

  const raw = await kv.get(KEY(token));
  if (!raw) return new Response('Not found', { status: 404 });
  let rec; try { rec = JSON.parse(raw); } catch (e) { return new Response('Corrupt record', { status: 500 }); }

  let dataUrl = null;
  if (kind === 'gallery' && Array.isArray(rec.images)) dataUrl = rec.images[i];
  if (kind === 'option' && Array.isArray(rec.options) && rec.options[i]) {
    const opt = rec.options[i];
    dataUrl = Array.isArray(opt.images) ? opt.images[j == null || Number.isNaN(j) ? 0 : j] : null;
  }
  if (!dataUrl) return new Response('Not found', { status: 404 });

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return new Response('Bad image', { status: 500 });

  return new Response(parsed.bytes, {
    headers: {
      'Content-Type': parsed.mime,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
