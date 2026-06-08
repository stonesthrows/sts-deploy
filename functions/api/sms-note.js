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
const DB_ID      = 'fb115de8-4ac5-433d-84e6-1005f89ecdd2';

const BLOCK_MAP = {
  studio:  'Design Ideas',
  todo:    'To-Do',
  toorder: 'To Order',
  restock: 'Inventory Restock',
  webapp:  'Webapp Updates',
  market:  'Market & Display To-Do',
};

const PREFIX_TRIGGERS = {
  restock:  ['restock', 'replenish', 'low on', 'out of', 'running out', 'running low', 'need more', 'get more', 'stock up'],
  toorder:  ['order', 'orders', 'buy'],
  todo:     ['to do:', 'to-do:', 'todo:'],
  studio:   ['design:', 'idea:'],
  webapp:   ['webapp:', 'web app:', 'app update:'],
  market:   ['market:', 'booth:', 'display:'],
};

// ── Detection ────────────────────────────────
function autoDetect(text) {
  const t = text.toLowerCase();
  const restockWords  = ['restock', 'replenish', 'low on ', 'out of ', 'running out', 'running low', 'need more', 'get more', 'stock up', 'studio stock', 'size '];
  const orderWords    = ['order ', 'orders ', 'buy ', 'from rio', 'from stuller', 'from otto', 'from halstead', 'pick up'];
  const todoWords     = ['to do:', 'to-do:', 'todo:', 'finish ', 'complete ', 'make ', 'build ', 'fix ', 'clean ', 'update ', 'prepare ', 'ship ', 'solder ', 'set ', 'polish ', 'sand ', 'drill ', 'cut ', 'resize '];
  const designWords   = ['design ', 'idea ', 'sketch ', 'concept ', 'inspiration', 'try making', 'experiment'];
  const webappWords   = ['webapp', 'web app', 'app update', 'app bug', 'app feature', 'site update', 'website '];
  const marketWords   = ['for market', 'market display', 'booth ', 'vendor display', 'display stand', 'market to-do', 'market todo'];
  for (const w of restockWords)  { if (t.includes(w)) return 'restock';  }
  for (const w of orderWords)    { if (t.includes(w)) return 'toorder';  }
  for (const w of todoWords)     { if (t.includes(w)) return 'todo';     }
  for (const w of designWords)   { if (t.includes(w)) return 'studio';   }
  for (const w of webappWords)   { if (t.includes(w)) return 'webapp';   }
  for (const w of marketWords)   { if (t.includes(w)) return 'market';   }
  return null;
}

function stripTriggerPrefix(text, key) {
  const triggers = PREFIX_TRIGGERS[key] || [];
  const t = text.toLowerCase();
  for (const trigger of triggers) {
    if (t.indexOf(trigger) === 0) {
      return text.slice(trigger.length).replace(/^[\s:,\-]+/, '').trim();
    }
  }
  return text;
}

// ── Formatting ───────────────────────────────
function singularize(word) {
  if (word.length <= 3) return word;
  const lw = word.toLowerCase();
  if (/(?:ss|us|is|as|os|ies)$/.test(lw)) return word;
  if (lw.endsWith('s')) return word.slice(0, -1);
  return word;
}

function formatNoteText(text) {
  // "size 8 spinners" → "Spinner Ring size 8"
  const reverseMatch = text.match(/^size\s+([\d.]+)\s+(.+)$/i);
  if (reverseMatch) {
    const sizePart = reverseMatch[1].trim();
    const namePart = reverseMatch[2].trim();
    const titled = namePart.split(' ').map(w => {
      const s = singularize(w);
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }).join(' ') + (!/ring/i.test(namePart) ? ' Ring' : '');
    return titled + ' size ' + sizePart;
  }
  // "cats size 5,6.5" → "Cat Ring size 5, 6.5"
  const forwardMatch = text.match(/^(.+?)\s+size\s+(.+)$/i);
  if (forwardMatch) {
    const namePart = forwardMatch[1].trim();
    const sizePart = forwardMatch[2].trim();
    const titled = namePart.split(' ').map(w => {
      const s = singularize(w);
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }).join(' ') + (!/ring/i.test(namePart) ? ' Ring' : '');
    return titled + ' size ' + sizePart;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── Size grouping ─────────────────────────────
function isNumericSize(s) {
  return /^\d+(\.\d+)?$/.test(s.trim());
}

function groupSizes(parts) {
  const items = [];
  let currentBase = null;
  let extraSizes = [];
  for (const part of parts) {
    if (isNumericSize(part)) {
      extraSizes.push(part.trim());
    } else {
      if (currentBase !== null) {
        items.push(extraSizes.length > 0 ? currentBase + ', ' + extraSizes.join(', ') : currentBase);
      }
      currentBase = part;
      extraSizes = [];
    }
  }
  if (currentBase !== null) {
    items.push(extraSizes.length > 0 ? currentBase + ', ' + extraSizes.join(', ') : currentBase);
  }
  return items;
}

// ── Twilio response ───────────────────────────
function twimlResponse(message) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`,
    { status: 200, headers: { 'Content-Type': 'text/xml' } }
  );
}

// ── Notion save ───────────────────────────────
async function saveNote(text, block, token) {
  const r = await fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: {
      'Authorization':  'Bearer ' + token,
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
    throw new Error(err.message || r.status);
  }
}

// ── Main handler ──────────────────────────────
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const notionToken = env.NOTION_TOKEN;
  if (!notionToken) return twimlResponse('Error: NOTION_TOKEN not configured.');

  const formText = await request.text();
  const params   = new URLSearchParams(formText);
  const body     = (params.get('Body') || '').trim();

  if (!body) return twimlResponse('Empty message, nothing saved.');

  // Check for explicit bucket prefix: "restock: ...", "todo: ...", etc.
  let category = null;
  let text = body;
  const prefixMatch = body.match(/^(todo|order|toorder|restock|studio|design|webapp|web.?app|market|booth)[:\s]+(.+)/is);
  if (prefixMatch) {
    const p = prefixMatch[1].toLowerCase().replace(/[\s-]/g, '');
    category = { todo: 'todo', toorder: 'toorder', order: 'toorder', restock: 'restock', studio: 'studio', design: 'studio', webapp: 'webapp', market: 'market', booth: 'market' }[p] || null;
    text = prefixMatch[2].trim();
  }

  // Auto-detect if no explicit prefix
  if (!category) category = autoDetect(text);

  // Still nothing — reply asking for clarification
  if (!category) {
    return twimlResponse(
      'Can\'t detect bucket. Reply with a prefix:\n' +
      'todo: / order: / restock: / design: / webapp: / market:\n' +
      'e.g. "restock: ' + body + '"'
    );
  }

  // Strip trigger prefix and format each item
  text = stripTriggerPrefix(text, category);
  const rawParts = text.split(/[,;]+/).map(p => p.trim()).filter(p => p.length > 0);
  const parts    = groupSizes(rawParts).map(formatNoteText);
  const block    = BLOCK_MAP[category];

  // Save all items to Notion
  try {
    await Promise.all(parts.map(part => saveNote(part, block, notionToken)));
  } catch (err) {
    return twimlResponse('Error saving note: ' + err.message);
  }

  const label = { studio: 'Design Ideas', todo: 'To-Do', toorder: 'To Order', restock: 'Inventory Restock', webapp: 'Webapp Updates', market: 'Market & Display To-Do' }[category];
  return twimlResponse(
    parts.length > 1
      ? `Saved ${parts.length} items to ${label} ✓\n` + parts.map((p, i) => `${i + 1}. ${p}`).join('\n')
      : `Saved to ${label} ✓\n→ ${parts[0]}`
  );
}
