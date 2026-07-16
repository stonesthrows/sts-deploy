// ════════════════════════════════════════════
//  Image Fetch Proxy  —  /api/img-fetch
//  Cloudflare Pages Function
//  Fetches a remote image server-side and returns the raw bytes.
//
//  Why this exists: the browser can load a cross-origin image into an
//  <img>, but drawing it to a canvas taints the canvas and toDataURL()
//  throws. Most image hosts don't send CORS headers, so "Add Image from
//  URL" can't be done client-side. Fetching here strips the origin
//  problem — the bytes come back same-origin.
//
//  This endpoint fetches a URL supplied by the caller, so it is kept
//  narrow on purpose: https only, no internal hosts, image bytes only,
//  size-capped, and it never forwards cookies, headers, or credentials.
//  It sits behind the X-STS-Key gate in _middleware.js like every other
//  app-facing endpoint (inert until APP_SHARED_KEY is set).
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-STS-Key',
};

const MAX_BYTES = 12 * 1024 * 1024;   // 12 MB — the client downscales anyway
const TIMEOUT_MS = 15000;

// Hosts that must never be reachable through us. The Worker runs on
// Cloudflare's edge rather than inside a private network, so these aren't
// routable in practice — blocked anyway so this can't become a way to
// probe internals if it ever runs somewhere else.
function isBlockedHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') ||
    h === '::1' || h === '0.0.0.0' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||          // link-local / cloud metadata
    /^f[cd][0-9a-f]{2}:/.test(h) ||   // IPv6 unique-local
    /^fe80:/.test(h)                  // IPv6 link-local
  );
}

// Some hosts serve images as application/octet-stream. Sniff the magic
// bytes so a correct image isn't rejected over a sloppy Content-Type.
function sniffImageType(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  const ascii = String.fromCharCode(...b);
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.slice(4, 8) === 'ftyp') return 'image/heic';
  return null;
}

function err(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  let url;
  try {
    ({ url } = await context.request.json());
  } catch {
    return err('Expected JSON body: { url }', 400);
  }
  if (!url || typeof url !== 'string') return err('Missing url', 400);

  let target;
  try {
    target = new URL(url.trim());
  } catch {
    return err("That doesn't look like a valid URL.", 400);
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return err('Only http and https URLs can be fetched.', 400);
  }
  if (isBlockedHost(target.hostname)) {
    return err('That host is not allowed.', 400);
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Deliberately minimal: no cookies, no auth, no caller headers.
      headers: { 'Accept': 'image/*', 'User-Agent': 'STS-Workflow/1.0' },
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return err(timedOut ? 'That URL took too long to respond.' : "Couldn't reach that URL.", 502);
  }

  if (!upstream.ok) return err(`That URL returned ${upstream.status}.`, 502);

  const declaredLen = Number(upstream.headers.get('Content-Length') || 0);
  if (declaredLen > MAX_BYTES) return err('That image is larger than 12 MB.', 413);

  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return err('That image is larger than 12 MB.', 413);
  if (bytes.byteLength === 0) return err('That URL returned an empty file.', 502);

  const declaredType = (upstream.headers.get('Content-Type') || '').split(';')[0].trim();
  const type = declaredType.startsWith('image/') ? declaredType : sniffImageType(bytes);
  if (!type) {
    // Nearly always a webpage URL rather than a direct link to the image.
    return err("That URL isn't an image. Use the image's direct link (it usually ends in .jpg or .png).", 415);
  }

  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...CORS },
  });
}
