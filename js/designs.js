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

// BOM (Phase 3): material recipe on the design record
let _designsBom       = [];   // [{materialId, qty}] staged for current edit
let _designsMaterials = null; // active materials for the picker (null = loading)
let _shopSettings     = null; // {wasteDefaultPct, wastePctByMetal, shopHourlyRate, …} from /api/shop-settings

// Costing (Phase 4): Square link + labor/retail sources
let _dsnLabor         = null; // squareVariationId|custom:name -> {hrs, pcs, minPerPc} from work sessions
let _dsnSqPrices      = {};   // squareVariationId -> retail price (null = fetched, no price)
let _dsnLinkedSq      = null; // {id, name} staged for current edit
let _dsnSqSearchTimer = null;
let _designsPricingOpen = false;

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
  _designsLoadCosting();
}

// Background load of the materials picker + waste settings (BOM editor).
// Runs on every tab visit so new library entries appear without a reload;
// never blocks the library view — re-renders the BOM section when it lands.
function _designsLoadCosting() {
  if (typeof _materialsApiFetch === 'function') {
    _materialsApiFetch()
      .then(ms => { _designsMaterials = ms.filter(m => m.active !== false); _designsBomRender(); })
      .catch(() => { if (_designsMaterials === null) _designsMaterials = []; _designsBomRender(); });
  }
  fetch('/api/shop-settings')
    .then(r => r.json())
    .then(s => { _shopSettings = (s && !s.error) ? s : {}; dsnWasteDefaultsRefreshLabel(); dsnBomRecalcEffective(); })
    .catch(() => { if (_shopSettings === null) _shopSettings = {}; dsnWasteDefaultsRefreshLabel(); });
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
  _designsPricingOpen = false;
  const pricing = document.getElementById('designs-pricing');
  if (pricing) pricing.style.display = 'none';
  const priceBtn = document.getElementById('dsn-pricing-btn');
  if (priceBtn) { priceBtn.style.display = ''; priceBtn.textContent = '💲 Pricing Sheet'; }
  document.getElementById('designs-library').style.display  = '';
  document.getElementById('designs-form-wrap').style.display = 'none';
  const newBtn = document.getElementById('dsn-new-btn');
  if (newBtn) newBtn.style.display = '';
  designsCloseGearMenu();
  const addRow = document.getElementById('dsn-img-add-row');
  if (addRow) addRow.style.display = 'none';
  designsRenderLibrary();
}

async function designsShowForm(id) {
  _designsView   = 'form';
  _designsEditId = id || null;
  _designsImgQueue   = [];
  _designsCurrentFull = null;
  _designsImgEditMode = false;
  _designsPricingOpen = false;
  const pricing = document.getElementById('designs-pricing');
  if (pricing) pricing.style.display = 'none';
  const priceBtn = document.getElementById('dsn-pricing-btn');
  if (priceBtn) priceBtn.style.display = 'none';
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
    _dsnStatusTone(document.getElementById('dsn-pdf-status'), '');
    try {
      _designsCurrentFull = await _designsApiFetch(id);
      document.getElementById('dsn-pdf-status').textContent = '';
    } catch(e) {
      document.getElementById('dsn-pdf-status').textContent = '❌ Could not load design: ' + e.message;
      _dsnStatusTone(document.getElementById('dsn-pdf-status'), 'err');
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
    const bomN    = Array.isArray(d.bom) ? d.bom.length : 0;
    const bomChip = bomN
      ? `<div class="dsn-cat-chip dsn-bom-chip weighed">⚖ ${bomN} material${bomN !== 1 ? 's' : ''}</div>`
      : `<div class="dsn-cat-chip dsn-bom-chip">⚖ Not weighed</div>`;
    return `
      <div class="dsn-card" onclick="designsShowForm('${d.id}')">
        <div class="dsn-card-thumb-wrap">${thumb}${imgBadge}</div>
        <div class="dsn-card-body">
          <div class="dsn-cat-chip">${cat}</div>${bomChip}
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

  _designsBom = (design && Array.isArray(design.bom))
    ? design.bom.map(l => ({ materialId: l.materialId, qty: l.qty }))
    : [];
  const wasteEl = document.getElementById('dsn-waste');
  if (wasteEl) wasteEl.value = (design && design.wasteOverridePct != null) ? design.wasteOverridePct : '';

  _dsnLinkedSq = (design && design.squareItemId)
    ? { id: design.squareItemId, name: design.squareItemName || design.squareItemId }
    : null;
  const retailOv = document.getElementById('dsn-retail-ov');
  if (retailOv) retailOv.value = (design && design.retailPriceOverride != null) ? design.retailPriceOverride : '';
  const laborOv = document.getElementById('dsn-labor-ov');
  if (laborOv) laborOv.value = (design && design.laborMinPerPieceOverride != null) ? design.laborMinPerPieceOverride : '';
  dsnSqLinkRender();
  _dsnLoadLabor().then(dsnRollupRender);
  if (_dsnLinkedSq) _dsnLoadSqPrices([_dsnLinkedSq.id]).then(dsnRollupRender);

  _designsBomRender();

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
  const addRow = document.getElementById('dsn-img-add-row');
  if (addRow) addRow.style.display = _designsImgEditMode ? '' : 'none';
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

  dsnBomSyncFromDom();
  const wasteRaw = (document.getElementById('dsn-waste') || {}).value;
  const design = {
    ...((_designsEditId && _designsCurrentFull) ? _designsCurrentFull : {}),
    id,
    name,
    category:     document.getElementById('dsn-cat').value,
    specs:        document.getElementById('dsn-specs').value.trim(),
    instructions: document.getElementById('dsn-instructions').value.trim(),
    bom:          _designsBom
                    .filter(l => l.materialId && l.qty > 0)
                    .map(l => ({ materialId: l.materialId, qty: l.qty })),
    wasteOverridePct: (wasteRaw === '' || wasteRaw == null) ? null : parseFloat(wasteRaw),
    squareItemId:   _dsnLinkedSq ? _dsnLinkedSq.id   : null,
    squareItemName: _dsnLinkedSq ? _dsnLinkedSq.name : null,
    retailPriceOverride:      _dsnNumOrNull((document.getElementById('dsn-retail-ov') || {}).value),
    laborMinPerPieceOverride: _dsnNumOrNull((document.getElementById('dsn-labor-ov')  || {}).value),
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

// ── Thumbnail generator (300px square crop, for index card) ──
function _designsMakeThumb(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const SIZE  = 600;
      // scale so the shorter side fills SIZE (cover behavior)
      const scale = SIZE / Math.min(img.width, img.height);
      const sw = Math.round(img.width  * scale);
      const sh = Math.round(img.height * scale);
      c.width  = SIZE;
      c.height = SIZE;
      // center-crop
      c.getContext('2d').drawImage(img, -(sw - SIZE) / 2, -(sh - SIZE) / 2, sw, sh);
      resolve(c.toDataURL('image/jpeg', 0.85));
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
    _dsnStatusTone(status, 'err');
    status.textContent = '⚠ Enter your Anthropic API key — click ⚙ to add it';
    const panel = document.getElementById('dsn-api-key-panel');
    if (panel) { panel.style.display = ''; designsRefreshApiKeyUI(); }
    setTimeout(() => document.getElementById('dsn-api-key-input')?.focus(), 50);
    return;
  }

  _dsnStatusTone(status, '');
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
    _dsnStatusTone(status, 'ok');
    status.textContent = '✓ Fields filled by Claude — review and edit below';
  } catch(err) {
    _dsnStatusTone(status, 'err');
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

// ── Status tone (presentational only) ─────────
// Swaps the .dsn-pdf-status color modifier classes ('' = accent/default,
// 'err' = red, 'ok' = text color) so the midnight theme can restyle them
// in CSS instead of fighting hardcoded inline hex colors.
function _dsnStatusTone(el, tone) {
  if (!el) return;
  el.classList.remove('err', 'ok');
  if (tone) el.classList.add(tone);
}

// ── Auto-resize textareas ─────────────────────
function dsnAutoResize(el) {
  el.style.height = '0';
  el.style.height = (el.scrollHeight + 2) + 'px';
}
function dsnAutoResizeAll() {
  document.querySelectorAll('#designs-form-wrap .dsn-textarea').forEach(dsnAutoResize);
}

// ── Utility ───────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ════════════════════════════════════════════
//  BOM EDITOR (Phase 3)
//  Material recipe lines on the design record. Metal lines carry a
//  waste factor: design override → metal-type default → shop default.
//  Component lines never carry waste.
// ════════════════════════════════════════════

function _dsnBomMat(id) {
  return (_designsMaterials || []).find(m => m.notionPageId === id);
}

function _dsnUnitSuffix(m) {
  return m ? matUnitAbbr(m.unit) : 'pc';
}

// Effective waste % for a metal line (spec §5 hybrid model) — pure form,
// usable outside the edit form (pricing sheet, cost rollups)
function _dsnWastePctResolve(m, overridePct) {
  if (overridePct != null && !isNaN(overridePct)) return overridePct;
  const s = _shopSettings || {};
  const mt = (s.wastePctByMetal || {})[m.metalType];
  if (typeof mt === 'number') return mt;
  return typeof s.wasteDefaultPct === 'number' ? s.wasteDefaultPct : 0;
}

// Form-context wrapper: reads the design's waste override from the DOM
function _dsnWastePctFor(m) {
  const ov = parseFloat((document.getElementById('dsn-waste') || {}).value);
  return _dsnWastePctResolve(m, isNaN(ov) ? null : ov);
}

function _dsnEffectiveLabel(l) {
  const m = _dsnBomMat(l.materialId);
  if (!m || !(l.qty > 0)) return '';
  const unit = _dsnUnitSuffix(m);
  if (m.category !== 'metal') return l.qty + ' ' + unit;
  const w = _dsnWastePctFor(m);
  return '→ ' + (l.qty * (1 + w / 100)).toFixed(2) + ' ' + unit + ' incl. ' + w + '% waste';
}

function _dsnBomOptions(selectedId) {
  function opts(list) {
    return list.map(m =>
      `<option value="${m.notionPageId}"${m.notionPageId === selectedId ? ' selected' : ''}>${escHtml(m.name || 'Untitled')} (${_dsnUnitSuffix(m)})</option>`
    ).join('');
  }
  const metals = _designsMaterials.filter(m => m.category === 'metal');
  const chains = _designsMaterials.filter(m => m.category === 'chain');
  const comps  = _designsMaterials.filter(m => m.category !== 'metal' && m.category !== 'chain');
  return '<option value="">Pick material…</option>'
    + (metals.length ? '<optgroup label="Metals">'     + opts(metals) + '</optgroup>' : '')
    + (chains.length ? '<optgroup label="Chains">'     + opts(chains) + '</optgroup>' : '')
    + (comps.length  ? '<optgroup label="Components">' + opts(comps)  + '</optgroup>' : '');
}

function dsnBomAdd() {
  dsnBomSyncFromDom();
  _designsBom.push({ materialId: '', qty: null });
  _designsBomRender();
}

function _designsBomRender() {
  const wrap = document.getElementById('dsn-bom-rows');
  if (!wrap || _designsView !== 'form') return;
  if (_designsMaterials === null) {
    wrap.innerHTML = '<div class="dsn-bom-note">Loading materials…</div>';
    return;
  }
  if (!_designsMaterials.length) {
    wrap.innerHTML = '<div class="dsn-bom-note">No materials in the library yet — seed <strong>Supplies → Materials Library</strong> first.</div>';
    return;
  }

  wrap.innerHTML = _designsBom.map((l, i) => {
    const m = _dsnBomMat(l.materialId);
    return `<div class="dsn-bom-row" data-idx="${i}">
      <select class="dsn-bom-mat">${_dsnBomOptions(l.materialId)}</select>
      <input type="number" step="0.01" min="0" class="dsn-bom-qty" placeholder="Qty${m ? ' (' + _dsnUnitSuffix(m) + ')' : ''}" value="${l.qty != null ? l.qty : ''}">
      <span class="dsn-bom-eff">${escHtml(_dsnEffectiveLabel(l))}</span>
      <button type="button" class="dsn-bom-remove" title="Remove line">✕</button>
    </div>`;
  }).join('') || '<div class="dsn-bom-note">No materials weighed yet — the recipe powers cost rollups and the replenishment engine.</div>';

  wrap.querySelectorAll('.dsn-bom-row').forEach(row => {
    const idx   = parseInt(row.dataset.idx, 10);
    const sel   = row.querySelector('.dsn-bom-mat');
    const qtyEl = row.querySelector('.dsn-bom-qty');
    sel.addEventListener('change', () => {
      const m = _dsnBomMat(sel.value);
      if (m) qtyEl.placeholder = 'Qty (' + _dsnUnitSuffix(m) + ')';
      dsnBomSyncFromDom();
      dsnBomRecalcEffective();
    });
    qtyEl.addEventListener('input', () => { dsnBomSyncFromDom(); dsnBomRecalcEffective(); });
    row.querySelector('.dsn-bom-remove').addEventListener('click', () => {
      dsnBomSyncFromDom();
      _designsBom.splice(idx, 1);
      _designsBomRender();
    });
  });

  dsnWasteDefaultsRefreshLabel();
  dsnRollupRender();
}

function dsnBomSyncFromDom() {
  document.querySelectorAll('#dsn-bom-rows .dsn-bom-row').forEach(row => {
    const l = _designsBom[parseInt(row.dataset.idx, 10)];
    if (!l) return;
    l.materialId = row.querySelector('.dsn-bom-mat').value;
    const q = parseFloat(row.querySelector('.dsn-bom-qty').value);
    l.qty = isNaN(q) ? null : q;
  });
}

// Refresh only the per-row effective-consumption labels (waste % changed)
function dsnBomRecalcEffective() {
  document.querySelectorAll('#dsn-bom-rows .dsn-bom-row').forEach(row => {
    const l = _designsBom[parseInt(row.dataset.idx, 10)];
    const eff = row.querySelector('.dsn-bom-eff');
    if (l && eff) eff.textContent = _dsnEffectiveLabel(l);
  });
  dsnRollupRender();
}

// ── Shop-wide waste defaults (shared via /api/shop-settings) ──
function dsnWasteDefaultsRefreshLabel() {
  const el = document.getElementById('dsnWasteDefaultsLbl');
  if (!el) return;
  if (_shopSettings === null) { el.textContent = 'Waste defaults: loading…'; return; }
  const pm  = _shopSettings.wastePctByMetal || {};
  const fmt = v => (typeof v === 'number' ? v + '%' : '—');
  el.textContent = 'Waste defaults — shop: ' + fmt(_shopSettings.wasteDefaultPct)
    + ' · argentium: ' + fmt(pm.argentium)
    + ' · gold-fill: ' + fmt(pm.gold_fill);
}

function dsnWasteDefaultsToggle() {
  const p = document.getElementById('dsnWasteDefaultsPanel');
  if (!p) return;
  const opening = p.style.display === 'none';
  if (opening) {
    const s  = _shopSettings || {};
    const pm = s.wastePctByMetal || {};
    document.getElementById('dsnWdShop').value      = s.wasteDefaultPct ?? '';
    document.getElementById('dsnWdArgentium').value = pm.argentium ?? '';
    document.getElementById('dsnWdGf').value        = pm.gold_fill ?? '';
  }
  p.style.display = opening ? '' : 'none';
}

async function dsnWasteDefaultsSave() {
  const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  // Preserve Phase 4 fields (hourly rate, margins) already in the blob
  const s = Object.assign({}, _shopSettings || {});
  s.wasteDefaultPct = num(document.getElementById('dsnWdShop').value);
  s.wastePctByMetal = {};
  const ag = num(document.getElementById('dsnWdArgentium').value);
  const gf = num(document.getElementById('dsnWdGf').value);
  if (ag != null) s.wastePctByMetal.argentium = ag;
  if (gf != null) s.wastePctByMetal.gold_fill = gf;
  try {
    const r = await fetch('/api/shop-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    _shopSettings = s;
    toast('Waste defaults saved', '✓');
    dsnWasteDefaultsToggle();
    dsnWasteDefaultsRefreshLabel();
    dsnBomRecalcEffective();
  } catch (e) {
    toast('Save failed — ' + (e.message || e), '❌');
  }
}

// ════════════════════════════════════════════
//  COST ROLLUP & PRICING (Phase 4)
//  True per-piece cost: BOM materials (incl. waste) + tracked labor.
//  Labor minutes/piece derive from the same work-session history the
//  Production Report reads (keyed by Square item variation); retail
//  price comes live from Square. Manual overrides cover unlinked or
//  untracked designs.
// ════════════════════════════════════════════

function _dsnNumOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// ── Labor: aggregate work sessions → minutes/piece per item key ──
// Same share math as the Production Report's By Design view: a session's
// net time splits across its items proportionally to pieces made.
function _dsnLoadLabor(force) {
  if (_dsnLabor !== null && !force) return Promise.resolve(_dsnLabor);
  return fetch('/api/notion-timesession?all=true')
    .then(r => (r.ok ? r.json() : []))
    .then(ns => {
      const agg = {};
      (Array.isArray(ns) ? ns : []).forEach(s => {
        if (s.netMin == null) return;
        let items = null;
        if (s.itemsJson) { try { items = JSON.parse(s.itemsJson); } catch (e) {} }
        if (!items) items = s.itemName ? [{ name: s.itemName, squareId: s.squareItemId || '', pieces: s.pieces, isCustom: false }] : [];
        const withPcs = (items || []).filter(it => it.pieces > 0);
        const totalPcs = withPcs.reduce((t, it) => t + it.pieces, 0);
        if (!totalPcs) return;
        withPcs.forEach(it => {
          const key = (it.squareId && !it.isCustom) ? it.squareId : 'custom:' + (it.name || '');
          const g = agg[key] = agg[key] || { hrs: 0, pcs: 0 };
          g.hrs += (s.netMin / 60) * (it.pieces / totalPcs);
          g.pcs += it.pieces;
        });
      });
      Object.keys(agg).forEach(k => { agg[k].minPerPc = agg[k].pcs ? (agg[k].hrs * 60 / agg[k].pcs) : null; });
      _dsnLabor = agg;
      return agg;
    })
    .catch(() => { if (_dsnLabor === null) _dsnLabor = {}; return _dsnLabor; });
}

// ── Retail prices: batch-retrieve linked Square variations ──
function _dsnLoadSqPrices(varIds) {
  const need = (varIds || []).filter(id => id && !(id in _dsnSqPrices));
  if (!need.length) return Promise.resolve(_dsnSqPrices);
  return fetch('/api/square', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/v2/catalog/batch-retrieve', method: 'POST', body: { object_ids: need } }),
  })
    .then(r => r.json())
    .then(data => {
      need.forEach(id => { if (!(id in _dsnSqPrices)) _dsnSqPrices[id] = null; });
      (data.objects || []).forEach(obj => {
        if (obj.type !== 'ITEM_VARIATION') return;
        const vd = obj.item_variation_data || {};
        _dsnSqPrices[obj.id] = vd.price_money ? vd.price_money.amount / 100 : null;
      });
      return _dsnSqPrices;
    })
    .catch(() => _dsnSqPrices);
}

// ── The rollup (spec §6) ──────────────────────
// d needs: bom, wasteOverridePct, squareItemId, retailPriceOverride,
// laborMinPerPieceOverride. Works for form snapshots and index entries.
function dsnCostRollup(d) {
  const matById = {};
  (_designsMaterials || []).forEach(m => { matById[m.notionPageId] = m; });

  const lines = [];
  let matCost = 0, matMissing = false;
  (d.bom || []).forEach(l => {
    const m = matById[l.materialId];
    if (!m || !(l.qty > 0)) { matMissing = true; return; }
    const isMetal = m.category === 'metal';
    const w = isMetal ? _dsnWastePctResolve(m, d.wasteOverridePct != null ? d.wasteOverridePct : null) : 0;
    const effQty = l.qty * (1 + w / 100);
    const unitCost = m.currentCostPerUnit;
    const cost = unitCost != null ? effQty * unitCost : null;
    if (cost == null) matMissing = true; else matCost += cost;
    lines.push({
      name: m.name, qty: l.qty, unit: _dsnUnitSuffix(m),
      wastePct: isMetal ? w : null, effQty, unitCost, cost,
    });
  });
  const hasBom = (d.bom || []).length > 0;

  const s = _shopSettings || {};
  const key = d.squareItemId || null;
  const tracked = (key && _dsnLabor && _dsnLabor[key]) ? _dsnLabor[key].minPerPc : null;
  const laborMin = d.laborMinPerPieceOverride != null ? d.laborMinPerPieceOverride : tracked;
  const laborSource = d.laborMinPerPieceOverride != null ? 'override' : (tracked != null ? 'tracked' : null);
  const rate = typeof s.shopHourlyRate === 'number' ? s.shopHourlyRate : null;
  const laborCost = (laborMin != null && rate != null) ? (laborMin / 60) * rate : null;

  const sqPrice = (key && _dsnSqPrices[key] != null) ? _dsnSqPrices[key] : null;
  const retail = d.retailPriceOverride != null ? d.retailPriceOverride : sqPrice;
  const retailSource = d.retailPriceOverride != null ? 'override' : (sqPrice != null ? 'square' : null);

  const pieceCost = (hasBom || laborCost != null) ? matCost + (laborCost || 0) : null;
  const margin = (retail > 0 && pieceCost != null) ? (retail - pieceCost) / retail : null;
  const target = typeof s.targetMarginPct === 'number' ? s.targetMarginPct : null;
  const suggested = (pieceCost != null && target != null && target < 100) ? pieceCost / (1 - target / 100) : null;

  return { lines, matCost, matMissing, hasBom, laborMin, laborSource, laborCost, rate,
           retail, retailSource, pieceCost, margin, suggested };
}

// ── Cost breakdown panel on the design form ──
function _dsnFormDesignSnapshot() {
  dsnBomSyncFromDom();
  const wasteRaw = (document.getElementById('dsn-waste') || {}).value;
  return {
    bom: _designsBom.filter(l => l.materialId && l.qty > 0),
    wasteOverridePct: (wasteRaw === '' || wasteRaw == null) ? null : parseFloat(wasteRaw),
    squareItemId: _dsnLinkedSq ? _dsnLinkedSq.id : null,
    retailPriceOverride:      _dsnNumOrNull((document.getElementById('dsn-retail-ov') || {}).value),
    laborMinPerPieceOverride: _dsnNumOrNull((document.getElementById('dsn-labor-ov')  || {}).value),
  };
}

const _dsnMoney = v => (v != null ? '$' + v.toFixed(2) : '—');

function dsnRollupRender() {
  const el = document.getElementById('dsn-rollup');
  if (!el || _designsView !== 'form') return;
  if (_designsMaterials === null) { el.innerHTML = '<div class="dsn-bom-note">Loading cost data…</div>'; return; }

  const r = dsnCostRollup(_dsnFormDesignSnapshot());
  if (!r.hasBom && r.laborCost == null) {
    el.innerHTML = '<div class="dsn-bom-note">⚖ Materials not yet weighed — add BOM lines above to see true piece cost.</div>';
    return;
  }

  const matRows = r.lines.map(l => {
    const wasteTxt = l.wastePct != null && l.wastePct > 0 ? ` <span class="dsn-ru-dim">+${l.wastePct}% waste → ${l.effQty.toFixed(2)}${l.unit}</span>` : '';
    return `<div class="dsn-ru-row"><span>${escHtml(l.name)} · ${l.qty}${l.unit}${wasteTxt}</span><span>${_dsnMoney(l.cost)}</span></div>`;
  }).join('');

  const laborNote = r.laborSource === 'tracked' ? ` <span class="dsn-ru-dim">(${r.laborMin.toFixed(1)} min/pc from timers)</span>`
    : r.laborSource === 'override' ? ` <span class="dsn-ru-dim">(${r.laborMin} min/pc, manual)</span>` : '';
  const laborVal = r.laborCost != null ? _dsnMoney(r.laborCost)
    : (r.rate == null ? 'set hourly rate' : 'no time data');
  const retailNote = r.retailSource === 'square' ? ' <span class="dsn-ru-dim">(Square)</span>'
    : r.retailSource === 'override' ? ' <span class="dsn-ru-dim">(manual)</span>' : '';
  const marginTxt = r.margin != null ? (r.margin * 100).toFixed(0) + '%' : '—';
  const floor = (_shopSettings || {}).marginFloorPct;
  const marginBad = r.margin != null && typeof floor === 'number' && r.margin * 100 < floor;

  el.innerHTML = '<div class="dsn-ru-box">'
    + matRows
    + (r.matMissing ? '<div class="dsn-bom-note">⚠ Some lines missing a material price — totals incomplete</div>' : '')
    + `<div class="dsn-ru-row dsn-ru-sub"><span>Materials</span><span>${_dsnMoney(r.matCost)}</span></div>`
    + `<div class="dsn-ru-row dsn-ru-sub"><span>Labor${laborNote}</span><span>${laborVal}</span></div>`
    + `<div class="dsn-ru-row dsn-ru-total"><span>Piece cost</span><span>${_dsnMoney(r.pieceCost)}</span></div>`
    + `<div class="dsn-ru-row"><span>Retail${retailNote}</span><span>${_dsnMoney(r.retail)}</span></div>`
    + `<div class="dsn-ru-row ${marginBad ? 'dsn-ru-bad' : ''}"><span>Margin${marginBad ? ' ⚠ below floor' : ''}</span><span>${marginTxt}</span></div>`
    + (r.suggested != null ? `<div class="dsn-ru-row dsn-ru-dim2"><span>Suggested @ ${(_shopSettings || {}).targetMarginPct}% target</span><span>${_dsnMoney(r.suggested)}</span></div>` : '')
    + '</div>';
}

// ── Square item link picker ───────────────────
function dsnSqLinkRender() {
  const linked = document.getElementById('dsn-sq-linked');
  const search = document.getElementById('dsn-sq-search-wrap');
  if (!linked || !search) return;
  if (_dsnLinkedSq) {
    linked.style.display = '';
    search.style.display = 'none';
    document.getElementById('dsn-sq-linked-name').textContent = _dsnLinkedSq.name;
  } else {
    linked.style.display = 'none';
    search.style.display = '';
    const inp = document.getElementById('dsn-sq-search');
    if (inp) inp.value = '';
    const res = document.getElementById('dsn-sq-results');
    if (res) res.style.display = 'none';
  }
}

function dsnSqSearchInput(q) {
  clearTimeout(_dsnSqSearchTimer);
  const res = document.getElementById('dsn-sq-results');
  if (!q || q.trim().length < 2) { if (res) res.style.display = 'none'; return; }
  _dsnSqSearchTimer = setTimeout(() => _dsnSqSearchRun(q.trim()), 350);
}

function _dsnSqSearchRun(q) {
  const res = document.getElementById('dsn-sq-results');
  if (!res) return;
  res.style.display = '';
  res.innerHTML = '<div class="dsn-sq-result dsn-ru-dim">Searching Square…</div>';
  fetch('/api/square', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/v2/catalog/search-catalog-items', method: 'POST', body: { text_filter: q, limit: 10 } }),
  })
    .then(r => r.json())
    .then(data => {
      const out = [];
      (data.items || []).forEach(item => {
        const nm = (item.item_data && item.item_data.name) || '';
        ((item.item_data && item.item_data.variations) || []).forEach(v => {
          const vd = v.item_variation_data || {};
          const label = nm + (vd.name && vd.name !== 'Regular' ? ' — ' + vd.name : '');
          const price = vd.price_money ? vd.price_money.amount / 100 : null;
          out.push({ id: v.id, label, price });
        });
      });
      if (!out.length) { res.innerHTML = '<div class="dsn-sq-result dsn-ru-dim">No Square items found</div>'; return; }
      res.innerHTML = out.map(o =>
        `<button type="button" class="dsn-sq-result" onclick="dsnSqLink('${o.id}','${escHtml(o.label).replace(/'/g, '&#39;')}',${o.price != null ? o.price : 'null'})">${escHtml(o.label)}${o.price != null ? ' <span class="dsn-ru-dim">$' + o.price.toFixed(2) + '</span>' : ''}</button>`
      ).join('');
    })
    .catch(() => { res.innerHTML = '<div class="dsn-sq-result dsn-ru-dim">Square search failed</div>'; });
}

function dsnSqLink(id, label, price) {
  _dsnLinkedSq = { id, name: label };
  if (price != null) _dsnSqPrices[id] = price;
  dsnSqLinkRender();
  _dsnLoadSqPrices([id]).then(dsnRollupRender);
  dsnRollupRender();
}

function dsnSqUnlink() {
  _dsnLinkedSq = null;
  dsnSqLinkRender();
  dsnRollupRender();
}

// ── Pricing Sheet view ─────────────────────────
function dsnPricingToggle() {
  _designsPricingOpen = !_designsPricingOpen;
  document.getElementById('designs-library').style.display = _designsPricingOpen ? 'none' : '';
  document.getElementById('designs-pricing').style.display = _designsPricingOpen ? '' : 'none';
  const btn = document.getElementById('dsn-pricing-btn');
  if (btn) btn.textContent = _designsPricingOpen ? '← Library' : '💲 Pricing Sheet';
  if (_designsPricingOpen) dsnPricingRender();
  else designsRenderLibrary();
}

function _dsnEnsureCostingData() {
  const p1 = (typeof _materialsApiFetch === 'function')
    ? _materialsApiFetch().then(ms => { _designsMaterials = ms.filter(m => m.active !== false); })
        .catch(() => { if (_designsMaterials === null) _designsMaterials = []; })
    : Promise.resolve();
  const p2 = fetch('/api/shop-settings').then(r => r.json())
    .then(s => { _shopSettings = (s && !s.error) ? s : {}; })
    .catch(() => { if (_shopSettings === null) _shopSettings = {}; });
  return Promise.all([p1, p2]);
}

async function dsnPricingRender(forceRefresh) {
  const body = document.getElementById('dsn-ps-body');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="7" class="oh-empty">Computing costs…</td></tr>';
  if (forceRefresh) { _dsnLabor = null; _dsnSqPrices = {}; }
  await _dsnEnsureCostingData();
  await _dsnLoadLabor(forceRefresh);
  await _dsnLoadSqPrices(_designs.map(d => d.squareItemId).filter(Boolean));

  const s = _shopSettings || {};
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v != null ? v : ''; };
  setVal('dsn-set-rate',   s.shopHourlyRate);
  setVal('dsn-set-target', s.targetMarginPct);
  setVal('dsn-set-floor',  s.marginFloorPct);

  const rows = _designs.map(d => ({ d, r: dsnCostRollup(d) }));
  const floor = typeof s.marginFloorPct === 'number' ? s.marginFloorPct : null;

  // Margin-erosion alert strip
  const alerts = rows.filter(x => floor != null && x.r.margin != null && x.r.margin * 100 < floor);
  const alertEl = document.getElementById('dsn-ps-alerts');
  if (alertEl) {
    alertEl.innerHTML = alerts.length
      ? `<div class="dsn-ps-alert">⚠ Below ${floor}% margin floor: `
        + alerts.map(x => `<strong>${escHtml(x.d.name || 'Untitled')}</strong> (${(x.r.margin * 100).toFixed(0)}%)`).join(' · ')
        + '</div>'
      : '';
  }

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="oh-empty">No designs yet.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(x => {
    const { d, r } = x;
    const bad = floor != null && r.margin != null && r.margin * 100 < floor;
    const marginTxt = r.margin != null ? (r.margin * 100).toFixed(0) + '%' : '—';
    const flags = [];
    if (!r.hasBom) flags.push('⚖ not weighed');
    if (r.matMissing) flags.push('missing price');
    if (r.laborCost == null) flags.push('no labor data');
    return `<tr class="${bad ? 'dsn-ps-bad' : ''}" onclick="designsShowForm('${d.id}')" style="cursor:pointer">`
      + `<td>${escHtml(d.name || 'Untitled')}</td>`
      + `<td>${r.hasBom ? _dsnMoney(r.matCost) : '—'}</td>`
      + `<td>${_dsnMoney(r.laborCost)}</td>`
      + `<td>${_dsnMoney(r.pieceCost)}</td>`
      + `<td>${_dsnMoney(r.retail)}</td>`
      + `<td>${marginTxt}${bad ? ' ⚠' : ''}</td>`
      + `<td class="dsn-ru-dim">${r.suggested != null ? _dsnMoney(r.suggested) : ''}${flags.length ? (r.suggested != null ? ' · ' : '') + flags.join(' · ') : ''}</td>`
      + '</tr>';
  }).join('');
}

async function dsnPricingSettingsSave() {
  const s = Object.assign({}, _shopSettings || {});
  s.shopHourlyRate  = _dsnNumOrNull(document.getElementById('dsn-set-rate').value);
  s.targetMarginPct = _dsnNumOrNull(document.getElementById('dsn-set-target').value);
  s.marginFloorPct  = _dsnNumOrNull(document.getElementById('dsn-set-floor').value);
  try {
    const r = await fetch('/api/shop-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    _shopSettings = s;
    toast('Pricing settings saved', '✓');
    dsnPricingRender();
  } catch (e) {
    toast('Save failed — ' + (e.message || e), '❌');
  }
}

function dsnPricingExport() {
  const rows = _designs.map(d => ({ d, r: dsnCostRollup(d) }));
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const money = v => (v != null ? v.toFixed(2) : '');
  const csv = [
    ['Design', 'Category', 'Material Cost', 'Labor Cost', 'Piece Cost', 'Retail', 'Margin %', 'Suggested Price', 'Flags'].map(esc).join(','),
  ].concat(rows.map(({ d, r }) => [
    d.name || 'Untitled', d.category || '',
    r.hasBom ? money(r.matCost) : '', money(r.laborCost), money(r.pieceCost), money(r.retail),
    r.margin != null ? (r.margin * 100).toFixed(1) : '',
    money(r.suggested),
    [!r.hasBom ? 'not weighed' : '', r.matMissing ? 'missing material price' : '', r.laborCost == null ? 'no labor data' : ''].filter(Boolean).join('; '),
  ].map(esc).join(','))).join('\n');

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'pricing-sheet-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
