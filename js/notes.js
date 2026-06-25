// ════════════════════════════════════════════
//  NOTES  —  js/notes.js
//  All blocks stored in Notion via /api/notion-notes
// ════════════════════════════════════════════

var NOTES_DATA = [];   // flat array of { notionPageId, text, block, done }
var _notesPoller = null;
var _dragNote = null;  // { pageId, fromKey } set on dragstart

var BLOCK_MAP = {
  studio:   'Design Ideas',
  todo:     'To-Do',
  toorder:  'To Order',
  restock:  'Inventory Restock',
  webapp:   'Webapp Updates',
  market:   'Market & Display To-Do',
};

// ── Load ─────────────────────────────────────
function loadNotes() {
  ['studio','todo','toorder','restock','webapp','market'].forEach(function(key) {
    renderNotesList(key, []);
  });
  var spinner = document.getElementById('notes-loading');
  if (spinner) spinner.style.display = '';
  fetch('/api/notion-notes')
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; }); })
    .then(function(res) {
      if (spinner) spinner.style.display = 'none';
      if (!res.ok) {
        toast('Notion error ' + res.status + ': ' + (res.data.error || 'unknown'), '⚠');
        return;
      }
      NOTES_DATA = res.data || [];
      ['studio','todo','toorder','restock','webapp','market'].forEach(function(key) {
        renderNotesList(key, itemsFor(key));
      });
    })
    .catch(function(err) {
      if (spinner) spinner.style.display = 'none';
      toast('Could not reach /api/notion-notes — ' + (err || ''), '⚠');
    });
  if (!_notesPoller) {
    _notesPoller = setInterval(refreshNotes, 30000);
  }
}

function refreshNotes() {
  fetch('/api/notion-notes')
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (!res.ok) return;
      NOTES_DATA = res.data || [];
      ['studio','todo','toorder','restock','webapp','market'].forEach(function(key) {
        renderNotesList(key, itemsFor(key));
      });
      var queuePanel = document.getElementById('tab-to-restock');
      if (queuePanel && queuePanel.classList.contains('active')) restockQueueRender();
    })
    .catch(function() {});
}

function itemsFor(key) {
  var block = BLOCK_MAP[key];
  return NOTES_DATA.filter(function(n) { return n.block === block; });
}

// ── Add ──────────────────────────────────────
function addNoteItem(key) {
  var input = document.getElementById(key + '-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;
  input.value = '';

  var block = BLOCK_MAP[key];
  var temp = { notionPageId: null, text: text, block: block, done: false, _saving: true };
  NOTES_DATA.push(temp);
  renderNotesList(key, itemsFor(key));

  fetch('/api/notion-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text, block: block }),
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; }); })
    .then(function(res) {
      if (!res.ok) {
        NOTES_DATA.splice(NOTES_DATA.indexOf(temp), 1);
        renderNotesList(key, itemsFor(key));
        var msg = 'Save failed ' + res.status + ': ' + (res.data.error || 'unknown') + (res.data.code ? ' (' + res.data.code + ')' : '');
        console.error('notion-notes POST error:', res);
        alert(msg);
        return;
      }
      temp.notionPageId = res.data.notionPageId;
      temp._saving = false;
      renderNotesList(key, itemsFor(key));
    })
    .catch(function(err) {
      NOTES_DATA.splice(NOTES_DATA.indexOf(temp), 1);
      renderNotesList(key, itemsFor(key));
      console.error('notion-notes POST catch:', err);
      alert('Failed to save note: ' + err);
    });
}

function addStudioNote() {
  addNoteItem('studio');
}

// ── Toggle done ───────────────────────────────
function toggleNoteItem(key, idx) {
  var items = itemsFor(key);
  var item = items[idx];
  if (!item || !item.notionPageId) return;
  item.done = !item.done;
  renderNotesList(key, itemsFor(key));

  fetch('/api/notion-notes?pageId=' + encodeURIComponent(item.notionPageId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done: item.done }),
  }).catch(function() {
    item.done = !item.done;
    renderNotesList(key, itemsFor(key));
    toast('Failed to update note', '⚠');
  });
}

// ── Delete ───────────────────────────────────
function deleteNoteItem(key, idx) {
  if (key === 'restock') return; // only deletable from the Restock Queue page
  var items = itemsFor(key);
  var item = items[idx];
  if (!item) return;
  var globalIdx = NOTES_DATA.indexOf(item);
  NOTES_DATA.splice(globalIdx, 1);
  renderNotesList(key, itemsFor(key));

  if (!item.notionPageId) return;
  fetch('/api/notion-notes?pageId=' + encodeURIComponent(item.notionPageId), {
    method: 'DELETE',
  }).catch(function() {
    NOTES_DATA.splice(globalIdx, 0, item);
    renderNotesList(key, itemsFor(key));
    toast('Failed to delete note', '⚠');
  });
}

// ── Render ───────────────────────────────────
function renderNotesList(key, items) {
  var list  = document.getElementById(key + '-list');
  var count = document.getElementById(key + '-count');
  if (!list) return;

  var noCheck = (key === 'studio');

  if (noCheck) {
    if (count) count.textContent = items.length ? items.length + ' note' + (items.length > 1 ? 's' : '') : '';
  } else {
    var done    = items.filter(function(i) { return i.done; }).length;
    var pending = items.length - done;
    if (count) count.textContent = pending > 0 ? pending + ' left' : (items.length ? 'all done ✓' : '');
  }

  if (key === 'restock') restockQueueRender();

  list.innerHTML = items.map(function(item, idx) {
    var saving = item._saving ? ' style="opacity:0.5"' : '';
    var dragAttrs = item.notionPageId && !item._saving
      ? ' draggable="true" ondragstart="notesDragStart(event,\'' + key + '\',' + idx + ')" style="cursor:grab"'
      : '';
    var row = '<div' + saving + dragAttrs + ' style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid #F4EFE8">';
    if (!noCheck) {
      row += '<input type="checkbox" style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;flex-shrink:0;margin-right:4px" '
           + (item.done ? 'checked' : '')
           + ' onchange="toggleNoteItem(\'' + key + '\',' + idx + ')">';
    }
    var textStyle = 'flex:1;font-size:13px;' + (item.done ? 'text-decoration:line-through;color:#B0A898' : 'color:var(--text)');
    row += '<span style="' + textStyle + '">'
         + item.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
         + '</span>';
    if (!item._saving && key !== 'restock') {
      row += '<span onclick="deleteNoteItem(\'' + key + '\',' + idx + ')" '
           + 'style="cursor:pointer;color:#C4A0A0;font-size:18px;line-height:1;padding:0 4px" title="Remove">×</span>';
    }
    row += '</div>';
    return row;
  }).join('');
}

// ── Note text formatting ──────────────────────
function singularize(word) {
  if (word.length <= 3) return word;
  var lw = word.toLowerCase();
  if (/(?:ss|us|is|as|os|ies)$/.test(lw)) return word;
  if (lw.slice(-1) === 's') return word.slice(0, -1);
  return word;
}

function formatNoteText(text) {
  // Pattern 1: "size 8 spinners" → "Spinner Ring size 8"
  var reverseMatch = text.match(/^size\s+([\d.]+)\s+(.+)$/i);
  if (reverseMatch) {
    var sizePart = reverseMatch[1].trim();
    var namePart = reverseMatch[2].trim();
    var titled = namePart.split(' ').map(function(w) {
      var s = singularize(w);
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }).join(' ');
    if (!/ring/i.test(namePart)) titled += ' Ring';
    return titled + ' size ' + sizePart;
  }
  // Pattern 2: "cats size 5,6.5" → "Cat Ring size 5, 6.5"
  var forwardMatch = text.match(/^(.+?)\s+size\s+(.+)$/i);
  if (forwardMatch) {
    var namePart  = forwardMatch[1].trim();
    var sizePart  = forwardMatch[2].trim();
    var titled = namePart.split(' ').map(function(w) {
      var s = singularize(w);
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }).join(' ');
    if (!/ring/i.test(namePart)) titled += ' Ring';
    return titled + ' size ' + sizePart;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── Quick Capture helpers ─────────────────────
function isNumericSize(s) {
  return /^\d+(\.\d+)?$/.test(s.trim());
}

function groupSizes(parts) {
  var items = [];
  var currentBase = null;
  var extraSizes = [];

  parts.forEach(function(part) {
    if (isNumericSize(part)) {
      extraSizes.push(part.trim());
    } else {
      if (currentBase !== null) {
        items.push(extraSizes.length > 0
          ? currentBase + ', ' + extraSizes.join(', ')
          : currentBase);
      }
      currentBase = part;
      extraSizes = [];
    }
  });

  if (currentBase !== null) {
    items.push(extraSizes.length > 0
      ? currentBase + ', ' + extraSizes.join(', ')
      : currentBase);
  }

  return items;
}

// ── Quick Capture ─────────────────────────────
var PREFIX_TRIGGERS = {
  restock:  ['restock', 'replenish', 'low on', 'out of', 'running out', 'running low', 'need more', 'get more', 'stock up'],
  toorder:  ['order', 'orders', 'buy'],
  todo:     ['to do:', 'to-do:', 'todo:'],
  studio:   ['design:', 'idea:'],
  webapp:   ['webapp:', 'web app:', 'app update:'],
  market:   ['market:', 'booth:', 'display:'],
};

function stripTriggerPrefix(text, key) {
  var triggers = PREFIX_TRIGGERS[key] || [];
  var t = text.toLowerCase();
  for (var i = 0; i < triggers.length; i++) {
    var trigger = triggers[i];
    if (t.indexOf(trigger) === 0) {
      return text.slice(trigger.length).replace(/^[\s:,\-]+/, '').trim();
    }
  }
  return text;
}

function autoDetectBlock(text) {
  var t = text.toLowerCase();
  var restockWords  = ['restock', 'replenish', 'low on ', 'out of ', 'running out', 'running low', 'need more', 'get more', 'stock up', 'studio stock', 'size '];
  var orderWords    = ['order ', 'orders ', 'buy ', 'from rio', 'from stuller', 'from otto', 'from halstead', 'pick up'];
  var todoWords     = ['to do:', 'to-do:', 'todo:', 'finish ', 'complete ', 'make ', 'build ', 'fix ', 'clean ', 'update ', 'prepare ', 'ship ', 'solder ', 'set ', 'polish ', 'sand ', 'drill ', 'cut ', 'resize '];
  var designWords   = ['design ', 'idea ', 'sketch ', 'concept ', 'inspiration', 'try making', 'experiment'];
  var webappWords   = ['webapp', 'web app', 'app update', 'app bug', 'app feature', 'site update', 'website '];
  var marketWords   = ['for market', 'market display', 'booth ', 'vendor display', 'display stand', 'market to-do', 'market todo'];
  for (var i = 0; i < restockWords.length;  i++) { if (t.indexOf(restockWords[i])  !== -1) return 'restock';  }
  for (var i = 0; i < orderWords.length;    i++) { if (t.indexOf(orderWords[i])    !== -1) return 'toorder';  }
  for (var i = 0; i < todoWords.length;     i++) { if (t.indexOf(todoWords[i])     !== -1) return 'todo';     }
  for (var i = 0; i < designWords.length;   i++) { if (t.indexOf(designWords[i])   !== -1) return 'studio';   }
  for (var i = 0; i < webappWords.length;   i++) { if (t.indexOf(webappWords[i])   !== -1) return 'webapp';   }
  for (var i = 0; i < marketWords.length;   i++) { if (t.indexOf(marketWords[i])   !== -1) return 'market';   }
  return null;
}

function quickCapture() {
  var input  = document.getElementById('quick-capture-input');
  var catSel = document.getElementById('quick-capture-cat');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;
  var cat = catSel ? catSel.value : 'auto';
  var wasAuto = (cat === 'auto');
  if (wasAuto) {
    cat = autoDetectBlock(text);
    if (!cat) {
      if (catSel) {
        catSel.style.outline = '2px solid var(--accent)';
        catSel.style.borderColor = 'var(--accent)';
        setTimeout(function() { catSel.style.outline = ''; catSel.style.borderColor = ''; }, 2500);
      }
      toast('Can\'t auto-detect bucket — please pick one', '⚠');
      return;
    }
  }
  // Strip trigger prefix regardless of auto or manual — cleans "restock X" typed into a manually-selected bucket
  text = stripTriggerPrefix(text, cat);
  input.value = '';
  if (catSel) catSel.value = 'auto';

  var targetInput = document.getElementById(cat + '-input');
  if (targetInput) {
    var rawParts = text.split(/[,;]+/).map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; });
    var parts = groupSizes(rawParts);
    var labels = { studio: 'Design Ideas', todo: 'To-Do', toorder: 'To Order', restock: 'Inventory Restock', webapp: 'Webapp Updates', market: 'Market & Display To-Do' };
    parts.forEach(function(part) {
      targetInput.value = formatNoteText(part);
      addNoteItem(cat);
    });
    var msg = parts.length > 1
      ? 'Added ' + parts.length + ' items to ' + (labels[cat] || cat)
      : 'Added to ' + (labels[cat] || cat);
    toast(msg, '⚡');
    input.focus();
  }
}

// ── To Order catalog suggestions ─────────────
var TOORDER_ABBREV = {
  'ag': 'argentium', 'argentium': 'argentium',
  'gf': 'gold', 'goldfilled': 'gold', 'gold-filled': 'gold',
  'ss': 'sterling', 'sterling': 'sterling',
  'gauge': 'ga',
  'ds': 'dead', 'deadsoft': 'dead',
  'yw': 'yellow', 'yg': 'yellow',
  'wg': 'white', 'wh': 'white',
  'rnd': 'round',
  'sht': 'sheet',
};

function toOrderNorm(text) {
  var t = String(text).toLowerCase()
    .replace(/[®™"'\/]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.split(' ').map(function(w) {
    return TOORDER_ABBREV[w] || w;
  }).join(' ');
}

function toOrderScore(inputTokens, catalogName) {
  var catNorm = toOrderNorm(catalogName);
  var catToks = catNorm.split(' ');
  var matches = 0;
  inputTokens.forEach(function(tok) {
    if (tok.length < 2) return;
    if (catToks.some(function(ct) {
      return ct === tok || ct.indexOf(tok) === 0 || tok.indexOf(ct) === 0;
    })) matches++;
  });
  return matches / inputTokens.length;
}

function toOrderSuggest(value) {
  var box = document.getElementById('toorder-suggest');
  if (!box) return;
  var text = (value || '').trim();
  if (text.length < 3 || typeof CATALOG === 'undefined' || CATALOG.length === 0) {
    box.innerHTML = '';
    return;
  }
  var norm = toOrderNorm(text);
  var tokens = norm.split(' ').filter(function(t) { return t.length >= 2; });
  if (tokens.length === 0) { box.innerHTML = ''; return; }

  var scored = CATALOG.map(function(item) {
    return { item: item, score: toOrderScore(tokens, item.name) };
  }).filter(function(r) { return r.score >= 0.4; })
    .sort(function(a, b) { return b.score - a.score; })
    .slice(0, 3);

  if (scored.length === 0) { box.innerHTML = ''; return; }

  var esc = function(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };
  var html = '<div class="toorder-suggest-label">📋 Catalog match:</div>';
  scored.forEach(function(r) {
    var supMeta = (typeof SUPPLIERS_META !== 'undefined' && SUPPLIERS_META[r.item.sup]) || {};
    var supName = supMeta.name || r.item.sup;
    html += '<div class="toorder-suggest-item" onclick="toOrderSuggestPick(\'' + esc(r.item.id) + '\')">'
          + '<span class="toorder-suggest-name">' + esc(r.item.name) + '</span>'
          + '<span class="toorder-suggest-sup">' + esc(supName) + ' →</span>'
          + '</div>';
  });
  box.innerHTML = html;
}

function toOrderSuggestPick(id) {
  var box = document.getElementById('toorder-suggest');
  if (box) box.innerHTML = '';
  switchTab('supplier');
  ohInitSupplier();
  var item = (typeof sotGetItem === 'function') ? sotGetItem(id) : null;
  if (item) {
    setTimeout(function() {
      var el = document.getElementById('sotSearch');
      if (el) { el.value = item.name; sotSearch(item.name); }
    }, 80);
  }
}

// ── Inventory Restock: Square item suggest dropdown ──────────
// Mirrors the live-filter the Inventory tab uses against the real
// Square catalog, so restock notes match actual item/variation names.
var _restockCatalog = null;     // grouped [{ name, variations: [{ id, name }] }] once loaded
var _restockCatalogLoading = false;
var _restockCatalogError = null;
var _restockMatches = [];       // last rendered suggestion list (indexes into _restockCatalog)

function _restockSqFetch(path) {
  // Same pattern as _rqSqCall (Restock Queue page): only attach a token if
  // one happens to be saved locally — the /api/square proxy falls back to
  // its own server-side credential otherwise, so this works on any device
  // without per-browser Square setup.
  var token = localStorage.getItem('sts-square-token') || '';
  var payload = { path: path, method: 'GET' };
  if (token) payload.token = token;
  return fetch('/api/square', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(function(r) {
    return r.json().then(function(json) {
      if (!r.ok) {
        var msg = (json.errors && json.errors[0] && (json.errors[0].detail || json.errors[0].code)) || JSON.stringify(json);
        throw new Error(msg);
      }
      return json;
    });
  });
}

function _restockLoadCatalog() {
  if (_restockCatalog || _restockCatalogLoading) return;
  _restockCatalogLoading = true;
  _restockCatalogError = null;

  var groups = [];
  function page(cursor) {
    var path = '/v2/catalog/list?types=ITEM' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    _restockSqFetch(path).then(function(res) {
      (res.objects || []).forEach(function(obj) {
        if (obj.is_deleted) return;
        var name = obj.item_data && obj.item_data.name;
        if (!name) return;
        var vars = (obj.item_data.variations || []).filter(function(v) { return !v.is_deleted; });
        groups.push({
          name: name,
          variations: vars.map(function(v) {
            return { id: v.id, name: (v.item_variation_data && v.item_variation_data.name) || '' };
          }),
        });
      });
      if (res.cursor) { page(res.cursor); }
      else {
        _restockCatalog = groups;
        _restockCatalogLoading = false;
        var input = document.getElementById('restock-input');
        if (input) restockSuggest(input.value);
      }
    }).catch(function(err) {
      _restockCatalogLoading = false;
      _restockCatalogError = (err && err.message) || 'Failed to load Square catalog';
      var input = document.getElementById('restock-input');
      if (input) restockSuggest(input.value);
    });
  }
  page(null);
}

function _restockEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function restockSuggest(value) {
  var box = document.getElementById('restock-suggest');
  if (!box) return;
  var text = (value || '').trim();
  if (text.length < 2) { box.innerHTML = ''; return; }

  if (_restockCatalogError) {
    box.innerHTML = '<div class="toorder-suggest-label">⚠ ' + _restockCatalogError + '</div>';
    return;
  }
  if (!_restockCatalog) { _restockLoadCatalog(); box.innerHTML = '<div class="toorder-suggest-label">Loading Square catalog…</div>'; return; }

  var q = text.toLowerCase();
  _restockMatches = _restockCatalog.filter(function(item) {
    if (item.name.toLowerCase().indexOf(q) !== -1) return true;
    return item.variations.some(function(v) { return v.name.toLowerCase().indexOf(q) !== -1; });
  }).slice(0, 6);

  if (!_restockMatches.length) { box.innerHTML = ''; return; }

  var html = '<div class="toorder-suggest-label">📦 Square catalog match:</div>';
  _restockMatches.forEach(function(item, i) {
    var meta = item.variations.length > 1 ? item.variations.length + ' sizes' : '';
    html += '<div class="toorder-suggest-item" onclick="restockPickItem(' + i + ')">'
          + '<span class="toorder-suggest-name">' + _restockEsc(item.name) + '</span>'
          + (meta ? '<span class="toorder-suggest-sup">' + meta + '</span>' : '')
          + '</div>';
  });
  box.innerHTML = html;
}

// ── Single-variation item: fill the input directly ───────────
function restockPickItem(i) {
  var item = _restockMatches[i];
  if (!item) return;
  var box = document.getElementById('restock-suggest');

  if (item.variations.length <= 1) {
    var input = document.getElementById('restock-input');
    if (input) { input.value = item.name; input.focus(); }
    if (box) box.innerHTML = '';
    return;
  }
  _restockRenderSizePicker(item, i, box);
}

// ── Multi-variation item (e.g. ring sizes): pick a quantity per size ──
function _restockRenderSizePicker(item, matchIdx, box) {
  if (!box) return;
  var html = '<div class="toorder-suggest-label">📦 Choose size(s) for <strong>' + _restockEsc(item.name) + '</strong></div>'
    + '<div class="restock-size-list">';
  item.variations.forEach(function(v, i) {
    html += '<div class="restock-size-row">'
      + '<span class="restock-size-name">' + (_restockEsc(v.name) || '(Default)') + '</span>'
      + '<input type="number" class="restock-size-qty" id="restock-size-qty-' + i + '" min="0" max="99" placeholder="0">'
      + '</div>';
  });
  html += '</div>'
    + '<div class="restock-size-actions">'
    + '<button type="button" class="btn btn-gold btn-sm" onclick="restockConfirmSizes(' + matchIdx + ')">Add</button>'
    + '<button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById(\'restock-suggest\').innerHTML=\'\'">Cancel</button>'
    + '</div>';
  box.innerHTML = html;
}

function restockConfirmSizes(i) {
  var item = _restockMatches[i];
  if (!item) return;
  var box = document.getElementById('restock-suggest');
  var input = document.getElementById('restock-input');

  var parts = [];
  item.variations.forEach(function(v, idx) {
    var el = document.getElementById('restock-size-qty-' + idx);
    var qty = el ? parseInt(el.value, 10) || 0 : 0;
    if (qty > 0) parts.push((v.name || '(Default)') + ' (' + qty + ')');
  });

  if (!parts.length) { return; }

  var text = item.name + ' – Sizes ' + parts.join(', ');
  if (input) { input.value = text; input.focus(); }
  if (box) box.innerHTML = '';
}

// ── Drag and drop between note cards ─────────
function notesDragStart(event, key, idx) {
  var items = itemsFor(key);
  var item = items[idx];
  if (!item) return;
  _dragNote = { pageId: item.notionPageId, fromKey: key };
  event.dataTransfer.effectAllowed = 'move';
}

function notesDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  var list = event.currentTarget;
  list.style.outline = '2px dashed var(--accent)';
  list.style.outlineOffset = '-3px';
}

function notesDragLeave(event) {
  var list = event.currentTarget;
  list.style.outline = '';
}

function notesDrop(event, targetKey) {
  event.preventDefault();
  var list = event.currentTarget;
  list.style.outline = '';
  if (!_dragNote || _dragNote.fromKey === targetKey) { _dragNote = null; return; }

  var pageId  = _dragNote.pageId;
  var fromKey = _dragNote.fromKey;
  _dragNote = null;

  var item = NOTES_DATA.filter(function(n) { return n.notionPageId === pageId; })[0];
  if (!item) return;

  var newBlock = BLOCK_MAP[targetKey];
  item.block = newBlock;
  ['studio','todo','toorder','restock','webapp','market'].forEach(function(k) {
    renderNotesList(k, itemsFor(k));
  });

  fetch('/api/notion-notes?pageId=' + encodeURIComponent(pageId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ block: newBlock }),
  }).catch(function() {
    item.block = BLOCK_MAP[fromKey];
    ['studio','todo','toorder','restock','webapp','market'].forEach(function(k) {
      renderNotesList(k, itemsFor(k));
    });
    toast('Failed to move note', '⚠');
  });
}

// ════════════════════════════════════════════
//  RESTOCK QUEUE  —  priority + assignee + inline timer
//  Order + assignees stored in /api/restock-meta
// ════════════════════════════════════════════

var _rqMeta       = { order: [], assignees: {} };
var _rqMetaLoaded = false;
var _rqSizes       = {};    // { [pid]: { [variantId]: qty } } — cross-device size/qty selections, via /api/restock-sizes
var _rqSizesLoaded = false;
var _rqNotes       = {};    // { [pid]: noteText } — free-text notes per item, via /api/restock-notes
var _rqNotesLoaded = false;
var _rqNotesSaveDebounce = null;
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
  }).catch(function() {
    // Mark these ids done anyway — badges render as "unset" rather than
    // retrying indefinitely on a flaky connection.
    ids.forEach(function(id) { _rqInvIdsDone[id] = true; });
  });
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
  if (/^(silver|gold[\s-]?fill|gold|rose[\s-]?gold|brass|bronze|sterling|copper)$/i.test(t)) return 'metal';
  if (/^(xs|sm|small|med|medium|lg|large|xl|xxl)$/i.test(t)) return 'size';
  // Ring sizes — plain numbers (incl. half sizes) or "Size 7" / "Sz 7.5".
  if (/^(size|sz)?\s*\d+(\.\d+)?$/i.test(t)) return 'size';
  return 'other';
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
    return (a.size || '').localeCompare(b.size || '');
  });

  return { rows: rows, metals: metals, hasSizes: rows.some(function(r) { return r.size; }) };
}

function _rqVariantTableHtml(pid, table, qtyByVariantId, onchangeFn) {
  onchangeFn = onchangeFn || 'rqSetInlineVariantQty';
  var html = '<table class="rq-variant-table"><thead><tr><th class="rq-variant-corner"></th>';
  table.metals.forEach(function(metal) {
    var cols = table.rows.filter(function(r) { return r.metal === metal; });
    html += '<th colspan="' + cols.length + '">' + _restockEsc(metal) + '</th>';
  });
  html += '</tr>';

  if (table.hasSizes) {
    html += '<tr><th class="rq-variant-row-label">Size</th>';
    table.metals.forEach(function(metal) {
      var cols = table.rows.filter(function(r) { return r.metal === metal; });
      var i = 0;
      while (i < cols.length) {
        var size = cols[i].size;
        var span = 1;
        while (i + span < cols.length && cols[i + span].size === size) span++;
        html += '<th colspan="' + span + '">' + (_restockEsc(size) || '—') + '</th>';
        i += span;
      }
    });
    html += '</tr>';
  }
  html += '</thead><tbody><tr><th class="rq-variant-row-label">To Make</th>';
  table.rows.forEach(function(r) {
    var qty = qtyByVariantId[r.variant.id] || '';
    var safeVId = (r.variant.id || '').replace(/'/g, '').replace(/\\/g, '\\\\');
    html += '<td><input type="number" class="rq-variant-qty" min="0" max="99" placeholder="0" value="' + (qty || '') + '"'
      + ' onchange="' + onchangeFn + '(\'' + pid + '\',\'' + safeVId + '\',this.value)"></td>';
  });
  html += '</tr><tr class="rq-variant-inv-row"><th class="rq-variant-row-label">Current Stock</th>';
  table.rows.forEach(function(r) {
    html += '<td>' + _rqInvBadgeHtml(r.variant.id) + '</td>';
  });
  html += '</tr></tbody></table>';
  return html;
}

function _rqVariantFlatHtml(pid, variants, qtyByVariantId, onchangeFn) {
  onchangeFn = onchangeFn || 'rqSetInlineVariantQty';
  return '<div class="rq-variant-grid">'
    + variants.map(function(v) {
        var qty = qtyByVariantId[v.id] || '';
        var safeVId = (v.id || '').replace(/'/g, '').replace(/\\/g, '\\\\');
        return '<div class="rq-variant-chip' + (qty ? ' rq-variant-chip-on' : '') + '">'
          + '<div class="rq-variant-chip-row">'
          + '<span>' + (v.name || '').replace(/</g, '&lt;') + '</span>'
          + '<input type="number" class="rq-variant-qty-inline" min="0" max="99" placeholder="0" value="' + (qty || '') + '"'
          + ' onchange="' + onchangeFn + '(\'' + pid + '\',\'' + safeVId + '\',this.value)">'
          + '</div>'
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
  if (qty > 0) byId[variantId] = Object.assign({}, variant, { qty: qty });
  else delete byId[variantId];
  var selectedVariants = (match.variants || [])
    .filter(function(v) { return byId[v.id]; })
    .map(function(v) { return byId[v.id]; });
  if (usingRichMatch) {
    timer.richMatch = Object.assign({}, match, { selectedVariants: selectedVariants });
    _rqSaveTimerState();
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

function _rqLoadMeta(cb) {
  fetch('/api/restock-meta')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      _rqMeta = { order: d.order || [], assignees: d.assignees || {} };
      _rqMetaLoaded = true;
      _rqRestoreTimers();
      if (!_rqSessionsLoaded) rqLoadSessions();
      if (cb) cb();
    })
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

function _rqLoadSizes(cb) {
  fetch('/api/restock-sizes')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      _rqSizes = (d && typeof d === 'object' && !d.error) ? d : {};
      _rqSizesLoaded = true;
      _rqReconcileSizes();
      if (cb) cb();
    })
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

function _rqLoadNotes(cb) {
  fetch('/api/restock-notes')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      _rqNotes = (d && typeof d === 'object' && !d.error) ? d : {};
      _rqNotesLoaded = true;
      if (cb) cb();
    })
    .catch(function() { _rqNotesLoaded = true; if (cb) cb(); });
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
  (selectedVariants || []).forEach(function(v) { if (v.qty > 0) map[v.id] = v.qty; });
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
    .map(function(v) { return Object.assign({}, v, { qty: saved[v.id] }); });
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

  var safeName = (match.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // ── Parent item: sizes/variations are always editable directly here —
  // no extra "Pick sizes" click needed once you're already in edit mode ──
  if (match.isParent) {
    var variants = match.variants || [];
    var qtyByVariantId = {};
    (match.selectedVariants || []).forEach(function(v) { qtyByVariantId[v.id] = v.qty || ''; });
    var table = _rqBuildVariantTable(variants);
    var body = table
      ? _rqVariantTableHtml(safePid, table, qtyByVariantId, 'rqSetInlineVariantQty')
      : _rqVariantFlatHtml(safePid, variants, qtyByVariantId);
    return '<div class="rq-match-found" style="margin-bottom:5px;">'
      + '<span class="rq-match-check">✓</span>'
      + '<span class="rq-match-name">' + safeName + '</span>'
      + '<button class="rq-match-change" onclick="rqOpenMatchEdit(\'' + safePid + '\')">✎ change item</button>'
      + '</div>'
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
    var safeName = (match.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return '<div class="rq-read-status">✓ ' + safeName + ' ' + _rqInvBadgeHtml(match.id) + '</div>';
  }
  var sel = match.selectedVariants || [];
  if (!sel.length) {
    return '<div class="rq-read-status">No sizes set yet</div>';
  }
  var rows = sel.map(function(v) {
    var name = (v.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

function _rqAutoMatchSingle(pid, rawText) {
  if (!pid) return Promise.resolve();
  var query = _rqShortName(rawText || '');
  if (!query) { _rqAutoMatches[pid] = '_none_'; _rqAmSave(); _rqUpdateMatchRow(pid); return Promise.resolve(); }
  _rqAutoMatches[pid] = '_loading_';
  _rqUpdateMatchRow(pid);
  var localMatches = _rqLocalSearch(query);
  // Note: _rqSqCall only attaches a token if one is saved in this browser's
  // localStorage — the /api/square proxy falls back to its own server-side
  // SQUARE_TOKEN otherwise. So this must NOT skip the live search just
  // because no local token exists (that previously made every item on a
  // device without a saved token — e.g. a phone that's never opened
  // Integrations — show "No Square match" even though the server-side
  // credential would have matched it fine).
  return _rqSqCall('/catalog/search', {
    method: 'POST',
    body: { object_types: ['ITEM'], query: { text_query: { keywords: [query] } }, limit: 20 },
  }).then(function(searchData) {
    if (_rqAutoMatches[pid] !== '_loading_') return;
    var found = searchData.objects || [];
    if (!found.length) {
      if (localMatches.length) { _rqAmSet(pid, localMatches[0]); return; }
      _rqAutoMatches[pid] = '_none_'; _rqAmSave(); _rqUpdateMatchRow(pid); return;
    }
    return _rqSqCall('/catalog/batch-retrieve', {
      method: 'POST',
      body: { object_ids: found.map(function(o) { return o.id; }) },
    }).then(function(fullData) {
      if (_rqAutoMatches[pid] !== '_loading_') return;
      var rows = localMatches.slice();
      (fullData.objects || []).forEach(function(obj) {
        if (obj.type !== 'ITEM') return;
        var itemName   = obj.item_data ? obj.item_data.name : 'Unnamed';
        var catName    = obj.item_data ? (obj.item_data.category_name || '') : '';
        var variations = obj.item_data ? (obj.item_data.variations || []) : [];
        if (variations.length <= 1) {
          var v = variations[0] ? variations[0].item_variation_data : null;
          rows.push({ id: variations[0] ? variations[0].id : obj.id, name: itemName, sku: v ? (v.sku || '') : '', category: catName, isParent: false });
        } else {
          rows.push({ id: obj.id, name: itemName, category: catName, isParent: true, variantCount: variations.length,
            variants: variations.map(function(vv) { var vd = vv.item_variation_data; return { id: vv.id, name: vd ? (vd.name||'') : '', sku: vd ? (vd.sku||'') : '' }; }) });
        }
      });
      if (rows.length) {
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
      } else { _rqAutoMatches[pid] = '_none_'; _rqAmSave(); _rqUpdateMatchRow(pid); }
    });
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
  _rqSqCall('/catalog/search', {
    method: 'POST',
    body: { object_types: ['ITEM'], query: { text_query: { keywords: [query] } }, limit: 20 },
  }).then(function(searchData) {
    if (!_rqMatchEdits[pid]) return;
    var found = searchData.objects || [];
    if (!found.length) { _rqMatchEditRenderResults(pid, localMatches, query); return; }
    return _rqSqCall('/catalog/batch-retrieve', {
      method: 'POST',
      body: { object_ids: found.map(function(o) { return o.id; }) },
    }).then(function(fullData) {
      if (!_rqMatchEdits[pid]) return;
      var rows = localMatches.slice();
      (fullData.objects || []).forEach(function(obj) {
        if (obj.type !== 'ITEM') return;
        var itemName   = obj.item_data ? obj.item_data.name : 'Unnamed';
        var catName    = obj.item_data ? (obj.item_data.category_name || '') : '';
        var variations = obj.item_data ? (obj.item_data.variations || []) : [];
        if (variations.length <= 1) {
          var v = variations[0] ? variations[0].item_variation_data : null;
          rows.push({ id: variations[0] ? variations[0].id : obj.id, name: itemName, sku: v ? (v.sku||'') : '', category: catName, isParent: false });
        } else {
          rows.push({ id: obj.id, name: itemName, category: catName, isParent: true, variantCount: variations.length,
            variants: variations.map(function(vv) { var vd = vv.item_variation_data; return { id: vv.id, name: vd ? (vd.name||'') : '', sku: vd ? (vd.sku||'') : '' }; }) });
        }
      });
      _rqMatchEditRenderResults(pid, rows, query);
    });
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

function _rqSaveTimerState() {
  var state = {};
  Object.keys(_rqTimers).forEach(function(pid) {
    var t = _rqTimers[pid];
    state[pid] = { startTime: t.startTime, employee: t.employee, sessionNotionPageId: t.sessionNotionPageId, itemText: t.itemText, items: t.items || null, richMatch: t.richMatch || null };
  });
  localStorage.setItem('sts_rqTimers', JSON.stringify(state));
}

function _rqRestoreTimers() {
  try {
    var saved = JSON.parse(localStorage.getItem('sts_rqTimers') || '{}');
    Object.keys(saved).forEach(function(pid) {
      var s = saved[pid];
      if (_rqTimers[pid]) return; // already active
      _rqTimers[pid] = { startTime: s.startTime, employee: s.employee, sessionNotionPageId: s.sessionNotionPageId, itemText: s.itemText, items: s.items || null, richMatch: s.richMatch || null, notes: '', tickInterval: null };
      _rqStartTick(pid);
    });
  } catch(e) {}
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

  if (!_rqMetaLoaded) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:#B0A898;font-size:13px;">Loading…</div>';
    list.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    _rqLoadMeta(restockQueueRender);
    return;
  }

  if (!_rqSizesLoaded) {
    _rqLoadSizes(restockQueueRender);
    return;
  }

  if (!_rqNotesLoaded) {
    _rqLoadNotes(restockQueueRender);
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
    var safeNoteHtml = note.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

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
  _rqSaveTimerState();
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

function _rqToDateTimeLocal(ms) {
  var d = new Date(ms);
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
  _rqSaveTimerState();
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

function _rqSqCall(path, opts) {
  opts = opts || {};
  var token = localStorage.getItem('sts-square-token') || '';
  var payload = { path: '/v2' + path, method: opts.method || 'GET' };
  if (opts.body) payload.body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
  if (token) payload.token = token;
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

function _rqDefaultModifierSelections(modifierLists) {
  var selected = {};
  (modifierLists || []).forEach(function(list) {
    var def = list.options.filter(function(o) { return o.onByDefault; })[0] || list.options[0];
    if (def) selected[list.id] = def.id;
  });
  return selected;
}

function _rqSearchCatalog(pid, query, autoSelect) {
  var s = _rqSetups[pid]; if (!s) return;
  var spinner = document.getElementById('rq-spinner-' + pid);
  if (spinner) { spinner.style.display = 'block'; spinner.classList.add('active'); }
  var localMatches = _rqLocalSearch(query);
  _rqSqCall('/catalog/search', {
    method: 'POST',
    body: { object_types: ['ITEM'], query: { text_query: { keywords: [query] } }, limit: 20, include_related_objects: true },
  }).then(function(searchData) {
    if (!_rqSetups[pid]) return;
    var found = searchData.objects || [];
    if (!found.length) {
      if (autoSelect && !localMatches.length) { _rqShowNoMatch(pid, query); return null; }
      if (autoSelect && localMatches.length)  { _rqSelectSetupItem(pid, localMatches[0]); return null; }
      _rqRenderResults(pid, localMatches, query);
      return null;
    }
    return _rqSqCall('/catalog/batch-retrieve', {
      method: 'POST',
      body: { object_ids: found.map(function(o) { return o.id; }), include_related_objects: true },
    }).then(function(fullData) {
      if (!_rqSetups[pid]) return;
      var modifierListsById = {};
      (fullData.related_objects || []).forEach(function(o) {
        if (o.type === 'MODIFIER_LIST') modifierListsById[o.id] = o;
      });
      var rows = localMatches.slice();
      (fullData.objects || []).forEach(function(obj) {
        if (obj.type !== 'ITEM') return;
        var itemName   = obj.item_data ? obj.item_data.name : 'Unnamed';
        var catName    = obj.item_data ? (obj.item_data.category_name || '') : '';
        var variations = obj.item_data ? (obj.item_data.variations || []) : [];
        var modifierLists = _rqBuildModifierLists(obj, modifierListsById);
        if (variations.length <= 1) {
          var v = variations[0] ? variations[0].item_variation_data : null;
          rows.push({ id: variations[0] ? variations[0].id : obj.id, name: itemName, sku: v ? (v.sku || '') : '', category: catName, isParent: false, modifierLists: modifierLists });
        } else {
          rows.push({
            id: obj.id, name: itemName, category: catName, isParent: true, variantCount: variations.length,
            modifierLists: modifierLists,
            variants: variations.map(function(vv) {
              var vd = vv.item_variation_data;
              return { id: vv.id, name: vd ? (vd.name || '') : '', sku: vd ? (vd.sku || '') : '' };
            }),
          });
        }
      });
      if (autoSelect) { _rqSelectSetupItem(pid, rows[0]); }
      else            { _rqRenderResults(pid, rows, query); }
    });
  }).catch(function() {
    if (!_rqSetups[pid]) return;
    if (autoSelect) { _rqShowNoMatch(pid, query); }
    else if (localMatches.length) { _rqRenderResults(pid, localMatches, query); }
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
      item.selectedVariants.forEach(function(v) {
        var label = (item.name || '') + ' – ' + (v.name || '') + (modSuffix ? ' – ' + modSuffix : '');
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
    return t.richMatch.selectedVariants.map(function(v) {
      return { label: baseName + ' – ' + (v.name || ''), squareId: v.id || '', isCustom: false, pieces: v.qty != null ? v.qty : null };
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
    notes: '',
    tickInterval: null,
  };
  _rqSaveTimerState();
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
      _rqSaveTimerState();
    }
  }).catch(function() {});
  restockQueueRender();
}

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

function _rqToDateTimeLocal(iso) {
  if (!iso) return '';
  var d = new Date(iso), p = function(n) { return String(n).padStart(2,'0'); };
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
}

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

function rqConfirmPush(store, i) {
  var s = _rqStoreList(store)[i]; if (!s) return;
  var confirmBtn = document.querySelector('.rq-push-panel .rq-start-confirm-btn');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Pushing…'; }
  var loc = localStorage.getItem('sts-square-location') || 'D7EZ98V48F79A';
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
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Push'; }
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
        var safeLabel = (it.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
        return '<div class="rq-edit-field">'
          + '<label style="flex:1;width:auto;">' + safeLabel + '</label>'
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
    var pcsInp = document.getElementById('rq-edit-pcs-' + store + '-' + i + '-' + ii);
    var priceInp = document.getElementById('rq-edit-price-' + store + '-' + i + '-' + ii);
    var next = it;
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

function rqSyncShiftsForSession(i) {
  var s = _rqSessions[i]; if (!s || !s.startTime || !s.stopTime) return;
  var btn = document.getElementById('rq-sync-btn-' + i);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  var empName = (s.employee && s.employee.name) || '';
  var KNOWN = { 'Vanessa': 'TMAMWG-ZS9lqZWKm', 'Vanessa Bigley': 'TMAMWG-ZS9lqZWKm',
                'Stevie': 'Q5gZGbDStWUysIE3CKhJ', 'Stevana': 'Q5gZGbDStWUysIE3CKhJ', 'Stevana Schafer': 'Q5gZGbDStWUysIE3CKhJ' };
  var empId = (s.employee && s.employee.id) || KNOWN[empName] || '';

  function doSync(empId) {
    if (!empId) {
      toast('Unknown employee: ' + (empName || '?'), '⚠');
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Sync'; }
      return;
    }
    var pStartMs = new Date(s.startTime).getTime();
    var pStopMs  = new Date(s.stopTime).getTime();
    var sqLoc    = localStorage.getItem('sts-square-location') || 'D7EZ98V48F79A';
    _rqSqCall('/labor/shifts/search', {
      method: 'POST',
      body: { query: { filter: { team_member_ids: [empId], location_ids: [sqLoc] } }, limit: 100 },
    }).then(function(data) {
      var shifts = (data.shifts || []).filter(function(sh) {
        var cin = new Date(sh.start_at).getTime(), cout = sh.end_at ? new Date(sh.end_at).getTime() : pStopMs;
        return cin < pStopMs && cout > pStartMs;
      });
      var fTime = function(ms) { return new Date(ms).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); };
      var fDay  = function(ms) { return new Date(ms).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'}); };
      var events = [{ time: pStartMs, type: 'start' }];
      shifts.sort(function(a,b){ return new Date(a.start_at)-new Date(b.start_at); }).forEach(function(sh) {
        var cin = new Date(sh.start_at).getTime(), cout = sh.end_at ? new Date(sh.end_at).getTime() : pStopMs;
        if (cin  > pStartMs && cin  < pStopMs) events.push({ time: cin,  type: 'in'  });
        if (cout > pStartMs && cout < pStopMs) events.push({ time: cout, type: 'out' });
      });
      events.push({ time: pStopMs, type: 'stop' });
      var byDay = {};
      events.forEach(function(e) { var d = fDay(e.time); (byDay[d]=byDay[d]||[]).push(e); });
      var block = '— Session Timeline —\n' + Object.keys(byDay).map(function(day) {
        return day + '\n' + byDay[day].map(function(e) {
          var lbl = e.type==='start'?'▶ Timer Start':e.type==='stop'?'⏹ Timer Stop':e.type==='in'?'  ▶ Clock In':'  ⏸ Clock Out';
          return '  ' + lbl + ': ' + fTime(e.time);
        }).join('\n');
      }).join('\n');
      var workedMs = 0;
      shifts.forEach(function(sh) {
        var cin = Math.max(new Date(sh.start_at).getTime(), pStartMs);
        var cout = Math.min(sh.end_at ? new Date(sh.end_at).getTime() : pStopMs, pStopMs);
        if (cout > cin) workedMs += (cout - cin);
      });
      var totalMs = pStopMs - pStartMs;
      var dedMs   = Math.max(0, totalMs - workedMs) + 15 * 60000;
      s.totalMs = totalMs; s.netMs = Math.max(0, totalMs - dedMs);
      var baseNotes = (s.notes || '').replace(/— Session Timeline —[\s\S]*$/, '').trim();
      s.notes = [baseNotes, block].filter(Boolean).join('\n\n');
      rqRenderSessions();
      if (!s.notionPageId) { toast('Timeline saved locally', '✓'); if (btn) { btn.disabled=false; btn.textContent='⟳ Sync'; } return; }
      fetch('/api/notion-timesession', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: s.notionPageId, notes: s.notes,
          totalMin: parseFloat((totalMs/60000).toFixed(2)),
          dedMin:   parseFloat((dedMs/60000).toFixed(2)),
          netMin:   parseFloat((s.netMs/60000).toFixed(2)) }),
      }).then(function(r) {
        toast(r.ok ? 'Timeline & times synced ✓' : 'Notion sync failed', r.ok ? '✓' : '⚠');
        if (btn) { btn.disabled=false; btn.textContent='⟳ Sync'; }
      }).catch(function() { toast('Network error', '⚠'); if (btn) { btn.disabled=false; btn.textContent='⟳ Sync'; } });
    }).catch(function(e) {
      toast('Square sync failed: ' + (e.message||e), '⚠');
      if (btn) { btn.disabled=false; btn.textContent='⟳ Sync'; }
    });
  }

  if (empId) { doSync(empId); return; }
  _rqSqCall('/team-members?location_ids=' + (localStorage.getItem('sts-square-location') || 'D7EZ98V48F79A'))
    .then(function(data) {
      var members = (data.team_members || []).filter(function(m) { return m.status === 'ACTIVE'; });
      var match = members.find(function(m) {
        var fn = m.display_name || [m.given_name, m.family_name].filter(Boolean).join(' ');
        return fn === empName || fn.split(' ')[0] === empName;
      });
      doSync(match ? match.id : '');
    })
    .catch(function() { doSync(''); });
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

    // Push button — only show when saved, not yet pushed, and at least one real Square item has pieces
    var canPush = !s.pushed && s.saved && !s.error
      && (s.items || []).some(function(it) { return it.squareId && !it.isCustom && it.pieces > 0; });
    var pushBtn = s.pushed
      ? '<span class="rq-pushed-label">↑ Pushed</span>'
      : canPush ? '<button class="rq-push-btn" onclick="rqOpenPushPanel(\'log\',' + i + ')">↑ Square</button>' : '';

    var timeRow = '<div class="rq-sbar-time-row">'
      + '<span class="rq-sbar-time-val">▶ ' + _rqFmtDT(s.startTime) + '</span>'
      + '<span style="color:#ccc">·</span>'
      + '<span class="rq-sbar-time-val">⏹ ' + _rqFmtDT(s.stopTime) + '</span>'
      + '<button class="rq-sbar-act-btn" onclick="rqStartEditSession(\'log\',' + i + ')">✎ Edit</button>'
      + (s.startTime && s.stopTime ? '<button class="rq-sbar-act-btn" id="rq-sync-btn-' + i + '" onclick="rqSyncShiftsForSession(' + i + ')">⟳ Sync</button>' : '')
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
  var text = input.value.trim();
  if (!text) return;
  input.value = '';

  var pendingMatch = _rqAddPendingMatch;
  _rqAddPendingMatch = null;
  _rqAddLastResults = [];
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
  _rqSqCall('/catalog/search', {
    method: 'POST',
    body: { object_types: ['ITEM'], query: { text_query: { keywords: [query] } }, limit: 20 },
  }).then(function(searchData) {
    var found = searchData.objects || [];
    if (!found.length) { _rqAddRenderResults(localMatches, query); return; }
    return _rqSqCall('/catalog/batch-retrieve', {
      method: 'POST',
      body: { object_ids: found.map(function(o) { return o.id; }) },
    }).then(function(batchData) {
      var rows = [];
      (batchData.objects || []).forEach(function(obj) {
        if (obj.type !== 'ITEM') return;
        var d = obj.item_data || {};
        var vars = d.variations || [];
        if (vars.length > 1) {
          rows.push({ id: obj.id, name: d.name || '', category: ((d.categories || [])[0] || {}).name || '', isParent: true, variantCount: vars.length, variants: vars.map(function(v) { return { id: v.id, name: (v.item_variation_data || {}).name || '' }; }) });
        } else {
          var vd = vars[0] ? (vars[0].item_variation_data || {}) : {};
          rows.push({ id: vars[0] ? vars[0].id : obj.id, name: d.name || '', category: ((d.categories || [])[0] || {}).name || '', isParent: false, sku: vd.sku || '' });
        }
      });
      if (!rows.length) rows = localMatches;
      _rqAddRenderResults(rows, query);
    });
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
    var table = _rqBuildVariantTable(item.variants);
    var qtyByVariantId = {};
    (item.selectedVariants || []).forEach(function(v) { qtyByVariantId[v.id] = v.qty || ''; });
    sizesBox.innerHTML = table
      ? _rqVariantTableHtml('add', table, qtyByVariantId, 'rqAddSetVariantQty')
      : _rqVariantFlatHtml('add', item.variants, qtyByVariantId, 'rqAddSetVariantQty');
    sizesBox.style.display = 'block';
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
  if (qty > 0) byId[variantId] = Object.assign({}, variant, { qty: qty });
  else delete byId[variantId];
  item.selectedVariants = (item.variants || [])
    .filter(function(v) { return byId[v.id]; })
    .map(function(v) { return byId[v.id]; });
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

