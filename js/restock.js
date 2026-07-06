// ════════════════════════════════════════════
//  RESTOCK QUEUE  —  js/restock.js  (extracted from notes.js)
//  All rq* logic: priority queue, assignees, inline timers, Square auto-match,
//  size pickers, session log, production report. Loaded AFTER notes.js.
//  Order + assignees stored in /api/restock-meta.
// ════════════════════════════════════════════

var _rqMeta       = { order: [], assignees: {} };
var _rqMetaLoaded = false;
var _rqSizes       = {};    // { [pid]: { [variantId]: qty } } — cross-device size/qty selections, via /api/restock-sizes
var _rqSizesLoaded = false;
var _rqNotes       = {};    // { [pid]: noteText } — free-text notes per item, via /api/restock-notes
var _rqNotesLoaded = false;
var _rqNotesSaveDebounce = null;
var _rqLoadingAll = false;   // in-flight guard so re-entrant renders don't fire duplicate load batches
var _rqPrefetch   = null;    // { meta, sizes, notes } from /api/restock-all — consumed by the individual loaders in place of their own fetch
var _rqTimers     = {};   // { [notionPageId]: { startTime, employee, sessionNotionPageId, itemText, items, notes, tickInterval } }
var _rqSetups     = {};   // { [notionPageId]: { selectedItems, query, debounceTimer, startTimeMs, _lastResults } }
var _rqSessions   = [];   // completed sessions (in-memory + loaded from Notion)
var _rqSessionsLoaded = false;
// Session edit/push/add-item state is scoped per "store" so the Session Log
// ('log', backed by _rqSessions) and the Production Report ('report', backed
// by _rqReportSessions) can each be mid-edit independently and reuse the same
// editing functions below.
var _rqEditingSession = { log: null, report: null };
var _rqPushingSession = { log: null, report: null };
var _rqEditAdds       = { log: {}, report: {} };  // [store][sessionIdx] => { query, debounceTimer, _lastResults, variantPicker }

function _rqStoreList(store) { return store === 'report' ? _rqReportSessions : _rqSessions; }
function _rqStoreRender(store) { if (store === 'report') { _rqRenderReportBody(_rqReportSessions); } else { rqRenderSessions(); } }
var _rqAutoMatches   = {};  // { [notionPageId]: item-object | '_loading_' | '_none_' }
var _rqMatchEdits    = {};  // { [notionPageId]: { query, _lastResults, debounceTimer } }
var _rqExpanded      = {};  // { [notionPageId]: true } — bar tapped open to show detail
var _rqEditMode      = {};  // { [notionPageId]: true } — expanded bar is in edit mode
// header ✎ Edit toggle (mobile only) — when on, tapping a bar opens straight into edit
// instead of the non-interactive read-only summary. Persisted in localStorage
// (shared, same-origin) so the phone Queue tab's gear button can flip it from
// outside the iframe and have it stick across that iframe's reloads.
var _rqMobileEditMode = (function() {
  try { return localStorage.getItem('sts-rq-edit-mode') === '1'; } catch (e) { return false; }
})();
var _rqAmLoaded      = false;
var _rqAddPendingMatch = null;  // Square item selected in add panel before save
var _rqAddDebounce   = null;
var _rqAddLastResults = [];
var _rqInvCounts      = {};  // { [variantId]: qty } — Square on-hand counts, fetched once per variant per page session
var _rqInvIdsQueued   = {};  // { [variantId]: true } — ids already requested (or in-flight), so we never re-request the same id twice
var _rqInvIdsDone     = {};  // { [variantId]: true } — ids whose batch has resolved (success or failure), safe to render a final badge for
var _rqInvFetchTimer  = null;

// ── Live Square inventory counts (reference only, shown on expanded bars) ───
// Fetched once per variant per page session — not polled — since the restock
// queue is a short-lived working view and Production Sessions/Inventory Push
// are the actual source of truth for stock changes during the day. Auto-match
// resolves items on a staggered delay (see restockQueueRender), so this is
// debounced and re-run as each item's match comes in, rather than firing once
// immediately and missing every item that hadn't matched yet.

// Collects every real Square variation id referenced by the currently
// matched queue items (skips local items, custom items, and items that
// haven't matched/finished matching yet).
function _rqCollectInvVariantIds() {
  var ids = [];
  _rqSortedItems().forEach(function(item) {
    var pid = item.notionPageId;
    var match = pid ? _rqAutoMatches[pid] : null;
    if (!match || typeof match !== 'object' || match.isCustom) return;
    if (match.isParent) {
      (match.variants || []).forEach(function(v) {
        if (v.id && ids.indexOf(v.id) === -1) ids.push(v.id);
      });
    } else if (match.id && match.id.indexOf('local-') !== 0 && match.id.indexOf('custom-') !== 0) {
      if (ids.indexOf(match.id) === -1) ids.push(match.id);
    }
  });
  // Also collect variants from the add-panel's pending selection so stock
  // counts are fetched and shown in the sizes table before the item is saved.
  var pending = _rqAddPendingMatch;
  if (pending && !pending.isCustom) {
    if (pending.isParent) {
      (pending.variants || []).forEach(function(v) {
        if (v.id && ids.indexOf(v.id) === -1) ids.push(v.id);
      });
    } else if (pending.id && pending.id.indexOf('local-') !== 0 && pending.id.indexOf('custom-') !== 0) {
      if (ids.indexOf(pending.id) === -1) ids.push(pending.id);
    }
  }
  return ids;
}

function _rqFetchInvCounts() {
  clearTimeout(_rqInvFetchTimer);
  _rqInvFetchTimer = setTimeout(_rqFetchInvCountsNow, 250);
}

function _rqFetchInvCountsNow() {
  var ids = _rqCollectInvVariantIds().filter(function(id) { return !_rqInvIdsQueued[id]; });
  if (!ids.length) return;
  ids.forEach(function(id) { _rqInvIdsQueued[id] = true; }); // mark immediately so a slow response can't trigger a duplicate request
  _rqSqCall('/inventory/counts/batch-retrieve', {
    method: 'POST',
    body: { catalog_object_ids: ids, location_ids: [INV_LOCATION_ID] },
  }).then(function(data) {
    (data.counts || []).forEach(function(c) {
      _rqInvCounts[c.catalog_object_id] = parseInt(c.quantity, 10) || 0;
    });
    ids.forEach(function(id) { _rqInvIdsDone[id] = true; });
    restockQueueRender();
    _rqRefreshAddPanel();
  }).catch(function() {
    // Mark these ids done anyway — badges render as "unset" rather than
    // retrying indefinitely on a flaky connection.
    ids.forEach(function(id) { _rqInvIdsDone[id] = true; });
  });
}

// Re-renders the add-panel sizes box after inventory counts arrive, so the
// "Current Stock" row populates without the user having to re-select the item.
function _rqRefreshAddPanel() {
  var item = _rqAddPendingMatch;
  if (!item || !item.isParent) return;
  var sizesBox = document.getElementById('rq-add-sizes');
  if (!sizesBox || sizesBox.style.display === 'none') return;
  var styleFilter = _rqApplyStyleFilter('add', item.variants);
  var filteredVariants = styleFilter.variants;
  var table = _rqBuildVariantTable(filteredVariants);
  var qtyByVariantId = {};
  var stoneByVariantId = {};
  (item.selectedVariants || []).forEach(function(v) {
    qtyByVariantId[v.id] = v.qty || '';
    if (v.stoneIdx !== undefined && v.stoneIdx !== null) stoneByVariantId[v.id] = v.stoneIdx;
  });
  var stoneList = _rqStoneOptionsFor(item);
  sizesBox.innerHTML = styleFilter.filterTabsHtml + (table
    ? _rqVariantTableHtml('add', table, qtyByVariantId, 'rqAddSetVariantQty')
    : _rqVariantFlatHtml('add', filteredVariants, qtyByVariantId, 'rqAddSetVariantQty', stoneList, stoneByVariantId, 'rqAddSetVariantStone'));
}

// Renders a small count badge for one variant id, reusing the Inventory
// tab's existing .inv-badge styling/thresholds (see js/inventory.js) so the
// two surfaces read consistently. Returns '' while this id's fetch is still
// in flight (better to show nothing briefly than a wrong number).
function _rqInvBadgeHtml(variantId) {
  if (!variantId || variantId.indexOf('local-') === 0 || variantId.indexOf('custom-') === 0) {
    return '<span class="inv-badge unset">N/A</span>';
  }
  if (!_rqInvIdsDone[variantId]) return '';
  var qty = _rqInvCounts[variantId];
  var cls = (qty === undefined) ? 'unset' : qty === 0 ? 'no-stock' : qty <= 2 ? 'low-stock' : 'in-stock';
  var label = (qty === undefined) ? 'not tracked' : qty === 0 ? 'out of stock' : qty + ' in stock';
  return '<span class="inv-badge ' + cls + '">' + label + '</span>';
}

// Number-only stock badge (full text moves to a hover title) for the
// grouped variant table — with 15-20+ size columns per metal, "not
// tracked"/"out of stock" badges were by far the widest thing in each
// column and the main reason the table needed horizontal scrolling.
function _rqInvBadgeCompactHtml(variantId) {
  if (!variantId || variantId.indexOf('local-') === 0 || variantId.indexOf('custom-') === 0) {
    return '<span class="inv-badge inv-badge-compact unset" title="Not tracked in Square">—</span>';
  }
  if (!_rqInvIdsDone[variantId]) return '';
  var qty = _rqInvCounts[variantId];
  var cls = (qty === undefined) ? 'unset' : qty === 0 ? 'no-stock' : qty <= 2 ? 'low-stock' : 'in-stock';
  var label = (qty === undefined) ? 'not tracked' : qty === 0 ? 'out of stock' : qty + ' in stock';
  var text = (qty === undefined) ? '—' : String(qty);
  return '<span class="inv-badge inv-badge-compact ' + cls + '" title="' + label + '">' + text + '</span>';
}

// Parses the "Sizes 5 (2), 5.5 (1), 6.5 (3)" suffix produced by the
// Inventory Restock size picker (notes.js restockConfirmSizes), so the
// Restock Queue's auto-match can pre-select the same sizes/quantities
// instead of making the user re-pick them from scratch.
function _rqParseSizesFromText(text) {
  var m = /[–-]\s*Sizes?\s+(.+)$/i.exec(text || '');
  if (!m) return null;
  var parts = m[1].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (!parts.length) return null;
  return parts.map(function(p) {
    var pm = /^(.+?)\s*\((\d+)\)$/.exec(p);
    return pm ? { name: pm[1].trim(), qty: parseInt(pm[2], 10) } : { name: p, qty: null };
  });
}

// Renders a selected-variant for display, appending its quantity when known.
function _rqVariantLabel(v) {
  var name = v.name || '';
  return v.qty ? (name + ' (' + v.qty + ')') : name;
}

// Pre-selects the variants (with quantities) that the Inventory Restock size
// picker already recorded in the note text, instead of leaving the Queue's
// variant picker empty and making the user re-pick sizes that were already chosen.
function _rqMatchSizesToVariants(variants, rawText) {
  var sizes = _rqParseSizesFromText(rawText);
  if (!sizes || !sizes.length || !variants || !variants.length) return [];
  var out = [];
  variants.forEach(function(v) {
    var hit = sizes.filter(function(s) { return s.name.toLowerCase() === (v.name || '').toLowerCase().trim(); })[0];
    if (hit) out.push(Object.assign({}, v, { qty: hit.qty }));
  });
  return out;
}

// ── Variant attribute table (e.g. Metal x Size x Gauge) ──────────────────────
// Square variation names like "Silver - Sm - 20g" get parsed into a grouped
// table (metal columns grouped, size sub-grouped, gauge as leaf columns) with
// one quantity input per leaf, instead of a flat wall of chips that gets
// unreadable once an item has 6-8+ variations (e.g. Double Hoop Faux Nose Ring).
function _rqClassifyToken(tok) {
  var t = (tok || '').trim();
  // "Silver & Gold Fill" (a combined-metal option, e.g. on Chevron Stacker's
  // Double style) needs to match too — otherwise one unparseable row forces
  // the whole item into the flat chip fallback (see _rqBuildVariantTable).
  if (/^(silver|gold[\s-]?fill|gold|rose[\s-]?gold|brass|bronze|sterling|copper)(\s*&\s*(silver|gold[\s-]?fill|gold|rose[\s-]?gold))?$/i.test(t)) return 'metal';
  if (/^(xs|sm|small|med|medium|lg|large|xl|xxl)$/i.test(t)) return 'size';
  // Ring sizes — plain numbers (incl. half sizes) or "Size 7" / "Sz 7.5".
  if (/^(size|sz)?\s*\d+(\.\d+)?$/i.test(t)) return 'size';
  return 'other';
}

// Detects a leading "Style" token on variant names shaped like
// "{Style}, {Metal}, Size {N}" — e.g. Chevron Stacker's "Regular, Silver,
// Size 11" vs "Double, Silver, Size 11". The first token counts as a style
// only when it's neither a metal nor a size itself, and the remaining
// tokens do resolve to a metal and a size — so plain "Metal, Size" items
// (no style prefix) correctly return null.
function _rqStyleTokenFor(name) {
  var tokens = (name || '').split(/[\/\-,]+/).map(function(s) { return s.trim(); }).filter(Boolean);
  if (tokens.length < 3) return null;
  if (_rqClassifyToken(tokens[0]) !== 'other') return null;
  var rest = tokens.slice(1);
  var hasMetal = rest.some(function(t) { return _rqClassifyToken(t) === 'metal'; });
  var hasSize  = rest.some(function(t) { return _rqClassifyToken(t) === 'size'; });
  return (hasMetal && hasSize) ? tokens[0] : null;
}

// Distinct Style values across a parent item's variants, first-seen order —
// null unless there are 2+ (a single style isn't worth a filter bar).
function _rqStylesFor(variants) {
  var styles = [];
  (variants || []).forEach(function(v) {
    var s = _rqStyleTokenFor(v.name);
    if (s && styles.indexOf(s) === -1) styles.push(s);
  });
  return styles.length >= 2 ? styles : null;
}

// Which Style tab is active per queue row — a view-only filter (not saved
// data: every Style+Metal+Size combo is still its own real Square variant
// id, so quantities entered under a hidden style stay set, just out of
// view, exactly like switching browser tabs). Resets on reload; that's fine
// since it's just decluttering the list, not a choice that needs to stick.
var _rqStyleFilter = {};

function rqSetStyleFilter(pid, style) {
  _rqStyleFilter[pid] = style || '';
  // The add-item panel isn't a queue row (no rq-match-row-* element yet —
  // the item hasn't been saved as a note), so it needs its own refresh path.
  if (pid === 'add') { _rqRefreshAddPanel(); return; }
  _rqUpdateMatchRow(pid);
}

function _rqStyleFilterTabsHtml(pid, styles, current) {
  var safePid = pid.replace(/[^a-zA-Z0-9_-]/g, '');
  var tabs = [''].concat(styles); // '' = "All"
  return '<div class="rq-style-filter">'
    + tabs.map(function(s) {
        var active = (current || '') === s ? ' rq-style-tab-active' : '';
        var safeStyle = s.replace(/'/g, '');
        return '<button type="button" class="rq-style-tab' + active + '" onclick="rqSetStyleFilter(\'' + safePid + '\',\'' + safeStyle + '\')">' + _rqEsc(s || 'All') + '</button>';
      }).join('')
    + '</div>';
}

// Narrows a parent item's variants down to the active Style tab (or leaves
// them alone under "All" / when the item has no Style prefix at all).
function _rqApplyStyleFilter(pid, variants) {
  var styles = _rqStylesFor(variants);
  if (!styles) return { variants: variants, filterTabsHtml: '' };
  var current = _rqStyleFilter[pid] || '';
  var filtered = current ? variants.filter(function(v) { return _rqStyleTokenFor(v.name) === current; }) : variants;
  return { variants: filtered, filterTabsHtml: _rqStyleFilterTabsHtml(pid, styles, current) };
}

function _rqBuildVariantTable(variants) {
  if (!variants || variants.length < 3) return null; // not worth a table for 1-2 sizes
  var rows = variants.map(function(v) {
    var tokens = (v.name || '').split(/[\/\-,]+/).map(function(s) { return s.trim(); }).filter(Boolean);
    if (tokens.length < 2) return null;
    var metal = null, size = null, rest = [];
    tokens.forEach(function(tok) {
      var cls = _rqClassifyToken(tok);
      if (cls === 'metal' && !metal) metal = tok;
      else if (cls === 'size' && !size) size = tok;
      else rest.push(tok);
    });
    if (!metal) return null;
    return { variant: v, metal: metal, size: size || '', leaf: rest.join(' ') };
  });
  if (rows.some(function(r) { return !r; })) return null; // any unparseable row -> fall back to flat chips

  var metals = [];
  rows.forEach(function(r) { if (metals.indexOf(r.metal) === -1) metals.push(r.metal); });
  if (metals.length < 2) return null; // single metal -> flat chips is fine

  rows.sort(function(a, b) {
    var ma = metals.indexOf(a.metal), mb = metals.indexOf(b.metal);
    if (ma !== mb) return ma - mb;
    return _rqSizeCompare(a.size, b.size);
  });

  return { rows: rows, metals: metals, hasSizes: rows.some(function(r) { return r.size; }) };
}

// Numeric compare for size tokens ("Size 10" vs "Size 2") — plain string
// sort put "10", "10.5", "11"... before "2" since "1" < "2" as characters.
// Falls back to a string compare when either side has no digits (e.g. "Sm"/"Lg").
function _rqSizeCompare(a, b) {
  var na = parseFloat((a || '').replace(/[^\d.]/g, ''));
  var nb = parseFloat((b || '').replace(/[^\d.]/g, ''));
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return (a || '').localeCompare(b || '');
}

// Strips a leading "Size"/"Sz" label down to just the number ("Size 6.5" ->
// "6.5") so grouped-table column headers stay narrow enough to fit several
// metal x size tables on screen without horizontal scrolling.
function _rqShortSizeLabel(size) {
  return (size || '').replace(/^(size|sz)\s*/i, '');
}

function _rqEsc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// One small table per metal, stacked vertically (rather than one wide table
// with metals side by side) — a metal group with 15-20 sizes no longer
// forces the others off-screen into horizontal scroll.
function _rqVariantTableHtml(pid, table, qtyByVariantId, onchangeFn) {
  onchangeFn = onchangeFn || 'rqSetInlineVariantQty';
  return '<div class="rq-variant-table-stack">'
    + table.metals.map(function(metal) {
        var cols = table.rows.filter(function(r) { return r.metal === metal; });
        // Split a long size run into two rows (e.g. 2-6, then 6.5-12)
        // instead of one row of 15-20+ narrow columns — otherwise the qty
        // input has to shrink so far that a "0" starts rendering clipped,
        // looking like a stray "(". Splitting halves the column count per
        // row, so each input gets roughly double the width back.
        var chunks = (table.hasSizes && cols.length > 8)
          ? [cols.slice(0, Math.ceil(cols.length / 2)), cols.slice(Math.ceil(cols.length / 2))]
          : [cols];
        return '<div class="rq-variant-table-group">'
          + '<div class="rq-variant-table-metal">' + _rqEsc(metal) + '</div>'
          + chunks.map(function(chunkCols) {
              return _rqVariantSubTableHtml(pid, chunkCols, table.hasSizes, qtyByVariantId, onchangeFn);
            }).join('')
          + '</div>';
      }).join('')
    + '</div>';
}

// Renders one metal's size row (or one half of it, when split into two —
// see _rqVariantTableHtml above) as its own small table.
function _rqVariantSubTableHtml(pid, cols, hasSizes, qtyByVariantId, onchangeFn) {
  var html = '<table class="rq-variant-table"><thead>';
  if (hasSizes) {
    html += '<tr><th class="rq-variant-row-label">Size</th>';
    var i = 0;
    while (i < cols.length) {
      var size = cols[i].size;
      var span = 1;
      while (i + span < cols.length && cols[i + span].size === size) span++;
      html += '<th colspan="' + span + '">' + (_rqEsc(_rqShortSizeLabel(size)) || '—') + '</th>';
      i += span;
    }
    html += '</tr>';
  }
  html += '</thead><tbody><tr><th class="rq-variant-row-label">To Make</th>';
  cols.forEach(function(r) {
    var qty = qtyByVariantId[r.variant.id] || '';
    var safeVId = (r.variant.id || '').replace(/'/g, '').replace(/\\/g, '\\\\');
    html += '<td><input type="number" class="rq-variant-qty" min="0" max="99" placeholder="0" value="' + (qty || '') + '"'
      + ' onchange="' + onchangeFn + '(\'' + pid + '\',\'' + safeVId + '\',this.value)"></td>';
  });
  html += '</tr><tr class="rq-variant-inv-row"><th class="rq-variant-row-label">Stock</th>';
  cols.forEach(function(r) {
    html += '<td>' + _rqInvBadgeCompactHtml(r.variant.id) + '</td>';
  });
  html += '</tr></tbody></table>';
  return html;
}

function _rqVariantFlatHtml(pid, variants, qtyByVariantId, onchangeFn, stoneList, stoneByVariantId, stoneOnchangeFn) {
  onchangeFn = onchangeFn || 'rqSetInlineVariantQty';
  stoneOnchangeFn = stoneOnchangeFn || 'rqSetVariantStone';
  stoneByVariantId = stoneByVariantId || {};
  return '<div class="rq-variant-grid">'
    + variants.map(function(v) {
        var qty = qtyByVariantId[v.id] || '';
        var safeVId = (v.id || '').replace(/'/g, '').replace(/\\/g, '\\\\');
        // Stone choice only makes sense once a size has been given a
        // quantity — otherwise there's nothing for the stone to attach to,
        // and the selection would just get dropped on the next render.
        var stoneHtml = '';
        if (stoneList && stoneList.length && qty) {
          var curIdx = stoneByVariantId[v.id];
          var opts = '<option value="">Stone…</option>' + stoneList.map(function(s) {
            var sel = (curIdx === s.idx) ? ' selected' : '';
            return '<option value="' + s.idx + '"' + sel + '>' + (s.name || '').replace(/</g, '&lt;') + '</option>';
          }).join('');
          stoneHtml = '<select class="rq-variant-stone-select" onchange="' + stoneOnchangeFn + '(\'' + pid + '\',\'' + safeVId + '\',this.value)">' + opts + '</select>';
        }
        return '<div class="rq-variant-chip' + (qty ? ' rq-variant-chip-on' : '') + '">'
          + '<div class="rq-variant-chip-row">'
          + '<span>' + (v.name || '').replace(/</g, '&lt;') + '</span>'
          + '<input type="number" class="rq-variant-qty-inline" min="0" max="99" placeholder="0" value="' + (qty || '') + '"'
          + ' onchange="' + onchangeFn + '(\'' + pid + '\',\'' + safeVId + '\',this.value)">'
          + '</div>'
          + stoneHtml
          + _rqInvBadgeHtml(v.id)
          + '</div>';
      }).join('')
    + '</div>';
}

// Persists a quantity directly into the saved match (no transient picker
// state) — used by both the grouped table and the flat chip grid, wherever
// _rqMatchRowInner renders them inside the bar's expanded edit panel.
function rqSetInlineVariantQty(pid, variantId, value) {
  // While a timer is running, the bar's _rqAutoMatches entry has been
  // flattened into a display-only placeholder (see rqStartTimerConfirm) —
  // the live, editable data lives on _rqTimers[pid].richMatch instead.
  var timer = _rqTimers[pid];
  var usingRichMatch = !!(timer && timer.richMatch);
  var match = usingRichMatch ? timer.richMatch : _rqAutoMatches[pid];
  if (!match || typeof match !== 'object' || !match.isParent) return;
  var qty = parseInt(value, 10) || 0;
  var byId = {};
  (match.selectedVariants || []).forEach(function(v) { byId[v.id] = v; });
  var variant = (match.variants || []).filter(function(v) { return v.id === variantId; })[0];
  if (!variant) return;
  if (qty > 0) {
    var prevStone = byId[variantId] && byId[variantId].stoneIdx;
    byId[variantId] = Object.assign({}, variant, { qty: qty }, prevStone !== undefined ? { stoneIdx: prevStone } : {});
  } else delete byId[variantId];
  var selectedVariants = (match.variants || [])
    .filter(function(v) { return byId[v.id]; })
    .map(function(v) { return byId[v.id]; });
  if (usingRichMatch) {
    timer.richMatch = Object.assign({}, match, { selectedVariants: selectedVariants });
    _rqPersistTimer(pid);
  } else {
    _rqAutoMatches[pid] = Object.assign({}, match, { selectedVariants: selectedVariants });
    _rqAmSave();
  }
  _rqSaveSizesFor(pid, selectedVariants);
}

// Records which stone (from the item's "Stone" modifier list, e.g. Double
// Chevron (Stone Set)) was chosen for one already-quantified size. Only
// meaningful once that size has a qty > 0 — see _rqVariantFlatHtml.
function rqSetVariantStone(pid, variantId, stoneIdxStr) {
  var timer = _rqTimers[pid];
  var usingRichMatch = !!(timer && timer.richMatch);
  var match = usingRichMatch ? timer.richMatch : _rqAutoMatches[pid];
  if (!match || typeof match !== 'object' || !match.isParent) return;
  var stoneIdx = stoneIdxStr === '' ? undefined : parseInt(stoneIdxStr, 10);
  var selectedVariants = (match.selectedVariants || []).map(function(v) {
    if (v.id !== variantId) return v;
    var next = Object.assign({}, v);
    if (stoneIdx === undefined) delete next.stoneIdx; else next.stoneIdx = stoneIdx;
    return next;
  });
  if (usingRichMatch) {
    timer.richMatch = Object.assign({}, match, { selectedVariants: selectedVariants });
    _rqPersistTimer(pid);
  } else {
    _rqAutoMatches[pid] = Object.assign({}, match, { selectedVariants: selectedVariants });
    _rqAmSave();
  }
  _rqSaveSizesFor(pid, selectedVariants);
}

// Local items not in Square catalog
var _RQ_LOCAL_ITEMS = [
  { id: 'local-chevron-single-silver-sm-l', name: 'Chevron Ear Cuff – Single Silver (Sm) – Left',  category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-single-silver-sm-r', name: 'Chevron Ear Cuff – Single Silver (Sm) – Right', category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-single-silver-lg-l', name: 'Chevron Ear Cuff – Single Silver (Lg) – Left',  category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-single-silver-lg-r', name: 'Chevron Ear Cuff – Single Silver (Lg) – Right', category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-single-gf-sm-l',     name: 'Chevron Ear Cuff – Single GF (Sm) – Left',      category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-single-gf-sm-r',     name: 'Chevron Ear Cuff – Single GF (Sm) – Right',     category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-single-gf-lg-l',     name: 'Chevron Ear Cuff – Single GF (Lg) – Left',      category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-single-gf-lg-r',     name: 'Chevron Ear Cuff – Single GF (Lg) – Right',     category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-double-silver-sm-l', name: 'Chevron Ear Cuff – Double Silver (Sm) – Left',  category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-double-silver-sm-r', name: 'Chevron Ear Cuff – Double Silver (Sm) – Right', category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-double-silver-lg-l', name: 'Chevron Ear Cuff – Double Silver (Lg) – Left',  category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-double-silver-lg-r', name: 'Chevron Ear Cuff – Double Silver (Lg) – Right', category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-double-gf-sm-l',     name: 'Chevron Ear Cuff – Double GF (Sm) – Left',      category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-double-gf-sm-r',     name: 'Chevron Ear Cuff – Double GF (Sm) – Right',     category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-double-gf-lg-l',     name: 'Chevron Ear Cuff – Double GF (Lg) – Left',      category: 'Ear Cuffs', isParent: false, sku: '' },
  { id: 'local-chevron-double-gf-lg-r',     name: 'Chevron Ear Cuff – Double GF (Lg) – Right',     category: 'Ear Cuffs', isParent: false, sku: '' },
];

// ── Meta persistence ──────────────────────────────────────────────────────────

function _rqApplyMeta(d) {
  d = d || {};
  _rqMeta = { order: d.order || [], assignees: d.assignees || {} };
  _rqMetaLoaded = true;
  _rqRestoreTimers();
  if (!_rqSessionsLoaded) rqLoadSessions();
}
function _rqLoadMeta(cb) {
  if (_rqPrefetch) { _rqApplyMeta(_rqPrefetch.meta); if (cb) cb(); return; }
  fetch('/api/restock-meta')
    .then(function(r) { return r.json(); })
    .then(function(d) { _rqApplyMeta(d); if (cb) cb(); })
    .catch(function() { _rqMetaLoaded = true; if (cb) cb(); });
}

function _rqSaveMeta() {
  fetch('/api/restock-meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(_rqMeta),
  }).catch(function() { toast('Failed to save queue state', '⚠'); });
}

// ── Sizes persistence (cross-device variant qty selections) ─────────────────

function _rqApplySizes(d) {
  _rqSizes = (d && typeof d === 'object' && !d.error) ? d : {};
  _rqSizesLoaded = true;
  _rqReconcileSizes();
}
function _rqLoadSizes(cb) {
  if (_rqPrefetch) { _rqApplySizes(_rqPrefetch.sizes); if (cb) cb(); return; }
  fetch('/api/restock-sizes')
    .then(function(r) { return r.json(); })
    .then(function(d) { _rqApplySizes(d); if (cb) cb(); })
    .catch(function() { _rqSizesLoaded = true; if (cb) cb(); });
}

// Patches any already-cached _rqAutoMatches (loaded from this browser's own
// localStorage, possibly long before restock-sizes existed) against the
// just-fetched shared store. Without this, a device whose local cache
// already has an entry for an item — even an empty one — would never
// re-run auto-match for it, so the shared store's real sizes would sit
// there correct on the server forever without ever reaching that device.
function _rqReconcileSizes() {
  var changed = false;
  Object.keys(_rqSizes).forEach(function(pid) {
    var match = _rqAutoMatches[pid];
    if (!match || typeof match !== 'object' || !match.isParent) return;
    var resolved = _rqResolveSelectedVariants(pid, match);
    if (resolved) {
      _rqAutoMatches[pid] = Object.assign({}, match, { selectedVariants: resolved });
      changed = true;
    }
  });
  if (changed) _rqAmSave();
}

// ── Notes persistence (cross-device free-text notes, e.g. for items not in Square) ──

function _rqApplyNotes(d) {
  _rqNotes = (d && typeof d === 'object' && !d.error) ? d : {};
  _rqNotesLoaded = true;
}
function _rqLoadNotes(cb) {
  if (_rqPrefetch) { _rqApplyNotes(_rqPrefetch.notes); if (cb) cb(); return; }
  fetch('/api/restock-notes')
    .then(function(r) { return r.json(); })
    .then(function(d) { _rqApplyNotes(d); if (cb) cb(); })
    .catch(function() { _rqNotesLoaded = true; if (cb) cb(); });
}

// Fire the three independent stores concurrently (meta / sizes / notes live on
// separate Notion pages with no cross-dependency) and render once when all
// three settle — replaces the old load→render→load→render→load waterfall.
// _rqAmLoad() (synchronous localStorage) is already called at the top of
// restockQueueRender before this runs, so _rqReconcileSizes has its data.
function _rqLoadAll(cb) {
  if (_rqLoadingAll) return;
  _rqLoadingAll = true;
  var wrap = function(fn) { return new Promise(function(res) { fn(res); }); };
  var runLoaders = function() {
    // With _rqPrefetch set the loaders consume the cache synchronously (no
    // network); with it null they each fetch their own endpoint in parallel.
    Promise.all([ wrap(_rqLoadMeta), wrap(_rqLoadSizes), wrap(_rqLoadNotes) ])
      .then(function() { _rqPrefetch = null; _rqLoadingAll = false; if (cb) cb(); });
  };
  // Prefer the single-query aggregator; fall back to the three individual
  // endpoints if it errors, so a bad deploy can't break loading.
  fetch('/api/restock-all')
    .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function(d) {
      if (!d || d.error) return Promise.reject();
      _rqPrefetch = { meta: d.meta || {}, sizes: d.sizes || {}, notes: d.notes || {} };
      runLoaders();
    })
    .catch(function() { _rqPrefetch = null; runLoaders(); });
}

function _rqSaveNotes() {
  fetch('/api/restock-notes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(_rqNotes),
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (!res.ok) toast(res.data.error || 'Failed to save note', '⚠');
    })
    .catch(function() { toast('Failed to save note', '⚠'); });
}

// Debounced so typing doesn't fire a PUT per keystroke.
function rqSetNote(pid, value) {
  if (!pid) return;
  var text = (value || '').trim();
  if (text) _rqNotes[pid] = text;
  else delete _rqNotes[pid];
  if (_rqNotesSaveDebounce) clearTimeout(_rqNotesSaveDebounce);
  _rqNotesSaveDebounce = setTimeout(_rqSaveNotes, 600);
}

function _rqSaveSizes() {
  fetch('/api/restock-sizes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(_rqSizes),
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (!res.ok) toast(res.data.error || 'Failed to save sizes', '⚠');
    })
    .catch(function() { toast('Failed to save sizes', '⚠'); });
}

// Writes the chosen variant quantities for one item into the shared
// cross-device store (dropping zero-qty entries) and saves.
function _rqSaveSizesFor(pid, selectedVariants) {
  var map = {};
  (selectedVariants || []).forEach(function(v) {
    if (v.qty > 0) {
      map[v.id] = v.qty;
      // Stone choice is stored under a "@s" sibling key (not nested in the
      // qty value) so plain `saved[v.id] > 0` checks elsewhere keep working
      // unchanged, and items without a Stone modifier cost nothing extra.
      if (v.stoneIdx !== undefined && v.stoneIdx !== null) map[v.id + '@s'] = v.stoneIdx;
    }
  });
  if (Object.keys(map).length) _rqSizes[pid] = map;
  else delete _rqSizes[pid];
  _rqSaveSizes();
}

// Resolves a parent item's selectedVariants from the saved cross-device
// quantities (variant names are re-derived from the live Square match,
// not stored, to keep the payload small). Returns null if nothing saved.
function _rqResolveSelectedVariants(pid, match) {
  var saved = _rqSizes[pid];
  if (!saved || !Object.keys(saved).length) return null;
  var resolved = (match.variants || [])
    .filter(function(v) { return saved[v.id] > 0; })
    .map(function(v) {
      var out = Object.assign({}, v, { qty: saved[v.id] });
      var s = saved[v.id + '@s'];
      if (s !== undefined) out.stoneIdx = s;
      return out;
    });
  return resolved.length ? resolved : null;
}

// ── Auto-match localStorage helpers ──────────────────────────────────────────

function _rqAmLoad() {
  try {
    var saved = JSON.parse(localStorage.getItem('sts_rqAutoMatch') || '{}');
    Object.keys(saved).forEach(function(pid) {
      var v = saved[pid];
      if (v && typeof v === 'object') _rqAutoMatches[pid] = v;
    });
  } catch(e) {}
}

function _rqAmSave() {
  var out = {};
  Object.keys(_rqAutoMatches).forEach(function(pid) {
    var v = _rqAutoMatches[pid];
    if (v && typeof v === 'object') out[pid] = v;
  });
  localStorage.setItem('sts_rqAutoMatch', JSON.stringify(out));
}

function _rqAmSet(pid, item) {
  _rqAutoMatches[pid] = item;
  _rqAmSave();
  _rqUpdateMatchRow(pid);
  _rqFetchInvCounts(); // pick up inventory counts for this item's variant id(s), now that it has matched
}

function _rqUpdateMatchRow(pid) {
  var safePid = pid.replace(/[^a-zA-Z0-9_-]/g, '');
  var el = document.getElementById('rq-match-row-' + safePid);
  if (el) el.innerHTML = _rqMatchRowInner(pid);
}

function _rqMatchRowInner(pid) {
  var safePid = pid.replace(/[^a-zA-Z0-9_-]/g, '');
  var timer = _rqTimers[pid];
  var match = (timer && timer.richMatch) ? timer.richMatch : _rqAutoMatches[pid];

  // ── Search panel (change item) ──
  if (_rqMatchEdits[pid]) {
    return '<div class="rq-match-panel">'
      + '<div class="rq-setup-search-wrap" style="margin-bottom:4px;">'
      + '<span class="rq-setup-search-icon">⌕</span>'
      + '<input type="text" class="rq-setup-search-input" id="rq-me-srch-' + safePid + '" placeholder="Search Square catalog…" autocomplete="off"'
      + ' oninput="rqMatchEditInput(\'' + safePid + '\',this.value)">'
      + '<div class="rq-setup-spinner" id="rq-me-spinner-' + safePid + '"></div>'
      + '</div>'
      + '<div class="rq-setup-results" id="rq-me-results-' + safePid + '"></div>'
      + '<button class="rq-setup-cancel-btn" style="margin-top:4px;" onclick="rqCloseMatchEdit(\'' + safePid + '\')">Cancel</button>'
      + '</div>';
  }

  // ── Loading / no match ──
  if (!match || match === '_loading_') {
    return '<div class="rq-match-loading"><span class="rq-match-spinner"></span>finding Square item…</div>';
  }
  if (match === '_none_') {
    return '<div class="rq-match-none" onclick="rqOpenMatchEdit(\'' + safePid + '\')">'
      + '<span class="rq-match-x">✕</span><span class="rq-match-link">No Square match · click to search</span>'
      + '</div>';
  }

  var safeName = _rqEsc(match.name);

  // ── Parent item: sizes/variations are always editable directly here —
  // no extra "Pick sizes" click needed once you're already in edit mode ──
  if (match.isParent) {
    var variants = match.variants || [];
    var styleFilter = _rqApplyStyleFilter(pid, variants);
    var filteredVariants = styleFilter.variants;
    var qtyByVariantId = {};
    var stoneByVariantId = {};
    (match.selectedVariants || []).forEach(function(v) {
      qtyByVariantId[v.id] = v.qty || '';
      if (v.stoneIdx !== undefined && v.stoneIdx !== null) stoneByVariantId[v.id] = v.stoneIdx;
    });
    var stoneList = _rqStoneOptionsFor(match);
    var table = _rqBuildVariantTable(filteredVariants);
    var body = table
      ? _rqVariantTableHtml(safePid, table, qtyByVariantId, 'rqSetInlineVariantQty')
      : _rqVariantFlatHtml(safePid, filteredVariants, qtyByVariantId, undefined, stoneList, stoneByVariantId);
    return '<div class="rq-match-found" style="margin-bottom:5px;">'
      + '<span class="rq-match-check">✓</span>'
      + '<span class="rq-match-name">' + safeName + '</span>'
      + '<button class="rq-match-change" onclick="rqOpenMatchEdit(\'' + safePid + '\')">✎ change item</button>'
      + '</div>'
      + styleFilter.filterTabsHtml
      + body;
  }

  // ── Single-variation item ──
  return '<div class="rq-match-found">'
    + '<span class="rq-match-check">✓</span>'
    + '<span class="rq-match-name">' + safeName + '</span>'
    + _rqInvBadgeHtml(match.id)
    + '<button class="rq-match-change" onclick="rqOpenMatchEdit(\'' + safePid + '\')">✎ change</button>'
    + '</div>';
}

// ── Tap-to-expand bar ────────────────────────────────────────────────────────
// The whole bar is clickable; clicks on its real controls (timer button,
// assignee dropdown, delete x, or anything inside the expanded panel) must
// not also toggle the expand state, hence the closest() bail-out below.
function rqRowClick(event, pid) {
  if (!pid) return;
  var t = event.target;
  if (t.closest('button, select, input, textarea, a')) return;
  _rqExpanded[pid] = !_rqExpanded[pid];
  if (!_rqExpanded[pid]) {
    delete _rqEditMode[pid];
  } else if (_rqMobileEditMode && window.innerWidth <= 640) {
    // Header edit toggle is on (mobile) — skip the read view, open straight to edit.
    _rqEditMode[pid] = true;
    _rqMigrateSizesIfNeeded(pid);
  }
  restockQueueRender();
}

function rqToggleMobileEditMode() {
  _rqMobileEditMode = !_rqMobileEditMode;
  try { localStorage.setItem('sts-rq-edit-mode', _rqMobileEditMode ? '1' : '0'); } catch (e) {}
  var btn = document.getElementById('rqMobileEditToggle');
  if (btn) btn.classList.toggle('active', _rqMobileEditMode);
}

// Migration: items matched before restock-sizes existed may already have
// selectedVariants sitting only in this browser's localStorage cache.
// Push them into the shared store the moment we know the user is looking
// at (and trusts) this item's current sizes — don't wait for an actual
// edit to happen first.
function _rqMigrateSizesIfNeeded(pid) {
  var match = _rqAutoMatches[pid];
  if (match && typeof match === 'object' && match.isParent
      && match.selectedVariants && match.selectedVariants.length && !_rqSizes[pid]) {
    _rqSaveSizesFor(pid, match.selectedVariants);
  }
}

function rqEnterEditMode(pid) {
  _rqEditMode[pid] = true;
  _rqMigrateSizesIfNeeded(pid);
  restockQueueRender();
}

function rqExitEditMode(pid) {
  delete _rqEditMode[pid];
  delete _rqMatchEdits[pid];
  restockQueueRender();
}

function rqSaveTitleInput(el, idx) {
  var newText = el.value.trim();
  var item = _rqSortedItems()[idx];
  if (!item || !item.notionPageId) return;
  if (!newText) { el.value = item.text; return; }
  if (newText === _rqShortName(item.text) || newText === item.text) return;
  var pid = item.notionPageId;
  delete _rqAutoMatches[pid];
  _rqAmSave();
  item.text = newText;
  renderNotesList('restock', itemsFor('restock'));
  _rqPatch(pid, { text: newText });
  setTimeout(function() { _rqAutoMatchSingle(pid, newText); }, 150);
}

// Clean, no-buttons breakdown for the collapsed-but-expanded read view —
// meant to be glanced at quickly (e.g. by an assistant checking counts)
// without accidentally triggering an edit control.
function _rqReadSummaryHtml(match) {
  if (!match || match === '_loading_') {
    return '<div class="rq-read-status"><span class="rq-match-spinner"></span>finding Square item…</div>';
  }
  if (match === '_none_') {
    return '<div class="rq-read-status">No Square match yet</div>';
  }
  if (!match.isParent) {
    var safeName = _rqEsc(match.name);
    return '<div class="rq-read-status">✓ ' + safeName + ' ' + _rqInvBadgeHtml(match.id) + '</div>';
  }
  var sel = match.selectedVariants || [];
  if (!sel.length) {
    return '<div class="rq-read-status">No sizes set yet</div>';
  }
  var stoneList = _rqStoneOptionsFor(match);
  var rows = sel.map(function(v) {
    var name = _rqEsc(v.name);
    var stoneOpt = stoneList && v.stoneIdx !== undefined ? stoneList[v.stoneIdx] : null;
    if (stoneOpt) name += ' · ' + _rqEsc(stoneOpt.name);
    return '<div class="rq-read-row"><span class="rq-read-name">' + name + '</span><span class="rq-read-qty">' + (v.qty || 1) + '</span>' + _rqInvBadgeHtml(v.id) + '</div>';
  }).join('');
  return '<div class="rq-read-list">' + rows + '</div>';
}

// Runs auto-match jobs with limited concurrency via promise chaining (not
// setTimeout) — see the call site in restockQueueRender for why.
function _rqRunAutoMatchQueue(jobs) {
  var CONCURRENCY = 3;
  var idx = 0;
  function next() {
    if (idx >= jobs.length) return;
    var job = jobs[idx++];
    _rqAutoMatchSingle(job.pid, job.text).then(next);
  }
  for (var i = 0; i < Math.min(CONCURRENCY, jobs.length); i++) next();
}

// ── Shared Square catalog search helper ──────────────────────────────────────
// Calls search → batch-retrieve and parses results into the standard row shape.
// Returns a Promise<rows[]> (empty array on no results or network error).
// Does not know about: spinners, stale checks, local items, or result rendering
// — those stay in each caller.
function _rqSqSearchExpand(query) {
  return _rqSqCall('/catalog/search', {
    method: 'POST',
    body: { object_types: ['ITEM'], query: { text_query: { keywords: [query] } }, limit: 20 },
  }).then(function(searchData) {
    var found = searchData.objects || [];
    if (!found.length) return [];
    return _rqSqCall('/catalog/batch-retrieve', {
      method: 'POST',
      body: { object_ids: found.map(function(o) { return o.id; }), include_related_objects: true },
    }).then(function(fullData) {
      var modifierListsById = {};
      (fullData.related_objects || []).forEach(function(o) {
        if (o.type === 'MODIFIER_LIST') modifierListsById[o.id] = o;
      });
      var rows = [];
      (fullData.objects || []).forEach(function(obj) {
        if (obj.type !== 'ITEM') return;
        var d = obj.item_data || {};
        var variations = d.variations || [];
        var modifierLists = _rqBuildModifierLists(obj, modifierListsById);
        if (variations.length <= 1) {
          var v = variations[0] ? variations[0].item_variation_data : null;
          rows.push({ id: variations[0] ? variations[0].id : obj.id, name: d.name || 'Unnamed', sku: v ? (v.sku || '') : '', category: d.category_name || '', isParent: false, modifierLists: modifierLists });
        } else {
          rows.push({ id: obj.id, name: d.name || 'Unnamed', category: d.category_name || '', isParent: true, variantCount: variations.length, modifierLists: modifierLists,
            variants: variations.map(function(vv) { var vd = vv.item_variation_data; return { id: vv.id, name: vd ? (vd.name || '') : '', sku: vd ? (vd.sku || '') : '' }; }) });
        }
      });
      return rows;
    });
  }).catch(function() { return []; });
}

function _rqAutoMatchSingle(pid, rawText) {
  if (!pid) return Promise.resolve();
  var query = _rqShortName(rawText || '');
  if (!query) { _rqAutoMatches[pid] = '_none_'; _rqAmSave(); _rqUpdateMatchRow(pid); return Promise.resolve(); }
  _rqAutoMatches[pid] = '_loading_';
  _rqUpdateMatchRow(pid);
  var localMatches = _rqLocalSearch(query);
  // Note: _rqSqCall never attaches a client token — the /api/square proxy
  // always falls back to its own server-side SQUARE_TOKEN. So this always
  // runs the live search regardless of device (that used to be conditional
  // on a per-browser token being saved, which made every item on a device
  // without one — e.g. a phone that's never opened Integrations — show
  // "No Square match" even though the server-side credential would have
  // matched it fine).
  return _rqSqSearchExpand(query).then(function(squareRows) {
    if (_rqAutoMatches[pid] !== '_loading_') return;
    var rows = localMatches.concat(squareRows);
    if (!rows.length) {
      _rqAutoMatches[pid] = '_none_'; _rqAmSave(); _rqUpdateMatchRow(pid); return;
    }
    var best = rows[0];
    if (best.isParent) {
      // Cross-device saved sizes (restock-sizes) take priority over
      // anything parsed from the note text — that's only a one-time
      // seed for brand-new notes that haven't been saved anywhere yet.
      var fromStore = _rqResolveSelectedVariants(pid, best);
      var selectedVariants = fromStore || _rqMatchSizesToVariants(best.variants, rawText);
      best = Object.assign({}, best, { selectedVariants: selectedVariants });
      if (!fromStore && selectedVariants.length) _rqSaveSizesFor(pid, selectedVariants);
    }
    _rqAmSet(pid, best);
  }).catch(function() {
    if (_rqAutoMatches[pid] === '_loading_') {
      _rqAutoMatches[pid] = '_none_'; _rqAmSave(); _rqUpdateMatchRow(pid);
    }
  });
}

// ── Match edit panel (click-to-change on the bar) ────────────────────────────

function rqOpenMatchEdit(pid) {
  _rqMatchEdits[pid] = { query: '', _lastResults: null, debounceTimer: null };
  _rqUpdateMatchRow(pid);
  setTimeout(function() {
    var inp = document.getElementById('rq-me-srch-' + pid.replace(/[^a-zA-Z0-9_-]/g, ''));
    if (inp) inp.focus();
  }, 50);
}

function rqCloseMatchEdit(pid) {
  var e = _rqMatchEdits[pid];
  if (e && e.debounceTimer) clearTimeout(e.debounceTimer);
  delete _rqMatchEdits[pid];
  _rqUpdateMatchRow(pid);
}

function rqMatchEditInput(pid, value) {
  var e = _rqMatchEdits[pid]; if (!e) return;
  e.query = value;
  if (e.debounceTimer) clearTimeout(e.debounceTimer);
  if (!value || value.length < 2) {
    var box = document.getElementById('rq-me-results-' + pid.replace(/[^a-zA-Z0-9_-]/g, ''));
    if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    return;
  }
  e.debounceTimer = setTimeout(function() { _rqMatchEditSearch(pid, value); }, 350);
}

function _rqMatchEditSearch(pid, query) {
  var e = _rqMatchEdits[pid]; if (!e) return;
  var safePid = pid.replace(/[^a-zA-Z0-9_-]/g, '');
  var spinner = document.getElementById('rq-me-spinner-' + safePid);
  if (spinner) spinner.style.display = 'block';
  var localMatches = _rqLocalSearch(query);
  _rqSqSearchExpand(query).then(function(squareRows) {
    if (!_rqMatchEdits[pid]) return;
    _rqMatchEditRenderResults(pid, localMatches.concat(squareRows), query);
  }).catch(function() {
    if (_rqMatchEdits[pid]) _rqMatchEditRenderResults(pid, localMatches, query);
  }).then(function() {
    var sp = document.getElementById('rq-me-spinner-' + safePid);
    if (sp) sp.style.display = 'none';
  });
}

function _rqMatchEditRenderResults(pid, items, query) {
  var e = _rqMatchEdits[pid]; if (!e) return;
  e._lastResults = items;
  var safePid = pid.replace(/[^a-zA-Z0-9_-]/g, '');
  var box = document.getElementById('rq-me-results-' + safePid);
  if (!box) return;
  if (!items || !items.length) {
    var safeQ = (query||'').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    var escQ  = (query||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    box.innerHTML = '<div class="rq-result-none">No match for "' + safeQ + '"</div>'
      + '<div class="rq-result-item" onclick="rqMatchEditCustom(\'' + safePid + '\',\'' + escQ + '\')" style="color:var(--accent);font-weight:600;">＋ Use "' + safeQ + '" as custom item</div>';
    box.style.display = 'flex';
    return;
  }
  box.innerHTML = items.map(function(item) {
    var meta = item.isParent
      ? (item.category||'') + ' · ' + (item.variantCount||'') + ' sizes'
      : (item.category||'') + (item.sku ? ' · ' + item.sku : '');
    var safeId = (item.id||'').replace(/'/g,'').replace(/\\/g,'\\\\');
    return '<div class="rq-result-item" onclick="rqMatchEditSelectId(\'' + safePid + '\',\'' + safeId + '\')">'
      + '<div><div class="rq-result-name">' + (item.name||'').replace(/</g,'&lt;') + '</div>'
      + '<div class="rq-result-meta">' + meta.replace(/</g,'&lt;') + '</div></div>'
      + '</div>';
  }).join('');
  box.style.display = 'flex';
}

function rqMatchEditSelectId(pid, itemId) {
  var e = _rqMatchEdits[pid]; if (!e) return;
  var item = (e._lastResults||[]).filter(function(it) { return it.id === itemId; })[0];
  if (!item) return;
  if (e.debounceTimer) clearTimeout(e.debounceTimer);
  delete _rqMatchEdits[pid];
  if (item.isParent) item = Object.assign({}, item, { selectedVariants: [] });
  _rqAmSet(pid, item);
  // No extra "pick sizes" step needed — _rqMatchRowInner now always renders
  // the size/quantity table directly for parent items.
}

function rqMatchEditCustom(pid, name) {
  var e = _rqMatchEdits[pid];
  if (e && e.debounceTimer) clearTimeout(e.debounceTimer);
  delete _rqMatchEdits[pid];
  _rqAmSet(pid, { id: 'custom-' + Date.now(), name: name, category: 'Custom', isParent: false, sku: '', isCustom: true });
}

// ── Sorted items ──────────────────────────────────────────────────────────────

function _rqSortedItems() {
  var items = itemsFor('restock').slice();
  items.sort(function(a, b) {
    var aAssigned = !!(_rqMeta.assignees[a.notionPageId]);
    var bAssigned = !!(_rqMeta.assignees[b.notionPageId]);
    if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
    var ai = _rqMeta.order.indexOf(a.notionPageId);
    var bi = _rqMeta.order.indexOf(b.notionPageId);
    if (ai === -1) ai = 9999;
    if (bi === -1) bi = 9999;
    if (ai !== bi) return ai - bi;
    return (a.created || '').localeCompare(b.created || '');
  });
  return items;
}

function _rqPatch(pageId, fields) {
  return fetch('/api/notion-notes?pageId=' + encodeURIComponent(pageId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }).catch(function() { toast('Failed to save', '⚠'); });
}

// ── Timer helpers ─────────────────────────────────────────────────────────────

function _rqShortName(text) {
  var idx = text.indexOf(' – ');  // ' – '
  return idx === -1 ? text : text.slice(0, idx).trim();
}

function _rqFmtElapsed(ms) {
  var m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h > 0 ? h + 'h ' + (m % 60) + 'm' : m + 'm';
}

function _rqFmtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Stable per-browser id, so a device can tell which shared timers are ITS OWN
// (safe to re-assert) versus ones it merely received from another device
// (must never be re-pushed, or a stale zombie gets resurrected).
function _rqDeviceId() {
  var id = '';
  try { id = localStorage.getItem('sts-rq-device') || ''; } catch (e) {}
  if (!id) {
    id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem('sts-rq-device', id); } catch (e) {}
  }
  return id;
}

function _rqTimerPayload(pid) {
  var t = _rqTimers[pid];
  if (!t) return null;
  return {
    startTime: t.startTime, employee: t.employee, sessionNotionPageId: t.sessionNotionPageId,
    itemText: t.itemText, items: t.items || null, richMatch: t.richMatch || null,
    deviceId: t.deviceId || null,
  };
}

// Persist the full local view to localStorage only (device-local, for instant
// restore on reload). NEVER pushes the whole blob to KV — that was the clobber.
function _rqWriteLocal() {
  var state = {};
  Object.keys(_rqTimers).forEach(function(pid) { state[pid] = _rqTimerPayload(pid); });
  try { localStorage.setItem('sts_rqTimers', JSON.stringify(state)); } catch (e) {}
}

// Add/update ONE timer in the shared KV union (start or mid-run edit).
function _rqPersistTimer(pid) {
  _rqWriteLocal();
  var payload = _rqTimerPayload(pid);
  if (!payload) return;
  var obj = {}; obj[pid] = payload;
  fetch('/api/rq-timer-state', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upsert: obj }),
  }).catch(function() {});
}

// Remove ONE timer from the shared KV union (stop). Call AFTER deleting it
// from _rqTimers so _rqWriteLocal drops it from localStorage too.
function _rqUnpersistTimer(pid) {
  _rqWriteLocal();
  fetch('/api/rq-timer-state', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remove: pid }),
  }).catch(function() {});
}

function _rqRestoreTimers() {
  try {
    var saved = JSON.parse(localStorage.getItem('sts_rqTimers') || '{}');
    Object.keys(saved).forEach(function(pid) {
      var s = saved[pid];
      if (_rqTimers[pid]) return;
      _rqTimers[pid] = { startTime: s.startTime, employee: s.employee, sessionNotionPageId: s.sessionNotionPageId, itemText: s.itemText, items: s.items || null, richMatch: s.richMatch || null, deviceId: s.deviceId || null, notes: '', tickInterval: null };
      _rqStartTick(pid);
    });
  } catch (e) {}
  _rqReconcileTimers();
  _rqStartReconcilePoll();
}

// Pulls the shared KV union and reconciles it against our in-memory view.
// Runs once at boot (from _rqRestoreTimers) AND periodically thereafter (see
// _rqStartReconcilePoll below) so a stop or edit made on another device shows
// up here within one poll interval instead of only at next page load/reload.
//
//   - pid on server, not tracked locally             → adopt (another device
//                                                       started it since we
//                                                       last checked)
//   - pid tracked locally as OURS, missing on server → self-heal (re-push).
//                                                       Should be rare — we
//                                                       unpersist before
//                                                       deleting our own copy
//                                                       on a real stop — but
//                                                       covers a dropped PUT.
//   - pid tracked locally as FOREIGN, missing on server → the owning device
//                                                       stopped it — drop our
//                                                       copy too. We're a
//                                                       read-only relay for
//                                                       timers we didn't
//                                                       start, never the
//                                                       authority on them.
//   - pid tracked locally as FOREIGN, present but changed → refresh our copy
//                                                       (owner mid-run edit,
//                                                       e.g. size/qty or
//                                                       notion page linkup).
//                                                       Never done for OUR
//                                                       OWN timers — that
//                                                       would race our own
//                                                       in-flight edits
//                                                       against a poll that
//                                                       read a stale server
//                                                       copy moments before
//                                                       our own PUT landed.
function _rqReconcileTimers() {
  fetch('/api/rq-timer-state')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(serverState) {
      if (!serverState) return;
      var myId = _rqDeviceId();
      var changed = false;

      // Foreign timer removed remotely (owner stopped it) → drop locally.
      Object.keys(_rqTimers).forEach(function(pid) {
        var t = _rqTimers[pid];
        if (t.deviceId !== myId && !serverState[pid]) {
          clearInterval(t.tickInterval);
          delete _rqTimers[pid];
          changed = true;
        }
      });

      // Our own timer missing remotely → self-heal (re-assert), never resurrect
      // a timer we merely received from another device (handled above instead).
      Object.keys(_rqTimers).forEach(function(pid) {
        if (_rqTimers[pid].deviceId === myId && !serverState[pid]) _rqPersistTimer(pid);
      });

      // New timer from another device → adopt.
      Object.keys(serverState).forEach(function(pid) {
        if (_rqTimers[pid]) return; // already tracked (ours or already-adopted)
        var s = serverState[pid];
        _rqTimers[pid] = { startTime: s.startTime, employee: s.employee, sessionNotionPageId: s.sessionNotionPageId, itemText: s.itemText, items: s.items || null, richMatch: s.richMatch || null, deviceId: s.deviceId || null, notes: '', tickInterval: null };
        _rqStartTick(pid);
        changed = true;
      });

      // Foreign timer's fields changed remotely (owner mid-run edit) → refresh.
      Object.keys(_rqTimers).forEach(function(pid) {
        var t = _rqTimers[pid];
        if (t.deviceId === myId) return; // never clobber our own in-flight edits
        var s = serverState[pid];
        if (!s) return;
        var nextItems = JSON.stringify(s.items || null);
        var nextRich  = JSON.stringify(s.richMatch || null);
        if (nextItems !== JSON.stringify(t.items || null) || nextRich !== JSON.stringify(t.richMatch || null)
            || s.sessionNotionPageId !== t.sessionNotionPageId || s.itemText !== t.itemText) {
          t.items = s.items || null;
          t.richMatch = s.richMatch || null;
          t.sessionNotionPageId = s.sessionNotionPageId;
          t.itemText = s.itemText;
          t.employee = s.employee;
          changed = true;
        }
      });

      if (changed) restockQueueRender();
    })
    .catch(function() {});
}

// Started once (guarded) at first boot-time restore. 25s keeps the "another
// device stopped/edited this" gap tight without hammering KV — the restock
// queue is a short-lived working view someone is actively watching while a
// timer runs, not a background tab, so this cadence is cheap in practice.
var _rqReconcilePoll = null;
function _rqStartReconcilePoll() {
  if (_rqReconcilePoll) return;
  _rqReconcilePoll = setInterval(_rqReconcileTimers, 25000);
}

function _rqStartTick(pid) {
  var t = _rqTimers[pid];
  if (!t) return;
  clearInterval(t.tickInterval);
  t.tickInterval = setInterval(function() {
    var el = document.getElementById('rq-elapsed-' + pid);
    if (el) el.textContent = _rqFmtElapsed(Date.now() - t.startTime);
  }, 30000);
}

function _rqRestartTicks() {
  Object.keys(_rqTimers).forEach(function(pid) {
    var t = _rqTimers[pid];
    clearInterval(t.tickInterval);
    var el = document.getElementById('rq-elapsed-' + pid);
    if (el) el.textContent = _rqFmtElapsed(Date.now() - t.startTime);
    t.tickInterval = setInterval(function() {
      var elInner = document.getElementById('rq-elapsed-' + pid);
      if (elInner) elInner.textContent = _rqFmtElapsed(Date.now() - t.startTime);
    }, 30000);
  });
}

// ── Queue render ──────────────────────────────────────────────────────────────

function restockQueueRender() {
  var list  = document.getElementById('restock-queue-list');
  var empty = document.getElementById('restock-queue-empty');
  if (!list) return;

  if (!_rqAmLoaded) { _rqAmLoad(); _rqAmLoaded = true; }

  if (!_rqMetaLoaded || !_rqSizesLoaded || !_rqNotesLoaded) {
    if (!_rqLoadingAll) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:#B0A898;font-size:13px;">Loading…</div>';
      list.style.display = 'flex';
      if (empty) empty.style.display = 'none';
      _rqLoadAll(restockQueueRender);
    }
    return;
  }

  var items = _rqSortedItems();
  if (items.length === 0) {
    list.style.display = 'none';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  list.style.display = 'flex';

  var PEOPLE = ['', 'Vanessa', 'Stevie', 'Kyle'];

  var firstUnassignedIdx = -1;
  for (var fi = 0; fi < items.length; fi++) {
    var fPid = items[fi].notionPageId || '';
    if (!(_rqMeta.assignees[fPid])) { firstUnassignedIdx = fi; break; }
  }

  list.innerHTML = items.map(function(item, idx) {
    var pid      = item.notionPageId || '';
    var assignee = (pid && _rqMeta.assignees[pid]) || '';
    var timer    = pid ? _rqTimers[pid] : null;
    var isRunning = !!timer;
    var isSetup  = pid ? !!_rqSetups[pid] : false;
    var cls      = assignee ? ' rq-' + assignee.toLowerCase() : '';
    var itemCls  = (isRunning || isSetup) ? ' rq-active' : '';
    var textCls  = item.done ? ' rq-done' : '';
    var shortText = _rqShortName(item.text);
    var safeText  = shortText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
    var safePid  = pid.replace(/'/g, '');
    var isFirst  = idx === 0;
    var isLast   = idx === items.length - 1;
    var isFirstUnassigned = !assignee && idx === firstUnassignedIdx;

    var startDisabled = !pid || !assignee || isRunning || isSetup;
    var startTitle    = !pid ? 'Saving…' : !assignee ? 'Assign first' : isRunning ? 'Running' : 'Start timer';
    var startOnclick  = startDisabled ? '' : 'onclick="rqStartTimer(\'' + safePid + '\',\'' + safeText.replace(/'/g, "\\'") + '\',\'' + assignee + '\')"';

    var match = pid ? _rqAutoMatches[pid] : null;
    var canExpand = pid && !isRunning && !isSetup;
    var expanded  = canExpand && !!_rqExpanded[pid];
    var editing   = expanded && !!_rqEditMode[pid];
    var safeTextAttr = shortText.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    var note = pid ? (_rqNotes[pid] || '') : '';

    var mainRow = '<div class="rq-item-row' + (canExpand ? ' rq-item-row-clickable' : '') + '"'
      + (canExpand ? ' onclick="rqRowClick(event,\'' + safePid + '\')"' : '') + '>'
      + (isRunning || isSetup ? '' :
          '<span class="rq-arrows">'
          + (!assignee ? '<button class="rq-arrow" onclick="rqMoveToTop(' + idx + ')" ' + (isFirstUnassigned ? 'disabled' : '') + ' title="Move to top">⇈</button>' : '')
          + '<button class="rq-arrow" onclick="rqMove(' + idx + ',-1)" ' + (isFirst ? 'disabled' : '') + ' title="Move up">▲</button>'
          + '<button class="rq-arrow" onclick="rqMove(' + idx + ',1)"  ' + (isLast  ? 'disabled' : '') + ' title="Move down">▼</button>'
          + '</span>'
        )
      + '<span class="rq-rank">' + (idx + 1) + '</span>'
      + (canExpand ? '<span class="rq-expand-caret">' + (expanded ? '▾' : '▸') + '</span>' : '')
      + '<span class="rq-text' + textCls + '">' + safeText + (note ? ' <span class="rq-note-flag" title="Has a note">📝</span>' : '') + '</span>'
      + '<div class="rq-item-controls">'
      + '<button class="rq-start-btn" ' + startOnclick + (startDisabled ? ' disabled' : '') + ' title="' + startTitle + '">⏱</button>'
      + '<select class="rq-assignee' + cls + '" onchange="rqSetAssignee(this,' + idx + ')">'
      + PEOPLE.map(function(p) {
          return '<option value="' + p + '"' + (assignee === p ? ' selected' : '') + '>' + (p || '— unassigned —') + '</option>';
        }).join('')
      + '</select>'
      + '<span class="rq-del" onclick="rqDeleteItem(' + idx + ')" title="Remove">×</span>'
      + '</div>'
      + '</div>';

    var safeNoteAttr = note.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    var safeNoteHtml = _rqEsc(note);

    var matchRow = '';
    if (expanded) {
      if (editing) {
        matchRow = '<div class="rq-expand-panel">'
          + '<div class="rq-edit-title-row">'
          + '<input type="text" class="rq-edit-title-input" value="' + safeTextAttr + '"'
          + ' onchange="rqSaveTitleInput(this,' + idx + ')" onkeydown="if(event.key===\'Enter\')this.blur()">'
          + '</div>'
          + '<div class="rq-match-row" id="rq-match-row-' + safePid + '">' + _rqMatchRowInner(pid) + '</div>'
          + '<textarea class="rq-note-textarea" placeholder="Add a note… (handy for items not in Square)"'
          + ' onchange="rqSetNote(\'' + safePid + '\',this.value)">' + safeNoteAttr + '</textarea>'
          + '<button class="rq-edit-done-btn" onclick="rqExitEditMode(\'' + safePid + '\')">✓ Done editing</button>'
          + '</div>';
      } else {
        matchRow = '<div class="rq-expand-panel">'
          + _rqReadSummaryHtml(match)
          + (note ? '<div class="rq-note-display">📝 ' + safeNoteHtml + '</div>' : '')
          + '<button class="rq-edit-btn" onclick="rqEnterEditMode(\'' + safePid + '\')">✎ Edit</button>'
          + '</div>';
      }
    }

    var timerPanel = '';
    if (isRunning) {
      var elapsed = _rqFmtElapsed(Date.now() - timer.startTime);
      var startLbl = _rqFmtTime(timer.startTime);
      var itemLbl = (timer.items && timer.items[0]) ? timer.items[0].name : (timer.itemText || '');
      timerPanel = '<div class="rq-timer-panel">'
        + '<div class="rq-timer-running-row">'
        + '<span class="rq-timer-dot"></span>'
        + '<span class="rq-timer-emp">' + (timer.employee.name || '') + '</span>'
        + (itemLbl ? '<span class="rq-timer-meta" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + itemLbl.replace(/</g,'&lt;') + '</span>' : '')
        + '<span class="rq-timer-meta">started <span id="rq-startlbl-' + safePid + '">' + startLbl + '</span></span>'
        + '<span class="rq-timer-elapsed" id="rq-elapsed-' + safePid + '">' + elapsed + '</span>'
        + '<button class="rq-stop-btn" onclick="rqStopTimer(\'' + safePid + '\')" id="rq-stop-' + safePid + '">Stop &amp; Save</button>'
        + '</div>'
        + _rqTimerSizesHtml(safePid, timer.richMatch || match)
        + _rqTimerPiecesInputsHtml(safePid, timer)
        + '<div style="display:flex;align-items:center;gap:14px;margin-top:2px;">'
        + '<button class="rq-timer-notes-toggle" onclick="rqToggleTimerNotes(\'' + safePid + '\')">▾ notes</button>'
        + '<button class="rq-adjust-link" onclick="rqToggleAdjustStart(\'' + safePid + '\')">✎ adjust start</button>'
        + '</div>'
        + '<div class="rq-adjust-panel" id="rq-adjust-' + safePid + '">'
        + '<input type="datetime-local" class="rq-adjust-input" id="rq-adjust-input-' + safePid + '">'
        + '<button class="rq-save-note-btn" onclick="rqApplyAdjustStart(\'' + safePid + '\')">Update</button>'
        + '</div>'
        + '<div class="rq-timer-notes-wrap" id="rq-notesarea-' + safePid + '">'
        + '<textarea class="rq-timer-notes-area" id="rq-notes-' + safePid + '" placeholder="Optional notes…"></textarea>'
        + '<button class="rq-save-note-btn" onclick="rqSaveTimerNote(\'' + safePid + '\')">Save note</button>'
        + '</div>'
        + '</div>';
    }

    var setupPanel = '';
    if (isSetup && !isRunning) {
      var setup = _rqSetups[pid];
      var startVal = _rqToDateTimeLocal(setup.startTimeMs || Date.now());
      var canStart = setup.selectedItems.length > 0;
      setupPanel = '<div class="rq-setup-panel">'
        + '<div class="rq-setup-search-wrap">'
        + '<span class="rq-setup-search-icon">⌕</span>'
        + '<input type="text" class="rq-setup-search-input" id="rq-srch-' + safePid + '" placeholder="Search Square catalog…" autocomplete="off"'
        + ' oninput="rqSearchInput(\'' + safePid + '\',this.value)">'
        + '<div class="rq-setup-spinner" id="rq-spinner-' + safePid + '"></div>'
        + '</div>'
        + '<div class="rq-setup-results" id="rq-results-' + safePid + '"></div>'
        + '<div id="rq-selected-' + safePid + '">' + _rqSelectedHTML(pid) + '</div>'
        + '<div class="rq-setup-footer">'
        + '<input type="datetime-local" class="rq-adjust-input" id="rq-sstart-' + safePid + '" value="' + startVal + '" onchange="rqSetupStartChange(\'' + safePid + '\',this.value)">'
        + '<button class="rq-setup-cancel-btn" onclick="rqCancelSetup(\'' + safePid + '\')">Cancel</button>'
        + '<button class="rq-start-confirm-btn" id="rq-confirm-' + safePid + '" onclick="rqStartTimerConfirm(\'' + safePid + '\')"' + (canStart ? '' : ' disabled') + '>▶ Start Timer</button>'
        + '</div>'
        + '</div>';
    }

    return '<div class="rq-item' + itemCls + '" id="rq-item-' + idx + '">' + mainRow + matchRow + timerPanel + setupPanel + '</div>';
  }).join('');

  // Trigger auto-match for items not yet cached. This used to stagger each
  // item with setTimeout(fn, i*200) — but mobile browsers throttle timers
  // hard once a tab is backgrounded/screen-locked, so an item far enough
  // down the queue could simply never get its turn if the user glanced away.
  // A small-concurrency promise queue isn't timer-based, so once a job has
  // actually started its fetch is not subject to that throttling.
  var _rqAmPending = [];
  items.forEach(function(item) {
    var pid = item.notionPageId;
    if (!pid || _rqTimers[pid] || _rqSetups[pid]) return;
    if (_rqAutoMatches[pid] !== undefined) return;
    _rqAutoMatches[pid] = '_loading_'; // claim immediately so a later render doesn't enqueue it twice
    _rqUpdateMatchRow(pid);
    _rqAmPending.push({ pid: pid, text: item.text });
  });
  _rqRunAutoMatchQueue(_rqAmPending);

  _rqFetchInvCounts(); // debounced; re-collects ids for any newly-matched items each time it's called

  _rqRestartTicks();
  Object.keys(_rqSetups).forEach(function(pid) {
    var s = _rqSetups[pid];
    var inp = document.getElementById('rq-srch-' + pid);
    if (inp && s.query) { inp.value = s.query; }
    if (s._lastResults && s._lastResults.length) _rqRenderResults(pid, s._lastResults, s.query);
  });
}

// ── Timer start / stop ────────────────────────────────────────────────────────

function rqStartTimer(pid, itemText, assigneeName) {
  if (!pid || !assigneeName) { toast('Assign first', '⚠'); return; }
  if (_rqTimers[pid] || _rqSetups[pid]) return;
  var cached = _rqAutoMatches[pid];
  var preSelected = [];
  if (cached && typeof cached === 'object') {
    // Total pieces is already known from the sizes table — no need to ask
    // the employee to retype it when the timer stops. Keep the item's
    // real shape (isParent/selectedVariants) intact rather than flattening
    // sizes into a comma-joined name string, so the setup panel and timer
    // panel can render the same vertical sizes list the regular bars use.
    var totalQty = (cached.isParent && cached.selectedVariants)
      ? cached.selectedVariants.reduce(function(sum, v) { return sum + (v.qty || 0); }, 0) : 0;
    preSelected = [Object.assign({}, cached, { pieces: totalQty || null })];
  }
  // Keep a dedicated reference to the rich match for the duration of the
  // run (read/written by _rqMatchRowInner and rqSetInlineVariantQty while
  // a timer is active, then reconciled back into _rqAutoMatches on stop).
  var richMatch = (cached && typeof cached === 'object' && cached.isParent) ? cached : null;
  _rqSetups[pid] = { selectedItems: preSelected, query: preSelected.length ? '' : (itemText || ''), debounceTimer: null, startTimeMs: Date.now(), _lastResults: null, richMatch: richMatch };
  restockQueueRender();
  // Auto-search only if no pre-match
  if (!preSelected.length) {
    setTimeout(function() { if (_rqSetups[pid]) _rqSearchCatalog(pid, itemText || '', true); }, 80);
  }
}

function rqStopTimer(pid) {
  var t = _rqTimers[pid];
  if (!t) return;
  // Require every item/variant to have a piece count before the session can
  // be saved — otherwise "Pieces Made" silently stays blank in Notion forever.
  var missingRow = _rqLiveTimerRows(t).some(function(r) { return r.pieces == null; });
  if (missingRow) {
    toast('Enter pieces made before stopping the timer', '⚠');
    var firstInput = document.querySelector('#rq-match-row-' + pid + ' .rq-variant-qty-inline, #rq-match-row-' + pid + ' .rq-variant-qty, .rq-timer-pieces.rq-pieces-missing .rq-piece-input');
    if (firstInput) { firstInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstInput.focus(); }
    return;
  }
  var stopBtn = document.getElementById('rq-stop-' + pid);
  if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = 'Saving…'; }
  clearInterval(t.tickInterval);
  // Carry any mid-run size/qty edits (made against t.richMatch) back into
  // the bar's permanent match cache, so they survive after the timer ends
  // instead of reverting to whatever was set when the timer started.
  if (t.richMatch) { _rqAmSet(pid, t.richMatch); _rqSaveSizesFor(pid, t.richMatch.selectedVariants || []); }
  var stopTime = new Date().toISOString();
  var totalMs  = Date.now() - t.startTime;
  var totalMin = parseFloat((totalMs / 60000).toFixed(2));
  var netMin   = Math.max(0, totalMin - 15);
  // Capture notes from the live DOM before clearing state; piece counts
  // come from the matched sizes table (_rqLiveTimerRows), reading whatever
  // was last edited — not a snapshot taken when the timer started.
  var notesEl  = document.getElementById('rq-notes-' + pid);
  var notes    = notesEl ? notesEl.value.trim() : (t.notes || '');
  var rows     = _rqLiveTimerRows(t);
  var expandedItems = rows.map(function(row) {
    return { name: row.label, squareId: row.squareId, pieces: row.pieces, isCustom: row.isCustom };
  });
  var totalPcs = null;
  expandedItems.forEach(function(it) { if (it.pieces != null) totalPcs = (totalPcs || 0) + it.pieces; });
  var laborRate = _rqRateFor((t.employee && t.employee.name) || '');
  var session  = {
    notionPageId: t.sessionNotionPageId,
    items: expandedItems,
    employee: t.employee,
    laborRate: laborRate,
    startTime: new Date(t.startTime).toISOString(),
    stopTime: stopTime,
    totalMs: totalMs,
    netMs: netMin * 60000,
    notes: notes,
    saved: false,
    error: null,
  };
  delete _rqTimers[pid];
  _rqUnpersistTimer(pid);
  _rqSessions.unshift(session);
  rqRenderSessions();
  // Stopping the timer means the work is done — clear the card from the
  // queue instead of leaving it for a manual × removal.
  _rqDeleteItemByPid(pid);
  if (!session.notionPageId) { session.saved = true; rqRenderSessions(); return; }
  _rqAttachItemPrices(expandedItems).then(function(pricedItems) {
    session.items = pricedItems;
    var patchBody = { pageId: session.notionPageId, stopTime: stopTime, totalMin: totalMin, netMin: netMin, notes: notes, itemsJson: JSON.stringify(pricedItems), laborRate: laborRate };
    if (totalPcs != null) patchBody.pieces = totalPcs;
    return fetch('/api/notion-timesession', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      session.saved = res.ok;
      session.error = res.ok ? null : 'Notion error';
      rqRenderSessions();
      if (!res.ok) { toast('Notion save failed', '⚠'); return; }
      if (res.data && res.data.warning) { toast(res.data.warning, '⚠'); return; }
      toast('Session saved ✓', '✓');
    });
  }).catch(function() { session.error = 'Network error'; rqRenderSessions(); });
}

function rqToggleTimerNotes(pid) {
  var el = document.getElementById('rq-notesarea-' + pid);
  if (!el) return;
  el.style.display = el.style.display === 'none' || el.style.display === '' ? 'block' : 'none';
}

function rqSaveTimerNote(pid) {
  var t = _rqTimers[pid]; if (!t) return;
  var notesEl = document.getElementById('rq-notes-' + pid);
  var notes = notesEl ? notesEl.value.trim() : '';
  t.notes = notes;
  if (t.sessionNotionPageId) {
    fetch('/api/notion-timesession', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: t.sessionNotionPageId, notes: notes }),
    }).then(function(r) { if (r.ok) toast('Note saved ✓', '✓'); }).catch(function() {});
  }
}

// Formats a timestamp — ms epoch OR ISO string, since Date accepts both — as a
// <input type="datetime-local"> value. Returns '' for a null/empty input so a
// session with no stop time yet renders a blank field instead of "Invalid Date".
// Single definition shared by the inline timer adjust-start (passes ms) and the
// session edit form in restock-sessions.js (passes a session start/stop time):
// these were formerly two identically-named functions, one per section, where
// the guarded session version silently shadowed the timer one.
function _rqToDateTimeLocal(value) {
  if (!value) return '';
  var d = new Date(value);
  var p = function(n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function rqToggleAdjustStart(pid) {
  var panel = document.getElementById('rq-adjust-' + pid);
  if (!panel) return;
  var opening = panel.style.display !== 'flex';
  if (opening) {
    var input = document.getElementById('rq-adjust-input-' + pid);
    var t = _rqTimers[pid];
    if (input && t) input.value = _rqToDateTimeLocal(t.startTime);
    panel.style.display = 'flex';
  } else {
    panel.style.display = 'none';
  }
}

function rqApplyAdjustStart(pid) {
  var input = document.getElementById('rq-adjust-input-' + pid);
  if (!input || !input.value) return;
  var d = new Date(input.value);
  if (isNaN(d.getTime()) || d.getTime() > Date.now()) {
    toast('Invalid time — cannot be in the future', '⚠');
    return;
  }
  var t = _rqTimers[pid];
  if (!t) return;
  t.startTime = d.getTime();
  _rqPersistTimer(pid);
  if (t.sessionNotionPageId) {
    fetch('/api/notion-timesession', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: t.sessionNotionPageId, startTime: new Date(t.startTime).toISOString() }),
    }).catch(function() {});
  }
  var panel = document.getElementById('rq-adjust-' + pid);
  if (panel) panel.style.display = 'none';
  var startEl = document.getElementById('rq-startlbl-' + pid);
  if (startEl) startEl.textContent = _rqFmtTime(t.startTime);
  var elapsedEl = document.getElementById('rq-elapsed-' + pid);
  if (elapsedEl) elapsedEl.textContent = _rqFmtElapsed(Date.now() - t.startTime);
  toast('Start time updated', '✓');
}

// ── Setup panel functions (Square search before timer starts) ─────────────────

function rqCancelSetup(pid) {
  var s = _rqSetups[pid];
  if (s && s.debounceTimer) clearTimeout(s.debounceTimer);
  delete _rqSetups[pid];
  restockQueueRender();
}

function rqSetupStartChange(pid, value) {
  var s = _rqSetups[pid]; if (!s) return;
  var d = new Date(value);
  if (!isNaN(d.getTime())) s.startTimeMs = d.getTime();
}

function rqSearchInput(pid, value) {
  var s = _rqSetups[pid]; if (!s) return;
  s.query = value;
  if (s.debounceTimer) clearTimeout(s.debounceTimer);
  if (!value || value.length < 2) {
    var box = document.getElementById('rq-results-' + pid);
    if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    return;
  }
  s.debounceTimer = setTimeout(function() { _rqSearchCatalog(pid, value, false); }, 350);
}

// Never attaches a client token — /api/square always falls back to the
// server's own SQUARE_TOKEN env var when none is sent. There is no
// per-browser override: a stale/invalid token saved in one browser's
// localStorage used to silently break Square calls on just that device
// while every other device (and the server itself) worked fine.
function _rqSqCall(path, opts) {
  opts = opts || {};
  var payload = { path: '/v2' + path, method: opts.method || 'GET' };
  if (opts.body) payload.body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
  return fetch('/api/square', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(function(r) { return r.json(); });
}

function _rqLocalSearch(query) {
  var q = (query || '').toLowerCase();
  return _RQ_LOCAL_ITEMS.filter(function(it) {
    return it.name.toLowerCase().indexOf(q) !== -1 || it.category.toLowerCase().indexOf(q) !== -1;
  });
}

// Builds the { id, name, options:[{id,name,price,onByDefault}] } list for each Square
// modifier list attached to an item (e.g. metal/style choices for Chevron Stackers) —
// these come back in the batch-retrieve response's related_objects, not on the item itself.
function _rqBuildModifierLists(obj, modifierListsById) {
  var info = (obj.item_data && obj.item_data.modifier_list_info) || [];
  var lists = [];
  info.forEach(function(entry) {
    if (entry.enabled === false) return;
    var list = modifierListsById[entry.modifier_list_id];
    if (!list || !list.modifier_list_data) return;
    var overridesById = {};
    (entry.modifier_overrides || []).forEach(function(ov) { overridesById[ov.modifier_id] = ov; });
    var options = (list.modifier_list_data.modifiers || []).map(function(m) {
      var md = m.modifier_data || {};
      var pm = md.price_money;
      var override = overridesById[m.id];
      return {
        id: m.id,
        name: md.name || 'Option',
        price: pm && pm.amount ? pm.amount / 100 : 0,
        onByDefault: override ? !!override.on_by_default : !!md.on_by_default,
      };
    });
    if (!options.length) return;
    lists.push({ id: list.id, name: list.modifier_list_data.name || 'Options', options: options });
  });
  return lists;
}

// Finds the "Stone" modifier list on a matched item (e.g. Double Chevron
// (Stone Set)) and returns its options as { idx, name } — idx is the
// option's position in the list, used (instead of the long Square modifier
// id) to keep the per-size stone choice compact in the shared sizes store.
function _rqStoneOptionsFor(match) {
  var lists = (match && match.modifierLists) || [];
  var stoneList = lists.filter(function(l) { return (l.name || '').toLowerCase() === 'stone'; })[0];
  if (!stoneList) return null;
  return stoneList.options.map(function(o, i) { return { idx: i, name: o.name }; });
}

function _rqDefaultModifierSelections(modifierLists) {
  var selected = {};
  (modifierLists || []).forEach(function(list) {
    var def = list.options.filter(function(o) { return o.onByDefault; })[0] || list.options[0];
    if (def) selected[list.id] = def.id;
  });
  return selected;
}

// Setup-panel catalog search. Delegates the Square search→batch-retrieve→parse
// to the shared _rqSqSearchExpand helper (whose row shape — id/name/sku/category/
// isParent/variantCount/variants/modifierLists — matches what this panel needs
// 1:1, modifier lists included) and keeps only the setup-specific concerns here:
// the spinner, the stale-setup guard, local-item fallback, and the autoSelect vs
// render branch. _rqSqSearchExpand resolves to [] on both no-results and network
// error, so a failed lookup simply falls back to whatever local matches exist.
function _rqSearchCatalog(pid, query, autoSelect) {
  var s = _rqSetups[pid]; if (!s) return;
  var spinner = document.getElementById('rq-spinner-' + pid);
  if (spinner) { spinner.style.display = 'block'; spinner.classList.add('active'); }
  var localMatches = _rqLocalSearch(query);
  _rqSqSearchExpand(query).then(function(squareRows) {
    if (!_rqSetups[pid]) return;
    var rows = localMatches.concat(squareRows);
    if (autoSelect) {
      if (rows.length) { _rqSelectSetupItem(pid, rows[0]); }
      else             { _rqShowNoMatch(pid, query); }
    } else {
      _rqRenderResults(pid, rows, query);
    }
  }).then(function() {
    var sp = document.getElementById('rq-spinner-' + pid);
    if (sp) { sp.style.display = 'none'; sp.classList.remove('active'); }
  });
}

function _rqShowNoMatch(pid, query) {
  var box = document.getElementById('rq-results-' + pid);
  if (!box) return;
  var safeQ = (query || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  var escQ  = (query || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  box.innerHTML = '<div class="rq-result-none rq-result-nomatch">No Square match for "' + safeQ + '" — search manually or use as custom item below</div>'
    + '<div class="rq-result-item" onclick="rqSelectCustomItem(\'' + pid + '\',\'' + escQ + '\')" style="color:var(--accent);font-weight:600;">＋ Use "' + safeQ + '" as custom item</div>';
  box.style.display = 'flex';
}

function _rqRenderResults(pid, items, query) {
  var box = document.getElementById('rq-results-' + pid);
  if (!box) return;
  var s = _rqSetups[pid];
  if (s) s._lastResults = items;
  if (!items || !items.length) {
    var safeQ = (query || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    var escQ  = (query || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    box.innerHTML = '<div class="rq-result-none">No match for "' + safeQ + '"</div>'
      + '<div class="rq-result-item" onclick="rqSelectCustomItem(\'' + pid + '\',\'' + escQ + '\')" style="color:var(--accent);font-weight:600;">＋ Use "' + safeQ + '" as custom item</div>';
    box.style.display = 'flex';
    return;
  }
  box.innerHTML = items.map(function(item) {
    var meta = item.isParent
      ? (item.category || '') + ' · ' + (item.variantCount || '') + ' sizes'
      : (item.category || '') + (item.sku ? ' · ' + item.sku : '');
    var price = item.isParent ? 'sizes at stop →' : '—';
    var safeId = (item.id || '').replace(/'/g,'').replace(/\\/g,'\\\\');
    return '<div class="rq-result-item" onclick="rqSelectItemById(\'' + pid + '\',\'' + safeId + '\')">'
      + '<div><div class="rq-result-name">' + (item.name || '').replace(/</g,'&lt;') + '</div>'
      + '<div class="rq-result-meta">' + meta.replace(/</g,'&lt;') + '</div></div>'
      + '<div class="rq-result-price">' + price + '</div>'
      + '</div>';
  }).join('');
  box.style.display = 'flex';
}

function rqSelectItemById(pid, itemId) {
  var s = _rqSetups[pid]; if (!s) return;
  var item = (s._lastResults || []).filter(function(it) { return it.id === itemId; })[0];
  if (!item) return;
  _rqSelectSetupItem(pid, item);
}

function rqSelectCustomItem(pid, name) {
  _rqSelectSetupItem(pid, { id: 'custom-' + Date.now(), name: name, category: 'Custom', isParent: false, sku: '', isCustom: true });
}

function _rqSelectSetupItem(pid, item) {
  var s = _rqSetups[pid]; if (!s) return;
  var already = s.selectedItems.filter(function(i) { return i.id === item.id; }).length > 0;
  if (!already) {
    var selectedModifierIds = _rqDefaultModifierSelections(item.modifierLists);
    s.selectedItems.push(Object.assign({}, item, { pieces: null, selectedModifierIds: selectedModifierIds }));
  }
  var box = document.getElementById('rq-results-' + pid);
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
  var inp = document.getElementById('rq-srch-' + pid);
  if (inp) inp.value = '';
  s.query = '';
  s._lastResults = null;
  _rqUpdateSelectedEl(pid);
  _rqUpdateConfirmBtn(pid);
}

function rqRemoveSetupItem(pid, itemId) {
  var s = _rqSetups[pid]; if (!s) return;
  s.selectedItems = s.selectedItems.filter(function(i) { return i.id !== itemId; });
  _rqUpdateSelectedEl(pid);
  _rqUpdateConfirmBtn(pid);
}

function rqSetSetupModifier(pid, itemId, listId, modifierId) {
  var s = _rqSetups[pid]; if (!s) return;
  var item = s.selectedItems.filter(function(i) { return i.id === itemId; })[0];
  if (!item) return;
  item.selectedModifierIds = item.selectedModifierIds || {};
  item.selectedModifierIds[listId] = modifierId;
  _rqUpdateSelectedEl(pid);
}

function _rqUpdateSelectedEl(pid) {
  var el = document.getElementById('rq-selected-' + pid);
  if (el) el.innerHTML = _rqSelectedHTML(pid);
}

function _rqUpdateConfirmBtn(pid) {
  var btn = document.getElementById('rq-confirm-' + pid);
  if (!btn) return;
  var s = _rqSetups[pid];
  btn.disabled = !s || s.selectedItems.length === 0;
}

function _rqSelectedHTML(pid) {
  var s = _rqSetups[pid]; if (!s || !s.selectedItems.length) return '';
  return '<div class="rq-selected-list">'
    + s.selectedItems.map(function(item) {
      var safeId = (item.id || '').replace(/'/g,'').replace(/\\/g,'\\\\');
      var modifierLists = item.modifierLists || [];
      var modifierRows = modifierLists.map(function(list) {
        var safeListId = (list.id || '').replace(/'/g,'').replace(/\\/g,'\\\\');
        var opts = list.options.map(function(o) {
          var sel = item.selectedModifierIds && item.selectedModifierIds[list.id] === o.id ? ' selected' : '';
          return '<option value="' + o.id + '"' + sel + '>' + (o.name || '').replace(/</g,'&lt;') + (o.price ? ' (+$' + o.price.toFixed(2) + ')' : '') + '</option>';
        }).join('');
        return '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">'
          + '<label style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--text3);flex-shrink:0;">' + (list.name || '').replace(/</g,'&lt;') + '</label>'
          + '<select onchange="rqSetSetupModifier(\'' + pid + '\',\'' + safeId + '\',\'' + safeListId + '\', this.value)" style="font-size:11px;padding:3px 6px;border:1px solid var(--bdr);border-radius:5px;background:#fff;flex:1;max-width:200px;">'
          + opts
          + '</select>'
          + '</div>';
      }).join('');
      // Same vertical sizes list the regular bars use, instead of a
      // comma-joined string crammed into the item name.
      var sizesHtml = (item.isParent && item.selectedVariants && item.selectedVariants.length)
        ? _rqReadSummaryHtml(item) : '';
      return '<div class="rq-selected-item" style="flex-direction:column;align-items:stretch;">'
        + '<div style="display:flex;align-items:center;gap:8px;">'
        + '<div style="flex:1;min-width:0;">'
        + '<div class="rq-result-name">' + (item.name || '').replace(/</g,'&lt;') + '</div>'
        + '<div class="rq-result-meta">' + (item.category || '') + (item.sku ? ' · ' + item.sku : '') + '</div>'
        + '</div>'
        + '<button class="rq-item-remove" onclick="rqRemoveSetupItem(\'' + pid + '\',\'' + safeId + '\')">✕</button>'
        + '</div>'
        + sizesHtml
        + modifierRows
        + '</div>';
    }).join('')
    + '</div>';
}

// ── Piece-count helpers ───────────────────────────────────────────────────────

// Appends the chosen modifier option name(s) (e.g. "Double Mixed (Silver+GF)") onto a
// timer row label so production logs reflect exactly which metal/style was made.
function _rqModifierSuffix(item) {
  var lists = item.modifierLists || [];
  var selected = item.selectedModifierIds || {};
  var names = [];
  lists.forEach(function(list) {
    var opt = list.options.filter(function(o) { return o.id === selected[list.id]; })[0];
    if (opt) names.push(opt.name);
  });
  return names.join(', ');
}

function _rqTimerRows(items) {
  var rows = [];
  (items || []).forEach(function(item) {
    var modSuffix = _rqModifierSuffix(item);
    if (item.isParent && item.selectedVariants && item.selectedVariants.length) {
      var stoneList = _rqStoneOptionsFor(item);
      item.selectedVariants.forEach(function(v) {
        var stoneOpt = stoneList && v.stoneIdx !== undefined ? stoneList[v.stoneIdx] : null;
        var label = (item.name || '') + ' – ' + (v.name || '')
          + (stoneOpt ? ' – ' + stoneOpt.name : '')
          + (modSuffix ? ' – ' + modSuffix : '');
        rows.push({ label: label, squareId: v.id || '', isCustom: false, pieces: v.qty != null ? v.qty : null });
      });
    } else {
      var label = (item.name || '') + (modSuffix ? ' – ' + modSuffix : '');
      rows.push({ label: label, squareId: item.isCustom ? '' : (item.id || ''), isCustom: !!item.isCustom, pieces: item.pieces != null ? item.pieces : null });
    }
  });
  return rows;
}

// Like _rqTimerRows, but reads live sizes/quantities from the timer's
// richMatch (editable on desktop while running) instead of the snapshot
// taken when the timer started — so an edit made mid-run actually changes
// what gets logged when the timer stops, not just what's displayed.
function _rqLiveTimerRows(t) {
  if (t.richMatch && t.richMatch.isParent && t.richMatch.selectedVariants && t.richMatch.selectedVariants.length) {
    var baseName = t.richMatch.name || '';
    var stoneList = _rqStoneOptionsFor(t.richMatch);
    return t.richMatch.selectedVariants.map(function(v) {
      var stoneOpt = stoneList && v.stoneIdx !== undefined ? stoneList[v.stoneIdx] : null;
      return { label: baseName + ' – ' + (v.name || '') + (stoneOpt ? ' – ' + stoneOpt.name : ''), squareId: v.id || '', isCustom: false, pieces: v.qty != null ? v.qty : null };
    });
  }
  return _rqTimerRows(t.items || [{ name: t.itemText }]);
}

// Read-only (mobile) / editable (desktop) sizes breakdown shown in the
// running-timer panel, in the slot the manual piece-count entry used to
// occupy — the counts are already known from the matched sizes table, so
// there's nothing left to ask the employee to type.
function _rqTimerSizesHtml(pid, match) {
  if (!match || typeof match !== 'object') return '';
  return '<div class="rq-timer-sizes">'
    + '<div class="rq-timer-sizes-readonly">' + _rqReadSummaryHtml(match) + '</div>'
    + '<div class="rq-timer-sizes-edit"><div class="rq-match-row" id="rq-match-row-' + pid + '">' + _rqMatchRowInner(pid) + '</div></div>'
    + '</div>';
}

// Inline "pieces made" input shown while a timer runs, for items that don't
// already get a live qty field from the parent/variant sizes table — this is
// the only place those items can have a piece count before Stop & Save, so
// rqStopTimer blocks on it being filled in.
function _rqTimerPiecesInputsHtml(pid, timer) {
  if (timer.richMatch && timer.richMatch.isParent) return '';
  var items = timer.items || [];
  if (!items.length) return '';
  var rows = items.map(function(item, idx) {
    if (item.isParent && item.selectedVariants && item.selectedVariants.length) return '';
    var val = item.pieces != null ? item.pieces : '';
    var label = _rqEsc(item.name || ('Item ' + (idx + 1)));
    return '<div class="rq-timer-pieces' + (val === '' ? ' rq-pieces-missing' : '') + '">'
      + '<label>' + label + ' — pcs made</label>'
      + '<input type="number" class="rq-piece-input" id="rq-pieces-' + pid + '-' + idx + '" min="0" step="1" placeholder="0" value="' + val + '"'
      + ' onchange="_rqSetTimerItemPieces(\'' + pid + '\',' + idx + ',this.value)">'
      + '</div>';
  }).join('');
  return rows ? '<div class="rq-timer-pieces-wrap">' + rows + '</div>' : '';
}

function _rqSetTimerItemPieces(pid, idx, raw) {
  var t = _rqTimers[pid]; if (!t || !t.items || !t.items[idx]) return;
  var v = (raw || '').trim() === '' ? null : parseInt(raw, 10);
  t.items[idx].pieces = isNaN(v) ? null : v;
  _rqPersistTimer(pid);
  var input = document.getElementById('rq-pieces-' + pid + '-' + idx);
  var wrap  = input && input.closest('.rq-timer-pieces');
  if (wrap) wrap.classList.toggle('rq-pieces-missing', t.items[idx].pieces == null);
}

function rqStartTimerConfirm(pid) {
  var s = _rqSetups[pid]; if (!s || !s.selectedItems.length) return;
  if (s.debounceTimer) clearTimeout(s.debounceTimer);
  var items = s.selectedItems.map(function(item) {
    return Object.assign({}, item, { pieces: item.pieces != null ? item.pieces : null });
  });
  var startTimeMs  = s.startTimeMs || Date.now();
  var assigneeName = (_rqMeta.assignees[pid]) || '';
  var primaryItem  = items[0] || {};
  var richMatch    = s.richMatch || null;
  delete _rqSetups[pid];
  // Write confirmed item back to bar match cache (strip pieces)
  if (items.length && primaryItem.id) {
    var matchItem = Object.assign({}, primaryItem);
    delete matchItem.pieces;
    _rqAmSet(pid, matchItem);
  }
  _rqTimers[pid] = {
    startTime: startTimeMs,
    employee: { name: assigneeName, id: '' },
    sessionNotionPageId: null,
    itemText: primaryItem.name || '',
    items: items,
    richMatch: richMatch,
    deviceId: _rqDeviceId(),
    notes: '',
    tickInterval: null,
  };
  _rqPersistTimer(pid);
  _rqStartTick(pid);
  // Create Notion session
  fetch('/api/notion-timesession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemName:     primaryItem.name     || '',
      sku:          primaryItem.sku      || '',
      category:     primaryItem.category || '',
      employeeName: assigneeName,
      squareItemId: primaryItem.isCustom ? '' : (primaryItem.id || ''),
      date:         new Date(startTimeMs).toISOString().slice(0, 10),
      startTime:    new Date(startTimeMs).toISOString(),
      notes:        '',
    }),
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.notionPageId && _rqTimers[pid]) {
      _rqTimers[pid].sessionNotionPageId = d.notionPageId;
      _rqPersistTimer(pid);
    }
  }).catch(function() {});
  restockQueueRender();
}

// ── Queue mutations ───────────────────────────────────────────────────────────

function rqMove(idx, dir) {
  var items = _rqSortedItems();
  var toIdx = idx + dir;
  if (toIdx < 0 || toIdx >= items.length) return;
  var tmp = items[idx];
  items[idx] = items[toIdx];
  items[toIdx] = tmp;
  _rqMeta.order = items.map(function(i) { return i.notionPageId; });
  _rqSaveMeta();
  restockQueueRender();
}

function rqMoveToTop(idx) {
  var items = _rqSortedItems();
  var item = items[idx];
  if (!item || !item.notionPageId) return;
  var pid = item.notionPageId;
  var order = _rqMeta.order.filter(function(id) { return id !== pid; });
  order.unshift(pid);
  _rqMeta.order = order;
  _rqSaveMeta();
  restockQueueRender();
}

function rqSetAssignee(selectEl, idx) {
  var item = _rqSortedItems()[idx];
  if (!item || !item.notionPageId) return;
  var person = selectEl.value;
  if (person) {
    _rqMeta.assignees[item.notionPageId] = person;
  } else {
    delete _rqMeta.assignees[item.notionPageId];
  }
  _rqSaveMeta();
  setTimeout(function() { restockQueueRender(); }, 0);
}

function rqAddItem() {
  var input = document.getElementById('rq-add-input');
  if (!input) return;
  var rawText = input.value.trim();
  if (!rawText) return;
  input.value = '';

  var pendingMatch = _rqAddPendingMatch;
  _rqAddPendingMatch = null;
  _rqAddLastResults = [];
  // Use the actual matched item's name (not the raw search-box text) so the
  // saved title is never the user's in-progress search string.
  var text = (pendingMatch && pendingMatch.name) ? pendingMatch.name : rawText;
  if (_rqAddDebounce) { clearTimeout(_rqAddDebounce); _rqAddDebounce = null; }
  _rqAddHideDropdown();
  var chip = document.getElementById('rq-add-chip');
  if (chip) chip.style.display = 'none';
  var sizesBox = document.getElementById('rq-add-sizes');
  if (sizesBox) { sizesBox.style.display = 'none'; sizesBox.innerHTML = ''; }

  var temp = { notionPageId: null, text: text, block: 'Inventory Restock', done: false, _saving: true };
  NOTES_DATA.push(temp);
  restockQueueRender();

  fetch('/api/notion-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text, block: 'Inventory Restock' }),
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (!res.ok) {
        NOTES_DATA.splice(NOTES_DATA.indexOf(temp), 1);
        restockQueueRender();
        toast('Failed to add item', '⚠');
        return;
      }
      temp.notionPageId = res.data.notionPageId;
      temp._saving = false;
      if (pendingMatch) {
        _rqAmSet(res.data.notionPageId, pendingMatch);
        if (pendingMatch.isParent) {
          if (pendingMatch.selectedVariants && pendingMatch.selectedVariants.length) {
            // Sizes were already picked inline in the add bar.
            _rqSaveSizesFor(res.data.notionPageId, pendingMatch.selectedVariants);
          } else {
            // No sizes picked yet — expand straight into edit mode so the
            // size table is immediately visible and ready to fill in.
            _rqExpanded[res.data.notionPageId] = true;
            _rqEditMode[res.data.notionPageId] = true;
          }
        }
        restockQueueRender();
      } else {
        restockQueueRender();
      }
    })
    .catch(function() {
      NOTES_DATA.splice(NOTES_DATA.indexOf(temp), 1);
      restockQueueRender();
      toast('Failed to add item', '⚠');
    });
}

function rqAddInputChange(value) {
  var v = (value || '').trim();
  if (!v) { _rqAddClearPending(); _rqAddHideDropdown(); return; }
  if (_rqAddDebounce) clearTimeout(_rqAddDebounce);
  _rqAddDebounce = setTimeout(function() { _rqAddSearch(v); }, 350);
}

function _rqAddSearch(query) {
  var box = document.getElementById('rq-add-results');
  if (!box) return;
  box.innerHTML = '<div class="rq-match-loading"><span class="rq-match-spinner"></span>Searching…</div>';
  box.style.display = 'flex';
  var localMatches = _rqLocalSearch(query);
  _rqSqSearchExpand(query).then(function(squareRows) {
    // Add bar shows Square results when available, local items only as fallback
    _rqAddRenderResults(squareRows.length ? squareRows : localMatches, query);
  }).catch(function() {
    _rqAddRenderResults(localMatches, query);
  });
}

function _rqAddRenderResults(items, query) {
  _rqAddLastResults = items || [];
  var box = document.getElementById('rq-add-results');
  if (!box) return;
  if (!items || !items.length) {
    var safeQ = (query || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    var escQ  = (query || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    box.innerHTML = '<div class="rq-result-none">No match for "' + safeQ + '"</div>'
      + '<div class="rq-result-item" onclick="rqAddSelectCustom(\'' + escQ + '\')" style="color:var(--accent);font-weight:600;">＋ Use "' + safeQ + '" as custom item</div>';
    box.style.display = 'flex';
    return;
  }
  box.innerHTML = items.map(function(item) {
    var meta = item.isParent
      ? (item.category || '') + ' · ' + (item.variantCount || '') + ' sizes'
      : (item.category || '') + (item.sku ? ' · ' + item.sku : '');
    var safeId = (item.id || '').replace(/'/g, '').replace(/\\/g, '\\\\');
    return '<div class="rq-result-item" onclick="rqAddSelectItem(\'' + safeId + '\')">'
      + '<div><div class="rq-result-name">' + (item.name || '').replace(/</g, '&lt;') + '</div>'
      + '<div class="rq-result-meta">' + meta.replace(/</g, '&lt;') + '</div></div>'
      + '</div>';
  }).join('');
  box.style.display = 'flex';
}

function rqAddSelectItem(itemId) {
  var item = _rqAddLastResults.filter(function(it) { return it.id === itemId; })[0];
  if (!item) return;
  if (item.isParent) item = Object.assign({}, item, { selectedVariants: [] });
  _rqAddPendingMatch = item;
  _rqAddHideDropdown();
  _rqAddShowChip(item);
}

function rqAddSelectCustom(name) {
  _rqAddPendingMatch = { id: 'custom-' + Date.now(), name: name, category: 'Custom', isParent: false, sku: '', isCustom: true };
  _rqAddHideDropdown();
  _rqAddShowChip(_rqAddPendingMatch);
}

function rqAddClearItem() {
  _rqAddClearPending();
  _rqAddHideDropdown();
}

function _rqAddClearPending() {
  _rqAddPendingMatch = null;
  _rqAddLastResults = [];
  var chip = document.getElementById('rq-add-chip');
  if (chip) chip.style.display = 'none';
  var sizesBox = document.getElementById('rq-add-sizes');
  if (sizesBox) { sizesBox.style.display = 'none'; sizesBox.innerHTML = ''; }
}

function _rqAddHideDropdown() {
  var box = document.getElementById('rq-add-results');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

function _rqAddShowChip(item) {
  var chip = document.getElementById('rq-add-chip');
  if (!chip) return;
  var label = (item.name || '');
  chip.innerHTML = '<span>✓ ' + label.replace(/</g, '&lt;') + '</span>'
    + '<span class="rq-add-chip-x" onclick="rqAddClearItem()">×</span>';
  chip.style.display = 'flex';

  var sizesBox = document.getElementById('rq-add-sizes');
  if (!sizesBox) return;
  if (item.isParent) {
    var styleFilter = _rqApplyStyleFilter('add', item.variants);
    var filteredVariants = styleFilter.variants;
    var table = _rqBuildVariantTable(filteredVariants);
    var qtyByVariantId = {};
    var stoneByVariantId = {};
    (item.selectedVariants || []).forEach(function(v) {
      qtyByVariantId[v.id] = v.qty || '';
      if (v.stoneIdx !== undefined && v.stoneIdx !== null) stoneByVariantId[v.id] = v.stoneIdx;
    });
    var stoneList = _rqStoneOptionsFor(item);
    sizesBox.innerHTML = styleFilter.filterTabsHtml + (table
      ? _rqVariantTableHtml('add', table, qtyByVariantId, 'rqAddSetVariantQty')
      : _rqVariantFlatHtml('add', filteredVariants, qtyByVariantId, 'rqAddSetVariantQty', stoneList, stoneByVariantId, 'rqAddSetVariantStone'));
    sizesBox.style.display = 'block';
    _rqFetchInvCounts(); // fetch stock counts for this item's variants so the "Current Stock" row populates
  } else {
    sizesBox.style.display = 'none';
    sizesBox.innerHTML = '';
  }
}

// Mutates the pending (not-yet-saved) add-bar selection directly — the new
// item has no notionPageId yet, so this can't go through rqSetInlineVariantQty
// (which is keyed by pid into _rqAutoMatches/timers). Once the item is
// actually created, rqAddItem() persists whatever's selected here via
// _rqSaveSizesFor.
function rqAddSetVariantQty(_pid, variantId, value) {
  var item = _rqAddPendingMatch;
  if (!item || !item.isParent) return;
  var qty = parseInt(value, 10) || 0;
  var byId = {};
  (item.selectedVariants || []).forEach(function(v) { byId[v.id] = v; });
  var variant = (item.variants || []).filter(function(v) { return v.id === variantId; })[0];
  if (!variant) return;
  if (qty > 0) {
    var prevStone = byId[variantId] && byId[variantId].stoneIdx;
    byId[variantId] = Object.assign({}, variant, { qty: qty }, prevStone !== undefined ? { stoneIdx: prevStone } : {});
  } else delete byId[variantId];
  item.selectedVariants = (item.variants || [])
    .filter(function(v) { return byId[v.id]; })
    .map(function(v) { return byId[v.id]; });
  // Re-render so the stone dropdown appears/disappears immediately as a
  // size crosses the qty>0 threshold, instead of only showing up after
  // some unrelated re-render (e.g. on the next keystroke elsewhere).
  if (_rqStoneOptionsFor(item)) _rqAddShowChip(item);
}

// Same not-yet-saved-pid pattern as rqAddSetVariantQty — mutates
// _rqAddPendingMatch directly since this item has no notionPageId yet.
function rqAddSetVariantStone(_pid, variantId, stoneIdxStr) {
  var item = _rqAddPendingMatch;
  if (!item || !item.isParent) return;
  var stoneIdx = stoneIdxStr === '' ? undefined : parseInt(stoneIdxStr, 10);
  item.selectedVariants = (item.selectedVariants || []).map(function(v) {
    if (v.id !== variantId) return v;
    var next = Object.assign({}, v);
    if (stoneIdx === undefined) delete next.stoneIdx; else next.stoneIdx = stoneIdx;
    return next;
  });
}

function rqDeleteItem(idx) {
  var items = _rqSortedItems();
  var item = items[idx];
  if (!item) return;
  _rqDeleteItemObj(item);
}

function _rqDeleteItemByPid(pid) {
  var item = NOTES_DATA.filter(function(n) { return n.notionPageId === pid; })[0];
  if (!item) return;
  _rqDeleteItemObj(item);
}

function _rqDeleteItemObj(item) {
  var pid = item.notionPageId;
  // Clean up match state
  if (pid) {
    var me = _rqMatchEdits[pid];
    if (me && me.debounceTimer) clearTimeout(me.debounceTimer);
    delete _rqMatchEdits[pid];
    delete _rqExpanded[pid];
    delete _rqEditMode[pid];
    delete _rqAutoMatches[pid];
    _rqAmSave();
    if (_rqSizes[pid]) { delete _rqSizes[pid]; _rqSaveSizes(); }
    if (_rqNotes[pid]) { delete _rqNotes[pid]; _rqSaveNotes(); }
  }
  // Remove from NOTES_DATA by object identity
  var gi = NOTES_DATA.indexOf(item);
  if (gi !== -1) NOTES_DATA.splice(gi, 1);
  restockQueueRender();
  if (!pid) return;
  fetch('/api/notion-notes?pageId=' + encodeURIComponent(pid), { method: 'DELETE' })
    .catch(function() {
      // On network failure restore locally and notify
      NOTES_DATA.splice(gi !== -1 ? gi : NOTES_DATA.length, 0, item);
      restockQueueRender();
      toast('Failed to delete item', '⚠');
    });
}


