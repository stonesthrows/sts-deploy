// ════════════════════════════════════════════
//  BATCH CLOSE-OUT  —  js/closeout.js
//  Phase 5 of the costing/inventory build.
//  Extends the post-timer "Add restocked pieces to inventory?" prompt
//  (rqShowPushPrompt / rqConfirmPush in restock-sessions.js) with a
//  "Materials used" section: consumption computed from each finished
//  item's design BOM (metals include waste), editable for reality
//  (broken stone, extra scrap), decremented from the Materials Library
//  after the Square push succeeds. Items whose design has no BOM are
//  flagged "not weighed" and never block the push.
//  Loaded ONLY by jewelry-workflow.html, after restock-sessions.js.
// ════════════════════════════════════════════

var _coDesignsIdx = null; // designs index (bom, wasteOverridePct, squareItemId)
var _coMaterials  = null; // materials library entries
var _coSettings   = null; // shop settings (waste defaults)
var _coRows       = null; // [{materialId, name, unit, qty}] staged in the open prompt
var _coUnweighed  = null; // item names with no BOM to decrement

function _coEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _coLoadData() {
  // Designs + settings change rarely — cache per page session. Materials
  // stock moves constantly — refresh on every prompt.
  var p1 = _coDesignsIdx !== null ? Promise.resolve()
    : fetch('/api/designs').then(function(r){ return r.json(); })
        .then(function(d){ _coDesignsIdx = Array.isArray(d) ? d : []; })
        .catch(function(){ _coDesignsIdx = []; });
  var p2 = fetch('/api/materials').then(function(r){ return r.json(); })
    .then(function(m){ _coMaterials = Array.isArray(m) ? m : []; })
    .catch(function(){ if (_coMaterials === null) _coMaterials = []; });
  var p3 = _coSettings !== null ? Promise.resolve()
    : fetch('/api/shop-settings').then(function(r){ return r.json(); })
        .then(function(s){ _coSettings = (s && !s.error) ? s : {}; })
        .catch(function(){ _coSettings = {}; });
  return Promise.all([p1, p2, p3]);
}

// Hook: called by rqShowPushPrompt right after the prompt overlay opens.
function coAttachToPushPrompt(session) {
  _coRows = null;
  _coUnweighed = null;
  var panel = document.querySelector('#rq-push-prompt .rq-push-panel');
  if (!panel) return;
  var host = document.createElement('div');
  host.id = 'co-section';
  host.innerHTML = '<div class="co-note">Loading material recipes…</div>';
  panel.insertBefore(host, panel.lastElementChild); // above the button row
  _coLoadData().then(function() {
    // The prompt may have been closed (or reopened for another session)
    // while data loaded — only render into the host we created.
    if (!document.getElementById('co-section')) return;
    _coCompute(session);
    _coRender();
  });
}

// Consumption math (waste priority chain, per-piece × pieces, rounding)
// lives in costing-core.js so it's testable under node --test.
function _coCompute(session) {
  var r = STSCosting.closeoutTotals(session, _coDesignsIdx, _coMaterials, _coSettings);
  _coRows = r.rows;
  _coUnweighed = r.unweighed;
}

function _coRender() {
  var host = document.getElementById('co-section');
  if (!host) return;
  var html = '';
  if (_coRows && _coRows.length) {
    html += '<div class="co-title">Materials used — confirm or edit</div>'
      + _coRows.map(function(r, i) {
          return '<div class="co-row">'
            + '<span class="co-name">' + _coEsc(r.name) + '</span>'
            + '<input type="number" step="0.01" min="0" class="co-qty" data-idx="' + i + '" value="' + r.qty + '" oninput="coQtyInput(this)">'
            + '<span class="co-unit">' + r.unit + '</span>'
            + '</div>';
        }).join('')
      + '<div class="co-note">Confirming subtracts these from Materials Library stock.</div>';
  } else {
    html += '<div class="co-note">No material recipes matched — stock levels unchanged.</div>';
  }
  if (_coUnweighed && _coUnweighed.length) {
    html += '<div class="co-note co-warn">⚖ Not weighed (no recipe): ' + _coUnweighed.map(_coEsc).join(', ') + '</div>';
  }
  host.innerHTML = html;
}

function coQtyInput(el) {
  var i = parseInt(el.dataset.idx, 10);
  var v = parseFloat(el.value);
  if (_coRows && _coRows[i]) _coRows[i].qty = isNaN(v) ? 0 : v;
}

// Hook: called by rqConfirmPush after a successful Square push while the
// post-timer prompt is open. Decrements staged material quantities.
function coApplyFromPrompt() {
  var rows = (_coRows || []).filter(function(r) { return r.qty > 0; });
  _coRows = null;
  _coUnweighed = null;
  if (!rows.length) return;
  var matById = {};
  (_coMaterials || []).forEach(function(m) { matById[m.notionPageId] = m; });

  (async function() {
    var failed = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var m = matById[r.materialId];
      if (!m) { failed.push(r.name); continue; }
      try {
        var updated = Object.assign({}, m, {
          stockLevel: Math.round(((parseFloat(m.stockLevel) || 0) - r.qty) * 100) / 100,
        });
        var resp = await fetch('/api/materials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        m.stockLevel = updated.stockLevel;
        // Keep the Materials Library tab's cache in step if it's loaded
        if (typeof _materials !== 'undefined') {
          var mm = _materials.find(function(x) { return x.notionPageId === r.materialId; });
          if (mm) mm.stockLevel = updated.stockLevel;
        }
      } catch (e) {
        failed.push(r.name);
      }
      if (i < rows.length - 1) await new Promise(function(res) { setTimeout(res, 350); });
    }
    if (failed.length) {
      toast('Material stock update failed for: ' + failed.join(', ') + ' — fix in Materials Library', '⚠');
    } else {
      toast('Material stock updated — ' + rows.length + ' material' + (rows.length !== 1 ? 's' : '') + ' decremented', '✓');
    }
    if (typeof materialsRender === 'function' && typeof _materials !== 'undefined' && _materials.length) {
      materialsRender();
    }
  })();
}
