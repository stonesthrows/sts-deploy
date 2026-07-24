// ════════════════════════════════════════════
//  ESTIMATE-CALC SUITE  —  tests/estimate-calc.js
//  Pure unit tests for js/estimate-calc.js (the DOM-free estimate math:
//  metal weight → cost, resize cost, stone-setting, chain). No browser or
//  server needed — just requires the module and checks numbers. Wired into
//  run.js alongside the fingerprint/offline suites.
//
//  Usage:
//    node estimate-calc.js     — run standalone
//    (also run as part of `node run.js`)
// ════════════════════════════════════════════
const path = require('path');
const EC = require(path.join(__dirname, '..', 'js', 'estimate-calc.js'));

// Cross-check against the ring blank chart in js/ring-fields.js so the
// geometry tests use the same inside-diameter/gauge numbers the app does.
// ring-fields.js is browser-oriented (attaches DOM listeners at load), so we
// don't require it here; instead we reproduce the two constants we need for
// an end-to-end "size 7, 18ga" sanity check.
const RING_ID_MM_SIZE7 = 17.3;   // RING_SIZE_ID_MM[7]
const GAUGE_MM_18      = 1.024;  // RING_GAUGE_MM[18]

function approx(a, b, tol) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= (tol == null ? 1e-6 : tol);
}

async function run() {
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ ok: !!ok, line: (ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  — ' + detail : '') });
  };

  // ── density lookup / normalization ──
  check('metalDensity argentium', approx(EC.metalDensity('argentium'), 10.4));
  check('metalDensity 14k', approx(EC.metalDensity('14k'), 13.07));
  check('metalDensity "14k yellow gold" fuzzy', approx(EC.metalDensity('14k yellow gold'), 13.07));
  check('metalDensity gold_fill', approx(EC.metalDensity('gold_fill'), 8.7));
  check('metalDensity unknown → default', approx(EC.metalDensity('unobtanium'), EC.METAL_DENSITY._default));

  // ── ozt conversion ──
  check('gramsToOzt', approx(EC.gramsToOzt(31.1035), 1, 1e-9));
  check('oztToGrams', approx(EC.oztToGrams(2), 62.207, 1e-3));

  // ── flat blank volume: L×W×T ──
  // 60mm long × 4mm wide × 1.024mm thick = 245.76 mm³
  const volFlat = EC.blankVolumeMm3({ lengthMm: 60, widthMm: 4, thicknessMm: GAUGE_MM_18, profile: 'Flat' });
  check('blankVolumeMm3 flat', approx(volFlat, 60 * 4 * GAUGE_MM_18, 1e-6), String(volFlat));

  // ── round wire volume: L×π·r² (width ignored) ──
  const volRound = EC.blankVolumeMm3({ lengthMm: 60, widthMm: 999, thicknessMm: 2, profile: 'Round' });
  check('blankVolumeMm3 round ignores width', approx(volRound, 60 * Math.PI * 1 * 1, 1e-6), String(volRound));

  // ── flat needs a width; round needs only thickness ──
  check('blankVolumeMm3 flat w/o width → null', EC.blankVolumeMm3({ lengthMm: 60, thicknessMm: 1, profile: 'Flat' }) === null);
  check('blankVolumeMm3 zero length → null', EC.blankVolumeMm3({ lengthMm: 0, widthMm: 4, thicknessMm: 1 }) === null);

  // ── weight from geometry ──
  // Size-7 14k flat band, 4mm wide, 18ga: blank length = π(ID+t)+allowance.
  const blankLen = Math.PI * (RING_ID_MM_SIZE7 + GAUGE_MM_18) + 1; // ~58.6mm (allowance 1mm)
  const w = EC.blankWeight({ lengthMm: blankLen, widthMm: 4, thicknessMm: GAUGE_MM_18, profile: 'Flat', metalType: '14k' });
  const expectVol = blankLen * 4 * GAUGE_MM_18;
  const expectG   = expectVol / 1000 * 13.07;
  check('blankWeight grams', approx(w.grams, expectG, 1e-6), String(w.grams));
  check('blankWeight ozt', approx(w.ozt, expectG / EC.G_PER_OZT, 1e-9), String(w.ozt));
  check('blankWeight grams is plausible ring weight (1–6g)', w.grams > 1 && w.grams < 6, String(w.grams));

  // ── metalCost: with and without a price on file ──
  const mc = EC.metalCost({ lengthMm: blankLen, widthMm: 4, thicknessMm: GAUGE_MM_18, profile: 'Flat', metalType: '14k', pricePerOzt: 2400 });
  check('metalCost hasPrice true', mc.hasPrice === true);
  check('metalCost cost = ozt × price', approx(mc.cost, mc.ozt * 2400, 1e-6), String(mc.cost));
  const mcNoPrice = EC.metalCost({ lengthMm: blankLen, widthMm: 4, thicknessMm: GAUGE_MM_18, profile: 'Flat', metalType: '14k', pricePerOzt: null });
  check('metalCost no price → hasPrice false, cost null, ozt still computed',
    mcNoPrice.hasPrice === false && mcNoPrice.cost === null && mcNoPrice.ozt > 0);

  // ── scrap padding raises weight & cost ──
  const mcScrap = EC.metalCost({ lengthMm: blankLen, widthMm: 4, thicknessMm: GAUGE_MM_18, profile: 'Flat', metalType: '14k', pricePerOzt: 2400, scrapPct: 10 });
  check('metalCost scrapPct pads ~10%', approx(mcScrap.ozt, mc.ozt * 1.1, 1e-6), String(mcScrap.ozt));

  // ── resize: sizing up adds metal + labor; down is labor only ──
  const startBlank = Math.PI * (17.3 + GAUGE_MM_18) + 1; // size 7
  const upBlank    = Math.PI * (18.2 + GAUGE_MM_18) + 1; // size 8 (ID 18.2)
  const up = EC.resizeCost({ startBlankMm: startBlank, targetBlankMm: upBlank, widthMm: 4, thicknessMm: GAUGE_MM_18, profile: 'Flat', metalType: '14k', pricePerOzt: 2400, laborBase: 40, laborPerSize: 10, sizeSteps: 1 });
  check('resize up direction', up.direction === 'up');
  check('resize up adds metal cost', up.metalCost > 0);
  check('resize up labor = base + perSize×steps', approx(up.labor, 50));
  check('resize up total = metal + labor', approx(up.total, up.metalCost + up.labor, 1e-9));

  const down = EC.resizeCost({ startBlankMm: upBlank, targetBlankMm: startBlank, widthMm: 4, thicknessMm: GAUGE_MM_18, profile: 'Flat', metalType: '14k', pricePerOzt: 2400, laborBase: 40, laborPerSize: 10, sizeSteps: 1 });
  check('resize down direction', down.direction === 'down');
  check('resize down no metal cost (removed metal is scrap)', down.metalCost === 0);
  check('resize down total = labor only', approx(down.total, down.labor, 1e-9));

  // ── stone setting ──
  const ss = EC.stoneSettingCost([{ setting: 'Bezel', count: 1 }, { setting: 'Prong ×4', count: 2 }]);
  check('stoneSetting total = 45 + 2×35', approx(ss.total, 45 + 70));
  check('stoneSetting unknown setting → default rate', approx(EC.stoneSettingRate('Mystery'), EC.STONE_SET_RATES._default));
  check('stoneSetting override rate', approx(EC.stoneSettingRate('Bezel', { Bezel: 99, _default: 10 }), 99));

  // ── chain ──
  const ch = EC.chainCost({ lengthIn: 18, pricePerIn: 2.5, findings: 6 });
  check('chain total = 18×2.5 + 6', approx(ch.total, 45 + 6));
  const chNoPrice = EC.chainCost({ lengthIn: 18, pricePerIn: null, findings: 6 });
  check('chain no price → findings only, hasPrice false', chNoPrice.hasPrice === false && approx(chNoPrice.total, 6));

  // ── labor by time ──
  const lc = EC.laborCost({ hours: 2.5, rate: 60 });
  check('laborCost = hours × rate', approx(lc.cost, 150) && lc.hasRate === true);
  const lcNoRate = EC.laborCost({ hours: 2, rate: 0 });
  check('laborCost no rate → hasRate false, cost null', lcNoRate.hasRate === false && lcNoRate.cost === null);

  return { pass: results.every(r => r.ok), lines: results.map(r => r.line) };
}

module.exports = { run };

// Allow standalone `node estimate-calc.js`
if (require.main === module) {
  run().then(r => {
    console.log(r.lines.join('\n'));
    console.log(r.pass ? '\nestimate-calc: ALL PASS' : '\nestimate-calc: FAILURES');
    process.exit(r.pass ? 0 : 1);
  });
}
