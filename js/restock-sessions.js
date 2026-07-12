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
            laborRate: s.laborRate != null ? s.laborRate : null,
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
  // Phase 5 close-out: append the BOM-computed "Materials used" section
  if (typeof coAttachToPushPrompt === 'function') coAttachToPushPrompt(session);
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
    // Phase 5 close-out: after a successful push from the post-timer prompt,
    // decrement the staged material consumption (no-op from other panels)
    if (typeof coApplyFromPrompt === 'function' && document.getElementById('co-section')) coApplyFromPrompt();
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
    // Preserve the session's existing deduction (Square-reconciled clocked-out
    // time, or the default 15 min) instead of resetting to a flat 15 min —
    // editing times used to silently wipe the /api/square-sync reconciliation.
    var prevDedMs = Math.max(0, (s.totalMs || 0) - (s.netMs || 0)) || 15 * 60000;
    s.totalMs = new Date(newStop) - new Date(newStart);
    s.netMs   = Math.max(0, s.totalMs - prevDedMs);
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
  });
  // No blank-pieces filter here: legacy sessions load with pieces == null, and
  // dropping those rows on Save silently erased their items. Removal is the
  // explicit ✕ button only.
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
      patch.dedMin   = parseFloat(((s.totalMs - s.netMs) / 60000).toFixed(2));
    }
    if (totalPcs != null) patch.pieces = totalPcs;
    // Send the rate even when cleared (null) — omitting it left the old rate
    // in Notion, so a cleared field reappeared on the next load.
    if (rateChanged) patch.laborRate = newRate;
    patch.itemsJson = JSON.stringify(_rqItemsForJson(pricedItems));
    patch.itemName  = (pricedItems[0] && pricedItems[0].name) || '';
    return fetch('/api/notion-timesession', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        if (!res.ok) { toast('Notion update failed', '⚠'); return; }
        // The other store's copy of this session is now stale — drop the
        // report cache / refetch the log so both surfaces agree.
        if (store === 'log') { _rqReportSessions = null; }
        else { rqLoadSessions(); }
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

// ── Shared settings (rates + material costs) ────────────────────────────────
// Rates/material costs are Notion-backed via /api/prod-settings so every
// device agrees; localStorage is just the offline cache. Rates that lived
// only in localStorage were per-browser, so timers stopped on the shop
// tablet snapshotted $0/hr labor.

var _rqSettingsSynced = false;
var _rqMatSaveTimer   = null;

function _rqLoadMatCosts() {
  try { return JSON.parse(localStorage.getItem('sts-material-costs') || '{}'); }
  catch (e) { return {}; }
}

function _rqMatCostFor(key) {
  var m = _rqLoadMatCosts();
  var v = m[key];
  return (typeof v === 'number' && !isNaN(v)) ? v : null;
}

function _rqSyncProdSettings() {
  if (_rqSettingsSynced) return;
  _rqSettingsSynced = true; // fetch once per page load; every Save re-PUTs
  fetch('/api/prod-settings')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(cfg) {
      if (!cfg) return;
      if (cfg.rates && typeof cfg.rates === 'object') _rqSaveRatesObj(cfg.rates);
      if (cfg.materialCosts && typeof cfg.materialCosts === 'object') {
        localStorage.setItem('sts-material-costs', JSON.stringify(cfg.materialCosts));
      }
      if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions);
    })
    .catch(function() {});
}

function _rqPushProdSettings() {
  fetch('/api/prod-settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rates: _rqLoadRates(), materialCosts: _rqLoadMatCosts() }),
  }).then(function(r) {
    if (!r.ok) toast('Settings sync failed — saved on this device only', '⚠');
  }).catch(function() {
    toast('Settings sync failed — saved on this device only', '⚠');
  });
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
  // null (not 0) when unset: a 0 here used to get snapshotted to Notion as an
  // authoritative $0/hr rate on any device where rates were never entered,
  // permanently zeroing that session's labor cost in the report.
  return (typeof r === 'number' && !isNaN(r) && r > 0) ? r : null;
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
  _rqPushProdSettings();
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
  _rqSyncProdSettings();
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
          category: s.category || '',
          startTime: s.startTime, stopTime: s.stopTime,
          totalMs: (s.totalMin || 0) * 60000,
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
  _rqRenderReportControls();
  if (!sessions.length) {
    body.innerHTML = '<div style="text-align:center;color:#B0A898;font-size:14px;padding:40px 0;">No production data yet</div>';
    if (summaryEl) summaryEl.innerHTML = '';
    return;
  }

  var idxs = _rqVisibleReportIdxs(sessions);
  _rqRenderReportSummary(sessions, idxs, summaryEl);
  if (!idxs.length) {
    body.innerHTML = '<div style="text-align:center;color:#B0A898;font-size:14px;padding:40px 0;">No sessions in this date range</div>';
    return;
  }
  if (_rqReportView === 'design' || _rqReportView === 'category') {
    _rqRenderAggView(sessions, idxs);
    return;
  }

  var cards = idxs.map(function(i) {
    var s = sessions[i];
    var primaryName = (s.items && s.items[0] && s.items[0].name) || '—';
    var extraCount  = (s.items && s.items.length > 1) ? ' +' + (s.items.length - 1) + ' more' : '';
    var safeName    = (primaryName + extraCount).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    var emp         = s.employee ? s.employee.name : '';

    var totalPcs = null;
    (s.items || []).forEach(function(it) { if (it.pieces != null) totalPcs = (totalPcs || 0) + it.pieces; });

    var m = _rqSessionMetrics(s);

    var laborTxt  = 'Labor: $' + m.laborCost.toFixed(2) + ' (' + m.hrs.toFixed(1) + 'h × $' + m.rate.toFixed(2) + '/hr)' + (m.rateIsEstimate ? ' (est.)' : '');
    var matTxt    = m.matCost > 0 ? 'Mat: $' + m.matCost.toFixed(2) : '';
    var valueTxt  = m.hasAnyValue ? 'Value: $' + m.itemValue.toFixed(2) + (m.valueIsEstimate ? ' (est.)' : '') : 'Value: —';
    var profitTxt = m.hasAnyValue ? 'Profit: ' + (m.profit >= 0 ? '+$' + m.profit.toFixed(2) : '-$' + Math.abs(m.profit).toFixed(2)) : 'Profit: —';
    var profitColor = m.profit >= 0 ? '#3A7A4A' : '#A0402A';

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
      + (matTxt ? '<span class="rq-sbar-pieces">' + matTxt + '</span>' : '')
      + '<span class="rq-sbar-pieces">' + valueTxt + '</span>'
      + '<span class="rq-sbar-pieces" style="font-weight:700;color:' + profitColor + ';">' + profitTxt + '</span>'
      + '</div>'
      + editRow
      + '</div>';
  }).join('');

  body.innerHTML = cards;
}

// Per-session derived cost/value figures — shared by the session cards, the
// range summary, and the By Design / By Category rollups so every view agrees.
function _rqSessionMetrics(s) {
  var emp = s.employee ? s.employee.name : '';
  var hrs = (s.netMs || 0) / 3600000;
  var rateIsEstimate = s.laborRate == null;
  var rate = rateIsEstimate ? (_rqRateFor(emp) || 0) : s.laborRate;
  var laborCost = hrs * rate;
  var hasAnyValue = false, valueIsEstimate = false, itemValue = 0, matCost = 0;
  (s.items || []).forEach(function(it) {
    if (it.pieces != null && it.pieces > 0) {
      var mc = _rqMatCostFor(_rqAggKeyForItem(it));
      if (mc != null) matCost += it.pieces * mc;
    }
    if (it.pieces == null || it.unitPrice == null) return;
    hasAnyValue = true;
    itemValue += it.pieces * it.unitPrice;
    if (it._priceIsEstimate) valueIsEstimate = true;
  });
  return { hrs: hrs, rate: rate, rateIsEstimate: rateIsEstimate, laborCost: laborCost,
           hasAnyValue: hasAnyValue, valueIsEstimate: valueIsEstimate, itemValue: itemValue,
           matCost: matCost, profit: itemValue - laborCost - matCost };
}

function _rqRenderReportSummary(sessions, idxs, summaryEl) {
  if (!summaryEl) return;
  var grandLabor = 0, grandValue = 0, grandMat = 0, unpricedCount = 0;
  idxs.forEach(function(i) {
    var m = _rqSessionMetrics(sessions[i]);
    grandLabor += m.laborCost;
    grandMat   += m.matCost;
    if (m.hasAnyValue) grandValue += m.itemValue;
    else unpricedCount++;
  });
  var grandProfit = grandValue - grandLabor - grandMat;
  summaryEl.innerHTML = '<div class="prod-report-summary">'
    + '<span>' + idxs.length + ' session' + (idxs.length !== 1 ? 's' : '') + '</span>'
    + '<span>Total Labor: <b>$' + grandLabor.toFixed(2) + '</b></span>'
    + (grandMat > 0 ? '<span>Total Mat: <b>$' + grandMat.toFixed(2) + '</b></span>' : '')
    + '<span>Total Value: <b>$' + grandValue.toFixed(2) + '</b></span>'
    + '<span>Total Profit: <b style="color:' + (grandProfit >= 0 ? '#3A7A4A' : '#A0402A') + ';">' + (grandProfit >= 0 ? '+$' + grandProfit.toFixed(2) : '-$' + Math.abs(grandProfit).toFixed(2)) + '</b></span>'
    + (unpricedCount ? '<span title="Labor from these sessions counts against Total Profit, but their output value is unknown">⚠ ' + unpricedCount + ' session' + (unpricedCount !== 1 ? 's' : '') + ' missing price data</span>' : '')
    + '</div>';
}

// ── Report views: controls, date range, rollups, sales, quadrant ────────────
// The session ledger answers "what happened"; the By Design / By Category
// rollups + Square sales join answer the planning questions (is this design
// priced right / underperforming / worth doubling down on).

var _rqReportView  = 'sessions';   // 'sessions' | 'design' | 'category'
var _rqReportRange = 'all';        // 'all' | 'month' | '30d' | '90d'
var _rqAggSort     = { key: 'value', dir: -1 };
var _rqSales       = {};           // { [range]: { status, byId: { [variationId]: { sold, revenue } }, capped } }
var _rqQuadPoints  = [];

var RQ_SUNSET_SELLTHRU = 0.4;      // flag designs under both thresholds
var RQ_SUNSET_MARGIN   = 0.25;

function _rqEsc2(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }

function rqSetReportView(v)  { _rqReportView = v; if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions); else _rqRenderReportControls(); }
function rqSetReportRange(v) { _rqReportRange = v; if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions); else _rqRenderReportControls(); }

function _rqRenderReportControls() {
  var el = document.getElementById('prod-report-controls');
  if (!el) return;
  var ranges = [['all','All time'],['month','This month'],['30d','Last 30 days'],['90d','Last 90 days']];
  var views  = [['sessions','Sessions'],['design','By Design'],['category','By Category']];
  el.innerHTML = '<div class="rq-report-controls">'
    + '<select class="rq-report-range" onchange="rqSetReportRange(this.value)">'
    + ranges.map(function(r) { return '<option value="' + r[0] + '"' + (_rqReportRange === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('')
    + '</select>'
    + '<div class="rq-report-views">'
    + views.map(function(v) {
        return '<button class="rq-report-view-btn' + (_rqReportView === v[0] ? ' rq-view-on' : '') + '" onclick="rqSetReportView(\'' + v[0] + '\')">' + v[1] + '</button>';
      }).join('')
    + '</div>'
    + '</div>';
}

function _rqRangeStartMs(range) {
  var now = new Date();
  if (range === '30d')   return Date.now() - 30 * 86400000;
  if (range === '90d')   return Date.now() - 90 * 86400000;
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return null;
}

function _rqVisibleReportIdxs(sessions) {
  var startMs = _rqRangeStartMs(_rqReportRange);
  var idxs = [];
  sessions.forEach(function(s, i) {
    if (startMs != null) {
      var t = s.startTime || s.stopTime;
      if (!t || new Date(t).getTime() < startMs) return;
    }
    idxs.push(i);
  });
  return idxs;
}

// ── Rollup: group filtered sessions by design (Square variation) or category.
// A session's labor is allocated across its items proportionally by pieces.

function _rqAggKeyForItem(it) {
  return (it.squareId && !it.isCustom) ? it.squareId : 'custom:' + (it.name || '');
}

function _rqReportAgg(sessions, idxs, byCategory) {
  var groups = {};
  function group(key, name, squareId) {
    return groups[key] || (groups[key] = {
      key: key, name: name, squareId: squareId || '',
      pcs: 0, hrs: 0, labor: 0, value: 0, mat: 0, unpricedPcs: 0,
      sessionCount: 0, estimate: false, _seen: {},
    });
  }
  idxs.forEach(function(i) {
    var s = sessions[i];
    var m = _rqSessionMetrics(s);
    var items = (s.items || []).filter(function(it) { return it.pieces != null && it.pieces > 0; });
    var totalPcs = 0;
    items.forEach(function(it) { totalPcs += it.pieces; });
    function mark(g) {
      if (!g._seen[i]) { g._seen[i] = true; g.sessionCount++; }
      if (m.rateIsEstimate) g.estimate = true;
    }
    if (!items.length) {
      // Keep hours/labor from sessions with no counted pieces visible instead
      // of silently dropping their cost from the rollup.
      var g0 = group(byCategory ? 'cat:' + (s.category || '') : '__none__',
                     byCategory ? (s.category || 'Uncategorized') : '(no counted pieces)');
      mark(g0);
      g0.hrs += m.hrs; g0.labor += m.laborCost;
      return;
    }
    items.forEach(function(it) {
      var itemKey = _rqAggKeyForItem(it);
      var key = byCategory ? 'cat:' + (s.category || '') : itemKey;
      var g = group(key, byCategory ? (s.category || 'Uncategorized') : (it.name || '—'), (!byCategory && it.squareId && !it.isCustom) ? it.squareId : '');
      mark(g);
      var share = totalPcs ? it.pieces / totalPcs : 0;
      g.pcs   += it.pieces;
      g.hrs   += m.hrs * share;
      g.labor += m.laborCost * share;
      if (it.unitPrice != null) {
        g.value += it.pieces * it.unitPrice;
        if (it._priceIsEstimate) g.estimate = true;
      } else {
        g.unpricedPcs += it.pieces;
      }
      var mc = _rqMatCostFor(itemKey);
      if (mc != null) g.mat += it.pieces * mc;
    });
  });
  return Object.keys(groups).map(function(k) {
    var g = groups[k];
    delete g._seen;
    g.profit   = g.value - g.labor - g.mat;
    g.margin   = g.value > 0 ? g.profit / g.value : null;
    g.valPerHr = g.hrs > 0 ? g.value / g.hrs : null;
    return g;
  });
}

// ── Square sales join (units sold + revenue per variation in the range) ────
// Uses the existing /api/square proxy; fetched once per range per page load.
// "All time" is capped to the last 365 days of orders to bound the fetch.

function _rqEnsureSales(range) {
  if (_rqSales[range]) return;
  _rqSales[range] = { status: 'loading', byId: {} };
  var startMs = _rqRangeStartMs(range);
  var capped = startMs == null;
  var startIso = new Date(startMs != null ? startMs : Date.now() - 365 * 86400000).toISOString();
  var byId = {};
  function fetchPage(cursor, pageNum) {
    var reqBody = {
      location_ids: [INV_LOCATION_ID],
      query: {
        filter: {
          state_filter: { states: ['COMPLETED'] },
          date_time_filter: { closed_at: { start_at: startIso, end_at: new Date().toISOString() } },
        },
        sort: { sort_field: 'CLOSED_AT', sort_order: 'DESC' },
      },
      limit: 200,
    };
    if (cursor) reqBody.cursor = cursor;
    return _rqSqCall('/orders/search', { method: 'POST', body: reqBody }).then(function(data) {
      if (data.errors && data.errors.length) throw new Error(data.errors[0].detail || 'Square error');
      (data.orders || []).forEach(function(o) {
        (o.line_items || []).forEach(function(li) {
          if (!li.catalog_object_id) return;
          var q = parseFloat(li.quantity || '0') || 0;
          var rec = byId[li.catalog_object_id] || (byId[li.catalog_object_id] = { sold: 0, revenue: 0 });
          rec.sold += q;
          rec.revenue += li.total_money ? li.total_money.amount / 100 : 0;
        });
      });
      if (data.cursor && pageNum < 15) return fetchPage(data.cursor, pageNum + 1);
    });
  }
  fetchPage(null, 0).then(function() {
    _rqSales[range] = { status: 'ready', byId: byId, capped: capped };
    if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions);
  }).catch(function() {
    _rqSales[range] = { status: 'error', byId: {}, capped: capped };
    if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions);
  });
}

function rqRetrySales() {
  delete _rqSales[_rqReportRange];
  if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions);
}

function rqSetAggSort(key) {
  if (_rqAggSort.key === key) _rqAggSort.dir = -_rqAggSort.dir;
  else _rqAggSort = { key: key, dir: -1 };
  if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions);
}

function rqSetMatCost(inp) {
  var key = inp.getAttribute('data-key');
  if (!key) return;
  var raw = inp.value.trim();
  var v = raw === '' ? null : parseFloat(raw);
  var m = _rqLoadMatCosts();
  if (v == null || isNaN(v)) delete m[key]; else m[key] = v;
  localStorage.setItem('sts-material-costs', JSON.stringify(m));
  clearTimeout(_rqMatSaveTimer);
  _rqMatSaveTimer = setTimeout(_rqPushProdSettings, 800);
  if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions);
}

function _rqFmtMoney(n) {
  var abs = Math.abs(n);
  var digits = abs >= 1000 ? 0 : 2;
  return (n < 0 ? '-$' : '$') + abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function _rqRenderAggView(sessions, idxs) {
  var body = document.getElementById('prod-report-body');
  if (!body) return;
  var byCategory = _rqReportView === 'category';
  var rows = _rqReportAgg(sessions, idxs, byCategory);
  if (!rows.length) {
    body.innerHTML = '<div style="text-align:center;color:#B0A898;font-size:14px;padding:40px 0;">Nothing to aggregate in this range</div>';
    return;
  }

  if (!_rqSales[_rqReportRange]) _rqEnsureSales(_rqReportRange);
  var sales = _rqSales[_rqReportRange];
  var salesReady = sales && sales.status === 'ready';

  rows.forEach(function(g) {
    var rec = (salesReady && g.squareId) ? sales.byId[g.squareId] : null;
    g.sold     = rec ? rec.sold : (salesReady && g.squareId ? 0 : null);
    g.revenue  = rec ? rec.revenue : null;
    g.sellThru = (g.sold != null && g.pcs > 0) ? g.sold / g.pcs : null;
    g.sunset   = g.sellThru != null && g.margin != null && g.sellThru < RQ_SUNSET_SELLTHRU && g.margin < RQ_SUNSET_MARGIN;
  });

  var sortKey = _rqAggSort.key, sortDir = _rqAggSort.dir;
  rows.sort(function(a, b) {
    var av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return sortDir * av.localeCompare(bv);
    return sortDir * (av - bv);
  });

  var cols = byCategory
    ? [['name','Category'],['sessionCount','Sessions'],['pcs','Pcs'],['hrs','Hrs'],['labor','Labor'],['mat','Mat'],['value','Value'],['profit','Profit'],['margin','Margin'],['valPerHr','$/hr']]
    : [['name','Design'],['pcs','Pcs'],['hrs','Hrs'],['labor','Labor'],['matPc','Mat $/pc'],['value','Value'],['profit','Profit'],['margin','Margin'],['valPerHr','$/hr'],['sold','Sold'],['sellThru','Sell-thru']];

  var arrow = function(key) { return sortKey === key ? (sortDir < 0 ? ' ▾' : ' ▴') : ''; };
  var thead = '<tr>' + cols.map(function(c) {
    var sk = c[0] === 'matPc' ? 'mat' : c[0];
    return '<th onclick="rqSetAggSort(\'' + sk + '\')">' + c[1] + arrow(sk) + '</th>';
  }).join('') + '</tr>';

  var totals = { pcs: 0, hrs: 0, labor: 0, mat: 0, value: 0, profit: 0, sold: 0, sessionCount: 0 };
  var trs = rows.map(function(g) {
    totals.pcs += g.pcs; totals.hrs += g.hrs; totals.labor += g.labor; totals.mat += g.mat;
    totals.value += g.value; totals.profit += g.profit; totals.sessionCount += g.sessionCount;
    if (g.sold != null) totals.sold += g.sold;
    var nameCell = _rqEsc2(g.name)
      + (g.estimate ? ' <span title="Includes estimated rates or prices">≈</span>' : '')
      + (g.unpricedPcs ? ' <span title="' + g.unpricedPcs + ' pcs have no unit price and are excluded from Value">⚠</span>' : '')
      + (g.sunset ? ' <span class="rq-sunset-flag" title="Sell-through under ' + Math.round(RQ_SUNSET_SELLTHRU * 100) + '% and margin under ' + Math.round(RQ_SUNSET_MARGIN * 100) + '% — consider sunsetting">🌅</span>' : '');
    var marginTxt = g.margin != null ? Math.round(g.margin * 100) + '%' : '—';
    var marginColor = g.margin == null ? '' : (g.margin >= 0 ? (g.margin < RQ_SUNSET_MARGIN ? '#B07A2A' : '#3A7A4A') : '#A0402A');
    var matCell = byCategory
      ? _rqFmtMoney(g.mat)
      : '<input class="rq-mat-input" type="number" min="0" step="0.01" placeholder="—" data-key="' + _rqEsc2(g.key) + '"'
        + ' value="' + (_rqMatCostFor(g.key) != null ? _rqMatCostFor(g.key) : '') + '" onchange="rqSetMatCost(this)">';
    return '<tr>'
      + '<td title="' + _rqEsc2(g.name) + '">' + nameCell + '</td>'
      + (byCategory ? '<td>' + g.sessionCount + '</td>' : '')
      + '<td>' + g.pcs + '</td>'
      + '<td>' + g.hrs.toFixed(1) + '</td>'
      + '<td>' + _rqFmtMoney(g.labor) + '</td>'
      + '<td>' + matCell + '</td>'
      + '<td>' + (g.value ? _rqFmtMoney(g.value) : '—') + '</td>'
      + '<td style="font-weight:600;color:' + (g.profit >= 0 ? '#3A7A4A' : '#A0402A') + ';">' + _rqFmtMoney(g.profit) + '</td>'
      + '<td' + (marginColor ? ' style="color:' + marginColor + ';"' : '') + '>' + marginTxt + '</td>'
      + '<td>' + (g.valPerHr != null ? _rqFmtMoney(g.valPerHr) : '—') + '</td>'
      + (byCategory ? '' :
          '<td>' + (g.sold != null ? g.sold : '—') + '</td>'
        + '<td>' + (g.sellThru != null ? Math.round(g.sellThru * 100) + '%' : '—') + '</td>')
      + '</tr>';
  }).join('');

  var totalMargin = totals.value > 0 ? Math.round((totals.profit / totals.value) * 100) + '%' : '—';
  var totalRow = '<tr style="font-weight:700;">'
    + '<td>Total</td>'
    + (byCategory ? '<td>' + totals.sessionCount + '</td>' : '')
    + '<td>' + totals.pcs + '</td>'
    + '<td>' + totals.hrs.toFixed(1) + '</td>'
    + '<td>' + _rqFmtMoney(totals.labor) + '</td>'
    + '<td>' + _rqFmtMoney(totals.mat) + '</td>'
    + '<td>' + _rqFmtMoney(totals.value) + '</td>'
    + '<td style="color:' + (totals.profit >= 0 ? '#3A7A4A' : '#A0402A') + ';">' + _rqFmtMoney(totals.profit) + '</td>'
    + '<td>' + totalMargin + '</td>'
    + '<td></td>'
    + (byCategory ? '' : '<td>' + (salesReady ? totals.sold : '—') + '</td><td></td>')
    + '</tr>';

  var salesNote = '';
  if (!byCategory) {
    if (!sales || sales.status === 'loading') salesNote = '<div class="rq-agg-note">Loading Square sales for this range…</div>';
    else if (sales.status === 'error') salesNote = '<div class="rq-agg-note">Couldn’t load Square sales — <a href="javascript:void(0)" onclick="rqRetrySales()">retry</a></div>';
    else if (sales.capped) salesNote = '<div class="rq-agg-note">Sold / Sell-thru use the last 365 days of Square sales</div>';
  }

  var quad = (!byCategory && salesReady) ? _rqQuadrantHTML(rows) : '';

  body.innerHTML = quad
    + '<div class="rq-agg-wrap"><table class="rq-agg-table"><thead>' + thead + '</thead><tbody>' + trs + totalRow + '</tbody></table></div>'
    + salesNote
    + '<div class="rq-agg-note">Profit = Value − allocated labor − material · Labor is split across a session’s items by piece count' + (byCategory ? ' · Category comes from each session’s primary item' : '') + '</div>';
}

// ── Margin quadrant (menu-engineering matrix): margin % vs units sold ──────
// Single series (dots use the app accent; identity lives in the tooltip and
// the table above), hairline dividers at the means, ≥24px hit targets.

function _rqQuadrantHTML(rows) {
  var pts = rows.filter(function(g) { return g.margin != null && g.sold != null && g.key !== '__none__'; });
  if (pts.length < 3) return '';
  _rqQuadPoints = pts;

  var W = 640, H = 290, L = 46, R = 14, T = 16, B = 34;
  var pw = W - L - R, ph = H - T - B;

  var maxSold = 0, sumSold = 0, minM = 0, maxM = 0.5, sumM = 0;
  pts.forEach(function(p) {
    if (p.sold > maxSold) maxSold = p.sold;
    sumSold += p.sold;
    if (p.margin < minM) minM = p.margin;
    if (p.margin > maxM) maxM = p.margin;
    sumM += p.margin;
  });
  var xMax = Math.max(1, Math.ceil(maxSold * 1.08));
  var yMin = Math.floor((minM - 0.05) * 10) / 10;
  var yMax = Math.ceil((maxM + 0.05) * 10) / 10;
  var xDiv = sumSold / pts.length;
  var yDiv = sumM / pts.length;

  var X = function(v) { return L + (v / xMax) * pw; };
  var Y = function(v) { return T + (1 - (v - yMin) / (yMax - yMin)) * ph; };

  // Clean ticks: x at 0/half/max (rounded), y every 25 points of margin
  var xTicks = [0, Math.round(xMax / 2), xMax];
  var yTicks = [];
  for (var yv = Math.ceil(yMin * 4) / 4; yv <= yMax + 1e-9; yv += 0.25) yTicks.push(Math.round(yv * 100) / 100);

  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;" role="img" aria-label="Margin versus units sold per design">';
  yTicks.forEach(function(v) {
    svg += '<line x1="' + L + '" y1="' + Y(v) + '" x2="' + (W - R) + '" y2="' + Y(v) + '" stroke="var(--bdr-light)" stroke-width="1"/>'
        +  '<text x="' + (L - 6) + '" y="' + (Y(v) + 3.5) + '" text-anchor="end" font-size="10" fill="var(--text3)">' + Math.round(v * 100) + '%</text>';
  });
  xTicks.forEach(function(v) {
    svg += '<text x="' + X(v) + '" y="' + (H - B + 14) + '" text-anchor="middle" font-size="10" fill="var(--text3)">' + v + '</text>';
  });
  // Quadrant dividers (means)
  svg += '<line x1="' + X(xDiv) + '" y1="' + T + '" x2="' + X(xDiv) + '" y2="' + (H - B) + '" stroke="var(--bdr)" stroke-width="1"/>'
      +  '<line x1="' + L + '" y1="' + Y(yDiv) + '" x2="' + (W - R) + '" y2="' + Y(yDiv) + '" stroke="var(--bdr)" stroke-width="1"/>';
  // Corner labels
  var lab = function(x, y, anchor, text) {
    return '<text x="' + x + '" y="' + y + '" text-anchor="' + anchor + '" font-size="10" fill="var(--text3)">' + text + '</text>';
  };
  svg += lab(L + 5, T + 11, 'start', 'Niche win')
      +  lab(W - R - 5, T + 11, 'end', 'Star ★')
      +  lab(L + 5, H - B - 5, 'start', 'Sunset?')
      +  lab(W - R - 5, H - B - 5, 'end', 'Reprice');
  // Axis titles
  svg += '<text x="' + (L + pw / 2) + '" y="' + (H - 3) + '" text-anchor="middle" font-size="10" fill="var(--text3)">Units sold</text>';
  // Dots (2px surface ring) + oversized transparent hit targets
  pts.forEach(function(p, i) {
    var cx = X(Math.min(p.sold, xMax)), cy = Y(Math.max(Math.min(p.margin, yMax), yMin));
    svg += '<g>'
      + '<circle class="rq-quad-hit" data-i="' + i + '" cx="' + cx + '" cy="' + cy + '" r="14" fill="transparent" tabindex="0"'
      + ' onmouseenter="rqQuadTip(this)" onmouseleave="rqQuadTipHide(this)" onfocus="rqQuadTip(this)" onblur="rqQuadTipHide(this)"/>'
      + '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="var(--accent)" stroke="var(--card-bg)" stroke-width="2" pointer-events="none"/>'
      + '</g>';
  });
  svg += '</svg>';

  return '<div class="rq-quad-card">'
    + '<div class="rq-quad-title">Margin vs. units sold</div>'
    + '<div class="rq-quad-sub">Each dot is a design · dividers sit at the averages · hover or tab to a dot for details</div>'
    + svg
    + '<div class="rq-quad-tip"></div>'
    + '</div>';
}

function rqQuadTip(el) {
  var i = parseInt(el.getAttribute('data-i'), 10);
  var p = _rqQuadPoints[i];
  var card = el.closest('.rq-quad-card');
  var tip = card && card.querySelector('.rq-quad-tip');
  if (!p || !tip) return;
  while (tip.firstChild) tip.removeChild(tip.firstChild);
  var name = document.createElement('div');
  name.textContent = p.name;
  name.style.cssText = 'font-weight:600;color:var(--text);margin-bottom:2px;';
  tip.appendChild(name);
  [Math.round(p.margin * 100) + '% margin',
   p.sold + ' sold / ' + p.pcs + ' made' + (p.sellThru != null ? ' (' + Math.round(p.sellThru * 100) + '%)' : ''),
   _rqFmtMoney(p.profit) + ' profit',
  ].forEach(function(line) {
    var d = document.createElement('div');
    d.textContent = line;
    tip.appendChild(d);
  });
  var cardRect = card.getBoundingClientRect();
  var dotRect = el.getBoundingClientRect();
  tip.style.display = 'block';
  var left = dotRect.left - cardRect.left + dotRect.width / 2 + 10;
  var top  = dotRect.top - cardRect.top - 8;
  if (left + 230 > cardRect.width) left = Math.max(4, dotRect.left - cardRect.left - 236);
  tip.style.left = left + 'px';
  tip.style.top  = Math.max(4, top) + 'px';
}

function rqQuadTipHide(el) {
  var card = el.closest('.rq-quad-card');
  var tip = card && card.querySelector('.rq-quad-tip');
  if (tip) tip.style.display = 'none';
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

// Splicing a session out shifts every index after it — remap the store's
// open edit/push state so an in-progress edit doesn't jump onto (and then
// save over) a neighboring session.
function _rqShiftStoreState(store, removedIdx) {
  if (_rqEditingSession[store] === removedIdx) _rqEditingSession[store] = null;
  else if (_rqEditingSession[store] > removedIdx) _rqEditingSession[store]--;
  if (_rqPushingSession[store] === removedIdx) _rqPushingSession[store] = null;
  else if (_rqPushingSession[store] > removedIdx) _rqPushingSession[store]--;
  var adds = {};
  Object.keys(_rqEditAdds[store] || {}).forEach(function(k) {
    var ki = parseInt(k, 10);
    if (ki === removedIdx) return;
    adds[ki > removedIdx ? ki - 1 : ki] = _rqEditAdds[store][k];
  });
  _rqEditAdds[store] = adds;
}

function _rqDeleteSessionPage(s, store) {
  if (!s.notionPageId) return;
  fetch('/api/notion-timesession?pageId=' + encodeURIComponent(s.notionPageId), { method: 'DELETE' })
    .then(function(r) {
      if (r.ok) return;
      toast('Delete failed — restoring', '⚠');
      if (store === 'report') rqRenderProductionReport(true); else rqLoadSessions();
    })
    .catch(function() {
      toast('Delete failed — restoring', '⚠');
      if (store === 'report') rqRenderProductionReport(true); else rqLoadSessions();
    });
}

function rqDeleteSession(i) {
  var s = _rqSessions[i]; if (!s) return;
  var name = (s.items && s.items[0] && s.items[0].name) || '?';
  if (!confirm('Delete this session?\n' + name + ' — ' + (s.employee ? s.employee.name : ''))) return;
  _rqDeleteSessionPage(s, 'log');
  _rqSessions.splice(i, 1);
  _rqShiftStoreState('log', i);
  rqRenderSessions();
}

function rqDeleteReportSession(i) {
  var s = _rqReportSessions && _rqReportSessions[i]; if (!s) return;
  var name = (s.items && s.items[0] && s.items[0].name) || '?';
  if (!confirm('Permanently delete this entry?\n' + name + ' — ' + (s.employee ? s.employee.name : '') + '\nThis cannot be undone.')) return;
  _rqDeleteSessionPage(s, 'report');
  _rqReportSessions.splice(i, 1);
  _rqShiftStoreState('report', i);
  _rqRenderReportBody(_rqReportSessions);
}

