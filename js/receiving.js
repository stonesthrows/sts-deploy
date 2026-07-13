// ════════════════════════════════════════════
//  RECEIVE SHIPMENT  —  js/receiving.js
//  Phase 2 of the costing/inventory build.
//  One form per shipment. On save it does three things at once:
//    1. Creates a supplier Order History record whose material line
//       items carry {materialId, qty, unitCost} alongside the usual
//       {desc, category, amt} tax-bucket fields.
//    2. Applies each material line to the Materials Library:
//       stock_level += qty, current_cost_per_unit = unitCost
//       (latest price wins — history stays in the purchase record).
//    3. Fires the materialsPricesChanged() hook (Phase 4 consumes it).
//  Loaded ONLY by jewelry-workflow.html, after supplier-history.js and
//  materials.js — reuses their globals (ohOrders, ohSyncOrder,
//  _materialsApiFetch, _materialsApiSave, toast, escHtml).
// ════════════════════════════════════════════

var RCV_EXTRA_CATS = ['Shipping', 'Tools', 'Other'];

var _rcvMaterials = [];   // active materials for the picker
var _rcvLines     = [];   // material lines: {materialId, qty, unitCost}
var _rcvExtras    = [];   // non-material charges: {desc, category, amt}
var _rcvSaving    = false;

// ── Open / close ───────────────────────────────
async function rcvOpen() {
  document.getElementById('rcvDate').value     = new Date().toISOString().slice(0, 10);
  document.getElementById('rcvSup').value      = 'Rio Grande';
  document.getElementById('rcvOrderNum').value = '';
  document.getElementById('rcvInvNum').value   = '';
  document.getElementById('rcvNotes').value    = '';
  _rcvLines  = [];
  _rcvExtras = [];
  _rcvSaving = false;
  var saveBtn = document.getElementById('rcvSaveBtn');
  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save & Apply'; }
  document.getElementById('rcvLines').innerHTML =
    '<div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Loading materials…</div>';
  document.getElementById('rcvExtras').innerHTML = '';
  rcvUpdateTotal();
  document.getElementById('rcvModalBg').classList.add('open');

  try {
    _rcvMaterials = (await _materialsApiFetch()).filter(function(m){ return m.active !== false; });
  } catch (e) {
    _rcvMaterials = [];
    document.getElementById('rcvLines').innerHTML =
      '<div style="font-size:12px;color:#e55;margin-bottom:6px;">Could not load materials — ' + escHtml(e.message || String(e)) + '</div>';
    return;
  }
  if (!_rcvMaterials.length) {
    document.getElementById('rcvLines').innerHTML =
      '<div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">No materials in the library yet — add them in Supplies → Materials Library first.</div>';
    return;
  }
  rcvAddLine();
}

function rcvModalClose(event) {
  if (event && event.target !== event.currentTarget) return;
  if (_rcvSaving) return; // don't let a backdrop tap kill an in-flight save
  document.getElementById('rcvModalBg').classList.remove('open');
}

// ── Line rows ──────────────────────────────────
function rcvAddLine() {
  rcvSyncFromDom();
  _rcvLines.push({ materialId: '', qty: null, unitCost: null });
  rcvRenderLines();
}

function rcvAddExtra() {
  rcvSyncFromDom();
  _rcvExtras.push({ desc: '', category: 'Shipping', amt: null });
  rcvRenderLines();
}

function _rcvMat(id) {
  return _rcvMaterials.find(function(m){ return m.notionPageId === id; });
}

function _rcvUnitSuffix(m) {
  return m ? matUnitAbbr(m.unit) : 'pc';
}

function _rcvMatOptions(selectedId) {
  function opts(list) {
    return list.map(function(m) {
      var cost = m.currentCostPerUnit != null
        ? ' — $' + Number(m.currentCostPerUnit).toFixed(2) + '/' + _rcvUnitSuffix(m)
        : '';
      return '<option value="' + m.notionPageId + '"' + (m.notionPageId === selectedId ? ' selected' : '') + '>'
        + escHtml(m.name || 'Untitled') + cost + '</option>';
    }).join('');
  }
  var metals = _rcvMaterials.filter(function(m){ return m.category === 'metal'; });
  var chains = _rcvMaterials.filter(function(m){ return m.category === 'chain'; });
  var comps  = _rcvMaterials.filter(function(m){ return m.category !== 'metal' && m.category !== 'chain'; });
  return '<option value="">Pick material…</option>'
    + (metals.length ? '<optgroup label="Metals">'     + opts(metals) + '</optgroup>' : '')
    + (chains.length ? '<optgroup label="Chains">'     + opts(chains) + '</optgroup>' : '')
    + (comps.length  ? '<optgroup label="Components">' + opts(comps)  + '</optgroup>' : '');
}

function rcvRenderLines() {
  var wrap = document.getElementById('rcvLines');
  wrap.innerHTML = _rcvLines.map(function(l, i) {
    var m = _rcvMat(l.materialId);
    var total = (l.qty > 0 && l.unitCost != null) ? (l.qty * l.unitCost).toFixed(2) : '';
    return '<div class="rcv-li-row" data-idx="' + i + '">'
      + '<select class="rcv-li-mat">' + _rcvMatOptions(l.materialId) + '</select>'
      + '<input type="number" step="0.01" min="0" class="rcv-li-qty" placeholder="Qty' + (m ? ' (' + _rcvUnitSuffix(m) + ')' : '') + '" value="' + (l.qty != null ? l.qty : '') + '">'
      + '<input type="number" step="0.01" min="0" class="rcv-li-cost" placeholder="$/' + (m ? _rcvUnitSuffix(m) : 'unit') + '" value="' + (l.unitCost != null ? l.unitCost : '') + '">'
      + '<input type="number" step="0.01" min="0" class="rcv-li-total" placeholder="Total $" value="' + total + '">'
      + '<button type="button" class="rcv-li-remove" title="Remove line">✕</button>'
      + '</div>';
  }).join('');

  var extraWrap = document.getElementById('rcvExtras');
  extraWrap.innerHTML = _rcvExtras.map(function(x, i) {
    return '<div class="rcv-li-row rcv-extra-row" data-idx="' + i + '">'
      + '<input type="text" class="rcv-ex-desc" placeholder="Description" value="' + escHtml(x.desc || '') + '">'
      + '<select class="rcv-ex-cat">' + RCV_EXTRA_CATS.map(function(c) {
          return '<option value="' + c + '"' + (x.category === c ? ' selected' : '') + '>' + c + '</option>';
        }).join('') + '</select>'
      + '<input type="number" step="0.01" min="0" class="rcv-ex-amt" placeholder="0.00" value="' + (x.amt != null ? x.amt : '') + '">'
      + '<button type="button" class="rcv-li-remove" title="Remove charge">✕</button>'
      + '</div>';
  }).join('');

  // Material rows: picker prefills unit cost; qty/cost/total stay in sync
  wrap.querySelectorAll('.rcv-li-row').forEach(function(row) {
    var idx    = parseInt(row.dataset.idx, 10);
    var matSel = row.querySelector('.rcv-li-mat');
    var qtyEl  = row.querySelector('.rcv-li-qty');
    var costEl = row.querySelector('.rcv-li-cost');
    var totEl  = row.querySelector('.rcv-li-total');

    function recomputeTotal() {
      var q = parseFloat(qtyEl.value), c = parseFloat(costEl.value);
      totEl.value = (q > 0 && !isNaN(c)) ? (q * c).toFixed(2) : '';
      rcvSyncFromDom();
    }
    matSel.addEventListener('change', function() {
      var m = _rcvMat(matSel.value);
      if (m) {
        qtyEl.placeholder  = 'Qty (' + _rcvUnitSuffix(m) + ')';
        costEl.placeholder = '$/' + _rcvUnitSuffix(m);
        // Assistant-proof prefill: latest known price, editable
        if (!costEl.value && m.currentCostPerUnit != null) costEl.value = m.currentCostPerUnit;
      }
      recomputeTotal();
    });
    qtyEl.addEventListener('input', recomputeTotal);
    costEl.addEventListener('input', recomputeTotal);
    // Invoices often show line totals — typing one derives the unit cost
    totEl.addEventListener('input', function() {
      var q = parseFloat(qtyEl.value), t = parseFloat(totEl.value);
      if (q > 0 && !isNaN(t)) costEl.value = (t / q).toFixed(4).replace(/\.?0+$/, '');
      rcvSyncFromDom();
    });
    row.querySelector('.rcv-li-remove').addEventListener('click', function() {
      rcvSyncFromDom();
      _rcvLines.splice(idx, 1);
      rcvRenderLines();
    });
  });

  extraWrap.querySelectorAll('.rcv-extra-row').forEach(function(row) {
    var idx = parseInt(row.dataset.idx, 10);
    row.querySelectorAll('input, select').forEach(function(el) {
      el.addEventListener('input', rcvSyncFromDom);
      el.addEventListener('change', rcvSyncFromDom);
    });
    row.querySelector('.rcv-li-remove').addEventListener('click', function() {
      rcvSyncFromDom();
      _rcvExtras.splice(idx, 1);
      rcvRenderLines();
    });
  });

  rcvUpdateTotal();
}

function rcvSyncFromDom() {
  document.querySelectorAll('#rcvLines .rcv-li-row').forEach(function(row) {
    var l = _rcvLines[parseInt(row.dataset.idx, 10)];
    if (!l) return;
    l.materialId = row.querySelector('.rcv-li-mat').value;
    var q = parseFloat(row.querySelector('.rcv-li-qty').value);
    var c = parseFloat(row.querySelector('.rcv-li-cost').value);
    l.qty      = isNaN(q) ? null : q;
    l.unitCost = isNaN(c) ? null : c;
  });
  document.querySelectorAll('#rcvExtras .rcv-extra-row').forEach(function(row) {
    var x = _rcvExtras[parseInt(row.dataset.idx, 10)];
    if (!x) return;
    x.desc     = row.querySelector('.rcv-ex-desc').value;
    x.category = row.querySelector('.rcv-ex-cat').value;
    var a = parseFloat(row.querySelector('.rcv-ex-amt').value);
    x.amt = isNaN(a) ? null : a;
  });
  rcvUpdateTotal();
}

function rcvUpdateTotal() {
  var total = _rcvLines.reduce(function(s, l) {
    return s + ((l.qty > 0 && l.unitCost != null) ? l.qty * l.unitCost : 0);
  }, 0) + _rcvExtras.reduce(function(s, x) { return s + (parseFloat(x.amt) || 0); }, 0);
  var el = document.getElementById('rcvTotal');
  if (el) el.textContent = 'Total: $' + total.toFixed(2);
}

// ── Save ───────────────────────────────────────
async function rcvSave() {
  if (_rcvSaving) return;
  rcvSyncFromDom();

  var sup      = (document.getElementById('rcvSup').value      || '').trim();
  var date     = (document.getElementById('rcvDate').value     || '').trim();
  var orderNum = (document.getElementById('rcvOrderNum').value || '').trim();
  var invNum   = (document.getElementById('rcvInvNum').value   || '').trim();
  var notes    = (document.getElementById('rcvNotes').value    || '').trim();

  var lines = _rcvLines.filter(function(l){ return l.materialId; });
  if (!sup)          { toast('Enter the supplier', '⚠'); return; }
  if (!lines.length) { toast('Add at least one material line', '⚠'); return; }
  var incomplete = lines.find(function(l){ return !(l.qty > 0) || l.unitCost == null; });
  if (incomplete) {
    toast('Every material line needs a quantity and unit cost', '⚠');
    return;
  }

  var round2 = function(n){ return Math.round(n * 100) / 100; };
  var lineItems = lines.map(function(l) {
    var m = _rcvMat(l.materialId);
    return {
      desc:       (m && m.name) || 'Material',
      category:   'Materials',
      amt:        round2(l.qty * l.unitCost),
      materialId: l.materialId,
      qty:        l.qty,
      unitCost:   l.unitCost,
    };
  }).concat(_rcvExtras.filter(function(x){ return (x.desc || '').trim() || x.amt != null; }));

  var amt = round2(lineItems.reduce(function(s, li){ return s + (parseFloat(li.amt) || 0); }, 0));
  var order = {
    id: 'oh_' + Date.now().toString(36),
    date: date, sup: sup, orderNum: orderNum, invNum: invNum, amt: amt,
    shipped: '', delivered: '', notes: notes, lineItems: lineItems,
  };

  _rcvSaving = true;
  var saveBtn = document.getElementById('rcvSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  // 1. Order History record — local first (offline-tolerant), then Notion.
  //    ohFetchFromNotion() pushes local-only records up later if this
  //    sync fails, so the shipment is never lost.
  if (typeof ohOrders !== 'undefined') {
    if (!window._ohDone && !ohOrders.length && typeof ohLoadCache === 'function') ohLoadCache();
    ohOrders.push(order);
    if (typeof ohCacheLocally === 'function') ohCacheLocally();
    if (window._ohDone) {
      if (typeof ohRebuildYearDropdown === 'function') ohRebuildYearDropdown();
      if (typeof ohRender === 'function') ohRender();
    }
  }
  if (typeof ohSyncOrder === 'function') ohSyncOrder(order);

  // 2. Apply each line to the Materials Library, sequentially (rate-limit safe)
  var failed = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    var m = _rcvMat(l.materialId);
    if (saveBtn) saveBtn.textContent = 'Updating stock ' + (i + 1) + '/' + lines.length + '…';
    try {
      var updated = Object.assign({}, m, {
        stockLevel:         round2((parseFloat(m.stockLevel) || 0) + l.qty),
        currentCostPerUnit: l.unitCost,
      });
      await _materialsApiSave(updated);
      m.stockLevel = updated.stockLevel;
      m.currentCostPerUnit = updated.currentCostPerUnit;
      // Keep the Materials Library tab's cache in step if it's loaded
      if (typeof _materials !== 'undefined') {
        var mm = _materials.find(function(x){ return x.notionPageId === l.materialId; });
        if (mm) { mm.stockLevel = updated.stockLevel; mm.currentCostPerUnit = updated.currentCostPerUnit; }
      }
    } catch (e) {
      failed.push((m && m.name) || l.materialId);
    }
    if (i < lines.length - 1) await new Promise(function(r){ setTimeout(r, 350); });
  }

  // 3. Reprice hook — Phase 4's cost rollup consumes this
  if (typeof materialsPricesChanged === 'function') {
    materialsPricesChanged(lines.map(function(l){ return l.materialId; }));
  }

  _rcvSaving = false;
  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save & Apply'; }
  document.getElementById('rcvModalBg').classList.remove('open');

  if (typeof materialsRender === 'function' && typeof _materials !== 'undefined' && _materials.length) {
    materialsRender();
  }
  if (failed.length) {
    toast('Order saved, but stock update failed for: ' + failed.join(', ') + ' — fix those in Materials Library', '⚠');
  } else {
    toast('Shipment received — ' + lines.length + ' material' + (lines.length !== 1 ? 's' : '') + ' restocked', '✓');
  }
}
