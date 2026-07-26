# Redesign mockups

Ten redesign concepts for `jewelry-workflow.html`, each with its own light and
dark mode. **Design exploration only** — nothing here is wired to Notion, Square,
or any data source, and nothing in the live app imports from this folder.

## Where the files live

This folder holds **only the generator and this README**, and is on the
deny-list in `functions/_middleware.js` — nothing under `/mockups/` is served.

The built pages go to **`../m-e5807cb1bd/`** at the repo root, which *is*
served, so they open on a phone with no login:

| | |
|---|---|
| **Phone** | https://sts-deploy.pages.dev/m-e5807cb1bd/all-in-one.html |
| **Desktop** | https://sts-deploy.pages.dev/m-e5807cb1bd/ |

`all-in-one.html` is every design in one page with a switcher; `index.html` is
the side-by-side gallery, better on a large screen.

The directory name is deliberately unguessable. It is not access control — it
just keeps internal design work from being found by trying obvious URLs. The
mockups contain no customer data and no credentials (every name, order and
figure in them is invented), but they do carry the studio name, staff first
names, market locations and supplier names. Change the name by editing
`PUBLIC_DIR` in `_build/build.js` and re-running; delete the old directory.

## The ten

| # | File | Direction |
|---|------|-----------|
| 01 | `01-atelier.html`   | Today's blue-and-gold identity, done properly |
| 02 | `02-workbench.html` | Information-dense, utilitarian, minimal chrome |
| 03 | `03-editorial.html` | Magazine layout — serif display, wide margins |
| 04 | `04-glass.html`     | Glassmorphic, translucent, live gradient field |
| 05 | `05-brutalist.html` | Zero radius, heavy rules, unmixed primaries |
| 06 | `06-terminal.html`  | Monospace, phosphor accent, dark-native |
| 07 | `07-craft.html`     | Kraft paper and linen, warm neutrals, gold foil |
| 08 | `08-soft.html`      | Neumorphic — low contrast, extruded, calm |
| 09 | `09-linear.html`    | Modern SaaS — hairline borders, tight greys |
| 10 | `10-bento.html`     | Dashboard as a mosaic of mixed-size tiles |

Each file renders two screens — the **Home dashboard** and the **Order
Pipeline** kanban — switched with the tabs under the topbar. All ten use the
same fixture data (16 orders across the 8 real `COLUMN_GROUPS` stages), so the
only variable between them is the design.

## Dark mode

Each mockup carries both palettes as design tokens on `:root`, with
`:root[data-theme="dark"]` overriding them — the same mechanism the dormant
`body.theme-midnight` block in `css/app.css:4831` already uses. First load
follows `prefers-color-scheme`; the toggle then persists per mockup in
`localStorage`. The gallery's toggle drives all ten at once via `?theme=`.

Dark is designed rather than derived: the eight kanban stage hues get
hand-raised chroma in dark, because simply inverting lightness collapses the
columns into an indistinguishable muddy band.

Component rules reference **only** tokens — no raw hex — which is the
`CLAUDE.md` colour rule enforced strictly. That is deliberate: whichever design
gets picked, its token set ports to the real app without the per-component patch
work that `theme-midnight`'s 122 override rules currently represent.

## Regenerating

The HTML is generated so the markup and fixture data stay identical across all
ten:

```
node mockups/_build/build.js
```

`_build/` is dev-only. Edit `_build/designs-a.js` (concepts 1–5),
`_build/designs-b.js` (6–10), `_build/shell.js` (shared markup + structural
CSS), or `_build/data.js` (fixtures), then re-run. The **output** is plain
self-contained HTML — no build step, no external requests, no dependencies —
consistent with how the rest of the app ships.

### How `all-in-one.html` differs

`_build/all-in-one.js` scopes every design's CSS to a `#stage` wrapper so all
ten can share one document: `:root` becomes `#stage`, and the mockup's theme
attribute is `data-mock` rather than `data-theme` (the Artifact viewer stamps
`data-theme` on the root element, and the two would fight).

Its width media queries are rewritten as **container queries** against the
stage. Media queries resolve against the viewport, so on a phone the mockup
would drop to its mobile layout even in Desktop mode — which is the layout
Desktop mode exists to bypass. Desktop mode renders the stage at 1520px (the
width where all eight stages fit) and scales it down; pinch-zoom reads detail.

The scoping is regression-tested: for every design × theme, 23 computed style
properties are compared against the standalone file and must match exactly.

## Not part of the deploy

Cloudflare Pages serves the repo as static assets, so if this folder ever
reaches `main` these files would be publicly reachable at
`/mockups/…`. To keep them internal, add `'/mockups/'` to `BLOCKED_PREFIX` in
`functions/_middleware.js` — the same list that already hides `/docs/` and
`/.claude/`. (This `README.md` is already covered: `.md` is in `BLOCKED_EXT`.)
