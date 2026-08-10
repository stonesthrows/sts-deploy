# Stacker sales history (recovered)

Consolidated record of every stacker sale from **January 2019 to 10 August
2026**, normalised across the 49 catalog listings the line has been sold
under.

> **Corrected 10 Aug 2026.** The first version of this file understated the
> history by 3,872 units and $62,452 — it found listings by searching item
> names for "stacker", and the entire chevron range is named without it
> (`GF Chevron (Skinny)`, `Double Silver Chevron`, `Chevron`). It reported
> Double Chevron as 25 units when the real figure is 492, and Single Chevron
> as 730 against 3,994. This version selects by **category** instead, which
> is what should have been done first.

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
`category_name = "Stackable Rings"` and grouped by `item_name` +
`item_variation_name`. That report keys off what was recorded on each order,
so it still sees deleted listings.

**Select by category, never by name.** Names are the one thing that changed
every time the line was reorganised; the category is what stayed put. A name
filter silently drops whole ranges, which is exactly how the first version
of this file went wrong.

---

## Totals

**12,669 units · $196,292**, across 49 listing names.

| Current design | Units | Net sales | Sold under |
|---|---|---|---|
| Stacker (Regular) | 7,265 | $98,324 | 16 names |
| Stacker (Single Chevron) | 3,994 | $69,891 | 14 names |
| Stacker (Hexagon) | 547 | $6,942 | 6 names |
| **Stacker (Double Chevron)** | **492** | **$14,711** | 3 names |
| Stacker (Beaded) | 196 | $4,038 | 2 names |
| Stacker (Square) | 175 | $2,386 | 8 names |

Outside the category, and not in the totals above: **Birthstone Stacker**
(35 units, $1,485) and seven custom gold one-offs ($901).

The Regular stacker is 57% of units; Regular and Single Chevron together are
89%.

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

**3,896 units have no usable size** — recorded against a placeholder
variation, whatever sat first in the list:

| Listing | Variation recorded | Units | Net sales |
|---|---|---|---|
| Stackable Ring | `2` | 1,265 | $15,663 |
| Stacker | `2` | 1,107 | $17,808 |
| Chevron Stacker | `Regular` | 700 | $20,114 |
| Chevron | `Regular` | 430 | $8,374 |
| Beaded/Twisted Stacker | `Regular` | 172 | $3,560 |
| Hexagon Stacker | `Size 2` | 149 | $2,391 |
| Square Stacker | *(blank)* | 73 | $1,174 |

2,372 units rung up as "size 2" is not a real distribution — size 2 is a
child's ring. These sold across the full range; the till recorded the default
variation each time.

**Their units and revenue are sound.** Only the size breakdown is unusable,
so they are in the totals and out of the curves.

The same pattern shows in current data — Circle Ring 37 of 38 sales on Size
5, Spiral Rings 82 of 100 on Silver-5 — which suggests it is still happening
at checkout rather than being purely historical. If so, per-size stock counts
drift out of true over time: the tapped size depletes on paper while the size
that actually left the table does not.

---

## Full listing map

All 49 listings in the Stackable Rings category, by current design.

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

### → Stacker (Single Chevron) — 3,994 units, $69,891

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
| Silver Chevron (Reg) | 15 | $262 | ✅ |
| Chevron (Skinny Silv) | 9 | $113 | ✅ |
| Chevron (Regular Gold Fill) | 9 | $175 | ✅ |
| GF Chevron (Reg) | 6 | $131 | ✅ |
| Silv Chevron (Reg) | 5 | $88 | ✅ |

This is the range the first version of the file missed entirely.

### → Stacker (Double Chevron) — 492 units, $14,711

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Double Silver Chevron | 285 | $7,247 | ✅ |
| Double GF Chevron | 182 | $6,445 | ✅ |
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

### → Stacker (Square) — 175 units, $2,386

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Square Stacker | 73 | $1,174 | ❌ blank |
| Square | 34 | $350 | unverified |
| Square Skinny Silver | 23 | $218 | ✅ |
| Square (Skinny Gold Fill) | 22 | $316 | ✅ |
| Square (Regular Silver ) | 9 | $125 | ✅ |
| Square Skinny | 5 | $48 | ✅ |
| Square (Regular Gold Fill) | 4 | $80 | ✅ |
| Stacker (Square) *(current)* | 5 | $75 | ✅ |

### → Stacker (Beaded) — 196 units, $4,038

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Beaded/Twisted Stacker | 172 | $3,560 | ❌ placeholder |
| Stacker (Beaded) *(current)* | 24 | $479 | ✅ |

### Outside the category

| Listing | Units | Net sales |
|---|---|---|
| Birthstone Stacker | 35 | $1,485 |
| 16 gauge 14k RG Chevron Stacker Wedding Ring | 1 | $236 |
| 14k YG Chevron Stacker | 1 | $220 |
| 14k rose gold Chevron Stackable Ring | 1 | $125 |
| 14k Rose Gold Chevron Stackable Ring | 1 | $120 |
| Wide Silver Stacker set with 4mm Pink Tourmaline | 1 | $110 |
| Rose Gold fill Chevron Stacker | 1 | $15 |

Birthstone Stacker is its own line. The rest are custom gold pieces, not part
of the production range.

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
