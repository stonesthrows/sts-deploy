// ════════════════════════════════════════════
//  SMS → Notion Notes  —  /api/sms-note
//  Cloudflare Pages Function
//  Twilio webhook: set SMS webhook URL to https://sts-deploy.pages.dev/api/sms-note
//
//  Required env vars:
//    NOTION_TOKEN   — Notion integration token
// ════════════════════════════════════════════

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';
const DB_ID      = 'fb115de84ac5433d84e61005f89ecdd2';

const BLOCK_MAP = {
  studio:   'Design Ideas',
  todo:     'To-Do',
  followup: 'Follow-up',
  toorder:  'To Order',
};

function autoDetect(text) {
  const t = text.toLowerCase();
  const followupWords = ['follow up', 'follow-up', 'call ', 'email ', 'contact ', 'reach out', 'check with', 'remind ', 'text '];
  const orderWords    = ['order ', 'orders ', 'buy ', 'restock', 'need more', 'running low', 'from rio', 'from stuller', 'from otto', 'from halstead', 'get more', 'pick up'];
  const todoWords     = ['finish ', 'complete ', 'make ', 'build ', 'fix ', 'clean ', 'update ', 'prepare ', 'ship ', 'solder ', 'set ', 'polish ', 'sand ', 'drill ', 'cut ', 'resize '];
  for (const w of followupWords) { if (t.includes(w)) return 'followup'; }
  for (const w of orderWords)    { if (t.includes(w)) return 'toorder'; }
  for (const w of todoWords)     { if (t.includes(w)) return 'todo'; }
  return 'studio';
}

function twimlResponse(message) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`,
    { status: 200, headers: { 'Content-Type': 'text/xml' } }
  );
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const notionToken = env.NOTION_TOKEN;
  if (!notionToken) return twimlResponse('Error: NOTION_TOKEN not configured.');

  // Parse Twilio's form-encoded body
  const formText = await request.text();
  const params = new URLSearchParams(formText);
  const body = (params.get('Body') || '').trim();

  if (!body) return twimlResponse('Empty message, nothing saved.');

  // Check for explicit category prefix: "todo: ...", "order: ...", "followup: ...", "studio: ..."
  let category = null;
  let text = body;
  const prefixMatch = body.match(/^(todo|order|toorder|followup|followup|studio)[:\s]+(.+)/is);
  if (prefixMatch) {
    const prefix = prefixMatch[1].toLowerCase().replace(/[\s-]/g, '');
    category = { todo: 'todo', toorder: 'toorder', order: 'toorder', followup: 'followup', studio: 'studio' }[prefix] || null;
    text = prefixMatch[2].trim();
  }
  if (!category) category = autoDetect(text);

  const block = BLOCK_MAP[category];

  const r = await fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: {
      'Authorization':  'Bearer ' + notionToken,
      'Notion-Version': NOTION_VER,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: DB_ID },
      properties: {
        'Note':  { title:  [{ text: { content: text.slice(0, 2000) } }] },
        'Block': { select: { name: block } },
        'Done':  { checkbox: false },
      },
    }),
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return twimlResponse('Error saving note: ' + (err.message || r.status));
  }

  return twimlResponse(`Saved to ${block} ✓`);
}
