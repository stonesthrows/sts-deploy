# STS Workflow — Domain Glossary

## App

**Workflow App** (`jewelry-workflow.html`)
The active web application for Stones Throw Studio business management. Vanilla HTML/CSS/JS PWA hosted on Cloudflare Pages. All new development happens here. Features a Kanban-style order pipeline synced bidirectionally with Notion.

**CRM** (`crm.html`)
A partial rebuild that was started but dropped. Not in active use — do not edit.

---

## Orders

**Estimate**
A quote request that lives in the pipeline. Moves through: Estimate Intake → Estimating → Estimate Sent → Estimate Approved → Deposit column. The moment a card enters the Deposit column signals that the estimate has been converted to an invoice and the customer has committed.

**Invoice**
The conversion event that moves an Estimate into the Deposit stage. Not a separate record — it is the act of moving the card into the Deposit column.

**Deposit**
The pipeline stage that confirms customer commitment. Has two sub-stages: Waiting on Deposit → Deposit Paid. Once Deposit Paid, the order proceeds to Materials → Build.

**Order**
A piece of work tracked in the pipeline. Has a type: Custom, Estimate, or Repair. All three share the same data shape and pipeline stages.

**Custom Order**
An Order for a piece made from scratch to customer specification.

**Repair**
An Order for work on an existing piece. Enters the pipeline directly (no Estimate phase) and is treated the same as a Custom Order throughout.

**Pipeline**
The set of workflow stages an Order moves through from intake to completion. **Notion is the source of truth for stage.** The Workflow App syncs bidirectionally with Notion. ClickUp is retired — never actively used, never properly configured.

**Notion**
Single source of truth for all structured business data: Pipeline Orders, Customer records, Notes, and Supplier Receipts. Database ID: `edee1ecc-7d11-428a-9efc-d17b8cbf195d`.

---

## Revenue

**Market Sale**
A transaction processed through Square at a farmers market weekend. Captured as a daily total (Saturday + Sunday) per weekend. Source of truth is Square — synced into the app via the Square API.

**Custom Order Revenue**
Payment for a completed Custom Order or Repair that originated in the pipeline. Tracked separately from Market Sales. Visible in the Sales Overview page, not the Kanban. Captured via `finalPrice` (confirmed at completion) and `completedAt` (ISO timestamp set when marked complete). Orders completed before this was introduced have neither field and fall back to `price` and `deadline` for display.

**Weekend**
A Sat–Sun market event identified by its Saturday date key (e.g. `2026-05-30`). The unit of aggregation for Market Sales data.

## Inventory

*(terms to be defined as the session progresses)*

---

## Trips

**TripLog**
The external mileage-tracking app and source of truth for all recorded drives. Accessed via `https://app.triplog.net/web/api`. Read and write both supported via their REST API (requires API key from admin dashboard).

**Trip**
A single recorded drive from TripLog. Has fields: `id`, `startTime`, `mileage`, `startOdometer`, `endOdometer`, `activity` (Business or Personal), `notes`, `fromLocation`, `toLocation`.

**Local Edit**
A browser-side override for a Trip's fields, stored in `localStorage` under `sts-triplog-edits`. Exists only while a Trip has an unsynced or failed write back to TripLog. Cleared on successful sync. Displayed with a `✎` dot (or `⚠` if the sync failed).

**TripLog Proxy** (`triplog-proxy`)
A Cloudflare Worker at `triplog-proxy.kyle-3c9.workers.dev` that sits between the Workflow App and TripLog's API to resolve CORS. Holds the API key as a Worker env var. Allowed origin: `https://sts-deploy.pages.dev`. Supports GET (list/fetch trips) and PUT (update trip fields).

**TripLog MCP Server** (`triplog-mcp`)
A local MCP server (stdio transport) that gives Claude direct access to TripLog. Tools: `get_recent_trips`, `get_trip_details`, `update_trip`. Used for Claude-initiated queries and edits.

**Odometer Log**
A manually maintained log of physical odometer readings, stored locally in `localStorage` under `sts-odometer-log`. Used as the authoritative source for actual miles driven, to reconcile against GPS-recorded TripLog mileage.

**Mileage Reconciliation**
The process of correcting GPS drift between TripLog's recorded trip mileage and actual odometer movement. Triggered automatically when a new odometer reading is saved. Computes: actual miles = current reading − previous reading; recorded miles = sum of TripLog trip mileage for the same period; gap = actual − recorded. The gap is distributed proportionally across all trips in the period. A confirmation panel shows original vs proposed mileage per trip before syncing. Edge cases: no previous reading → block with prompt to log it; no trips in period → prompt to check TripLog; gap = 0 → toast "✓ In sync"; gap < 0 → proportional reduction (same math as positive gap).

**Trip Verification**
A daily weekday prompt (pill in the app header) to confirm yesterday's trips were recorded correctly. Dismissal state stored in `localStorage` under `sts-trips-verified`. Resets each day.
