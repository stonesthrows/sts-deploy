// ════════════════════════════════════════════
//  ESTIMATE CALCULATORS — pure math module
//
//  DOM-free, dependency-free estimate helpers shared by the desktop Edit
//  Order modal (js/order-widgets.js) and the intake wizard (js/intake.js).
//  Everything here takes plain numbers/objects and returns plain objects so
//  it can be unit-tested under Node (see tests/estimate-calc.js) without a
//  browser — the UI wiring in order-widgets.js is what reads the DOM, calls
//  these, and pushes results into the Estimate Builder via addMaterialRow().
//
//  Units: lengths in mm, weights carried internally in grams and reported in
//  Troy ounces (ozt — the shop standard, same as js/designs.js), money in USD.
//  Ring size → inside diameter and gauge → thickness live in js/ring-fields.js
//  (RING_SIZE_ID_MM / RING_GAUGE_MM, ringBlankLengthMm) — the single source
//  for those charts; this module deliberately takes the already-resolved mm
//  values so the geometry/pricing math can be tested on its own.
// ════════════════════════════════════════════
(function (root) {
  'use strict';

  // Grams per Troy ounce — matches js/designs.js's _DSN_G_PER_OZT so a weight
  // computed here reconciles with the BOM/designs side of the app.
  const G_PER_OZT = 31.1035;

  // Metal density (g/cm³). Keyed on the Materials Library `metalType` vocab
  // (argentium / gold_fill / 14k today) plus a few common extras so the calc
  // still works if the library gains 18k, sterling, etc. The Materials Library
  // stores price but NOT density (confirmed — no density field in its schema),
  // so this table is the source until a Notion `density` property is added.
  // Values are standard jewelry references:
  //   argentium/sterling silver ≈ 10.4, fine silver 10.49, gold-filled ≈ 8.7
  //   (brass core dominates), 10k 11.57, 14k 13.07, 18k 15.58, 24k 19.32.
  const METAL_DENSITY = {
    argentium:  10.4,
    sterling:   10.36,
    silver:     10.36,
    fine_silver:10.49,
    gold_fill:  8.7,
    goldfill:   8.7,
    '10k':      11.57,
    '14k':      13.07,
    '18k':      15.58,
    '22k':      17.8,
    '24k':      19.32,
    gold:       13.07,   // unspecified karat → assume 14k
    brass:      8.5,
    bronze:     8.8,
    platinum:   21.45,
    _default:   10.4,    // fall back to silver-ish rather than throwing
  };

  // Normalizes a free-text / library metalType to a density key.
  function _metalKey(metalType) {
    if (metalType == null) return '_default';
    const k = String(metalType).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (METAL_DENSITY[k] != null) return k;
    // loose matches: "14k yellow gold" → 14k, "argentium silver" → argentium
    const m = k.match(/(\d+k)/);
    if (m && METAL_DENSITY[m[1]] != null) return m[1];
    if (k.indexOf('argentium') > -1) return 'argentium';
    if (k.indexOf('sterling') > -1) return 'sterling';
    if (k.indexOf('gold_fill') > -1 || k.indexOf('goldfill') > -1 || k.indexOf('filled') > -1) return 'gold_fill';
    if (k.indexOf('silver') > -1) return 'silver';
    if (k.indexOf('platinum') > -1) return 'platinum';
    if (k.indexOf('brass') > -1) return 'brass';
    if (k.indexOf('gold') > -1) return 'gold';
    return '_default';
  }

  function metalDensity(metalType) {
    return METAL_DENSITY[_metalKey(metalType)];
  }

  function gramsToOzt(g) {
    return (g == null || !isFinite(g)) ? null : g / G_PER_OZT;
  }
  function oztToGrams(ozt) {
    return (ozt == null || !isFinite(ozt)) ? null : ozt * G_PER_OZT;
  }

  // Cross-section volume of a straight blank, in mm³.
  //   Flat stock  → width × thickness (a rectangular bar). Thickness comes
  //                 from gauge; width is the band's face width.
  //   Round wire  → π·r² where the wire diameter IS the gauge thickness, so
  //                 width is ignored (a round wire has no separate width).
  // Returns null if the dimensions needed for the chosen profile are missing.
  function blankVolumeMm3(opts) {
    opts = opts || {};
    const lengthMm    = Number(opts.lengthMm);
    const thicknessMm = Number(opts.thicknessMm);
    const profile     = (opts.profile || 'Flat');
    if (!(lengthMm > 0) || !(thicknessMm > 0)) return null;
    if (String(profile).toLowerCase() === 'round') {
      const r = thicknessMm / 2;
      return lengthMm * Math.PI * r * r;
    }
    const widthMm = Number(opts.widthMm);
    if (!(widthMm > 0)) return null;   // flat stock needs a width
    return lengthMm * widthMm * thicknessMm;
  }

  // Weight of a blank in grams / ozt from its geometry + metal.
  function blankWeight(opts) {
    const vol = blankVolumeMm3(opts);
    if (vol == null) return { volumeMm3: null, grams: null, ozt: null };
    const cm3 = vol / 1000;                       // mm³ → cm³
    const grams = cm3 * metalDensity(opts && opts.metalType);
    return { volumeMm3: vol, grams: grams, ozt: gramsToOzt(grams) };
  }

  // ── Metal weight → cost (the headline "connect the dots" calc) ──
  // Turns a ring/piece blank into a priced material line. `pricePerOzt` is
  // resolved by the caller from the Materials Library (currentCostPerUnit or
  // the shop metalPricePerOzt map) — pass null when no price is on file and
  // `cost`/`hasPrice` will reflect that so the UI can prompt for manual entry.
  // `scrapPct` (optional) pads the weight for sprue/filing loss.
  function metalCost(opts) {
    opts = opts || {};
    const w = blankWeight(opts);
    const scrapPct = Number(opts.scrapPct) || 0;
    const ozt = (w.ozt == null) ? null : w.ozt * (1 + scrapPct / 100);
    const grams = (w.grams == null) ? null : w.grams * (1 + scrapPct / 100);
    const pricePerOzt = Number(opts.pricePerOzt);
    const hasPrice = isFinite(pricePerOzt) && pricePerOzt > 0;
    const cost = (ozt != null && hasPrice) ? ozt * pricePerOzt : null;
    return {
      volumeMm3: w.volumeMm3,
      grams: grams,
      ozt: ozt,
      pricePerOzt: hasPrice ? pricePerOzt : null,
      hasPrice: hasPrice,
      cost: cost,
    };
  }

  // ── Resize cost ──
  // Given the ring's blank length at the CURRENT size and the TARGET size
  // (both computed by the caller with ringBlankLengthMm), figure the metal
  // added/removed and a labor charge. Sizing UP adds metal (material cost +
  // labor); sizing DOWN removes metal (labor only — the cut-out is scrap, no
  // credit assumed). `laborBase` is a flat shop charge; `laborPerSize` adds
  // per full size of change. Pass `sizeSteps` = |target − start| in ring sizes.
  function resizeCost(opts) {
    opts = opts || {};
    const startBlankMm  = Number(opts.startBlankMm);
    const targetBlankMm = Number(opts.targetBlankMm);
    if (!isFinite(startBlankMm) || !isFinite(targetBlankMm)) return null;
    const deltaMm = targetBlankMm - startBlankMm;
    const direction = deltaMm >= 0 ? 'up' : 'down';
    const w = blankWeight({
      lengthMm: Math.abs(deltaMm),
      widthMm: opts.widthMm,
      thicknessMm: opts.thicknessMm,
      profile: opts.profile,
      metalType: opts.metalType,
    });
    const pricePerOzt = Number(opts.pricePerOzt);
    const hasPrice = isFinite(pricePerOzt) && pricePerOzt > 0;
    // Only sizing UP consumes new metal.
    const metalCostVal = (direction === 'up' && w.ozt != null && hasPrice) ? w.ozt * pricePerOzt : 0;
    const laborBase    = Number(opts.laborBase) || 0;
    const laborPerSize = Number(opts.laborPerSize) || 0;
    const sizeSteps    = Number(opts.sizeSteps) || 0;
    const labor = laborBase + laborPerSize * sizeSteps;
    return {
      direction: direction,
      deltaMm: deltaMm,
      grams: w.grams,
      ozt: w.ozt,
      hasPrice: hasPrice,
      metalCost: metalCostVal,
      labor: labor,
      total: metalCostVal + labor,
    };
  }

  // ── Stone-setting cost ──
  // A per-stone labor estimate by setting type, reusing the setting vocabulary
  // from the Estimate Order stone widget (EO_STONE_OPTS in js/orders.js). Rates
  // are shop defaults the caller can override via `ratesOverride`.
  const STONE_SET_RATES = {
    'Bezel':    45,
    'Prong ×4': 35,
    'Prong ×6': 45,
    'Flush':    30,
    'Channel':  40,
    'Pavé':     25,   // per stone — pavé is many small stones
    '_default': 35,
  };
  function stoneSettingRate(setting, ratesOverride) {
    const rates = ratesOverride || STONE_SET_RATES;
    if (setting != null && rates[setting] != null) return rates[setting];
    return (ratesOverride && ratesOverride._default != null) ? ratesOverride._default
         : STONE_SET_RATES._default;
  }
  // stones: array of { setting, count } (count defaults to 1). Returns the
  // total setting labor + a per-line breakdown.
  function stoneSettingCost(stones, ratesOverride) {
    const list = Array.isArray(stones) ? stones : [];
    const lines = list.map(s => {
      const count = Number(s && s.count) || 1;
      const rate  = stoneSettingRate(s && s.setting, ratesOverride);
      return { setting: (s && s.setting) || '', count: count, rate: rate, cost: rate * count };
    });
    const total = lines.reduce((a, l) => a + l.cost, 0);
    return { lines: lines, total: total };
  }

  // ── Chain / pendant length ──
  // Chain material cost from a length (inches) and a price-per-inch, plus an
  // optional flat cost for the bail/clasp findings.
  function chainCost(opts) {
    opts = opts || {};
    const lengthIn    = Number(opts.lengthIn) || 0;
    const pricePerIn  = Number(opts.pricePerIn);
    const findings    = Number(opts.findings) || 0;
    const hasPrice = isFinite(pricePerIn) && pricePerIn > 0;
    const chain = hasPrice ? lengthIn * pricePerIn : null;
    return {
      lengthIn: lengthIn,
      hasPrice: hasPrice,
      chainCost: chain,
      findings: findings,
      total: (chain != null ? chain : 0) + findings,
    };
  }

  const api = {
    G_PER_OZT: G_PER_OZT,
    METAL_DENSITY: METAL_DENSITY,
    STONE_SET_RATES: STONE_SET_RATES,
    metalDensity: metalDensity,
    gramsToOzt: gramsToOzt,
    oztToGrams: oztToGrams,
    blankVolumeMm3: blankVolumeMm3,
    blankWeight: blankWeight,
    metalCost: metalCost,
    resizeCost: resizeCost,
    stoneSettingRate: stoneSettingRate,
    stoneSettingCost: stoneSettingCost,
    chainCost: chainCost,
  };

  // Browser: expose as a global. Node (tests): module.exports.
  root.EstimateCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
