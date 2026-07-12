# STS Workflow — CLAUDE.md

## Project Overview
STS Workflow is a CRM-like web app for managing day-to-day business tasks at Stones Throw Studio (jewelry business). It is a single-page PWA built with vanilla HTML/CSS/JS — no framework.

## Project Location
- Local: `C:\Users\morph\Desktop\STS Workspace\sts-deploy\`
- **Active app:** `jewelry-workflow.html` — the main Kanban workflow app in daily use
- `clickup.js` is **retired** — replaced by `notion.js`. Do not edit or restore it.
- **Dropped experiment:** `crm.html` + `crm/` folder — started but not in active use
- Related MCP servers (separate folders, not part of deploy): `triplog-mcp-http` (active), `triplog-mcp` (superseded), `triplog-proxy`
- `square-sync-trigger` (separate folder, not part of deploy): standalone Cloudflare Worker, Cron Trigger only, pings `/api/square-sync` on `sts-deploy.pages.dev` every 15 min. No secrets of its own. See [docs/adr/0002](docs/adr/0002-square-sync-via-scheduled-worker.md).

## Tech Stack
- Vanilla HTML, CSS, JavaScript (no framework, no build step)
- PWA (manifest + service worker sw.js)
- Cloudflare Pages hosting, with server-side API in `functions/api/` (Cloudflare Pages Functions)

## JS Modules (`js/` folder)
All modules run in one global scope (plain `<script>` tags, no bundler). Load order matters for the files that note it.

**Core / shell**
- `app.js` — app shell, sidebar + tab switching (`sbNav`, `switchParent`, `switchTab`, `switchSubTab`)
- `api-auth.js` — fetch shim, must load FIRST; injects the shared `X-STS-Key` header into every same-origin `/api/*` request (key stored in localStorage `sts-api-key`, entered under ⚙ Integrations)
- `data.js` — shared data helpers

**Orders**
- `orders.js` — Custom Orders kanban + Edit Order modal
- `order-normalize.js` — unified order schema across all sources (manual intake, Shopify, Etsy); pure functions, loaded before orders.js
- `order-widgets.js` — order-form logic shared by jewelry-workflow.html AND intake.html; loaded before orders.js / intake.js
- `customers.js` — customers sub-tab
- `shopify.js` / `etsy.js` — manual import of Shopify orders / Etsy receipts into the intake-website kanban stage
- `sketchpad.js` — design sketch + handwriting-strip canvases on the order form (handwriting → typed fields via Claude vision)
- `stuller.js` — Stuller catalog SKU lookup / category browse for the Estimate Builder
- `shipstation.js` / `usps.js` — client side of tracking lookups (server calls live in `functions/api/`; keys never touch the browser)

**Costing / inventory / replenishment build** (see section below)
- `materials.js`, `receiving.js`, `designs.js`, `closeout.js`, `replenish.js`

**Inventory & production**
- `inventory.js` — Square-backed inventory counts
- `inv-manager.js` — drag-and-drop modal for pulling Square catalog items into inventory sub-tabs
- `restock.js` — Restock Queue (priority queue, assignees, inline timers, Square auto-match)
- `restock-sessions.js` — Session Log + Production Report (extracted from restock.js; loaded after it)
- `production.js` — Ready to Pick Up/Ship sub-tab
- `bgab.js` — Blue Genie (BGAB) event inventory, independent of Square counts

**Other tabs**
- `sales.js`, `gmail.js`, `notes.js`, `calendar.js`, `triplog.js`, `supplier-history.js`, `drive.js`, `notion.js`
- `intake.js`, `intake-profiles.js`, `intake-sheet.js` — loaded ONLY by `intake.html` (standalone iPad intake PWA), not by the main app

## Costing / Inventory / Replenishment Build
Built in six phases (PRs #17–#26). The material flow: buy → receive → assign to designs → cost/price → consume on production → reorder.
1. **Materials Library** (`js/materials.js` + `functions/api/materials.js`) — raw-material catalog, source of truth in Notion; tracks unit cost and purchase-price history (sparklines from Order History line items)
2. **Receive Shipment** (`js/receiving.js`) — one form per shipment: creates a supplier Order History record with `{materialId, qty, unitCost}` line items and applies stock/cost to the Materials Library
3. **Design BOMs** (`js/designs.js`) — each design carries a material recipe `[{materialId, qty}]` with a hybrid waste model (default waste % + per-metal overrides from `/api/shop-settings`)
4. **Cost rollup & pricing sheet** (`js/designs.js`) — material cost + labor (from work sessions) rolled up per design, with optional Square item link for retail comparison
5. **Batch close-out** (`js/closeout.js`) — post-timer "Add restocked pieces" prompt gains a "Materials used" section: consumption computed from each finished item's BOM (editable), decremented from the Materials Library
6. **Replenishment engine** (`js/replenish.js`) — what's low, what's buildable from material on hand (min over BOM lines of stock ÷ per-piece qty), what to order first; on-hand counts come live from Square on page open

## Tab Structure (jewelry-workflow.html — active app)
Primary navigation is a **sidebar** (`.sidebar`, `sb-item` → `sbNav()`/`sbNavDirect()`); the classic top nav (`nav-tab` → `sub-nav-tab`) still exists and maps to the same tabs:
- **Orders** (parent `custom-orders`) → Custom Orders (dashboard/kanban), Ready to Pick Up/Ship (`production`), Customers, Print Bag. "✚ New Order" opens `intake.html` in a new tab.
- **Inventory** (parent) → To Restock, Adjust Inventory (`inv-adjust`), Production Report (`prod-report`), Replenishment
- **Supplies** (parent) → Order Materials (`supplier`), Order History, Materials Library
- **Trips** (`triplog`), **Gmail**, **Notes**, **Designs** (standalone tabs)
- **More** (parent) → Sales, Calendar, PJ Calc, PJ Ref (permanent-jewelry calculator/reference)

Tab switching logic lives in `js/app.js`: `switchParent()`, `switchTab()`, `switchSubTab()`.

## Standalone Pages (same deploy, own URLs)
- `intake.html` — iPad order-intake PWA; creates orders only (editing stays in the main app). Saves to localStorage first, then pushes to Notion via `/api/notion-pipeline`
- `time-tracker.html` — STS Work Timer
- `scan.html` — scan a work-order bag
- `phone.html` — phone companion
- `print-orders.html` / `work-order-print.html` — work-order bag printing
- `sts-kanban.html` — read-only orders kanban
- `rg-cart-bookmarklet.html`, `calendar-oauth.html` — utilities

## Server API (`functions/api/`)
Cloudflare Pages Functions. `_middleware.js` gates every `/api/*` request on the shared `X-STS-Key` header (injected client-side by `js/api-auth.js`). All third-party keys (Notion, Square, Shopify, Etsy, ShipStation, USPS, Stuller, Twilio, Claude) live server-side here — never in the browser.

## Key Rule
**NEVER alter any tab's code while working on a different tab. Only touch the tab explicitly being worked on.**

## Deployment
- Platform: Cloudflare Pages (NOT Netlify — account hit its limit)
- Live URL: https://sts-deploy.pages.dev/jewelry-workflow
- GitHub repo: https://github.com/stonesthrows/sts-deploy
- Deploy: git push to main branch — Cloudflare auto-deploys from GitHub (no more 2-deploy.bat)
- After deploying, hard refresh (Ctrl+Shift+R) to clear service worker cache
- Must touch `jewelry-workflow.html` (not just `sw.js`) for Cloudflare to detect and push the update

## Integrations
- Google Drive folder for order bag scans: "STS Order Bag Visual Reads"
- Notion database ID: edee1ecc-7d11-428a-9efc-d17b8cbf195d
- Gmail: kyle@stonesthrowjewelry.com
