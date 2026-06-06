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
