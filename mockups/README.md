# Redesign mockups

Ten redesign concepts for `jewelry-workflow.html`, each with its own light and
dark mode. **Design exploration only** — nothing here is wired to Notion, Square,
or any data source, and nothing in the live app imports from this folder.

Open **`index.html`** to browse all ten side by side.

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

## Not part of the deploy

Cloudflare Pages serves the repo as static assets, so if this folder ever
reaches `main` these files would be publicly reachable at
`/mockups/…`. To keep them internal, add `'/mockups/'` to `BLOCKED_PREFIX` in
`functions/_middleware.js` — the same list that already hides `/docs/` and
`/.claude/`. (This `README.md` is already covered: `.md` is in `BLOCKED_EXT`.)
