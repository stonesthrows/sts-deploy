# ADR 0002 — Square Shift Sync via Scheduled Cloudflare Worker

**Status:** Accepted
**Date:** 2026-07-01

## Context

Production Sessions record an employee's worked time via app Start/Stop, but the authoritative clock in/out times come from Square's `/labor/shifts` data. Square's shift record frequently lags behind the app timer (an employee stops the timer and clocks out on Square later, or a manager corrects a timecard after the fact), so reconciliation cannot happen solely at the moment a session is saved.

Today, reconciliation (`syncShiftsForSession` in `time-tracker.html`, duplicated as `rqSyncShiftsForSession` in `notes.js`) only runs when a user manually clicks a "Sync" button while the app is open. This is unreliable in exactly the case that matters most: the employee stops the timer and closes the browser, so no client-side retry ever runs, and the session is left unsynced until someone remembers to open the app and click Sync again.

Two approaches were considered:

**Option A — Client-side retry.** On Stop & Save, start a `setInterval` retry loop in the browser checking Square until the shift appears. Simple, reuses existing code, but dies the moment the tab/browser closes — which is the normal, expected sequence of events after clocking out.

**Option B — Server-side scheduled polling.** A standalone Cloudflare Worker with a Cron Trigger runs independently of any open browser tab, querying Notion directly for Production Sessions needing reconciliation and patching results back.

## Decision

Option B, split across two pieces so the actual work stays inside the existing Pages Functions deploy rather than duplicating secrets into a second Worker:

1. **`functions/api/square-sync.js`** (new Cloudflare Pages Function, same project as the rest of the app) holds the one canonical reconciliation implementation — replacing the two divergent copies previously in `time-tracker.html` (`syncShiftsForSession`) and `notes.js` (`rqSyncShiftsForSession`). It uses the `SQUARE_TOKEN`/`NOTION_TOKEN` env vars that already exist on the Pages project (`functions/api/square.js` and `functions/api/notion-timesession.js` already read these). Called with `{ pageId }` it force-syncs one session (used by the manual "Sync" buttons); called with no body it sweeps every eligible session.
2. **`square-sync-trigger`** (new, separate, minimal Cloudflare Worker — its own deploy, sibling to `triplog-proxy`) exists solely to hold a Cron Trigger (every 15 minutes) and `fetch()` the `/api/square-sync` sweep endpoint on schedule. It holds no secrets of its own — it only needs to know the URL to hit.

The sweep queries Notion for Production Sessions where `Square Synced = false`, stop time has passed, and `Square Sync Failed = false`; or where `Square Synced = true` but `Last Square Sync` was within the last 7 days (to catch late Square corrections). If no matching shift is found within 48 hours of the session's stop time, the session flips to `Square Sync Failed` and stops being retried automatically.

Notion remains the single source of truth for sync state (via the `Square Synced` / `Square Sync Failed` checkboxes and `Last Square Sync` date) — no separate KV/D1 pending-list is introduced.

## Reasons

- **Solves the actual failure mode.** The problem reported was "doesn't always persist after I sync" — root-caused to the employee closing the browser before Square's shift data exists. Only a process independent of the browser can retry after that point.
- **No duplicated secrets.** Keeping the actual Square/Notion work inside the existing Pages Functions deploy means `SQUARE_TOKEN`/`NOTION_TOKEN` continue to live in exactly one place. The new standalone Worker is a bare scheduler with no credentials to rotate or leak.
- **No duplicate source of truth.** Querying Notion directly for pending work avoids introducing a second store (KV/D1) that could drift from Notion's actual state.
- **Consolidation is close to free.** Since the sweep needs the reconciliation logic anyway, this is the natural point to delete the two divergent client-side copies and fix a real (if separate) maintenance risk at the same time.

## Trade-offs

- **New infrastructure, but minimal.** A second Cloudflare Worker must still be deployed and its Cron Trigger maintained — one more thing to remember exists — but it is a few lines of code with zero secrets, closer to a cron-job stub than a full service.
- **Less immediate feedback.** A background job failing (bad token, Square API change) is discovered passively via the `Square Sync Failed` flag, not immediately like a button click that visibly does nothing.
- **More background API traffic.** Every cron run queries Notion and Square for pending/recent sessions, rather than only on manual demand. Not expected to be significant at current volume.
- **Requires a manual one-time Notion schema change.** The `Square Synced` (checkbox), `Square Sync Failed` (checkbox), and `Last Square Sync` (date) properties must be added to the STS Work Sessions database by hand before this can run — Notion's API has no Claude-accessible connector in this environment to do it automatically.
