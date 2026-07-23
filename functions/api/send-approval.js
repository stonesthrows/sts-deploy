// ════════════════════════════════════════════
//  Send Estimate Approval Email  —  /api/send-approval
//  Cloudflare Pages Function
//
//  Called from the iPad intake flow (which has no in-browser Gmail). Looks
//  up the approval record in KV by token and emails the customer a link to
//  the hosted approval page — server-side, via Gmail, from Kyle's real
//  address so the thread lives in his inbox.
//
//  Request:  { token }
//  The recipient + content come from the KV record, NOT the request, so
//  this public endpoint can only ever mail the address already on file for
//  an (unguessable) token — it can't be used to send arbitrary mail.
//
//  One-time setup (Cloudflare Pages env vars) — until these are set the
//  endpoint returns 503 and the caller falls back to copy/share the link:
//    GMAIL_CLIENT_ID · GMAIL_CLIENT_SECRET · GMAIL_REFRESH_TOKEN
//    (OAuth client for kyle@stonesthrowjewelry.com, scope gmail.send)
//  Optional: GMAIL_SENDER (defaults to kyle@stonesthrowjewelry.com)
// ════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const money = (n) => '$' + (Number(n) || 0).toFixed(2);

// Base64url encode a UTF-8 string for the Gmail raw payload.
function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function gmailAccessToken(env) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    throw new Error((d.error_description || d.error || 'token exchange failed'));
  }
  return d.access_token;
}

function estimateTable(lines, total) {
  const rows = (Array.isArray(lines) ? lines : []).map(ln =>
    `<tr><td style="padding:4px 0;color:#2b3648">${esc(ln.label)}</td>`
    + `<td style="padding:4px 0;text-align:right;color:#2b3648">${money(ln.amount)}</td></tr>`
  ).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:15px">
      ${rows}
      <tr><td style="padding:10px 0 0;border-top:1px solid #E4E2DD;font-weight:700">Total</td>
          <td style="padding:10px 0 0;border-top:1px solid #E4E2DD;text-align:right;font-weight:700">${money(total)}</td></tr>
    </table>`;
}

// Email can't toggle between options, so Compare (Option A/B/C) versions
// are laid out as stacked cards, each with its own image + line items.
function optionCards(options) {
  return options.map(o => `
    <div style="margin:0 0 18px;padding:16px;border:1px solid #E4E2DD;border-radius:10px;background:#fff">
      <p style="margin:0 0 10px;font-weight:700;color:#1E3D50">${esc(o.label)}${o.crowned ? ' <span style="font-weight:400;color:#8A7238;font-size:12px">★ recommended</span>' : ''}</p>
      ${o.image ? `<img src="${esc(o.image)}" alt="${esc(o.label)}" style="width:100%;max-width:520px;border-radius:8px;display:block;margin:0 0 12px;border:1px solid #E4E2DD">` : ''}
      ${estimateTable(o.lines, o.total)}
      ${o.notes ? `<p style="margin:12px 0 0;color:#3a4656;white-space:pre-wrap;font-size:14px">${esc(o.notes)}</p>` : ''}
    </div>`).join('');
}

// The Design gallery attached on the Approval step (sketch + any extra
// reference photos — e.g. the chosen stone) — separate from the per-option
// images inside optionCards(), which illustrate each Compare choice.
function galleryImages(images) {
  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  if (!list.length) return '';
  const imgs = list.map(src =>
    `<img src="${esc(src)}" alt="Design reference" style="width:100%;max-width:520px;border-radius:8px;display:block;margin:0 0 10px;border:1px solid #E4E2DD">`
  ).join('');
  return `<div style="margin:0 0 18px">${imgs}</div>`;
}

function buildHtml(rec, link) {
  // Stones Throw Studio brand colors: blue #4E7A94 · gold #C9983A
  // (match the webapp's --bg / --accent in css/app.css and the New Order button gradient)
  const hasOptions = Array.isArray(rec.options) && rec.options.length > 1;
  const estimate = hasOptions ? optionCards(rec.options) : estimateTable(rec.lines, rec.total);
  // Skip any general-gallery photo that's byte-identical to an option's
  // image — it already shows inside that option's card, no need to repeat it.
  const optionImages = hasOptions ? new Set(rec.options.map(o => o.image).filter(Boolean)) : new Set();
  const galleryOnly = (Array.isArray(rec.images) ? rec.images : []).filter(src => !optionImages.has(src));
  const gallery = galleryImages(galleryOnly);
  const title = rec.title
    ? `<p style="margin:0 0 10px;font-weight:700;color:#1E3D50">${esc(rec.title)}</p>` : '';
  // In Compare mode each option carries its own note (rendered inside its
  // card above) — the shared note only applies to the single-option case.
  const note = (!hasOptions && rec.notesForCustomer)
    ? `<p style="margin:18px 0 0;color:#3a4656;white-space:pre-wrap">${esc(rec.notesForCustomer)}</p>` : '';
  const intro = hasOptions
    ? "here are the design options for your piece — take a look at each and let me know which one you'd like, or if it's good to go."
    : "here's the estimate for your piece. Take a look and let me know if it's good to go.";

  return `<div style="background:#4E7A94;padding:32px 16px;font-family:-apple-system,Segoe UI,Arial,sans-serif">
   <div style="background:#FAFAF9;max-width:600px;margin:0 auto;padding:32px 28px;border-radius:12px;border:1px solid #E4E2DD">
    <div style="max-width:560px;margin:0 auto;color:#2b3648">
    <h2 style="color:#4E7A94;font-weight:700;margin:0 0 4px">Your custom estimate is ready</h2>
    <p style="margin:0 0 18px;color:#5a6675">Hi ${esc(rec.customerName || 'there')}, ${intro}</p>
    ${title}
    ${gallery}
    ${estimate}
    ${note}
    <p style="margin:26px 0;text-align:center">
      <a href="${esc(link)}" style="display:inline-block;background:linear-gradient(135deg,#C9983A,#A87C28);color:#ffffff;text-decoration:none;font-weight:700;padding:14px 30px;border-radius:10px">Review &amp; Approve →</a>
    </p>
    <p style="margin:0;color:#7a8698;font-size:13px">Or paste this link into your browser:<br>${esc(link)}</p>
    <p style="margin:22px 0 0;color:#7a8698;font-size:13px">— Kyle Gross · Stones Throw Studio · stonesthrowjewelry.com</p>
    </div>
   </div>
  </div>`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { env } = context;
  const kv = env.STS_DESIGNS;
  if (!kv) return json({ error: 'KV binding STS_DESIGNS not configured' }, 503);

  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    return json({ error: 'email-not-configured', message: 'Gmail send is not set up yet — copy the link to send it manually.' }, 503);
  }

  let body; try { body = await context.request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
  const token = String(body.token || '').trim();
  if (!token) return json({ error: 'Missing token' }, 400);

  const raw = await kv.get(`approval:${token}`);
  if (!raw) return json({ error: 'Not found' }, 404);
  let rec; try { rec = JSON.parse(raw); } catch (e) { return json({ error: 'Corrupt record' }, 500); }

  const to = (rec.customerEmail || '').trim();
  if (!to) return json({ error: 'No customer email on file for this estimate' }, 400);

  const link = new URL(context.request.url).origin + '/approval?token=' + encodeURIComponent(token);
  const sender = env.GMAIL_SENDER || 'kyle@stonesthrowjewelry.com';
  const subject = 'Your custom estimate from Stones Throw Studio';

  // RFC 2822 message with an HTML body.
  const mime = [
    'From: Stones Throw Studio <' + sender + '>',
    'To: ' + to,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    buildHtml(rec, link),
  ].join('\r\n');

  try {
    const accessToken = await gmailAccessToken(env);
    const r = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: b64url(mime) }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: (d.error && d.error.message) || 'Gmail send failed' }, 502);
    return json({ ok: true, to, threadId: d.threadId || null });
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
