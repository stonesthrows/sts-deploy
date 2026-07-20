# ADR 0003 — Public deploy lockdown

Date: 2026-07-20
Status: Accepted

## Context

The Cloudflare Pages deploy serves the entire repo as static assets at a
public URL. That exposed:

1. **Customer PII in `js/data.js`** — a hardcoded `SHOPIFY_ORDERS` snapshot
   with real customer names, emails, cities/zips, and tracking numbers,
   readable by anyone. `GMAIL_THREADS` (unused mock data) also carried a
   customer name.
2. **`gmail-brief.json`** — real customer email threads/snippets, fetched by
   the Gmail tab but also directly readable by anyone.
3. **Repo internals** — `CLAUDE.md`, `CONTEXT.md`, docs/, dev scripts
   (`*.ps1`, `*.bat`, `*.py`), `stuller-2026-orders.csv`, `med_*.json`
   exports, worker source folders.

## Decision

- **No customer data in static files, ever.** `SHOPIFY_ORDERS` is now an
  empty array populated at runtime by `shopifyLoadShipments()`
  (`js/shopify.js`) from the key-authed `/api/shopify-orders` proxy (which
  now returns fulfillment tracking), cached in localStorage for 1h.
  `GMAIL_THREADS` deleted (referenced nowhere).
- **Root static-file gate.** `functions/_middleware.js` runs for every
  request and returns 404 for a deny-list: `*.md`, `*.ps1`, `*.bat`, `*.py`,
  `*.csv`, `/docs/*`, `/stuller-sync/*`, `/sts-worker-v2/*`, `/.claude/*`,
  `/serve.js`, `/med_*.json`, `/.mcp.json`, and `/gmail-brief.json`.
- **Gmail brief goes behind the API gate.** `/api/gmail-brief`
  (`functions/api/gmail-brief.js`) re-serves the static file via
  `env.ASSETS.fetch`, so it inherits the X-STS-Key check in
  `functions/api/_middleware.js`. The app fetches this endpoint instead;
  `js/api-auth.js` attaches the key automatically.
- **`X-Robots-Tag: noindex, nofollow`** on all responses (`_headers`) —
  this is an internal tool and should never be indexed.

## Remaining manual steps (Cloudflare dashboard — cannot be done from the repo)

1. **Set `APP_SHARED_KEY`** in the Pages project env vars. Until it is set,
   the `/api/*` auth gate (and therefore `/api/gmail-brief`) FAILS OPEN by
   design. After setting it, enter the same value on each device under
   ⚙ Integrations → "App API Key".
2. **(Recommended) Cloudflare Access** in front of the whole Pages project
   (Zero Trust → Access → Applications, free for small teams). This puts a
   Google-login wall in front of the app pages themselves, which the repo
   alone cannot do.

## Consequences

- Every request now passes through a Pages Function invocation (root
  middleware). Traffic is tiny; free-tier limits (100k/day) are not a concern.
- The automation that regenerates `gmail-brief.json` keeps writing the same
  static file; only direct public reads are blocked.
- `SQUARE_WEEKENDS` (business revenue, no PII) is still hardcoded in
  `data.js` — migrating it to the `/api/weekend-sales` store is tracked as
  part of the "hand-edited snapshots" cleanup, separate from this lockdown.
