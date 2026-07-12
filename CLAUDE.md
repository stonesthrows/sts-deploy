# STS Workflow — CLAUDE.md

## Project Overview
STS Workflow is a CRM-like web app for managing day-to-day business at Stones Throw Studio (jewelry business): a Kanban order pipeline, production timers, inventory/costing, and supplier tracking. Single-page PWA built with vanilla HTML/CSS/JS — no framework, no build step — plus a serverless API layer (Cloudflare Pages Functions) that proxies Notion, Square, and other services.

Two sources of truth, glued together by this app:
- **Notion** — all structured business data: pipeline orders, customers, notes, work sessions, materials, supplier receipts. See `CONTEXT.md` for the full domain glossary.
- **Square** — retail reality: sales, catalog, inventory counts, labor shifts.

## Entry Points (HTML files that matter)
- **`jewelry-workflow.html`** — the main app, in daily use. ~10,900 lines; all tab markup, styles, and bootstrap inline. Everything below refers to this unless stated.
- **`intake.html`** — standalone iPad order-intake PWA (own manifest `manifest-intake.json` + intake-icons). Feeds the pipeline.
- **`time-tracker.html`** — standalone STS Work Timer (employee clock-in/production sessions → Notion).
- **`work-order-print.html`** — print-layout page, loaded in an iframe by the Print Order Bag tab.
- **`scan.html`** — work-order bag scanning page.
- **`phone.html`** — phone wrapper that embeds the main app pinned to the Restock Queue tab.
- **`index.html`** — just a redirect to `jewelry-workflow.html`.
- Dormant/experiments, do not edit: `crm.html` + `crm/`, `sts-kanban.html` (unreferenced), `js/bgab.js` (Blue Genie tab was removed from the nav; module no longer loaded). `clickup.js` was retired and deleted.

## Tab Map → Owning JS Modules (jewelry-workflow.html)
Main nav (`switchParent`) → sub-tabs (`switchSubTab`). Tab init hooks live in `TAB_HOOKS` in `js/app.js`.

| Parent | Sub-tab | Module(s) |
|---|---|---|
| ✏️ Orders | Custom Orders (Kanban) | `orders.js`, `order-widgets.js`, `order-normalize.js` |
| | Ready to Pick Up/Ship | `production.js` |
| | Customers | `customers.js` |
| | Print Order Bag | iframe → `work-order-print.html` |
| 💎 Inventory | To Restock (queue + timers) | `restock.js`, `restock-sessions.js`, `closeout.js` |
| | Adjust Inventory | `inventory.js`, `inv-manager.js` |
| | Production Report | `restock-sessions.js` |
| | Replenishment | `replenish.js` |
| 📦 Supplies | Order Materials | `supplier-history.js` |
| | Order History | `supplier-history.js`, `receiving.js` (Receive Shipment) |
| | Materials Library | `materials.js` |
| 🚗 Trips | — | `triplog.js` |
| 📧 Gmail | — | `gmail.js` |
| 📝 Notes | — | `notes.js` |
| 🎨 Designs | — | `designs.js` (specs, BOMs, cost rollup, pricing sheet) |
| 📊 More | Sales / Calendar / Perm. Jewelry | `sales.js` / `calendar.js` / inline PJ code+data in the HTML |

Shared/cross-cutting modules: `app.js` (helpers, tab switching, storage, bootstrap), `data.js` (STAGES, global ORDERS/CUSTOMERS state, TODAY), `costing-core.js` (pure money math — see Tests), `api-auth.js` (injects `X-STS-Key` into every `/api/*` fetch; must load first), `notion.js` (Notion sync client), `drive.js` (Drive bag scans), `sketchpad.js` (order sketches), `shopify.js`/`etsy.js`/`stuller.js`/`shipstation.js`/`usps.js` (channel integrations), `intake.js`/`intake-profiles.js`/`intake-sheet.js` (intake PWA).

## Key Rules
- **NEVER alter another tab's code while working on a different tab.** The monolith makes cross-tab breakage easy; the map above tells you which files a tab owns.
- Money math (costing, waste, replenishment, receiving) lives in `js/costing-core.js` as pure functions with tests. Change the math there, keep the tests passing, and keep the tab modules as thin delegates.
- Escape all user/customer-origin strings with `esc()` (in `app.js`) before interpolating into `innerHTML`.

## Backend — functions/api/ (Cloudflare Pages Functions)
~37 endpoints, mostly thin proxies holding privileged tokens (`NOTION_TOKEN`, `SQUARE_TOKEN`, …) server-side. Each file's header comment lists its required env vars. KV bindings: `STS_DESIGNS` (designs), `STS_TIMER` (timer state), plus Etsy OAuth storage.

- **`_middleware.js`** — runs on every `/api/*` request: answers CORS preflight, tightens `Access-Control-Allow-Origin` to our own origins, and enforces the shared-key auth gate (`X-STS-Key` vs `APP_SHARED_KEY` env var; fails open until that var is set in the Cloudflare dashboard). Webhooks/OAuth/cron endpoints are on its PUBLIC exempt list — they carry their own verification.
- **`_lib.js`** — shared helpers (`json()`, `notionHdrs()`, `CORS`, `NOTION_API/VER`, `isNotionId()`). Endpoints import from it; don't re-declare these per file. CORS policy changes go in `_middleware.js`, not `_lib.js`.
- Webhooks verify their own signatures (`square-webhook.js` HMAC, `sms-note.js` Twilio).

## Tests
`node --test` from the repo root (zero dependencies, Node 18+). Covers the pure money math in `js/costing-core.js` (waste chain, cost rollup, close-out decrements, replenishment queue, receiving math). Run it before pushing anything that touches money.

## Deployment
- Cloudflare Pages (NOT Netlify — account hit its limit). Live: https://sts-deploy.pages.dev/jewelry-workflow
- GitHub repo: https://github.com/stonesthrows/sts-deploy — push to `main` and Cloudflare auto-deploys.
- Must touch `jewelry-workflow.html` (not just a JS file) for Cloudflare to detect and push the update, and bump the file's `?v=` cache-buster in its `<script src>` tag whenever you change a `js/` file.
- After deploying, hard refresh (Ctrl+Shift+R). `sw.js` is deliberately a kill-switch (unregisters + clears caches); the PWA has no offline cache.

## Related (separate folders / repos, not part of this deploy)
- `square-sync-trigger` — Cloudflare Worker cron, pings `/api/square-sync` every 15 min (ADR 0002).
- `triplog-mcp-http` (active), `triplog-mcp` (superseded), `triplog-proxy` — TripLog access for the Trips tab and Claude.

## Integrations
- Notion pipeline database ID: `edee1ecc-7d11-428a-9efc-d17b8cbf195d` (other DB IDs are constants in their `functions/api/*` file).
- Google Drive folder for order bag scans: "STS Order Bag Visual Reads".
- Gmail: kyle@stonesthrowjewelry.com.

## Further Docs
- `CONTEXT.md` — domain glossary (read this before touching pipeline/production/BGAB/trips logic).
- `docs/code-audit-2026-07-11.md` — full code audit; the priority table tracks what's still open.
- `docs/adr/` — architecture decision records.
