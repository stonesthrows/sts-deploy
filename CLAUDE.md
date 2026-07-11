# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
STS Workflow is a CRM-like web app for managing day-to-day business at Stones Throw Studio (jewelry business). Vanilla HTML/CSS/JS — no framework, no build step, no tests. Hosted on Cloudflare Pages with Pages Functions as the serverless API layer.

**Key rule: NEVER alter any tab's code while working on a different tab. Only touch the tab explicitly being worked on.**

See `CONTEXT.md` for the domain glossary (pipeline stages, Production Sessions, BGAB, TripLog, etc.) and `docs/adr/` for architecture decisions. On the owner's machine the repo lives at `C:\Users\morph\Desktop\STS Workspace\sts-deploy\`.

## Commands
- **Local preview:** `node serve.js` → http://localhost:3000 (serves `jewelry-workflow.html` at `/`). Windows shortcut: `1-preview.bat`.
- `serve.js` is static-only — the `/api/*` Pages Functions do **not** run locally. Anything hitting `/api/*` must be tested against the live deploy.
- **Deploy:** push to `main` — Cloudflare Pages auto-builds from GitHub. Hard refresh (Ctrl+Shift+R) after deploy.
- No build, lint, or test commands exist.

## Architecture

### Pages (each HTML file is a standalone app/page)
- **`jewelry-workflow.html`** — the main app, in daily use. All tabs, ~10k lines of markup/CSS plus the `js/` modules.
- **`intake.html`** — standalone order-intake app ("STS Intake", own PWA manifest `manifest-intake.json`). Opened from the main app's "New Order ↗" sub-tab. The one page styled with the vendored `tailwind.js` build.
- **`time-tracker.html`** — standalone "STS Work Timer" (employee start/stop sessions; see Production Session in CONTEXT.md).
- **`phone.html`** — mobile companion (notes + restock queue).
- **`scan.html`**, **`work-order-print.html`**, **`print-orders.html`** — work-order scanning and print templates.
- `index.html` just redirects to `jewelry-workflow.html`.

### Frontend JS (`js/`)
Plain `<script src>` tags sharing one global scope — no ES modules, no imports. Load order in `jewelry-workflow.html` matters (`data.js` → `order-normalize.js` → `notion.js` → `customers.js` → `app.js` → feature modules). Roughly one module per tab/feature (orders, customers, restock, inventory, production, sales, gmail, notes, designs, triplog, calendar, etc.), plus shared infrastructure:
- `js/app.js` — tab switching (`switchParent()` / `switchTab()` / `switchSubTab()`), toasts, theme, localStorage persistence, touch drag-and-drop, bootstrap.
- `js/data.js` — `STAGES` (the pipeline stage list) and other core data definitions.
- `js/notion.js` — Notion sync layer (replaced the retired `clickup.js`, which has been deleted; do not restore it).

**Cache-busting convention:** script tags carry `?v=` query params (e.g. `js/orders.js?v=20260710a`). When you edit a JS module, bump its `?v=` in every HTML file that includes it (`intake.html` and `phone.html` share some modules with the main app).

### Backend (`functions/api/`)
Cloudflare Pages Functions, one file per endpoint, called from the frontend as relative `/api/<name>` — this is where all secrets live (Cloudflare Pages env vars: `NOTION_TOKEN`, `SQUARE_TOKEN`, Shopify/Etsy/ShipStation/USPS/Stuller creds, plus `STS_KV`/`STS_TIMER`/`STS_DESIGNS` KV bindings). The frontend never holds integration secrets, with one exception: `claude-proxy.js` forwards the Anthropic API key from the request body (stored in client localStorage). Endpoints are thin proxies/sync jobs against Notion, Square, Shopify, Etsy, ShipStation, USPS, Stuller, and Google Vision OCR.

### Data flow
- **Notion is the source of truth** for structured business data — pipeline orders, customers, notes, supplier receipts, work sessions, BGAB events. Main database ID: `edee1ecc-7d11-428a-9efc-d17b8cbf195d`.
- Multi-value records are stored as JSON blobs in Notion rich-text properties rather than relational rows (see ADR 0001, and "Items JSON" in CONTEXT.md).
- `localStorage` is the offline/working cache (`sts-orders`, `sts-hidden`, `sts-theme`, per-feature keys) — restored on boot, synced with Notion.
- `functions/api/square-sync.js` reconciles work sessions against Square shifts; it is swept every 15 min by the external `square-sync-trigger` Worker (ADR 0002).

### Tab structure (`jewelry-workflow.html`)
Main nav (`nav-tab`) → sub-nav (`sub-nav-tab`):
- **Orders** (parent) → New Order ↗ (opens `intake.html`), Custom Orders (Kanban dashboard), Ready to Pick Up/Ship, Customers, Print Order Bag
- **Inventory** (parent) → To Restock, Adjust Inventory, Production Report
- **Supplies** (parent) → Order Materials, Order History
- **Trips**, **Gmail**, **Notes**, **Designs** (standalone)
- **More** (parent) → Sales, Calendar, Perm. Jewelry — Calc, Perm. Jewelry — Ref

## Deployment & caching
- Platform: Cloudflare Pages (NOT Netlify — that account hit its limit). Live: https://sts-deploy.pages.dev/jewelry-workflow
- `sw.js` is intentionally a **kill switch** — it unregisters and clears all caches. Do not add service-worker caching back.
- `_headers` sets `no-store` on the main HTML pages and `no-cache` on `js/*`; caching problems are solved there and via the `?v=` bumps, not in the service worker.

## Retired / auxiliary (do not edit unless asked)
- `crm.html` + `crm/` — dropped experiment, not in use.
- `sts-kanban.html` + `sts-worker-v2/` — standalone KV-backed Kanban experiment (worker routes are reference code, not deployed from here).
- `stuller-sync/SKILL.md` — Claude skill for importing Stuller order history via browser.
- One-off utilities: `gen_med_batch.py`, `med_*.json`, `*.ps1` scripts, `deploy.bat` (superseded by git push).
- Out-of-repo siblings: `square-sync-trigger` (cron Worker, no secrets — pings `/api/square-sync` every 15 min), `triplog-proxy` (CORS proxy Worker holding the TripLog key), `triplog-mcp-http` (active MCP server; `triplog-mcp` superseded).

## Integrations reference
- Gmail: kyle@stonesthrowjewelry.com; Google Drive folder for order bag scans: "STS Order Bag Visual Reads"
- Square location: `D7EZ98V48F79A` (retail inventory); BGAB inventory never touches Square
- TripLog API via `triplog-proxy.kyle-3c9.workers.dev`
