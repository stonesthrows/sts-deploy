# STS Workflow — CLAUDE.md

## Project Overview
STS Workflow is a CRM-like web app for managing day-to-day business tasks at Stones Throw Studio (jewelry business). It is a single-page PWA built with vanilla HTML/CSS/JS — no framework.

## Project Location
- Local: `C:\Users\morph\Desktop\STS Workspace\sts-deploy\`
- **Active app:** `jewelry-workflow.html` — the main Kanban workflow app in daily use
- JS modules: `js/` folder (app.js, orders.js, customers.js, sales.js, production.js, gmail.js, notes.js, drive.js, notion.js, data.js, supplier-history.js, triplog.js, inventory.js)
- `clickup.js` is **retired** — replaced by `notion.js`. Do not edit or restore it.
- **Dropped experiment:** `crm.html` + `crm/` folder — started but not in active use
- Related MCP servers (separate folders, not part of deploy): `triplog-mcp-http` (active), `triplog-mcp` (superseded), `triplog-proxy`

## Tech Stack
- Vanilla HTML, CSS, JavaScript (no framework, no build step)
- PWA (manifest + service worker sw.js)
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
