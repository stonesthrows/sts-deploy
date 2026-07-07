# STS Workflow — Test Harness

Regression tests for the sync/storage/rendering architecture (see
`docs/architecture-upgrades.md`). Two kinds:

## Simulation tests (no dependencies)

Load the real source files into Node with stubbed browser APIs and a
scripted network, then drive the tricky scenarios directly. Run from the
repo root or anywhere:

```
node tests/sim-outbox.test.js     # js/sync.js — outbox write queue
node tests/sim-delta.test.js      # js/notion.js — delta-sync merge rules
node tests/sim-storage.test.js    # js/app.js — IndexedDB migration + fallbacks
node tests/sim-kv-cache.test.js   # functions/api/notion-pipeline.js — KV edge cache
```

Each prints `ALL ... TESTS PASSED` and exits 0 on success.

## Browser tests (need Chromium + playwright-core)

Run the ACTUAL app (served by `serve.js`, which the test spawns itself on
port 3000) in headless Chromium and verify end-to-end behavior:

```
cd tests
npm install            # installs playwright-core only
node browser-migration.test.js   # localStorage→IndexedDB migration, photo pipeline
node browser-render.test.js      # keyed kanban render, delegation, XSS escaping
```

Chromium is resolved via playwright-core's registry (respects
`PLAYWRIGHT_BROWSERS_PATH`); set `CHROME_PATH=/path/to/chrome` to override.
Port 3000 must be free.

Known noise these tests deliberately ignore:
- `/api/*` 404s — `serve.js` is a static server with no API routes.
- External CDN failures (Google GSI, cdnjs) in sandboxed environments.
- The pre-existing `tvInit` error (`js/triplog.js` expects a `#tvWrap`
  element that doesn't exist in `jewelry-workflow.html`) — unrelated bug,
  filtered by the render test until fixed.

## When to run what

- Touching `js/sync.js`, `js/notion.js`, `js/app.js` storage code, or the
  pipeline function → run the matching sim test(s), they're instant.
- Touching rendering, storage, photos, or anything structural → run both
  browser tests too.
- Adding a service worker (upgrade #6 in the architecture doc) → its spec
  includes a mandatory update-path browser test; model it on these files.
