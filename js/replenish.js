// ════════════════════════════════════════════
//  REPLENISHMENT ENGINE  —  js/replenish.js
//  Phase 6 of the costing/inventory build (the capstone).
//  One page that answers: what's low, whether the studio can build it
//  from material on hand, and what to order first.
//    · On-hand counts come live from Square on page open (this app has
//      no stored sync snapshots — opening the page IS the sync).
//    · Buildable = min over BOM lines of (material stock / per-piece
//      consumption incl. waste). No BOM → threshold row + "weigh me".
//    · Shortfalls aggregate into a supplier-grouped shopping list that
//      feeds the Receive Shipment loop.
//    · "→ Queue" creates a Restock Queue card (Notion note, block
//      'Inventory Restock') pre-linked to the design's Square item, so
//      the timers and Phase 5 close-out complete the loop.
//  Loaded ONLY by jewelry-workflow.html, after inventory.js (needs
//  INV_LOCATION_ID) — uses toast() from app.js.
// ════════════════════════════════════════════

var _rpDesigns   = null; // designs index
var _rpMaterials = null; // materials library
var _rpSettings  = null; // shop settings (waste defaults)
var _rpOnHand    = {};   // squareVariationId -> on-hand count
var _rpLoading   = false;
var _rpQueued    = {};   // designId -> true, added to production queue this visit

function _rpEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function replenishInit() {
  rpRender(true);
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
  return Promise.all([pDesigns, pMats, pSet]).then(_rpLoadOnHand);
}

function _rpLoadOnHand() {
  var ids = (_rpDesigns || [])
    .filter(function(d){ return d.squareItemId && d.replenishmentActive !== false; })
    .map(function(d){ return d.squareItemId; });
  if (!ids.length) return Promise.resolve();
  // Square caps batch-retrieve at 100 ids per call
  var batches = [];
  for (var i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  return Promise.all(batches.map(function(batch) {
    return fetch('/api/square', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/v2/inventory/counts/batch-retrieve', method: 'POST',
        body: { catalog_object_ids: batch, location_ids: [INV_LOCATION_ID] },
      }),
    }).then(function(r){ return r.json(); }).then(function(data) {
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
// Returns [{d, onHand, par, deficit, batch, buildable, shorts:[{m, need, short, perPiece}]}]
function _rpComputeQueue() {
  var matById = {};
  (_rpMaterials || []).forEach(function(m){ matById[m.notionPageId] = m; });

  var rows = [];
  (_rpDesigns || []).forEach(function(d) {
    if (d.replenishmentActive === false) return;
    if (d.parLevel == null || !d.squareItemId) return;
    var onHand = _rpOnHand[d.squareItemId];
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
    rows.push({ d: d, onHand: onHand, par: d.parLevel, deficit: deficit, batch: batch, buildable: buildable, shorts: shorts });
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
    body.innerHTML = '<tr><td colspan="7" class="oh-empty">Checking Square stock and material levels…</td></tr>';
    await _rpLoadAll();
    _rpLoading = false;
  }

  var rows = _rpComputeQueue();
  var linked = (_rpDesigns || []).filter(function(d){ return d.squareItemId; }).length;

  var note = document.getElementById('rp-note');
  if (note) {
    note.textContent = linked
      ? rows.length + ' design' + (rows.length !== 1 ? 's' : '') + ' at or below par · ' + linked + ' linked design' + (linked !== 1 ? 's' : '') + ' checked against live Square counts'
      : 'No designs are linked to Square items yet — link them in Designs → (open design) → Costing, then set par levels here.';
  }

  _rpRenderShoppingList(rows);

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="oh-empty">'
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
      + '<td><input type="number" min="0" step="1" class="rp-inline" value="' + r.par + '" onchange="rpSetField(\'' + d.id + '\',\'parLevel\',this.value)"></td>'
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

// Below-queue table: every linked design's par/batch/active — assistants
// maintain pars here even for designs currently above par.
function _rpRenderParTable() {
  var body = document.getElementById('rp-par-body');
  if (!body) return;
  var list = (_rpDesigns || []).filter(function(d){ return d.squareItemId; });
  if (!list.length) { body.innerHTML = '<tr><td colspan="5" class="oh-empty">No Square-linked designs yet.</td></tr>'; return; }
  list.sort(function(a, b){ return (a.name || '').localeCompare(b.name || ''); });
  body.innerHTML = list.map(function(d) {
    var onHand = _rpOnHand[d.squareItemId];
    return '<tr class="' + (d.replenishmentActive === false ? 'mat-inactive' : '') + '">'
      + '<td>' + _rpEsc(d.name || 'Untitled') + '</td>'
      + '<td>' + (onHand != null ? onHand : '—') + '</td>'
      + '<td><input type="number" min="0" step="1" class="rp-inline" value="' + (d.parLevel != null ? d.parLevel : '') + '" placeholder="—" onchange="rpSetField(\'' + d.id + '\',\'parLevel\',this.value)"></td>'
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
