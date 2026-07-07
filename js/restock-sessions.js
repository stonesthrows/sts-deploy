// ════════════════════════════════════════════
//  RESTOCK SESSIONS  —  js/restock-sessions.js  (extracted from restock.js)
//  Session Log + Production Report: the read/edit surfaces for completed
//  Production Sessions. Split out of restock.js purely to shrink that file;
//  no logic changed. These two sub-tabs share state (_rqReportSessions, the
//  per-"store" edit/push/add-item helpers) so they live together here.
//
//  Loaded AFTER restock.js. Both files run in the same global scope (plain
//  <script> tags, not modules), so this file freely calls restock.js globals
//  (_rqSqSearchExpand, _rqPatch, itemsFor, restockQueueRender, the _rq* state
//  objects, …) and vice-versa — all cross-file references resolve at call
//  time, well after every file has loaded. Load order between the two is not
//  load-time critical (neither file executes rq code at parse time beyond
//  self-contained var initializers); restock.js is listed first only for
//  readability.
// ════════════════════════════════════════════

// ── Session log ───────────────────────────────────────────────────────────────

function rqLoadSessions() {
  fetch('/api/notion-timesession')
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(ns) {
      if (!Array.isArray(ns) || !ns.length) { _rqSessionsLoaded = true; return; }
      _rqSessions = ns
        .filter(function(s) { return s.netMin != null; })
        .map(function(s) {
          var parsedItems = null;
          if (s.itemsJson) { try { parsedItems = JSON.parse(s.itemsJson); } catch(e) {} }
          var items = parsedItems || [{ name: s.itemName || '', squareId: s.squareItemId || '', pieces: s.pieces, isCustom: false }];
          return {
            notionPageId: s.notionPageId,
            items: items,
            employee: { name: s.employeeName || '', id: '' },
            startTime: s.startTime || null,
            stopTime:  s.stopTime  || null,
            totalMs:   (s.totalMin || 0) * 60000,
            netMs:     (s.netMin   || 0) * 60000,
            notes:     s.notes || '',
            saved: true, error: null,
            pushed: !!s.pushed,
          };
        });
      _rqSessionsLoaded = true;
      rqRenderSessions();
    })
    .catch(function() { _rqSessionsLoaded = true; });
}

function _rqFmtDur(ms) {
  var m = Math.round(ms / 60000), h = Math.floor(m / 60);
  return h > 0 ? h + 'h ' + (m % 60) + 'm' : m + 'm';
}

function _rqFmtDT(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function rqToggleLog() {
  var section = document.getElementById('rq-log-section');
  if (!section) return;
  section.classList.toggle('rq-log-collapsed');
  var page = document.getElementById('tab-to-restock');
  if (page) page.classList.toggle('rq-log-open', !section.classList.contains('rq-log-collapsed'));
}

// _rqToDateTimeLocal lives in restock.js (loaded first) and is shared — it
// accepts both a ms epoch and an ISO timestamp and guards against null.

function rqStartEditSession(store, i) {
  var s = _rqStoreList(store)[i];
  if (s) s._itemsBackup = JSON.parse(JSON.stringify(s.items || []));
  _rqEditingSession[store] = i; _rqPushingSession[store] = null;
  _rqStoreRender(store);
}

function rqCancelEditSession(store) {
  var s = _rqStoreList(store)[_rqEditingSession[store]];
  if (s && s._itemsBackup) { s.items = s._itemsBackup; delete s._itemsBackup; }
  delete _rqEditAdds[store][_rqEditingSession[store]];
  _rqEditingSession[store] = null;
  _rqStoreRender(store);
}

function rqOpenPushPanel(store, i)  { _rqPushingSession[store] = i; _rqEditingSession[store] = null; _rqStoreRender(store); }
function rqClosePushPanel(store)    { _rqPushingSession[store] = null; _rqStoreRender(store); }

// ── Post-timer inventory prompt ─────────────────────────────────────────────
// The Session Log section (the old home of the ↑ Square push button) was
// removed from jewelry-workflow.html on 2026-06-23 (8df2c5c), which left no
// surface offering the inventory push after a timer stopped. This modal fills
// that gap: rqStopTimer opens it whenever the finished session has
// Square-linked pieces, and Confirm drives the existing rqConfirmPush flow
// against the session's live index in _rqSessions.

var _rqPushPromptSession = null;

function rqShowPushPrompt(session) {
  rqClosePushPrompt();
  var rows = (session.items || []).map(function(it) {
    var safeLabel = (it.name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    var pushable  = it.squareId && !it.isCustom && it.pieces > 0;
    return '<div class="rq-push-item">'
      + '<span class="rq-push-item-name">' + safeLabel + '</span>'
      + (it.pieces != null ? '<span class="rq-push-item-qty">' + it.pieces + ' pc' + (it.pieces !== 1 ? 's' : '') + '</span>' : '')
      + (pushable ? '<span class="rq-push-item-ok">✓</span>' : '<span class="rq-no-sq">no Square match</span>')
      + '</div>';
  }).join('');
  var overlay = document.createElement('div');
  overlay.id = 'rq-push-prompt';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML =
      '<div class="rq-push-panel" style="max-width:420px;width:100%;max-height:80vh;overflow-y:auto;">'
    + '<div style="font-weight:700;margin-bottom:8px;">Add restocked pieces to inventory?</div>'
    + rows
    + '<div style="display:flex;gap:8px;margin-top:10px;">'
    + '<button class="rq-start-confirm-btn" onclick="rqConfirmPromptPush()">↑ Add to Square</button>'
    + '<button class="rq-setup-cancel-btn" onclick="rqClosePushPrompt()">Not Now</button>'
    + '</div></div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) rqClosePushPrompt(); });
  document.body.appendChild(overlay);
  _rqPushPromptSession = session;
}

function rqClosePushPrompt() {
  var el = document.getElementById('rq-push-prompt');
  if (el && el.parentNode) el.parentNode.removeChild(el);
  _rqPushPromptSession = null;
}

function rqConfirmPromptPush() {
  // Resolve the index at click time — another stopped timer may have
  // unshifted more sessions in front since this prompt opened.
  var session = _rqPushPromptSession;
  var i = session ? _rqSessions.indexOf(session) : -1;
  if (i === -1) { rqClosePushPrompt(); return; }
  rqConfirmPush('log', i);
}

function rqConfirmPush(store, i) {
  var s = _rqStoreList(store)[i]; if (!s) return;
  var confirmBtn = document.querySelector('.rq-push-panel .rq-start-confirm-btn');
  var confirmLabel = confirmBtn ? confirmBtn.textContent : 'Confirm Push';
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Pushing…'; }
  // Single source of truth for the Square location — same constant used by
  // the inventory-count fetch below and by js/inventory.js. This used to be
  // a per-browser override (localStorage['sts-square-location']) that
  // defaulted to the same value today but could silently diverge per device.
  var loc = INV_LOCATION_ID;
  var pushItems = (s.items || []).filter(function(it) { return it.squareId && !it.isCustom && it.pieces > 0; });
  if (!pushItems.length) {
    toast('No Square items to push', '⚠');
    _rqPushingSession[store] = null;
    _rqStoreRender(store);
    return;
  }
  var changes = pushItems.map(function(it) {
    return {
      type: 'ADJUSTMENT',
      adjustment: {
        catalog_object_id: it.squareId,
        location_id:       loc,
        quantity:          String(it.pieces),
        from_state:        'NONE',
        to_state:          'IN_STOCK',
        occurred_at:       new Date().toISOString(),
      },
    };
  });
  _rqSqCall('/inventory/changes/batch-create', {
    method: 'POST',
    body: { changes: changes, idempotency_key: 'rq-push-' + (s.notionPageId || Date.now()) },
  }).then(function(data) {
    if (data.errors && data.errors.length) throw new Error(data.errors[0].detail || 'Square error');
    s.pushed = true;
    _rqPushingSession[store] = null;
    _rqStoreRender(store);
    rqClosePushPrompt();
    toast('Pushed to Square ✓', '✓');
    if (s.notionPageId) {
      fetch('/api/notion-timesession', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: s.notionPageId, pushedToSquare: true }),
      }).catch(function() {});
    }
  }).catch(function() {
    toast('Square push failed', '⚠');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = confirmLabel; }
  });
}

// ── Session edit: add missing item(s) ──────────────────────────────────────────

function rqEditOpenAdd(store, i, replaceIdx) {
  _rqEditAdds[store][i] = { query: '', debounceTimer: null, _lastResults: null, variantPicker: null, replaceIdx: (replaceIdx != null ? replaceIdx : null) };
  _rqStoreRender(store);
  setTimeout(function() {
    var inp = document.getElementById('rq-eadd-srch-' + store + '-' + i);
    if (inp) inp.focus();
  }, 50);
}

function rqEditCloseAdd(store, i) {
  var e = _rqEditAdds[store][i];
  if (e && e.debounceTimer) clearTimeout(e.debounceTimer);
  delete _rqEditAdds[store][i];
  _rqStoreRender(store);
}

function rqEditAddInput(store, i, value) {
  var e = _rqEditAdds[store][i]; if (!e) return;
  e.query = value;
  if (e.debounceTimer) clearTimeout(e.debounceTimer);
  if (!value || value.length < 2) {
    var box = document.getElementById('rq-eadd-results-' + store + '-' + i);
    if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    return;
  }
  e.debounceTimer = setTimeout(function() { _rqEditAddSearch(store, i, value); }, 350);
}

function _rqEditAddSearch(store, i, query) {
  var e = _rqEditAdds[store][i]; if (!e) return;
  var spinner = document.getElementById('rq-eadd-spinner-' + store + '-' + i);
  if (spinner) spinner.style.display = 'block';
  var localMatches = _rqLocalSearch(query);
  _rqSqCall('/catalog/search', {
    method: 'POST',
    body: { object_types: ['ITEM'], query: { text_query: { keywords: [query] } }, limit: 20 },
  }).then(function(searchData) {
    if (!_rqEditAdds[store][i]) return;
    var found = searchData.objects || [];
    if (!found.length) { _rqEditAddRenderResults(store, i, localMatches, query); return; }
    return _rqSqCall('/catalog/batch-retrieve', {
      method: 'POST',
      body: { object_ids: found.map(function(o) { return o.id; }) },
    }).then(function(fullData) {
      if (!_rqEditAdds[store][i]) return;
      var rows = localMatches.slice();
      (fullData.objects || []).forEach(function(obj) {
        if (obj.type !== 'ITEM') return;
        var itemName   = obj.item_data ? obj.item_data.name : 'Unnamed';
        var catName    = obj.item_data ? (obj.item_data.category_name || '') : '';
        var variations = obj.item_data ? (obj.item_data.variations || []) : [];
        if (variations.length <= 1) {
          var v = variations[0] ? variations[0].item_variation_data : null;
          var price = v && v.price_money ? v.price_money.amount / 100 : null;
          rows.push({ id: variations[0] ? variations[0].id : obj.id, name: itemName, sku: v ? (v.sku || '') : '', category: catName, isParent: false, price: price });
        } else {
          rows.push({ id: obj.id, name: itemName, category: catName, isParent: true, variantCount: variations.length,
            variants: variations.map(function(vv) {
              var vd = vv.item_variation_data;
              var vp = vd && vd.price_money ? vd.price_money.amount / 100 : null;
              return { id: vv.id, name: vd ? (vd.name || '') : '', sku: vd ? (vd.sku || '') : '', price: vp };
            }) });
        }
      });
      _rqEditAddRenderResults(store, i, rows, query);
    });
  }).catch(function() {
    if (_rqEditAdds[store][i]) _rqEditAddRenderResults(store, i, localMatches, query);
  }).then(function() {
    var sp = document.getElementById('rq-eadd-spinner-' + store + '-' + i);
    if (sp) sp.style.display = 'none';
  });
}

function _rqEditAddRenderResults(store, i, items, query) {
  var e = _rqEditAdds[store][i]; if (!e) return;
  e._lastResults = items;
  var box = document.getElementById('rq-eadd-results-' + store + '-' + i);
  if (!box) return;
  if (!items || !items.length) {
    var safeQ = (query || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    var escQ  = (query || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    box.innerHTML = '<div class="rq-result-none">No match for "' + safeQ + '"</div>'
      + '<div class="rq-result-item" onclick="rqEditAddSelectCustom(\'' + store + '\',' + i + ',\'' + escQ + '\')" style="color:var(--accent);font-weight:600;">＋ Use "' + safeQ + '" as custom item</div>';
    box.style.display = 'flex';
    return;
  }
  box.innerHTML = items.map(function(item) {
    var meta = item.isParent
      ? (item.category || '') + ' · ' + (item.variantCount || '') + ' sizes'
      : (item.category || '') + (item.sku ? ' · ' + item.sku : '');
    var safeId = (item.id || '').replace(/'/g,'').replace(/\\/g,'\\\\');
    return '<div class="rq-result-item" onclick="rqEditAddSelectId(\'' + store + '\',' + i + ',\'' + safeId + '\')">'
      + '<div><div class="rq-result-name">' + (item.name || '').replace(/</g,'&lt;') + '</div>'
      + '<div class="rq-result-meta">' + meta.replace(/</g,'&lt;') + '</div></div>'
      + '</div>';
  }).join('');
  box.style.display = 'flex';
}

function rqEditAddSelectId(store, i, itemId) {
  var e = _rqEditAdds[store][i]; if (!e) return;
  var item = (e._lastResults || []).filter(function(it) { return it.id === itemId; })[0];
  if (!item) return;
  if (e.debounceTimer) clearTimeout(e.debounceTimer);
  if (item.isParent) {
    e.variantPicker = { item: item, selectedIds: [] };
    _rqStoreRender(store);
    return;
  }
  _rqEditAddCommitItem(store, i, { name: item.name, squareId: item.id, pieces: null, isCustom: false, unitPrice: item.price != null ? item.price : null });
}

function rqEditAddSelectCustom(store, i, name) {
  _rqEditAddCommitItem(store, i, { name: name, squareId: '', pieces: null, isCustom: true });
}

function rqEditToggleVariant(store, i, variantId) {
  var e = _rqEditAdds[store][i]; if (!e || !e.variantPicker) return;
  if (e.replaceIdx != null) {
    // Relinking an existing item: one variant pick is enough, commit immediately.
    var v = (e.variantPicker.item.variants || []).filter(function(vv) { return vv.id === variantId; })[0];
    if (!v) return;
    _rqEditAddCommitItem(store, i, { name: e.variantPicker.item.name + ' – ' + (v.name || ''), squareId: v.id, pieces: null, isCustom: false, unitPrice: v.price != null ? v.price : null });
    return;
  }
  var idx = e.variantPicker.selectedIds.indexOf(variantId);
  if (idx === -1) e.variantPicker.selectedIds.push(variantId);
  else e.variantPicker.selectedIds.splice(idx, 1);
  _rqStoreRender(store);
}

function rqEditCancelVariantPicker(store, i) {
  var e = _rqEditAdds[store][i]; if (!e) return;
  e.variantPicker = null;
  _rqStoreRender(store);
}

function rqEditConfirmVariants(store, i) {
  var e = _rqEditAdds[store][i]; if (!e || !e.variantPicker) return;
  var picker = e.variantPicker;
  var selected = (picker.item.variants || []).filter(function(v) { return picker.selectedIds.indexOf(v.id) !== -1; });
  if (!selected.length) return;
  var s = _rqStoreList(store)[i]; if (!s) return;
  s.items = (s.items || []).concat(selected.map(function(v) {
    return { name: picker.item.name + ' – ' + (v.name || ''), squareId: v.id, pieces: null, isCustom: false, unitPrice: v.price != null ? v.price : null };
  }));
  delete _rqEditAdds[store][i];
  _rqStoreRender(store);
}

function _rqEditAddCommitItem(store, i, item) {
  var s = _rqStoreList(store)[i]; if (!s) return;
  var e = _rqEditAdds[store][i];
  var replaceIdx = e ? e.replaceIdx : null;
  if (replaceIdx != null && s.items && s.items[replaceIdx]) {
    var oldItem = s.items[replaceIdx];
    s.items = s.items.map(function(it, idx) {
      return idx === replaceIdx ? Object.assign({}, item, { pieces: oldItem.pieces }) : it;
    });
  } else {
    s.items = (s.items || []).concat([item]);
  }
  delete _rqEditAdds[store][i];
  _rqStoreRender(store);
}

function rqEditRemoveItem(store, i, idx) {
  var s = _rqStoreList(store)[i]; if (!s) return;
  s.items = (s.items || []).filter(function(_, ii) { return ii !== idx; });
  _rqStoreRender(store);
}

function _rqEditAddPanelHTML(store, i, e) {
  var replacingLabel = '';
  if (e.replaceIdx != null) {
    var sess = _rqStoreList(store)[i];
    var oldIt = sess && sess.items && sess.items[e.replaceIdx];
    if (oldIt) {
      replacingLabel = '<div class="rq-result-meta" style="margin-bottom:4px;">Re-linking <strong>' + (oldIt.name || '').replace(/</g,'&lt;') + '</strong> — search Square or use custom:</div>';
    }
  }
  if (e.variantPicker) {
    var picker = e.variantPicker;
    return replacingLabel + '<div class="rq-variant-picker">'
      + '<div class="rq-variant-label">Choose size' + (e.replaceIdx != null ? '' : '(s)') + ' for <strong>' + (picker.item.name || '').replace(/</g,'&lt;') + '</strong></div>'
      + '<div class="rq-variant-grid">'
      + (picker.item.variants || []).map(function(v) {
          var isSel = picker.selectedIds.indexOf(v.id) !== -1;
          var safeVId = (v.id || '').replace(/'/g,'').replace(/\\/g,'\\\\');
          return '<div class="rq-variant-chip' + (isSel ? ' rq-variant-chip-on' : '') + '"'
            + ' onclick="rqEditToggleVariant(\'' + store + '\',' + i + ',\'' + safeVId + '\')">'
            + (v.name || '').replace(/</g,'&lt;')
            + '</div>';
        }).join('')
      + '</div>'
      + '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;">'
      + (e.replaceIdx != null ? '' : '<button class="rq-variant-done" onclick="rqEditConfirmVariants(\'' + store + '\',' + i + ')">Add</button>')
      + '<button class="rq-setup-cancel-btn" onclick="rqEditCancelVariantPicker(\'' + store + '\',' + i + ')">Cancel</button>'
      + '</div></div>';
  }
  return replacingLabel + '<div class="rq-setup-search-wrap" style="margin-top:6px;">'
    + '<span class="rq-setup-search-icon">⌕</span>'
    + '<input type="text" class="rq-setup-search-input" id="rq-eadd-srch-' + store + '-' + i + '" placeholder="Search Square catalog…" autocomplete="off"'
    + ' oninput="rqEditAddInput(\'' + store + '\',' + i + ',this.value)">'
    + '<div class="rq-setup-spinner" id="rq-eadd-spinner-' + store + '-' + i + '"></div>'
    + '</div>'
    + '<div class="rq-setup-results" id="rq-eadd-results-' + store + '-' + i + '"></div>'
    + '<button class="rq-setup-cancel-btn" style="margin-top:4px;" onclick="rqEditCloseAdd(\'' + store + '\',' + i + ')">Cancel</button>';
}

// Shared edit panel (start/stop time, per-item piece inputs + remove, add-item
// search/variant picker, Save/Cancel) used by both the Session Log and the
// Production Report — they edit the same underlying session record.
function _rqSessionEditRowHTML(store, i, s) {
  if (_rqEditingSession[store] !== i) return '';
  var editAdd = _rqEditAdds[store][i];
  return '<div class="rq-edit-row">'
    + '<div class="rq-edit-field"><label>Start</label><input class="rq-edit-input" type="datetime-local" id="rq-edit-start-' + store + '-' + i + '" value="' + _rqToDateTimeLocal(s.startTime) + '"></div>'
    + '<div class="rq-edit-field"><label>Stop</label><input class="rq-edit-input" type="datetime-local" id="rq-edit-stop-' + store + '-' + i + '" value="' + _rqToDateTimeLocal(s.stopTime) + '"></div>'
    + '<div class="rq-edit-field"><label>Labor Rate</label><input class="rq-edit-input" type="number" min="0" step="0.5" placeholder="$/hr" id="rq-edit-rate-' + store + '-' + i + '" value="' + (s.laborRate != null ? s.laborRate : '') + '"></div>'
    + (s.items || []).map(function(it, ii) {
        var safeLabel = (it.name || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
        return '<div class="rq-edit-field">'
          + '<input class="rq-edit-input rq-name-input" type="text" style="flex:1;width:auto;" id="rq-edit-name-' + store + '-' + i + '-' + ii + '" value="' + safeLabel + '" placeholder="Item title">'
          + '<input class="rq-edit-input rq-piece-input" type="number" min="0" step="1" id="rq-edit-pcs-' + store + '-' + i + '-' + ii + '" placeholder="pcs" value="' + (it.pieces != null ? it.pieces : '') + '">'
          + '<input class="rq-edit-input rq-price-input" type="number" min="0" step="0.01" id="rq-edit-price-' + store + '-' + i + '-' + ii + '" placeholder="$ unit price" value="' + (it.unitPrice != null ? it.unitPrice : '') + '">'
          + '<button class="rq-item-remove" title="Re-link to Square item" onclick="rqEditOpenAdd(\'' + store + '\',' + i + ',' + ii + ')">⌕</button>'
          + '<button class="rq-item-remove" onclick="rqEditRemoveItem(\'' + store + '\',' + i + ',' + ii + ')">✕</button>'
          + '</div>';
      }).join('')
    + (editAdd ? _rqEditAddPanelHTML(store, i, editAdd) : '<button class="rq-adjust-link" style="margin-top:4px;" onclick="rqEditOpenAdd(\'' + store + '\',' + i + ')">+ Add item</button>')
    + '<div style="display:flex;gap:8px;margin-top:2px;">'
    + '<button class="rq-sbar-act-btn" style="border-color:#3A7A4A;color:#3A7A4A;" onclick="rqSaveEditSession(\'' + store + '\',' + i + ')">Save</button>'
    + '<button class="rq-sbar-act-btn" onclick="rqCancelEditSession(\'' + store + '\')">Cancel</button>'
    + '</div></div>';
}

function rqSaveEditSession(store, i) {
  var s = _rqStoreList(store)[i]; if (!s) return;
  var startEl = document.getElementById('rq-edit-start-' + store + '-' + i);
  var stopEl  = document.getElementById('rq-edit-stop-'  + store + '-' + i);
  var newStart = startEl && startEl.value ? new Date(startEl.value).toISOString() : s.startTime;
  var newStop  = stopEl  && stopEl.value  ? new Date(stopEl.value).toISOString()  : s.stopTime;
  if (newStart && newStop && new Date(newStop) <= new Date(newStart)) {
    toast('Stop time must be after start time', '⚠'); return;
  }
  s.startTime = newStart; s.stopTime = newStop;
  if (newStart && newStop) {
    s.totalMs = new Date(newStop) - new Date(newStart);
    s.netMs   = Math.max(0, s.totalMs - 15 * 60000);
  }
  var rateEl = document.getElementById('rq-edit-rate-' + store + '-' + i);
  var newRate = null;
  if (rateEl) {
    var rawRate = rateEl.value.trim();
    if (rawRate !== '') { var parsedRate = parseFloat(rawRate); if (!isNaN(parsedRate)) newRate = parsedRate; }
  }
  var rateChanged = newRate !== (s.laborRate != null ? s.laborRate : null);
  s.laborRate = newRate;
  // Read per-item piece count + unit price edits; drop any row left blank
  var updatedItems = (s.items || []).map(function(it, ii) {
    var nameInp = document.getElementById('rq-edit-name-' + store + '-' + i + '-' + ii);
    var pcsInp = document.getElementById('rq-edit-pcs-' + store + '-' + i + '-' + ii);
    var priceInp = document.getElementById('rq-edit-price-' + store + '-' + i + '-' + ii);
    var next = it;
    if (nameInp) {
      var rawName = nameInp.value.trim();
      if (rawName) next = Object.assign({}, next, { name: rawName });
    }
    if (pcsInp) {
      var rawPcs = pcsInp.value.trim();
      var pcs = rawPcs !== '' ? parseInt(rawPcs, 10) : null;
      next = Object.assign({}, next, { pieces: isNaN(pcs) ? null : pcs });
    }
    if (priceInp) {
      var rawPrice = priceInp.value.trim();
      var price = rawPrice !== '' ? parseFloat(rawPrice) : null;
      if (!isNaN(price) && price !== null) {
        // Manually entered price is authoritative, not a Square-fallback guess.
        next = Object.assign({}, next, { unitPrice: price, _priceIsEstimate: false });
      } else if (rawPrice === '') {
        next = Object.assign({}, next, { unitPrice: null, _priceIsEstimate: false });
      }
    }
    return next;
  }).filter(function(it) { return it.pieces != null; });
  delete s._itemsBackup;
  delete _rqEditAdds[store][i];
  _rqEditingSession[store] = null;

  // Newly added items won't have a unitPrice snapshot yet — fetch it now.
  // Items that already had one (priced at original Stop & Save) are left untouched.
  _rqAttachItemPrices(updatedItems).then(function(pricedItems) {
    s.items = pricedItems;
    var totalPcs = null;
    pricedItems.forEach(function(it) { if (it.pieces != null) totalPcs = (totalPcs || 0) + it.pieces; });
    _rqStoreRender(store);
    if (!s.notionPageId) return;
    var patch = { pageId: s.notionPageId };
    if (newStart) patch.startTime = newStart;
    if (newStop)  patch.stopTime  = newStop;
    if (newStart && newStop) {
      patch.totalMin = parseFloat((s.totalMs / 60000).toFixed(2));
      patch.netMin   = parseFloat((s.netMs   / 60000).toFixed(2));
    }
    if (totalPcs != null) patch.pieces = totalPcs;
    if (rateChanged && newRate != null) patch.laborRate = newRate;
    patch.itemsJson = JSON.stringify(pricedItems);
    patch.itemName  = (pricedItems[0] && pricedItems[0].name) || '';
    return fetch('/api/notion-timesession', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        if (!res.ok) { toast('Notion update failed', '⚠'); return; }
        if (res.data && res.data.warning) { toast(res.data.warning, '⚠'); return; }
        toast('Session updated ✓', '✓');
      });
  }).catch(function() { _rqStoreRender(store); toast('Network error', '⚠'); });
}

// ── Production Report ────────────────────────────────────────────────────────
// Read-only, per-session card view (same layout as the Session Log) with
// Labor Cost, Item Value, and Profit Margin added. Labor Rate and per-item
// unit price are snapshotted once at first Stop & Save (see rqStopTimer /
// _rqAttachItemPrices) so historical figures don't drift if rates or prices
// change later. Sessions saved before this existed fall back to current
// rate/price and are marked "(est.)".

var RQ_RATE_PEOPLE   = ['Vanessa', 'Stevie', 'Kyle'];
var _rqRatesPanelOpen = false;
var _rqReportSessions = null;
var _rqReportLoading  = false;

function _rqLoadRates() {
  try { return JSON.parse(localStorage.getItem('sts-employee-rates') || '{}'); }
  catch (e) { return {}; }
}

function _rqSaveRatesObj(rates) {
  localStorage.setItem('sts-employee-rates', JSON.stringify(rates));
}

// Notion's Employee field stores full names, but rates are keyed by the
// short first name used in the queue assignee dropdown — alias them so
// historical sessions still resolve to a rate (see rqSyncShiftsForSession's
// KNOWN map for the same full-name/short-name mismatch).
var RQ_NAME_ALIASES = { 'Vanessa Bigley': 'Vanessa', 'Stevana Schafer': 'Stevie', 'Stevana': 'Stevie' };

function _rqRateFor(name) {
  var rates = _rqLoadRates();
  var key = RQ_NAME_ALIASES[name] || name;
  var r = rates[key];
  return (typeof r === 'number' && !isNaN(r)) ? r : 0;
}

function _rqRenderRatesPanel() {
  var el = document.getElementById('prod-report-rates');
  if (!el) return;
  if (!_rqRatesPanelOpen) {
    el.innerHTML = '<button class="rq-adjust-link" onclick="rqToggleRatesPanel()">✎ Edit Rates</button>';
    return;
  }
  var rates = _rqLoadRates();
  el.innerHTML = '<div class="rq-edit-row">'
    + RQ_RATE_PEOPLE.map(function(name) {
        return '<div class="rq-edit-field"><label style="width:60px;">' + name + '</label>'
          + '<input class="rq-edit-input" type="number" min="0" step="0.5" id="rq-rate-' + name + '" placeholder="$/hr" value="' + (rates[name] != null ? rates[name] : '') + '"></div>';
      }).join('')
    + '<div style="display:flex;gap:8px;margin-top:2px;">'
    + '<button class="rq-sbar-act-btn" style="border-color:#3A7A4A;color:#3A7A4A;" onclick="rqSaveRatesPanel()">Save</button>'
    + '<button class="rq-sbar-act-btn" onclick="rqToggleRatesPanel()">Cancel</button>'
    + '</div></div>';
}

function rqToggleRatesPanel() {
  _rqRatesPanelOpen = !_rqRatesPanelOpen;
  _rqRenderRatesPanel();
}

function rqSaveRatesPanel() {
  var rates = {};
  RQ_RATE_PEOPLE.forEach(function(name) {
    var inp = document.getElementById('rq-rate-' + name);
    var v = inp && inp.value.trim() !== '' ? parseFloat(inp.value.trim()) : null;
    rates[name] = (v != null && !isNaN(v)) ? v : 0;
  });
  _rqSaveRatesObj(rates);
  _rqRatesPanelOpen = false;
  _rqRenderRatesPanel();
  if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions);
  toast('Rates saved ✓', '✓');
}

// Fetches Square prices for any item lacking a stored unitPrice and attaches
// them. Items that already have a unitPrice (a prior snapshot) are left untouched.
function _rqAttachItemPrices(items) {
  var needPricing = (items || []).filter(function(it) { return it.squareId && !it.isCustom && it.unitPrice == null; });
  if (!needPricing.length) return Promise.resolve(items);
  var ids = needPricing.map(function(it) { return it.squareId; });
  return _rqSqCall('/catalog/batch-retrieve', { method: 'POST', body: { object_ids: ids } })
    .then(function(data) {
      var priceById = {};
      (data.objects || []).forEach(function(obj) {
        if (obj.type !== 'ITEM_VARIATION') return;
        var vd = obj.item_variation_data || {};
        priceById[obj.id] = vd.price_money ? vd.price_money.amount / 100 : null;
      });
      return items.map(function(it) {
        if (it.unitPrice != null || !it.squareId || it.isCustom) return it;
        return Object.assign({}, it, { unitPrice: priceById[it.squareId] != null ? priceById[it.squareId] : null });
      });
    })
    .catch(function() { return items; });
}

function rqRenderProductionReport(forceRefresh) {
  _rqRenderRatesPanel();
  var body = document.getElementById('prod-report-body');
  if (!body) return;
  if (_rqReportSessions && !forceRefresh) { _rqRenderReportBody(_rqReportSessions); return; }
  if (_rqReportLoading) return;
  _rqReportLoading = true;
  body.innerHTML = '<div style="text-align:center;color:#B0A898;font-size:14px;padding:40px 0;">Loading…</div>';
  fetch('/api/notion-timesession?all=true')
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(ns) {
      var sessions = (Array.isArray(ns) ? ns : []).filter(function(s) { return s.netMin != null; }).map(function(s) {
        var parsedItems = null;
        if (s.itemsJson) { try { parsedItems = JSON.parse(s.itemsJson); } catch (e) {} }
        var items = parsedItems || (s.itemName ? [{ name: s.itemName, squareId: s.squareItemId || '', pieces: s.pieces, isCustom: false, unitPrice: null }] : []);
        return {
          notionPageId: s.notionPageId,
          items: items,
          employee: { name: s.employeeName || '' },
          startTime: s.startTime, stopTime: s.stopTime,
          netMs: (s.netMin || 0) * 60000,
          laborRate: s.laborRate != null ? s.laborRate : null,
        };
      });
      return _rqFillReportPriceFallbacks(sessions);
    })
    .then(function(sessions) {
      _rqReportSessions = sessions;
      _rqReportLoading = false;
      _rqRenderReportBody(sessions);
    })
    .catch(function() {
      _rqReportLoading = false;
      body.innerHTML = '<div style="text-align:center;color:#A0402A;font-size:13px;padding:30px 0;">Failed to load report</div>';
    });
}

// Live-priced fallback for sessions saved before snapshotting existed — flagged
// with _priceIsEstimate so the report can mark them "(est.)" rather than passing
// them off as locked-in historical figures.
function _rqFillReportPriceFallbacks(sessions) {
  var idsNeeded = {};
  sessions.forEach(function(s) {
    (s.items || []).forEach(function(it) {
      if (it.unitPrice == null && it.squareId && !it.isCustom) idsNeeded[it.squareId] = true;
    });
  });
  var ids = Object.keys(idsNeeded);
  if (!ids.length) return Promise.resolve(sessions);
  return _rqSqCall('/catalog/batch-retrieve', { method: 'POST', body: { object_ids: ids } })
    .then(function(data) {
      var priceById = {};
      (data.objects || []).forEach(function(obj) {
        if (obj.type !== 'ITEM_VARIATION') return;
        var vd = obj.item_variation_data || {};
        priceById[obj.id] = vd.price_money ? vd.price_money.amount / 100 : null;
      });
      sessions.forEach(function(s) {
        (s.items || []).forEach(function(it) {
          if (it.unitPrice == null && it.squareId && priceById[it.squareId] != null) {
            it.unitPrice = priceById[it.squareId];
            it._priceIsEstimate = true;
          }
        });
      });
      return sessions;
    })
    .catch(function() { return sessions; });
}

function _rqRenderReportBody(sessions) {
  var body = document.getElementById('prod-report-body');
  var summaryEl = document.getElementById('prod-report-summary');
  if (!body) return;
  if (!sessions.length) {
    body.innerHTML = '<div style="text-align:center;color:#B0A898;font-size:14px;padding:40px 0;">No production data yet</div>';
    if (summaryEl) summaryEl.innerHTML = '';
    return;
  }

  var grandLabor = 0, grandValue = 0;

  var cards = sessions.map(function(s, i) {
    var primaryName = (s.items && s.items[0] && s.items[0].name) || '—';
    var extraCount  = (s.items && s.items.length > 1) ? ' +' + (s.items.length - 1) + ' more' : '';
    var safeName    = (primaryName + extraCount).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    var emp         = s.employee ? s.employee.name : '';

    var totalPcs = null;
    (s.items || []).forEach(function(it) { if (it.pieces != null) totalPcs = (totalPcs || 0) + it.pieces; });

    var hrs           = (s.netMs || 0) / 3600000;
    var rateIsEstimate = s.laborRate == null;
    var rate          = rateIsEstimate ? _rqRateFor(emp) : s.laborRate;
    var laborCost     = hrs * rate;

    var hasAnyValue   = (s.items || []).some(function(it) { return it.pieces != null && it.unitPrice != null; });
    var valueIsEstimate = false;
    var itemValue     = 0;
    (s.items || []).forEach(function(it) {
      if (it.pieces == null || it.unitPrice == null) return;
      itemValue += it.pieces * it.unitPrice;
      if (it._priceIsEstimate) valueIsEstimate = true;
    });
    var profit = itemValue - laborCost;

    grandLabor += laborCost;
    if (hasAnyValue) grandValue += itemValue;

    var laborTxt  = 'Labor: $' + laborCost.toFixed(2) + ' (' + hrs.toFixed(1) + 'h × $' + rate.toFixed(2) + '/hr)' + (rateIsEstimate ? ' (est.)' : '');
    var valueTxt  = hasAnyValue ? 'Value: $' + itemValue.toFixed(2) + (valueIsEstimate ? ' (est.)' : '') : 'Value: —';
    var profitTxt = hasAnyValue ? 'Profit: ' + (profit >= 0 ? '+$' + profit.toFixed(2) : '-$' + Math.abs(profit).toFixed(2)) : 'Profit: —';
    var profitColor = profit >= 0 ? '#3A7A4A' : '#A0402A';

    var editRow = _rqSessionEditRowHTML('report', i, s);

    return '<div class="rq-session-bar">'
      + '<div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:2px;">'
      + '<div style="flex:1;min-width:0;">'
      + '<div class="rq-sbar-name">' + safeName + (totalPcs != null ? ' <span class="rq-sbar-pcs-inline">· ' + totalPcs + ' pc' + (totalPcs !== 1 ? 's' : '') + '</span>' : '') + '</div>'
      + (emp ? '<div class="rq-sbar-meta">' + emp + '</div>' : '')
      + '</div>'
      + '<button class="rq-sbar-del" onclick="rqDeleteReportSession(' + i + ')" title="Delete">✕</button>'
      + '</div>'
      + '<div class="rq-sbar-time-row">'
      + '<span class="rq-sbar-time-val">▶ ' + _rqFmtDT(s.startTime) + '</span>'
      + '<span style="color:#ccc">·</span>'
      + '<span class="rq-sbar-time-val">⏹ ' + _rqFmtDT(s.stopTime) + '</span>'
      + '<button class="rq-sbar-act-btn" onclick="rqStartEditSession(\'report\',' + i + ')">✎ Edit</button>'
      + (s.startTime && s.stopTime ? '<button class="rq-sbar-act-btn" id="rq-sync-btn-report-' + i + '" onclick="rqSyncShiftsForSession(\'report\',' + i + ')">⟳ Sync</button>' : '')
      + '</div>'
      + '<div class="rq-sbar-footer" style="flex-wrap:wrap;">'
      + '<span class="rq-sbar-net">Net: ' + _rqFmtDur(s.netMs) + '</span>'
      + '<span class="rq-sbar-pieces">' + laborTxt + '</span>'
      + '<span class="rq-sbar-pieces">' + valueTxt + '</span>'
      + '<span class="rq-sbar-pieces" style="font-weight:700;color:' + profitColor + ';">' + profitTxt + '</span>'
      + '</div>'
      + editRow
      + '</div>';
  }).join('');

  body.innerHTML = cards;
  if (summaryEl) {
    var grandProfit = grandValue - grandLabor;
    summaryEl.innerHTML = '<div class="prod-report-summary">'
      + '<span>' + sessions.length + ' session' + (sessions.length !== 1 ? 's' : '') + '</span>'
      + '<span>Total Labor: <b>$' + grandLabor.toFixed(2) + '</b></span>'
      + '<span>Total Value: <b>$' + grandValue.toFixed(2) + '</b></span>'
      + '<span>Total Profit: <b style="color:' + (grandProfit >= 0 ? '#3A7A4A' : '#A0402A') + ';">' + (grandProfit >= 0 ? '+$' + grandProfit.toFixed(2) : '-$' + Math.abs(grandProfit).toFixed(2)) + '</b></span>'
      + '</div>';
  }
}

function rqSyncShiftsForSession(store, i) {
  // Reconciliation itself (Square shift lookup + timeline math + Notion write)
  // lives server-side in /api/square-sync now — this just triggers it for one
  // session and reflects the result locally. See docs/adr/0002.
  var sessions = store === 'report' ? _rqReportSessions : _rqSessions;
  var s = sessions && sessions[i]; if (!s || !s.startTime || !s.stopTime) return Promise.resolve(false);
  if (!s.notionPageId) { toast('Timeline sync needs a linked Notion page', '⚠'); return Promise.resolve(false); }
  var btn = document.getElementById('rq-sync-btn-' + store + '-' + i);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  var render = function() { if (store === 'report') { _rqRenderReportBody(_rqReportSessions); } else { rqRenderSessions(); } };
  return fetch('/api/square-sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageId: s.notionPageId }),
  }).then(function(r) { return r.json().then(function(data) { return { r: r, data: data }; }); })
    .then(function(res) {
      var r = res.r, data = res.data;
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Sync'; }
      if (!r.ok) { toast('Sync error: ' + (data.error || r.status), '⚠'); return false; }
      if (data.status === 'synced') {
        s.notes = data.notes; s.totalMs = data.totalMs; s.netMs = data.netMs;
        render();
        toast('Timeline & times synced ✓', '✓');
        return true;
      }
      if (data.status === 'pending') { toast('No Square shift found yet — will keep retrying automatically', '⚠'); return false; }
      if (data.status === 'failed') { toast('Sync failed: ' + (data.reason || 'no matching Square shift'), '⚠'); return false; }
      toast('Nothing to sync', '⚠');
      return false;
    })
    .catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Sync'; }
      toast('Network error', '⚠');
      return false;
    });
}

function _rqSessionMissingShiftSync(s) {
  return !!(s && s.startTime && s.stopTime) && !/— Session Timeline —/.test(s.notes || '');
}

function rqSyncMissingSessions(store) {
  var sessions = store === 'report' ? _rqReportSessions : _rqSessions;
  var btn = document.getElementById(store === 'report' ? 'rq-sync-missing-btn' : 'rq-sync-missing-btn-log');
  var eligible = [];
  (sessions || []).forEach(function(s, i) { if (_rqSessionMissingShiftSync(s)) eligible.push(i); });
  if (!eligible.length) { toast('No sessions are missing Square clock in/out data', '✓'); return Promise.resolve(); }
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Syncing…'; }
  var done = 0, tried = 0;
  function next() {
    if (tried >= eligible.length) {
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Sync Missing'; }
      toast('Synced ' + done + '/' + tried + ' session' + (tried !== 1 ? 's' : ''), done === tried ? '✓' : '⚠');
      return;
    }
    var i = eligible[tried];
    tried++;
    if (btn) btn.textContent = '⟳ ' + tried + '/' + eligible.length + '…';
    rqSyncShiftsForSession(store, i).then(function(ok) { if (ok) done++; next(); });
  }
  next();
}

function rqRenderSessions() {
  var list = document.getElementById('rq-log-list');
  if (!list) return;
  if (!_rqSessions.length) {
    list.innerHTML = '<div class="rq-log-empty">No sessions recorded yet</div>';
    return;
  }
  list.innerHTML = _rqSessions.map(function(s, i) {
    var primaryName = (s.items && s.items[0] && s.items[0].name) || '—';
    var extraCount  = (s.items && s.items.length > 1) ? ' +' + (s.items.length - 1) + ' more' : '';
    var name   = primaryName + extraCount;
    var emp    = s.employee ? s.employee.name : '';
    var status = s.error
      ? '<span class="rq-sbar-err">⚠ ' + s.error + '</span>'
      : s.saved ? '<span class="rq-sbar-saved">✓ Saved</span>' : '<span style="color:var(--text-dim)">Saving…</span>';

    // Pieces summary
    var totalPcs = null;
    (s.items || []).forEach(function(it) { if (it.pieces != null) totalPcs = (totalPcs || 0) + it.pieces; });
    var piecesLabel = totalPcs != null ? totalPcs + ' pc' + (totalPcs !== 1 ? 's' : '') + ' made' : '';

    // Push button — show when not yet pushed and at least one real Square item
    // has pieces. Deliberately independent of the Notion save state (saved /
    // error): the Square push never touches Notion, so a slow or failed
    // Notion save must not hide the inventory push.
    var canPush = !s.pushed
      && (s.items || []).some(function(it) { return it.squareId && !it.isCustom && it.pieces > 0; });
    var pushBtn = s.pushed
      ? '<span class="rq-pushed-label">↑ Pushed</span>'
      : canPush ? '<button class="rq-push-btn" onclick="rqOpenPushPanel(\'log\',' + i + ')">↑ Square</button>' : '';

    var timeRow = '<div class="rq-sbar-time-row">'
      + '<span class="rq-sbar-time-val">▶ ' + _rqFmtDT(s.startTime) + '</span>'
      + '<span style="color:#ccc">·</span>'
      + '<span class="rq-sbar-time-val">⏹ ' + _rqFmtDT(s.stopTime) + '</span>'
      + '<button class="rq-sbar-act-btn" onclick="rqStartEditSession(\'log\',' + i + ')">✎ Edit</button>'
      + (s.startTime && s.stopTime ? '<button class="rq-sbar-act-btn" id="rq-sync-btn-log-' + i + '" onclick="rqSyncShiftsForSession(\'log\',' + i + ')">⟳ Sync</button>' : '')
      + '</div>';

    var editRow = _rqSessionEditRowHTML('log', i, s);

    var isPushing = _rqPushingSession.log === i;
    var pushPanel = isPushing
      ? '<div class="rq-push-panel">'
        + (s.items || []).map(function(it) {
            var safeLabel = (it.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
            var pushable  = it.squareId && !it.isCustom && it.pieces > 0;
            return '<div class="rq-push-item">'
              + '<span class="rq-push-item-name">' + safeLabel + '</span>'
              + (it.pieces != null ? '<span class="rq-push-item-qty">' + it.pieces + ' pc' + (it.pieces !== 1 ? 's' : '') + '</span>' : '')
              + (pushable ? '<span class="rq-push-item-ok">✓</span>' : '<span class="rq-no-sq">no Square match</span>')
              + '</div>';
          }).join('')
        + '<div style="display:flex;gap:8px;margin-top:8px;">'
        + '<button class="rq-start-confirm-btn" onclick="rqConfirmPush(\'log\',' + i + ')">Confirm Push</button>'
        + '<button class="rq-setup-cancel-btn" onclick="rqClosePushPanel(\'log\')">Cancel</button>'
        + '</div></div>'
      : '';

    return '<div class="rq-session-bar">'
      + '<div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:2px;">'
      + '<div style="flex:1;min-width:0;">'
      + '<div class="rq-sbar-name">' + name.replace(/&/g,'&amp;').replace(/</g,'&lt;')
        + (piecesLabel ? ' <span class="rq-sbar-pcs-inline">· ' + totalPcs + ' pc' + (totalPcs !== 1 ? 's' : '') + '</span>' : '') + '</div>'
      + (emp ? '<div class="rq-sbar-meta">' + emp + '</div>' : '')
      + '</div>'
      + '<button class="rq-sbar-del" onclick="rqDeleteSession(' + i + ')" title="Delete">✕</button>'
      + '</div>'
      + timeRow
      + '<div class="rq-sbar-footer">'
      + '<span class="rq-sbar-net">Net: ' + _rqFmtDur(s.netMs) + '</span>'
      + (s.notes ? '<span style="color:var(--text3);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;">' + s.notes.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>' : '')
      + status
      + pushBtn
      + '</div>'
      + editRow
      + pushPanel
      + '</div>';
  }).join('');
}

function rqDeleteSession(i) {
  var s = _rqSessions[i]; if (!s) return;
  var name = (s.items && s.items[0] && s.items[0].name) || '?';
  if (!confirm('Delete this session?\n' + name + ' — ' + (s.employee ? s.employee.name : ''))) return;
  if (s.notionPageId) {
    fetch('/api/notion-timesession?pageId=' + encodeURIComponent(s.notionPageId), { method: 'DELETE' }).catch(function() {});
  }
  _rqSessions.splice(i, 1);
  rqRenderSessions();
}

function rqDeleteReportSession(i) {
  var s = _rqReportSessions && _rqReportSessions[i]; if (!s) return;
  var name = (s.items && s.items[0] && s.items[0].name) || '?';
  if (!confirm('Permanently delete this entry?\n' + name + ' — ' + (s.employee ? s.employee.name : '') + '\nThis cannot be undone.')) return;
  if (s.notionPageId) {
    fetch('/api/notion-timesession?pageId=' + encodeURIComponent(s.notionPageId), { method: 'DELETE' }).catch(function() {});
  }
  _rqReportSessions.splice(i, 1);
  _rqRenderReportBody(_rqReportSessions);
}

