// ════════════════════════════════════════════
//  Customer Messages Proxy  —  /api/notion-messages
//  Cloudflare Pages Function
//  Requires env var: NOTION_TOKEN
//
//  Internal-staff Q&A thread per customer (Customer Card "Team Messages"),
//  stored as flat records in a dedicated Notion database — same shape as
//  notion-notes.js, just different properties.
//
//  SMS notify on new message (optional): reuses the Twilio number already
//  wired for inbound SMS-to-notes (see sms-note.js). Requires env vars
//  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_NOTIFY_TO
//  — silently skipped (message send still succeeds) if any are unset, so
//  this stays a no-op until someone opts in via Cloudflare Pages env vars.
//
//  Web Push notify on new message (optional): delivers a real OS-level
//  notification to every device registered via /api/push-subscribe (see
//  js/push-notify.js + sw.js's "push" handler). Requires env var
//  VAPID_PRIVATE_KEY — silently skipped otherwise. VAPID_PUBLIC_KEY is not
//  secret and is hardcoded below to match js/push-notify.js.
// ════════════════════════════════════════════

// Vendored, not an npm dependency: this Cloudflare Pages project has no
// configured build command, so `npm install` never runs before the
// Functions bundler resolves imports — a bare package specifier here
// fails the deploy ("Could not resolve '@block65/webcrypto-web-push'").
// See functions/_vendor/webcrypto-web-push.js for provenance.
import { buildPushPayload } from '../_vendor/webcrypto-web-push.js';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
// "STS Customer Messages" — properties: Text (title), Customer Key,
// Customer Name, Author (rich text), Created (date).
const DB_ID      = 'e5a38cb3-7845-4ee7-94e7-ef6dcebf101d';

// "STS Push Subscriptions" — properties: Endpoint (title), P256dh, Auth,
// Owner Name (rich text), Created (date). See functions/api/push-subscribe.js.
const PUSH_DB_ID = 'aa8e0af3-4981-4156-8f62-855f0a914fb0';

// Not secret — this is the public half of the VAPID key pair, meant to be
// embedded in client JS. Keep in sync with js/push-notify.js. The private
// half lives only in the VAPID_PRIVATE_KEY Cloudflare Pages env var.
const VAPID_PUBLIC_KEY = 'BPlW0roALoDK6gSXOmbPd6RA9ZSc6-NcTOgWlTpXM55SZOrAr2DhHwWc_xxnleeePq7EcQ0AUmOY-e60m-X-X_c';
const VAPID_SUBJECT     = 'mailto:kyle@stonesthrowjewelry.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function hdrs(token) {
  return {
    'Authorization':  'Bearer ' + token,
    'Notion-Version': NOTION_VER,
    'Content-Type':   'application/json',
  };
}

function pageToMessage(page) {
  const p = page.properties;
  return {
    notionPageId: page.id,
    text:         p['Text']?.title?.[0]?.plain_text         || '',
    customerKey:  p['Customer Key']?.rich_text?.[0]?.plain_text  || '',
    customerName: p['Customer Name']?.rich_text?.[0]?.plain_text || '',
    author:       p['Author']?.rich_text?.[0]?.plain_text        || '',
    orderId:      p['Order Id']?.rich_text?.[0]?.plain_text      || '',
    orderLabel:   p['Order Label']?.rich_text?.[0]?.plain_text   || '',
    createdAt:    p['Created']?.date?.start || page.created_time,
  };
}

// Fire-and-forget SMS via Twilio's REST API. Never throws — a notify
// failure must not fail the underlying message send. Silently no-ops if
// the Twilio env vars aren't configured, so this feature stays opt-in.
async function notifySms(env, { customerName, author, text, orderLabel }) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM_NUMBER: from, TWILIO_NOTIFY_TO: to } = env;
  if (!sid || !token || !from || !to) return;
  // Lets the notify recipient send their own messages (e.g. replying to
  // staff) without texting themselves.
  if (env.TWILIO_NOTIFY_SKIP_AUTHOR && String(author || '').trim().toLowerCase() === env.TWILIO_NOTIFY_SKIP_AUTHOR.trim().toLowerCase()) return;

  const body = `💬 ${author || 'Someone'} on ${customerName}${orderLabel ? ' (' + orderLabel + ')' : ''}: ${text}`.slice(0, 300);
  try {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(sid + ':' + token),
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
  } catch (err) {
    console.error('notion-messages SMS notify failed:', err);
  }
}

// Fire-and-forget Web Push to every registered device except the sender's
// own (matched by Owner Name, same convention as TWILIO_NOTIFY_SKIP_AUTHOR).
// A subscription that the push service reports as gone (404/410 — user
// uninstalled, revoked permission, etc.) is archived so it stops being
// queried on every future message.
async function notifyPush(env, h, { customerKey, customerName, author, text, orderLabel }) {
  if (!env.VAPID_PRIVATE_KEY) return;
  const vapid = { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };

  let subs;
  try {
    const r = await fetch(`${NOTION_API}/databases/${PUSH_DB_ID}/query`, {
      method: 'POST', headers: h, body: JSON.stringify({ page_size: 100 }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Notion query failed');
    subs = (d.results || []).filter(p => !p.archived);
  } catch (err) {
    console.error('notion-messages push subscriber lookup failed:', err);
    return;
  }

  const authorNorm = String(author || '').trim().toLowerCase();
  // Land the tap where the thread actually is. A message tagged to an order
  // opens that order's Messages tab; an untagged one still goes to the
  // customer's thread. Tag likewise collapses per order, so two jobs for the
  // same person don't overwrite each other's notification.
  const deepLink = orderId
    ? `/jewelry-workflow.html?openOrder=${encodeURIComponent(orderId)}`
    : `/jewelry-workflow.html?openCustomer=${encodeURIComponent(customerName)}`;
  const message = {
    data: {
      title: orderLabel ? `💬 ${customerName} — ${orderLabel}` : `💬 ${customerName}`,
      body:  `${author || 'Someone'}: ${text}`.slice(0, 200),
      url:   deepLink,
      tag:   orderId ? `msg-${customerKey}-${orderId}` : `msg-${customerKey}`,
    },
    options: { ttl: 60 * 60 * 24, urgency: 'normal' },
  };

  await Promise.allSettled(subs.map(async page => {
    const p = page.properties;
    const ownerName = p['Owner Name']?.rich_text?.[0]?.plain_text || '';
    if (ownerName && ownerName.trim().toLowerCase() === authorNorm) return;

    const subscription = {
      endpoint:       p['Endpoint']?.title?.[0]?.plain_text || '',
      expirationTime: null,
      keys: {
        p256dh: p['P256dh']?.rich_text?.[0]?.plain_text || '',
        auth:   p['Auth']?.rich_text?.[0]?.plain_text    || '',
      },
    };
    if (!subscription.endpoint || !subscription.keys.p256dh || !subscription.keys.auth) return;

    try {
      const payload = await buildPushPayload(message, subscription, vapid);
      const res = await fetch(subscription.endpoint, payload);
      if (res.status === 404 || res.status === 410) {
        await fetch(`${NOTION_API}/pages/${page.id}`, {
          method: 'PATCH', headers: h, body: JSON.stringify({ archived: true }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error('notion-messages push send failed:', err);
    }
  }));
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    return await _handle(context);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// Keeps background work alive past the response WITHOUT detaching
// waitUntil from its context. `const { waitUntil } = context; waitUntil(p)`
// throws "Illegal invocation" in the Workers runtime, because waitUntil is
// a prototype method that needs its `this` — and because the notify calls
// sit after the Notion write, that throw turned a perfectly good send into
// a 500 with the message already saved: no notification, and an error on a
// message that had in fact gone through.
//
// Falls back to firing the promise bare if no waitUntil is available, which
// is still better than throwing. Both notify functions swallow their own
// errors, so neither can reject into an unhandled rejection here.
function runAfterResponse(context, promise) {
  try {
    if (context && typeof context.waitUntil === 'function') context.waitUntil(promise);
  } catch (err) {
    console.error('waitUntil unavailable, notify running detached:', err);
  }
}

async function _handle(context) {
  const { request, env } = context;
  const token = env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const h = hdrs(token);

  // ── GET — fetch all messages (client filters by customer) ───
  if (request.method === 'GET') {
    const messages = [];
    let cursor;
    do {
      const body = {
        page_size: 100,
        sorts: [{ property: 'Created', direction: 'ascending' }],
      };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
        method: 'POST', headers: h, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.message || 'Notion query failed', code: d.code, status: r.status }, r.status);
      (d.results || []).forEach(p => { if (!p.archived) messages.push(pageToMessage(p)); });
      cursor = d.has_more ? d.next_cursor : null;
    } while (cursor);
    return json(messages);
  }

  // ── POST — create a message ──────────────────
  if (request.method === 'POST') {
    const { customerKey, customerName, author, text, orderId, orderLabel, createdAt } = await request.json();
    if (!customerKey || !text) return json({ error: 'customerKey and text required' }, 400);
    const r = await fetch(`${NOTION_API}/pages`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        parent: { database_id: DB_ID },
        properties: {
          'Text':          { title:     [{ text: { content: String(text).slice(0, 2000) } }] },
          'Customer Key':  { rich_text: [{ text: { content: String(customerKey).slice(0, 200) } }] },
          'Customer Name': { rich_text: [{ text: { content: String(customerName || '').slice(0, 200) } }] },
          'Author':        { rich_text: [{ text: { content: String(author || '').slice(0, 100) } }] },
          'Order Id':      { rich_text: orderId    ? [{ text: { content: String(orderId).slice(0, 200) } }]    : [] },
          'Order Label':   { rich_text: orderLabel ? [{ text: { content: String(orderLabel).slice(0, 200) } }] : [] },
          'Created':       { date: { start: createdAt || new Date().toISOString() } },
        },
      }),
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.message || 'create failed' }, r.status);
    runAfterResponse(context, notifySms(env, { customerName, author, text, orderLabel }));
    runAfterResponse(context, notifyPush(env, h, { customerKey, customerName, author, text, orderLabel }));
    return json({ notionPageId: d.id });
  }

  // ── DELETE — archive ─────────────────────────
  if (request.method === 'DELETE') {
    const pageId = new URL(request.url).searchParams.get('pageId');
    if (!pageId) return json({ error: 'pageId required' }, 400);
    const r = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ archived: true }),
    });
    if (!r.ok) return json({ error: 'delete failed' }, r.status);
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
