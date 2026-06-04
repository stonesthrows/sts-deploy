// ════════════════════════════════════════════
//  NOTES  —  js/notes.js
//  All blocks stored in Notion via /api/notion-notes
// ════════════════════════════════════════════

var NOTES_DATA = [];   // flat array of { notionPageId, text, block, done }

var BLOCK_MAP = {
  studio:   'Studio Notes',
  todo:     'To-Do',
  followup: 'Follow-up',
  toorder:  'To Order',
};

// ── Load ─────────────────────────────────────
function loadNotes() {
  ['studio','todo','followup','toorder'].forEach(function(key) {
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
      ['studio','todo','followup','toorder'].forEach(function(key) {
        renderNotesList(key, itemsFor(key));
      });
    })
    .catch(function(err) {
      if (spinner) spinner.style.display = 'none';
      toast('Could not reach /api/notion-notes — ' + (err || ''), '⚠');
    });
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
        toast('Save failed ' + res.status + ': ' + (res.data.error || 'unknown'), '⚠');
        return;
      }
      temp.notionPageId = res.data.notionPageId;
      temp._saving = false;
      renderNotesList(key, itemsFor(key));
    })
    .catch(function(err) {
      NOTES_DATA.splice(NOTES_DATA.indexOf(temp), 1);
      renderNotesList(key, itemsFor(key));
      toast('Failed to save note — ' + (err || ''), '⚠');
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
    var row = '<div' + saving + ' style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid #F4EFE8">';
    if (!noCheck) {
      row += '<input type="checkbox" style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer" '
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

// ── Quick Capture ────────────────────────────
function autoDetectBlock(text) {
  var t = text.toLowerCase();
  var followupWords = ['follow up', 'follow-up', 'call ', 'email ', 'contact ', 'reach out', 'check with', 'remind ', 'text '];
  var orderWords    = ['order ', 'orders ', 'buy ', 'restock', 'need more', 'running low', 'from rio', 'from stuller', 'from otto', 'from halstead', 'get more', 'pick up'];
  var todoWords     = ['finish ', 'complete ', 'make ', 'build ', 'fix ', 'clean ', 'update ', 'prepare ', 'ship ', 'solder ', 'set ', 'polish ', 'sand ', 'drill ', 'cut ', 'resize '];
  for (var i = 0; i < followupWords.length; i++) { if (t.indexOf(followupWords[i]) !== -1) return 'followup'; }
  for (var i = 0; i < orderWords.length; i++)    { if (t.indexOf(orderWords[i])    !== -1) return 'toorder'; }
  for (var i = 0; i < todoWords.length; i++)     { if (t.indexOf(todoWords[i])     !== -1) return 'todo'; }
  return 'studio';
}

function quickCapture() {
  var input  = document.getElementById('quick-capture-input');
  var catSel = document.getElementById('quick-capture-cat');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;
  var cat = catSel ? catSel.value : 'auto';
  if (cat === 'auto') cat = autoDetectBlock(text);
  input.value = '';

  // Temporarily set the target input and call addNoteItem
  var targetInput = document.getElementById(cat + '-input');
  if (targetInput) {
    targetInput.value = text;
    addNoteItem(cat);
    var labels = { studio: 'Studio Notes', todo: 'To-Do', followup: 'Follow-ups', toorder: 'To Order' };
    toast('Added to ' + (labels[cat] || cat), '⚡');
    input.focus();
  }
}
