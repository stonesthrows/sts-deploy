// ════════════════════════════════════════════
//  REPLENISHMENT ENGINE  —  js/replenish.js
//  Phase 6 of the costing/inventory build (the capstone), now sales-driven.
//  One page that answers: what's selling, what's low, whether the studio
//  can build it from material on hand, and what to order first.
//    · Weekend market sales (Sat 00:00 → Mon 00:00, COMPLETED orders at
//      the market location) are pulled from Square and stored server-side
//      via /api/weekend-sales so every device sees the same numbers.
//      Opening the page syncs any missing/partial weekends.
//    · Velocity = recency-weighted avg units/weekend over the last
//      RP_LOOKBACK_WEEKENDS *final* weekends with sales (zero-sale
//      weekends — skipped markets — are excluded). Sizes are pooled to
//      the parent Square item, since designs restock as a design and the
//      size mix is decided at the bench.
//    · Suggested par = ceil(velocity × RP_COVER_WEEKENDS). It only ever
//      SUGGESTS — the manual par stays authoritative; one click accepts.
//    · On-hand counts come live from Square on page open, pooled across
//      all variations (sizes) of each design's parent item.
//    · Top sellers with no linked design are flagged, not hidden — the
//      best sellers are exactly what must not fall through the cracks.
//    · Buildable = min over BOM lines of (material stock / per-piece
//      consumption incl. waste). No BOM → threshold row + "weigh me".
//    · Shortfalls aggregate into a supplier-grouped shopping list that
//      feeds the Receive Shipment loop.
//    · "→ Queue" creates a Restock Queue card (Notion note, block
//      'Inventory Restock') pre-linked to the design's Square item, so
//      the timers and Phase 5 close-out complete the loop.
//  Known limit: a size/variation added in Square after a design's item
//  was first resolved shows up on the next page open (design links are
//  re-resolved every load); sales history itself is never re-fetched.
//  Loaded ONLY by jewelry-workflow.html, after inventory.js (needs
//  INV_LOCATION_ID) — uses toast() from app.js.
// ════════════════════════════════════════════

var RP_LOOKBACK_WEEKENDS = 8; // velocity window
var RP_COVER_WEEKENDS    = 2; // suggested par = velocity × this
var RP_TOP_SELLERS       = 10;

var _rpDesigns   = null; // designs index
var _rpMaterials = null; // materials library
var _rpSettings  = null; // shop settings (waste defaults)
var _rpSales     = null; // /api/weekend-sales blob { weekends, varMap }
var _rpOnHand    = {};   // squareVariationId -> on-hand count
var _rpItemVars  = {};   // squareItemId (parent) -> [variationIds]
var _rpItemNames = {};   // squareItemId (parent) -> item name
var _rpVelocity  = {};   // squareItemId (parent) -> weighted units/weekend
var _rpVelWeekends = 0;  // how many weekends fed the velocity math
var _rpLoading   = false;
var _rpQueued    = {};   // designId -> true, added to production queue this visit

function _rpEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function replenishInit() {
  rpRender(true);
}

// ── Square proxy helper ────────────────────────
function _rpSq(path, body) {
  return fetch('/api/square', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path, method: 'POST', body: body }),
  }).then(function(r) {
    return r.json().then(function(json) {
      if (!r.ok) throw new Error((json.errors && json.errors[0] && json.errors[0].detail) || 'Square error');
      return json;
    });
  });
}

function _rpStatus(msg) {
  var note = document.getElementById('rp-note');
  if (note) note.textContent = msg;
}

// ── Data loading ───────────────────────────────
function _rpLoadAll() {
  var pDesigns = fetch('/api/designs').then(function(r){ return r.json(); })
    .then(function(d){ _rpDesigns = Array.isArray(d) ? d : []; })
    .catch(function(){ if (_rpDesigns === null) _rpDesigns = []; });
  var pMats = fetch('/api/materials').then(function(r){ return r.json(); })
    .then(function(m){ _rpMaterials = Array.isArray(m) ? m : []; })
    .catch(function(){ if (_rpMaterials === null) _rpMaterials = []; });
  var pSet = _rpSettings !== null ? Promise.resolve()
    : fetch('/api/shop-settings').then(function(r){ return r.json(); })
        .then(function(s){ _rpSettings = (s && !s.error) ? s : {}; })
        .catch(function(){ _rpSettings = {}; });
  var pSales = fetch('/api/weekend-sales').then(function(r){ return r.json(); })
    .then(function(s){ _rpSales = (s && !s.error) ? s : { weekends: {}, varMap: {} }; })
    .catch(function(){ if (_rpSales === null) _rpSales = { weekends: {}, varMap: {} }; });
  return Promise.all([pDesigns, pMats, pSet, pSales])
    .then(_rpSyncSales)
    .then(_rpResolveDesignItems)
    .then(function() { _rpComputeVelocity(); return _rpLoadOnHand(); });
}

// ── Weekend date helpers ───────────────────────
function _rpDateKey(d) {
  var p = function(n){ return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Last n Saturdays (most recent first) as YYYY-MM-DD keys
function _rpSatKeys(n) {
  var d = new Date();
  var day = d.getDay(); // 0=Sun…6=Sat
  d.setDate(d.getDate() - (day === 6 ? 0 : day + 1));
  d.setHours(0, 0, 0, 0);
  var keys = [];
  for (var i = 0; i < n; i++) {
    keys.push(_rpDateKey(d));
    d.setDate(d.getDate() - 7);
  }
  return keys;
}

function _rpWeekendLabel(satKey) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var sat = new Date(satKey + 'T00:00:00');
  var sun = new Date(sat); sun.setDate(sun.getDate() + 1);
  return months[sat.getMonth()] + ' ' + sat.getDate() + '-'
    + (sun.getMonth() !== sat.getMonth() ? months[sun.getMonth()] + ' ' : '') + sun.getDate();
}

// ── Weekend sales sync (Square → server store) ─
// One weekend's COMPLETED orders at the market location, aggregated per
// catalog variation id. Custom-amount lines (no catalog id) are tallied
// separately so undercounting is visible instead of silent.
async function _rpFetchWeekendOrders(satKey) {
  var start = new Date(satKey + 'T00:00:00');
  var end = new Date(start); end.setDate(end.getDate() + 2);
  var byVar = {}, uncatalogued = 0, cursor = null;
  do {
    var body = {
      location_ids: [INV_LOCATION_ID],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: start.toISOString(), end_at: end.toISOString() } },
          state_filter: { states: ['COMPLETED'] },
        },
        sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' },
      },
      limit: 500,
    };
    if (cursor) body.cursor = cursor;
    var json = await _rpSq('/v2/orders/search', body);
    (json.orders || []).forEach(function(order) {
      (order.line_items || []).forEach(function(li) {
        var qty = parseFloat(li.quantity || '1') || 0;
        var rev = (li.total_money && li.total_money.amount) ? li.total_money.amount / 100 : 0;
        if (!li.catalog_object_id) { uncatalogued += qty; return; }
        var e = byVar[li.catalog_object_id] = byVar[li.catalog_object_id] || { qty: 0, revenue: 0, name: li.name || '' };
        e.qty += qty; e.revenue += rev;
      });
    });
    cursor = json.cursor || null;
  } while (cursor);
  return { byVar: byVar, uncatalogued: uncatalogued };
}

// Batch-resolve variation ids → parent item (fills varMap patch, and
// _rpItemVars/_rpItemNames from the related ITEM objects, which carry the
// item's full variation list).
async function _rpResolveVarIds(varIds) {
  var patch = {};
  for (var i = 0; i < varIds.length; i += 500) {
    var batch = varIds.slice(i, i + 500);
    try {
      var json = await _rpSq('/v2/catalog/batch-retrieve', { object_ids: batch, include_related_objects: true });
      var items = {};
      (json.related_objects || []).concat(json.objects || []).forEach(function(o) {
        if (o.type === 'ITEM') items[o.id] = o;
      });
      Object.keys(items).forEach(function(itemId) {
        var it = items[itemId];
        _rpItemNames[itemId] = (it.item_data && it.item_data.name) || _rpItemNames[itemId] || '';
        _rpItemVars[itemId] = ((it.item_data && it.item_data.variations) || []).map(function(v){ return v.id; });
      });
      (json.objects || []).forEach(function(o) {
        if (o.type !== 'ITEM_VARIATION') return;
        var itemId = (o.item_variation_data && o.item_variation_data.item_id) || null;
        if (!itemId) return;
        patch[o.id] = { itemId: itemId, itemName: _rpItemNames[itemId] || '' };
      });
    } catch (e) { /* unresolved ids fall back to variation-level below */ }
  }
  return patch;
}

// Pull any missing or still-partial weekends from Square, roll variation
// sales up to the parent item, and persist to the shared store.
async function _rpSyncSales() {
  if (!_rpSales) _rpSales = { weekends: {}, varMap: {} };
  var keys = _rpSatKeys(RP_LOOKBACK_WEEKENDS);
  var toFetch = keys.filter(function(k) {
    var e = _rpSales.weekends[k];
    return !e || e.final !== true; // partial weekends get re-pulled until final
  });
  if (!toFetch.length) return;

  var fetched = {}; // satKey -> {byVar, uncatalogued}
  for (var i = 0; i < toFetch.length; i++) {
    var k = toFetch[i];
    _rpStatus('Pulling weekend sales ' + _rpWeekendLabel(k) + '… (' + (i + 1) + '/' + toFetch.length + ')');
    try { fetched[k] = await _rpFetchWeekendOrders(k); }
    catch (e) { /* leave missing — retried next page open */ }
  }

  // Resolve any variation ids the shared varMap doesn't know yet
  var varMap = _rpSales.varMap || {};
  var unknown = {};
  Object.keys(fetched).forEach(function(k) {
    Object.keys(fetched[k].byVar).forEach(function(v){ if (!varMap[v]) unknown[v] = true; });
  });
  var varPatch = {};
  var unknownIds = Object.keys(unknown);
  if (unknownIds.length) {
    _rpStatus('Matching sold items to the Square catalog…');
    varPatch = await _rpResolveVarIds(unknownIds);
    Object.keys(varPatch).forEach(function(v){ varMap[v] = varPatch[v]; });
  }

  // Roll each fetched weekend up to parent items and stage the store patch
  var now = new Date();
  var weekendPatch = {};
  Object.keys(fetched).forEach(function(k) {
    var end = new Date(k + 'T00:00:00'); end.setDate(end.getDate() + 2);
    var items = {};
    var byVar = fetched[k].byVar;
    Object.keys(byVar).forEach(function(v) {
      // Deleted/unresolvable catalog objects keep the variation id as the
      // key so their sales still count somewhere visible
      var itemId = varMap[v] ? varMap[v].itemId : v;
      var name   = varMap[v] ? varMap[v].itemName : byVar[v].name;
      var e = items[itemId] = items[itemId] || { name: name, qty: 0, revenue: 0 };
      e.qty += byVar[v].qty;
      e.revenue += Math.round(byVar[v].revenue * 100) / 100;
    });
    weekendPatch[k] = {
      label: _rpWeekendLabel(k),
      syncedAt: now.toISOString(),
      final: now >= end,
      items: items,
      uncatalogued: fetched[k].uncatalogued,
    };
    _rpSales.weekends[k] = weekendPatch[k];
  });

  if (Object.keys(weekendPatch).length || Object.keys(varPatch).length) {
    await fetch('/api/weekend-sales', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekends: weekendPatch, varMap: varPatch }),
    }).catch(function(){}); // store miss = re-sync next open, page still renders
  }
}

// Re-resolve every linked design's variation → parent item each load, so
// _rpItemVars stays fresh (new sizes added in Square get picked up).
function _rpResolveDesignItems() {
  var varMap = (_rpSales && _rpSales.varMap) || {};
  var ids = (_rpDesigns || [])
    .filter(function(d){ return d.squareItemId; })
    .map(function(d){ return d.squareItemId; });
  if (!ids.length) return Promise.resolve();
  return _rpResolveVarIds(ids).then(function(patch) {
    var newEntries = {};
    Object.keys(patch).forEach(function(v) {
      if (!varMap[v]) newEntries[v] = patch[v];
      varMap[v] = patch[v];
    });
    if (_rpSales) _rpSales.varMap = varMap;
    if (Object.keys(newEntries).length) {
      fetch('/api/weekend-sales', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ varMap: newEntries }),
      }).catch(function(){});
    }
  });
}

// ── Velocity (recency-weighted units/weekend) ──
function _rpComputeVelocity() {
  _rpVelocity = {};
  _rpVelWeekends = 0;
  var weekends = (_rpSales && _rpSales.weekends) || {};
  var keys = Object.keys(weekends).sort().reverse(); // most recent first
  var used = [];
  for (var i = 0; i < keys.length && used.length < RP_LOOKBACK_WEEKENDS; i++) {
    var e = weekends[keys[i]];
    if (!e || e.final !== true) continue; // in-progress weekend would skew low
    var sold = (e.uncatalogued || 0) > 0;
    if (!sold) {
      var its = e.items || {};
      sold = Object.keys(its).some(function(id){ return its[id].qty > 0; });
    }
    if (!sold) continue; // zero-sale weekend = market skipped, not demand
    used.push(e);
  }
  if (!used.length) return;

  var n = used.length, wSum = 0, acc = {};
  used.forEach(function(e, idx) {
    var weight = n - idx; // most recent = n … oldest = 1
    wSum += weight;
    var its = e.items || {};
    Object.keys(its).forEach(function(itemId) {
      acc[itemId] = (acc[itemId] || 0) + its[itemId].qty * weight;
      if (!_rpItemNames[itemId]) _rpItemNames[itemId] = its[itemId].name || '';
    });
  });
  Object.keys(acc).forEach(function(itemId){ _rpVelocity[itemId] = acc[itemId] / wSum; });
  _rpVelWeekends = n;
}

// ── Design ↔ Square item helpers ───────────────
function _rpDesignItemId(d) {
  var m = _rpSales && _rpSales.varMap && _rpSales.varMap[d.squareItemId];
  return m ? m.itemId : null;
}

// Pooled on-hand across every size/variation of the design's parent item;
// falls back to just the linked variation if the parent never resolved.
function _rpDesignOnHand(d) {
  var itemId = _rpDesignItemId(d);
  var vars = (itemId && _rpItemVars[itemId]) || [d.squareItemId];
  var sum = 0, any = false;
  vars.forEach(function(v) {
    if (_rpOnHand[v] != null) { sum += _rpOnHand[v]; any = true; }
  });
  return any ? sum : null;
}

function _rpDesignVelocity(d) {
  var itemId = _rpDesignItemId(d);
  return (itemId && _rpVelocity[itemId]) || 0;
}

function _rpSuggestedPar(d) {
  var v = _rpDesignVelocity(d);
  return v > 0 ? Math.ceil(v * RP_COVER_WEEKENDS) : null;
}

function _rpVelTxt(v) {
  return v > 0 ? (Math.round(v * 10) / 10) + '/wk' : '—';
}

// ── On-hand counts (live from Square) ──────────
function _rpLoadOnHand() {
  var idSet = {};
  (_rpDesigns || []).forEach(function(d) {
    if (!d.squareItemId || d.replenishmentActive === false) return;
    var itemId = _rpDesignItemId(d);
    ((itemId && _rpItemVars[itemId]) || [d.squareItemId]).forEach(function(v){ idSet[v] = true; });
  });
  // Top sellers get counts too (for the "have X" readout), even unlinked
  // ones — their variation ids come from the shared varMap inverse.
  var varMap = (_rpSales && _rpSales.varMap) || {};
  var topItems = {};
  Object.keys(_rpVelocity).forEach(function(itemId){ topItems[itemId] = true; });
  Object.keys(varMap).forEach(function(v) {
    if (topItems[varMap[v].itemId]) idSet[v] = true;
  });

  var ids = Object.keys(idSet);
  if (!ids.length) return Promise.resolve();
  // Square caps batch-retrieve at 100 ids per call
  var batches = [];
  for (var i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  return Promise.all(batches.map(function(batch) {
    return _rpSq('/v2/inventory/counts/batch-retrieve', {
      catalog_object_ids: batch, location_ids: [INV_LOCATION_ID],
    }).then(function(data) {
      (data.counts || []).forEach(function(c) {
        _rpOnHand[c.catalog_object_id] = parseInt(c.quantity, 10) || 0;
      });
    }).catch(function(){});
  }));
}

// ── Waste (same priority chain as designs.js / closeout.js) ──
function _rpWastePct(m, overridePct) {
  if (overridePct != null && !isNaN(overridePct)) return overridePct;
  var s = _rpSettings || {};
  var mt = (s.wastePctByMetal || {})[m.metalType];
  if (typeof mt === 'number') return mt;
  return typeof s.wasteDefaultPct === 'number' ? s.wasteDefaultPct : 0;
}

// Per-piece consumption per BOM line for a design
function _rpPerPiece(d, l, m) {
  return m.category === 'metal'
    ? l.qty * (1 + _rpWastePct(m, d.wasteOverridePct != null ? d.wasteOverridePct : null) / 100)
    : l.qty;
}

// ── The queue computation ──────────────────────
// Returns [{d, onHand, par, deficit, batch, vel, sug, buildable, shorts:[{m, need, short, perPiece}]}]
function _rpComputeQueue() {
  var matById = {};
  (_rpMaterials || []).forEach(function(m){ matById[m.notionPageId] = m; });

  var rows = [];
  (_rpDesigns || []).forEach(function(d) {
    if (d.replenishmentActive === false) return;
    if (d.parLevel == null || !d.squareItemId) return;
    var onHand = _rpDesignOnHand(d);
    if (onHand == null) onHand = 0; // not tracked in Square = treat as out
    if (onHand > d.parLevel) return;

    var deficit = d.parLevel - onHand;
    var batch = d.suggestedBatchSize != null && d.suggestedBatchSize > 0 ? d.suggestedBatchSize : Math.max(deficit, 1);
    var buildable = null, shorts = [];
    var bom = Array.isArray(d.bom) ? d.bom.filter(function(l){ return l.materialId && l.qty > 0; }) : [];
    if (bom.length) {
      buildable = Infinity;
      bom.forEach(function(l) {
        var m = matById[l.materialId];
        if (!m) return;
        var per = _rpPerPiece(d, l, m);
        var stock = parseFloat(m.stockLevel) || 0;
        buildable = Math.min(buildable, Math.floor(stock / per));
        var need = per * batch;
        if (need > stock) shorts.push({ m: m, need: need, short: need - stock, perPiece: per });
      });
      if (buildable === Infinity) buildable = null;
      if (buildable != null && buildable < 0) buildable = 0;
    }
    rows.push({
      d: d, onHand: onHand, par: d.parLevel, deficit: deficit, batch: batch,
      vel: _rpDesignVelocity(d), sug: _rpSuggestedPar(d),
      buildable: buildable, shorts: shorts,
    });
  });

  rows.sort(function(a, b){ return b.deficit - a.deficit; });
  return rows;
}

// ── Render ─────────────────────────────────────
async function rpRender(reload) {
  var body = document.getElementById('rp-body');
  if (!body) return;
  if (_rpLoading) return;
  if (reload || _rpDesigns === null) {
    _rpLoading = true;
    body.innerHTML = '<tr><td colspan="8" class="oh-empty">Checking weekend sales, Square stock, and material levels…</td></tr>';
    await _rpLoadAll();
    _rpLoading = false;
  }

  var rows = _rpComputeQueue();
  var linked = (_rpDesigns || []).filter(function(d){ return d.squareItemId; }).length;

  var note = document.getElementById('rp-note');
  if (note) {
    note.textContent = linked
      ? rows.length + ' design' + (rows.length !== 1 ? 's' : '') + ' at or below par · ' + linked + ' linked design' + (linked !== 1 ? 's' : '') + ' checked'
        + (_rpVelWeekends ? ' · velocity from last ' + _rpVelWeekends + ' market weekend' + (_rpVelWeekends !== 1 ? 's' : '') : ' · no market sales history yet')
      : 'No designs are linked to Square items yet — link them in Designs → (open design) → Costing, then set par levels here.';
  }

  _rpRenderTopSellers();
  _rpRenderShoppingList(rows);

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="oh-empty">'
      + (linked ? 'Nothing below par 🎉 — adjust par levels below if this looks wrong.' : 'Link designs to Square items to start planning.')
      + '</td></tr>';
    _rpRenderParTable();
    return;
  }

  body.innerHTML = rows.map(function(r) {
    var d = r.d;
    var hasBom = Array.isArray(d.bom) && d.bom.length > 0;
    var buildTxt = !hasBom
      ? '<span class="rp-flag">⚖ weigh me</span>'
      : (r.buildable >= r.batch
          ? '<span class="rp-ok">' + r.buildable + '</span>'
          : '<span class="rp-short-n">' + r.buildable + '</span>');
    var shortTxt = !hasBom ? '—'
      : (r.shorts.length
          ? r.shorts.map(function(s) {
              var unit = matUnitAbbr(s.m.unit);
              return 'short ' + (Math.round(s.short * 10) / 10) + unit + ' ' + _rpEsc(s.m.name);
            }).join(' · ')
          : '<span class="rp-ok">material for ' + r.batch + ' ✓</span>');
    var queued = _rpQueued[d.id];
    return '<tr>'
      + '<td>' + _rpEsc(d.name || 'Untitled') + '</td>'
      + '<td>' + r.onHand + '</td>'
      + '<td class="rp-vel">' + _rpVelTxt(r.vel) + '</td>'
      + '<td><input type="number" min="0" step="1" class="rp-inline" value="' + r.par + '" onchange="rpSetField(\'' + d.id + '\',\'parLevel\',this.value)">' + _rpSugChip(d, r.sug, r.par) + '</td>'
      + '<td><input type="number" min="0" step="1" class="rp-inline" value="' + (d.suggestedBatchSize != null ? d.suggestedBatchSize : '') + '" placeholder="' + r.deficit + '" onchange="rpSetField(\'' + d.id + '\',\'suggestedBatchSize\',this.value)"></td>'
      + '<td>' + buildTxt + '</td>'
      + '<td class="rp-short-detail">' + shortTxt + '</td>'
      + '<td>' + (queued
          ? '<span class="rp-ok">✓ queued</span>'
          : '<button class="btn btn-gold btn-sm" onclick="rpAddToQueue(\'' + d.id + '\',' + r.batch + ',this)">→ Queue ' + r.batch + '</button>')
      + '</td>'
      + '</tr>';
  }).join('');

  _rpRenderParTable();
}

// Suggested-par chip: shown when velocity implies a different par than the
// manual one; clicking accepts it (manual par stays authoritative until then)
function _rpSugChip(d, sug, par) {
  if (sug == null || sug === par) return '';
  return ' <button class="rp-sug" title="Sells ~' + (Math.round(_rpDesignVelocity(d) * 10) / 10)
    + '/weekend × ' + RP_COVER_WEEKENDS + ' weekends cover — click to set par to ' + sug + '"'
    + ' onclick="rpSetField(\'' + d.id + '\',\'parLevel\',' + sug + ')">→ ' + sug + '</button>';
}

// ── Top sellers card ───────────────────────────
// Ranked by recency-weighted units/weekend. Items with no linked design
// are flagged, not hidden — a hot unlinked item has no BOM, no par, and
// no queue button, which is exactly why it needs to be seen.
function _rpRenderTopSellers() {
  var el = document.getElementById('rp-top');
  if (!el) return;
  var itemIds = Object.keys(_rpVelocity).sort(function(a, b){ return _rpVelocity[b] - _rpVelocity[a]; });
  if (!itemIds.length) { el.innerHTML = ''; return; }

  var designByItem = {}; // itemId -> design
  (_rpDesigns || []).forEach(function(d) {
    if (!d.squareItemId || d.replenishmentActive === false) return;
    var itemId = _rpDesignItemId(d);
    if (itemId && !designByItem[itemId]) designByItem[itemId] = d;
  });

  // On-hand per item = sum over its known variations
  var varMap = (_rpSales && _rpSales.varMap) || {};
  var itemOnHand = {};
  Object.keys(varMap).forEach(function(v) {
    if (_rpOnHand[v] == null) return;
    var it = varMap[v].itemId;
    itemOnHand[it] = (itemOnHand[it] || 0) + _rpOnHand[v];
  });
  Object.keys(_rpItemVars).forEach(function(it) {
    _rpItemVars[it].forEach(function(v) {
      if (_rpOnHand[v] == null || (varMap[v] && varMap[v].itemId === it)) return;
      itemOnHand[it] = (itemOnHand[it] || 0) + _rpOnHand[v];
    });
  });

  var uncat = 0;
  var weekends = (_rpSales && _rpSales.weekends) || {};
  Object.keys(weekends).sort().reverse().slice(0, RP_LOOKBACK_WEEKENDS).forEach(function(k) {
    uncat += (weekends[k] && weekends[k].uncatalogued) || 0;
  });

  var html = '<div class="rp-shop-title">📈 Top sellers — last ' + _rpVelWeekends + ' market weekend' + (_rpVelWeekends !== 1 ? 's' : '') + ', recent weighted heavier</div>';
  html += itemIds.slice(0, RP_TOP_SELLERS).map(function(itemId) {
    var v = _rpVelocity[itemId];
    var d = designByItem[itemId];
    var have = itemOnHand[itemId];
    var make = Math.max(Math.ceil(v * RP_COVER_WEEKENDS) - (have || 0), 0);
    var name = (d && d.name) || _rpItemNames[itemId] || 'Unknown item';
    return '<div class="rp-top-row">'
      + '<span class="rp-top-name">' + _rpEsc(name) + (d ? '' : ' <span class="rp-unlinked" title="No design is linked to this Square item — link one in Designs → Costing to get BOM, par, and queue buttons">⚠ not linked</span>') + '</span>'
      + '<span class="rp-vel">~' + (Math.round(v * 10) / 10) + '/wk</span>'
      + '<span class="rp-top-proj">' + (have != null ? 'have ' + have + ' · ' : '')
      + (make > 0 ? 'make <b>' + make + '</b>' : '<span class="rp-ok">covered ✓</span>') + '</span>'
      + '</div>';
  }).join('');
  if (uncat > 0) {
    html += '<div class="rp-top-note">⚠ ' + Math.round(uncat) + ' sale' + (uncat !== 1 ? 's' : '') + ' rang up as custom amounts (no catalog item) — those aren\'t counted here.</div>';
  }
  el.innerHTML = html;
}

// Below-queue table: every linked design's velocity/par/batch/active —
// assistants maintain pars here even for designs currently above par.
function _rpRenderParTable() {
  var body = document.getElementById('rp-par-body');
  if (!body) return;
  var list = (_rpDesigns || []).filter(function(d){ return d.squareItemId; });
  if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="oh-empty">No Square-linked designs yet.</td></tr>'; return; }
  list.sort(function(a, b){ return (a.name || '').localeCompare(b.name || ''); });
  body.innerHTML = list.map(function(d) {
    var onHand = _rpDesignOnHand(d);
    var sug = _rpSuggestedPar(d);
    return '<tr class="' + (d.replenishmentActive === false ? 'mat-inactive' : '') + '">'
      + '<td>' + _rpEsc(d.name || 'Untitled') + '</td>'
      + '<td>' + (onHand != null ? onHand : '—') + '</td>'
      + '<td class="rp-vel">' + _rpVelTxt(_rpDesignVelocity(d)) + '</td>'
      + '<td><input type="number" min="0" step="1" class="rp-inline" value="' + (d.parLevel != null ? d.parLevel : '') + '" placeholder="—" onchange="rpSetField(\'' + d.id + '\',\'parLevel\',this.value)"></td>'
      + '<td>' + (sug != null
          ? (sug === d.parLevel ? '<span class="rp-ok">' + sug + ' ✓</span>' : _rpSugChip(d, sug, d.parLevel))
          : '—')
      + '</td>'
      + '<td><input type="number" min="0" step="1" class="rp-inline" value="' + (d.suggestedBatchSize != null ? d.suggestedBatchSize : '') + '" placeholder="auto" onchange="rpSetField(\'' + d.id + '\',\'suggestedBatchSize\',this.value)"></td>'
      + '<td><input type="checkbox" ' + (d.replenishmentActive !== false ? 'checked' : '') + ' onchange="rpSetField(\'' + d.id + '\',\'replenishmentActive\',this.checked)"></td>'
      + '</tr>';
  }).join('');
}

// ── Shopping list (aggregate shortfall, grouped by supplier) ──
function _rpRenderShoppingList(rows) {
  var el = document.getElementById('rp-shopping');
  if (!el) return;
  var byMat = {}; // materialId -> {m, qty}
  rows.forEach(function(r) {
    r.shorts.forEach(function(s) {
      var e = byMat[s.m.notionPageId] = byMat[s.m.notionPageId] || { m: s.m, qty: 0 };
      e.qty += s.short;
    });
  });
  var mats = Object.keys(byMat).map(function(k){ return byMat[k]; });
  if (!mats.length) { el.innerHTML = ''; return; }

  var bySup = {};
  mats.forEach(function(e) {
    var sup = e.m.supplierDefault || 'No default supplier';
    (bySup[sup] = bySup[sup] || []).push(e);
  });

  var html = '<div class="rp-shop-title">🛒 Shopping list — material short across the queue'
    + ' <button class="btn btn-outline btn-sm" onclick="rpCopyShoppingList()">📋 Copy</button></div>';
  Object.keys(bySup).sort().forEach(function(sup) {
    html += '<div class="rp-shop-sup">' + _rpEsc(sup) + '</div>'
      + bySup[sup].map(function(e) {
          var unit = matUnitAbbr(e.m.unit);
          return '<div class="rp-shop-item">' + _rpEsc(e.m.name) + ' — ' + (Math.round(e.qty * 10) / 10) + unit + '</div>';
        }).join('');
  });
  el.innerHTML = html;
  el.dataset.plain = Object.keys(bySup).sort().map(function(sup) {
    return sup + ':\n' + bySup[sup].map(function(e) {
      var unit = matUnitAbbr(e.m.unit);
      return '  ' + e.m.name + ' — ' + (Math.round(e.qty * 10) / 10) + unit;
    }).join('\n');
  }).join('\n');
}

function rpCopyShoppingList() {
  var el = document.getElementById('rp-shopping');
  if (!el || !el.dataset.plain) return;
  navigator.clipboard.writeText(el.dataset.plain)
    .then(function(){ toast('Shopping list copied', '📋'); })
    .catch(function(){ toast('Copy failed', '⚠'); });
}

// ── Inline par/batch/active editing ────────────
function rpSetField(designId, field, value) {
  var d = (_rpDesigns || []).find(function(x){ return x.id === designId; });
  if (!d) return;
  var v;
  if (field === 'replenishmentActive') v = !!value;
  else {
    v = value === '' ? null : parseInt(value, 10);
    if (v != null && (isNaN(v) || v < 0)) return;
  }
  d[field] = v;
  var patch = { id: designId };
  patch[field] = v;
  fetch('/api/designs', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then(function(r) {
    if (!r.ok) throw new Error();
    rpRender(false); // recompute queue with the new value (no refetch)
  }).catch(function(){ toast('Could not save — check connection', '⚠'); });
}

// ── One-tap add to the Restock Queue ───────────
// A queue card = a Notion note (block 'Inventory Restock') + a record in
// the shared restock-matches store linking it to the Square item, so the
// card arrives pre-matched: timers, stock badges, and the Phase 5
// close-out all just work.
async function rpAddToQueue(designId, batch, btn) {
  var d = (_rpDesigns || []).find(function(x){ return x.id === designId; });
  if (!d) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  try {
    var text = (d.name || 'Design') + ' ×' + batch;
    var r = await fetch('/api/notion-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, block: 'Inventory Restock' }),
    });
    var data = await r.json();
    if (!r.ok || !data.notionPageId) throw new Error(data.error || 'create failed');

    if (d.squareItemId) {
      var patch = {};
      patch[data.notionPageId] = { id: d.squareItemId, name: d.name || '', isCustom: false, isParent: false };
      await fetch('/api/restock-matches', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch(function(){}); // match is a nicety — the card exists either way
    }

    _rpQueued[designId] = true;
    toast('Added to Restock Queue — ' + text, '✓');
    rpRender(false);
  } catch (e) {
    toast('Could not add to queue — ' + (e.message || e), '⚠');
    if (btn) { btn.disabled = false; btn.textContent = '→ Queue ' + batch; }
  }
}
