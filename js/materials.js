// ════════════════════════════════════════════
//  MATERIALS LIBRARY  —  js/materials.js
//  Phase 1 of the costing/inventory/replenishment build.
//  Source of truth: Notion (see functions/api/materials.js).
// ════════════════════════════════════════════

let _materials       = [];
let _materialsCatFilter = 'all';
let _materialsEditId = null; // null = new, notionPageId = editing existing
let _materialsPurchases = null; // materialId -> [{date, cost}] asc, from Order History

// Unit → display abbreviation. Shared by every module that renders
// material quantities (designs, receiving, replenish, closeout) —
// materials.js loads before all of them.
function matUnitAbbr(unit) {
  return unit === 'gram' ? 'g' : unit === 'ozt' ? 'ozt' : unit === 'foot' ? 'ft' : 'pc';
}

// ── API helpers ────────────────────────────────
async function _materialsApiFetch() {
  const resp = await fetch('/api/materials');
  if (!resp.ok) throw new Error(`Load failed (${resp.status})`);
  return resp.json();
}

async function _materialsApiSave(material) {
  const resp = await fetch('/api/materials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(material),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Save failed (${resp.status})`);
  }
  return resp.json();
}

async function _materialsApiDelete(pageId) {
  const resp = await fetch(`/api/materials?pageId=${encodeURIComponent(pageId)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(`Delete failed (${resp.status})`);
}

// ── Init (fired by TAB_HOOKS) ──────────────────
async function materialsInit() {
  const body = document.getElementById('materialsTableBody');
  if (body) body.innerHTML = '<tr><td colspan="9" class="oh-empty">Loading materials…</td></tr>';
  try {
    _materials = await _materialsApiFetch();
  } catch (e) {
    _materials = [];
    if (body) body.innerHTML = `<tr><td colspan="9" class="oh-empty">Could not load materials — ${escHtml(e.message || e)}</td></tr>`;
    return;
  }
  materialsRender();
  _materialsLoadPurchases();
}

// ── Purchase history (price-trend sparklines) ──
// Material-linked purchases live inside Order History line items
// ({materialId, qty, unitCost} — written by the Receive Shipment flow).
// Fast path renders from supplier-history's localStorage cache; a fresh
// fetch re-renders when it lands.
function _materialsBuildPurchaseMap(orders) {
  const map = {};
  (orders || []).forEach(o => {
    (o.lineItems || []).forEach(li => {
      if (!li.materialId || li.unitCost == null) return;
      (map[li.materialId] = map[li.materialId] || []).push({ date: o.date || '', cost: parseFloat(li.unitCost) });
    });
  });
  Object.keys(map).forEach(k => map[k].sort((a, b) => (a.date < b.date ? -1 : 1)));
  return map;
}

function _materialsLoadPurchases() {
  try {
    const raw = localStorage.getItem(typeof OH_KEY !== 'undefined' ? OH_KEY : 'sot_history_v1');
    if (raw) { _materialsPurchases = _materialsBuildPurchaseMap(JSON.parse(raw)); materialsRender(); }
  } catch (e) { /* cache miss is fine — fetch below */ }
  fetch('/api/notion-orders')
    .then(r => r.json())
    .then(orders => {
      if (!Array.isArray(orders)) return;
      _materialsPurchases = _materialsBuildPurchaseMap(orders);
      materialsRender();
    })
    .catch(() => {});
}

// Last 6 purchase unit costs as a tiny inline line — single series, no
// axes, values available via the <title> tooltip / aria-label.
function materialsSparkline(m) {
  const hist = (_materialsPurchases && _materialsPurchases[m.notionPageId]) || [];
  const pts = hist.slice(-6).map(h => h.cost).filter(c => !isNaN(c));
  if (pts.length < 2) return '<span class="oh-na">—</span>';
  const w = 64, h = 20, pad = 3;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = (max - min) || 1;
  const step = (w - pad * 2) / (pts.length - 1);
  const coords = pts.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - 2 * pad)]);
  const poly = coords.map(c => c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
  const last = coords[coords.length - 1];
  const unit = '/' + matUnitAbbr(m.unit);
  const title = pts.length + ' purchases: $' + pts[0].toFixed(2) + ' → $' + pts[pts.length - 1].toFixed(2) + unit;
  return '<svg class="mat-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + escHtml(title) + '">'
    + '<title>' + escHtml(title) + '</title>'
    + '<polyline points="' + poly + '" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.5"/>'
    + '</svg>';
}

// ── Phase 4 hook ────────────────────────────────
// Fired by the Receive Shipment flow after material prices change.
// Cost rollups (Phase 4) will recompute here; today it refreshes the
// purchase history feeding the sparklines.
function materialsPricesChanged(materialIds) {
  _materialsLoadPurchases();
}

// ── Filter ──────────────────────────────────────
function materialsSetCatFilter(cat) {
  _materialsCatFilter = cat;
  document.querySelectorAll('#materialsFilterBar .oh-fbtn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
  });
  materialsRender();
}

// ── Render ──────────────────────────────────────
function materialsRender() {
  const body = document.getElementById('materialsTableBody');
  if (!body) return;

  const filtered = _materialsCatFilter === 'all'
    ? _materials
    : _materials.filter(m => m.category === _materialsCatFilter);

  document.getElementById('materials-stat-total').textContent    = _materials.length;
  document.getElementById('materials-stat-metals').textContent   = _materials.filter(m => m.category === 'metal').length;
  document.getElementById('materials-stat-chains').textContent   = _materials.filter(m => m.category === 'chain').length;
  document.getElementById('materials-stat-components').textContent = _materials.filter(m => m.category === 'component').length;
  document.getElementById('materials-stat-unweighed').textContent = _materials.filter(m => m.stockConfidence === 'estimated').length;

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="9" class="oh-empty">No materials yet — click + Add Material to seed the library.</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(m => {
    const spec = m.category === 'metal'
      ? [m.metalType, m.form, m.gauge].filter(Boolean).join(' · ')
      : '—';
    const cost = m.currentCostPerUnit != null ? `$${Number(m.currentCostPerUnit).toFixed(2)}` : '—';
    const stock = m.stockLevel != null ? `${m.stockLevel} ${matUnitAbbr(m.unit)}` : '—';
    const confClass = m.stockConfidence ? `mat-conf mat-conf-${m.stockConfidence}` : 'mat-conf';
    return `
      <tr class="${m.active === false ? 'mat-inactive' : ''}" onclick="materialsOpenEdit('${m.notionPageId}')">
        <td>${escHtml(m.name || 'Untitled')}</td>
        <td>${escHtml(m.category || '—')}</td>
        <td>${escHtml(spec)}</td>
        <td>${escHtml(m.unit || '—')}</td>
        <td>${cost}</td>
        <td>${materialsSparkline(m)}</td>
        <td>${stock}</td>
        <td><span class="${confClass}">${escHtml(m.stockConfidence || '—')}</span></td>
        <td>${escHtml(m.supplierDefault || '—')}</td>
      </tr>`;
  }).join('');
}

// ── Modal open/close ────────────────────────────
function materialsOpenNew() {
  _materialsEditId = null;
  document.getElementById('materialsModalTitle').textContent = 'Add Material';
  document.getElementById('matName').value = '';
  document.getElementById('matCategory').value = 'metal';
  document.getElementById('matMetalType').value = '';
  document.getElementById('matForm').value = '';
  document.getElementById('matGauge').value = '';
  document.getElementById('matUnit').value = 'gram';
  document.getElementById('matCost').value = '';
  document.getElementById('matStock').value = '0';
  document.getElementById('matConfidence').value = 'estimated';
  document.getElementById('matSupplier').value = '';
  document.getElementById('matActive').checked = true;
  document.getElementById('materialsModalDelete').style.display = 'none';
  materialsToggleMetalFields();
  document.getElementById('materialsModalBg').classList.add('open');
}

function materialsOpenEdit(id) {
  const m = _materials.find(x => x.notionPageId === id);
  if (!m) return;
  _materialsEditId = id;
  document.getElementById('materialsModalTitle').textContent = 'Edit Material';
  document.getElementById('matName').value = m.name || '';
  document.getElementById('matCategory').value = m.category || 'metal';
  document.getElementById('matMetalType').value = m.metalType || '';
  document.getElementById('matForm').value = m.form || '';
  document.getElementById('matGauge').value = m.gauge || '';
  document.getElementById('matUnit').value = m.unit || 'gram';
  document.getElementById('matCost').value = m.currentCostPerUnit ?? '';
  document.getElementById('matStock').value = m.stockLevel ?? '';
  document.getElementById('matConfidence').value = m.stockConfidence || 'estimated';
  document.getElementById('matSupplier').value = m.supplierDefault || '';
  document.getElementById('matActive').checked = m.active !== false;
  document.getElementById('materialsModalDelete').style.display = '';
  materialsToggleMetalFields();
  document.getElementById('materialsModalBg').classList.add('open');
}

function materialsModalClose(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('materialsModalBg').classList.remove('open');
}

// Metal-only fields (Metal Type / Form / Gauge) only make sense for category=metal
function materialsToggleMetalFields() {
  const isMetal = document.getElementById('matCategory').value === 'metal';
  document.getElementById('matMetalFieldsRow').style.display = isMetal ? '' : 'none';
}

// ── Save / Delete ───────────────────────────────
async function materialsSave() {
  const name = document.getElementById('matName').value.trim();
  const category = document.getElementById('matCategory').value;
  const unit = document.getElementById('matUnit').value;
  if (!name) { toast('Please enter a material name', '⚠'); return; }
  if (!category) { toast('Please choose a category', '⚠'); return; }
  if (!unit) { toast('Please choose a unit', '⚠'); return; }

  const isMetal = category === 'metal';
  const material = {
    notionPageId:       _materialsEditId || undefined,
    name,
    category,
    metalType:          isMetal ? document.getElementById('matMetalType').value : '',
    form:               isMetal ? document.getElementById('matForm').value : '',
    gauge:              isMetal ? document.getElementById('matGauge').value.trim() : '',
    unit,
    currentCostPerUnit: document.getElementById('matCost').value === '' ? null : Number(document.getElementById('matCost').value),
    stockLevel:         document.getElementById('matStock').value === '' ? null : Number(document.getElementById('matStock').value),
    stockConfidence:    document.getElementById('matConfidence').value,
    supplierDefault:    document.getElementById('matSupplier').value,
    active:             document.getElementById('matActive').checked,
  };

  try {
    await _materialsApiSave(material);
    toast(_materialsEditId ? 'Material updated' : 'Material added', '✓');
    document.getElementById('materialsModalBg').classList.remove('open');
    await materialsInit();
  } catch (e) {
    toast('Save failed — ' + (e.message || e), '❌');
  }
}

async function materialsDelete() {
  if (!_materialsEditId) return;
  const m = _materials.find(x => x.notionPageId === _materialsEditId);
  if (!confirm(`Delete "${(m && m.name) || 'this material'}"? This cannot be undone.`)) return;
  try {
    await _materialsApiDelete(_materialsEditId);
    toast('Material deleted', '🗑');
    document.getElementById('materialsModalBg').classList.remove('open');
    await materialsInit();
  } catch (e) {
    toast('Delete failed — ' + (e.message || e), '❌');
  }
}
