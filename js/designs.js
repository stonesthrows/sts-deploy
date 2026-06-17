// ════════════════════════════════════════════
//  DESIGNS  —  js/designs.js
//  Jewelry design specs & instructions library
// ════════════════════════════════════════════

const DESIGNS_KEY = 'sts-designs';
const DESIGNS_CATS = ['Ear Cuffs', 'Rings', 'Earrings', 'Pendants / Necklaces', 'Other'];

let _designs = [];
let _designsEditId = null;     // null = new, string = editing
let _designsView = 'library';  // 'library' | 'form'
let _designsCatFilter = 'all';
let _designsImgQueue = [];     // base64 strings staged before save

// ── Storage ──────────────────────────────────
function designsLoad() {
  try {
    _designs = JSON.parse(localStorage.getItem(DESIGNS_KEY) || '[]');
  } catch(e) { _designs = []; }
}

function designsSave() {
  try {
    localStorage.setItem(DESIGNS_KEY, JSON.stringify(_designs));
  } catch(e) {
    toast('Storage full — try removing some images', '⚠');
  }
}

// ── Init (fired by TAB_HOOKS) ─────────────────
function designsInit() {
  designsLoad();
  designsShowLibrary();
}

// ── View switching ────────────────────────────
function designsShowLibrary() {
  _designsView = 'library';
  _designsEditId = null;
  _designsImgQueue = [];
  document.getElementById('designs-library').style.display = '';
  document.getElementById('designs-form-wrap').style.display = 'none';
  designsRenderLibrary();
}

function designsShowForm(id) {
  _designsView = 'form';
  _designsEditId = id || null;
  _designsImgQueue = [];
  document.getElementById('designs-library').style.display = 'none';
  document.getElementById('designs-form-wrap').style.display = '';
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
    const thumb = d.images && d.images[0]
      ? `<div class="dsn-card-thumb" style="background-image:url('${d.images[0]}')"></div>`
      : `<div class="dsn-card-thumb dsn-card-thumb-empty"><span style="font-size:22px">💎</span></div>`;
    const imgCount = (d.images || []).length;
    const imgBadge = imgCount > 1 ? `<span class="dsn-img-badge">+${imgCount - 1}</span>` : '';
    const cat = d.category || 'Uncategorized';
    const preview = (d.specs || d.instructions || '').slice(0, 90).replace(/\n/g, ' ') || 'No details';
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
  const design = _designsEditId ? _designs.find(d => d.id === _designsEditId) : null;
  const isEdit = !!design;

  // Pre-populate fields
  document.getElementById('dsn-name').value = design ? (design.name || '') : '';
  document.getElementById('dsn-cat').value  = design ? (design.category || '') : '';
  document.getElementById('dsn-specs').value = design ? (design.specs || '') : '';
  document.getElementById('dsn-instructions').value = design ? (design.instructions || '') : '';

  // Images
  _designsImgQueue = design ? [...(design.images || [])] : [];
  designsRenderImagePreviews();

  // Title + delete btn
  document.getElementById('dsn-form-title').textContent = isEdit ? '✏️ Edit Design' : '✚ New Design';
  const delBtn = document.getElementById('dsn-delete-btn');
  if (delBtn) delBtn.style.display = isEdit ? '' : 'none';

  // Clear PDF status
  document.getElementById('dsn-pdf-status').textContent = '';
}

function designsRenderImagePreviews() {
  const wrap = document.getElementById('dsn-img-previews');
  if (!wrap) return;
  if (_designsImgQueue.length === 0) {
    wrap.innerHTML = '<span style="color:var(--text3);font-size:12px">No images yet</span>';
    return;
  }
  wrap.innerHTML = _designsImgQueue.map((src, i) => `
    <div class="dsn-thumb-wrap">
      <img src="${src}" class="dsn-thumb" alt="Design image ${i+1}" onclick="designsViewImage(${i})">
      <button class="dsn-thumb-del" onclick="designsRemoveImage(${i})" title="Remove image">×</button>
    </div>`).join('');
}

function designsRemoveImage(idx) {
  _designsImgQueue.splice(idx, 1);
  designsRenderImagePreviews();
}

function designsViewImage(idx) {
  const src = _designsImgQueue[idx];
  if (!src) return;
  const overlay = document.getElementById('dsn-img-overlay');
  const img = document.getElementById('dsn-img-overlay-img');
  img.src = src;
  overlay.style.display = 'flex';
}

function designsCloseImageOverlay() {
  document.getElementById('dsn-img-overlay').style.display = 'none';
  document.getElementById('dsn-img-overlay-img').src = '';
}

// ── Save / Delete ─────────────────────────────
function designsSaveDesign() {
  const name = document.getElementById('dsn-name').value.trim();
  if (!name) { toast('Please enter a design name', '⚠'); return; }

  const now = new Date().toISOString();
  if (_designsEditId) {
    const idx = _designs.findIndex(d => d.id === _designsEditId);
    if (idx !== -1) {
      _designs[idx] = {
        ..._designs[idx],
        name,
        category: document.getElementById('dsn-cat').value,
        specs: document.getElementById('dsn-specs').value.trim(),
        instructions: document.getElementById('dsn-instructions').value.trim(),
        images: [..._designsImgQueue],
        updatedAt: now,
      };
    }
    toast('Design updated', '✓');
  } else {
    _designs.unshift({
      id: 'dsn-' + Date.now(),
      name,
      category: document.getElementById('dsn-cat').value,
      specs: document.getElementById('dsn-specs').value.trim(),
      instructions: document.getElementById('dsn-instructions').value.trim(),
      images: [..._designsImgQueue],
      createdAt: now,
      updatedAt: now,
    });
    toast('Design saved', '✓');
  }
  designsSave();
  designsShowLibrary();
}

function designsDeleteDesign() {
  if (!_designsEditId) return;
  const d = _designs.find(x => x.id === _designsEditId);
  if (!d) return;
  if (!confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
  _designs = _designs.filter(x => x.id !== _designsEditId);
  designsSave();
  toast('Design deleted', '🗑');
  designsShowLibrary();
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
      // Resize to max 1200px wide to keep storage manageable
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_W = 1200;
        const scale = img.width > MAX_W ? MAX_W / img.width : 1;
        canvas.width = Math.round(img.width * scale);
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

// ── PDF upload & text extraction ──────────────
function designsHandlePDF(file) {
  if (!file || file.type !== 'application/pdf') {
    toast('Please upload a PDF file', '⚠');
    return;
  }
  const status = document.getElementById('dsn-pdf-status');
  status.textContent = '⏳ Reading PDF…';

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const lib = window.pdfjsLib;
      if (!lib) { status.textContent = '❌ PDF reader not loaded'; return; }

      const pdf = await lib.getDocument({ data: new Uint8Array(e.target.result) }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(item => item.str).join(' ') + '\n\n';
      }

      _designsPrefillFromText(fullText, file.name);
      status.textContent = `✓ Extracted text from ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''} — review and edit below`;
      status.style.color = 'var(--accent)';
    } catch(err) {
      status.textContent = '❌ Could not read PDF: ' + (err.message || err);
      status.style.color = '#c0392b';
    }
  };
  reader.readAsArrayBuffer(file);
}

function _designsPrefillFromText(text, filename) {
  // Try to extract a title from the first line or filename
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const titleLine = lines[0] || '';

  // Only pre-fill name if currently blank
  const nameEl = document.getElementById('dsn-name');
  if (!nameEl.value.trim()) {
    const guessedName = titleLine.length < 80 ? titleLine
      : filename.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ');
    nameEl.value = guessedName;
  }

  // Split text into specs vs instructions heuristically:
  // Lines that look like bullet points / numbered steps → instructions
  // Short spec-like lines (gauges, mm sizes, materials) → specs
  const specKeywords = /\d+\s*(ga|gauge|mm|gram|g\b|inch|")/i;
  const instrKeywords = /^(\d+[\.\)]\s|•|-|fuse|solder|cut|wrap|use|place|apply|twist|bend|shape|join)/i;

  const specsLines = [], instrLines = [], remainLines = [];
  let seenSpecHeader = false;

  lines.forEach((line, i) => {
    if (i === 0) return; // skip title line
    if (/SPECIFICATIONS?/i.test(line)) { seenSpecHeader = true; return; }
    if (instrKeywords.test(line)) {
      instrLines.push(line);
    } else if (seenSpecHeader && i < 8) {
      specsLines.push(line);
    } else if (specKeywords.test(line)) {
      specsLines.push(line);
    } else {
      remainLines.push(line);
    }
  });

  // Dump everything into specs if we couldn't separate it
  const specsEl = document.getElementById('dsn-specs');
  if (!specsEl.value.trim()) {
    specsEl.value = specsLines.length
      ? specsLines.join('\n')
      : remainLines.slice(0, 10).join('\n');
  }

  const instrEl = document.getElementById('dsn-instructions');
  if (!instrEl.value.trim()) {
    instrEl.value = instrLines.join('\n');
  }
}

// ── Utility ───────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
