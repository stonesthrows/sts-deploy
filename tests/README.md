# Smoke suite

A dev-only test harness for `jewelry-workflow.html`, built out of the
verification scripts used to safely carry out the July 2026 rework series
(monolith split, IndexedDB storage migration, offline support, sync
rework). Not part of the deployed app — nothing here ships to Cloudflare
Pages (`functions/_middleware.js` only serves `*.md`/`*.py`/etc. as 404s
anyway, and this whole folder is JS run with plain Node, never fetched by
the browser).

## What it checks

- **`fingerprint.js`** — loads the app in headless Chromium and diffs a
  behavior snapshot (which key globals exist, which tab panel activates
  for every nav target, a handful of computed-style probes) against
  `fixtures/fingerprint.json`. Built for exactly the failure mode a big
  mechanical refactor risks: silently breaking a tab nobody happened to
  click during manual testing.
- **`offline-storage.js`** — exercises the IndexedDB storage layer
  (`js/storage.js`), the service worker's offline shell (`sw.js`), and
  the Notion offline write queue (`js/notion.js`) end to end: seed →
  migrate → persist → flush-on-hide → go offline → boot from cache →
  queue a write → reload → come back online → replay.

## Setup (one-time)

```
cd tests
npm install
```

## Running

```
cd tests
node run.js              # both suites, combined pass/fail
node fingerprint.js      # just the fingerprint diff
node offline-storage.js  # just the offline/storage suite
```

Each suite starts its own copy of the repo's `serve.js` on port 3177 (see
`lib/server.js`) — it won't collide with a dev server you have running on
the usual `:3000`, and you don't need anything running beforehand.

### Updating the fingerprint snapshot

If you make a **deliberate** behavior change (new tab, renamed global,
different default styling) the fingerprint suite will correctly report it
as a diff. Verify the new behavior by hand in a real browser, then:

```
cd tests
node fingerprint.js --save
```

and commit the updated `fixtures/fingerprint.json` alongside your change.
Never `--save` to make a diff you don't understand go away — that defeats
the entire point of the check.

## Known limitation

`lib/server.js` serves static files only — it does **not** implement the
Cloudflare Pages Functions under `functions/api/`. Any `/api/*` request
these tests trigger gets a plain 404 from the local server. The
offline-storage suite's last steps are written around this deliberately:
after simulating "back online," the queued Notion write hits that 404,
which the app correctly treats as a terminal server response (not a
network failure) and drops instead of retrying forever. That's the
behavior being verified — this suite does not, and cannot, test a real
sync against Notion, Square, Shopify, or any other external API. Changes
to those integrations still need manual verification against the real
services.

## When to run this

Before pushing a change that touches shared infrastructure — `js/app.js`,
`js/storage.js`, `js/notion.js`, `sw.js`, the `css/`/`js/` extraction
boundaries in `jewelry-workflow.html`, or anything else more than one tab
depends on. A change scoped to a single tab's own file doesn't need it;
the project's `CLAUDE.md` isolation rule already keeps that safe by
construction.
