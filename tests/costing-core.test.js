// ════════════════════════════════════════════
//  TESTS  —  tests/costing-core.test.js
//  Covers the pure money math in js/costing-core.js (the costing/
//  inventory build, Phases 2–6). Zero dependencies — run from the repo
//  root with:
//      node --test
//  The tests pin down the behaviors the app relies on, including the
//  deliberate edge cases (missing prices, unweighed designs, untracked
//  Square counts), so future refactors can't silently change a number.
// ════════════════════════════════════════════
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/costing-core.js');

// Float-safe equality for money/quantity math
function approx(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-9,
    (msg ? msg + ' — ' : '') + `expected ${expected}, got ${actual}`);
}

// ── Shared fixtures ───────────────────────────
const SETTINGS = {
  wasteDefaultPct: 5,
  wastePctByMetal: { sterling: 8, gold_fill: 12 },
  shopHourlyRate: 30,
  targetMarginPct: 60,
  marginFloorPct: 50,
};

const SILVER = { notionPageId: 'm-silver', name: 'Sterling wire', unit: 'gram',
  category: 'metal', metalType: 'sterling', currentCostPerUnit: 1.10,
  stockLevel: '100', supplierDefault: 'Rio Grande' };
const GF = { notionPageId: 'm-gf', name: 'Gold-fill wire', unit: 'gram',
  category: 'metal', metalType: 'gold_fill', currentCostPerUnit: 4,
  stockLevel: 20, supplierDefault: 'Rio Grande' };
const STONE = { notionPageId: 'm-stone', name: 'Moonstone 6mm', unit: 'piece',
  category: 'component', currentCostPerUnit: 2.5,
  stockLevel: 8, supplierDefault: 'Fire Mountain' };
const CLASP = { notionPageId: 'm-clasp', name: 'Clasp', unit: 'piece',
  category: 'component', currentCostPerUnit: null, stockLevel: 50 };

const MATERIALS = [SILVER, GF, STONE, CLASP];

// ── round2 ────────────────────────────────────
test('round2 rounds to cents', () => {
  assert.equal(C.round2(6.4800000001), 6.48);
  assert.equal(C.round2(1.239), 1.24);
  assert.equal(C.round2(-1.239), -1.24);
  assert.equal(C.round2(0), 0);
});

// ── wastePctResolve (spec §5 priority chain) ──
test('wastePctResolve: design override wins, including an explicit 0', () => {
  assert.equal(C.wastePctResolve(SILVER, 10, SETTINGS), 10);
  assert.equal(C.wastePctResolve(SILVER, 0, SETTINGS), 0);
});

test('wastePctResolve: NaN/null override falls through to metal-type default', () => {
  assert.equal(C.wastePctResolve(SILVER, NaN, SETTINGS), 8);
  assert.equal(C.wastePctResolve(SILVER, null, SETTINGS), 8);
  assert.equal(C.wastePctResolve(GF, null, SETTINGS), 12);
});

test('wastePctResolve: unknown metal type falls to shop default, then 0', () => {
  const brass = { category: 'metal', metalType: 'brass' };
  assert.equal(C.wastePctResolve(brass, null, SETTINGS), 5);
  assert.equal(C.wastePctResolve(brass, null, {}), 0);
  assert.equal(C.wastePctResolve(brass, null, null), 0);
});

// ── bomLinePerPiece ───────────────────────────
test('bomLinePerPiece: metal lines carry waste, components never do', () => {
  const d = { wasteOverridePct: null };
  approx(C.bomLinePerPiece(d, { qty: 2 }, SILVER, SETTINGS), 2.16); // +8%
  approx(C.bomLinePerPiece(d, { qty: 3 }, STONE, SETTINGS), 3);     // no waste
});

test('bomLinePerPiece: design waste override applies to metals', () => {
  const d = { wasteOverridePct: 50 };
  approx(C.bomLinePerPiece(d, { qty: 2 }, SILVER, SETTINGS), 3);
  approx(C.bomLinePerPiece(d, { qty: 2 }, STONE, SETTINGS), 2); // still exempt
});

// ── aggregateLaborSessions ────────────────────
test('labor: session time splits across items proportionally to pieces', () => {
  const agg = C.aggregateLaborSessions([{
    netMin: 60,
    itemsJson: JSON.stringify([
      { name: 'Ring', squareId: 'sq-1', pieces: 3 },
      { name: 'Cuff', squareId: '', pieces: 1 },
    ]),
  }]);
  approx(agg['sq-1'].hrs, 0.75);
  assert.equal(agg['sq-1'].pcs, 3);
  approx(agg['sq-1'].minPerPc, 15);
  approx(agg['custom:Cuff'].hrs, 0.25);
  approx(agg['custom:Cuff'].minPerPc, 15);
});

test('labor: bad itemsJson falls back to the core item fields', () => {
  const agg = C.aggregateLaborSessions([
    { netMin: 30, itemsJson: '{not json', itemName: 'Ring', squareItemId: 'sq-1', pieces: 2 },
  ]);
  approx(agg['sq-1'].minPerPc, 15);
  assert.equal(agg['sq-1'].pcs, 2);
});

test('labor: aggregates the same key across sessions', () => {
  const agg = C.aggregateLaborSessions([
    { netMin: 60, itemName: 'Ring', squareItemId: 'sq-1', pieces: 3 },
    { netMin: 30, itemName: 'Ring', squareItemId: 'sq-1', pieces: 3 },
  ]);
  assert.equal(agg['sq-1'].pcs, 6);
  approx(agg['sq-1'].minPerPc, 15); // (1h + 0.5h) * 60 / 6
});

test('labor: skips sessions without netMin or without positive pieces', () => {
  const agg = C.aggregateLaborSessions([
    { netMin: null, itemName: 'Ring', squareItemId: 'sq-1', pieces: 5 },
    { netMin: 60, itemName: 'Ring', squareItemId: 'sq-1', pieces: 0 },
    { netMin: 60 }, // no items at all
  ]);
  assert.deepEqual(agg, {});
});

test('labor: custom items key by name even when a squareId is present', () => {
  const agg = C.aggregateLaborSessions([{
    netMin: 60,
    itemsJson: JSON.stringify([{ name: 'One-off', squareId: 'sq-9', pieces: 2, isCustom: true }]),
  }]);
  assert.ok(agg['custom:One-off']);
  assert.equal(agg['sq-9'], undefined);
});

test('labor: non-array input returns an empty aggregate', () => {
  assert.deepEqual(C.aggregateLaborSessions(null), {});
  assert.deepEqual(C.aggregateLaborSessions({ error: 'boom' }), {});
});

// ── costRollup (spec §6) ──────────────────────
const ROLLUP_CTX = {
  materials: MATERIALS,
  shopSettings: SETTINGS,
  laborByKey: { 'sq-1': { hrs: 1, pcs: 4, minPerPc: 15 } },
  sqPrices: { 'sq-1': 30 },
};

test('costRollup: materials incl. waste + tracked labor + Square retail', () => {
  const r = C.costRollup({
    bom: [{ materialId: 'm-silver', qty: 2 }, { materialId: 'm-stone', qty: 1 }],
    wasteOverridePct: null,
    squareItemId: 'sq-1',
    retailPriceOverride: null,
    laborMinPerPieceOverride: null,
  }, ROLLUP_CTX);

  assert.equal(r.hasBom, true);
  assert.equal(r.matMissing, false);
  approx(r.matCost, 2 * 1.08 * 1.10 + 2.5);          // 4.876
  assert.equal(r.laborSource, 'tracked');
  approx(r.laborCost, (15 / 60) * 30);                // 7.50
  approx(r.pieceCost, 4.876 + 7.5);                   // 12.376
  assert.equal(r.retailSource, 'square');
  assert.equal(r.retail, 30);
  approx(r.margin, (30 - 12.376) / 30);
  approx(r.suggested, 12.376 / (1 - 0.60));           // 30.94
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[0].wastePct, 8);
  assert.equal(r.lines[1].wastePct, null);            // component
});

test('costRollup: missing material price flags matMissing, keeps partial total', () => {
  const r = C.costRollup({
    bom: [{ materialId: 'm-stone', qty: 1 }, { materialId: 'm-clasp', qty: 1 }],
  }, ROLLUP_CTX);
  assert.equal(r.matMissing, true);
  approx(r.matCost, 2.5);
  assert.equal(r.lines[1].cost, null);
});

test('costRollup: unknown material id flags matMissing and emits no line', () => {
  const r = C.costRollup({ bom: [{ materialId: 'm-nope', qty: 1 }] }, ROLLUP_CTX);
  assert.equal(r.matMissing, true);
  assert.equal(r.lines.length, 0);
  approx(r.pieceCost, 0); // hasBom → cost is defined, just incomplete
});

test('costRollup: manual overrides beat tracked labor and Square retail', () => {
  const r = C.costRollup({
    bom: [{ materialId: 'm-stone', qty: 1 }],
    squareItemId: 'sq-1',
    retailPriceOverride: 50,
    laborMinPerPieceOverride: 20,
  }, ROLLUP_CTX);
  assert.equal(r.laborSource, 'override');
  approx(r.laborCost, 10);        // 20 min @ $30/h
  assert.equal(r.retailSource, 'override');
  assert.equal(r.retail, 50);
});

test('costRollup: no BOM and no labor → cost/margin stay null', () => {
  const r = C.costRollup({ bom: [] }, { materials: MATERIALS, shopSettings: SETTINGS });
  assert.equal(r.pieceCost, null);
  assert.equal(r.margin, null);
  assert.equal(r.suggested, null);
});

test('costRollup: no hourly rate → labor cost null even with tracked time', () => {
  const r = C.costRollup(
    { bom: [{ materialId: 'm-stone', qty: 1 }], squareItemId: 'sq-1' },
    { ...ROLLUP_CTX, shopSettings: { ...SETTINGS, shopHourlyRate: null } }
  );
  assert.equal(r.laborCost, null);
  assert.equal(r.laborMin, 15); // the minutes are still reported
});

test('costRollup: retail of 0 and targets ≥100% never divide by zero', () => {
  const zeroRetail = C.costRollup(
    { bom: [{ materialId: 'm-stone', qty: 1 }], retailPriceOverride: 0 }, ROLLUP_CTX);
  assert.equal(zeroRetail.margin, null);

  const target100 = C.costRollup(
    { bom: [{ materialId: 'm-stone', qty: 1 }] },
    { ...ROLLUP_CTX, shopSettings: { ...SETTINGS, targetMarginPct: 100 } });
  assert.equal(target100.suggested, null);
});

// ── closeoutTotals (Phase 5) ──────────────────
const CO_DESIGNS = [
  { id: 'd1', squareItemId: 'sq-1', wasteOverridePct: null,
    bom: [{ materialId: 'm-silver', qty: 2 }, { materialId: 'm-stone', qty: 1 }] },
  { id: 'd2', squareItemId: 'sq-2', bom: [] }, // linked but not weighed
];

test('closeout: consumption = per-piece incl. waste × pieces, rounded to 2dp', () => {
  const r = C.closeoutTotals(
    { items: [{ name: 'Ring', squareId: 'sq-1', pieces: 3 }] },
    CO_DESIGNS, MATERIALS, SETTINGS);
  assert.equal(r.rows.length, 2);
  const silver = r.rows.find(x => x.materialId === 'm-silver');
  const stone  = r.rows.find(x => x.materialId === 'm-stone');
  assert.equal(silver.qty, 6.48);  // 2g × 1.08 waste × 3 pcs
  assert.equal(silver.unit, 'g');
  assert.equal(stone.qty, 3);      // components: no waste
  assert.equal(stone.unit, 'pc');
  assert.deepEqual(r.unweighed, []);
});

test('closeout: rounding happens once, on the final total', () => {
  const designs = [{ id: 'd', squareItemId: 'sq-1',
    bom: [{ materialId: 'm-silver', qty: 0.333 }] }];
  const r = C.closeoutTotals(
    { items: [{ name: 'Ring', squareId: 'sq-1', pieces: 3 }] },
    designs, MATERIALS, SETTINGS);
  assert.equal(r.rows[0].qty, 1.08); // 0.333 × 1.08 × 3 = 1.07892 → 1.08
});

test('closeout: no-BOM and unknown items land in unweighed; zero pieces skipped', () => {
  const r = C.closeoutTotals({ items: [
    { name: 'Ring', squareId: 'sq-1', pieces: 1 },
    { name: 'Mystery', squareId: 'sq-9', pieces: 1 },   // no design for id
    { name: 'NoBom', squareId: 'sq-2', pieces: 2 },     // design has empty BOM
    { name: 'Unlinked', pieces: 1 },                    // no squareId at all
    { name: 'Zero', squareId: 'sq-1', pieces: 0 },      // nothing made
  ] }, CO_DESIGNS, MATERIALS, SETTINGS);
  assert.deepEqual(r.unweighed, ['Mystery', 'NoBom', 'Unlinked']);
  const silver = r.rows.find(x => x.materialId === 'm-silver');
  assert.equal(silver.qty, 2.16); // only the 1 real Ring counted
});

test('closeout: totals accumulate across items sharing a material', () => {
  const designs = [
    { id: 'd1', squareItemId: 'sq-1', bom: [{ materialId: 'm-stone', qty: 1 }] },
    { id: 'd2', squareItemId: 'sq-2', bom: [{ materialId: 'm-stone', qty: 2 }] },
  ];
  const r = C.closeoutTotals({ items: [
    { name: 'A', squareId: 'sq-1', pieces: 2 },
    { name: 'B', squareId: 'sq-2', pieces: 3 },
  ] }, designs, MATERIALS, SETTINGS);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].qty, 8); // 1×2 + 2×3
});

// ── replenishQueue (Phase 6) ──────────────────
test('replenish: filters, deficit/batch, buildable and shorts', () => {
  const designs = [
    { id: 'dA', name: 'A', squareItemId: 'sq-A', parLevel: 10,
      bom: [{ materialId: 'm-silver', qty: 2 }] },
    { id: 'dB', name: 'B', squareItemId: 'sq-B', parLevel: 5, suggestedBatchSize: 10,
      bom: [{ materialId: 'm-gf', qty: 3 }] },
    { id: 'dC', name: 'C', squareItemId: 'sq-C', parLevel: 9, replenishmentActive: false },
    { id: 'dD', name: 'D', squareItemId: 'sq-D' },              // no par → skipped
    { id: 'dE', name: 'E', squareItemId: 'sq-E', parLevel: 5 }, // above par → skipped
    { id: 'dF', name: 'F', squareItemId: 'sq-F', parLevel: 3 }, // exactly at par
    { id: 'dG', name: 'G', squareItemId: 'sq-G', parLevel: 3 }, // no BOM
  ];
  const onHand = { 'sq-A': 4, 'sq-E': 6, 'sq-F': 3 }; // sq-B/sq-G untracked → 0

  const rows = C.replenishQueue(designs, MATERIALS, onHand, SETTINGS);

  // Worst deficit first; inactive/parless/above-par excluded
  assert.deepEqual(rows.map(r => r.d.id), ['dA', 'dB', 'dG', 'dF']);

  const a = rows[0];
  assert.equal(a.deficit, 6);
  assert.equal(a.batch, 6);              // no suggested size → deficit
  assert.equal(a.buildable, 46);         // floor(100 / 2.16)
  assert.deepEqual(a.shorts, []);        // 12.96g needed of 100g on hand

  const b = rows[1];
  assert.equal(b.onHand, 0);             // untracked in Square = out
  assert.equal(b.deficit, 5);
  assert.equal(b.batch, 10);             // explicit suggested size wins
  assert.equal(b.buildable, 5);          // floor(20 / 3.36)
  assert.equal(b.shorts.length, 1);
  approx(b.shorts[0].need, 33.6);        // 3g × 1.12 × 10
  approx(b.shorts[0].short, 13.6);
  approx(b.shorts[0].perPiece, 3.36);

  const f = rows[3];
  assert.equal(f.deficit, 0);            // at par is included
  assert.equal(f.batch, 1);              // max(deficit, 1)

  const g = rows[2];
  assert.equal(g.buildable, null);       // no BOM → unknown
  assert.deepEqual(g.shorts, []);
});

test('replenish: negative material stock clamps buildable to 0', () => {
  const designs = [{ id: 'd', name: 'D', squareItemId: 'sq-1', parLevel: 2,
    bom: [{ materialId: 'm-neg', qty: 1 }] }];
  const mats = [{ notionPageId: 'm-neg', name: 'Wire', unit: 'gram',
    category: 'metal', stockLevel: -4 }];
  const rows = C.replenishQueue(designs, mats, {}, {});
  assert.equal(rows[0].buildable, 0);
});

test('replenish: BOM line with unknown material is ignored, not a crash', () => {
  const designs = [{ id: 'd', name: 'D', squareItemId: 'sq-1', parLevel: 2,
    bom: [{ materialId: 'm-gone', qty: 1 }, { materialId: 'm-stone', qty: 2 }] }];
  const rows = C.replenishQueue(designs, MATERIALS, {}, SETTINGS);
  assert.equal(rows[0].buildable, 4); // floor(8 stone / 2) — m-gone skipped
});

// ── shoppingList ──────────────────────────────
test('shoppingList: sums shorts per material, groups by default supplier', () => {
  const rows = [
    { shorts: [{ m: SILVER, short: 5 }, { m: STONE, short: 2 }] },
    { shorts: [{ m: SILVER, short: 3 }] },
    { shorts: [] },
  ];
  const bySup = C.shoppingList(rows);
  assert.deepEqual(Object.keys(bySup).sort(), ['Fire Mountain', 'Rio Grande']);
  assert.equal(bySup['Rio Grande'].length, 1);
  approx(bySup['Rio Grande'][0].qty, 8);
  approx(bySup['Fire Mountain'][0].qty, 2);
});

test('shoppingList: material without a default supplier gets the fallback bucket', () => {
  const bySup = C.shoppingList([{ shorts: [{ m: CLASP, short: 10 }] }]);
  assert.ok(bySup['No default supplier']);
  assert.equal(C.shoppingList([]) && Object.keys(C.shoppingList([])).length, 0);
});

// ── deriveUnitCost / receiptTotal (Phase 2) ───
test('deriveUnitCost: divides and trims trailing zeros', () => {
  assert.equal(C.deriveUnitCost(25, 10), '2.5');
  assert.equal(C.deriveUnitCost(100, 8), '12.5');
  assert.equal(C.deriveUnitCost(10, 3), '3.3333');
  assert.equal(C.deriveUnitCost(120, 12), '10');
  assert.equal(C.deriveUnitCost(0.5, 4), '0.125');
});

test('deriveUnitCost: returns null when qty or total is unusable', () => {
  assert.equal(C.deriveUnitCost(5, 0), null);
  assert.equal(C.deriveUnitCost(5, -1), null);
  assert.equal(C.deriveUnitCost(NaN, 5), null);
  assert.equal(C.deriveUnitCost(null, 5), null);
  assert.equal(C.deriveUnitCost(5, NaN), null);
});

test('receiptTotal: complete lines plus extras; incomplete lines ignored', () => {
  const lines = [
    { qty: 2, unitCost: 1.5 },     // 3.00
    { qty: null, unitCost: 5 },    // no qty → ignored
    { qty: 3, unitCost: null },    // no cost → ignored
  ];
  const extras = [{ amt: 4.25 }, { amt: '2.75' }, { amt: null }];
  approx(C.receiptTotal(lines, extras), 10);
  approx(C.receiptTotal([], []), 0);
  approx(C.receiptTotal(null, null), 0);
});
