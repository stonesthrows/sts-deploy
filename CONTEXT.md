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

## Restock Queue & Production Timer

**Restock Queue**
The list of inventory items that need to be made. Lives under the "To Restock" sub-tab. Each item maps (optionally) to a Square catalog item. Items can be assigned to an employee and reordered by priority.

**Production Session**
A timed work block recorded against a single Restock Queue item. Has a start time, stop time, employee, one or more items being made, and a piece count. Saved to Notion for time-tracking records. This is the same underlying Notion record as a **Session** in the Timer tab (`time-tracker.html`) — Timer is the interface used to start/stop/edit it day-to-day; Production Report is the read-only cost/value view of the same records. Not every Session is necessarily tied to a Restock Queue item, but in practice the terms are used interchangeably in this codebase.

**Square Synced** (Notion property, STS Work Sessions database)
A checkbox marking whether a Production Session's clock in/out times have been reconciled against Square's `/labor/shifts` data. Set automatically by a scheduled Cloudflare Worker (see ADR 0002) — never requires manual syncing under normal operation. A Production Session becomes eligible for reconciliation once its stop time has passed, since Square's shift record may not exist yet at the moment the session is stopped.

**Square Sync Failed** (Production Session state)
The state a Production Session enters if no matching Square shift is found within 48 hours of its stop time. Distinct from `Square Synced = false` (still pending, still being retried) — once flagged, automatic retries stop and the session needs manual attention (e.g. the employee never clocked in/out on Square, or clocked in under a different time window). Surfaced passively in Production Report; no active notification is sent.

**Pieces Made**
The number of pieces produced during a Production Session. Tracked per catalog item (or variant). This is a production count — it records what was made, not necessarily what was added to Square Inventory. The two may differ (e.g., some pieces go to display, samples, or gifts). For parent/variant items (e.g., rings), pieces are tracked per selected variant — not as a single total for the parent. Piece counts are entered while the timer is running, not at setup time.

**Inventory Push**
An optional action taken after a Production Session is saved, initiated by the same employee on the same device. Adds the Pieces Made count to Square Inventory as a RECEIVE adjustment (relative add, not absolute set). Separate from saving the session — the employee decides whether and how many to push after reviewing the piece count. Push state (per-variant Square IDs and quantities) is persisted in localStorage keyed by Notion page ID, cleared on successful push.

**Labor Rate**
An employee's hourly pay rate, entered and edited in a settings panel at the top of the Production Report tab (stored in localStorage). Snapshotted onto a Production Session the first time it's saved (initial Stop & Save) — never re-snapshotted by later edits to that session, even if the employee's rate changes afterward or the session is edited for an unrelated reason (e.g. adding a missed item).

**Labor Cost** (Production Report context)
A Production Session's net duration × the Labor Rate snapshotted on that session. For sessions saved before Labor Rate snapshotting existed, falls back to the employee's current rate and is marked "(est.)" to distinguish it from a locked-in historical figure.

**Item Value** (Production Report context)
A Production Session's Pieces Made × the per-item Square catalog unit price, snapshotted the same way and at the same time as Labor Rate (first Stop & Save only). Same "(est.)" fallback rule applies to sessions with no snapshot. The unit price can also be corrected manually after the fact, or re-derived by re-linking the item to a different Square catalog entry — both update the snapshot, not just the live estimate.

**Items JSON** (Notion property, STS Work Sessions database)
A rich-text property holding the full serialized `items` array for a Production Session (name, Square ID, pieces, unit price, custom-item flag, estimate flag) — the per-item data model is too variable for discrete Notion columns, so it's stored as one JSON blob, following the same pattern as BGAB Event data (see ADR 0001). If this property is missing or unparseable on a given page (e.g. sessions saved before it existed), the app falls back to reconstructing a single item from the page's core `Item Name`/`Square Item ID`/`Pieces Made` properties — degraded but never broken.

**Profit Margin** (Production Report context)
Item Value − Labor Cost for a single Production Session. Computed for display only; never stored.

**Production Report**
A read-only tab showing every Production Session as a card, in the same visual layout as the Session Log, but additionally showing Labor Cost, Item Value, and Profit Margin per session. Distinct from the Session Log, which is the working interface employees use to start/stop/edit/push sessions day-to-day — the Production Report is the cost/value review surface, scoped to Kyle.

---

## Inventory

**Square Inventory**
Inventory tracked in Square for the main retail location (`D7EZ98V48F79A`). Quantities live in Square and are read/written via the Square API. Managed in the `Adjust Inventory` sub-tab under the Inventory parent tab.

**Blue Genie Art Bazaar (BGAB)**
A twice-yearly event at which STS sells jewelry in a booth setting. Occurs as two recurring types: May Market (May) and Art Bazaar (November/December). BGAB inventory is tracked entirely independently of Square — no Square reads or writes ever occur.

**BGAB Event**
A named record of inventory brought to a single BGAB occurrence. Identified by Type + Year (e.g. "May Market 2026"). Contains a list of BGAB Items. Source of truth is a dedicated Notion database, with full item data serialized as JSON on the Notion page. Displayed in the standalone "Blue Genie" tab.

**BGAB Item**
A Square catalog item selected for inclusion in a BGAB Event. Name and variations are imported from Square at event-creation time (read-only reference — no Square quantities are touched). Each variation tracks Brought and Sold quantities independently.

**Brought**
The quantity of a specific variation packed for a BGAB Event. Set before the event using a +/− stepper. Saved explicitly via a "Set" or "Save All" action.

**Sold** (BGAB context)
The quantity of a specific variation sold at a BGAB Event. Updated during or after the event using a +/− stepper. Never written to Square.

**Remaining** (BGAB context)
Brought − Sold for a variation. Computed in the UI; never stored.

---

## Design Library

**Design**
A reusable production recipe for a jewelry piece: name, category, specifications, step-by-step instructions, reference images, a Materials list (BOM), and Costing data. Stored via the designs API; browsed in the Designs tab.

**Design Library**
The card-grid index of all Designs, filterable by category.

**Design Guide**
The read-only, formatted view of a Design — the primary view opened by clicking a Design card. Reads as a how-to guide for making the piece. Editing happens in the separate edit form, reached via an Edit action from the Guide.

**Materials (BOM)**
The per-piece bill of materials on a Design: material lines with quantities and waste percentages, drawing from the shared Materials list.

**Costing**
The Design's cost rollup: material cost + labor (from timers or override) vs. retail (from the linked Square item or override). On the Design Guide it appears only as a collapsed summary; it never appears in print.

**Guide Printout**
The Design Guide printed to 8.5×11 letter. Carries the same formatting as the on-screen Guide but excludes the Materials (BOM) and Costing modules — the free-text Specifications section is the only materials information on paper, so a printout must be self-sufficient at the bench. Long designs flow to a second sheet rather than shrinking type.

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
