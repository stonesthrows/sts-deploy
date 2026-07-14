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

  const wireByMetal = { 'wire-silver': ['argentium', 'sterling'], 'wire-gf': ['gold_fill'], 'wire-14k': ['14k'] };
  const filtered = _materialsCatFilter === 'all'
    ? _materials
    : wireByMetal[_materialsCatFilter]
      ? _materials.filter(m => m.category === 'metal' && m.form === 'wire' && wireByMetal[_materialsCatFilter].includes(m.metalType))
      : (_materialsCatFilter === 'wire' || _materialsCatFilter === 'sheet')
        ? _materials.filter(m => m.category === 'metal' && m.form === _materialsCatFilter)
        : _materials.filter(m => m.category === _materialsCatFilter);

  document.getElementById('materials-stat-total').textContent    = _materials.length;
  document.getElementById('materials-stat-wire').textContent     = _materials.filter(m => m.category === 'metal' && m.form === 'wire').length;
  document.getElementById('materials-stat-sheet').textContent    = _materials.filter(m => m.category === 'metal' && m.form === 'sheet').length;
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
  // Imported/Notion-side suppliers may not be in the fixed option list —
  // add them so the select can show (and re-save) the stored value.
  const supSel = document.getElementById('matSupplier');
  if (m.supplierDefault && ![...supSel.options].some(o => o.value === m.supplierDefault)) {
    supSel.add(new Option(m.supplierDefault, m.supplierDefault));
  }
  supSel.value = m.supplierDefault || '';
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

// ── Import from Order History ───────────────────
// Scans supplier Order History line items in the Materials tax category,
// groups repeat purchases of the same description, and offers them as
// review-and-confirm candidates. Historical lines only carry a line TOTAL
// (no qty / per-unit cost), so cost is left for the user to type and stock
// starts unknown ('estimated'); the first Receive Shipment fills both.
let _matImpCands = [];

const _MAT_IMP_UNIT_BY_CAT = { metal: 'ozt', chain: 'foot', component: 'piece' };

function _matImpGuessCat(desc) {
  const l = (desc || '').toLowerCase();
  if (/chain/.test(l)) return 'chain';
  if (/wire|sheet|ingot|casting|grain|shot|granule|solder/.test(l)) return 'metal';
  return 'component';
}

// Metal-only spec fields, guessed from the (possibly user-edited) name at
// import time. Editable afterwards in the normal edit modal.
function _matImpMetalSpec(name) {
  const l = (name || '').toLowerCase();
  const ga = l.match(/(\d{1,2})\s*-?\s*ga/);
  return {
    metalType: /argentium|sterling|\bsilver\b/.test(l) ? 'argentium'
      : /gold[\s-]?fill|14\/20/.test(l) ? 'gold_fill'
      : /14\s*kt?\b/.test(l) ? '14k' : '',
    form: /sheet/.test(l) ? 'sheet' : /wire/.test(l) ? 'wire' : '',
    gauge: ga ? ga[1] + 'ga' : '',
  };
}

function _matImpNorm(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function materialsImportOpen() {
  _matImpCands = [];
  document.getElementById('matImpList').innerHTML = '';
  document.getElementById('matImpStatus').textContent = 'Scanning order history…';
  const saveBtn = document.getElementById('matImpSaveBtn');
  saveBtn.disabled = false;
  saveBtn.textContent = 'Import Selected';
  document.getElementById('materialsImportModalBg').classList.add('open');

  let orders = null;
  try { orders = await fetch('/api/notion-orders').then(r => r.json()); } catch (e) { /* fall back to cache */ }
  if (!Array.isArray(orders)) {
    try { orders = JSON.parse(localStorage.getItem(typeof OH_KEY !== 'undefined' ? OH_KEY : 'sot_history_v1')); } catch (e) { /* no cache */ }
  }
  if (!Array.isArray(orders) || !orders.length) {
    document.getElementById('matImpStatus').textContent = 'No order history found — add supplier orders (or run Receive Shipment) first.';
    return;
  }
  if (!_materials.length) {
    try { _materials = await _materialsApiFetch(); } catch (e) { /* name-dedupe just won't apply */ }
  }
  const existing = new Set(_materials.map(m => _matImpNorm(m.name)));

  const byKey = {};
  orders.forEach(o => {
    (o.lineItems || []).forEach(li => {
      if (li.category !== 'Materials') return;
      if (li.materialId) return; // already linked to a library material
      const key = _matImpNorm(li.desc);
      if (!key || existing.has(key)) return;
      const c = byKey[key] = byKey[key] || { name: (li.desc || '').trim(), sup: '', count: 0, lastDate: '', lastAmt: null };
      c.count++;
      if ((o.date || '') >= c.lastDate) {
        c.lastDate = o.date || '';
        c.sup = o.sup || '';
        c.lastAmt = li.amt != null ? parseFloat(li.amt) : c.lastAmt;
      }
    });
  });

  _matImpCands = Object.values(byKey).sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
  if (!_matImpCands.length) {
    document.getElementById('matImpStatus').textContent = 'Nothing to import — every Materials line item is already in the library or linked to it.';
    return;
  }
  _matImpRender();
}

// Rows are built via DOM APIs (not innerHTML value="…") because receipt
// descriptions routinely contain double quotes (6" Sheet).
function _matImpRender() {
  const status = document.getElementById('matImpStatus');
  status.innerHTML = '';
  status.append(`${_matImpCands.length} item${_matImpCands.length === 1 ? '' : 's'} found in Materials line items — un-check what you don't want, fix names/categories, add cost per unit if known. `);
  const all = document.createElement('a');
  all.href = '#'; all.textContent = 'Select all';
  all.onclick = () => { materialsImportToggleAll(true); return false; };
  const none = document.createElement('a');
  none.href = '#'; none.textContent = 'none';
  none.onclick = () => { materialsImportToggleAll(false); return false; };
  status.append(all, ' · ', none);

  const list = document.getElementById('matImpList');
  list.innerHTML = '';
  _matImpCands.forEach((c, i) => {
    const cat = _matImpGuessCat(c.name);
    const row = document.createElement('div');
    row.className = 'mat-imp-row';
    row.dataset.i = i;
    row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:7px 0;border-bottom:1px solid rgba(128,128,128,.2);';

    const sel = document.createElement('input');
    sel.type = 'checkbox'; sel.checked = true; sel.className = 'mi-sel';
    sel.style.cssText = 'width:auto;margin:0;';

    const name = document.createElement('input');
    name.type = 'text'; name.className = 'mi-name'; name.value = c.name;
    name.style.cssText = 'flex:2;min-width:220px;';

    const catSel = document.createElement('select');
    catSel.className = 'mi-cat';
    [['metal', 'Metal'], ['chain', 'Chain'], ['component', 'Component']].forEach(([v, l]) => catSel.add(new Option(l, v)));
    catSel.value = cat;

    const unitSel = document.createElement('select');
    unitSel.className = 'mi-unit';
    [['gram', 'Gram'], ['ozt', 'Troy Oz'], ['foot', 'Foot'], ['piece', 'Piece']].forEach(([v, l]) => unitSel.add(new Option(l, v)));
    unitSel.value = _MAT_IMP_UNIT_BY_CAT[cat];
    catSel.onchange = () => { unitSel.value = _MAT_IMP_UNIT_BY_CAT[catSel.value]; };

    const cost = document.createElement('input');
    cost.type = 'number'; cost.className = 'mi-cost';
    cost.step = '0.01'; cost.min = '0'; cost.placeholder = '$/unit';
    cost.style.cssText = 'width:84px;';

    const meta = document.createElement('div');
    meta.className = 'mi-meta';
    meta.style.cssText = 'flex-basis:100%;font-size:11px;color:var(--text-dim);padding-left:24px;';
    meta.textContent = [
      c.sup || 'Unknown supplier',
      `${c.count} purchase${c.count === 1 ? '' : 's'}`,
      c.lastAmt != null ? `last line total $${c.lastAmt.toFixed(2)}${c.lastDate ? ' on ' + c.lastDate : ''}` : '',
    ].filter(Boolean).join(' · ');

    row.append(sel, name, catSel, unitSel, cost, meta);
    list.appendChild(row);
  });
}

function materialsImportToggleAll(on) {
  document.querySelectorAll('#matImpList .mi-sel').forEach(cb => { cb.checked = on; });
}

function materialsImportClose(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('materialsImportModalBg').classList.remove('open');
}

async function materialsImportSave() {
  const picked = [];
  document.querySelectorAll('#matImpList .mat-imp-row').forEach(row => {
    if (!row.querySelector('.mi-sel').checked) return;
    const name = row.querySelector('.mi-name').value.trim();
    if (!name) return;
    const category = row.querySelector('.mi-cat').value;
    const costVal = row.querySelector('.mi-cost').value;
    picked.push({
      name,
      category,
      ...(category === 'metal' ? _matImpMetalSpec(name) : { metalType: '', form: '', gauge: '' }),
      unit: row.querySelector('.mi-unit').value,
      currentCostPerUnit: costVal === '' ? null : Number(costVal),
      stockLevel: null,
      stockConfidence: 'estimated',
      supplierDefault: _matImpCands[row.dataset.i].sup || '',
      active: true,
    });
  });
  if (!picked.length) { toast('Nothing selected to import', '⚠'); return; }

  const btn = document.getElementById('matImpSaveBtn');
  btn.disabled = true;
  let ok = 0, failed = 0;
  for (const m of picked) {
    btn.textContent = `Importing ${ok + failed + 1}/${picked.length}…`;
    try { await _materialsApiSave(m); ok++; } catch (e) { failed++; }
  }
  btn.disabled = false;
  btn.textContent = 'Import Selected';
  if (failed) {
    toast(`${ok} imported, ${failed} failed — re-open to retry the rest`, '⚠');
  } else {
    toast(`${ok} material${ok === 1 ? '' : 's'} imported`, '✓');
  }
  document.getElementById('materialsImportModalBg').classList.remove('open');
  await materialsInit();
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
