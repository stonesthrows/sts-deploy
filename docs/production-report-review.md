# Production Report — Debug Review & Upgrade Plan

Code audited: `js/restock-sessions.js` (report UI + math), `js/restock.js` (timer
stop → session save), `functions/api/notion-timesession.js` (Notion CRUD),
`functions/api/square-sync.js` (Square shift reconciliation).

> **Status:** Phase 1 fixes (A1–A5, B1–B3, C1–C3, C6, C7) and Phase 2 steps 1–5
> (shared rates via `/api/prod-settings`, material costs, date-range filter,
> By Design / By Category rollups, Square sales join with sell-through, margin
> quadrant + sunset flags) are implemented on this branch. Still open by
> design: B4 (flat 15-min deduction — business-rule decision), C4 (estimate
> price locked in on edit), C5 (idempotency key blocks corrected re-push —
> unreachable via current UI).

---

## Phase 1 — Bugs & Issue Resolution

### A. Labor logging

#### A1. `$0` labor rate gets permanently snapshotted (root cause of missing labor costs)

Employee rates live in `localStorage['sts-employee-rates']` — **per browser**.
`_rqRateFor()` returns `0` (not `null`) when a rate isn't configured
(`js/restock-sessions.js:545`), and `rqStopTimer` snapshots that value to Notion
(`js/restock.js:1609`). So any session stopped on a device where rates were
never typed in (the shop tablet/phone) is saved with `Labor Rate = 0` forever.
The report then treats `laborRate === 0` as an authoritative snapshot — only
`null` triggers the "(est.)" fallback — so labor cost renders `$0.00`
permanently, even after rates are configured later.

**Fix — `js/restock-sessions.js`, `_rqRateFor`:** return `null` when unset:

```js
function _rqRateFor(name) {
  var rates = _rqLoadRates();
  var key = RQ_NAME_ALIASES[name] || name;
  var r = rates[key];
  return (typeof r === 'number' && !isNaN(r) && r > 0) ? r : null;
}
```

**Fix — `_rqRenderReportBody` (~line 704),** guard the estimate fallback
against the new `null`:

```js
var rateIsEstimate = s.laborRate == null;
var rate           = rateIsEstimate ? (_rqRateFor(emp) || 0) : s.laborRate;
```

**Fix — `js/restock.js`, `rqStopTimer` (~line 1638),** only snapshot a real rate:

```js
var patchBody = { pageId: session.notionPageId, stopTime: stopTime, totalMin: totalMin,
  netMin: netMin, notes: notes, itemsJson: JSON.stringify(pricedItems) };
if (laborRate != null) patchBody.laborRate = laborRate;
```

(Structural follow-up in Phase 2: move rates out of localStorage entirely.)

#### A2. Sessions whose Notion page failed to create are marked "✓ Saved" and silently lost

`rqStopTimer` (`js/restock.js:1635`):

```js
if (!session.notionPageId) { session.saved = true; rqRenderSessions(); return; }
```

If the POST at timer *start* failed (offline blip, Notion hiccup), the stop
handler shows "✓ Saved" but never sends anything — all hours and pieces vanish
on reload. **Fix:** fall back to creating the page at stop time:

```js
if (!session.notionPageId) {
  _rqAttachItemPrices(expandedItems).then(function(pricedItems) {
    session.items = pricedItems;
    return fetch('/api/notion-timesession', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemName: (pricedItems[0] && pricedItems[0].name) || '',
        employeeName: session.employee ? session.employee.name : '',
        squareItemId: (pricedItems[0] && !pricedItems[0].isCustom && pricedItems[0].squareId) || '',
        date: session.startTime.slice(0, 10),
        startTime: session.startTime, stopTime: stopTime,
        totalMin: totalMin, netMin: netMin, notes: notes,
        pieces: totalPcs, itemsJson: JSON.stringify(pricedItems),
        laborRate: laborRate,
      }),
    }).then(function(r) { return r.json(); }).then(function(d) {
      session.notionPageId = d.notionPageId || null;
      session.saved = !!session.notionPageId;
      session.error = session.saved ? null : 'Notion error';
      rqRenderSessions();
    });
  }).catch(function() { session.error = 'Network error'; rqRenderSessions(); });
  return;
}
```

And the POST endpoint currently ignores `laborRate` — add to
`functions/api/notion-timesession.js` `onRequestPost` (after line 119):

```js
if (s.laborRate != null) props['Labor Rate'] = { number: s.laborRate };
```

#### A3. Clearing a Labor Rate in the edit form never persists

`rqSaveEditSession` (`js/restock-sessions.js:504`):

```js
if (rateChanged && newRate != null) patch.laborRate = newRate;
```

Blanking the rate sets it to `null` locally but the patch omits it, so Notion
keeps the old value and it reappears on refresh. **Fix (client):**

```js
if (rateChanged) patch.laborRate = newRate;   // null = explicit clear
```

**Fix (server, PATCH handler):** distinguish "absent" from "explicit null":

```js
if ('laborRate' in s) props['Labor Rate'] = { number: s.laborRate };
```

#### A4. Saving an edit silently deletes items with blank piece counts (data loss)

`rqSaveEditSession` (`js/restock-sessions.js:483`):

```js
}).filter(function(it) { return it.pieces != null; });
```

Legacy sessions loaded via the fallback path can have `pieces: null`. Opening
Edit on one and pressing Save — even just to fix the rate — drops the item and
writes `itemsJson: "[]"`, `itemName: ""` to Notion. The edit row already has an
explicit ✕ remove button, so the filter is redundant and dangerous.
**Fix:** delete the `.filter(...)` — keep all rows; removal is ✕-only.

#### A5. `Items JSON` truncated at 2000 chars corrupts multi-variant sessions

Both writers slice to one 2000-char rich-text block
(`functions/api/notion-timesession.js:41` and `:119`), and both readers only
read block `[0]` (`notion-timesession.js:187`, `square-sync.js:201`). A
multi-size restock session (~15+ variant rows) easily exceeds 2000 chars; the
stored JSON is cut mid-string, `JSON.parse` throws on every later load, and the
report silently falls back to a single legacy item — losing piece counts and
every unitPrice snapshot. **Fix (server, both POST and PATCH):** split across
blocks (Notion allows many 2000-char blocks per property):

```js
function rtBlocks(str) {
  var out = [], v = String(str || '');
  for (var i = 0; i < v.length && out.length < 100; i += 2000)
    out.push({ text: { content: v.slice(i, i + 2000) } });
  return out.length ? out : [{ text: { content: '' } }];
}
// PATCH:
if (s.itemsJson != null) props['Items JSON'] = { rich_text: rtBlocks(s.itemsJson) };
// POST:
if (s.itemsJson != null) props['Items JSON'] = { rich_text: rtBlocks(s.itemsJson) };
```

**Fix (readers, both files):** join all blocks:

```js
function txt(prop) { return (prop?.rich_text || []).map(r => r.plain_text || '').join(''); }
```

**Fix (client, shrink the payload):** strip private/transient keys before
stringifying (in `rqStopTimer` and `rqSaveEditSession`):

```js
function _rqItemsForJson(items) {
  return (items || []).map(function(it) {
    return { name: it.name, squareId: it.squareId, pieces: it.pieces,
             isCustom: !!it.isCustom, unitPrice: it.unitPrice != null ? it.unitPrice : null };
  });
}
// usage: JSON.stringify(_rqItemsForJson(pricedItems))
```

---

### B. Square hours

#### B1. Shift search returns the *oldest* 100 shifts — recent sessions can never match (root cause)

`fetchShifts` (`functions/api/square-sync.js:143`) queries
`/v2/labor/shifts/search` with `limit: 100`, **no date filter, no sort, no
pagination**. Square returns shifts sorted by `start_at` ascending by default,
so once an employee has logged 100+ lifetime shifts, the response contains only
their oldest shifts. `reconcile()` finds no overlap with the session window →
every new session reports `pending`, then gets stamped **Square Sync Failed**
48 hours later. This matches "square hours failing to log" exactly — and it
gets worse over time, which is why it once worked.

**Fix:** scope the query to the session window and sort descending:

```js
async function fetchShifts(deps, empId, startTime, stopTime) {
  const padMs = 24 * 3600 * 1000; // catch overnight/adjacent shifts
  const res = await fetch(`${SQUARE_API}/v2/labor/shifts/search`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + deps.squareToken, 'Square-Version': SQUARE_VER, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        filter: {
          team_member_ids: [empId],
          location_ids: [SQ_LOCATION],
          start: {
            start_at: new Date(new Date(startTime).getTime() - padMs).toISOString(),
            end_at:   new Date(new Date(stopTime).getTime()  + padMs).toISOString(),
          },
        },
        sort: { field: 'START_AT', order: 'DESC' },
      },
      limit: 100,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.errors && data.errors[0] && data.errors[0].detail) || data.message || 'Square shift search failed');
  return data.shifts || [];
}
```

Call site in `syncOneSession`:

```js
if (empId) shifts = await fetchShifts(deps, empId, startTime, stopTime);
```

After deploying, clear the `Square Sync Failed` checkbox on wrongly-failed
sessions in Notion (or add a one-off sweep) so the cron picks them back up.

#### B2. The 7-day "recheck" window never closes — synced sessions re-sync every 15 minutes forever

Eligibility (`square-sync.js:96-99`) rechecks sessions whose
`Last Square Sync` is within 7 days — but every sync **writes
`Last Square Sync = now`** (line 243), so the window rolls forward forever.
Every synced session in history is re-fetched from Square and re-patched to
Notion on every 15-minute cron fire: unbounded API volume, rate-limit risk,
and it will eventually slow the sweep enough to starve new sessions.
**Fix:** key the recheck off the immutable `Stop Time`:

```js
{ and: [
  { property: 'Square Synced', checkbox: { equals: true } },
  { property: 'Stop Time', date: { after: recheckSinceIso } },
]}
```

#### B3. Editing times wipes Square-reconciled deductions and desyncs Notion's numbers

`rqSaveEditSession` (`js/restock-sessions.js:445-448`) recomputes
`netMs = total − 15min`, discarding the clocked-out deduction that
`/api/square-sync` computed, and never patches `dedMin` — so in Notion,
`Duration − Deducted ≠ Net`. **Fix:** preserve the prior deduction and keep
Notion consistent:

```js
if (newStart && newStop) {
  var prevDedMs = Math.max(0, (s.totalMs || 0) - (s.netMs || 0)) || 15 * 60000;
  s.totalMs = new Date(newStop) - new Date(newStart);
  s.netMs   = Math.max(0, s.totalMs - prevDedMs);
}
// ... in the patch block:
if (newStart && newStop) {
  patch.totalMin = parseFloat((s.totalMs / 60000).toFixed(2));
  patch.netMin   = parseFloat((s.netMs   / 60000).toFixed(2));
  patch.dedMin   = parseFloat(((s.totalMs - s.netMs) / 60000).toFixed(2));
}
```

#### B4. Flat 15-minute deduction applies to every session, however short (business-rule check)

Both `rqStopTimer` (`netMin = max(0, totalMin − 15)`) and `reconcile()`
(`dedMs = … + 15*60000`) always subtract 15 minutes. A 25-minute session logs
10 net minutes; a 14-minute one logs 0 → labor cost understated on short runs.
If the 15 minutes represents a break/cleanup allowance, gate it:

```js
// square-sync.js reconcile():
const breakMs = totalMs > 4 * 3600000 ? 15 * 60000 : 0;
const dedMs = Math.max(0, totalMs - workedMs) + breakMs;
// restock.js rqStopTimer():
var netMin = Math.max(0, totalMin - (totalMin > 240 ? 15 : 0));
```

Confirm the intended rule before changing — flagged because it silently skews
cost-per-piece on short sessions.

---

### C. General bugs

#### C1. Deleting a card while another is being edited shifts the edit row onto the wrong session

`rqDeleteReportSession` / `rqDeleteSession` splice the array but leave
`_rqEditingSession[store]` pointing at the old index — after re-render, the
open edit form (with the *old* session's prefilled values) attaches to a
different session, and Save writes those values to the wrong Notion page.
**Fix (both functions, shown for report):**

```js
_rqReportSessions.splice(i, 1);
if (_rqEditingSession.report === i) _rqEditingSession.report = null;
else if (_rqEditingSession.report > i) _rqEditingSession.report--;
if (_rqPushingSession.report === i) _rqPushingSession.report = null;
else if (_rqPushingSession.report > i) _rqPushingSession.report--;
_rqRenderReportBody(_rqReportSessions);
```

#### C2. Delete ignores Notion failures — "deleted" sessions come back

`onRequestDelete` (`functions/api/notion-timesession.js:86`) never checks the
Notion response, and the client's `.catch(function(){})` swallows everything;
the card disappears locally but reappears on refresh. **Fix (server):**

```js
var res = await fetch(NOTION_API + '/pages/' + pageId, { /* …archive body… */ });
if (!res.ok) {
  var d = await res.json().catch(function() { return {}; });
  return jsonResp({ error: d.message || 'Notion error ' + res.status }, res.status);
}
return jsonResp({ ok: true });
```

**Fix (client):** surface it instead of swallowing:

```js
fetch('/api/notion-timesession?pageId=' + encodeURIComponent(s.notionPageId), { method: 'DELETE' })
  .then(function(r) { if (!r.ok) { toast('Delete failed — restoring', '⚠'); rqRenderProductionReport(true); } })
  .catch(function() { toast('Delete failed — restoring', '⚠'); rqRenderProductionReport(true); });
```

#### C3. "Total Profit" mixes sessions with and without price data

`_rqRenderReportBody`: `grandLabor` accumulates for *every* session, but
`grandValue` only for sessions with priced items — so unpriced sessions drag
Total Profit negative even when priced work is profitable. Either exclude
their labor from the profit figure or (better) surface the gap:

```js
var unpriced = 0;
// inside the map: if (!hasAnyValue) unpriced++;
// in the summary:
+ (unpriced ? '<span>' + unpriced + ' session' + (unpriced !== 1 ? 's' : '') + ' missing price data</span>' : '')
```

#### C4. Editing a legacy session silently converts an estimated price into a locked snapshot

`_rqFillReportPriceFallbacks` mutates cached items in place with today's price
(`_priceIsEstimate: true`). The edit form prefills that estimate; Save then
writes it with `_priceIsEstimate: false` — today's price is now recorded as the
historical price. Low-frequency, but worth knowing: an "(est.)" badge in the
edit row, or leaving the price input blank for estimates, avoids it.

#### C5. Square push idempotency key blocks corrected re-pushes

`rqConfirmPush` uses `'rq-push-' + s.notionPageId`. Good for retry-safety, but
if piece counts are corrected after a successful push, Square dedupes the
second call and silently ignores it. Include a nonce once a push succeeded:
`'rq-push-' + s.notionPageId + (s.pushed ? '-' + Date.now() : '')`.

#### C6. Report cache goes stale after Session Log edits

`_rqReportSessions` and `_rqSessions` come from separate fetches; editing a
session in the Session Log doesn't invalidate the report cache, so the report
shows pre-edit numbers until manual ⟳ Refresh. Cheap fix at the end of a
successful `rqSaveEditSession` when `store === 'log'`:

```js
_rqReportSessions = null;   // force refetch next time the report opens
```

#### C7. Cron sweep 500s if the sync-tracking properties are missing

`fetchEligibleSessions` filters on `Square Synced` / `Square Sync Failed` /
`Last Square Sync`; if any is missing from the Notion DB, Notion 400s, the
throw is uncaught, and the whole sweep dies. Wrap the sweep body in
`try/catch` and return `jsonResp({ error: e.message }, 500)` with the message
so the trigger Worker logs something actionable.

---

## Phase 2 — Developer Upgrades & Business Intelligence

The report today is a **session ledger**. The strategic questions (pricing,
sunset, category focus) are all *per-design* questions, so the core upgrade is
a design-level aggregation layer fed by two joins the app can already make:
sessions ↔ Square catalog (via `squareId`) and catalog ↔ Square **sales**.

### 1. Data structure

**a. Make labor rates shared, not per-browser (fixes A1 structurally).**
Store rates in Notion (tiny "Settings" DB or a page property) or reuse
`/api/restock-meta`-style KV, fetched once into `_rqLoadRates()` with
localStorage as offline cache. Every device then snapshots correct rates.

**b. Enrich the per-item snapshot at Stop & Save.** Extend the `itemsJson`
item shape:

```js
{ name, squareId, pieces, isCustom, unitPrice,
  category,        // from Square catalog (already fetched during search)
  materialCost }   // NEW: per-piece material cost
```

Material cost is the missing half of true margin. Start simple: a
`sts-material-costs` map keyed by design/variation (editable in the same
panel as rates, but stored server-side like rates), auto-attached at stop the
way `_rqAttachItemPrices` attaches prices.

**c. Add a sales feed.** New Pages function `/api/square-sales` wrapping
Square Orders `SearchOrders` for a date range, aggregating
`line_items[].catalog_object_id → { unitsSold, grossRevenue, discounts }`.
Cache the aggregate (KV or in-memory per invocation window) — the report only
needs day-level granularity.

### 2. Metrics to calculate (per design/variation, per period)

| Metric | Formula | Answers |
|---|---|---|
| True unit cost | `(laborRate × netHrs) / pieces + materialCost` | pricing floor |
| Contribution margin % | `(price − unitCost) / price` | is the price right? |
| Value per labor hour | `Σ(pieces × price) / Σ netHrs` | where an hour of bench time earns most |
| Pieces per hour | `Σ pieces / Σ netHrs` | production efficiency, per employee too |
| Cost per Square-verified hour | `laborCost / (clocked-in overlap hrs)` | timer vs. clock discrepancy |
| Sell-through | `unitsSold / piecesProduced` (rolling 90d) | over/under-production |
| Design ROI | `(revenue − labor − materials) / (labor + materials)` | sunset ranking |
| Inventory velocity | `unitsSold / avg on-hand` (on-hand already fetched in `_rqInvCounts`) | dead stock |

### 3. UI — from ledger to planning tool

**a. View toggle: `By Session | By Design | By Category`.** "By Design" is a
sortable table (design, pcs made, net hrs, unit cost, price, margin %, units
sold, sell-through, profit) built by grouping `_rqReportSessions` items on
`squareId` — pure client-side reduce, no new backend. "By Category" is the
same rollup one level up, and directly answers the "pivot to party designs?"
question: compare margin %, value/hr, and sell-through across categories
quarter over quarter.

**b. Date-range + employee filters** on the header bar (This month / Last
month / Quarter / All). Every aggregate above becomes period-comparable, which
is what makes trend calls ("category X is accelerating") possible.

**c. Margin quadrant (menu-engineering matrix).** One inline-SVG scatter —
x = units sold, y = margin % — splits designs into four actionable buckets:

- high margin / high volume → protect & keep stocked
- high margin / low volume → market more (or fine as-is)
- low margin / high volume → **reprice** (these are the "losing money at
  volume" designs the pricing question is about)
- low margin / low volume → **sunset candidates**

A dot per design, colored by category, ~60 lines of vanilla SVG — consistent
with the no-framework rule.

**d. Sunset flags.** In the By-Design table, badge any design with
sell-through < 40% *and* margin < 25% over the last 90 days (thresholds
editable next to the rates panel). That turns "which should I kill?" from a
judgment call into a checklist.

**e. Estimate hygiene.** Roll the existing "(est.)" flags up: a summary chip
like "⚠ 6 sessions using estimated rates/prices" that filters to them, so the
data quality improves instead of quietly decaying.

### 4. Suggested build order

1. Phase 1 fixes A1/A2/A5 + B1/B2 (data correctness — everything else is
   built on these numbers).
2. Shared rates + material costs (1a, 1b).
3. By-Design/By-Category rollup + date filter (3a, 3b) — client-side only,
   biggest insight-per-effort.
4. `/api/square-sales` + sell-through/ROI columns (1c, 2).
5. Margin quadrant + sunset flags (3c, 3d).
