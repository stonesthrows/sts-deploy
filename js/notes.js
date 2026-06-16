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
      var queuePanel = document.getElementById('tab-inv-restock-queue');
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
var _rqTimers     = {};   // { [notionPageId]: { startTime, employee, sessionNotionPageId, itemText, notes, tickInterval } }
var _rqSessions   = [];   // completed sessions (in-memory + loaded from Notion)
var _rqSessionsLoaded = false;

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
    state[pid] = { startTime: t.startTime, employee: t.employee, sessionNotionPageId: t.sessionNotionPageId, itemText: t.itemText };
  });
  localStorage.setItem('sts_rqTimers', JSON.stringify(state));
}

function _rqRestoreTimers() {
  try {
    var saved = JSON.parse(localStorage.getItem('sts_rqTimers') || '{}');
    Object.keys(saved).forEach(function(pid) {
      var s = saved[pid];
      if (_rqTimers[pid]) return; // already active
      _rqTimers[pid] = { startTime: s.startTime, employee: s.employee, sessionNotionPageId: s.sessionNotionPageId, itemText: s.itemText, notes: '', tickInterval: null };
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

  if (!_rqMetaLoaded) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:#B0A898;font-size:13px;">Loading…</div>';
    list.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    _rqLoadMeta(restockQueueRender);
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

  list.innerHTML = items.map(function(item, idx) {
    var pid      = item.notionPageId || '';
    var assignee = (pid && _rqMeta.assignees[pid]) || '';
    var timer    = pid ? _rqTimers[pid] : null;
    var isRunning = !!timer;
    var cls      = assignee ? ' rq-' + assignee.toLowerCase() : '';
    var itemCls  = isRunning ? ' rq-active' : '';
    var textCls  = item.done ? ' rq-done' : '';
    var safeText = item.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
    var safePid  = pid.replace(/'/g, '');
    var isFirst  = idx === 0;
    var isLast   = idx === items.length - 1;

    // ⏱ button state
    var startDisabled = !pid || !assignee || isRunning;
    var startTitle    = !pid ? 'Saving…' : !assignee ? 'Assign first' : isRunning ? 'Running' : 'Start timer';
    var startOnclick  = startDisabled ? '' : 'onclick="rqStartTimer(\'' + safePid + '\',\'' + safeText.replace(/'/g, "\\'") + '\',\'' + assignee + '\')"';

    var mainRow = '<div class="rq-item-row">'
      + '<span class="rq-arrows">'
      + '<button class="rq-arrow" onclick="rqMove(' + idx + ',-1)" ' + (isFirst ? 'disabled' : '') + ' title="Move up">▲</button>'
      + '<button class="rq-arrow" onclick="rqMove(' + idx + ',1)"  ' + (isLast  ? 'disabled' : '') + ' title="Move down">▼</button>'
      + '</span>'
      + '<span class="rq-rank">' + (idx + 1) + '</span>'
      + '<span class="rq-text' + textCls + '" contenteditable="true" spellcheck="false"'
      + ' onblur="rqSaveText(this,' + idx + ')"'
      + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}"'
      + '>' + safeText + '</span>'
      + '<button class="rq-start-btn" ' + startOnclick + (startDisabled ? ' disabled' : '') + ' title="' + startTitle + '">⏱</button>'
      + '<select class="rq-assignee' + cls + '" onchange="rqSetAssignee(this,' + idx + ')">'
      + PEOPLE.map(function(p) {
          return '<option value="' + p + '"' + (assignee === p ? ' selected' : '') + '>' + (p || '— unassigned —') + '</option>';
        }).join('')
      + '</select>'
      + '<span class="rq-del" onclick="rqDeleteItem(' + idx + ')" title="Remove">×</span>'
      + '</div>';

    var timerPanel = '';
    if (isRunning) {
      var elapsed = _rqFmtElapsed(Date.now() - timer.startTime);
      var startLbl = _rqFmtTime(timer.startTime);
      timerPanel = '<div class="rq-timer-panel">'
        + '<div class="rq-timer-running-row">'
        + '<span class="rq-timer-dot"></span>'
        + '<span class="rq-timer-emp">' + (timer.employee.name || '') + '</span>'
        + '<span class="rq-timer-meta">started ' + startLbl + '</span>'
        + '<span class="rq-timer-elapsed" id="rq-elapsed-' + safePid + '">' + elapsed + '</span>'
        + '<button class="rq-stop-btn" onclick="rqStopTimer(\'' + safePid + '\')" id="rq-stop-' + safePid + '">Stop &amp; Save</button>'
        + '</div>'
        + '<div class="rq-timer-notes-row">'
        + '<button class="rq-timer-notes-toggle" onclick="rqToggleTimerNotes(\'' + safePid + '\')">▾ notes</button>'
        + '</div>'
        + '<div class="rq-timer-notes-wrap" id="rq-notesarea-' + safePid + '">'
        + '<textarea class="rq-timer-notes-area" id="rq-notes-' + safePid + '" placeholder="Optional notes…"></textarea>'
        + '<button class="rq-save-note-btn" onclick="rqSaveTimerNote(\'' + safePid + '\')">Save note</button>'
        + '</div>'
        + '</div>';
    }

    return '<div class="rq-item' + itemCls + '" id="rq-item-' + idx + '">' + mainRow + timerPanel + '</div>';
  }).join('');

  _rqRestartTicks();
}

// ── Timer start / stop ────────────────────────────────────────────────────────

function rqStartTimer(pid, itemText, assigneeName) {
  if (!pid || !assigneeName) { toast('Assign first', '⚠'); return; }
  if (_rqTimers[pid]) return;
  var startTime = Date.now();
  _rqTimers[pid] = { startTime: startTime, employee: { name: assigneeName, id: '' }, sessionNotionPageId: null, itemText: itemText, notes: '', tickInterval: null };
  _rqSaveTimerState();
  fetch('/api/notion-timesession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemName: itemText, employeeName: assigneeName, date: new Date(startTime).toISOString().slice(0, 10), startTime: new Date(startTime).toISOString(), notes: '' }),
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.notionPageId && _rqTimers[pid]) {
      _rqTimers[pid].sessionNotionPageId = d.notionPageId;
      _rqSaveTimerState();
    }
  }).catch(function() {});
  restockQueueRender();
}

function rqStopTimer(pid) {
  var t = _rqTimers[pid];
  if (!t) return;
  var stopBtn = document.getElementById('rq-stop-' + pid);
  if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = 'Saving…'; }
  clearInterval(t.tickInterval);
  var stopTime = new Date().toISOString();
  var totalMs  = Date.now() - t.startTime;
  var totalMin = parseFloat((totalMs / 60000).toFixed(2));
  var netMin   = Math.max(0, totalMin - 15);
  // Capture notes before clearing state
  var notesEl  = document.getElementById('rq-notes-' + pid);
  var notes    = notesEl ? notesEl.value.trim() : (t.notes || '');
  var session  = {
    notionPageId: t.sessionNotionPageId,
    items: [{ name: t.itemText }],
    employee: t.employee,
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
  restockQueueRender();
  if (!session.notionPageId) { session.saved = true; rqRenderSessions(); return; }
  fetch('/api/notion-timesession', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageId: session.notionPageId, stopTime: stopTime, totalMin: totalMin, netMin: netMin, notes: notes }),
  }).then(function(r) {
    session.saved = r.ok;
    session.error = r.ok ? null : 'Notion error';
    rqRenderSessions();
    if (r.ok) toast('Session saved ✓', '✓');
    else toast('Notion save failed', '⚠');
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

// ── Session log ───────────────────────────────────────────────────────────────

function rqLoadSessions() {
  fetch('/api/notion-timesession')
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(ns) {
      if (!Array.isArray(ns) || !ns.length) { _rqSessionsLoaded = true; return; }
      _rqSessions = ns
        .filter(function(s) { return s.netMin != null; })
        .map(function(s) {
          return {
            notionPageId: s.notionPageId,
            items: [{ name: s.itemName || '' }],
            employee: { name: s.employeeName || '', id: '' },
            startTime: s.startTime || null,
            stopTime:  s.stopTime  || null,
            totalMs:   (s.totalMin || 0) * 60000,
            netMs:     (s.netMin   || 0) * 60000,
            notes:     s.notes || '',
            saved: true, error: null,
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

function rqRenderSessions() {
  var list = document.getElementById('rq-log-list');
  if (!list) return;
  if (!_rqSessions.length) {
    list.innerHTML = '<div class="rq-log-empty">No sessions recorded yet</div>';
    return;
  }
  list.innerHTML = _rqSessions.map(function(s, i) {
    var name   = (s.items && s.items[0] && s.items[0].name) || '—';
    var emp    = s.employee ? s.employee.name : '';
    var meta   = [emp, s.startTime ? _rqFmtDT(s.startTime) : null].filter(Boolean).join(' · ');
    var status = s.error
      ? '<span class="rq-sbar-err">⚠ ' + s.error + '</span>'
      : s.saved ? '<span class="rq-sbar-saved">✓ Saved</span>' : '<span style="color:var(--text-dim)">Saving…</span>';
    return '<div class="rq-session-bar">'
      + '<div class="rq-sbar-name">' + name.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>'
      + (meta ? '<div class="rq-sbar-meta">' + meta + '</div>' : '')
      + '<div class="rq-sbar-footer">'
      + '<span class="rq-sbar-net">Net: ' + _rqFmtDur(s.netMs) + '</span>'
      + (s.notes ? '<span style="color:var(--text3);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">' + s.notes.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>' : '')
      + status
      + '<button class="rq-sbar-del" onclick="rqDeleteSession(' + i + ')" title="Delete">✕</button>'
      + '</div>'
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
  selectEl.className = 'rq-assignee' + (person ? ' rq-' + person.toLowerCase() : '');
}

function rqAddItem() {
  var input = document.getElementById('rq-add-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;
  input.value = '';

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
      restockQueueRender();
    })
    .catch(function() {
      NOTES_DATA.splice(NOTES_DATA.indexOf(temp), 1);
      restockQueueRender();
      toast('Failed to add item', '⚠');
    });
}

function rqDeleteItem(idx) {
  if (!confirm('Remove this item from the Restock Queue?')) return;
  var items = _rqSortedItems();
  var item = items[idx];
  if (!item) return;
  var restockItems = itemsFor('restock');
  var restockIdx = restockItems.indexOf(item);
  deleteNoteItem('restock', restockIdx);
}

function rqSaveText(el, idx) {
  var newText = el.textContent.trim();
  if (!newText) { el.textContent = ''; return; }
  var item = _rqSortedItems()[idx];
  if (!item || !item.notionPageId || newText === item.text) return;
  item.text = newText;
  renderNotesList('restock', itemsFor('restock'));
  _rqPatch(item.notionPageId, { text: newText });
}
