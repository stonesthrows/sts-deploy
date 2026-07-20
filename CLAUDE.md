# STS Workflow — CLAUDE.md

## Project Overview
STS Workflow is a CRM-like web app for managing day-to-day business tasks at Stones Throw Studio (jewelry business). It is a single-page PWA built with vanilla HTML/CSS/JS — no framework.

## Project Location
- Local: `C:\Users\morph\Desktop\STS Workspace\sts-deploy\`
- **Active app:** `jewelry-workflow.html` — the main Kanban workflow app in daily use (markup only — all CSS lives in `css/`, all JS in `js/`)
- JS modules: `js/` folder (app.js, orders.js, customers.js, sales.js, production.js, gmail.js, notes.js, drive.js, notion.js, data.js, supplier-history.js, triplog.js, inventory.js, home.js, ui-shell.js, pj-calc.js, …)
- CSS: `css/` folder — app.css (core/shared), plus per-tab files (inventory.css, perm-jewelry.css, triplog.css, print-setup.css, prod-report.css, restock-queue.css). Linked from the HTML at the same document positions the old inline `<style>` blocks occupied — keep that order (cascade depends on it)
- When editing a `js/` or `css/` file, bump its `?v=` cache-buster on the `<script>`/`<link>` tag in `jewelry-workflow.html` (this also satisfies the deploy-detection rule below)
- `clickup.js` is **retired** — replaced by `notion.js`. Do not edit or restore it.
- **Deleted experiments** (removed 2026-07, recover from git history if ever needed): `crm.html` + `crm/`, `sts-kanban.html`, `med_batch*/med_item*` import artifacts
- Related MCP servers (separate folders, not part of deploy): `triplog-mcp-http` (active), `triplog-mcp` (superseded), `triplog-proxy`
- `square-sync-trigger` (separate folder, not part of deploy): standalone Cloudflare Worker, Cron Trigger only, pings `/api/square-sync` on `sts-deploy.pages.dev` every 15 min. No secrets of its own. See [docs/adr/0002](docs/adr/0002-square-sync-via-scheduled-worker.md).
- **`tests/` folder** (dev-only, not part of the deploy): headless-Chromium smoke suite. Run `cd tests && node run.js` before pushing a change that touches shared infrastructure (`js/app.js`, `js/storage.js`, `js/notion.js`, `sw.js`, or the CSS/JS extraction structure of `jewelry-workflow.html`) — see [tests/README.md](tests/README.md). One-time setup: `cd tests && npm install`.

## Tech Stack
- Vanilla HTML, CSS, JavaScript (no framework, no build step)
- PWA (manifest + service worker sw.js — network-first, offline shell fallback; never caches /api/*)
- Orders + hidden set persist in IndexedDB via `js/storage.js` (`stsStoreGet`/`stsStoreSet`), NOT localStorage — localStorage's ~5MB quota chokes on base64 photos/sketches. `saveToStorage()` stays synchronous (debounced async write behind it); call it as before
- Notion writes that fail offline are queued in IndexedDB (`notion-retry`) and replayed automatically on reconnect (see js/notion.js)
- Cloudflare Pages hosting

## Tab Structure (jewelry-workflow.html — active app)
Main nav tabs (`nav-tab`) → some have sub-nav tabs (`sub-nav-tab`):
- **Custom Orders** (parent) → Dashboard, New Order, Customers
- **Gmail** (standalone)
- **Production** (standalone)
- **Sales** (standalone)
- **Notes** (standalone)
- **Supplies** (parent) → Supplier Order, Order History
- **Inventory** (parent) → Earrings, Rings, Pendants
- **Triplog** (standalone)
- **Perm. Jewelry** (parent) → Calculator, Reference
- **Calendar** (standalone)
- **Timer** (standalone) — STS Work Timer, loaded in iframe from `time-tracker.html`

Tab switching logic lives in `js/app.js`: `switchParent()`, `switchTab()`, `switchSubTab()`.

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
- ClickUp list for new orders: "Custom Orders"
- Notion database ID: edee1ecc-7d11-428a-9efc-d17b8cbf195d
- Gmail: kyle@stonesthrowjewelry.com
