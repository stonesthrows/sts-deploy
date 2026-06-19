// ════════════════════════════════════════════
//  DESIGNS  —  js/designs.js
//  Jewelry design specs & instructions library
// ════════════════════════════════════════════

const DESIGNS_KEY  = 'sts-designs';          // legacy localStorage key (migration only)
const DESIGNS_CATS = ['Ear Cuffs', 'Rings', 'Earrings', 'Pendants / Necklaces', 'Other'];

// Index-only array — no images, just metadata for the library listing.
// Full design (with images) is fetched from KV only when editing.
let _designs         = [];
let _designsCurrentFull = null; // full design currently loaded for editing
let _designsEditId   = null;    // null = new, string = editing existing
let _designsView     = 'library';
let _designsCatFilter = 'all';
let _designsImgQueue = [];      // base64 strings staged for current edit session
let _designsImgEditMode = false;

// ── KV API helpers ────────────────────────────
async function _designsApiFetch(id) {
  const url = id ? `/api/designs?id=${encodeURIComponent(id)}` : '/api/designs';
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Load failed (${resp.status})`);
  return resp.json();
}

async function _designsApiSave(design) {
  const resp = await fetch('/api/designs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(design),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Save failed (${resp.status})`);
  }
}

async function _designsApiDelete(id) {
  const resp = await fetch(`/api/designs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(`Delete failed (${resp.status})`);
}

// ── Load index from KV ────────────────────────
async function designsLoad() {
  try {
    _designs = await _designsApiFetch();
  } catch {
    // Fallback to legacy localStorage if KV unreachable
    try { _designs = JSON.parse(localStorage.getItem(DESIGNS_KEY) || '[]'); }
    catch { _designs = []; }
  }
}

// ── Init (fired by TAB_HOOKS) ─────────────────
async function designsInit() {
  _designsShowLoadingPlaceholder();
  await designsLoad();
  await _designsMigrateLocalStorage();
  designsShowLibrary();
}

function _designsShowLoadingPlaceholder() {
  document.getElementById('designs-library').style.display = '';
  document.getElementById('designs-form-wrap').style.display = 'none';
  const list = document.getElementById('designs-list');
  if (list) list.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text3);font-size:13px">Loading designs…</div>';
}

// ── One-time localStorage → KV migration ──────
async function _designsMigrateLocalStorage() {
  if (localStorage.getItem('sts-designs-kv-migrated')) return;

  let local = [];
  try { local = JSON.parse(localStorage.getItem(DESIGNS_KEY) || '[]'); } catch { local = []; }

  if (local.length) {
    const list = document.getElementById('designs-list');
    if (list) list.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text3);font-size:13px">Migrating ${local.length} design${local.length > 1 ? 's' : ''} to cloud…</div>`;

    for (const d of local) {
      // Generate a thumb if design has images but no thumb yet
      if (d.images && d.images.length && !d.thumb) {
        try { d.thumb = await _designsMakeThumb(d.images[0]); } catch { d.thumb = null; }
      }
      try { await _designsApiSave(d); } catch { /* best-effort */ }
    }
    await designsLoad();
  }

  localStorage.setItem('sts-designs-kv-migrated', '1');
}

// ── View switching ────────────────────────────
function designsShowLibrary() {
  _designsView   = 'library';
  _designsEditId = null;
  _designsCurrentFull = null;
  _designsImgQueue = [];
  _designsImgEditMode = false;
  document.getElementById('designs-library').style.display  = '';
  document.getElementById('designs-form-wrap').style.display = 'none';
  const newBtn = document.getElementById('dsn-new-btn');
  if (newBtn) newBtn.style.display = '';
  designsCloseGearMenu();
  designsRenderLibrary();
}

async function designsShowForm(id) {
  _designsView   = 'form';
  _designsEditId = id || null;
  _designsImgQueue   = [];
  _designsCurrentFull = null;
  _designsImgEditMode = false;
  document.getElementById('designs-library').style.display   = 'none';
  document.getElementById('designs-form-wrap').style.display = '';
  const newBtn = document.getElementById('dsn-new-btn');
  if (newBtn) newBtn.style.display = 'none';

  if (id) {
    // Show brief skeleton while fetching full design from KV
    document.getElementById('dsn-name').value  = '';
    document.getElementById('dsn-specs').value = '';
    document.getElementById('dsn-instructions').value = '';
    document.getElementById('dsn-pdf-status').textContent = '⏳ Loading…';
    document.getElementById('dsn-pdf-status').style.color = 'var(--accent)';
    try {
      _designsCurrentFull = await _designsApiFetch(id);
      document.getElementById('dsn-pdf-status').textContent = '';
    } catch(e) {
      document.getElementById('dsn-pdf-status').textContent = '❌ Could not load design: ' + e.message;
      document.getElementById('dsn-pdf-status').style.color = '#c0392b';
    }
  }

  designsRenderForm();
}

// ── Library ───────────────────────────────────
function designsRenderLibrary() {
  const list = document.getElementById('designs-list');
  if (!list) return;

  const filtered = _designsCatFilter === 'all'
    ? _designs
    : _designs.filter(d => d.category === _designsCatFilter);

  if (filtered.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:52px 32px;color:var(--text3)">
        <div style="font-size:36px;margin-bottom:12px">📋</div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">No designs yet</div>
        <div style="font-size:12px">Click <strong>+ New Design</strong> to add your first one,<br>or upload a PDF to get started.</div>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(d => {
    const thumb = d.thumb
      ? `<div class="dsn-card-thumb" style="background-image:url('${d.thumb}')"></div>`
      : `<div class="dsn-card-thumb dsn-card-thumb-empty"><span style="font-size:22px">💎</span></div>`;
    const imgCount = d.imgCount || 0;
    const imgBadge = imgCount > 1 ? `<span class="dsn-img-badge">+${imgCount - 1}</span>` : '';
    const cat     = d.category || 'Uncategorized';
    const preview = (d.preview || '').slice(0, 90).replace(/\n/g, ' ') || 'No details';
    return `
      <div class="dsn-card" onclick="designsShowForm('${d.id}')">
        <div class="dsn-card-thumb-wrap">${thumb}${imgBadge}</div>
        <div class="dsn-card-body">
          <div class="dsn-cat-chip">${cat}</div>
          <div class="dsn-card-name">${escHtml(d.name || 'Untitled')}</div>
          <div class="dsn-card-preview">${escHtml(preview)}${preview.length >= 90 ? '…' : ''}</div>
        </div>
      </div>`;
  }).join('');
}

function designsSetCatFilter(cat) {
  _designsCatFilter = cat;
  document.querySelectorAll('.dsn-filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
  });
  designsRenderLibrary();
}

// ── Form ──────────────────────────────────────
function designsRenderForm() {
  const design = _designsCurrentFull;
  const isEdit = !!design;

  document.getElementById('dsn-name').value         = design ? (design.name         || '') : '';
  document.getElementById('dsn-cat').value           = design ? (design.category     || '') : '';
  document.getElementById('dsn-specs').value         = design ? (design.specs        || '') : '';
  document.getElementById('dsn-instructions').value  = design ? (design.instructions || '') : '';

  _designsImgQueue = design ? [...(design.images || [])] : [];
  designsRenderImagePreviews();

  const delBtn = document.getElementById('dsn-delete-btn');
  if (delBtn) delBtn.style.display = isEdit ? '' : 'none';

  const st = document.getElementById('dsn-pdf-status');
  if (st && !st.textContent.startsWith('❌')) st.textContent = '';
  designsRefreshApiKeyUI();

  setTimeout(dsnAutoResizeAll, 0);
}

function designsRenderImagePreviews() {
  const wrap = document.getElementById('dsn-img-previews');
  if (!wrap) return;
  if (_designsImgQueue.length === 0) {
    wrap.className = 'dsn-img-col';
    wrap.innerHTML = '<span style="color:var(--text3);font-size:12px">No images yet</span>';
    return;
  }
  wrap.className = 'dsn-img-col' + (_designsImgEditMode ? ' edit-mode' : '');
  wrap.innerHTML = _designsImgQueue.map((src, i) => `
    <div class="dsn-thumb-wrap">
      <img src="${src}" class="dsn-thumb" alt="Design image ${i+1}" onclick="designsViewImage(${i})">
      <button class="dsn-thumb-del" onclick="designsRemoveImage(${i})" title="Remove image">×</button>
    </div>`).join('');
}

function designsToggleImageEdit() {
  _designsImgEditMode = !_designsImgEditMode;
  const btn = document.getElementById('dsn-img-edit-btn');
  if (btn) {
    btn.textContent = _designsImgEditMode ? '✓ Done Managing' : '🖼 Manage Images';
    btn.classList.toggle('active', _designsImgEditMode);
  }
  const wrap = document.getElementById('dsn-img-previews');
  if (wrap && _designsImgQueue.length > 0) {
    wrap.classList.toggle('edit-mode', _designsImgEditMode);
  }
}

function designsRemoveImage(idx) {
  _designsImgQueue.splice(idx, 1);
  designsRenderImagePreviews();
}

function designsViewImage(idx) {
  const src = _designsImgQueue[idx];
  if (!src) return;
  document.getElementById('dsn-img-overlay-img').src = src;
  document.getElementById('dsn-img-overlay').style.display = 'flex';
}

function designsCloseImageOverlay() {
  document.getElementById('dsn-img-overlay').style.display = 'none';
  document.getElementById('dsn-img-overlay-img').src = '';
}

// ── Save / Delete ─────────────────────────────
async function designsSaveDesign() {
  const name = document.getElementById('dsn-name').value.trim();
  if (!name) { toast('Please enter a design name', '⚠'); return; }

  const now = new Date().toISOString();
  const id  = _designsEditId || ('dsn-' + Date.now());

  const design = {
    ...((_designsEditId && _designsCurrentFull) ? _designsCurrentFull : {}),
    id,
    name,
    category:     document.getElementById('dsn-cat').value,
    specs:        document.getElementById('dsn-specs').value.trim(),
    instructions: document.getElementById('dsn-instructions').value.trim(),
    images:       [..._designsImgQueue],
    createdAt:    (_designsCurrentFull && _designsCurrentFull.createdAt) ? _designsCurrentFull.createdAt : now,
    updatedAt:    now,
    thumb:        _designsImgQueue.length
                    ? await _designsMakeThumb(_designsImgQueue[0])
                    : null,
  };

  try {
    await _designsApiSave(design);
    toast(_designsEditId ? 'Design updated' : 'Design saved', '✓');
    await designsLoad();
    designsShowLibrary();
  } catch(e) {
    toast('Save failed — ' + (e.message || e), '❌');
  }
}

async function designsDeleteDesign() {
  if (!_designsEditId) return;
  const d = _designsCurrentFull;
  if (!confirm(`Delete "${(d && d.name) || 'this design'}"? This cannot be undone.`)) return;
  try {
    await _designsApiDelete(_designsEditId);
    toast('Design deleted', '🗑');
    await designsLoad();
    designsShowLibrary();
  } catch(e) {
    toast('Delete failed — ' + (e.message || e), '❌');
  }
}

// ── Thumbnail generator (80px, low-res for index) ──
function _designsMakeThumb(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const SIZE  = 80;
      const scale = SIZE / Math.max(img.width, img.height);
      c.width  = Math.round(img.width  * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ── Image upload ──────────────────────────────
function designsHandleImages(files) {
  const MAX = 10;
  const remaining = MAX - _designsImgQueue.length;
  if (remaining <= 0) { toast(`Max ${MAX} images per design`, '⚠'); return; }
  const toAdd = Array.from(files).slice(0, remaining);
  let loaded = 0;
  toAdd.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_W  = 1200;
        const scale  = img.width > MAX_W ? MAX_W / img.width : 1;
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        _designsImgQueue.push(canvas.toDataURL('image/jpeg', 0.82));
        loaded++;
        if (loaded === toAdd.length) designsRenderImagePreviews();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── PDF upload → Claude vision ────────────────
async function designsHandlePDF(file) {
  if (!file || file.type !== 'application/pdf') {
    toast('Please upload a PDF file', '⚠');
    return;
  }
  const status = document.getElementById('dsn-pdf-status');
  const apiKey = localStorage.getItem('sts-anthropic-key');
  if (!apiKey) {
    status.style.color = '#c0392b';
    status.textContent = '⚠ Enter your Anthropic API key — click ⚙ to add it';
    const panel = document.getElementById('dsn-api-key-panel');
    if (panel) { panel.style.display = ''; designsRefreshApiKeyUI(); }
    setTimeout(() => document.getElementById('dsn-api-key-input')?.focus(), 50);
    return;
  }

  status.style.color = 'var(--accent)';
  status.textContent = '⏳ Rendering PDF pages…';

  const buf = await file.arrayBuffer();
  try {
    const lib = window.pdfjsLib;
    if (!lib) { status.textContent = '❌ PDF reader not loaded'; return; }

    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;

    const pageImages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page     = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas   = document.createElement('canvas');
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pageImages.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    }

    status.textContent = '⏳ Asking Claude to read the form…';

    const content = [
      ...pageImages.map(img => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: img },
      })),
      {
        type: 'text',
        text: 'This is a scanned jewelry design instruction form. Extract exactly three fields:\n1. Jewelry Design Name (the value written after the "Jewelry Design Name:" label)\n2. Specifications & Materials (everything in the SPECIFICATIONS section — wire gauges, sizes, tools, quantities, wire colors)\n3. Step-by-step Instructions (all numbered or bulleted steps, notes, and directions in order)\n\nReturn ONLY valid JSON with no other text:\n{"name": "...", "specs": "...", "instructions": "..."}',
      },
    ];

    const resp = await fetch('/api/claude-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        model: 'claude-opus-4-8',
        max_tokens: 1500,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${resp.status}`);
    }

    const data    = await resp.json();
    const raw     = (data.content?.[0]?.text || '').trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed  = JSON.parse(cleaned);

    const nameEl = document.getElementById('dsn-name');
    const specsEl = document.getElementById('dsn-specs');
    const instrEl = document.getElementById('dsn-instructions');
    if (!nameEl.value.trim()  && parsed.name)         nameEl.value  = parsed.name;
    if (!specsEl.value.trim() && parsed.specs)         specsEl.value = parsed.specs;
    if (!instrEl.value.trim() && parsed.instructions)  instrEl.value = parsed.instructions;

    setTimeout(dsnAutoResizeAll, 0);
    status.style.color = 'var(--text)';
    status.textContent = '✓ Fields filled by Claude — review and edit below';
  } catch(err) {
    status.style.color = '#c0392b';
    status.textContent = '❌ ' + (err.message || err);
  }
}

// ── API key management ────────────────────────
function designsSaveApiKey() {
  const val = (document.getElementById('dsn-api-key-input').value || '').trim();
  if (!val) { toast('Please enter an API key', '⚠'); return; }
  localStorage.setItem('sts-anthropic-key', val);
  document.getElementById('dsn-api-key-input').value = '';
  const panel = document.getElementById('dsn-api-key-panel');
  if (panel) panel.style.display = 'none';
  toast('API key saved', '✓');
}

function designsClearApiKey() {
  localStorage.removeItem('sts-anthropic-key');
  designsRefreshApiKeyUI();
}

function designsRefreshApiKeyUI() {
  const key   = localStorage.getItem('sts-anthropic-key');
  const row   = document.getElementById('dsn-api-key-row');
  const saved = document.getElementById('dsn-api-key-saved');
  if (!row || !saved) return;
  if (key) { row.style.display = 'none'; saved.style.display = ''; }
  else     { row.style.display = '';     saved.style.display = 'none'; }
}

function designsToggleGearMenu() {
  const menu = document.getElementById('dsn-gear-menu');
  if (!menu) return;
  const opening = menu.style.display === 'none';
  menu.style.display = opening ? '' : 'none';
  if (opening) {
    const close = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'dsn-gear-btn') {
        menu.style.display = 'none';
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  }
}

function designsCloseGearMenu() {
  const menu = document.getElementById('dsn-gear-menu');
  if (menu) menu.style.display = 'none';
}

function designsToggleApiKeyPanel() {
  const panel = document.getElementById('dsn-api-key-panel');
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? '' : 'none';
  if (opening) {
    designsRefreshApiKeyUI();
    const key = localStorage.getItem('sts-anthropic-key');
    if (!key) setTimeout(() => document.getElementById('dsn-api-key-input')?.focus(), 50);
  }
}

// ── Auto-resize textareas ─────────────────────
function dsnAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight + 2) + 'px';
}
function dsnAutoResizeAll() {
  document.querySelectorAll('#designs-form-wrap .dsn-textarea').forEach(dsnAutoResize);
}

// ── Utility ───────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
