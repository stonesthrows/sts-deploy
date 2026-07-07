// ════════════════════════════════════════════
//  SYNC OUTBOX  —  js/sync.js
//  Durable write queue for the Notion pipeline.
//
//  Every Notion mutation is recorded here first (persisted to
//  localStorage, survives reloads), then a single flusher delivers ops
//  in order with retry + exponential backoff. A dropped request is
//  retried until Notion confirms it — never silently lost.
//
//  Ops store only ids, never full order bodies: the body is built from
//  the live ORDERS array at flush time. So an order created or edited
//  offline always flushes with its latest state, and a queued update
//  automatically picks up the notionId once its create lands.
//
//  Op shape: { uid, key, kind, notionId?, stage?, tries, ts }
//    key  = app order id (stable, always present)
//    kind = 'create' | 'full' | 'stage'
//
//  Must load AFTER data.js (ORDERS) and BEFORE notion.js.
// ════════════════════════════════════════════

const OUTBOX_KEY = 'sts-outbox-v1';

const Outbox = {
  queue:   [],
  _drainP: null,
  _timer:  null,

  load() {
    try { this.queue = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); }
    catch(e) { this.queue = []; }
  },
  persist() {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(this.queue)); } catch(e) {}
  },

  has(key, kind) {
    return this.queue.some(q => q.key === key && (!kind || q.kind === kind));
  },
  // Orders with a write still in flight — inbound syncs must not overwrite these
  dirtyKeys() { return new Set(this.queue.map(q => q.key)); },

  push(op) {
    // A pending create already delivers the order's full live state at
    // flush time — follow-up full/stage ops for the same order are redundant.
    if (op.kind !== 'create' && this.has(op.key, 'create')) { this.schedule(); return; }
    // Coalesce: the newest op of a kind supersedes older ones for the same
    // order, and a full update supersedes stage patches (its live body
    // carries the stage). Three quick drags flush as one patch.
    this.queue = this.queue.filter(q => !(q.key === op.key &&
      (q.kind === op.kind || (op.kind === 'full' && q.kind === 'stage'))));
    this.queue.push(Object.assign({
      uid:   Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      tries: 0,
      ts:    Date.now(),
    }, op));
    this.persist();
    this.schedule();
  },

  schedule(delayMs) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), delayMs || 0);
  },

  // Returns a promise that resolves when this flush attempt finishes.
  // Cross-tab: a Web Lock ensures only one tab drains the shared queue.
  flush() {
    if (this._drainP) return this._drainP;
    if (!this.queue.length || !navigator.onLine) return Promise.resolve();
    const run = (navigator.locks && navigator.locks.request)
      ? navigator.locks.request('sts-outbox-flush', { ifAvailable: true },
          lock => lock ? this._drain() : undefined)
      : this._drain();
    this._drainP = Promise.resolve(run)
      .catch(e => console.error('Outbox flush error', e))
      .then(() => { this._drainP = null; });
    return this._drainP;
  },

  async _drain() {
    while (true) {
      this.load();                       // pick up ops pushed by other tabs
      if (!this.queue.length) break;
      const op = this.queue[0];
      const outcome = await outboxSend(op);

      if (outcome === 'retry') {
        op.tries = (op.tries || 0) + 1;
        this.persist();
        if (typeof setConnStatus === 'function') setConnStatus(false);
        this.schedule(Math.min(60000, 2000 * Math.pow(2, Math.min(op.tries, 5))));
        return;
      }
      // 'done' or 'drop' — remove exactly the op we sent. Re-load first so a
      // push that happened mid-send (from this tab or another) isn't clobbered.
      this.load();
      this.queue = this.queue.filter(q => q.uid !== op.uid);
      this.persist();
    }
    if (typeof setConnStatus === 'function') setConnStatus(true);
  },
};

// ── Deliver one op. Returns 'done' | 'retry' | 'drop'. ──────────
async function outboxSend(op) {
  let body;
  if (op.kind === 'stage') {
    if (!op.notionId) return 'drop';
    body = { notionId: op.notionId, _stageOnly: true, stage: op.stage };
  } else {
    if (typeof ORDERS === 'undefined' || !ORDERS.length) return 'retry'; // not hydrated yet
    const o = ORDERS.find(x => x.id === op.key);
    if (!o) return 'drop';                                // order deleted locally
    if (op.kind === 'create' && o.notionId) return 'done'; // already created elsewhere
    body = Object.assign({}, o);
    delete body.photo;                                    // local-only, can be MBs of base64
    if (op.kind === 'create') delete body.notionId;
    // A 'full' op for an order with no page yet POSTs without notionId,
    // which creates the page — the id is adopted below either way.
  }

  let r;
  try {
    r = await fetch('/api/notion-pipeline', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch(e) {
    return 'retry';                                       // network error — keep queued
  }

  if (r.ok) {
    if (!body.notionId) {                                 // a create — adopt the new page id
      const d = await r.json().catch(() => ({}));
      const o = ORDERS.find(x => x.id === op.key);
      if (o && d.notionId && !o.notionId) {
        o.notionId = d.notionId;
        if (typeof saveToStorage === 'function') saveToStorage();
        if (typeof renderKanban === 'function') renderKanban(); // clears ⚠ unsynced badge
      }
    }
    return 'done';
  }

  if (r.status === 429 || r.status >= 500) return 'retry'; // transient
  // Permanent rejection (bad payload, deleted Notion page, …) — drop it so it
  // can't wedge the queue behind it, but say so loudly.
  const err = await r.json().catch(() => ({}));
  console.error('Outbox: Notion rejected op — dropping', op, err);
  if (typeof toast === 'function') {
    toast('⚠ Notion rejected a change (' + (err.error || r.status) + ') — see console', '⚠');
  }
  return 'drop';
}

// ── Bootstrap ────────────────────────────────────────────────────
Outbox.load();
window.addEventListener('online', () => Outbox.flush());
document.addEventListener('visibilitychange', () => { if (!document.hidden) Outbox.flush(); });
setInterval(() => Outbox.flush(), 30000);
// First flush shortly after load, once ORDERS has hydrated from localStorage
document.addEventListener('DOMContentLoaded', () => setTimeout(() => Outbox.flush(), 1500));
