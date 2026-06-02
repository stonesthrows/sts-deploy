// ════════════════════════════════════════════
//  NOTES  —  pages/notes.js
//  Studio Notes, To-Do, Follow-ups  (localStorage keys: sts-note-*, sts-list-*)
// ════════════════════════════════════════════

function saveNote(id) {
  var el = document.getElementById(id);
  if (!el) return;
  try { localStorage.setItem('sts-note-' + id, el.value); } catch(e) {}
}

function loadNotes() {
  // Restore freeform textareas
  ['notes-general'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var saved = localStorage.getItem('sts-note-' + id);
    if (saved !== null) el.value = saved;
  });
  // Restore checklists
  ['todo', 'followup'].forEach(function(key) {
    var saved = localStorage.getItem('sts-list-' + key);
    var items = saved ? JSON.parse(saved) : [];
    renderNotesList(key, items);
  });
}

function addNoteItem(key) {
  var input = document.getElementById(key + '-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;
  var items = getSavedList(key);
  items.push({ text: text, done: false });
  saveList(key, items);
  renderNotesList(key, items);
  input.value = '';
}

function toggleNoteItem(key, idx) {
  var items = getSavedList(key);
  if (items[idx]) items[idx].done = !items[idx].done;
  saveList(key, items);
  renderNotesList(key, items);
}

function deleteNoteItem(key, idx) {
  var items = getSavedList(key);
  items.splice(idx, 1);
  saveList(key, items);
  renderNotesList(key, items);
}

function getSavedList(key) {
  try {
    var saved = localStorage.getItem('sts-list-' + key);
    return saved ? JSON.parse(saved) : [];
  } catch(e) { return []; }
}

function saveList(key, items) {
  try { localStorage.setItem('sts-list-' + key, JSON.stringify(items)); } catch(e) {}
}

function renderNotesList(key, items) {
  var list  = document.getElementById(key + '-list');
  var count = document.getElementById(key + '-count');
  if (!list) return;

  var done    = items.filter(function(i){ return i.done; }).length;
  var pending = items.length - done;
  if (count) count.textContent = pending > 0 ? pending + ' left' : (items.length ? 'all done ✓' : '');

  list.innerHTML = items.map(function(item, idx) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid #F4EFE8">'
      + '<input type="checkbox" style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer" '
      + (item.done ? 'checked' : '') + ' onchange="toggleNoteItem(\'' + key + '\',' + idx + ')">'
      + '<span style="flex:1;font-size:13px;' + (item.done ? 'text-decoration:line-through;color:#B0A898' : 'color:var(--text)') + '">'
      + item.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>'
      + '<span onclick="deleteNoteItem(\'' + key + '\',' + idx + ')" style="cursor:pointer;color:#C4A0A0;font-size:18px;line-height:1;padding:0 4px" title="Remove">×</span>'
      + '</div>';
  }).join('');
}
