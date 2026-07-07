# STS Workflow — Five Highest-Impact Architectural Upgrades

Analysis date: 2026-07-07. Grounded in the current code: `js/notion.js`, `js/app.js`,
`js/orders.js`, `js/data.js`, `functions/api/notion-pipeline.js`, `sw.js`, `_headers`.

---

## Day-0 bug found during review (fix before anything else)

`js/data.js:6` hardcodes the clock:

```js
const TODAY = new Date('2026-05-20');
```

`deadlineInfo()` (`js/app.js:13`) and the Kanban "Due ≤ 7 Days" stat filter
(`js/orders.js:185`) compute every deadline badge against **May 20**. As of July 7,
every "Due in Xd" / "overdue" badge on the board is ~7 weeks wrong. One-line fix:

```js
const TODAY = new Date();
```

---

## 1. Durable write pipeline — replace fire-and-forget saves with an outbox queue

### Rationale
Every write to Notion (`notionUpdateOrder`, `notionUpdateStage`, `notionCreateOrder`)
is a single `fetch` with no retry and no persistence. A stage drag on studio Wi-Fi
that drops the request is **silently lost**, and the app knows it — the failure toast
in `js/notion.js:88` literally says *"local change kept, but will be overwritten by
the next sync until this is fixed."* That is a documented data-loss window in the
system of record for customer orders. `notionUpdateStage` doesn't even check the
response. This is the single highest-leverage fix in the codebase.

### Concrete architecture
An **outbox pattern**: every mutation appends an operation to a persisted queue
(survives reloads), the UI updates optimistically, and a single flusher drains the
queue in order with exponential backoff. The queue doubles as the **dirty set** that
protects pending local writes from being clobbered by inbound syncs (used by
upgrade #2). Ops are coalesced per order+kind so dragging a card three times sends
one final stage patch, not three.

```
UI action ──▶ mutate ORDERS ──▶ render ──▶ Outbox.push(op) ──▶ persist queue
                                              │
             online / visible / interval ──▶ Outbox.flush() ──▶ /api/notion-pipeline
                                              │ success: shift op, persist
                                              │ 5xx/network: backoff, retry
                                              │ 4xx: drop poison op, log loudly
```

### Implementation blueprint

New file `js/sync.js` (load before `notion.js`):

```js
// ── OUTBOX — durable, ordered, coalescing write queue ─────────
const OUTBOX_KEY = 'sts-outbox-v1';

const Outbox = {
  queue: [], flushing: false, timer: null,

  load() {
    try { this.queue = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); }
    catch { this.queue = []; }
  },
  persist() {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(this.queue)); } catch {}
  },

  // key = notionId (or local app id pre-sync); kind = 'stage' | 'full' | 'create'
  push(op) {
    // Coalesce: a newer op of the same kind for the same order supersedes the old one.
    // A 'full' op also supersedes a pending 'stage' op (full body includes stage).
    this.queue = this.queue.filter(q =>
      !(q.key === op.key && (q.kind === op.kind || (op.kind === 'full' && q.kind === 'stage'))));
    this.queue.push({ ...op, ts: Date.now(), tries: 0 });
    this.persist();
    this.flush();
  },

  dirtyKeys() { return new Set(this.queue.map(q => q.key)); },

  async flush() {
    if (this.flushing || !this.queue.length || !navigator.onLine) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const op = this.queue[0];
        const outcome = await sendOp(op);
        if (outcome === 'retry') {
          op.tries++; this.persist();
          setConnStatus(false);
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.flush(),
            Math.min(60000, 2000 * 2 ** Math.min(op.tries, 5)));
          return;
        }
        if (outcome === 'drop') console.error('Outbox: dropping rejected op', op);
        this.queue.shift(); this.persist();
      }
      setConnStatus(true);
    } finally { this.flushing = false; }
  },
};

async function sendOp(op) {
  try {
    const r = await fetch('/api/notion-pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(op.body),
    });
    if (r.ok) {
      if (op.kind === 'create') {           // adopt the new Notion page id
        const d = await r.json().catch(() => ({}));
        const o = ORDERS.find(x => x.id === op.key);
        if (o && d.notionId) { o.notionId = d.notionId; saveToStorage(); }
      }
      return 'done';
    }
    // 429/5xx are transient; other 4xx are permanent (bad payload) — don't wedge the queue
    return (r.status === 429 || r.status >= 500) ? 'retry' : 'drop';
  } catch { return 'retry'; }               // network error
}

Outbox.load();
window.addEventListener('online', () => Outbox.flush());
document.addEventListener('visibilitychange', () => { if (!document.hidden) Outbox.flush(); });
setInterval(() => Outbox.flush(), 30000);
```

Callers change from direct fetches to queue pushes. `applyStageChange`
(`js/orders.js:1334`) becomes:

```js
function applyStageChange(order, stageId) {
  order.stage = stageId;
  order.localEditedAt = Date.now();                    // merge guard for upgrade #2
  if (stageId === 'complete') completedHidden.add(order.id);
  if (stageId === 'contact-done' && !order.contactedAt)
    order.contactedAt = new Date().toISOString().slice(0, 10);
  updateCompletedToggle();
  renderKanban();
  saveToStorage();
  Outbox.push({
    key:  order.notionId || order.id,
    kind: 'stage',
    body: { notionId: order.notionId, _stageOnly: true, stage: stageId },
  });
}
```

`notionUpdateOrder(order)` body becomes `Outbox.push({ key: order.notionId, kind:'full',
body: order })`; new-order creation becomes `kind:'create'` keyed by the local `u…` id
(this also replaces `notionPushUnsynced` — an order created offline is just an
unflushed create op). The `⚠ unsynced` card badge can now read truthfully from
`Outbox.dirtyKeys()` instead of only `!o.notionId`.

### Edge cases
- **Create-before-update ordering**: an order created offline then edited offline has a
  `create` op followed by a `full` op keyed by the same local id, with no `notionId` in
  the `full` body yet. Flush in strict FIFO and, when the create succeeds, rewrite
  the queued `full` op's `body.notionId` from the adopted page id before sending it.
- **Poison ops**: a permanent 4xx (e.g. a Notion select option that no longer exists)
  must be dropped, not retried forever — otherwise it blocks everything behind it.
  Surface it with a persistent toast, don't just `console.error`.
- **Two tabs open**: two tabs share one localStorage queue. Either flush under a
  `navigator.locks.request('sts-outbox', …)` guard, or accept the worst case
  (duplicate idempotent PATCHes to Notion — harmless for stage/full updates, but
  a duplicate **create** is not; guard creates with the lock at minimum).
- **Coalescing across kinds**: never let a `stage` op coalesce away a pending `full`
  op — the full body may carry other edited fields. The filter above only collapses
  same-kind, or full-over-stage.

---

## 2. Delta sync + background refresh — make multi-device actually converge

### Rationale
Sync currently happens **once, at page load** (`notionStartupSync`), as a **full
snapshot replacement** of `ORDERS`. There is no polling, no push, no delta. The iPad
at the bench and the desktop in the office diverge until someone hard-refreshes —
and when they do, the full replacement applies snapshot-level last-write-wins, which
is exactly how the "overwritten by the next sync" bug happens. Meanwhile the server
round-trip pulls the *entire* database (paginated 100/page) every time.

### Concrete architecture
- **Server**: `GET /api/notion-pipeline?since=<ISO>` adds a Notion
  `last_edited_time on_or_after` filter, and every returned order carries
  `lastEdited` (already available on the page object, currently discarded). The
  response envelope includes the server's own timestamp so client clock skew is
  irrelevant.
- **Client**: a `deltaSync()` that runs every 60s while visible and on
  `visibilitychange`, merging **per record** with two guards:
  1. skip any order in `Outbox.dirtyKeys()` (a pending local write always wins until
     it lands);
  2. per-record last-writer-wins using `no.lastEdited` vs `local.localEditedAt`.
- Full reconcile (the existing snapshot pull) demotes to once per app-open, to pick
  up deletions/archives that deltas can't see.

### Implementation blueprint

Server (`functions/api/notion-pipeline.js`, `onRequestGet`):

```js
export async function onRequestGet(context) {
  const token = context.env.NOTION_TOKEN;
  if (!token) return json({ error: 'NOTION_TOKEN not set' }, 500);
  const hdrs  = notionHdrs(token);
  const since = new URL(context.request.url).searchParams.get('since');

  const orders = [];
  let cursor;
  do {
    const body = { page_size: 100, sorts: [{ property: 'Customer Name', direction: 'ascending' }] };
    if (since) {
      // 2-minute overlap: Notion's last_edited_time is minute-granular
      const overlap = new Date(new Date(since).getTime() - 120000).toISOString();
      body.filter = { timestamp: 'last_edited_time', last_edited_time: { on_or_after: overlap } };
    }
    if (cursor) body.start_cursor = cursor;
    const r = await fetch(`${NOTION_API}/databases/${PIPELINE_DB}/query`,
      { method: 'POST', headers: hdrs, body: JSON.stringify(body) });
    if (!r.ok) { const err = await r.json().catch(() => ({})); return json({ error: err.message || 'query failed' }, r.status); }
    const d = await r.json();
    (d.results || []).forEach(p => { if (!p.archived) orders.push(pageToOrder(p)); });
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);

  return json({ syncedAt: new Date().toISOString(), orders });
}
```

…and add one line to `pageToOrder`: `lastEdited: page.last_edited_time,`.

Client (`js/notion.js`):

```js
let lastSyncAt = localStorage.getItem('sts-last-sync') || null;

async function deltaSync() {
  if (document.hidden) return;
  try {
    const url = PIPELINE_PROXY + (lastSyncAt ? '?since=' + encodeURIComponent(lastSyncAt) : '');
    const r = await fetch(url);
    if (!r.ok) { setConnStatus(false); return; }
    setConnStatus(true);
    const { syncedAt, orders: changed } = await r.json();

    const dirty  = Outbox.dirtyKeys();
    let touched  = false;
    for (const no of changed) {
      if (dirty.has(no.notionId) || dirty.has(no.id)) continue;     // pending local write wins
      const local = ORDERS.find(o =>
        (no.notionId && o.notionId === no.notionId) || o.id === no.id);
      if (!local) { ORDERS.push(no); touched = true; continue; }
      // Per-record last-writer-wins (Notion edit vs local edit)
      if (!local.localEditedAt || new Date(no.lastEdited).getTime() > local.localEditedAt) {
        preserveLocalFields(local, no);       // photo, pickup, contactedAt, … (existing list)
        Object.assign(local, no);
        touched = true;
      }
    }
    lastSyncAt = syncedAt;                    // server clock, not client clock
    localStorage.setItem('sts-last-sync', syncedAt);
    if (touched) { saveToStorage(); renderKanban(); if (typeof renderProduction === 'function') renderProduction(); }
  } catch { /* transient; next tick retries */ }
}

setInterval(deltaSync, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) deltaSync(); });
```

### Edge cases
- **Minute granularity + overlap**: Notion truncates `last_edited_time` to the
  minute, so a strict `after` filter misses same-minute edits. The 2-minute overlap
  re-delivers a few already-seen orders every tick — the merge must be idempotent
  (it is, given the LWW guard).
- **Deletes/archives are invisible to deltas**: an archived page just stops
  appearing. Keep one full-snapshot reconcile per app-open (the current
  `notionStartupSync`, now gated behind the dirty-set guard too), and treat "in local,
  absent from full snapshot, has notionId, not dirty" as delete.
- **Response envelope change**: `GET` now returns `{syncedAt, orders}` instead of a
  bare array — update `notionSyncFromNotion` and `notionStartupSync` in the same
  commit or the manual sync button breaks.
- **`localEditedAt` vs Notion echo**: after your own write flushes, the next delta
  returns that order with a fresh `lastEdited` that is *newer* than your
  `localEditedAt` — it will overwrite with identical data. Harmless, but don't
  "fix" it by bumping `localEditedAt` on flush, or you'll mask genuine remote edits.

---

## 3. Edge cache for the pipeline read path (Cloudflare KV, write-through invalidation)

### Rationale
`onRequestGet` does a full paginated Notion database scan **per page load per
device**. Notion's API budget is ~3 req/s average and each query page costs
~300–500ms — a growing archive means multi-second cold loads today and 429s as
device count and order history grow. Every read is identical across devices; this
is the textbook case for an edge cache. The repo already has precedent for this
worker pattern (ADR 0002, square-sync).

### Concrete architecture
KV namespace `PIPELINE_CACHE` bound to the Pages project. `GET` serves the cached
snapshot immediately when fresh (TTL ~30s), serves **stale-while-revalidate** when
older (respond with stale, refresh via `context.waitUntil`). Every successful `POST`
(create/update/stage/archive) deletes the key — a write from any device makes the
next read regenerate. Delta requests (`?since=`) bypass the cache: they're already
cheap (typically one small filtered page).

```
GET  ──▶ KV fresh? ──▶ serve (≈10ms edge)
          │ stale ──▶ serve stale + waitUntil(refresh KV)
          │ miss  ──▶ Notion full scan ──▶ KV put ──▶ serve
POST ──▶ Notion write ──▶ waitUntil(KV delete)
```

### Implementation blueprint

```js
const CACHE_KEY = 'pipeline-orders-v1';
const FRESH_MS  = 30 * 1000;

async function fetchAllFromNotion(token) { /* existing pagination loop, returns orders[] */ }

export async function onRequestGet(context) {
  const { env, request } = context;
  const since = new URL(request.url).searchParams.get('since');
  if (since) return json(await deltaFromNotion(env.NOTION_TOKEN, since));   // never cached

  const cached = await env.PIPELINE_CACHE.get(CACHE_KEY, 'json');
  const now = Date.now();

  if (cached && now - cached.at < FRESH_MS)
    return json({ syncedAt: cached.syncedAt, orders: cached.orders });

  if (cached) {  // stale-while-revalidate: instant response, background refresh
    context.waitUntil((async () => {
      const orders = await fetchAllFromNotion(env.NOTION_TOKEN);
      await env.PIPELINE_CACHE.put(CACHE_KEY,
        JSON.stringify({ at: Date.now(), syncedAt: new Date().toISOString(), orders }));
    })());
    return json({ syncedAt: cached.syncedAt, orders: cached.orders, stale: true });
  }

  const orders = await fetchAllFromNotion(env.NOTION_TOKEN);
  const snapshot = { at: now, syncedAt: new Date().toISOString(), orders };
  context.waitUntil(env.PIPELINE_CACHE.put(CACHE_KEY, JSON.stringify(snapshot)));
  return json({ syncedAt: snapshot.syncedAt, orders });
}

// at the end of every successful POST branch:
context.waitUntil(context.env.PIPELINE_CACHE.delete(CACHE_KEY));
```

Binding: Cloudflare dashboard → Pages project → Settings → Functions → KV namespace
bindings → `PIPELINE_CACHE`.

### Edge cases
- **KV is eventually consistent** (~60s cross-POP propagation). For a single studio
  hitting one POP this is a non-issue; but it means a POST's `delete` may not be
  visible instantly elsewhere. The client-side dirty-set guard from upgrade #1
  already makes a stale read harmless — do not skip that upgrade and rely on cache
  invalidation alone.
- **Write-then-read echo**: after a stage drag, a delta poll may still return the
  pre-write value from Notion itself (Notion's own read-after-write lag). Same
  answer: dirty-set guard.
- **Payload size**: a KV value caps at 25 MB — fine for order metadata, but never
  let photos or other blobs into this payload.
- **Edits made directly in Notion** bypass POST invalidation; they surface after the
  30s TTL. That's the tunable freshness knob — keep it ≤ your delta poll interval.

---

## 4. Storage layer: IndexedDB + separated photo blobs (kill the localStorage time bomb)

### Rationale
The entire business state persists via `localStorage.setItem('sts-orders',
JSON.stringify(ORDERS))` inside a **silent** `catch(e) {}` (`js/app.js:375`). Photos
are stored as uncompressed base64 data-URLs *inside the orders array*
(`order.photo = e.target.result`, `js/orders.js:1435`). localStorage caps at
~5 MB: a handful of iPhone photos (~2–4 MB each, +33% base64) and **every
subsequent save of all order data fails silently, forever** — the app looks fine
until a reload wipes everything back to the last successful save. It also makes
every `saveToStorage()` a synchronous main-thread stringify of megabytes, on every
drag.

### Concrete architecture
- `IndexedDB` database `sts` with two stores: `kv` (orders array, hidden set,
  registry — structured clone, no stringify) and `photos` (downscaled JPEG `Blob`s
  keyed by order id).
- Photos never live on the order object; cards resolve them through an
  object-URL cache.
- One-time migration from localStorage on first boot; loud failure toasts replace
  the silent catch.
- `navigator.storage.persist()` requested at startup to resist eviction.

### Implementation blueprint

New `js/store.js` (no libraries, no build step):

```js
const DB = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const rq = indexedDB.open('sts', 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); rq.result.createObjectStore('photos'); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror   = () => rej(rq.error);
  });
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t  = db.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror    = () => rej(t.error);
    });
  };
  return {
    get: (s, k) => tx(s, 'readonly',  os => os.get(k)),
    set: (s, k, v) => tx(s, 'readwrite', os => os.put(v, k)),
    del: (s, k) => tx(s, 'readwrite', os => os.delete(k)),
  };
})();

navigator.storage?.persist?.();
```

`saveToStorage` / `loadFromStorage` in `js/app.js`:

```js
async function saveToStorage() {
  try {
    await DB.set('kv', 'orders', ORDERS);          // photos are no longer on the objects
    await DB.set('kv', 'hidden', [...completedHidden]);
  } catch (e) {
    console.error('saveToStorage failed', e);
    toast('⚠ Local save failed — recent changes may not survive a reload', '⚠');
  }
}

async function loadFromStorage() {
  await migrateFromLocalStorage();                  // one-time, see below
  const saved = await DB.get('kv', 'orders');
  if (Array.isArray(saved) && saved.length) { ORDERS.length = 0; saved.forEach(o => ORDERS.push(o)); }
  const hidden = await DB.get('kv', 'hidden');
  (hidden || []).forEach(id => completedHidden.add(id));
  // …existing legacy-stage migration unchanged…
}

async function migrateFromLocalStorage() {
  if (await DB.get('kv', 'migrated-v1')) return;
  try {
    const raw = localStorage.getItem('sts-orders');
    if (raw) {
      const orders = JSON.parse(raw);
      for (const o of orders) {
        if (o.photo?.startsWith('data:')) {                    // data-URL → Blob, out of the array
          const blob = await (await fetch(o.photo)).blob();
          await DB.set('photos', o.id, blob);
          delete o.photo;
          o.hasPhoto = true;
        }
      }
      await DB.set('kv', 'orders', orders);
    }
    const hidden = localStorage.getItem('sts-hidden');
    if (hidden) await DB.set('kv', 'hidden', JSON.parse(hidden));
  } catch (e) { console.error('migration failed — keeping localStorage as-is', e); return; }
  await DB.set('kv', 'migrated-v1', true);
  // keep the localStorage copy for one release as a rollback net; delete next release
}
```

Photo capture, downscaled at the door (`js/orders.js`):

```js
const _photoUrls = new Map();   // orderId -> objectURL

async function attachPhoto(input, orderId) {
  const file = input.files[0];
  if (!file) return;
  const bmp   = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cvs   = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  cvs.getContext('2d').drawImage(bmp, 0, 0, cvs.width, cvs.height);
  const blob  = await cvs.convertToBlob({ type: 'image/jpeg', quality: 0.82 });  // ~100-250 KB
  await DB.set('photos', orderId, blob);
  const o = ORDERS.find(x => x.id === orderId);
  if (o) { o.hasPhoto = true; saveToStorage(); }
  if (_photoUrls.has(orderId)) { URL.revokeObjectURL(_photoUrls.get(orderId)); _photoUrls.delete(orderId); }
  renderKanban();
}

async function photoURL(orderId) {
  if (_photoUrls.has(orderId)) return _photoUrls.get(orderId);
  const blob = await DB.get('photos', orderId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  _photoUrls.set(orderId, url);
  return url;
}
```

`cardHTML` renders a placeholder `<img data-photo-id="…">` and a tiny post-render
pass fills `img.src = await photoURL(id)` — the base64 megastrings disappear from
both storage and DOM string building.

### Edge cases
- **Startup becomes async**: `loadFromStorage()` is now `await`ed; the bootstrap
  IIFE in `app.js` must become `async` and render *after* the load resolves (it
  currently also runs twice — once in `DOMContentLoaded`, once in `init()` — this is
  the moment to fix that duplication).
- **Photos are still single-device.** This upgrade makes them durable, not synced.
  If cross-device photos matter, upload the (now small) JPEG blob to the existing
  Drive integration and store the URL on the order in Notion — the blob store then
  becomes a cache.
- **iOS eviction**: Safari can evict IndexedDB for sites unused for weeks;
  `storage.persist()` plus keeping Notion as the source of truth for order data
  bounds the damage to photos only.
- **`OffscreenCanvas` support**: fine on current Safari/Chrome; if the studio has an
  older iPad, fall back to a hidden `<canvas>` + `toBlob`.
- **Migration is the risky step**: gate it behind the `migrated-v1` flag, never
  delete the localStorage copy in the same release, and abort (not half-write) on
  any error.

---## 5. Rendering: keyed incremental Kanban + event delegation + output escaping

### Rationale
`renderKanban()` throws away and rebuilds the **entire board's innerHTML** on every
drag, toggle, sync tick, and tab switch — including re-concatenating every card's
base64 photo into a megabyte-scale HTML string (until #4 lands). With upgrade #2's
60-second background merges, full-board rebuilds would also visibly destroy scroll
position and in-flight touch drags. Separately, `cardHTML` interpolates
`${o.name}`, `${o.desc}`, `${o.assignee}` etc. **unescaped** into HTML and
`'${o.id}'` into inline `onclick` strings. Order data arrives from Notion, Etsy and
Shopify imports — a customer name containing `<`, `"` or `'` breaks the board
layout at best (stored XSS surface at worst), today.

### Concrete architecture
- An `esc()` helper applied to every interpolated user-data field.
- A card element cache keyed by order id + a cheap revision string; re-render only
  cards whose revision changed, and only the stage bodies affected by a change.
- One delegated click/drag listener on `#kanbanBoard` reading `data-*` attributes,
  replacing all inline `onclick="…('${o.id}')"` handlers (which is also what makes
  quote-containing ids/names safe).

### Implementation blueprint

```js
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
```

`cardHTML` drops every inline handler and escapes every field:

```js
return `
  <div class="o-card${platformCls}${isCollapsed ? ' collapsed' : ''}"
       id="card-${esc(o.id)}" data-id="${esc(o.id)}" draggable="true">
    <div class="o-card-header">
      <div class="o-name">${esc(o.name)}${!o.notionId ? `<span class="o-unsynced" data-action="retry">⚠ unsynced</span>` : ''}</div>
      <button class="card-camera-btn${o.hasPhoto ? ' has-photo' : ''}" data-action="camera">📷</button>
      <button class="card-print-btn"  data-action="print">🖨</button>
      <button class="card-move-btn"   data-action="move">↪</button>
      <span   class="o-chevron"       data-action="toggle">▾</span>
    </div>
    …
    <div class="o-desc">${esc(o.desc)}</div>
    …`;
```

Delegation (once, at startup):

```js
document.getElementById('kanbanBoard').addEventListener('click', e => {
  const card = e.target.closest('.o-card');
  if (!card) return;
  const id     = card.dataset.id;
  const action = e.target.closest('[data-action]')?.dataset.action;
  switch (action) {
    case 'camera': return openCamera(id);
    case 'print':  return printOrder(id);
    case 'move':   return openStageSheet(id);
    case 'toggle': return toggleCard(id);
    case 'retry':  return retrySyncOrder(id);
    case 'photo':  return viewPhoto(id);
    default:       return openOrderCard(id);
  }
});

document.getElementById('kanbanBoard').addEventListener('dragstart', e => {
  const card = e.target.closest('.o-card');
  if (card) dragStart(e, card.dataset.id);
});
document.getElementById('kanbanBoard').addEventListener('pointerdown', e => {
  const card = e.target.closest('.o-card');
  if (card) cardPointerDown(e, card.dataset.id, 'kanban');
});
```

Keyed incremental render:

```js
const _cardCache = new Map();   // id -> { rev, el }

function cardRev(o) {
  return [o.stage, o.name, o.desc, o.price, o.deadline, o.assignee, o.pickup,
          o.contactedAt, o.hasPhoto, o.notionId ? 1 : 0,
          expandedCards.has(o.id) ? 1 : 0].join('|');
}

function cardEl(o) {
  const rev = cardRev(o);
  let c = _cardCache.get(o.id);
  if (!c || c.rev !== rev) {
    const tpl = document.createElement('template');
    tpl.innerHTML = cardHTML(o).trim();
    c = { rev, el: tpl.content.firstElementChild };
    _cardCache.set(o.id, c);
  }
  return c.el;
}

// Patch just one stage body (called for the from- and to-stages of a move)
function renderStageBody(stageId) {
  const body = document.querySelector(`.k-body[data-stage-id="${stageId}"]`);
  if (!body) return renderKanban();          // structural change → full render fallback
  const cards = ORDERS.filter(o => o.stage === stageId && visibleOnBoard(o));
  body.replaceChildren(...(cards.length ? cards.map(cardEl)
                                        : [Object.assign(document.createElement('div'),
                                            { className: 'k-empty', textContent: 'Drop here' })]));
  updateStageCounts(stageId);                // header/sub-head badge counters
}
```

`applyStageChange` then calls `renderStageBody(oldStage); renderStageBody(newStage);`
instead of `renderKanban()`; the full `renderKanban()` remains for tab entry, filter
changes, and sync merges that touch many orders.

### Edge cases
- **Cache eviction**: delete from `_cardCache` when an order is deleted/archived,
  and clear the whole cache on theme change or any edit to `cardHTML`'s structure
  (cheap: `_cardCache.clear()` inside full `renderKanban()`).
- **A cached element can only live in one place** — `replaceChildren` moves it. If a
  card could ever render in two panels simultaneously (Kanban + Ready-to-Ship tab),
  clone for the second surface or keep separate caches per surface.
- **Escaping scope**: `esc()` must also be applied in the other innerHTML builders
  (`production.js`, `customers.js`, stage sheet in `orders.js:1369`) — same data,
  same holes. The `Move "${order.name}"` title already uses `textContent` (safe);
  the pattern to hunt is `${o.…}` inside template-literal HTML.
- **Don't escape into attributes you also read back**: `data-id="${esc(o.id)}"` is
  correct because `dataset.id` HTML-decodes; but never build JS-in-string handlers
  again (`onclick="f('${id}')"`) — that's the class of bug delegation removes.
- The touch-drag ghost (`cloneNode(true)` in `app.js`) works unchanged on cached
  elements.

---

## Sequencing

| Order | Upgrade | Why this order |
|---|---|---|
| 0 | `TODAY` fix | one line, live correctness bug |
| 1 | #1 Outbox | removes the data-loss window; #2 and #3 depend on its dirty-set |
| 2 | #2 Delta sync | multi-device convergence; needs #1's guard to be safe |
| 3 | #4 IndexedDB + photos | defuses the quota bomb before it fires |
| 4 | #5 Incremental render + escaping | perf + security; easier after photos leave the DOM strings |
| 5 | #3 KV cache | pure additive server win, zero client risk, do anytime |

Not in the five, but worth noting: the service worker is currently a self-destruct
stub and every load re-downloads the 471 KB monolith over `no-store`. Once sync is
queue-based (#1) and storage is IndexedDB (#4), a versioned app-shell service worker
(network-first HTML, stale-while-revalidate JS, `skipWaiting` + update toast) makes
the app open instantly — and open *at all* — at a zero-signal farmers market, which
is where this business actually operates. It was left out only because the five
above are prerequisites for doing it without recreating the cache-staleness pain
that led to the SW being disabled.
