// ════════════════════════════════════════════
//  ORDER WIDGETS  —  js/order-widgets.js
//  Form logic shared by BOTH documents that edit orders:
//    · jewelry-workflow.html — the Edit Order modal
//    · intake.html           — the standalone iPad intake PWA
//  Both pages use the same field/container IDs (f-*, oi-*, est-*,
//  jobdesc-*), so everything here is document-agnostic. Must be
//  loaded BEFORE js/orders.js / js/intake.js.
//  Contains: phone + name helpers, order-type→stage map, money/balance
//  helpers, shipping-address toggle, Job Description (custom vs Square),
//  Order Items repeater + Square catalog search, Estimate Builder.
// ════════════════════════════════════════════
function fmtPhone(val) {
  const digits = (val || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length > 6) return '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
  if (digits.length > 3) return '(' + digits.slice(0,3) + ') ' + digits.slice(3);
  if (digits.length)     return '(' + digits;
  return '';
}
function fmtPhoneInput(el) { el.value = fmtPhone(el.value); }

function getFullName() {
  const first = document.getElementById('f-firstname')?.value.trim() || '';
  const last  = document.getElementById('f-lastname')?.value.trim()  || '';
  return [first, last].filter(Boolean).join(' ');
}

function setNameFields(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  const first = document.getElementById('f-firstname');
  const last  = document.getElementById('f-lastname');
  if (first) first.value = parts[0] || '';
  if (last)  last.value  = parts.slice(1).join(' ') || '';
}

// Shared Resize display string — combines Current/Desired Size into the
// single text sent to Notion's "Sizing / Dimensions" property. Used by
// both intake.html (js/intake.js) and the Edit Order modal (js/orders.js)
// so the format only lives in one place.
function formatResizeSizing(from, to) {
  from = (from || '').trim();
  to   = (to   || '').trim();
  if (!from && !to) return '';
  return 'Resize ' + (from || '?') + ' → ' + (to || '?');
}

// ════════════════════════════════════════════

//  ORDER TYPE DROPDOWN
// ════════════════════════════════════════════
const ORDER_TYPE_STAGES = {
  order:           { stage: 'intake-custom',  label: 'Custom Intake'        },
  repair:          { stage: 'intake-repair',  label: 'Repair Intake'        },
  resize:          { stage: 'intake-repair',  label: 'Repair Intake'        },
  'etsy-order':    { stage: 'intake-custom',  label: 'Custom Intake'        },
  'website-order': { stage: 'intake-website', label: 'Website Order Intake' },
  estimate:        { stage: 'needs-est',      label: 'Estimate Intake'      },
  'square-item':   { stage: 'intake-custom',  label: 'Custom Intake'        },
};

function onOrderTypeChange() {
  const sel  = document.getElementById('f-order-type');
  const hint = document.getElementById('ot-hint');
  if (!sel || !hint) return;
  const map = ORDER_TYPE_STAGES[sel.value] || ORDER_TYPE_STAGES.order;
  hint.innerHTML = `Will be placed in <strong>${map.label}</strong>.`;
}

function setOrderType(type) {
  const sel = document.getElementById('f-order-type');
  if (sel) { sel.value = type; onOrderTypeChange(); }
}

function dpUpdatePaidByLabel() {
  const row       = document.getElementById('f-paid-by-row');
  const deposit   = document.getElementById('f-deposit');
  const editingId = document.getElementById('f-editing-id');
  if (!row || !deposit) return;
  const hasDeposit = (parseFloat(deposit.value) || 0) > 0;
  const editing    = editingId && editingId.value;
  row.style.display = (editing && hasDeposit) ? '' : 'none';
  eoUpdateBalanceDue();
}

function eoUpdateBalanceDue() {
  const balanceEl = document.getElementById('f-balance-due');
  if (!balanceEl) return;
  const fullyPaid = document.getElementById('f-fully-paid');
  if (fullyPaid && fullyPaid.value) {
    balanceEl.value = '0.00';
    return;
  }
  const price    = parseFloat(document.getElementById('f-price').value)    || 0;
  const deposit  = parseFloat(document.getElementById('f-deposit').value)  || 0;
  const shipping = parseFloat(document.getElementById('f-shipping').value) || 0;
  const balance  = Math.max(price + shipping - deposit, 0);
  balanceEl.value = balance.toFixed(2);
}

function toggleShippingAddress() {
  const pickup    = document.getElementById('f-pickup');
  const isShipped = pickup && pickup.value === 'To be Shipped';
  const editing   = !!(document.getElementById('f-editing-id') || {}).value;
  ['addr-street-fg', 'addr-street2-fg', 'addr-city-fg', 'addr-state-fg', 'addr-zip-fg', 'addr-country-fg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isShipped ? '' : 'none';
  });
  // Tracking is never known at intake — only show when editing a shipped order
  ['tracking-carrier-fg', 'tracking-number-fg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (isShipped && editing) ? '' : 'none';
  });
}

// ════════════════════════════════════════════
//  ORDER ITEMS — multi-item picker (manual entry or Square catalog item)
//  Each item: { type:'manual'|'square', name, sku, price, squareItemId, squareVariationId }
// ════════════════════════════════════════════
let _oiItems = [];
let _oiDebounce = {};
let _oiLastResults = {};

function oiInit() {
  _oiItems = [];
  oiRender();
}

// ════════════════════════════════════════════
//  JOB DESCRIPTION — Custom Item (free text) vs Square Item (the job IS a single
//  catalog item, picked the same way as an Order Item). Square Item mode hides Order
//  Description / Materials / Sketch Notes / the multi-item Order Items section, and
//  uses the chosen item's name as the saved description/title — without touching
//  whatever text was already typed in those hidden fields, so toggling back restores it.
// ════════════════════════════════════════════
let _jdMode = 'custom';

function jdApplyVisibility(mode) {
  const show = id => { const el = document.getElementById(id); if (el) el.style.display = ''; };
  const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  if (mode === 'square') {
    hide('jobdesc-custom-wrap'); show('jobdesc-square-wrap');
    hide('orderdesc-fg'); hide('materials-fg'); hide('sketch-fg'); hide('oi-section');
  } else {
    show('jobdesc-custom-wrap'); hide('jobdesc-square-wrap');
    show('orderdesc-fg'); show('materials-fg'); show('sketch-fg'); show('oi-section');
  }
}

function jdSetType(mode) {
  _jdMode = mode;
  if (mode === 'square') {
    const allSquare = _oiItems.length > 0 && _oiItems.every(it => it.type === 'square');
    if (!allSquare) {
      _oiItems = [{ type: 'square', name: '', sku: '', price: 0, squareItemId: null, squareVariationId: null }];
    }
  }
  jdApplyVisibility(mode);
  oiRender();
}

function jdAddSquareItem() {
  _oiItems.push({ type: 'square', name: '', sku: '', price: 0, squareItemId: null, squareVariationId: null });
  oiRender();
}

function _jdSquareItemNames() {
  return _oiItems.filter(it => it.name).map(it => it.name).join(', ');
}

function jdGetDescValue() {
  if (_jdMode === 'square') return _jdSquareItemNames();
  return document.getElementById('f-description').value.trim();
}

function jdGetJobDescValue() {
  if (_jdMode === 'square') return _jdSquareItemNames();
  return document.getElementById('f-job-desc').value.trim();
}

function oiLoadFromOrder(o) {
  if (Array.isArray(o.items) && o.items.length) {
    _oiItems = o.items.map(it => ({ ...it }));
  } else if (o.price) {
    // Legacy order created before line items existed — preserve its total as a single item.
    _oiItems = [{ type: 'manual', name: 'Order Total', price: o.price }];
  } else {
    _oiItems = [];
  }
  oiRender();
}

function oiAddItem() {
  _oiItems.push({ type: 'manual', name: '', sku: '', price: 0 });
  oiRender();
}

function oiRemoveItem(idx) {
  _oiItems.splice(idx, 1);
  oiRender();
}

function oiSetType(idx, type) {
  if (!_oiItems[idx]) return;
  _oiItems[idx] = type === 'square'
    ? { type: 'square', name: '', sku: '', price: 0, squareItemId: null, squareVariationId: null }
    : { type: 'manual', name: '', sku: '', price: 0 };
  oiRender();
}

function oiUpdateField(idx, field, value) {
  if (!_oiItems[idx]) return;
  _oiItems[idx][field] = value;
  if (field === 'price') oiRecalcTotal();
}

function oiClearSquareSelection(idx) {
  if (!_oiItems[idx]) return;
  _oiItems[idx] = { type: 'square', name: '', sku: '', price: 0, squareItemId: null, squareVariationId: null };
  oiRender();
}

function oiRecalcTotal() {
  const total = _oiItems.reduce((sum, it) => sum + (parseFloat(it.price) || 0) * (parseInt(it.quantity, 10) || 1), 0);
  const priceEl = document.getElementById('f-price');
  if (priceEl) priceEl.value = total ? total.toFixed(2) : '';
  eoUpdateBalanceDue();
}

// Square ring category IDs (from inventory.js INV_RING_CAT_IDS) flattened into a lookup set,
// used to detect which Square items are rings so we can offer a manual size field for the
// ones that have no size variation set up in Square.
function _oiRingCategoryIdSet() {
  if (typeof INV_RING_CAT_IDS === 'undefined') return new Set();
  return new Set(Object.values(INV_RING_CAT_IDS).flat());
}

// Stackable rings are the one ring sub-category staying on Square variation-less SKUs for
// now (sizing is being rolled out everywhere else) — exclude them from the manual size field.
function _oiStackableCategoryIdSet() {
  if (typeof INV_RING_CAT_IDS === 'undefined' || !INV_RING_CAT_IDS.stackable) return new Set();
  return new Set(INV_RING_CAT_IDS.stackable);
}

// Combines per-item ring sizes (manual entries for Square rings with no Square size
// variation, plus sizes already embedded in a selected size variation's name) into the
// single string sent to Notion / printed on the work order bag.
function oiDeriveRingSizesText(items) {
  if (!Array.isArray(items)) return '';
  const sizes = [];
  items.forEach(it => {
    if (it.ringSize) { sizes.push(String(it.ringSize).trim()); return; }
    if (it.type === 'square' && it.name && it.name.indexOf(' — ') !== -1) {
      const suffix = it.name.split(' — ').pop().trim();
      if (/size/i.test(suffix)) sizes.push(suffix);
    }
  });
  return sizes.filter(Boolean).join(', ');
}

function oiSerialize() {
  return JSON.stringify(_oiItems);
}

// Builds a printable label for one item that spells out its selected Square modifiers
// and manual ring size — e.g. "Narrow Regular Gold Fill Chevron Stacker - Size 4" —
// instead of just the bare catalog item name. Used only for the printed work order bag.
function oiPrintLabel(it) {
  if (!it) return '';
  let label;
  if (it.type !== 'square') {
    label = it.name || '';
  } else {
    const modParts = (it.modifierLists || []).map(list => {
      const optId = it.selectedModifierIds && it.selectedModifierIds[list.id];
      const opt = (list.options || []).find(o => o.id === optId);
      return opt ? opt.name : null;
    }).filter(Boolean);
    label = modParts.length ? modParts.join(' ') + ' ' + (it.name || '') : (it.name || '');
  }
  const qty = parseInt(it.quantity, 10) || 1;
  if (qty > 1) label = qty + '× ' + label;
  if (it.ringSize) label += ' - Size ' + it.ringSize;
  return label;
}

// Job Description (estimate title) and Order Description keep showing the plain item
// name in-app and in Notion — this richer version is only for the printed work order.
function oiPrintDescription(o) {
  if (o.jobDescMode === 'square' && Array.isArray(o.items) && o.items.length) {
    const labels = o.items.map(oiPrintLabel).filter(Boolean);
    if (labels.length <= 1) return labels.join('');
    return labels.map((label, i) => 'Item ' + (i + 1) + ' - ' + label).join('\n');
  }
  return o.desc || '';
}

// Job Description box on the printed bag — drops the Square variation suffix
// (material / size baked into the item name, e.g. "Spiral Rings — Silver - Size 10")
// so the bag shows just the base item name. The item-line table further down
// still uses oiPrintLabel's fuller text.
function oiPrintJobDescShort(o) {
  if (o.jobDescMode === 'square' && Array.isArray(o.items) && o.items.length) {
    const labels = o.items.map(it => {
      let base = (it.name || '').split(' — ')[0].trim();
      const qty = parseInt(it.quantity, 10) || 1;
      return qty > 1 ? qty + '× ' + base : base;
    }).filter(Boolean);
    if (labels.length <= 1) return labels.join('');
    return labels.map((label, i) => 'Item ' + (i + 1) + ' - ' + label).join('\n');
  }
  return o.desc || '';
}

// Ring Size(s) box on the printed bag — strips any material/color prefix baked
// into a Square variation suffix (e.g. "Silver - Size 10" → "Size 10").
function oiPrintRingSizeShort(o) {
  if (!Array.isArray(o.items) || !o.items.length) return o.ringSize || '';
  const sizes = [];
  o.items.forEach(it => {
    if (it.ringSize) { sizes.push('Size ' + String(it.ringSize).trim()); return; }
    if (it.type === 'square' && it.name) {
      const m = it.name.match(/size\s*[\d.\/]+/i);
      if (m) sizes.push(m[0].replace(/^size/i, 'Size'));
    }
  });
  return sizes.filter(Boolean).join(', ') || (o.ringSize || '');
}

// Which container the Order Items rows render into — the plain Order Items
// repeater, the Job Description Square-item picker, or the Edit Order
// modal's Square module. All three are just different mount points for the
// same _oiItems array; typeof-guarded so intake.html (which never defines
// _eoOrderTypeModule) keeps behaving exactly as before.
function _oiActiveContainerId() {
  if (typeof _eoOrderTypeModule !== 'undefined') {
    if (_eoOrderTypeModule === 'square') return 'square-module-picker';
    // Repair/Resize have no Job Description concept — always route into the
    // plain repeater, even if _jdMode is left over as 'square' from an
    // earlier Design/Square selection made in the same modal session.
    if (_eoOrderTypeModule !== 'design') return 'oi-items-container';
  }
  if (_jdMode === 'square') return 'jobdesc-square-picker';
  return 'oi-items-container';
}

function oiRender() {
  const containerId    = _oiActiveContainerId();
  const hideTypeSelect = containerId !== 'oi-items-container';
  const readOnly       = typeof _eoMode !== 'undefined' && _eoMode === 'view';
  const box = document.getElementById(containerId);
  if (box) {
    const emptyMsg = containerId === 'oi-items-container'
      ? 'No items yet — add a manual item or a Square item.'
      : 'No items yet — search and select a Square item.';
    box.innerHTML = !_oiItems.length
      ? `<div style="font-size:12px;color:var(--text3);padding:4px 0;">${emptyMsg}</div>`
      : _oiItems.map((it, idx) => oiRowHtml(it, idx, hideTypeSelect, readOnly)).join('');
  }
  oiRecalcTotal();
  const itemsJson = document.getElementById('f-items-json');
  if (itemsJson) itemsJson.value = oiSerialize();
}

// Static read-only summary of one item — reuses the existing
// .rq-selected-item/.rq-result-* classes so no new CSS is needed.
function oiRowReadHtml(it, idx) {
  const qty = parseInt(it.quantity, 10) || 1;
  const modParts = (it.modifierLists || []).map(list => {
    const optId = it.selectedModifierIds && it.selectedModifierIds[list.id];
    const opt = (list.options || []).find(o => o.id === optId);
    return opt ? opt.name : null;
  }).filter(Boolean);
  const metaParts = [];
  if (it.sku) metaParts.push('SKU ' + it.sku.replace(/</g, '&lt;'));
  if (modParts.length) metaParts.push(modParts.join(', ').replace(/</g, '&lt;'));
  if (it.ringSize) metaParts.push('Size ' + String(it.ringSize).replace(/</g, '&lt;'));
  if (qty > 1) metaParts.push(qty + '×');
  const priceTxt = (it.price != null && it.price !== '') ? '$' + (parseFloat(it.price) || 0).toFixed(2) : '—';
  return `<div class="rq-selected-item" style="cursor:default;">
    <div style="flex:1;">
      <div class="rq-result-name">${(it.name || '(unnamed item)').replace(/</g, '&lt;')}</div>
      <div class="rq-result-meta">${metaParts.join(' · ')}</div>
    </div>
    <div class="rq-result-price">${priceTxt}</div>
  </div>`;
}

function oiRowHtml(it, idx, hideTypeSelect, readOnly) {
  if (readOnly) return oiRowReadHtml(it, idx);
  const isSquareSelected = it.type === 'square' && (it.squareVariationId || it.squareItemId);
  const typeSel = (isSquareSelected || hideTypeSelect) ? '' : `<select class="eo-edit-only" onchange="oiSetType(${idx}, this.value)" style="font-size:11px;padding:5px 6px;border:1px solid var(--bdr);border-radius:5px;background:#fff;flex-shrink:0;">
    <option value="manual" ${it.type === 'manual' ? 'selected' : ''}>Manual Item</option>
    <option value="square" ${it.type === 'square' ? 'selected' : ''}>Square Item</option>
  </select>`;

  let body;
  if (it.type === 'square') {
    if (it.squareVariationId || it.squareItemId) {
      const needsRingSize = it.isRing && it.noSquareSize;
      body = `<div style="flex:1;display:flex;flex-direction:column;gap:6px;">
        <div class="rq-selected-item">
          <div style="flex:1;">
            <div class="rq-result-name">${(it.name || '').replace(/</g, '&lt;')}</div>
            <div class="rq-result-meta">${it.sku ? 'SKU ' + it.sku.replace(/</g, '&lt;') : ''}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--text3);">${it.hasFixedPrice ? 'Square Price' : 'Enter Price'}</span>
            <input type="number" step="0.01" min="0" placeholder="0.00" value="${it.price || ''}" oninput="oiUpdateField(${idx},'price',parseFloat(this.value)||0)" style="width:90px;padding:4px 6px;border:1px solid ${it.hasFixedPrice ? 'var(--bdr)' : '#C98A2A'};border-radius:6px;font-size:12px;">
          </div>
          <button type="button" class="rq-item-remove eo-edit-only" title="Change item" onclick="oiClearSquareSelection(${idx})">↺</button>
        </div>
        ${!it.hasFixedPrice ? `<div style="font-size:11px;color:#A0702A;">No fixed price in Square (variable pricing) — enter the price manually</div>` : ''}
        ${(it.modifierLists || []).map(list => `
        <div style="display:flex;align-items:center;gap:6px;">
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#7A7268;flex-shrink:0;">${(list.name || '').replace(/</g, '&lt;')}</label>
          <select onchange="oiSetModifier(${idx},'${list.id}', this.value)" style="font-size:12px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;background:#fff;flex:1;max-width:220px;">
            ${list.options.map(o => `<option value="${o.id}" ${it.selectedModifierIds && it.selectedModifierIds[list.id] === o.id ? 'selected' : ''}>${(o.name || '').replace(/</g, '&lt;')} — $${((parseFloat(it.basePrice) || 0) + o.price).toFixed(2)}</option>`).join('')}
          </select>
        </div>`).join('')}
        ${needsRingSize ? `<div style="display:flex;align-items:center;gap:6px;">
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#7A7268;flex-shrink:0;">Ring Size</label>
          <input type="text" placeholder="e.g. 6.5" value="${(it.ringSize || '').replace(/"/g, '&quot;')}" oninput="oiUpdateField(${idx},'ringSize',this.value)" style="width:90px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;font-size:12px;">
          <span style="font-size:11px;color:var(--text3);">No size variation in Square — enter the size manually</span>
        </div>` : ''}
      </div>`;
    } else {
      body = `<div style="flex:1;position:relative;">
        <div class="rq-setup-search-wrap">
          <span class="rq-setup-search-icon">🔍</span>
          <input type="text" class="rq-setup-search-input" placeholder="Search Square catalog…" oninput="oiSearchInput(${idx}, this.value)">
          <div class="rq-setup-spinner" id="oi-spinner-${idx}"></div>
        </div>
        <div class="rq-setup-results" id="oi-results-${idx}"></div>
      </div>`;
    }
  } else {
    const needsRingSize = it.isRing && it.noSquareSize;
    body = `<div style="flex:1;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;gap:8px;">
        <input type="text" placeholder="Item name" value="${(it.name || '').replace(/"/g, '&quot;')}" oninput="oiUpdateField(${idx},'name',this.value)" style="flex:1;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;">
        <input type="number" step="1" min="1" placeholder="Qty" value="${it.quantity || 1}" oninput="oiUpdateField(${idx},'quantity',parseInt(this.value,10)||1)" style="width:60px;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;">
        <input type="number" step="0.01" min="0" placeholder="0.00" value="${it.price || ''}" oninput="oiUpdateField(${idx},'price',parseFloat(this.value)||0)" style="width:100px;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;">
      </div>
      ${needsRingSize ? `<div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#7A7268;flex-shrink:0;">Ring Size</label>
        <input type="text" placeholder="e.g. 6.5" value="${(it.ringSize || '').replace(/"/g, '&quot;')}" oninput="oiUpdateField(${idx},'ringSize',this.value)" style="width:90px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;font-size:12px;">
      </div>` : ''}
    </div>`;
  }

  return `<div style="display:flex;align-items:center;gap:8px;border:1px solid var(--bdr-light);border-radius:8px;padding:8px;background:var(--card-bg);">
    ${typeSel}
    ${body}
    <button type="button" class="rq-item-remove eo-edit-only" title="Remove item" onclick="oiRemoveItem(${idx})" style="font-size:16px;">✕</button>
  </div>`;
}

function oiSearchInput(idx, value) {
  if (_oiDebounce[idx]) clearTimeout(_oiDebounce[idx]);
  const box = document.getElementById('oi-results-' + idx);
  if (!value || value.length < 2) {
    if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    return;
  }
  _oiDebounce[idx] = setTimeout(() => oiSearchSquare(idx, value), 350);
}

function _oiSqCall(path, opts = {}) {
  const token = localStorage.getItem('sts-square-token') || '';
  const payload = { path: '/v2' + path, method: opts.method || 'GET' };
  if (opts.body) payload.body = opts.body;
  if (token) payload.token = token;
  return fetch('/api/square', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
}

function oiSearchSquare(idx, query) {
  const spinner = document.getElementById('oi-spinner-' + idx);
  if (spinner) spinner.style.display = 'block';
  _oiSqCall('/catalog/search', {
    method: 'POST',
    body: { object_types: ['ITEM'], query: { text_query: { keywords: [query] } }, limit: 20, include_related_objects: true },
  }).then(data => {
    const found = data.objects || [];
    if (!found.length) { oiRenderResults(idx, [], query); return null; }
    return _oiSqCall('/catalog/batch-retrieve', {
      method: 'POST',
      body: { object_ids: found.map(o => o.id), include_related_objects: true },
    }).then(fullData => {
      // Metal/style choices (e.g. Silver vs Gold Fill, Single vs Double) are set up in
      // Square as MODIFIER_LIST objects attached to the item, not separate variations —
      // those come back in related_objects, not inline on the item.
      const modifierListsById = {};
      (fullData.related_objects || []).forEach(o => {
        if (o.type === 'MODIFIER_LIST') modifierListsById[o.id] = o;
      });

      const ringCatIds      = _oiRingCategoryIdSet();
      const stackableCatIds = _oiStackableCategoryIdSet();
      const rows = [];
      (fullData.objects || []).forEach(obj => {
        if (obj.type !== 'ITEM') return;
        const itemName = obj.item_data ? obj.item_data.name : 'Unnamed';
        const variations = obj.item_data ? (obj.item_data.variations || []) : [];
        const catIds = [];
        if (obj.item_data && obj.item_data.category_id) catIds.push(obj.item_data.category_id);
        (obj.item_data && obj.item_data.categories || []).forEach(c => { if (c.id) catIds.push(c.id); });
        const isRing      = catIds.some(id => ringCatIds.has(id));
        const isStackable = catIds.some(id => stackableCatIds.has(id));
        const noSquareSize = variations.length <= 1;

        const modifierListInfo = (obj.item_data && obj.item_data.modifier_list_info) || [];
        const modifierLists = modifierListInfo
          .filter(info => info.enabled !== false)
          .map(info => {
            const list = modifierListsById[info.modifier_list_id];
            if (!list || !list.modifier_list_data) return null;
            const overridesById = {};
            (info.modifier_overrides || []).forEach(ov => { overridesById[ov.modifier_id] = ov; });
            const options = (list.modifier_list_data.modifiers || []).map(m => {
              const md = m.modifier_data || {};
              const pm = md.price_money;
              const override = overridesById[m.id];
              return {
                id: m.id,
                name: md.name || 'Option',
                price: pm && pm.amount ? pm.amount / 100 : 0,
                onByDefault: override ? !!override.on_by_default : !!md.on_by_default,
              };
            });
            if (!options.length) return null;
            return { id: list.id, name: list.modifier_list_data.name || 'Options', options };
          })
          .filter(Boolean);

        variations.forEach(v => {
          const vd = v.item_variation_data || {};
          const priceMoney = vd.price_money;
          // Items set to "variable pricing" in Square (priced at the register, e.g. by
          // metal/stone combo) have no price_money at all — don't show that as a real $0.
          const hasFixedPrice = vd.pricing_type !== 'VARIABLE_PRICING' && !!(priceMoney && priceMoney.amount);
          const basePrice = hasFixedPrice ? priceMoney.amount / 100 : 0;
          // Only show the variation name when there's more than one variation to tell
          // apart — a lone variation's name is often a stray default (e.g. "Size 2")
          // with nothing to disambiguate, not a real size/option worth surfacing.
          const varName = (variations.length > 1 && vd.name && vd.name !== 'Regular') ? vd.name : '';
          rows.push({
            squareItemId: obj.id,
            squareVariationId: v.id,
            name: varName ? itemName + ' — ' + varName : itemName,
            sku: vd.sku || '',
            basePrice,
            price: basePrice,
            hasFixedPrice,
            modifierLists,
            isRing,
            isStackable,
            noSquareSize,
          });
        });
      });
      oiRenderResults(idx, rows, query);
    });
  }).catch(() => oiRenderResults(idx, [], query))
    .then(() => { if (spinner) spinner.style.display = 'none'; });
}

function oiRenderResults(idx, items, query) {
  _oiLastResults[idx] = items;
  const box = document.getElementById('oi-results-' + idx);
  if (!box) return;
  if (!items.length) {
    const safeQ = (query || '').replace(/</g, '&lt;');
    box.innerHTML = `<div class="rq-result-none">No Square match for "${safeQ}" — use Manual Item instead</div>`;
    box.style.display = 'flex';
    return;
  }
  box.innerHTML = items.map((it, i) => {
    const hasOptions = it.modifierLists && it.modifierLists.length;
    const metaParts = [];
    if (it.sku) metaParts.push('SKU ' + it.sku.replace(/</g, '&lt;'));
    if (hasOptions) metaParts.push((it.modifierLists.length === 1 ? it.modifierLists[0].options.length + ' options' : it.modifierLists.length + ' option groups'));
    return `
    <div class="rq-result-item" onclick="oiSelectSquareResult(${idx}, ${i})">
      <div><div class="rq-result-name">${(it.name || '').replace(/</g, '&lt;')}</div>
      <div class="rq-result-meta">${metaParts.join(' · ')}</div></div>
      <div class="rq-result-price">${it.hasFixedPrice ? '$' + it.price.toFixed(2) + (hasOptions ? '+' : '') : 'Variable price'}</div>
    </div>`;
  }).join('');
  box.style.display = 'flex';
  // In the Edit Order modal (a long single-scrolling container) a newly
  // revealed results panel can land below the fold with no auto-scroll —
  // bring it into view. Restock Queue's own .rq-setup-results instances
  // live outside #editOrderModalBg, so they're untouched by this.
  if (box.closest('#editOrderModalBg')) {
    requestAnimationFrame(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }
}

function oiSelectSquareResult(idx, i) {
  const item = (_oiLastResults[idx] || [])[i];
  if (!item || !_oiItems[idx]) return;
  const modifierLists = item.modifierLists || [];
  const selectedModifierIds = {};
  modifierLists.forEach(list => {
    const def = list.options.find(o => o.onByDefault) || list.options[0];
    if (def) selectedModifierIds[list.id] = def.id;
  });
  const newItem = {
    type: 'square',
    name: item.name,
    sku: item.sku,
    basePrice: item.hasFixedPrice ? item.basePrice : 0,
    hasFixedPrice: !!item.hasFixedPrice,
    modifierLists,
    selectedModifierIds,
    squareItemId: item.squareItemId,
    squareVariationId: item.squareVariationId,
    isRing: !!item.isRing,
    isStackable: !!item.isStackable,
    noSquareSize: !!item.noSquareSize,
    ringSize: '',
  };
  newItem.price = item.hasFixedPrice ? _oiComputeSquarePrice(newItem) : '';
  _oiItems[idx] = newItem;
  oiRender();
}

// Sums the base variation price plus whichever modifier (metal, single/double, etc.)
// is currently selected in each modifier list attached to the item.
function _oiComputeSquarePrice(it) {
  const base = parseFloat(it.basePrice) || 0;
  const lists = it.modifierLists || [];
  const selected = it.selectedModifierIds || {};
  const modifierTotal = lists.reduce((sum, list) => {
    const optId = selected[list.id];
    const opt = list.options.find(o => o.id === optId);
    return sum + (opt ? opt.price : 0);
  }, 0);
  return base + modifierTotal;
}

function oiSetModifier(idx, listId, modifierId) {
  const it = _oiItems[idx];
  if (!it) return;
  it.selectedModifierIds = it.selectedModifierIds || {};
  it.selectedModifierIds[listId] = modifierId;
  it.price = _oiComputeSquarePrice(it);
  oiRender();
}

// ════════════════════════════════════════════

//  ESTIMATE BUILDER
//  Visibility is driven by the order-type module (js/orders.js's
//  eoApplyOrderTypeModule) — the Estimate Builder shows in place of Items &
//  Price for Custom/Etsy/Website order types and is not reachable otherwise.
// ════════════════════════════════════════════
let estMultiplier = 2.5;
let estRowCount   = 0;
let estSaveTimer  = null;

function addMaterialRow(desc = '', cost = '') {
  const container = document.getElementById('est-materials');
  if (!container) return;
  const rowId = 'est-row-' + (++estRowCount);
  const div = document.createElement('div');
  div.id        = rowId;
  div.className = 'est-row';
  div.innerHTML =
    '<input class="est-input" type="text" placeholder="e.g. 14k Yellow Gold Sheet" oninput="calcEstimate()">' +
    // StullerSearch (js/stuller.js) is only loaded by the main app — guarded so intake.html doesn't throw
    '<button class="est-stuller-btn eo-edit-only" title="Search Stuller catalog" onclick="window.StullerSearch&&StullerSearch.open(\'' + rowId + '\')">🔍</button>' +
    '<input class="est-input est-cost-input" type="number" placeholder="0.00" step="0.01" min="0" oninput="calcEstimate()">' +
    '<button class="est-remove-btn eo-edit-only" onclick="removeMaterialRow(\'' + rowId + '\')">&#215;</button>';
  container.appendChild(div);
  const inputs = div.querySelectorAll('input');
  if (desc) inputs[0].value = desc;
  if (cost) inputs[1].value = cost;
  calcEstimate();
}

function populateEstimateFromOrder(o) {
  const container = document.getElementById('est-materials');
  if (!container) return;
  container.innerHTML = '';
  estRowCount = 0;

  const lines = (o.materials || '').split('\n').filter(l => l.trim());
  if (lines.length) {
    lines.forEach(line => {
      const match = line.match(/^(.*?) — \$(\d+\.?\d*)$/);
      if (match) addMaterialRow(match[1].trim(), match[2]);
      else        addMaterialRow(line.trim(), '');
    });
  } else {
    addMaterialRow();
  }

  // Restore labor, shipping, tax + multiplier from localStorage (not synced to Notion)
  let estState = {};
  try { estState = JSON.parse(localStorage.getItem('sts-est-state') || '{}'); } catch(e) {}
  const saved = estState[o.id] || {};
  const laborEl = document.getElementById('est-labor');
  if (laborEl) laborEl.value = saved.labor != null ? saved.labor : '';
  const shippingEl = document.getElementById('est-shipping');
  if (shippingEl) shippingEl.value = saved.shipping != null ? saved.shipping : '';
  const taxToggle = document.getElementById('est-tax-toggle');
  if (taxToggle) taxToggle.checked = saved.taxOn || false;
  setMultiplier(saved.multiplier || 2.5);
  // Visibility of #eo-estimate-module is owned by the order-type module
  // (js/orders.js's eoApplyOrderTypeModule), not by this function.
}

function removeMaterialRow(id) {
  const el = document.getElementById(id);
  if (el) { el.remove(); calcEstimate(); }
}

function calcEstimate() {
  const rows = document.querySelectorAll('#est-materials .est-row');
  let matTotal = 0;
  rows.forEach(row => { matTotal += parseFloat(row.querySelectorAll('input')[1]?.value) || 0; });
  const labor    = parseFloat(document.getElementById('est-labor')?.value) || 0;
  const shipping = parseFloat(document.getElementById('est-shipping')?.value) || 0;
  const subtotal = matTotal + labor;
  const marked   = subtotal * estMultiplier;
  const taxOn    = document.getElementById('est-tax-toggle')?.checked || false;
  const tax      = taxOn ? marked * 0.0825 : 0;
  const final    = marked + shipping + tax;
  const fmt = n => '$' + n.toFixed(2);
  const g = id => document.getElementById(id);
  if (g('est-mat-total'))     g('est-mat-total').textContent     = fmt(matTotal);
  if (g('est-labor-display')) g('est-labor-display').textContent = fmt(labor);
  if (g('est-subtotal'))      g('est-subtotal').textContent      = fmt(subtotal);
  if (g('est-final'))         g('est-final').textContent         = fmt(final);
  const shippingRow = g('est-shipping-row');
  if (shippingRow) shippingRow.style.display = shipping > 0 ? '' : 'none';
  if (g('est-shipping-display')) g('est-shipping-display').textContent = fmt(shipping);
  const taxRow = g('est-tax-row');
  if (taxRow) taxRow.style.display = taxOn ? '' : 'none';
  if (g('est-tax-display')) g('est-tax-display').textContent = fmt(tax);

  // When the Estimate module is the active pricing display (Custom/Etsy/
  // Website order types), its Final Estimate feeds Total ($) directly —
  // otherwise Total ($) is driven by oiRecalcTotal() from the Order Items list.
  const estModule = g('eo-estimate-module');
  if (estModule && estModule.style.display !== 'none') {
    const priceEl = g('f-price');
    if (priceEl) priceEl.value = final ? final.toFixed(2) : '';
    if (typeof eoUpdateBalanceDue === 'function') eoUpdateBalanceDue();
  }

  // Auto-save to Notion when editing an existing order
  const editingId = document.getElementById('f-editing-id')?.value;
  if (editingId) {
    clearTimeout(estSaveTimer);
    estSaveTimer = setTimeout(saveEstimateToNotion, 1400);
  }
}

async function saveEstimateToNotion() {
  const editingId = document.getElementById('f-editing-id')?.value;
  if (!editingId) return;
  const o = ORDERS.find(x => x.id === editingId);
  if (!o || !o.notionId) return;

  // Build materials text from rows
  const rows = document.querySelectorAll('#est-materials .est-row');
  const lines = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc = inputs[0]?.value.trim();
    const cost = parseFloat(inputs[1]?.value) || 0;
    if (desc || cost) lines.push(desc + (cost ? ' — $' + cost.toFixed(2) : ''));
  });
  const materialsText = lines.join('\n');
  const finalEl = document.getElementById('est-final');
  const finalPrice = parseFloat(finalEl?.textContent?.replace('$', '')) || 0;

  o.materials = materialsText;
  if (finalPrice > 0) o.price = finalPrice;
  saveToStorage();

  // Persist labor, shipping, tax + multiplier locally so they survive a page refresh
  try {
    const estState = JSON.parse(localStorage.getItem('sts-est-state') || '{}');
    estState[editingId] = {
      labor:      parseFloat(document.getElementById('est-labor')?.value) || 0,
      shipping:   parseFloat(document.getElementById('est-shipping')?.value) || 0,
      taxOn:      document.getElementById('est-tax-toggle')?.checked || false,
      multiplier: estMultiplier,
    };
    localStorage.setItem('sts-est-state', JSON.stringify(estState));
  } catch(e) {}

  const statusEl = document.getElementById('est-save-status');
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.opacity = '1'; }
  try {
    await notionUpdateOrder(o);
    if (statusEl) {
      statusEl.textContent = '✓ Saved to Notion';
      setTimeout(() => { statusEl.style.opacity = '0'; }, 2000);
    }
  } catch(e) {
    console.warn('estimate auto-save failed', e);
    if (statusEl) { statusEl.textContent = '⚠ Save failed'; }
  }
}

function setMultiplier(val) {
  estMultiplier = val;
  document.querySelectorAll('.mult-btn').forEach(b => b.classList.remove('selected'));
  const btn = document.getElementById('mult-' + String(val).replace('.', '-'));
  if (btn) btn.classList.add('selected');
  const hint = document.getElementById('est-formula-hint');
  if (hint) hint.textContent = '(Materials + Labor) × ' + val;
  calcEstimate();
}

function approveEstimate() {
  // Square invoice plumbing (_gtSqCall etc.) lives in js/gmail.js, which only
  // the main app loads — on intake.html estimates are saved, not sent.
  if (typeof _gtSqCall !== 'function') { toast('Sending to Square is available from the main app', '⚠️'); return; }
  const customerEmail = document.getElementById('f-email')?.value.trim() || '';
  const customerName  = getFullName() || 'Customer';
  const jobDesc = jdGetJobDescValue();
  const notes   = document.getElementById('f-customer-notes')?.value.trim() || '';

  if (!customerEmail) { toast('Add a customer email first.', '⚠️'); return; }
  if (!_gtSqLocation()) { toast('No Square Location ID — add it in ⚙ Integrations.', '⚠️'); return; }

  // Collect line items from the estimate builder
  const items = [];
  document.querySelectorAll('#est-materials .est-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc   = inputs[0]?.value.trim() || '';
    const cost   = parseFloat(inputs[1]?.value) || 0;
    if (desc && cost > 0) items.push({ name: desc, price: cost });
  });

  const labor    = parseFloat(document.getElementById('est-labor')?.value)    || 0;
  const shipping = parseFloat(document.getElementById('est-shipping')?.value) || 0;
  if (labor    > 0) items.push({ name: 'Labor',    price: labor });
  if (shipping > 0) items.push({ name: 'Shipping', price: shipping });

  if (!items.length) { toast('Add at least one material or labor cost.', '⚠️'); return; }

  const btn = document.querySelector('#eo-estimate-module .btn-green');
  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }

  const reset = () => { if (btn) { btn.textContent = '✓ Approve & Send to Square'; btn.disabled = false; } };

  _gtSqCall('/v2/customers/search', 'POST', {
    query: { filter: { email_address: { exact: customerEmail } } }
  })
  .then(d => {
    if (d.customers && d.customers.length) return d.customers[0].id;
    const parts = customerName.split(' ');
    return _gtSqCall('/v2/customers', 'POST', {
      idempotency_key: 'sts-cust-' + customerEmail.replace(/\W/g, '') + Date.now(),
      given_name:    parts[0] || customerName,
      family_name:   parts.slice(1).join(' ') || '',
      email_address: customerEmail
    }).then(d2 => {
      if (d2.customer) return d2.customer.id;
      throw new Error(((d2.errors || [])[0] || {}).detail || 'Could not create customer');
    });
  })
  .then(customerId => {
    return _gtSqCall('/v2/orders', 'POST', {
      idempotency_key: 'sts-ord-est-' + Date.now(),
      order: {
        location_id: _gtSqLocation(),
        customer_id: customerId,
        line_items:  items.map(item => ({
          name: item.name,
          quantity: '1',
          base_price_money: { amount: Math.round(item.price * 100), currency: 'USD' }
        }))
      }
    }).then(d3 => {
      if (d3.order) return { customerId, orderId: d3.order.id };
      throw new Error(((d3.errors || [])[0] || {}).detail || 'Could not create order');
    });
  })
  .then(ids => {
    const title   = jobDesc ? jobDesc : 'Custom Order Estimate — ' + customerName;
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const invoice = {
      location_id:       _gtSqLocation(),
      order_id:          ids.orderId,
      primary_recipient: { customer_id: ids.customerId },
      delivery_method:   'SHARE_MANUALLY',
      title:             title,
      payment_requests:  [{ request_type: 'BALANCE', due_date: dueDate, automatic_payment_source: 'NONE' }],
      accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false },
    };
    if (notes) invoice.description = notes;
    return _gtSqCall('/v2/invoices', 'POST', {
      idempotency_key: 'sts-inv-est-' + Date.now(),
      invoice
    });
  })
  .then(d4 => {
    reset();
    if (d4.invoice) {
      const url = 'https://squareup.com/dashboard/invoices/' + d4.invoice.id;
      toast('Estimate draft created! <a href="' + url + '" target="_blank" style="color:inherit;text-decoration:underline;">Review in Square →</a>', '✅', 8000);
    } else {
      throw new Error(((d4.errors || [])[0] || {}).detail || 'Estimate creation failed');
    }
  })
  .catch(e => {
    reset();
    toast('Square error: ' + (e.message || 'Unknown error'), '⚠️', 6000);
  });
}

function clearEstimate() {
  const container = document.getElementById('est-materials');
  if (container) container.innerHTML = '';
  estRowCount = 0;
  const laborEl = document.getElementById('est-labor');
  if (laborEl) laborEl.value = '';
  const shippingEl = document.getElementById('est-shipping');
  if (shippingEl) shippingEl.value = '';
  const taxToggle = document.getElementById('est-tax-toggle');
  if (taxToggle) taxToggle.checked = false;
  calcEstimate();
  addMaterialRow();
}
