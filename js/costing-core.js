// ════════════════════════════════════════════
//  COSTING CORE  —  js/costing-core.js
//  Pure money math for the costing/inventory build (Phases 2–6),
//  extracted from designs.js / closeout.js / replenish.js / receiving.js.
//  No DOM, no fetch, no app globals — every function takes its data as
//  arguments and returns plain values, so the same code runs in the
//  browser (as window.STSCosting) and under `node --test`
//  (see tests/costing-core.test.js).
//  Must load BEFORE the tab modules that delegate to it.
// ════════════════════════════════════════════
(function (root) {
  'use strict';

  function round2(n) { return Math.round(n * 100) / 100; }

  // ── Waste resolution (spec §5 hybrid model) ──
  // Priority: design override → metal-type default → shop default → 0.
  function wastePctResolve(material, overridePct, shopSettings) {
    if (overridePct != null && !isNaN(overridePct)) return overridePct;
    var s = shopSettings || {};
    var mt = (s.wastePctByMetal || {})[(material || {}).metalType];
    if (typeof mt === 'number') return mt;
    return typeof s.wasteDefaultPct === 'number' ? s.wasteDefaultPct : 0;
  }

  // Per-piece consumption for one BOM line: metal lines carry the waste
  // factor, component lines never do.
  function bomLinePerPiece(design, line, material, shopSettings) {
    if (material.category !== 'metal') return line.qty;
    var ov = design.wasteOverridePct != null ? design.wasteOverridePct : null;
    return line.qty * (1 + wastePctResolve(material, ov, shopSettings) / 100);
  }

  // ── Labor: work sessions → minutes/piece per item key ──
  // Same share math as the Production Report's By Design view: a
  // session's net time splits across its items proportionally to pieces
  // made. Keys are the Square variation id, or 'custom:<name>' for
  // custom/unlinked items.
  function aggregateLaborSessions(sessions) {
    var agg = {};
    (Array.isArray(sessions) ? sessions : []).forEach(function (s) {
      if (s.netMin == null) return;
      var items = null;
      if (s.itemsJson) { try { items = JSON.parse(s.itemsJson); } catch (e) {} }
      if (!items) items = s.itemName ? [{ name: s.itemName, squareId: s.squareItemId || '', pieces: s.pieces, isCustom: false }] : [];
      var withPcs = (items || []).filter(function (it) { return it.pieces > 0; });
      var totalPcs = withPcs.reduce(function (t, it) { return t + it.pieces; }, 0);
      if (!totalPcs) return;
      withPcs.forEach(function (it) {
        var key = (it.squareId && !it.isCustom) ? it.squareId : 'custom:' + (it.name || '');
        var g = agg[key] = agg[key] || { hrs: 0, pcs: 0 };
        g.hrs += (s.netMin / 60) * (it.pieces / totalPcs);
        g.pcs += it.pieces;
      });
    });
    Object.keys(agg).forEach(function (k) { agg[k].minPerPc = agg[k].pcs ? (agg[k].hrs * 60 / agg[k].pcs) : null; });
    return agg;
  }

  // ── Cost rollup (spec §6) ──
  // True per-piece cost: BOM materials (incl. waste) + tracked labor.
  // d needs: bom, wasteOverridePct, squareItemId, retailPriceOverride,
  // laborMinPerPieceOverride. ctx carries the reference data:
  //   { materials, shopSettings, laborByKey, sqPrices }
  function costRollup(d, ctx) {
    ctx = ctx || {};
    var shopSettings = ctx.shopSettings || {};
    var laborByKey   = ctx.laborByKey   || {};
    var sqPrices     = ctx.sqPrices     || {};
    var matById = {};
    (ctx.materials || []).forEach(function (m) { matById[m.notionPageId] = m; });

    var lines = [];
    var matCost = 0, matMissing = false;
    (d.bom || []).forEach(function (l) {
      var m = matById[l.materialId];
      if (!m || !(l.qty > 0)) { matMissing = true; return; }
      var isMetal = m.category === 'metal';
      var w = isMetal ? wastePctResolve(m, d.wasteOverridePct != null ? d.wasteOverridePct : null, shopSettings) : 0;
      var effQty = l.qty * (1 + w / 100);
      var unitCost = m.currentCostPerUnit;
      var cost = unitCost != null ? effQty * unitCost : null;
      if (cost == null) matMissing = true; else matCost += cost;
      lines.push({
        name: m.name, qty: l.qty, unit: m.unit === 'gram' ? 'g' : 'pc',
        wastePct: isMetal ? w : null, effQty: effQty, unitCost: unitCost, cost: cost,
      });
    });
    var hasBom = (d.bom || []).length > 0;

    var key = d.squareItemId || null;
    var tracked = (key && laborByKey[key]) ? laborByKey[key].minPerPc : null;
    var laborMin = d.laborMinPerPieceOverride != null ? d.laborMinPerPieceOverride : tracked;
    var laborSource = d.laborMinPerPieceOverride != null ? 'override' : (tracked != null ? 'tracked' : null);
    var rate = typeof shopSettings.shopHourlyRate === 'number' ? shopSettings.shopHourlyRate : null;
    var laborCost = (laborMin != null && rate != null) ? (laborMin / 60) * rate : null;

    var sqPrice = (key && sqPrices[key] != null) ? sqPrices[key] : null;
    var retail = d.retailPriceOverride != null ? d.retailPriceOverride : sqPrice;
    var retailSource = d.retailPriceOverride != null ? 'override' : (sqPrice != null ? 'square' : null);

    var pieceCost = (hasBom || laborCost != null) ? matCost + (laborCost || 0) : null;
    var margin = (retail > 0 && pieceCost != null) ? (retail - pieceCost) / retail : null;
    var target = typeof shopSettings.targetMarginPct === 'number' ? shopSettings.targetMarginPct : null;
    var suggested = (pieceCost != null && target != null && target < 100) ? pieceCost / (1 - target / 100) : null;

    return { lines: lines, matCost: matCost, matMissing: matMissing, hasBom: hasBom,
             laborMin: laborMin, laborSource: laborSource, laborCost: laborCost, rate: rate,
             retail: retail, retailSource: retailSource, pieceCost: pieceCost,
             margin: margin, suggested: suggested };
  }

  // ── Batch close-out (Phase 5) ──
  // Session items → total material consumption from each finished item's
  // design BOM (metals include waste). Items whose design has no BOM are
  // returned in `unweighed` and never contribute to the totals.
  function closeoutTotals(session, designsIdx, materials, shopSettings) {
    var designByVar = {};
    (designsIdx || []).forEach(function (d) { if (d.squareItemId) designByVar[d.squareItemId] = d; });
    var matById = {};
    (materials || []).forEach(function (m) { matById[m.notionPageId] = m; });

    var totals = {}, unweighed = [];
    ((session && session.items) || []).forEach(function (it) {
      if (!(it.pieces > 0)) return;
      var d = it.squareId ? designByVar[it.squareId] : null;
      if (!d || !Array.isArray(d.bom) || !d.bom.length) {
        unweighed.push(it.name || 'item');
        return;
      }
      d.bom.forEach(function (l) {
        var m = matById[l.materialId];
        if (!m || !(l.qty > 0)) return;
        totals[l.materialId] = (totals[l.materialId] || 0) + bomLinePerPiece(d, l, m, shopSettings) * it.pieces;
      });
    });

    var rows = Object.keys(totals).map(function (id) {
      var m = matById[id];
      return {
        materialId: id,
        name: m.name || 'Material',
        unit: m.unit === 'gram' ? 'g' : 'pc',
        qty: round2(totals[id]),
      };
    });
    return { rows: rows, unweighed: unweighed };
  }

  // ── Replenishment queue (Phase 6) ──
  // Designs at/below par, worst deficit first. Buildable = min over BOM
  // lines of floor(material stock / per-piece consumption incl. waste);
  // no BOM → buildable null. Shorts list the materials that can't cover
  // the batch. onHand ids missing from the map are treated as 0 (not
  // tracked in Square = out).
  function replenishQueue(designs, materials, onHand, shopSettings) {
    var matById = {};
    (materials || []).forEach(function (m) { matById[m.notionPageId] = m; });
    onHand = onHand || {};

    var rows = [];
    (designs || []).forEach(function (d) {
      if (d.replenishmentActive === false) return;
      if (d.parLevel == null || !d.squareItemId) return;
      var oh = onHand[d.squareItemId];
      if (oh == null) oh = 0;
      if (oh > d.parLevel) return;

      var deficit = d.parLevel - oh;
      var batch = d.suggestedBatchSize != null && d.suggestedBatchSize > 0 ? d.suggestedBatchSize : Math.max(deficit, 1);
      var buildable = null, shorts = [];
      var bom = Array.isArray(d.bom) ? d.bom.filter(function (l) { return l.materialId && l.qty > 0; }) : [];
      if (bom.length) {
        buildable = Infinity;
        bom.forEach(function (l) {
          var m = matById[l.materialId];
          if (!m) return;
          var per = bomLinePerPiece(d, l, m, shopSettings);
          var stock = parseFloat(m.stockLevel) || 0;
          buildable = Math.min(buildable, Math.floor(stock / per));
          var need = per * batch;
          if (need > stock) shorts.push({ m: m, need: need, short: need - stock, perPiece: per });
        });
        if (buildable === Infinity) buildable = null;
        if (buildable != null && buildable < 0) buildable = 0;
      }
      rows.push({ d: d, onHand: oh, par: d.parLevel, deficit: deficit, batch: batch, buildable: buildable, shorts: shorts });
    });

    rows.sort(function (a, b) { return b.deficit - a.deficit; });
    return rows;
  }

  // Aggregate the queue's shortfalls into a shopping list grouped by
  // default supplier: { supplierName: [{ m, qty }] }.
  function shoppingList(rows) {
    var byMat = {};
    (rows || []).forEach(function (r) {
      (r.shorts || []).forEach(function (s) {
        var e = byMat[s.m.notionPageId] = byMat[s.m.notionPageId] || { m: s.m, qty: 0 };
        e.qty += s.short;
      });
    });
    var bySup = {};
    Object.keys(byMat).forEach(function (k) {
      var e = byMat[k];
      var sup = e.m.supplierDefault || 'No default supplier';
      (bySup[sup] = bySup[sup] || []).push(e);
    });
    return bySup;
  }

  // ── Receiving (Phase 2) ──
  // Invoices often show line totals — derive the unit cost from one.
  // Returns a display-ready string with trailing zeros trimmed, or null
  // when qty/total can't produce a cost.
  function deriveUnitCost(total, qty) {
    if (!(qty > 0) || total == null || isNaN(total)) return null;
    return (total / qty).toFixed(4).replace(/\.?0+$/, '');
  }

  // Running shipment total: complete material lines + extra charges.
  function receiptTotal(lines, extras) {
    return (lines || []).reduce(function (s, l) {
      return s + ((l.qty > 0 && l.unitCost != null) ? l.qty * l.unitCost : 0);
    }, 0) + (extras || []).reduce(function (s, x) { return s + (parseFloat(x.amt) || 0); }, 0);
  }

  var STSCosting = {
    round2: round2,
    wastePctResolve: wastePctResolve,
    bomLinePerPiece: bomLinePerPiece,
    aggregateLaborSessions: aggregateLaborSessions,
    costRollup: costRollup,
    closeoutTotals: closeoutTotals,
    replenishQueue: replenishQueue,
    shoppingList: shoppingList,
    deriveUnitCost: deriveUnitCost,
    receiptTotal: receiptTotal,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = STSCosting;
  root.STSCosting = STSCosting;
})(typeof globalThis !== 'undefined' ? globalThis : this);
