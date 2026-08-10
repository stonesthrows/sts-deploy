# Stacker sales history (recovered)

Consolidated record of every stacker sale from **January 2019 to 10 August
2026**, normalised across the 35 different catalog listings the line has been
sold under.

## Why this file exists

The stacker listings have been restructured several times — renamed, split by
metal and width, merged back, and older ones deleted. Deleting a listing
removes it from the Square catalog but **not** from the order history: every
order still records the item and variation name as they were at the time of
sale.

What is lost is the *link* between those sales and today's catalog. Square's
inventory reporting can only attribute a sale to a variation that still
exists, so roughly 3,900 units across the whole catalog now show against no
current variation. In the app this is why the Best Sellers focus cards cannot
judge per-variation performance for a rebuilt design, and why the dead-stock
flag stays silent for them.

This file captures the history in a form that no longer depends on the
catalog, so a future restructure cannot cost it again.

**Source:** Square Reporting API, `ProductMixReport`, grouped by
`item_name` + `item_variation_name`. That report keys off the names recorded
on each order, which is why it still sees deleted listings.

**Regenerating it:** re-run the same query with a later end date. Nothing here
is derived from the app's own weekend-sales store, so it is independent of
what has or hasn't been synced.

---

## Totals

**8,797 units · $133,840 net**, across 35 listing names.

| Current design | Units | Net sales | Sold under |
|---|---|---|---|
| Stacker (Regular) | 7,265 | $98,324 | 16 names |
| Stacker (Single Chevron) | 730 | $20,705 | 2 names |
| Stacker (Hexagon) | 460 | $6,102 | 4 names |
| Stacker (Beaded) | 197 | $4,056 | 2 names |
| Stacker (Square) | 78 | $1,249 | 2 names |
| Stacker (Double Chevron) | 25 | $1,019 | current only |
| Birthstone Stacker | 35 | $1,485 | separate line |
| Gold / custom one-offs | 7 | $901 | 6 names |

The Regular stacker is 83% of all stacker units and 73% of the revenue.

---

## The size curve

This is the part worth keeping. **4,771 units carry a real ring size**, from
the era when stackers were listed as `GF Stacker (Skinny)`,
`Silver Stacker (Reg)` and similar — one listing per metal and width, with
sizes as variations.

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

Grouped:

- **Core, 6 – 9.5:** 2,751 units — **58%** of everything
- **Small, 2 – 5.5:** 1,493 units — 31%
- **Large, 10 – 11.5:** 527 units — 11%

A single clean peak at **7 – 8**, tapering evenly both ways. This is a
believable distribution built on 4,771 real sales, and it is the best
available guide to how deep to stock each size.

The 31% in sizes 2–5.5 is higher than a typical ring-size curve, and sizes
2–4.5 alone account for 983 units (21%). Worth knowing whether those are
genuinely small fingers, or midi and toe rings being sold from the same
listings — it changes what that third of the curve is telling you.

---

## What could not be recovered

**3,467 units have no usable size.** They are recorded against a placeholder
variation — whatever sat first in the list:

| Listing | Variation recorded | Units | Net sales |
|---|---|---|---|
| Stackable Ring | `2` | 1,265 | $15,663 |
| Stacker | `2` | 1,107 | $17,808 |
| Chevron Stacker | `Regular` | 700 | $20,114 |
| Beaded/Twisted Stacker | `Regular` | 173 | $3,578 |
| Hexagon Stacker | `Size 2` | 149 | $2,391 |
| Square Stacker | *(blank)* | 73 | $1,174 |

2,372 units rung up as "size 2" is not a real size distribution — size 2 is a
child's ring. These were sold across the full size range; the till simply
recorded the default variation each time.

**Their units and revenue are sound.** Only the size breakdown is unusable, so
they are excluded from the size curve above and included in the totals.

The same pattern is visible in current data — Circle Ring shows 37 of 38
sales on Size 5, Spiral Rings 82 of 100 on Silver-5 — which suggests it is
still happening at checkout rather than being purely historical. If so, per-size
stock counts drift out of true over time: the tapped size depletes on paper
while the size that actually left the table does not.

---

## Full listing map

Every historical name, and the current design it belongs to.

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

Note the near-duplicate names — `Silver Stacker (Skinny)` / `Silv Stacker
(Skinny)`, `Stacker (Skinny GF)` / `Stacker (Skinny Gold Fill)`. Each pair is
the same product under a differently abbreviated listing.

### → Stacker (Single Chevron) — 730 units, $20,705

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Chevron Stacker | 700 | $20,114 | ❌ placeholder |
| Stacker (Single Chevron) *(current)* | 30 | $591 | ✅ |

### → Stacker (Hexagon) — 460 units, $6,102

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Gold Fill Hexagon Stacker | 153 | $2,182 | ✅ |
| Hexagon Stacker | 149 | $2,391 | ❌ placeholder |
| Silver Hexagon Stacker | 148 | $1,367 | ✅ |
| Stacker (Hexagon) *(current)* | 10 | $162 | ✅ |

### → Stacker (Beaded) — 197 units, $4,056

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Beaded/Twisted Stacker | 173 | $3,578 | ❌ placeholder |
| Stacker (Beaded) *(current)* | 24 | $479 | ✅ |

### → Stacker (Square) — 78 units, $1,249

| Listing | Units | Net sales | Sizes? |
|---|---|---|---|
| Square Stacker | 73 | $1,174 | ❌ blank |
| Stacker (Square) *(current)* | 5 | $75 | ✅ |

### → Stacker (Double Chevron) — 25 units, $1,019

Only ever sold under its current name.

### Separate lines

| Listing | Units | Net sales |
|---|---|---|
| Birthstone Stacker | 35 | $1,485 |
| 16 gauge 14k RG Chevron Stacker Wedding Ring | 1 | $236 |
| 14k YG Chevron Stacker | 1 | $220 |
| 14k rose gold Chevron Stackable Ring | 1 | $125 |
| 14k Rose Gold Chevron Stackable Ring | 1 | $120 |
| Wide Silver Stacker set with 4mm Pink Tourmaline | 1 | $110 |
| Rose Gold fill Chevron Stacker | 1 | $15 |

Birthstone Stacker is its own line rather than a stacker variant. The rest
are custom gold pieces, listed for completeness — they are not part of the
production stacker range.

*Excluded: "Labor to melt gold and make spinner, stacker and toe ring"
($75) — a service line, not a piece.*

---

## Reading this alongside the app

The Best Sellers **🎯 Focus** tab covers the trailing two years of *market
weekend* sales only. This file covers **all channels, all history**, which is
why its numbers are larger and not directly comparable.

Use the app for what to make next; use this for how the line has performed
over its life, and for the size curve.
