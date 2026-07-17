// ════════════════════════════════════════════
//  BLUE GENIE TAB  —  js/bgab.js
//  BGAB event inventory — completely independent of Square counts
// ════════════════════════════════════════════

const BGAB_API = '/api/notion-bgab';

// ── State ─────────────────────────────────────────────────────────────────────
let _bgabEvents       = [];          // cached event list (no data payload)
let _bgabCurrentEvent = null;        // { notionPageId, name, type, year, items }
let _bgabView         = 'packing';   // 'packing' | 'results'
let _bgabDirty        = {};          // { varId: { brought, sold } }
let _bgabShowZero     = false;
let _bgabLoaded       = false;

// Import panel state
let _bgabImpMain    = 'earrings';    // 'earrings' | 'rings' | 'pendants'
let _bgabImpSub     = 'ear-cuffs';
let _bgabImpData    = {};            // { [sub]: [squareItem, ...] }
let _bgabImpChecked = {};            // { squareId: { item, sub } | { alreadyAdded: true } }

// ── Sub-tab metadata ──────────────────────────────────────────────────────────
const _BGAB_EAR_SUBS     = ['ear-cuffs','dangle','studs','hoops','spirit'];
const _BGAB_RING_SUBS    = ['stackable','ring-spirit','geometric','symbolic'];
const _BGAB_PENDANT_SUBS = ['p-spirit','p-geometric','p-symbolic'];

const _BGAB_SUB_LABELS = {
  'ear-cuffs':'Ear Cuffs', 'dangle':'Dangle', 'studs':'Studs', 'hoops':'Hoops', 'spirit':'Spirit',
  'stackable':'Stackable', 'ring-spirit':'Spirit', 'geometric':'Geometric',
  'symbolic':'Symbolic',
  'p-spirit':'Spirit', 'p-geometric':'Geometric', 'p-symbolic':'Symbolic',
};

// ══════════════════════════════════════════════════════════════════════════════
//  INIT + EVENT LIST
// ══════════════════════════════════════════════════════════════════════════════

async function bgabInit() {
  if (_bgabLoaded) { bgabRenderList(); return; }
  document.getElementById('bgab-event-list').innerHTML =
    '<div style="padding:32px;text-align:center;color:var(--text-dim)">Loading…</div>';
  try {
    const r = await fetch(BGAB_API);
    if (!r.ok) throw new Error(await r.text());
    _bgabEvents = await r.json();
    _bgabLoaded = true;
  } catch (e) {
    document.getElementById('bgab-event-list').innerHTML =
      `<div style="padding:32px;text-align:center;color:#dc2626;">⚠ ${_esc(e.message)}</div>`;
    return;
  }
  bgabRenderList();
}

function bgabRenderList() {
  _bgabShowListView();
  const el = document.getElementById('bgab-event-list');
  if (!_bgabEvents.length) {
    el.innerHTML = '<div style="padding:48px 24px;text-align:center;color:var(--text-dim);font-size:14px;">No events yet — tap ＋ New Event to get started.</div>';
    return;
  }
  el.innerHTML = _bgabEvents.map(ev => {
    const badge = ev.type === 'May Market'
      ? '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">May Market</span>'
      : '<span style="background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">Art Bazaar</span>';
    return `
    <div class="bgab-event-card" onclick="bgabOpenEvent('${ev.notionPageId}')">
      <div style="display:flex;align-items:center;gap:10px;">
        ${badge}
        <span class="bgab-event-name">${_esc(ev.name)}</span>
      </div>
      <span style="color:var(--text-dim);font-size:18px;">›</span>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
//  EVENT DETAIL
// ══════════════════════════════════════════════════════════════════════════════

async function bgabOpenEvent(notionPageId) {
  _bgabShowDetailLoading();
  try {
    const r = await fetch(`${BGAB_API}?id=${notionPageId}`);
    if (!r.ok) throw new Error(await r.text());
    const ev = await r.json();
    _bgabCurrentEvent = {
      notionPageId: ev.notionPageId,
      name: ev.name,
      type: ev.type,
      year: ev.year,
      items: ev.data?.items || [],
    };
    _bgabDirty = {};
    _bgabView  = 'packing';
    _bgabShowZero = false;
    bgabRenderDetail();
  } catch (e) {
    toast('Failed to load event: ' + e.message, '⚠');
    bgabRenderList();
  }
}

function bgabBackToList() {
  if (Object.keys(_bgabDirty).length &&
      !confirm('You have unsaved changes. Leave without saving?')) return;
  _bgabCurrentEvent = null;
  _bgabDirty = {};
  bgabRenderList();
}

function bgabRenderDetail() {
  _bgabShowDetailView();
  document.getElementById('bgab-sub').textContent = _bgabCurrentEvent.name;
  _bgabSyncViewBtns();
  _bgabSyncZeroBtn();
  _bgabRenderItems();
}

function bgabSwitchView(mode) {
  _bgabView = mode;
  _bgabSyncViewBtns();
  _bgabRenderItems();
}

function bgabToggleZero() {
  _bgabShowZero = !_bgabShowZero;
  _bgabSyncZeroBtn();
  _bgabRenderItems();
}

function _bgabSyncViewBtns() {
  document.getElementById('bgab-view-packing').classList.toggle('active', _bgabView === 'packing');
  document.getElementById('bgab-view-results').classList.toggle('active', _bgabView === 'results');
}

function _bgabSyncZeroBtn() {
  const btn = document.getElementById('bgab-show-zero-btn');
  if (btn) btn.textContent = _bgabShowZero ? 'Hide Zero-Brought' : 'Show Zero-Brought';
}

// ── Item rendering ────────────────────────────────────────────────────────────

function _bgabRenderItems() {
  const el = document.getElementById('bgab-items-container');
  const ev = _bgabCurrentEvent;

  if (!ev.items.length) {
    el.innerHTML = `<div style="padding:48px 24px;text-align:center;color:var(--text-dim);font-size:14px;">
      No items yet — tap <strong>＋ Add Items</strong> to import from Square.</div>`;
    return;
  }

  // Results summary bar
  let summaryHtml = '';
  if (_bgabView === 'results') {
    let totalBrought = 0, totalSold = 0;
    ev.items.forEach(item => item.variations.forEach(v => {
      const cur = _bgabGetCur(v);
      totalBrought += cur.brought;
      totalSold    += cur.sold;
    }));
    summaryHtml = `<div style="display:flex;gap:20px;padding:12px 4px;margin-bottom:8px;font-size:13px;font-weight:600;color:var(--text-dim);">
      <span>Brought: <span style="color:var(--text)">${totalBrought}</span></span>
      <span>Sold: <span style="color:var(--accent,#C9983A)">${totalSold}</span></span>
      <span>Remaining: <span style="color:var(--text)">${totalBrought - totalSold}</span></span>
    </div>`;
  }

  let cardsHtml = '';
  ev.items.forEach(item => {
    const displayVars = item.variations.filter(v => {
      if (_bgabShowZero) return true;
      const cur = _bgabGetCur(v);
      return cur.brought > 0 || cur.sold > 0;
    });
    if (!displayVars.length && !_bgabShowZero) return;
    const varsToRender = _bgabShowZero ? item.variations : displayVars;

    const squareSafe = item.squareId.replace(/'/g, '');
    cardsHtml += `<div class="inv-card">
      <div class="inv-card-head" style="display:flex;align-items:center;justify-content:space-between;">
        <span>${_esc(item.name)}</span>
        <button onclick="bgabRemoveItem('${squareSafe}')"
          title="Remove from this event"
          style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;opacity:0.4;transition:opacity 0.15s,color 0.15s;"
          onmouseenter="this.style.opacity='1';this.style.color='#dc2626'"
          onmouseleave="this.style.opacity='0.4';this.style.color='var(--text-dim)'">✕</button>
      </div>`;

    varsToRender.forEach(v => {
      const cur     = _bgabGetCur(v);
      const isDirty = !!_bgabDirty[v.varId];
      const vId     = v.varId;
      const bgStyle = isDirty ? 'background:var(--accent-bg);' : '';

      if (_bgabView === 'packing') {
        cardsHtml += `<div class="inv-row" data-var-id="${vId}">
          <div class="inv-var-name">${_esc(v.name) || '(Default)'}</div>
          <div class="inv-stepper">
            <button class="inv-step-btn" onclick="bgabStep('${vId}','brought',-1)">−</button>
            <input class="inv-step-input" type="number" id="bgab-b-${vId}"
              value="${cur.brought}" min="0"
              onchange="bgabMarkDirty('${vId}','brought',this.value)"
              style="${bgStyle}">
            <button class="inv-step-btn" onclick="bgabStep('${vId}','brought',1)">＋</button>
          </div>
          <span style="font-size:11px;color:var(--text-dim);min-width:48px;">brought</span>
          <button class="inv-set-btn" onclick="bgabSaveRow('${vId}')">Set</button>
        </div>`;
      } else {
        const remaining = cur.brought - cur.sold;
        const remClass  = remaining > 0 ? 'in-stock' : remaining === 0 && cur.brought > 0 ? 'no-stock' : '';
        cardsHtml += `<div class="inv-row" data-var-id="${vId}">
          <div class="inv-var-name">${_esc(v.name) || '(Default)'}</div>
          <span style="font-size:12px;color:var(--text-dim);min-width:72px;">brought: ${cur.brought}</span>
          <div class="inv-stepper">
            <button class="inv-step-btn" onclick="bgabStep('${vId}','sold',-1)">−</button>
            <input class="inv-step-input" type="number" id="bgab-s-${vId}"
              value="${cur.sold}" min="0"
              onchange="bgabMarkDirty('${vId}','sold',this.value)"
              style="${bgStyle}">
            <button class="inv-step-btn" onclick="bgabStep('${vId}','sold',1)">＋</button>
          </div>
          <span style="font-size:11px;color:var(--text-dim);min-width:36px;">sold</span>
          ${remClass ? `<span class="inv-badge ${remClass}" style="min-width:90px;">${remaining} remaining</span>` : `<span style="min-width:90px;"></span>`}
          <button class="inv-set-btn" onclick="bgabSaveRow('${vId}')">Set</button>
        </div>`;
      }
    });
    cardsHtml += '</div>';
  });

  el.innerHTML = summaryHtml + (cardsHtml ||
    '<div style="padding:24px;text-align:center;color:var(--text-dim)">All items have zero quantities. Toggle "Show Zero-Brought" to see them.</div>');
}

function _bgabGetCur(v) {
  return _bgabDirty[v.varId] || { brought: v.brought ?? 0, sold: v.sold ?? 0 };
}

// ── Stepper + dirty tracking ──────────────────────────────────────────────────

function bgabStep(varId, field, delta) {
  const inputId = field === 'brought' ? `bgab-b-${varId}` : `bgab-s-${varId}`;
  const input   = document.getElementById(inputId);
  if (!input) return;
  const newVal  = Math.max(0, (parseInt(input.value) || 0) + delta);
  input.value   = newVal;
  bgabMarkDirty(varId, field, newVal);
  input.style.background = 'var(--accent-bg)';
}

function bgabMarkDirty(varId, field, rawVal) {
  const val = Math.max(0, parseInt(rawVal) || 0);
  // Seed from stored values so both fields always have values
  let base = { brought: 0, sold: 0 };
  for (const item of _bgabCurrentEvent.items) {
    const v = item.variations.find(vv => vv.varId === varId);
    if (v) { base = { brought: v.brought ?? 0, sold: v.sold ?? 0 }; break; }
  }
  _bgabDirty[varId] = { ...base, ...(_bgabDirty[varId] || {}), [field]: val };
  // Highlight the input
  ['bgab-b-', 'bgab-s-'].forEach(prefix => {
    const el = document.getElementById(prefix + varId);
    if (el) el.style.background = 'var(--accent-bg)';
  });
}

function bgabSaveRow(varId) {
  if (!_bgabDirty[varId]) return;
  _bgabFlushDirty({ [varId]: _bgabDirty[varId] });
  bgabPersist();
}

async function bgabSaveAll() {
  const entries = Object.entries(_bgabDirty);
  if (!entries.length) { toast('No changes to save', 'ℹ'); return; }
  const btn = document.getElementById('bgab-save-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  _bgabFlushDirty(Object.fromEntries(entries));
  await bgabPersist();
  if (btn) { btn.disabled = false; btn.textContent = 'Save All'; }
}

function _bgabFlushDirty(dirtyMap) {
  Object.entries(dirtyMap).forEach(([varId, vals]) => {
    for (const item of _bgabCurrentEvent.items) {
      const v = item.variations.find(vv => vv.varId === varId);
      if (v) { v.brought = vals.brought; v.sold = vals.sold; break; }
    }
    delete _bgabDirty[varId];
  });
  _bgabRenderItems();
}

async function bgabPersist() {
  try {
    const r = await fetch(`${BGAB_API}?id=${_bgabCurrentEvent.notionPageId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ data: { items: _bgabCurrentEvent.items } }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
    toast('Saved ✓', '✓');
  } catch (e) {
    toast('Save failed: ' + e.message, '⚠');
  }
}

// ── Remove item ───────────────────────────────────────────────────────────────

function bgabRemoveItem(squareId) {
  const item = _bgabCurrentEvent.items.find(i => i.squareId === squareId);
  if (!item) return;
  if (!confirm(`Remove "${item.name}" from this event?`)) return;
  _bgabCurrentEvent.items = _bgabCurrentEvent.items.filter(i => i.squareId !== squareId);
  item.variations.forEach(v => delete _bgabDirty[v.varId]);
  _bgabRenderItems();
  bgabPersist();
}

// ══════════════════════════════════════════════════════════════════════════════
//  NEW EVENT MODAL
// ══════════════════════════════════════════════════════════════════════════════

function bgabShowNewEventModal() {
  const sel = document.getElementById('bgab-clone-sel');
  sel.innerHTML = '<option value="">— Start fresh —</option>' +
    _bgabEvents.map(ev =>
      `<option value="${ev.notionPageId}">${_esc(ev.name)}</option>`
    ).join('');
  document.getElementById('bgab-new-year').value = new Date().getFullYear();
  document.getElementById('bgab-new-modal-bg').style.display = 'flex';
}

function bgabCloseNewEventModal() {
  document.getElementById('bgab-new-modal-bg').style.display = 'none';
}

async function bgabCreateEvent() {
  const type  = document.getElementById('bgab-new-type').value;
  const year  = parseInt(document.getElementById('bgab-new-year').value);
  const clone = document.getElementById('bgab-clone-sel').value;
  if (!type || !year) { toast('Choose a type and year', '⚠'); return; }

  const name = `${type} ${year}`;
  let items  = [];

  if (clone) {
    try {
      const r = await fetch(`${BGAB_API}?id=${clone}`);
      if (r.ok) {
        const src = await r.json();
        // Deep-clone items, reset sold quantities to 0
        items = (src.data?.items || []).map(item => ({
          ...item,
          variations: item.variations.map(v => ({ ...v, sold: 0 })),
        }));
      }
    } catch {}
  }

  const btn = document.getElementById('bgab-create-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const r = await fetch(BGAB_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, type, year, data: { items } }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Create failed');
    const { notionPageId } = await r.json();
    _bgabEvents.unshift({ notionPageId, name, type, year });
    bgabCloseNewEventModal();
    toast(`"${name}" created ✓`, '✓');
    bgabOpenEvent(notionPageId);
  } catch (e) {
    toast('Failed: ' + e.message, '⚠');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Event';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  SOFT DELETE
// ══════════════════════════════════════════════════════════════════════════════

async function bgabSoftDeleteCurrent() {
  const ev = _bgabCurrentEvent;
  if (!ev || !confirm(`Delete "${ev.name}"?\n\nThis can be recovered from Notion.`)) return;
  try {
    const r = await fetch(`${BGAB_API}?id=${ev.notionPageId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    _bgabEvents = _bgabEvents.filter(e => e.notionPageId !== ev.notionPageId);
    toast(`"${ev.name}" deleted`, 'ℹ');
    _bgabCurrentEvent = null;
    _bgabDirty = {};
    bgabRenderList();
  } catch (e) {
    toast('Delete failed: ' + e.message, '⚠');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  IMPORT PANEL
// ══════════════════════════════════════════════════════════════════════════════

function bgabOpenImport() {
  // Seed already-added items as checked+disabled
  _bgabImpChecked = {};
  (_bgabCurrentEvent?.items || []).forEach(item => {
    _bgabImpChecked[item.squareId] = { alreadyAdded: true, sub: item.category };
  });
  _bgabImpMain = 'earrings';
  _bgabImpSub  = 'ear-cuffs';

  document.getElementById('bgab-list-view').style.display   = 'none';
  document.getElementById('bgab-detail-view').style.display = 'none';
  document.getElementById('bgab-import-panel').style.display = '';
  // Sync main tab buttons
  _bgabImpSyncMain();
  // Show earring sub-tabs, hide others
  ['earrings','rings','pendants'].forEach(t => {
    const g = document.getElementById(`bgab-imp-subs-${t}`);
    if (g) g.style.display = t === 'earrings' ? '' : 'none';
  });
  // Activate first earring sub
  bgabImpSwitchSub('ear-cuffs',
    document.querySelector('.bgab-imp-sub-btn[data-sub="ear-cuffs"]'));
  bgabImpUpdateCount();
}

function bgabCloseImport() {
  document.getElementById('bgab-import-panel').style.display = 'none';
  if (_bgabCurrentEvent) {
    _bgabShowDetailView();
    bgabRenderDetail();
  } else {
    bgabRenderList();
  }
}

function bgabImpSwitchMain(type) {
  _bgabImpMain = type;
  _bgabImpSyncMain();
  ['earrings','rings','pendants'].forEach(t => {
    const g = document.getElementById(`bgab-imp-subs-${t}`);
    if (g) g.style.display = t === type ? '' : 'none';
  });
  const firstSub = type === 'earrings' ? 'ear-cuffs' : type === 'rings' ? 'stackable' : 'p-spirit';
  bgabImpSwitchSub(firstSub,
    document.querySelector(`.bgab-imp-sub-btn[data-sub="${firstSub}"]`));
}

function _bgabImpSyncMain() {
  ['earrings','rings','pendants'].forEach(t => {
    const btn = document.getElementById(`bgab-imp-main-${t}`);
    if (btn) btn.classList.toggle('active', t === _bgabImpMain);
  });
}

async function bgabImpSwitchSub(sub, el) {
  _bgabImpSub = sub;
  document.querySelectorAll('.bgab-imp-sub-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');

  if (_bgabImpData[sub]) { bgabImpRenderItems(sub); return; }

  document.getElementById('bgab-imp-items').innerHTML =
    '<div style="padding:32px;text-align:center;color:var(--text-dim)">Loading…</div>';

  try {
    const catIds = [
      ...(typeof INV_CAT_IDS       !== 'undefined' ? (INV_CAT_IDS[sub]       || []) : []),
      ...(typeof INV_RING_CAT_IDS  !== 'undefined' ? (INV_RING_CAT_IDS[sub]  || []) : []),
      ...(typeof INV_PENDANT_CAT_IDS !== 'undefined' ? (INV_PENDANT_CAT_IDS[sub] || []) : []),
    ];
    if (!catIds.length) {
      document.getElementById('bgab-imp-items').innerHTML =
        '<div style="padding:32px;text-align:center;color:var(--text-dim)">No Square categories configured for this tab.</div>';
      return;
    }
    const res = await _sqFetch('/v2/catalog/search-catalog-items', {
      method: 'POST',
      body: JSON.stringify({ category_ids: catIds }),
    });
    _bgabImpData[sub] = (res.items || []).filter(o => !o.is_deleted)
      .sort((a, b) => (a.item_data?.name || '').localeCompare(b.item_data?.name || ''));
    bgabImpRenderItems(sub);
  } catch (e) {
    document.getElementById('bgab-imp-items').innerHTML =
      `<div style="padding:32px;text-align:center;color:#dc2626;">⚠ ${_esc(e.message)}</div>`;
  }
}

function bgabImpRenderItems(sub) {
  const items = _bgabImpData[sub] || [];
  const el    = document.getElementById('bgab-imp-items');
  if (!items.length) {
    el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-dim)">No items found in this category.</div>';
    return;
  }
  el.innerHTML = items.map(item => {
    const state     = _bgabImpChecked[item.id];
    const isAdded   = state?.alreadyAdded;
    const isChecked = !!state;
    const nameSafe  = _esc(item.item_data?.name || 'Unnamed');
    return `
    <label class="bgab-imp-row${isAdded ? ' bgab-imp-row-added' : ''}"
      style="display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:${isAdded ? 'default' : 'pointer'};border-bottom:1px solid var(--bdr);transition:background 0.1s;user-select:none;"
      ${isAdded ? '' : `onmouseenter="this.style.background='var(--hover-bg,#f5f5f5)'" onmouseleave="this.style.background=''"`}>
      <input type="checkbox" ${isChecked ? 'checked' : ''} ${isAdded ? 'disabled' : ''}
        onchange="bgabImpToggle('${item.id}','${sub}')"
        style="width:16px;height:16px;flex-shrink:0;accent-color:var(--accent,#C9983A);cursor:${isAdded ? 'default' : 'pointer'};">
      <span style="flex:1;font-size:14px;color:${isAdded ? 'var(--text-dim)' : 'var(--text)'};">${nameSafe}</span>
      ${isAdded ? '<span style="font-size:11px;color:var(--text-dim);background:var(--card-head-bg);padding:2px 8px;border-radius:4px;flex-shrink:0;">already added</span>' : ''}
    </label>`;
  }).join('');
}

function bgabImpToggle(squareId, sub) {
  if (_bgabImpChecked[squareId]?.alreadyAdded) return;
  if (_bgabImpChecked[squareId]) {
    delete _bgabImpChecked[squareId];
  } else {
    const item = (_bgabImpData[sub] || []).find(i => i.id === squareId);
    if (!item) return;
    _bgabImpChecked[squareId] = { item, sub };
  }
  bgabImpUpdateCount();
}

function bgabImpUpdateCount() {
  const n   = Object.values(_bgabImpChecked).filter(v => !v.alreadyAdded).length;
  const btn = document.getElementById('bgab-imp-confirm-btn');
  if (btn) btn.textContent = n > 0 ? `Add Selected (${n})` : 'Add Selected';
}

async function bgabImpConfirm() {
  const toAdd = Object.entries(_bgabImpChecked).filter(([, v]) => !v.alreadyAdded);
  if (!toAdd.length) { bgabCloseImport(); return; }

  toAdd.forEach(([squareId, { item, sub }]) => {
    const vars = (item.item_data?.variations || [])
      .filter(v => !v.is_deleted)
      .map(v => ({
        varId:   v.id,
        name:    v.item_variation_data?.name || '',
        brought: 0,
        sold:    0,
      }));
    _bgabCurrentEvent.items.push({
      squareId,
      name:     item.item_data?.name || 'Unnamed',
      category: sub,
      variations: vars,
    });
  });

  const btn = document.getElementById('bgab-imp-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  await bgabPersist();
  if (btn) { btn.disabled = false; }
  bgabCloseImport();
}

// ══════════════════════════════════════════════════════════════════════════════
//  VIEW HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function _bgabShowListView() {
  document.getElementById('bgab-list-view').style.display    = '';
  document.getElementById('bgab-detail-view').style.display  = 'none';
  document.getElementById('bgab-import-panel').style.display = 'none';
  document.getElementById('bgab-sub').textContent = 'Art Bazaar & May Market inventory';
  document.getElementById('bgab-new-btn').style.display      = '';
  document.getElementById('bgab-back-btn').style.display     = 'none';
  document.getElementById('bgab-add-items-btn').style.display = 'none';
  document.getElementById('bgab-save-all-btn').style.display = 'none';
  document.getElementById('bgab-delete-btn').style.display   = 'none';
}

function _bgabShowDetailView() {
  document.getElementById('bgab-list-view').style.display    = 'none';
  document.getElementById('bgab-detail-view').style.display  = '';
  document.getElementById('bgab-import-panel').style.display = 'none';
  document.getElementById('bgab-new-btn').style.display      = 'none';
  document.getElementById('bgab-back-btn').style.display     = '';
  document.getElementById('bgab-add-items-btn').style.display = '';
  document.getElementById('bgab-save-all-btn').style.display = '';
  document.getElementById('bgab-delete-btn').style.display   = '';
}

function _bgabShowDetailLoading() {
  _bgabShowDetailView();
  document.getElementById('bgab-items-container').innerHTML =
    '<div style="padding:32px;text-align:center;color:var(--text-dim)">Loading…</div>';
  if (_bgabCurrentEvent) document.getElementById('bgab-sub').textContent = '';
}
