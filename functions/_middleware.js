// ════════════════════════════════════════════
//  STATIC FILE GATE  —  functions/_middleware.js
//  Runs for EVERY request to the site (Cloudflare Pages root middleware).
//
//  Problem it solves: Pages serves the whole repo as static assets, so
//  internal docs, data exports, dev scripts, and the Gmail brief were all
//  readable by anyone who guessed the URL (CLAUDE.md, *.csv, *.ps1,
//  gmail-brief.json, …). This returns 404 for anything on the deny-list
//  below. App pages, JS, icons, and /api/* are untouched.
//
//  gmail-brief.json is special: the app still needs it, so it's re-served
//  through /api/gmail-brief (see functions/api/gmail-brief.js), which sits
//  behind the X-STS-Key gate in functions/api/_middleware.js.
// ════════════════════════════════════════════

// Extensions that are never part of the served app
const BLOCKED_EXT = /\.(md|ps1|bat|py|csv)$/i;

// Directory prefixes that are repo internals, not app assets
const BLOCKED_PREFIX = [
  '/docs/',
  '/stuller-sync/',
  '/sts-worker-v2/',
  '/.claude/',
];

// Individual files with sensitive or non-public content
const BLOCKED_FILE = new Set([
  '/gmail-brief.json',   // real customer email content — served via /api/gmail-brief instead
  '/serve.js',           // local dev server
  '/.mcp.json',
  '/.gitignore',
  '/med_batch.json',     // product/batch data exports — app never fetches these
  '/med_batch_inline.json',
  '/med_item_0.json',
  '/med_item_1.json',
  '/med_item_2.json',
  '/med_item_3.json',
  '/med_item_4.json',
]);

export async function onRequest(context) {
  const { pathname } = new URL(context.request.url);

  // /api/* has its own auth middleware (functions/api/_middleware.js)
  if (!pathname.startsWith('/api/')) {
    if (BLOCKED_EXT.test(pathname) ||
        BLOCKED_FILE.has(pathname) ||
        BLOCKED_PREFIX.some(p => pathname.startsWith(p))) {
      return new Response('Not found', { status: 404 });
    }
  }

  return context.next();
}
