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
  followup: 'Follow-up',
  toorder:  'To Order',
  restock:  'Inventory Restock',
  webapp:   'Webapp Updates',
  market:   'Market & Display To-Do',
};

// ── Load ─────────────────────────────────────
function loadNotes() {
  ['studio','todo','followup','toorder','restock','webapp','market'].forEach(function(key) {
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
      ['studio','todo','followup','toorder','restock','webapp','market'].forEach(function(key) {
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
      ['studio','todo','followup','toorder','restock','webapp','market'].forEach(function(key) {
        renderNotesList(key, itemsFor(key));
      });
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
    if (!item._saving) {
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
  followup: ['follow up', 'follow-up'],
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
  var followupWords  = ['follow up', 'follow-up', 'call ', 'email ', 'contact ', 'reach out', 'check with', 'remind ', 'text '];
  var restockWords   = ['restock', 'replenish', 'low on ', 'out of ', 'running out', 'running low', 'need more', 'get more', 'stock up', 'studio stock', 'size '];
  var orderWords     = ['order ', 'orders ', 'buy ', 'from rio', 'from stuller', 'from otto', 'from halstead', 'pick up'];
  var todoWords      = ['to do:', 'to-do:', 'todo:', 'finish ', 'complete ', 'make ', 'build ', 'fix ', 'clean ', 'update ', 'prepare ', 'ship ', 'solder ', 'set ', 'polish ', 'sand ', 'drill ', 'cut ', 'resize '];
  var designWords    = ['design ', 'idea ', 'sketch ', 'concept ', 'inspiration', 'try making', 'experiment'];
  var webappWords    = ['webapp', 'web app', 'app update', 'app bug', 'app feature', 'site update', 'website '];
  var marketWords    = ['for market', 'market display', 'booth ', 'vendor display', 'display stand', 'market to-do', 'market todo'];
  for (var i = 0; i < followupWords.length; i++) { if (t.indexOf(followupWords[i]) !== -1) return 'followup'; }
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
    var labels = { studio: 'Design Ideas', todo: 'To-Do', followup: 'Follow-ups', toorder: 'To Order', restock: 'Inventory Restock', webapp: 'Webapp Updates', market: 'Market & Display To-Do' };
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
  ['studio','todo','followup','toorder','restock','webapp','market'].forEach(function(k) {
    renderNotesList(k, itemsFor(k));
  });

  fetch('/api/notion-notes?pageId=' + encodeURIComponent(pageId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ block: newBlock }),
  }).catch(function() {
    item.block = BLOCK_MAP[fromKey];
    ['studio','todo','followup','toorder','restock','webapp','market'].forEach(function(k) {
      renderNotesList(k, itemsFor(k));
    });
    toast('Failed to move note', '⚠');
  });
}
