# STS Workflow — Comprehensive Code Audit

**Date:** 2026-07-11
**Scope:** `jewelry-workflow.html` (active app) + `js/` modules, `functions/api/` Cloudflare Pages Functions, and deployment config (`_headers`, `sw.js`, repo layout). The retired `crm/` folder, `clickup.js`, and `time-tracker.html` were noted but not audited in depth.
**Codebase size:** ~34,800 lines of HTML/JS; 522 KB main HTML file; ~35 serverless functions.

---

## Executive summary

The app is functional and shows real care in places (the pointer-based touch-drag implementation in `app.js`, Square webhook HMAC verification in `square-webhook.js`, ADRs under `docs/`). But it has three critical, internet-facing exposures that should be addressed before any refactoring work:

1. **Every `/api/*` endpoint is unauthenticated and uses `Access-Control-Allow-Origin: *`.** Anyone who knows the URL can read, write, and archive all customer/order data in Notion via `https://sts-deploy.pages.dev/api/notion-orders` and ~30 sibling endpoints.
2. **Stored XSS through unescaped order/customer names.** `renderKanban` and peers interpolate `${o.name}`/`${c.name}` straight into `innerHTML`.
3. **Live credentials (Anthropic key, Square token) live in `localStorage`**, reachable by any of the XSS sinks above.

Fastest high-leverage move: put **Cloudflare Access (Zero Trust)** in front of the whole `sts-deploy.pages.dev` project (free for small teams, ~1 hour, zero code change) to gate both the app and `/api/*`. Then fix the API auth and XSS issues below at leisure.

> **Note on provenance:** this document was produced during a code-audit session. The audit itself was also delivered in-conversation. If a header/section here disagrees with the live code, trust the code and re-verify — line numbers are current as of the commit this file was added on.

---

## 1. Code Quality & Technical Debt

### 1.1 Frozen clock — `TODAY` is hardcoded to a past date
**Location:** `js/data.js:6`
```js
const TODAY = new Date('2026-05-20');
```
**Why:** `deadlineInfo()` (`js/app.js:10-17`) computes overdue / due-soon against `TODAY`, not the real date. Every deadline badge drifts from the actual calendar — the single most operationally important signal on the board is silently wrong.
**Refactor:**
```js
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);   // midnight-normalize so day diffs are stable
```
If the frozen date exists for reproducible demo screenshots, gate it:
```js
const TODAY = new URLSearchParams(location.search).has('demo')
  ? new Date('2026-05-20') : new Date();
```

### 1.2 Monolithic 10,850-line HTML file
**Location:** `jewelry-workflow.html` — `<style>` blocks at lines 16, 7141, 7904, 8537, 9133…; inline `<script>` blocks at 5396, 8195, 10207, 10217, 10287, 10830; 25+ `<script src>` tags at 10117–10216. App data (`PJ_DATA`, the permanent-jewelry price table) is inlined at ~8197.
**Why:** the file mixes markup for 12 tabs, five stylesheets, inline data, and bootstrap logic. Diffs are unreviewable, and the CLAUDE.md rule "never touch another tab's code" exists because the structure makes cross-tab breakage easy.
**Refactor (incremental, no framework):** extract each inline block one PR at a time.
```html
<link rel="stylesheet" href="css/kanban.css">
<script src="js/pj-data.js"></script>   <!-- PJ_DATA moves here -->
```
Endpoint: HTML is markup only; all CSS in `css/`, all data/JS in `js/`.

### 1.3 Copy-pasted boilerplate across ~30 Pages Functions
**Location:** `functions/api/*.js` — the `CORS` constant, `json()` helper, and `notionHdrs()` are duplicated nearly verbatim (`notion-orders.js:11-30`, `notion-customers.js`, `notion-notes.js`, `restock-*.js`, `prod-settings.js`, …), and several already differ in which HTTP methods they allow.
**Why:** a single policy change (fix CORS, add auth — §2.1) means editing 30 files that will drift.
**Refactor:** Cloudflare Pages supports shared middleware — one file fixes CORS/auth/errors everywhere:
```js
// functions/_middleware.js
export async function onRequest(context) {
  const origin  = context.request.headers.get('Origin') || '';
  const allowed = ['https://sts-deploy.pages.dev'];
  const cors = {
    'Access-Control-Allow-Origin':  allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-STS-Key',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const res = await context.next();
  Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}
```
Add a `functions/api/_lib.js` holding `json()`, `notionHdrs()`, pagination, and the shared-key auth check (§2.1) so it lives in one place.

### 1.4 Three divergent HTML-escape helpers; most modules have none
**Location:** `js/calendar.js:363`, `js/designs.js:523`, `scan.html:627` each define their own `escHtml`; `js/gmail.js` uses a private `_esc`; `js/orders.js`, `js/customers.js`, `js/production.js`, `js/inventory.js` interpolate raw.
**Why:** inconsistent escaping is the direct cause of the XSS findings in §2.2 — when escaping is a per-module afterthought, the default path is unsafe.
**Refactor:** one global helper in `app.js` (loaded first), used everywhere:
```js
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
```
Delete the three local copies and alias during migration (`const escHtml = esc;`).

### 1.5 Global mutable state + load-order-coupled classic scripts
**Location:** `js/data.js:115-118` (`const ORDERS = []`, `const CUSTOMERS = []` mutated by every module); `js/app.js:260-298` (`window._sotDone`, `window._ohDone`, `window._invRingLoaded` hand-rolled lazy-init flags); manual per-file cache-busting (`?v=20260710a`, `?v=37`, `?v=2` at `jewelry-workflow.html:10117-10216`).
**Why:** every module reads/writes the same globals with no way to know who changed `ORDERS` or when; the manual `?v=` scheme is routinely forgotten (hence the "hard-refresh after deploy" ritual in CLAUDE.md).
**Refactor:** migrate to ES modules (`<script type="module">`) for real imports, single execution, and deferred loading. Interim step without a build — centralize state behind explicit mutators:
```js
// store.js
const store = {
  orders: [],
  listeners: new Set(),
  setOrders(next) { this.orders = next; this.listeners.forEach(fn => fn()); },
};
```

### 1.6 Retired/experimental code and one-off scripts ship to production
**Location:** repo root — `crm.html` + `crm/` (dropped experiment), `clickup.js` (retired), `med_batch*.json`, `med_item_0..4.json`, `gen_med_batch.py`, `import-archive.ps1`, `restore-names.ps1`, `fix-pdf-urls.ps1`, `deploy.bat`/`1-preview.bat`.
**Why:** Cloudflare Pages publishes the repo root, so every one of these is downloadable from the live site; they also confuse code search and inflate the deploy.
**Refactor:** move the app into a `public/` directory set as the Pages build output; move scripts to `tools/` and retired code to `archive/` (git history preserves anything deleted).

### 1.7 Prefix-as-namespace naming
**Location:** throughout `js/` — `gt*` (gmail), `tl*` (triplog), `sot*` (supplier order tracker), `dsn*` (designs), `inv*`/`invMgr*`, alongside bare globals (`renderKanban`, `toast`, `initials`). `js/orders.js` is 84 KB and `js/restock.js` is 116 KB — single files doing the work of 5–10 modules each.
**Why:** prefixes substitute for real modules; collisions are avoided only by memory.
**Refactor:** falls out of the ES-module migration in §1.5 — imports make prefixes unnecessary.

---

## 2. Security & Vulnerabilities

### 2.1 CRITICAL — Unauthenticated API proxies over privileged tokens
**Location:** every file in `functions/api/` except `square-webhook.js` and the Etsy OAuth pair. Representative — `functions/api/notion-orders.js`: CORS `*` at 11-15; GET returns the entire orders DB at 85-103; POST creates/patches arbitrary pages at 105-134; DELETE archives any page by ID at 136-148. Same shape in `notion-customers.js`, `notion-pipeline.js`, `notion-notes.js`, `notion-write.js`, `restock-*.js`, `shopify-orders.js`, `shipstation.js`, `stuller.js`, `square.js`, `usps-tracking.js`.
**Why:** these functions hide `NOTION_TOKEN`, `SQUARE_TOKEN`, and others from the browser, but re-expose those tokens' *capabilities* to the whole internet with no auth and permissive CORS. Today, anyone who knows the URL can:
- `GET /api/notion-orders` → full dump of customer names, emails, order details;
- `POST /api/notion-orders` with a `notionPageId` → overwrite any reachable page;
- `DELETE /api/notion-orders?pageId=…` → archive records;
- `GET /api/shopify-orders`, `/api/shipstation` → customer PII from those platforms;
- `POST /api/claude-proxy` → open relay to the Anthropic API.

**Refactor:** require a shared secret on every endpoint (ideally once, via the middleware in §1.3):
```js
if (context.request.headers.get('x-sts-key') !== context.env.APP_SHARED_KEY)
  return json({ error: 'unauthorized' }, 401);
```
Store `APP_SHARED_KEY` in Cloudflare env; send it from the client. This stops drive-by/scripted abuse immediately. The proper long-term fix is Cloudflare Access in front of the app and `/api/*`. `square-webhook.js:26` already demonstrates the right verification pattern — the other endpoints just don't use anything like it.

> **Caveat:** if these endpoints are *already* behind Cloudflare Access, this drops from Critical to Low. Confirm that first — it changes the whole priority order.

### 2.2 CRITICAL — Stored XSS via unescaped names
**Location:** `js/orders.js:193` interpolates `${o.name}` and `${o.id}` directly into `innerHTML`; `js/customers.js:244` does the same with `${c.name}`; `js/orders.js:1529` builds a title from `${order.name}`.
**Why:** `o.name` originates from customer-supplied intake data. A name like `<img src=x onerror="fetch('/api/notion-orders',{method:'DELETE'…})">` executes on render, and — combined with §2.1 and §2.3 — can exfiltrate the Square/Anthropic tokens from `localStorage`. `o.id` interpolated into inline `onclick` handlers has the same problem for values containing quotes.
**Refactor:** escape at every interpolation and prefer data attributes + delegated listeners over inline handlers:
```js
<div class="o-name">${esc(o.name)}</div>
<div class="o-card" data-order-id="${esc(o.id)}">…</div>
```

### 2.3 `Access-Control-Allow-Origin: *` on every proxy
**Location:** `claude-proxy.js:9`, `notion-orders.js:12`, `square.js`, and all siblings.
**Why:** authorizes any origin to call the endpoints from a visitor's browser. Given §2.1 (no auth), this makes each proxy an open relay.
**Refactor:** reflect only `https://sts-deploy.pages.dev` (plus localhost for dev), never `*` (handled centrally by the §1.3 middleware).

### 2.4 Secrets in `localStorage`; Anthropic key proxied in request body
**Location:** Square token and Anthropic key stored via `js/drive.js:502-503` and `js/designs.js:449`; the Anthropic key is POSTed in the JSON body to `claude-proxy.js:21`.
**Why:** `localStorage` is readable by any XSS (§2.2 supplies one), so a single injected script exfiltrates the Square token — high value, since it can read sales/customer data. Defensible for a single-user PWA *only if* §2.2 is fixed. Prefer moving the Square token fully server-side (env var, as `SQUARE_TOKEN` already is for the webhook) so the client never holds it.

### 2.5 No input validation on write endpoints; unverified Twilio webhook
**Location:** `notion-orders.js` `onRequestPost` maps `await request.json()` into Notion props with only ad-hoc `.slice(0,2000)` guards; `sms-note.js` acts on inbound Twilio POST bodies with no signature verification.
**Why:** unvalidated writes let a caller set arbitrary fields/sizes; an unverified Twilio endpoint lets anyone forge "SMS" notes into Notion.
**Refactor:** whitelist/validate fields server-side; verify the Twilio signature the same way `square-webhook.js` verifies Square's HMAC.

### 2.6 Public OAuth client ID — verify, not vulnerable
**Location:** `js/gmail.js:7` hardcodes the Google client ID.
**Why:** client IDs are public by design, so this is acceptable — but confirm the OAuth consent screen restricts authorized origins/redirect URIs to your domain so the ID can't be reused elsewhere.

---

## 3. Performance & Scalability

### 3.1 Full board re-render on every mutation
**Location:** `renderKanban()` (`js/orders.js:8`) does `board.innerHTML = ''` and rebuilds every column; called from 9+ sites (`orders.js:879, 901, 922, 1019, 1437, 1458, 1503, 1569, 1599`).
**Why:** every stage move/edit/filter rebuilds the DOM for all orders, discarding scroll and focus and re-parsing large HTML strings. Fine at 20 orders, janky at 200.
**Refactor:** render only the affected card, and build DOM off-screen before swapping:
```js
function updateOrderCard(order) {
  const el = document.getElementById(`card-${order.id}`);
  const next = renderCardElement(order);   // returns a node, not a string
  if (el) el.replaceWith(next); else appendToColumn(order.stage, next);
}
```
For batches, append into a `DocumentFragment` once (single reflow).

### 3.2 Repeated `ORDERS.filter(...)` scans
**Location:** ~60 `ORDERS.filter/find/forEach/map` call sites; `renderKanban` filters the full array once per column group.
**Why:** O(columns × orders) each render.
**Refactor:** bucket once — `const byStage = Object.groupBy(ORDERS, o => o.stage)` — then read `byStage[stageId]` per column.

### 3.3 Synchronous full serialization on every save
**Location:** `js/app.js:380` — `localStorage.setItem('sts-orders', JSON.stringify(ORDERS))` on each save.
**Why:** serializes the entire order set on the main thread on every mutation; `localStorage` also has a ~5 MB cap you'll hit with photo/signature data.
**Refactor:** debounce writes; migrate the orders cache to IndexedDB (async, structured, no size cliff).

### 3.4 Full Notion pull on every startup
**Location:** `notion-orders.js:92-101` — sequential `do/while` over `page_size:100` on every app open.
**Refactor:** render cache-first from local storage, then reconcile in the background; use an incremental sync filtered by `last_edited_time` instead of a full re-pull.

### 3.5 276 KB Tailwind runtime shipped to the client
**Location:** `tailwind.js` (the full CDN JIT runtime, not a compiled build).
**Refactor:** run the Tailwind CLI once to emit a purged (~10 KB) stylesheet, or replace with the handful of utility classes actually used. Don't ship the JIT runtime.

---

## 4. Architecture & Upgrades

### 4.1 A tiny state + render layer, not a framework
The pain in §1.2/§3.1 is manual DOM mutation with no single source of truth. You don't need React — a ~50-line reactive store plus targeted renders (or a ~2 KB signals library like `@preact/signals-core`) gets most of the benefit while staying vanilla. Formalize the data flow with explicit mutators (§1.5).

### 4.2 Consolidate the Notion proxies
The 30+ `notion-*.js` files repeat CORS, headers, `json()`, and token guards. A shared `functions/_middleware.js` + `functions/api/_lib.js` (§1.3) makes each route ~15 lines and — critically — puts the §2.1 auth check in exactly one place instead of zero.

### 4.3 A minimal, optional build step
Respect the "no build step" choice for app logic, but two things warrant tooling: a Tailwind purge (§3.5) and concatenation/minification of the 24 separate `js/*` requests. A single `esbuild` command (no config) does both and content-hashes filenames, retiring the manual `?v=` cache-busting scheme. Wire it into the Cloudflare Pages build command to preserve "just push to main."

### 4.4 Extract pure functions and add lightweight tests
Global `ORDERS`, hardcoded `TODAY`, and DOM-coupled renders make everything untestable. Extract pure logic — `deadlineInfo`, `initials`, `catSum` (`notion-orders.js:32`), estimate math (`orders.js:858-888`), `autoDetect` (`sms-note.js`) — into DOM-free modules and add `node --test` (zero deps). Start with the money math, where a silent bug costs real dollars.

### 4.5 The service worker is a no-op but the PWA claims offline
`sw.js` only unregisters and clears caches — a fine deliberate kill switch, but it means the installed PWA has no offline fallback despite the manifest. Decide: implement a real cache-first SW (stale-while-revalidate for `js/*`, network-first for the `no-store` HTML), or drop the offline pretense.

---

## Priority order

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 2.1 | Unauthenticated proxies read/write Notion & Square | Critical | Low (shared-key check via §1.3 middleware) |
| 2.2 | Stored XSS via unescaped `${o.name}` / `${c.name}` | Critical | Low–Med |
| 2.3 | `Allow-Origin: *` on all proxies | High | Low |
| 2.4 / 2.5 | Secrets in localStorage; no validation; Twilio unverified | High | Med |
| 3.1 / 3.2 | Full re-render + repeated scans | Med | Med |
| 1.2 / 1.6 | Monolith HTML + code that ships publicly | Med | Med |
| 4.2 / 4.4 | Proxy consolidation + testable pure functions | Improvement | Med |
| 1.1 | Frozen `TODAY` corrupts deadline badges | Med | Trivial |

**First move:** confirm whether `/api/*` is already behind Cloudflare Access. If not, that one change (plus the shared-key check) neutralizes §2.1 and §2.3 at once and is the highest-leverage hour available.
