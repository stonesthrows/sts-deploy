---
name: stuller-sync
description: >
  Pull Stuller order history directly from stuller.com and import it into the
  Stones Throw Studio workflow app. Use this skill whenever Kyle says anything
  like "sync Stuller orders", "pull my Stuller invoices", "check Stuller",
  "import Stuller orders", "update order history from Stuller", or "what did I
  order from Stuller". The skill automatically picks up from the last synced
  date so there are no duplicate or missed orders.
---

# Stuller Order Sync

Pulls order history from stuller.com/orders via the Chrome browser and imports
new orders into the STS Order History tab. Uses memory to track the last synced
date so each run only fetches what's new.

## Step 1 — Determine date range

Check memory for a file named `stuller-last-sync.md` at:
`C:\Users\morph\AppData\Roaming\Claude\local-agent-mode-sessions\a542e33e-03f6-4c01-9348-e26c097533be\5cc39255-b720-48e1-9103-16580b68f9e3\spaces\27d9cadf-8d0e-45a0-812e-0c1c3a309777\memory\stuller-last-sync.md`

- If the file exists, read the `last_sync_date` value. Use the **day after** that date as the START DATE (to avoid re-importing the last order).
- If no file exists, default START DATE to **01/01/2026**.
- END DATE is always today.

Tell Kyle: "Fetching Stuller orders from [START DATE] to [END DATE]…"

## Step 2 — Open Stuller orders page

Use the Claude in Chrome MCP tools to navigate to stuller.com/orders.

```
mcp__Claude_in_Chrome__tabs_context_mcp  (createIfEmpty: true)
mcp__Claude_in_Chrome__navigate  →  https://www.stuller.com/orders
```

Check the page title with `get_page_text`. If it redirects to the login page,
tell Kyle: "Please log in to Stuller in that tab, then let me know when you're
ready." Wait for confirmation before continuing.

## Step 3 — Set date range and search

Once on the Order History page, open the start-date calendar picker and select
the correct start date using `mcp__Claude_in_Chrome__computer`:

1. Triple-click the start date input (class `date-selector-start-input`), type the START DATE in MM/DD/YYYY format, press Tab.
2. The calendar picker will open — click the correct day.
3. Click the blue search button (class `search-submit-btn`).
4. Wait 2–3 seconds, then call `get_page_text` to read results.

If the page still shows the old date range after clicking search, retry by
clicking the "30 Days" quick button first to reset state, then re-enter the
custom dates.

## Step 4 — Extract orders

Parse the page text for the order table. Each row contains:
`Order #  |  Confirmation #  |  PO #  |  Order Date  |  Status  |  Account  |  Est. Price`

Extract all rows. The page shows "Found N orders in date range …" — confirm N
matches the number of rows you extracted.

If N > 10, check if there's pagination (e.g. "Showing 1–10 of 23"). If so,
increase items-per-page to 50 via the dropdown before extracting, or page
through and collect all rows.

Build a list of order objects:
```
{ date, orderNum, confirmNum, status, amt }
```

- `date`: Order Date in YYYY-MM-DD format
- `orderNum`: Order # column
- `confirmNum`: Confirmation # (use as invoice number)
- `status`: map "Shipped" → "Delivered", "Open"/"Backordered" → "Processing"
- `amt`: Est. Price as a number (strip $, commas)

## Step 5 — Handle "nothing new"

If 0 orders are found in the date range, tell Kyle:
"No new Stuller orders since [last sync date]. All caught up! ✓"
Then skip to Step 7 (update memory with today's date).

## Step 6 — Write CSV and import

Create a CSV file at:
`C:\Users\morph\Desktop\sts-deploy\stuller-sync-import.csv`

```csv
date,supplier,order number,invoice number,amount,status
2026-05-14,Stuller,41727040,18731001,38.84,Delivered
…
```

Column mapping:
- `date` → order date (YYYY-MM-DD)
- `supplier` → always "Stuller"
- `order number` → Order #
- `invoice number` → Confirmation #
- `amount` → Est. Price
- `status` → mapped status

Then tell Kyle:

> "Found [N] new orders totalling $[total]. The file `stuller-sync-import.csv`
> is ready in your sts-deploy folder.
>
> To import: open your STS app → Supplies → Order History → set the supplier
> override to **Stuller** → click **⬆ Import CSV** → select
> `stuller-sync-import.csv`."

Show Kyle a quick summary table of the orders before they import.

## Step 7 — Update memory

After a successful sync (even if 0 orders), update the memory file with today's
date and the count of orders found.

Write (or overwrite) the file at:
`C:\Users\morph\AppData\Roaming\Claude\local-agent-mode-sessions\a542e33e-03f6-4c01-9348-e26c097533be\5cc39255-b720-48e1-9103-16580b68f9e3\spaces\27d9cadf-8d0e-45a0-812e-0c1c3a309777\memory\stuller-last-sync.md`

```markdown
---
name: stuller-last-sync
description: Last date Stuller order history was synced — used by stuller-sync skill to avoid duplicates
metadata:
  type: reference
---

last_sync_date: YYYY-MM-DD
orders_found: N
synced_at: YYYY-MM-DD HH:MM
```

Also ensure `MEMORY.md` index lists this file.

## Notes

- The Stuller order page uses a React date picker. If clicking the calendar day
  doesn't register, try using `form_input` with the element ref instead, then
  Tab out to close the picker before clicking search.
- `Est. Price` is an estimate — actual invoice amounts may differ slightly. Kyle
  can edit individual orders in the app after import.
- The skill never logs in on Kyle's behalf — if Stuller requires a password,
  pause and ask Kyle to log in.
