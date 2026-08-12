# Stacker sales history (recovered)

Consolidated record of every stacker sale from **January 2019 to 10 August
2026**, normalised across the 49 catalog listings the line has been sold
under.

> **Corrected twice on 10 Aug 2026.**
>
> **First pass** understated the history by 3,872 units and $62,452 — it
> found listings by searching item names for "stacker", and the entire
> chevron range is named without it (`GF Chevron (Skinny)`, `Double Silver
> Chevron`, `Chevron`). It reported Double Chevron as 25 units when the real
> figure is 492, and Single Chevron as 730 against 3,994.
>
> **Second pass** selected by category, but only by the *live* category. A
> retired category — `zStackable Rings (Discontinued)` — holds another 82
> units, most of them Square stackers. The app's own `BS_SKIP_CAT_RE`
> filters `z…`/`(Discontinued)` categories out by design, and that habit
> carried into the query. Adding it, plus a handful of strays sitting in
> Uncategorized, brings the history to the figures below (+86 units,
> +$1,300).
>
> See [Completeness](#completeness) for what has now been swept and what
> genuinely cannot be recovered.

## Why this file exists

The stacker listings have been restructured repeatedly — renamed, split by
metal and width, merged back, older ones deleted. Deleting a listing removes
it from the Square catalog but **not** from the order history: every order
still records the item and variation name as they were at the time of sale.

What is lost is the *link* between those sales and today's catalog. Square's
inventory reporting can only attribute a sale to a variation that still
exists, so roughly 3,900 units across the whole catalog now show against no
current variation. In the app this is why the Best Sellers focus cards
cannot judge per-variation performance for a rebuilt design.

This file captures the history in a form that no longer depends on the
catalog, so a future restructure cannot cost it again.

**Source:** Square Reporting API, `ProductMixReport`, filtered on
`category_name` in `Stackable Rings` and `zStackable Rings (Discontinued)`
and grouped by `item_name` + `item_variation_name`, plus named strays picked
up from Uncategorized. That report keys off what was recorded on each order,
so it still sees deleted listings.

**Select by category, never by name — and include the retired categories.**
Names are the one thing that changed every time the line was reorganised;
the category is what mostly stayed put. A name filter silently drops whole
ranges, which is how the first version of this file went wrong; a
live-categories-only filter drops the discontinued bucket, which is how the
second one did.

---

## Totals

**12,755 units · $197,594**, across 49 listing names.

| Current design | Units | Net sales | Sold under |
|---|---|---|---|
| Stacker (Regular) | 7,265 | $98,324 | 16 names |
| Stacker (Single Chevron) | 3,996 | $69,924 | 14 names |
| Stacker (Hexagon) | 547 | $6,942 | 6 names |
| **Stacker (Double Chevron)** | **495** | **$14,816** | 3 names |
| Stacker (Square) | 255 | $3,531 | 8 names |
| Stacker (Beaded) | 197 | $4,057 | 2 names |

Outside the production range, and not in the totals above: **Birthstone
Stacker** (35 units, $1,485) and nine custom gold one-offs ($1,638).

The Regular stacker is 57% of units; Regular and Single Chevron together are
88%.

---

## Size curves

### Regular stackers — 4,771 sales

From the listings that recorded a real size, one per metal and width with
sizes as variations. **This is the curve the app uses** — see
`BS_STACKER_CURVE` in `js/bestsellers.js`.

| Size | Units | Share | | Size | Units | Share |
|---|---|---|---|---|---|---|
| 2 | 103 | 2.2% | | 7 | **433** | **9.1%** |
| 2.5 | 113 | 2.4% | | 7.5 | 356 | 7.5% |
| 3 | 191 | 4.0% | | 8 | **416** | **8.7%** |
| 3.5 | 200 | 4.2% | | 8.5 | 320 | 6.7% |
| 4 | 188 | 3.9% | | 9 | 320 | 6.7% |
| 4.5 | 188 | 3.9% | | 9.5 | 232 | 4.9% |
| 5 | 251 | 5.3% | | 10 | 255 | 5.3% |
| 5.5 | 259 | 5.4% | | 10.5 | 116 | 2.4% |
| 6 | 348 | 7.3% | | 11 | 151 | 3.2% |
| 6.5 | 326 | 6.8% | | 11.5 | 5 | 0.1% |

- **Core, 6 – 9.5:** 2,751 units — **58%**
- **Small, 2 – 5.5:** 1,493 units — 31%
- **Large, 10 – 11.5:** 527 units — 11%

### Double Chevron — 467 sales

Recovered from `Double Silver Chevron` (285 units) and `Double GF Chevron`
(182), both of which recorded real sizes. Three further sales sit on a
"Regular" variation and carry no size.

| Size | Units | Share | | Size | Units | Share |
|---|---|---|---|---|---|---|
| 2 | 10 | 2.1% | | 7 | **47** | **10.1%** |
| 2.5 | 17 | 3.6% | | 7.5 | 36 | 7.7% |
| 3 | 21 | 4.5% | | 8 | 43 | 9.2% |
| 3.5 | 27 | 5.8% | | 8.5 | 30 | 6.4% |
| 4 | 20 | 4.3% | | 9 | 22 | 4.7% |
| 4.5 | 23 | 4.9% | | 9.5 | 6 | 1.3% |
| 5 | 27 | 5.8% | | 10 | 15 | 3.2% |
| 5.5 | 29 | 6.2% | | 10.5 | 10 | 2.1% |
| 6 | 45 | 9.6% | | 11 | 5 | 1.1% |
| 6.5 | 34 | 7.3% | | | | |

Core 6 – 9.5 is 263 units, **56%** — the same shape as the Regular curve,
peaking at 7 and tapering evenly. That agreement is worth something: two
independent size records, eight years and several restructures apart,
describing the same distribution.

**Note:** the app's curve is built on the Regular-era subset only. Widening
it to include the chevron listings would roughly double the sample. The
shape barely moves, so this is a refinement rather than a correction.

---

## What could not be recovered

**3,897 units have no usable size** — recorded against a placeholder
variation, whatever sat first in the list:

| Listing | Variation recorded | Units | Net sales |
|---|---|---|---|
| Stackable Ring | `2` | 1,265 | $15,663 |
| Stacker | `2` | 1,107 | $17,808 |
| Chevron Stacker | `Regular` | 700 | $20,114 |
| Chevron | `Regular` | 430 | $8,374 |
| Beaded/Twisted Stacker | `Regular` | 173 | $3,578 |
| Hexagon Stacker | `Size 2` | 149 | $2,391 |
| Square Stacker | *(blank)* | 73 | $1,174 |

2,372 units rung up as "size 2" is not a real distribution — size 2 is a
child's ring. These sold across the full range; the till recorded the default
variation each time.

**Their units and revenue are sound.** Only the size breakdown is unusable,
so they are in the totals and out of the curves.

### It was still happening until the rebuild — and the rebuild fixed it

This is not an old problem that stopped on its own. Of the **1,479 stacker
units sold in the twelve months to 10 August 2026, 1,330 — 90% — went
through five of the listings above, each recording every single sale against
one variation.** Not mostly one variation; one, with nothing else beside it:

| Listing | Every sale recorded as | Units (12 mo) |
|---|---|---|
| Stacker | `2` | 536 |
| Chevron Stacker | `Regular` | 470 |
| Beaded/Twisted Stacker | `Regular` | 172 |
| Hexagon Stacker | `Size 2` | 103 |
| Square Stacker | *(blank)* | 49 |

**The restructure ended it.** The rebuilt `Stacker (…)` listings — the other
149 units, sold since the changeover — record real sizes with a proper
spread across some sixty size-and-metal combinations: Size 6.5 Silver 5,
Size 8 Gold Fill 4, Size 7.5 Silver 4, on down. That is what the data should
look like, and it is what it now looks like.

So for stackers the placeholder era is closed. Two things follow:

- **The curves above are historical and will stay that way.** Nothing
  collected before the rebuild can be repaired. But sized data is
  accumulating again from 149 units and counting — after a full year of
  markets the curve can be rebuilt from live sales instead of 2019–2024.
- **Per-size stock counts were drifting the whole time.** Every one of those
  1,330 sales decremented one variation on paper while a different ring left
  the table. Counts on the retired listings should be read as fiction; the
  744 units on the rebuilt listings are the trustworthy figure.

**Other lines may still be affected.** Circle Ring shows 37 of 38 sales on
Size 5 and Spiral Rings 82 of 100 on Silver-5 — the same signature, on
designs that have not been rebuilt. This file does not establish how far the
pattern runs; it establishes that rebuilding a listing with real size
variations is what stops it.

---

## Completeness

This file has been wrong twice, so it is worth recording exactly how far the
search went and where it stops.

### Swept

| Sweep | Result |
|---|---|
| Every category name that has ever appeared on an order | Two stacker categories exist, not one — the retired `z…` bucket was the miss |
| Both stacker categories, every listing, every variation | 12,751 units — the bulk of this file |
| Every item name containing stack / chevron / beaded / hexagon / twisted, in every other category | 4 stray production units + the custom one-offs; everything else is ear cuffs, pendants, nose rings, inlay rings |
| Every item name ever sold in **any** category containing "ring" | No stackers hiding under an unrelated name |
| Every item name ever sold with **no** category at all | The strays above; nothing further |

That closes the two ways a listing could hide: renamed but still filed under
a stacker category, or recategorised but still recognisably named.

### Not recoverable

**A listing both renamed past recognition and moved to a non-ring
category.** Nothing in the data distinguishes it from an unrelated product;
only memory would. Given the four sweeps above found 86 units between them,
the scale of anything left is small.

**Unnamed keypad sales — 1,313 units, $107,208 over eight years.** Orders
where the till recorded a custom amount and no item at all, running a
consistent 130–210 units a year. The $82 average is far above a stacker's
price, so most of it is custom work, but some number of $15–20 stackers are
certainly in there and there is no way to tell which.

**Sizes on 3,897 units** — see above. Units and revenue are sound; only the
size breakdown is gone.

---

## Full listing map

All 49 listings, by current design. Rows marked ᶻ picked up extra units from
`zStackable Rings (Discontinued)`; rows marked ᵘ from Uncategorized.

### → Stacker (Regular) — 7,265 units, $98,324

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| GF Stacker (Skinny) | 1,585 | $22,322 | ✅ |
| Stackable Ring | 1,265 | $15,663 | ❌ placeholder |
| Stacker | 1,107 | $17,808 | ❌ placeholder |
| Silver Stacker (Skinny) | 739 | $6,663 | ✅ |
| Silver Stacker (Reg) | 615 | $8,711 | ✅ |
| GF Stacker (Regular) | 474 | $9,140 | ✅ |
| Silv Stacker (Skinny) | 431 | $3,923 | ✅ |
| Stacker (Skinny Silver) | 296 | $2,690 | ✅ |
| Stacker (Skinny Gold Fill) | 280 | $3,902 | ✅ |
| Stacker (Regular Silver) | 219 | $3,053 | ✅ |
| Stacker (Regular Gold Fill) | 149 | $2,818 | ✅ |
| Stacker (Regular) *(current)* | 55 | $966 | ✅ |
| Stacker (Reg Silver) | 17 | $233 | ✅ |
| Stacker (Skinny GF) | 15 | $212 | ✅ |
| Stacker (Skinny Silv) | 12 | $109 | ✅ |
| Stacker (Regular GF) | 6 | $110 | ✅ |

### → Stacker (Single Chevron) — 3,996 units, $69,924

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| GF Chevron (Skinny) | 1,119 | $19,421 | ✅ |
| Silv Chevron (Skinny) | 1,024 | $12,518 | ✅ |
| Chevron Stacker | 700 | $20,114 | ❌ placeholder |
| Chevron | 430 | $8,374 | ❌ placeholder |
| Chevron (Skinny Silver) | 355 | $3,598 | ✅ |
| Chevron (Skinny Gold Fill) | 253 | $3,901 | ✅ |
| Stacker (Single Chevron) *(current)* | 30 | $591 | ✅ |
| Chevron (Regular Silver) | 20 | $280 | ✅ |
| Chevron (Skinny GF) | 19 | $327 | ✅ |
| Silver Chevron (Reg) ᶻ | 17 | $295 | ✅ |
| Chevron (Skinny Silv) | 9 | $113 | ✅ |
| Chevron (Regular Gold Fill) | 9 | $175 | ✅ |
| GF Chevron (Reg) | 6 | $131 | ✅ |
| Silv Chevron (Reg) | 5 | $88 | ✅ |

This is the range the first version of the file missed entirely.

### → Stacker (Double Chevron) — 495 units, $14,816

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Double Silver Chevron | 285 | $7,247 | ✅ |
| Double GF Chevron ᵘ | 185 | $6,550 | ✅ |
| Stacker (Double Chevron) *(current)* | 25 | $1,019 | ✅ |

Nearly all of it is recoverable **with sizes** — see the curve above. The
current listing is only 5% of the design's history.

### → Stacker (Hexagon) — 547 units, $6,942

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Gold Fill Hexagon Stacker | 153 | $2,182 | ✅ |
| Hexagon Stacker | 149 | $2,391 | ❌ placeholder |
| Silver Hexagon Stacker | 148 | $1,367 | ✅ |
| Hexagon | 86 | $827 | unverified |
| Stacker (Hexagon) *(current)* | 10 | $162 | ✅ |
| Silver Hexagon Stackwr | 1 | $13 | typo listing |

### → Stacker (Square) — 255 units, $3,531

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Square Stacker | 73 | $1,174 | ❌ blank |
| Square ᶻ | 53 | $534 | ✅ |
| Square (Regular Silver ) ᶻ | 36 | $514 | ✅ |
| Square (Skinny Gold Fill) ᶻ | 35 | $501 | ✅ |
| Square (Regular Gold Fill) ᶻ | 25 | $468 | ✅ |
| Square Skinny Silver | 23 | $218 | ✅ |
| Square Skinny | 5 | $48 | ✅ |
| Stacker (Square) *(current)* | 5 | $75 | ✅ |

The retired category nearly doubled this design — 80 of its 255 units were
sitting in `zStackable Rings (Discontinued)`, and almost all of them carry a
real size.

### → Stacker (Beaded) — 197 units, $4,057

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Beaded/Twisted Stacker ᵘ | 173 | $3,578 | ❌ placeholder |
| Stacker (Beaded) *(current)* | 24 | $479 | ✅ |

### Outside the production range

| Listing | Units | Net sales |
|---|---|---|
| Birthstone Stacker | 35 | $1,485 |
| three stackable 14k yellow gold rings linked | 1 | $488 |
| Double Chevron Ring | 1 | $250 |
| 16 gauge 14k RG Chevron Stacker Wedding Ring | 1 | $236 |
| 14k YG Chevron Stacker | 1 | $220 |
| 14k rose gold Chevron Stackable Ring | 1 | $125 |
| 14k Rose Gold Chevron Stackable Ring | 1 | $120 |
| Wide Silver Stacker set with a 4mm Pink Tourmaline | 1 | $110 |
| Double Chevron (Stone Set) | 1 | $74 |
| Rose Gold fill Chevron Stacker | 1 | $15 |

Birthstone Stacker is its own line. The rest are custom gold or stone-set
pieces, one of a kind, not part of the production range. One further
Uncategorized line — "Labor to melt gold and make spinner, stacker and toe
ring", $75 — is labour, not a piece, and is excluded entirely.

Also excluded, because they are a different line despite the shared word:
`Chevron Inlay Ring (Black Fire)`, `Chevron Inlay Ring (Cyan Blue)` and
`Chevron Ring w/ Black Opal Inlay` (1 unit each, $515 together) are inlay
rings; `Chevron Ear Cuff` (116), `Chevron Pendant` (25), `Hexagon Ring`
(168 across three categories) and `Simple Bands` (103) are separate designs
that happen to share a shape name.

A handful of units differ by one or two from a name-based count of the same
listing — those sales happened while the item sat in a different category.
The category figures are the ones used here.

---

## Reading this alongside the app

The Best Sellers **🎯 Focus** tab covers the trailing two years of *market
weekend* sales only. This file covers **all channels, all history**, which is
why its numbers are larger and not directly comparable.

Use the app for what to make next; use this for how the line has performed
over its life, and for the size curves.

**The listing map above is live code.** `BS_ALIAS_NAMES` in
`js/bestsellers.js` carries all 49 names, because the Stacker card had the
same failure this file did: a deleted listing has no catalog entry, so the
category ids are gone and its own name is all that is left — and "Chevron",
"Square" and "Hexagon" match nothing, while "Stackable Ring" matched
`\bring\b` and landed on the Ring card with 1,265 units in tow. Family
routing reads the alias-merged name for exactly that reason. **If a stacker
listing is ever renamed again, add it to both.**
