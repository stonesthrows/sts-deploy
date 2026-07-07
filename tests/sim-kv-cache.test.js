// Simulation test: functions/api/notion-pipeline.js (KV edge cache +
// delta filter + write-through invalidation).
// Run: node tests/sim-kv-cache.test.js  (no dependencies)
const assert = require('assert');

global.Response = class {
  constructor(body, init) { this.body = body; this.status = (init||{}).status || 200; }
  async json() { return JSON.parse(this.body); }
};

function mkPage(id, name, stage, edited) {
  return {
    id, archived: false, last_edited_time: edited,
    properties: {
      'Customer Name': { title: [{ plain_text: name }] },
      'App ID': { rich_text: [{ plain_text: 'app-' + id }] },
      'Stage': { select: { name: stage } },
    },
  };
}

// In-memory fake KV
function makeKV() {
  const m = new Map();
  return {
    get: async (k, type) => m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null,
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    _store: m,
  };
}

let notionCalls;
function stubNotion(pagesResponses) {
  notionCalls = [];
  global.fetch = async (url, opts) => {
    notionCalls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
    if (url.includes('/query')) {
      const page = pagesResponses.shift() || { results: [], has_more: false };
      if (page.__error) return { ok: false, status: page.status || 500, json: async () => ({ message: 'boom' }) };
      return { ok: true, status: 200, json: async () => page };
    }
    // PATCH/POST to /pages/*
    return { ok: true, status: 200, json: async () => ({ id: 'new-page-id' }) };
  };
}

function waitUntils() {
  const tasks = [];
  return { waitUntil: p => tasks.push(p), flush: async () => Promise.all(tasks) };
}

// Load the real source like a <script> tag: vm.runInThisContext shares the
// global lexical environment, so the file's top-level const/function
// declarations are visible to the test code below.
const vm   = require('vm');
const path = require('path');
const fs = require('fs');
// Pages Functions use ESM exports; strip them so the file runs as a classic script
const fnSrc = fs.readFileSync(path.join(__dirname, '..', 'functions', 'api', 'notion-pipeline.js'), 'utf8')
  .replace(/^export /gm, '');
vm.runInThisContext(fnSrc, { filename: 'functions/api/notion-pipeline.js' });

(async () => {
  // ── 1. Cold cache (no KV entry): blocks on Notion, caches result ──
  const kv = makeKV();
  stubNotion([{ results: [mkPage('p1','A','At the Bench','2026-07-07T09:00:00.000Z')], has_more: false }]);
  let ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv }, request: { url: 'https://x/api/notion-pipeline' } });
  let resp = await onRequestGet(ctx);
  let d = await resp.json();
  assert.strictEqual(d.orders.length, 1, 'cold miss returns data');
  assert.strictEqual(notionCalls.filter(c => c.url.includes('/query')).length, 1, 'cold miss hits Notion once');
  const cachedRaw = await kv.get('pipeline:orders:v1');
  assert.ok(cachedRaw, 'cache populated after cold miss');

  // ── 2. Fresh cache hit: no Notion call at all ──
  stubNotion([]); // if Notion is called, there's nothing to return -> would break
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv }, request: { url: 'https://x/api/notion-pipeline' } });
  resp = await onRequestGet(ctx);
  d = await resp.json();
  assert.strictEqual(d.orders.length, 1, 'fresh hit still returns cached data');
  assert.strictEqual(notionCalls.length, 0, 'fresh hit makes zero Notion calls');

  // ── 3. Stale-while-revalidate: instant stale response + background refresh ──
  const rec = await kv.get('pipeline:orders:v1', 'json');
  rec.at = Date.now() - 45000; // 45s old: stale but under the 5min ceiling
  await kv.put('pipeline:orders:v1', JSON.stringify(rec));
  stubNotion([{ results: [mkPage('p1','A Updated','At the Bench','2026-07-07T09:05:00.000Z')], has_more: false }]);
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv }, request: { url: 'https://x/api/notion-pipeline' } });
  resp = await onRequestGet(ctx);
  d = await resp.json();
  assert.strictEqual(d.stale, true, 'stale flag set');
  assert.strictEqual(d.orders[0].name, 'A', 'served the OLD value instantly, not blocked on refresh');
  await ctx.flush(); // let the background refresh complete
  const refreshed = await kv.get('pipeline:orders:v1', 'json');
  assert.strictEqual(refreshed.orders[0].name, 'A Updated', 'background refresh updated the cache');

  // ── 4. Next request after background refresh gets the new data, fresh ──
  stubNotion([]);
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv }, request: { url: 'https://x/api/notion-pipeline' } });
  resp = await onRequestGet(ctx);
  d = await resp.json();
  assert.strictEqual(d.orders[0].name, 'A Updated', 'subsequent request sees refreshed data');
  assert.strictEqual(notionCalls.length, 0, 'no Notion call needed — cache was fresh again');

  // ── 5. Beyond stale ceiling: blocks and refreshes synchronously ──
  const rec2 = await kv.get('pipeline:orders:v1', 'json');
  rec2.at = Date.now() - 6 * 60 * 1000; // 6 min old, beyond 5-min ceiling
  await kv.put('pipeline:orders:v1', JSON.stringify(rec2));
  stubNotion([{ results: [mkPage('p1','A Fresh','At the Bench','2026-07-07T09:10:00.000Z')], has_more: false }]);
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv }, request: { url: 'https://x/api/notion-pipeline' } });
  resp = await onRequestGet(ctx);
  d = await resp.json();
  assert.strictEqual(d.orders[0].name, 'A Fresh', 'beyond ceiling blocks for fresh data, not stale');
  assert.strictEqual(d.stale, undefined, 'not marked stale once refreshed synchronously');

  // ── 6. Notion error with a cached copy available: falls back to stale, doesn't 500 ──
  stubNotion([{ __error: true, status: 503 }]);
  const recBad = await kv.get('pipeline:orders:v1', 'json');
  recBad.at = Date.now() - 6 * 60 * 1000;
  await kv.put('pipeline:orders:v1', JSON.stringify(recBad));
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv }, request: { url: 'https://x/api/notion-pipeline' } });
  resp = await onRequestGet(ctx);
  d = await resp.json();
  assert.strictEqual(resp.status, 200, 'Notion outage does not surface as a 500 when cache exists');
  assert.strictEqual(d.stale, true, 'served stale on Notion error');

  // ── 7. Notion error with NO cache at all: real error surfaces ──
  const kv2 = makeKV();
  stubNotion([{ __error: true, status: 503 }]);
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv2 }, request: { url: 'https://x/api/notion-pipeline' } });
  resp = await onRequestGet(ctx);
  assert.strictEqual(resp.status, 503, 'no cache + Notion down surfaces the real error');

  // ── 8. Delta requests (?since=) bypass the cache entirely ──
  stubNotion([{ results: [mkPage('p2','B','Estimate Sent','2026-07-07T10:00:00.000Z')], has_more: false }]);
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv }, request: { url: 'https://x/api/notion-pipeline?since=2026-07-07T09:00:00.000Z' } });
  resp = await onRequestGet(ctx);
  d = await resp.json();
  assert.strictEqual(notionCalls.filter(c => c.url.includes('/query')).length, 1, 'delta always hits Notion');
  assert.ok(notionCalls[0].body.filter, 'delta request carries a filter');
  const stillCached = await kv.get('pipeline:orders:v1', 'json');
  assert.strictEqual(stillCached.orders[0].name, 'A Fresh', 'delta request did not touch the full-pull cache');

  // ── 9. No KV bound at all (local dev): falls through cleanly ──
  stubNotion([{ results: [mkPage('p3','C','Estimate Sent','2026-07-07T11:00:00.000Z')], has_more: false }]);
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't' }, request: { url: 'https://x/api/notion-pipeline' } });
  resp = await onRequestGet(ctx);
  d = await resp.json();
  assert.strictEqual(d.orders[0].name, 'C', 'works with no KV binding at all');

  // ── 10. POST invalidates the cache — write-through ──
  stubNotion([]); // update path doesn't use /query for a notionId update
  const kv3 = makeKV();
  await kv3.put('pipeline:orders:v1', JSON.stringify({ at: Date.now(), syncedAt: 'x', orders: [{ id: 'old' }] }));
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv3 },
    request: { json: async () => ({ notionId: 'n1', name: 'Updated', id: 'app-1' }) } });
  resp = await onRequestPost(ctx);
  assert.strictEqual(resp.status, 200, 'update succeeds');
  await ctx.flush();
  const postCache = await kv3.get('pipeline:orders:v1');
  assert.strictEqual(postCache, null, 'cache invalidated after a successful update');

  // ── 11. Stage-only patch also invalidates ──
  const kv4 = makeKV();
  await kv4.put('pipeline:orders:v1', JSON.stringify({ at: Date.now(), syncedAt: 'x', orders: [] }));
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv4 },
    request: { json: async () => ({ notionId: 'n1', _stageOnly: true, stage: 'build' }) } });
  resp = await onRequestPost(ctx);
  await ctx.flush();
  assert.strictEqual(await kv4.get('pipeline:orders:v1'), null, 'stage patch invalidates cache too');

  // ── 12. Failed write does NOT invalidate cache ──
  stubNotion([]);
  global.fetch = async (url) => ({ ok: false, status: 400, json: async () => ({ message: 'bad' }) });
  const kv5 = makeKV();
  await kv5.put('pipeline:orders:v1', JSON.stringify({ at: Date.now(), syncedAt: 'x', orders: [{id:'keep'}] }));
  ctx = Object.assign(waitUntils(), { env: { NOTION_TOKEN: 't', STS_KV: kv5 },
    request: { json: async () => ({ notionId: 'n1', _stageOnly: true, stage: 'build' }) } });
  resp = await onRequestPost(ctx);
  assert.strictEqual(resp.status, 400, 'failed patch surfaces error');
  await ctx.flush();
  assert.ok(await kv5.get('pipeline:orders:v1'), 'cache untouched on failed write');

  console.log('ALL KV CACHE SIMULATION TESTS PASSED');
})().catch(e => { console.error('FAIL:', e.message, e.stack); process.exit(1); });
