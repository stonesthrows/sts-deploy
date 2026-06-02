// ════════════════════════════════════════════
//  NOTES TAB  —  crm/notes.js
// ════════════════════════════════════════════

CRM.registerTab({
  id: 'notes',
  label: 'Notes',
  icon: '📝',

  render(el) {
    el.innerHTML = `
      <div class="section-header">
        <span class="section-title">Notes</span>
        <div class="section-actions">
          <button class="btn btn-gold btn-sm" onclick="Notes.newNote()">＋ New Note</button>
        </div>
      </div>

      <div class="grid-2" style="gap:16px;align-items:start;">

        <!-- Note list -->
        <div class="card">
          <div class="card-head"><span class="card-title-icon">📋</span> All Notes</div>
          <div style="padding:8px;">
            <input class="form-input" id="notes-search" placeholder="Search…" oninput="Notes.filter()">
          </div>
          <div id="notes-list" style="max-height:520px;overflow-y:auto;"></div>
        </div>

        <!-- Editor -->
        <div class="card" id="notes-editor-card">
          <div class="card-head">
            <span class="card-title-icon">✏️</span>
            <input id="notes-title" class="form-input" placeholder="Note title…"
              style="border:none;background:transparent;font-weight:600;font-size:13px;padding:0;flex:1;">
            <div class="card-head-actions">
              <button class="btn btn-gold btn-sm" onclick="Notes.save()">Save</button>
              <button class="btn btn-outline btn-sm" onclick="Notes.deleteActive()" style="color:var(--text-dim);">Delete</button>
            </div>
          </div>
          <div class="card-body" style="padding:12px;">
            <textarea id="notes-body" class="form-textarea"
              placeholder="Start typing…"
              style="min-height:420px;font-size:13px;line-height:1.6;"></textarea>
          </div>
        </div>

      </div>`;

    Notes._load();
    Notes._render();
  }
});

window.Notes = (() => {
  let _notes  = [];
  let _active = null;

  function _load() {
    _notes = CRM.load('notes', []);
  }

  function _render() {
    const el = document.getElementById('notes-list');
    if (!el) return;
    const q = (document.getElementById('notes-search')?.value || '').toLowerCase();
    const filtered = q
      ? _notes.filter(n => (n.title+n.body).toLowerCase().includes(q))
      : _notes;

    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state" style="padding:20px;"><div class="empty-icon">📝</div><p>${q ? 'No matches' : 'No notes yet'}</p></div>`;
      return;
    }

    el.innerHTML = filtered.map(n => `
      <div class="list-row" style="padding:10px 16px;cursor:pointer;${_active===n.id ? 'background:var(--accent-bg);' : ''}"
           onclick="Notes.open('${n.id}')">
        <div class="list-row-main">
          <div class="list-row-title">${esc(n.title || 'Untitled')}</div>
          <div class="list-row-sub">${esc((n.body||'').slice(0,60))}</div>
        </div>
        <div class="list-row-meta">${CRM.fmtDate(n.updated)}</div>
      </div>`).join('');
  }

  function newNote() {
    const note = { id: 'note-' + Date.now(), title: '', body: '', updated: new Date().toISOString() };
    _notes.unshift(note);
    CRM.save('notes', _notes);
    open(note.id);
    _render();
    document.getElementById('notes-title')?.focus();
  }

  function open(id) {
    _active = id;
    const note = _notes.find(n => n.id === id);
    if (!note) return;
    const title = document.getElementById('notes-title');
    const body  = document.getElementById('notes-body');
    if (title) title.value = note.title || '';
    if (body)  body.value  = note.body  || '';
    _render();
  }

  function save() {
    if (!_active) { newNote(); return; }
    const note = _notes.find(n => n.id === _active);
    if (!note) return;
    note.title   = document.getElementById('notes-title')?.value.trim() || 'Untitled';
    note.body    = document.getElementById('notes-body')?.value || '';
    note.updated = new Date().toISOString();
    CRM.save('notes', _notes);
    CRM.toast('Note saved');
    _render();
  }

  function deleteActive() {
    if (!_active) return;
    if (!confirm('Delete this note?')) return;
    _notes = _notes.filter(n => n.id !== _active);
    _active = null;
    CRM.save('notes', _notes);
    const title = document.getElementById('notes-title');
    const body  = document.getElementById('notes-body');
    if (title) title.value = '';
    if (body)  body.value  = '';
    CRM.toast('Note deleted');
    _render();
  }

  function filter() { _render(); }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { _load, _render, newNote, open, save, deleteActive, filter };
})();
