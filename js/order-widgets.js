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
  // intake.html's Items & Price Shipping ($) field is tied to this same toggle.
  if (typeof intakeUpdateShippingField === 'function') intakeUpdateShippingField();
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

// Repair/Resize orders are manual-item-only — no per-row Square/Manual
// choice. Checks the Edit Order modal's module flag first, then falls back
// to intake.html's Order Type dropdown.
function _oiManualOnlyType() {
  if (typeof _eoOrderTypeModule !== 'undefined') return _eoOrderTypeModule === 'repair' || _eoOrderTypeModule === 'resize';
  const type = document.getElementById('f-order-type')?.value;
  return type === 'repair' || type === 'resize';
}

function oiRender() {
  const containerId    = _oiActiveContainerId();
  const hideTypeSelect = containerId !== 'oi-items-container' || _oiManualOnlyType();
  const readOnly       = typeof _eoMode !== 'undefined' && _eoMode === 'view';
  const box = document.getElementById(containerId);
  if (box) {
    const emptyMsg = containerId === 'oi-items-container'
      ? (hideTypeSelect ? 'No items yet — add an item.' : 'No items yet — add a manual item or a Square item.')
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
    body = `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input type="text" placeholder="Item name" value="${(it.name || '').replace(/"/g, '&quot;')}" oninput="oiUpdateField(${idx},'name',this.value)" style="flex:1 1 120px;min-width:0;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;box-sizing:border-box;">
        <input type="number" step="1" min="1" placeholder="Qty" value="${it.quantity || 1}" oninput="oiUpdateField(${idx},'quantity',parseInt(this.value,10)||1)" style="width:60px;flex:0 0 60px;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;box-sizing:border-box;">
        <input type="number" step="0.01" min="0" placeholder="0.00" value="${it.price || ''}" oninput="oiUpdateField(${idx},'price',parseFloat(this.value)||0)" style="width:100px;flex:0 0 100px;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;box-sizing:border-box;">
      </div>
      ${needsRingSize ? `<div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#7A7268;flex-shrink:0;">Ring Size</label>
        <input type="text" placeholder="e.g. 6.5" value="${(it.ringSize || '').replace(/"/g, '&quot;')}" oninput="oiUpdateField(${idx},'ringSize',this.value)" style="width:90px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;font-size:12px;">
      </div>` : ''}
    </div>`;
  }

  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid var(--bdr-light);border-radius:8px;padding:8px;background:var(--card-bg);box-sizing:border-box;">
    ${typeSel}
    ${body}
    <button type="button" class="rq-item-remove eo-edit-only" title="Remove item" onclick="oiRemoveItem(${idx})" style="font-size:16px;flex-shrink:0;">✕</button>
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
// Markup slider steps (desktop estimate builder): slider index → multiplier.
const EST_MULT_STEPS = [1, 1.5, 2, 2.5, 3];
function setMultiplierFromSlider(idx) {
  const val = EST_MULT_STEPS[parseInt(idx, 10)];
  setMultiplier(val != null ? val : 2.5);
}
let estRowCount   = 0;
let estSaveTimer  = null;
// True while populateEstimateFromOrder() rebuilds the module from a saved
// order — calcEstimate() then refreshes the DISPLAY only, without writing
// Total ($) or arming the Notion auto-save. Without this, merely OPENING a
// custom order in the Edit modal recomputed (and silently re-synced) its
// price from whatever estimate state this device happened to have.
let _estPopulating = false;

// ── Markup baked into each material row's Cost box ──────────────
// The markup multiplier no longer marks up the subtotal; instead each
// material row's Cost box DISPLAYS base × estMultiplier, while the raw
// (pre-markup) cost lives in input.dataset.base — the canonical value every
// calculator/serializer reads via estCostBase(). Labor is never marked up.
// (2026-07 — replaces the old "(materials + labor) × mult" subtotal markup.)
function estCostBase(inp) {
  if (!inp) return 0;
  const b = inp.dataset ? inp.dataset.base : undefined;
  if (b !== undefined && b !== '') return parseFloat(b) || 0;
  return parseFloat(inp.value) || 0;   // legacy row with no dataset.base yet
}
function estRebakeCost(inp) {
  if (!inp) return;
  const b = parseFloat(inp.dataset.base);
  inp.value = (b > 0) ? (b * estMultiplier).toFixed(2) : (inp.dataset.base ? inp.dataset.base : '');
}
function estRebakeAllCosts() {
  document.querySelectorAll('#est-materials .est-cost-input').forEach(inp => {
    if (inp !== document.activeElement) estRebakeCost(inp);
  });
}
// Cost box shows the raw base while focused (so you edit the pre-markup cost),
// and the marked amount when it loses focus.
function estCostFocus(inp) {
  if (inp.dataset.base !== undefined && inp.dataset.base !== '') inp.value = inp.dataset.base;
}
function estCostInput(inp) {
  inp.dataset.base = inp.value;
  // Programmatic fills (e.g. Stuller) dispatch 'input' without focusing —
  // bake the markup in immediately so the box shows the marked amount.
  if (inp !== document.activeElement) estRebakeCost(inp);
  calcEstimate();
}
function estCostBlur(inp) {
  estRebakeCost(inp);
}

// Provenance labels for calculator-sourced rows — used for the row's tooltip
// and to recognize which rows estRepriceFromLibrary() can recompute.
const EST_SOURCE_LABEL = {
  'metal-weight':  '🔩 From Ring Blank → Metal Cost calculator',
  'metal-direct':  '⚖️ From Metal Weight → Cost calculator',
  'resize':        '↔️ From Ring Resize calculator',
  'stone-setting': '💎 From Stone Setting calculator',
  'chain':         '⛓️ From Chain / Pendant calculator',
};
// Marks a row as calculator-derived (subtle gold inset stripe + tooltip). Uses
// box-shadow so it never shifts the .est-row grid columns.
function _estApplyRowProvenance(div, source) {
  const isCalc = source && source !== 'manual' && EST_SOURCE_LABEL[source];
  div.dataset.source = source || 'manual';
  if (isCalc) {
    div.title = EST_SOURCE_LABEL[source];
    div.style.boxShadow = 'inset 3px 0 0 #C8A24B';
    div.dataset.calcRow = '1';
  } else {
    div.title = '';
    div.style.boxShadow = '';
    delete div.dataset.calcRow;
  }
}

// `meta` (optional) records where a row came from: { source, kind, calcInputs }.
// Calculator "Add to estimate" handlers pass it so the row remembers what it was
// computed from — enabling the provenance badge and estRepriceFromLibrary(). A
// row with no meta is a plain manual line (source 'manual').
function addMaterialRow(desc = '', cost = '', qty = '', meta = null) {
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
    '<input class="est-input est-cost-input" type="number" placeholder="0.00" step="0.01" min="0" onfocus="estCostFocus(this)" oninput="estCostInput(this)" onblur="estCostBlur(this)">' +
    '<button class="est-remove-btn eo-edit-only" onclick="removeMaterialRow(\'' + rowId + '\')">&#215;</button>';
  container.appendChild(div);
  const inputs = div.querySelectorAll('input');
  if (desc) inputs[0].value = desc;
  // `cost` is the raw pre-markup base; store it and display base × multiplier.
  if (cost !== '' && cost != null) { inputs[1].dataset.base = String(cost); estRebakeCost(inputs[1]); }
  // Provenance (additive — manual rows just get source 'manual').
  if (meta && meta.kind) div.dataset.kind = meta.kind;
  if (meta && meta.calcInputs) { try { div.dataset.calc = JSON.stringify(meta.calcInputs); } catch (e) {} }
  _estApplyRowProvenance(div, meta && meta.source);
  calcEstimate();
}

function populateEstimateFromOrder(o) {
  const container = document.getElementById('est-materials');
  if (!container) return;
  const prevPopulating = _estPopulating;
  _estPopulating = true;
  try {
    container.innerHTML = '';
    estRowCount = 0;

    // Prefer the structured lines[] (carries per-row provenance) when the order
    // has it; fall back to parsing the legacy o.materials text for older orders.
    const structured = (o.estimate && Array.isArray(o.estimate.lines)) ? o.estimate.lines : null;
    if (structured && structured.length) {
      structured.forEach(l => {
        addMaterialRow(l.label || '', (l.cost != null ? l.cost : ''), '', {
          source: l.source || 'manual', kind: l.kind || 'material', calcInputs: l.calcInputs || null,
        });
      });
    } else {
      const lines = (o.materials || '').split('\n').filter(l => l.trim());
      if (lines.length) {
        lines.forEach(line => {
          const match = line.match(/^(.*?) — \$(\d+\.?\d*)$/);
          if (match) {
            // Split an optional "×N" cost-multiplier suffix off the description.
            const qm = match[1].trim().match(/^(.*?)\s*×\s*(\d+\.?\d*)$/);
            if (qm) addMaterialRow(qm[1].trim(), match[2], qm[2]);
            else    addMaterialRow(match[1].trim(), match[2]);
          }
          else addMaterialRow(line.trim(), '');
        });
      } else {
        addMaterialRow();
      }
    }

    // Labor, shipping, tax, multiplier + adjustment: prefer the estimate
    // state saved ON the order (written at intake and by Save Estimate —
    // travels with the order across devices via Notion App Data); fall back
    // to the legacy per-device localStorage stash for older orders.
    let estState = {};
    try { estState = JSON.parse(localStorage.getItem('sts-est-state') || '{}'); } catch(e) {}
    const saved = (o.estimate && typeof o.estimate === 'object') ? o.estimate : (estState[o.id] || {});
    const laborEl = document.getElementById('est-labor');
    if (laborEl) laborEl.value = saved.labor != null && saved.labor !== '' ? saved.labor : '';
    const shippingEl = document.getElementById('est-shipping');
    if (shippingEl) shippingEl.value = saved.shipping != null && saved.shipping !== '' ? saved.shipping : '';
    const taxToggle = document.getElementById('est-tax-toggle');
    if (taxToggle) taxToggle.checked = saved.taxOn || false;
    const adjEl = document.getElementById('est-adjustment');
    if (adjEl) adjEl.value = saved.adjustment ? saved.adjustment : '';
    setMultiplier(saved.multiplier || 2.5);
    // Visibility of #eo-estimate-module is owned by the order-type module
    // (js/orders.js's eoApplyOrderTypeModule), not by this function.
    // Restore the calculator panel's branch context from the order (order
    // type + piece type are already set in the DOM by eoPopulateFields), so
    // the right calculators are showing when the module opens.
    _estCalcCtx.category = document.getElementById('f-order-type')?.value || saved.category || 'order';
    _estCalcCtx.itemType = document.getElementById('f-piece-type')?.value || saved.itemType || '';
    if (typeof estCalcRender === 'function') estCalcRender();
    // Flag any metal lines whose quoted price has since moved (async, non-blocking).
    if (typeof estCheckStalePrices === 'function') estCheckStalePrices();
  } finally {
    _estPopulating = prevPopulating;
  }
}

function removeMaterialRow(id) {
  const el = document.getElementById(id);
  if (el) { el.remove(); calcEstimate(); }
}

function calcEstimate() {
  const rows = document.querySelectorAll('#est-materials .est-row');
  let matTotal = 0;
  rows.forEach(row => {
    const ins  = row.querySelectorAll('input');
    matTotal += estCostBase(ins[1]);   // raw, pre-markup
  });
  const labor    = parseFloat(document.getElementById('est-labor')?.value) || 0;
  const shipping = parseFloat(document.getElementById('est-shipping')?.value) || 0;
  // Adjustment ($, negative = discount) folds in AFTER markup, BEFORE tax —
  // same math as the intake's rounding/nudge controls, so a price adjusted
  // on the iPad reproduces exactly here. The #est-adjustment input only
  // exists in the desktop module; intake keeps its own wrapper (_estAdj).
  const adjustment = parseFloat(document.getElementById('est-adjustment')?.value) || 0;
  // Markup applies to materials ONLY; labor is added un-marked on top.
  const matMarked = matTotal * estMultiplier;
  const subtotal  = matMarked + labor;
  const adjusted  = subtotal + adjustment;
  const taxOn    = document.getElementById('est-tax-toggle')?.checked || false;
  const tax      = taxOn ? adjusted * 0.0825 : 0;
  const final    = adjusted + shipping + tax;
  const fmt = n => '$' + n.toFixed(2);
  const g = id => document.getElementById(id);
  if (g('est-mat-total'))     g('est-mat-total').textContent     = fmt(matMarked);
  if (g('est-labor-display')) g('est-labor-display').textContent = fmt(labor);
  if (g('est-subtotal'))      g('est-subtotal').textContent      = fmt(subtotal);
  if (g('est-final'))         g('est-final').textContent         = fmt(final);
  const shippingRow = g('est-shipping-row');
  if (shippingRow) shippingRow.style.display = shipping > 0 ? '' : 'none';
  if (g('est-shipping-display')) g('est-shipping-display').textContent = fmt(shipping);
  const adjRowEo = g('est-adj-row-eo');
  if (adjRowEo) adjRowEo.style.display = adjustment ? '' : 'none';
  if (g('est-adj-display-eo')) g('est-adj-display-eo').textContent = (adjustment < 0 ? '−$' : '+$') + Math.abs(adjustment).toFixed(2);
  const taxRow = g('est-tax-row');
  if (taxRow) taxRow.style.display = taxOn ? '' : 'none';
  if (g('est-tax-display')) g('est-tax-display').textContent = fmt(tax);

  // Margin guardrail — profit vs. raw material cost (labor + markup count as
  // margin, the maker's value-add). Excludes shipping/tax (pass-through). Red
  // below the shop margin floor, green at/above target (both from shop settings).
  const marginRow = g('est-margin-row');
  const marginEl  = g('est-margin-display');
  if (marginRow && marginEl) {
    const priceForMargin = adjusted;   // pre-tax, pre-shipping customer price
    const costBasis = matTotal;        // raw supplier cost of materials
    if (priceForMargin > 0 && (matMarked > 0 || labor > 0)) {
      const marginPct = (priceForMargin - costBasis) / priceForMargin * 100;
      const s = (typeof estShopSettings === 'function') ? estShopSettings() : {};
      const floor  = typeof s.marginFloorPct === 'number' ? s.marginFloorPct : null;
      const target = typeof s.targetMarginPct === 'number' ? s.targetMarginPct : null;
      marginRow.style.display = '';
      marginEl.textContent = marginPct.toFixed(0) + '%';
      marginEl.style.color = (floor != null && marginPct < floor) ? '#C0392B'
                           : (target != null && marginPct >= target) ? '#2E7D32' : '';
      const note = g('est-margin-note');
      if (note) note.textContent = (floor != null && marginPct < floor) ? '⚠ below ' + floor + '% floor' : '';
    } else {
      marginRow.style.display = 'none';
    }
  }

  // Populating the module from a saved order is display-only: never write
  // Total ($) and never arm the auto-save from a programmatic rebuild.
  if (_estPopulating) return;

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

// Serializes the Materials Description/Cost rows (#est-materials) into the
// "desc — $cost" text format stored in o.materials — shared by the
// dedicated Save Estimate button and the main Save Changes button so
// entered Cost values persist either way.
function estCollectMaterialsText() {
  const rows = document.querySelectorAll('#est-materials .est-row');
  const lines = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc = inputs[0]?.value.trim();
    const cost = estCostBase(inputs[1]);   // persist the raw base, not the marked display
    if (desc || cost) lines.push(desc + (cost ? ' — $' + cost.toFixed(2) : ''));
  });
  return lines.join('\n');
}

// Structured sibling of estCollectMaterialsText(): the same rows, but as an
// array that keeps each line's provenance (which calculator produced it + the
// inputs it was computed from). Derived from the SAME DOM rows and the SAME raw
// cost basis (estCostBase) as the text serializer, so the two can never drift.
// Additive — o.materials remains the source of truth for Notion/Square/print.
function estCollectLines() {
  const rows = document.querySelectorAll('#est-materials .est-row');
  const out = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const label = (inputs[0]?.value || '').trim();
    const cost  = estCostBase(inputs[1]);
    if (!label && !cost) return;
    const line = {
      label: label,
      cost: cost,
      kind: row.dataset.kind || 'material',
      source: row.dataset.source || 'manual',
    };
    if (row.dataset.calc) { try { line.calcInputs = JSON.parse(row.dataset.calc); } catch (e) {} }
    out.push(line);
  });
  return out;
}

async function saveEstimateToNotion() {
  const editingId = document.getElementById('f-editing-id')?.value;
  if (!editingId) return;
  const o = ORDERS.find(x => x.id === editingId);
  if (!o || !o.notionId) return;

  const materialsText = estCollectMaterialsText();
  const finalEl = document.getElementById('est-final');
  const finalPrice = parseFloat(finalEl?.textContent?.replace('$', '')) || 0;

  o.materials = materialsText;
  if (finalPrice > 0) o.price = finalPrice;
  // Estimate state lives ON the order (synced via Notion App Data) so any
  // device reproduces this exact total — the localStorage stash below is
  // kept only as a fallback for orders saved before o.estimate existed.
  o.estimate = {
    labor:      parseFloat(document.getElementById('est-labor')?.value) || 0,
    shipping:   parseFloat(document.getElementById('est-shipping')?.value) || 0,
    taxOn:      document.getElementById('est-tax-toggle')?.checked || false,
    multiplier: estMultiplier,
    adjustment: parseFloat(document.getElementById('est-adjustment')?.value) || 0,
    // Branch the estimate was built for (category-first flow). Additive —
    // legacy orders simply lack these keys; nothing reads them destructively.
    category:   document.getElementById('f-order-type')?.value || _estCalcCtx.category || 'order',
    itemType:   document.getElementById('f-piece-type')?.value || _estCalcCtx.itemType || '',
    // Structured line items with per-row provenance (parallel to o.materials).
    lines:      estCollectLines(),
  };
  saveToStorage();

  // Persist labor, shipping, tax + multiplier locally so they survive a page refresh
  try {
    const estState = JSON.parse(localStorage.getItem('sts-est-state') || '{}');
    estState[editingId] = { ...o.estimate };
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
  // Legacy button toggle (intake still uses buttons) — harmless where absent.
  document.querySelectorAll('.mult-btn').forEach(b => b.classList.remove('selected'));
  const btn = document.getElementById('mult-' + String(val).replace('.', '-'));
  if (btn) btn.classList.add('selected');
  // Slider (desktop estimate builder): sync thumb position + readout.
  const slider = document.getElementById('est-mult-slider');
  if (slider) { const i = EST_MULT_STEPS.indexOf(val); if (i >= 0) slider.value = i; }
  const valEl = document.getElementById('est-mult-value');
  if (valEl) valEl.textContent = val + '×';
  const hint = document.getElementById('est-formula-hint');
  if (hint) hint.textContent = 'Materials × ' + val + ' + Labor';
  estRebakeAllCosts();
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
    const cost   = estCostBase(inputs[1]) * estMultiplier;  // marked (customer-facing) price
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

// ════════════════════════════════════════════
//  ESTIMATE CALCULATORS (UI wiring)
//  The category-first estimate flow: the order type (Custom / Repair /
//  Resize) and the item type (Ring / Pendant / Earrings …) decide which
//  calculators surface in the Estimate Builder. The math itself is pure and
//  lives in js/estimate-calc.js (EstimateCalc.*); this wiring reads the DOM,
//  resolves a live metal price from the Materials Library, and — via
//  "＋ Add to estimate" — pushes a labeled, hand-editable row into the
//  existing materials list (addMaterialRow), so calculator output flows
//  through the same o.materials persistence and Square/Notion paths as a
//  manually-typed line. Rendered into a single #est-calc-panel container so
//  the desktop modal and the intake wizard share one implementation.
// ════════════════════════════════════════════

// Current branch context, set by eoApplyOrderTypeModule (category) and the
// Piece Type change (itemType). Drives which calculators estCalcRender shows.
let _estCalcCtx = { category: 'order', itemType: '' };

// Metal price/ozt cache, resolved once from the Materials Library:
// shop-wide metalPricePerOzt map, overridden by any per-metal library row's
// currentCostPerUnit (normalized to per-ozt) — same precedence js/designs.js
// uses. "Not all yet": metals without a price stay undefined here and the UI
// prompts for a manual price rather than guessing.
let _estMetalPriceCache = null;
// Shop-wide settings (margin floor/target, hourly labor rate, metal prices)
// from /api/shop-settings — cached the first time prices load, reused by the
// margin guardrail and the labor-by-time calculator so they share one fetch.
let _estShopSettings = null;
function estShopSettings() { return _estShopSettings || {}; }
async function estCalcLoadMetalPrices() {
  if (_estMetalPriceCache) return _estMetalPriceCache;
  const prices = {};
  const G = (window.EstimateCalc && EstimateCalc.G_PER_OZT) || 31.1035;
  try {
    const s = await fetch('/api/shop-settings').then(r => r.json()).catch(() => ({}));
    if (s && !s.error) _estShopSettings = s;
    const shop = (s && !s.error && s.metalPricePerOzt) ? s.metalPricePerOzt : {};
    Object.keys(shop).forEach(k => { if (typeof shop[k] === 'number') prices[k] = shop[k]; });
    if (typeof _materialsApiFetch === 'function') {
      const mats = await _materialsApiFetch().catch(() => []);
      (mats || []).forEach(m => {
        if (!m || m.category !== 'metal' || !m.metalType) return;
        if (typeof m.currentCostPerUnit !== 'number') return;
        if (m.unit !== 'ozt' && m.unit !== 'gram') return;   // ignore foot/piece rows
        prices[m.metalType] = m.unit === 'gram' ? m.currentCostPerUnit * G : m.currentCostPerUnit;
      });
    }
  } catch (e) { /* offline / no library — user enters price manually */ }
  // Only cache a non-empty result, so a first load while offline doesn't
  // permanently block prefill — a later interaction retries the fetch.
  if (Object.keys(prices).length) _estMetalPriceCache = prices;
  return prices;
}

// Friendly metal picker — value is the Materials Library metalType key so the
// price lookup and EstimateCalc density both resolve. Extras beyond the three
// the library knows today (18k, sterling, platinum…) are here so the calc
// still works if you quote in them; they just won't auto-fill a price yet.
const EST_METAL_OPTIONS = [
  ['argentium', 'Argentium Silver'],
  ['sterling',  'Sterling Silver'],
  ['gold_fill', 'Gold-Filled'],
  ['10k',       '10k Gold'],
  ['14k',       '14k Gold'],
  ['18k',       '18k Gold'],
  ['platinum',  'Platinum'],
];

function estSetContext(category) {
  _estCalcCtx.category = category || 'order';
  estCalcRender();
}
function estSetItemType(itemType) {
  _estCalcCtx.itemType = itemType || '';
  estCalcRender();
}

function _estCalcMetalSelectHtml(id) {
  return '<select id="' + id + '" onchange="estCalcMetalPrefill(\'' + id + '\')" ' +
    'style="width:100%;padding:6px 8px;border:1px solid #d8cdb8;border-radius:6px;">' +
    EST_METAL_OPTIONS.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') +
    '</select>';
}
function _estCalcFieldHtml(label, inner) {
  return '<div style="flex:1 1 120px;min-width:110px;"><label style="display:block;font-size:11px;font-weight:600;color:#6b5f47;margin-bottom:3px;">' +
    label + '</label>' + inner + '</div>';
}
function _estCalcInput(id, attrs, oninput) {
  return '<input id="' + id + '" ' + (attrs || '') +
    ' oninput="' + (oninput || '') + '" ' +
    'style="width:100%;padding:6px 8px;border:1px solid #d8cdb8;border-radius:6px;box-sizing:border-box;">';
}

// Renders the calculator panel appropriate to the current branch context.
function estCalcRender() {
  const panel = document.getElementById('est-calc-panel');
  if (!panel) return;
  const ctx = _estCalcCtx;
  const isResize = ctx.category === 'resize';
  const itemType = ctx.itemType || '';
  const showChain = /pendant|necklace/i.test(itemType);

  const blocks = [];

  // Ring blank → metal cost (rings; also the natural tool for resize add-metal)
  blocks.push(
    '<details class="est-calc-block" ' + (itemType === 'Ring' || isResize ? 'open' : '') + ' style="margin-bottom:8px;">' +
      '<summary style="cursor:pointer;font-weight:600;font-size:13px;color:#4A3F2A;">🔩 Ring Blank → Metal Cost</summary>' +
      '<div style="padding:8px 0;display:flex;flex-wrap:wrap;gap:8px;">' +
        _estCalcFieldHtml('Metal', _estCalcMetalSelectHtml('ecm-metal')) +
        _estCalcFieldHtml('Price / ozt', _estCalcInput('ecm-price', 'type="number" step="0.01" min="0" placeholder="auto"', 'estCalcMetalCompute()')) +
        _estCalcFieldHtml('Ring Size', _estCalcInput('ecm-size', 'type="text" placeholder="7"', 'estCalcMetalCompute()')) +
        _estCalcFieldHtml('Gauge', _estCalcInput('ecm-gauge', 'type="text" placeholder="18ga"', 'estCalcMetalCompute()')) +
        _estCalcFieldHtml('Width (mm)', _estCalcInput('ecm-width', 'type="number" step="0.1" min="0" placeholder="4"', 'estCalcMetalCompute()')) +
        _estCalcFieldHtml('Profile', '<select id="ecm-profile" onchange="estCalcMetalCompute()" style="width:100%;padding:6px 8px;border:1px solid #d8cdb8;border-radius:6px;"><option value="Flat">Flat</option><option value="Round">Round</option></select>') +
        _estCalcFieldHtml('Allowance (mm)', _estCalcInput('ecm-allow', 'type="number" step="0.1" min="0" value="1"', 'estCalcMetalCompute()')) +
        _estCalcFieldHtml('Scrap %', _estCalcInput('ecm-scrap', 'type="number" step="1" min="0" value="0"', 'estCalcMetalCompute()')) +
      '</div>' +
      '<div id="ecm-result" style="font-size:13px;color:#2A3A46;margin:4px 0;">Enter ring size + gauge to calculate.</div>' +
      // For Ring orders the size/gauge/width/profile are already entered in
      // Design Details — pull them in instead of re-typing.
      (itemType === 'Ring' ? '<button class="btn btn-ghost btn-sm eo-edit-only" onclick="estCalcPullRingDims()" style="margin-right:6px;">⤵ Pull from ring details</button>' : '') +
      '<button class="btn btn-ghost btn-sm eo-edit-only" onclick="estCalcMetalAdd()">＋ Add to estimate</button>' +
    '</details>');

  // Labor by time (hours × shop hourly rate)
  blocks.push(
    '<details class="est-calc-block" style="margin-bottom:8px;">' +
      '<summary style="cursor:pointer;font-weight:600;font-size:13px;color:#4A3F2A;">🕒 Labor by Time</summary>' +
      '<div style="padding:8px 0;display:flex;flex-wrap:wrap;gap:8px;">' +
        _estCalcFieldHtml('Hours', _estCalcInput('ecl-hours', 'type="number" step="0.25" min="0" placeholder="1.5"', 'estCalcLaborCompute()')) +
        _estCalcFieldHtml('Rate / hr $', _estCalcInput('ecl-rate', 'type="number" step="1" min="0" placeholder="auto"', 'estCalcLaborCompute()')) +
      '</div>' +
      '<div id="ecl-result" style="font-size:13px;color:#2A3A46;margin:4px 0;">Enter hours to calculate.</div>' +
      '<button class="btn btn-ghost btn-sm eo-edit-only" onclick="estCalcLaborAdd()">＋ Add to Labor</button>' +
    '</details>');

  // Direct known-weight → cost (any metal piece)
  blocks.push(
    '<details class="est-calc-block" style="margin-bottom:8px;">' +
      '<summary style="cursor:pointer;font-weight:600;font-size:13px;color:#4A3F2A;">⚖️ Metal Weight → Cost</summary>' +
      '<div style="padding:8px 0;display:flex;flex-wrap:wrap;gap:8px;">' +
        _estCalcFieldHtml('Metal', _estCalcMetalSelectHtml('ecw-metal')) +
        _estCalcFieldHtml('Price / ozt', _estCalcInput('ecw-price', 'type="number" step="0.01" min="0" placeholder="auto"', 'estCalcWeightCompute()')) +
        _estCalcFieldHtml('Weight', _estCalcInput('ecw-weight', 'type="number" step="0.01" min="0" placeholder="0"', 'estCalcWeightCompute()')) +
        _estCalcFieldHtml('Unit', '<select id="ecw-unit" onchange="estCalcWeightCompute()" style="width:100%;padding:6px 8px;border:1px solid #d8cdb8;border-radius:6px;"><option value="g">grams</option><option value="ozt">Troy oz</option><option value="dwt">pennyweight</option></select>') +
      '</div>' +
      '<div id="ecw-result" style="font-size:13px;color:#2A3A46;margin:4px 0;">Enter a weight to calculate.</div>' +
      '<button class="btn btn-ghost btn-sm eo-edit-only" onclick="estCalcWeightAdd()">＋ Add to estimate</button>' +
    '</details>');

  // Ring resize (resize order type)
  if (isResize) {
    blocks.push(
      '<details class="est-calc-block" open style="margin-bottom:8px;">' +
        '<summary style="cursor:pointer;font-weight:600;font-size:13px;color:#4A3F2A;">↔️ Ring Resize</summary>' +
        '<div style="padding:8px 0;display:flex;flex-wrap:wrap;gap:8px;">' +
          _estCalcFieldHtml('Metal', _estCalcMetalSelectHtml('ecr-metal')) +
          _estCalcFieldHtml('Price / ozt', _estCalcInput('ecr-price', 'type="number" step="0.01" min="0" placeholder="auto"', 'estCalcResizeCompute()')) +
          _estCalcFieldHtml('From size', _estCalcInput('ecr-from', 'type="text" placeholder="7"', 'estCalcResizeCompute()')) +
          _estCalcFieldHtml('To size', _estCalcInput('ecr-to', 'type="text" placeholder="8"', 'estCalcResizeCompute()')) +
          _estCalcFieldHtml('Gauge', _estCalcInput('ecr-gauge', 'type="text" placeholder="18ga"', 'estCalcResizeCompute()')) +
          _estCalcFieldHtml('Width (mm)', _estCalcInput('ecr-width', 'type="number" step="0.1" min="0" placeholder="4"', 'estCalcResizeCompute()')) +
          _estCalcFieldHtml('Profile', '<select id="ecr-profile" onchange="estCalcResizeCompute()" style="width:100%;padding:6px 8px;border:1px solid #d8cdb8;border-radius:6px;"><option value="Flat">Flat</option><option value="Round">Round</option></select>') +
          _estCalcFieldHtml('Labor base $', _estCalcInput('ecr-laborbase', 'type="number" step="1" min="0" value="40"', 'estCalcResizeCompute()')) +
          _estCalcFieldHtml('Labor / size $', _estCalcInput('ecr-laborsize', 'type="number" step="1" min="0" value="10"', 'estCalcResizeCompute()')) +
        '</div>' +
        '<div id="ecr-result" style="font-size:13px;color:#2A3A46;margin:4px 0;">Enter from/to size + gauge to calculate.</div>' +
        '<button class="btn btn-ghost btn-sm eo-edit-only" onclick="estCalcResizeAdd()">＋ Add to estimate</button>' +
      '</details>');
  }

  // Stone setting (any piece with stones)
  blocks.push(
    '<details class="est-calc-block" style="margin-bottom:8px;">' +
      '<summary style="cursor:pointer;font-weight:600;font-size:13px;color:#4A3F2A;">💎 Stone Setting</summary>' +
      '<div style="padding:8px 0;display:flex;flex-wrap:wrap;gap:8px;">' +
        _estCalcFieldHtml('Setting', '<select id="ecs-setting" onchange="estCalcStoneCompute()" style="width:100%;padding:6px 8px;border:1px solid #d8cdb8;border-radius:6px;">' +
          ['Bezel', 'Prong ×4', 'Prong ×6', 'Flush', 'Channel', 'Pavé'].map(s => '<option value="' + s + '">' + s + '</option>').join('') + '</select>') +
        _estCalcFieldHtml('# Stones', _estCalcInput('ecs-count', 'type="number" step="1" min="1" value="1"', 'estCalcStoneCompute()')) +
        _estCalcFieldHtml('Rate / stone $', _estCalcInput('ecs-rate', 'type="number" step="1" min="0" placeholder="auto"', 'estCalcStoneCompute()')) +
      '</div>' +
      '<div id="ecs-result" style="font-size:13px;color:#2A3A46;margin:4px 0;">Choose a setting to calculate.</div>' +
      '<button class="btn btn-ghost btn-sm eo-edit-only" onclick="estCalcStoneAdd()">＋ Add to estimate</button>' +
    '</details>');

  // Chain / pendant length (pendants + necklaces)
  if (showChain) {
    blocks.push(
      '<details class="est-calc-block" open style="margin-bottom:8px;">' +
        '<summary style="cursor:pointer;font-weight:600;font-size:13px;color:#4A3F2A;">⛓️ Chain / Pendant</summary>' +
        '<div style="padding:8px 0;display:flex;flex-wrap:wrap;gap:8px;">' +
          _estCalcFieldHtml('Length (in)', _estCalcInput('ecc-len', 'type="number" step="0.5" min="0" placeholder="18"', 'estCalcChainCompute()')) +
          _estCalcFieldHtml('Price / in $', _estCalcInput('ecc-price', 'type="number" step="0.01" min="0" placeholder="0"', 'estCalcChainCompute()')) +
          _estCalcFieldHtml('Findings $', _estCalcInput('ecc-find', 'type="number" step="0.01" min="0" placeholder="0"', 'estCalcChainCompute()')) +
        '</div>' +
        '<div id="ecc-result" style="font-size:13px;color:#2A3A46;margin:4px 0;">Enter length + price to calculate.</div>' +
        '<button class="btn btn-ghost btn-sm eo-edit-only" onclick="estCalcChainAdd()">＋ Add to estimate</button>' +
      '</details>');
  }

  panel.innerHTML =
    '<div id="est-preset-bar" style="margin-bottom:10px;"></div>' +
    '<div class="form-sec-label" style="margin-bottom:6px;">🧮 Calculators</div>' +
    blocks.join('');

  estPresetRender();

  // Prefill metal prices + labor rate from the library/shop settings (async;
  // leaves fields blank offline).
  estCalcLoadMetalPrices().then(() => {
    ['ecm-metal', 'ecw-metal', 'ecr-metal'].forEach(id => { if (document.getElementById(id)) estCalcMetalPrefill(id); });
    const rateEl = document.getElementById('ecl-rate');
    const rate = estShopSettings().shopHourlyRate;
    if (rateEl && rateEl.value === '' && typeof rate === 'number' && rate > 0) { rateEl.value = String(rate); rateEl.dataset.autofill = '1'; }
  });
}

// When a metal is picked, drop its per-ozt price into the sibling price box
// (only if that box is empty, so a hand-typed override is never clobbered).
function estCalcMetalPrefill(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const priceId = selId.replace('-metal', '-price');
  const priceEl = document.getElementById(priceId);
  if (!priceEl) return;
  const prices = _estMetalPriceCache || {};
  const p = prices[sel.value];
  if (typeof p === 'number' && (priceEl.value === '' || priceEl.dataset.autofill === '1')) {
    priceEl.value = p.toFixed(2);
    priceEl.dataset.autofill = '1';
  }
  // Re-run whichever calculator this metal belongs to.
  if (selId === 'ecm-metal') estCalcMetalCompute();
  else if (selId === 'ecw-metal') estCalcWeightCompute();
  else if (selId === 'ecr-metal') estCalcResizeCompute();
}

function _estThicknessMm(gaugeText) {
  // Reuse the single gauge chart in js/ring-fields.js.
  if (typeof _ringGaugeToMm === 'function') return _ringGaugeToMm(gaugeText);
  return null;
}
function _estVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function _estNum(id) { return parseFloat(_estVal(id)) || 0; }

// ── Ring blank → metal cost ──
let _estCalcMetalLast = null;
function estCalcMetalCompute() {
  const out = document.getElementById('ecm-result');
  if (!out || !window.EstimateCalc) return;
  const size = _estVal('ecm-size'), gauge = _estVal('ecm-gauge');
  const lengthMm = (typeof ringBlankLengthMm === 'function') ? ringBlankLengthMm(size, gauge, _estVal('ecm-allow')) : null;
  const thicknessMm = _estThicknessMm(gauge);
  if (lengthMm == null || thicknessMm == null) {
    out.textContent = 'Enter ring size + gauge to calculate.';
    _estCalcMetalLast = null;
    return;
  }
  const metalType = _estVal('ecm-metal');
  const r = EstimateCalc.metalCost({
    lengthMm: lengthMm, widthMm: _estNum('ecm-width'), thicknessMm: thicknessMm,
    profile: _estVal('ecm-profile'), metalType: metalType,
    pricePerOzt: _estNum('ecm-price'), scrapPct: _estNum('ecm-scrap'),
  });
  const oztTxt = r.ozt != null ? r.ozt.toFixed(3) + ' ozt (' + r.grams.toFixed(2) + ' g)' : '—';
  if (r.hasPrice && r.cost != null) {
    out.innerHTML = '<strong>' + oztTxt + '</strong> → <strong>$' + r.cost.toFixed(2) + '</strong> material';
    _estCalcMetalLast = {
      label: _estMetalLabel(metalType) + ' — blank ' + lengthMm.toFixed(1) + 'mm (' + r.ozt.toFixed(3) + ' ozt)',
      cost: r.cost,
      meta: { source: 'metal-weight', kind: 'material', calcInputs: {
        metalType: metalType, ringSize: size, gauge: gauge, widthMm: _estNum('ecm-width'),
        profile: _estVal('ecm-profile'), allowanceMm: _estVal('ecm-allow'), scrapPct: _estNum('ecm-scrap'),
        pricePerOzt: _estNum('ecm-price'), ozt: r.ozt,
      } },
    };
  } else {
    out.innerHTML = '<strong>' + oztTxt + '</strong> — no price on file for this metal; enter Price / ozt to get a cost.';
    _estCalcMetalLast = null;
  }
}
function estCalcMetalAdd() {
  if (!_estCalcMetalLast) { if (typeof toast === 'function') toast('Nothing to add — enter size, gauge + price first.', '⚠️'); return; }
  addMaterialRow(_estCalcMetalLast.label, _estCalcMetalLast.cost.toFixed(2), '', _estCalcMetalLast.meta);
}

// ── Direct known-weight → cost ──
let _estCalcWeightLast = null;
function estCalcWeightCompute() {
  const out = document.getElementById('ecw-result');
  if (!out || !window.EstimateCalc) return;
  const G = EstimateCalc.G_PER_OZT;
  const wVal = _estNum('ecw-weight'), unit = _estVal('ecw-unit');
  let ozt = 0;
  if (unit === 'ozt') ozt = wVal;
  else if (unit === 'dwt') ozt = wVal / 20;           // 20 dwt = 1 ozt
  else ozt = wVal / G;                                 // grams
  const price = _estNum('ecw-price');
  const metalType = _estVal('ecw-metal');
  if (!(wVal > 0)) { out.textContent = 'Enter a weight to calculate.'; _estCalcWeightLast = null; return; }
  if (!(price > 0)) { out.innerHTML = '<strong>' + ozt.toFixed(3) + ' ozt</strong> — enter Price / ozt to get a cost.'; _estCalcWeightLast = null; return; }
  const cost = ozt * price;
  out.innerHTML = '<strong>' + ozt.toFixed(3) + ' ozt</strong> → <strong>$' + cost.toFixed(2) + '</strong> material';
  _estCalcWeightLast = {
    label: _estMetalLabel(metalType) + ' — ' + ozt.toFixed(3) + ' ozt',
    cost: cost,
    meta: { source: 'metal-direct', kind: 'material', calcInputs: {
      metalType: metalType, weight: wVal, unit: unit, pricePerOzt: price, ozt: ozt,
    } },
  };
}
function estCalcWeightAdd() {
  if (!_estCalcWeightLast) { if (typeof toast === 'function') toast('Enter a weight + price first.', '⚠️'); return; }
  addMaterialRow(_estCalcWeightLast.label, _estCalcWeightLast.cost.toFixed(2), '', _estCalcWeightLast.meta);
}

// ── Ring resize ──
let _estCalcResizeLast = null;
function estCalcResizeCompute() {
  const out = document.getElementById('ecr-result');
  if (!out || !window.EstimateCalc || typeof ringBlankLengthMm !== 'function') return;
  const from = _estVal('ecr-from'), to = _estVal('ecr-to'), gauge = _estVal('ecr-gauge');
  const startBlank = ringBlankLengthMm(from, gauge, 0);
  const targetBlank = ringBlankLengthMm(to, gauge, 0);
  const thicknessMm = _estThicknessMm(gauge);
  if (startBlank == null || targetBlank == null || thicknessMm == null) {
    out.textContent = 'Enter from/to size + gauge to calculate.'; _estCalcResizeLast = null; return;
  }
  const steps = Math.abs((parseFloat(to) || 0) - (parseFloat(from) || 0));
  const r = EstimateCalc.resizeCost({
    startBlankMm: startBlank, targetBlankMm: targetBlank,
    widthMm: _estNum('ecr-width'), thicknessMm: thicknessMm, profile: _estVal('ecr-profile'),
    metalType: _estVal('ecr-metal'), pricePerOzt: _estNum('ecr-price'),
    laborBase: _estNum('ecr-laborbase'), laborPerSize: _estNum('ecr-laborsize'), sizeSteps: steps,
  });
  const dir = r.direction === 'up' ? 'size up' : 'size down';
  out.innerHTML = 'Resize ' + dir + ': ' +
    (r.metalCost > 0 ? '$' + r.metalCost.toFixed(2) + ' metal + ' : '') +
    '$' + r.labor.toFixed(2) + ' labor → <strong>$' + r.total.toFixed(2) + '</strong>';
  _estCalcResizeLast = {
    label: 'Resize ' + from + '→' + to + ' (' + dir + ')',
    cost: r.total,
    meta: { source: 'resize', kind: 'material', calcInputs: {
      metalType: _estVal('ecr-metal'), fromSize: from, toSize: to, gauge: gauge,
      widthMm: _estNum('ecr-width'), profile: _estVal('ecr-profile'),
      laborBase: _estNum('ecr-laborbase'), laborPerSize: _estNum('ecr-laborsize'), pricePerOzt: _estNum('ecr-price'),
    } },
  };
}
function estCalcResizeAdd() {
  if (!_estCalcResizeLast) { if (typeof toast === 'function') toast('Enter from/to size + gauge first.', '⚠️'); return; }
  addMaterialRow(_estCalcResizeLast.label, _estCalcResizeLast.cost.toFixed(2), '', _estCalcResizeLast.meta);
}

// ── Stone setting ──
let _estCalcStoneLast = null;
function estCalcStoneCompute() {
  const out = document.getElementById('ecs-result');
  if (!out || !window.EstimateCalc) return;
  const setting = _estVal('ecs-setting');
  const count = Math.max(1, parseInt(_estVal('ecs-count'), 10) || 1);
  const rateOverride = _estNum('ecs-rate');
  const rate = rateOverride > 0 ? rateOverride : EstimateCalc.stoneSettingRate(setting);
  const cost = rate * count;
  out.innerHTML = count + ' × ' + setting + ' @ $' + rate.toFixed(2) + ' → <strong>$' + cost.toFixed(2) + '</strong> labor';
  _estCalcStoneLast = {
    label: 'Stone setting — ' + count + '× ' + setting,
    cost: cost,
    meta: { source: 'stone-setting', kind: 'labor', calcInputs: { setting: setting, count: count, rate: rate } },
  };
}
function estCalcStoneAdd() {
  if (!_estCalcStoneLast) estCalcStoneCompute();
  if (!_estCalcStoneLast) return;
  addMaterialRow(_estCalcStoneLast.label, _estCalcStoneLast.cost.toFixed(2), '', _estCalcStoneLast.meta);
}

// ── Chain / pendant ──
let _estCalcChainLast = null;
function estCalcChainCompute() {
  const out = document.getElementById('ecc-result');
  if (!out || !window.EstimateCalc) return;
  const r = EstimateCalc.chainCost({ lengthIn: _estNum('ecc-len'), pricePerIn: _estNum('ecc-price'), findings: _estNum('ecc-find') });
  if (!r.hasPrice && !r.findings) { out.textContent = 'Enter length + price to calculate.'; _estCalcChainLast = null; return; }
  out.innerHTML = (r.chainCost != null ? '$' + r.chainCost.toFixed(2) + ' chain' : '') +
    (r.findings ? ' + $' + r.findings.toFixed(2) + ' findings' : '') +
    ' → <strong>$' + r.total.toFixed(2) + '</strong>';
  _estCalcChainLast = {
    label: 'Chain ' + (_estNum('ecc-len') || '?') + '" + findings',
    cost: r.total,
    meta: { source: 'chain', kind: 'material', calcInputs: {
      lengthIn: _estNum('ecc-len'), pricePerIn: _estNum('ecc-price'), findings: _estNum('ecc-find'),
    } },
  };
}
function estCalcChainAdd() {
  if (!_estCalcChainLast) { if (typeof toast === 'function') toast('Enter chain length + price first.', '⚠️'); return; }
  addMaterialRow(_estCalcChainLast.label, _estCalcChainLast.cost.toFixed(2), '', _estCalcChainLast.meta);
}

// ── Re-price metal lines from the Materials Library (the payoff of lines[]) ──
// Walks the estimate's calculator-sourced metal rows, re-fetches current metal
// prices, and recomputes each line's cost from its stored calcInputs — so when
// the price of gold moves you can re-quote an open estimate in one click instead
// of re-typing every material row. Manual rows and non-metal calc rows are left
// untouched; rows whose metal has no price on file are skipped, not zeroed.
async function estRepriceFromLibrary() {
  if (!window.EstimateCalc) return;
  _estMetalPriceCache = null;                 // force a fresh fetch
  const prices = await estCalcLoadMetalPrices();
  const rows = document.querySelectorAll('#est-materials .est-row');
  let repriced = 0, skipped = 0;
  rows.forEach(row => {
    if (row.dataset.calcRow !== '1') return;
    const source = row.dataset.source;
    if (source !== 'metal-weight' && source !== 'metal-direct' && source !== 'resize') return;
    let ci = null; try { ci = JSON.parse(row.dataset.calc || 'null'); } catch (e) {}
    if (!ci) return;
    const newPrice = prices[ci.metalType];
    if (!(typeof newPrice === 'number' && newPrice > 0)) { skipped++; return; }

    let newCost = null, newOzt = ci.ozt;
    if (source === 'metal-weight') {
      const lengthMm = (typeof ringBlankLengthMm === 'function') ? ringBlankLengthMm(ci.ringSize, ci.gauge, ci.allowanceMm) : null;
      const thicknessMm = _estThicknessMm(ci.gauge);
      if (lengthMm == null || thicknessMm == null) { skipped++; return; }
      const r = EstimateCalc.metalCost({ lengthMm: lengthMm, widthMm: ci.widthMm, thicknessMm: thicknessMm, profile: ci.profile, metalType: ci.metalType, pricePerOzt: newPrice, scrapPct: ci.scrapPct });
      newCost = r.cost; newOzt = r.ozt;
    } else if (source === 'metal-direct') {
      if (!(ci.ozt > 0)) { skipped++; return; }
      newOzt = ci.ozt; newCost = ci.ozt * newPrice;
    } else if (source === 'resize') {
      const startBlank  = (typeof ringBlankLengthMm === 'function') ? ringBlankLengthMm(ci.fromSize, ci.gauge, 0) : null;
      const targetBlank = (typeof ringBlankLengthMm === 'function') ? ringBlankLengthMm(ci.toSize, ci.gauge, 0) : null;
      const thicknessMm = _estThicknessMm(ci.gauge);
      if (startBlank == null || targetBlank == null || thicknessMm == null) { skipped++; return; }
      const steps = Math.abs((parseFloat(ci.toSize) || 0) - (parseFloat(ci.fromSize) || 0));
      const r = EstimateCalc.resizeCost({ startBlankMm: startBlank, targetBlankMm: targetBlank, widthMm: ci.widthMm, thicknessMm: thicknessMm, profile: ci.profile, metalType: ci.metalType, pricePerOzt: newPrice, laborBase: ci.laborBase, laborPerSize: ci.laborPerSize, sizeSteps: steps });
      newCost = r.total; newOzt = r.ozt;
    }
    if (newCost == null || !isFinite(newCost)) { skipped++; return; }

    const costInput = row.querySelector('.est-cost-input');
    if (costInput) {
      costInput.dataset.base = String(Math.round(newCost * 100) / 100);
      if (costInput !== document.activeElement) estRebakeCost(costInput);
    }
    // Persist the fresh price/ozt back onto the row so a subsequent save keeps it.
    ci.pricePerOzt = newPrice; if (newOzt != null) ci.ozt = newOzt;
    try { row.dataset.calc = JSON.stringify(ci); } catch (e) {}
    repriced++;
  });
  calcEstimate();
  if (typeof estCheckStalePrices === 'function') estCheckStalePrices();  // clears the stale flags we just resolved
  if (typeof toast === 'function') {
    if (repriced) toast('Re-priced ' + repriced + ' metal line' + (repriced > 1 ? 's' : '') + ' from the library' + (skipped ? ' (' + skipped + ' skipped — no price on file)' : ''), '✅');
    else toast(skipped ? 'No lines re-priced — ' + skipped + ' metal line(s) have no library price on file.' : 'No calculator-priced metal lines to re-price.', 'ℹ️');
  }
}

function _estMetalLabel(metalType) {
  const found = EST_METAL_OPTIONS.find(o => o[0] === metalType);
  return found ? found[1] : (metalType || 'Metal');
}
function _estEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ── Auto-pull ring dimensions from Design Details into the metal calc ──
// For a Ring order, size/gauge/width/profile/allowance are already entered in
// the ring blocks (js/ring-fields.js). Pull the first Custom Ring's values in
// so staff don't re-type them.
function estCalcPullRingDims() {
  const g = id => document.getElementById(id);
  const blocks = document.querySelectorAll('#rings-dynamic-list .ring-block');
  let idx = -1;
  for (let i = 0; i < blocks.length; i++) {
    if ((g('f-ring-category-' + i)?.value || '') === 'Custom Ring') { idx = i; break; }
  }
  if (idx < 0) { if (typeof toast === 'function') toast('No Custom Ring details to pull from.', 'ℹ️'); return; }
  const set = (cid, val) => { const el = g(cid); if (el && val != null && val !== '') el.value = val; };
  set('ecm-size', g('f-ring-customsize-' + idx)?.value);
  set('ecm-gauge', g('f-ring-customgauge-' + idx)?.value);
  const wm = String(g('f-ring-customwidth-' + idx)?.value || '').match(/([\d.]+)/);
  if (wm) set('ecm-width', wm[1]);
  const prof = g('f-ring-customprofile-' + idx)?.value;
  if (prof && g('ecm-profile')) g('ecm-profile').value = prof;
  set('ecm-allow', g('f-ring-customallowance-' + idx)?.value);
  estCalcMetalCompute();
  if (typeof toast === 'function') toast('Pulled ring ' + (idx + 1) + ' details into the calculator.', '✅');
}

// ── Labor by time (hours × shop hourly rate) ──
let _estCalcLaborLast = null;
function estCalcLaborCompute() {
  const out = document.getElementById('ecl-result');
  if (!out || !window.EstimateCalc) return;
  const r = EstimateCalc.laborCost({ hours: _estNum('ecl-hours'), rate: _estNum('ecl-rate') });
  if (!(r.hours > 0)) { out.textContent = 'Enter hours to calculate.'; _estCalcLaborLast = null; return; }
  if (!r.hasRate) { out.innerHTML = '<strong>' + r.hours + ' hr</strong> — enter an hourly rate to get a cost.'; _estCalcLaborLast = null; return; }
  out.innerHTML = '<strong>' + r.hours + ' hr × $' + r.rate.toFixed(2) + '</strong> → <strong>$' + r.cost.toFixed(2) + '</strong> labor';
  _estCalcLaborLast = { cost: r.cost };
}
function estCalcLaborAdd() {
  if (!_estCalcLaborLast) { if (typeof toast === 'function') toast('Enter hours + rate first.', '⚠️'); return; }
  const laborEl = document.getElementById('est-labor');
  if (!laborEl) return;
  const cur = parseFloat(laborEl.value) || 0;
  laborEl.value = (cur + _estCalcLaborLast.cost).toFixed(2);
  calcEstimate();
  if (typeof toast === 'function') toast('Added $' + _estCalcLaborLast.cost.toFixed(2) + ' to Labor.', '✅');
}

// ── Estimate presets (reusable starting points, saved per device) ──
const EST_PRESET_KEY = 'sts-est-presets';
function estPresetGetAll() { try { return JSON.parse(localStorage.getItem(EST_PRESET_KEY) || '{}') || {}; } catch (e) { return {}; } }
function estPresetSetAll(o) { try { localStorage.setItem(EST_PRESET_KEY, JSON.stringify(o)); } catch (e) {} }
function estPresetCapture() {
  return {
    lines: (typeof estCollectLines === 'function') ? estCollectLines() : [],
    labor: parseFloat(document.getElementById('est-labor')?.value) || 0,
    shipping: parseFloat(document.getElementById('est-shipping')?.value) || 0,
    taxOn: document.getElementById('est-tax-toggle')?.checked || false,
    multiplier: estMultiplier,
  };
}
function estPresetSave() {
  const name = (typeof prompt === 'function') ? prompt('Save this estimate as a reusable preset.\nName:') : null;
  if (!name || !name.trim()) return;
  const all = estPresetGetAll();
  all[name.trim()] = estPresetCapture();
  estPresetSetAll(all);
  estPresetRender();
  if (typeof toast === 'function') toast('Saved preset “' + name.trim() + '”.', '✅');
}
function estPresetApply(name) {
  const p = estPresetGetAll()[name];
  if (!p) return;
  const container = document.getElementById('est-materials');
  if (container) container.innerHTML = '';
  estRowCount = 0;
  (p.lines || []).forEach(l => addMaterialRow(l.label || '', (l.cost != null ? l.cost : ''), '', {
    source: l.source || 'manual', kind: l.kind || 'material', calcInputs: l.calcInputs || null,
  }));
  if (!(p.lines || []).length) addMaterialRow();
  const laborEl = document.getElementById('est-labor'); if (laborEl) laborEl.value = p.labor || '';
  const shipEl = document.getElementById('est-shipping'); if (shipEl) shipEl.value = p.shipping || '';
  const taxEl = document.getElementById('est-tax-toggle'); if (taxEl) taxEl.checked = !!p.taxOn;
  setMultiplier(p.multiplier || 2.5);
  calcEstimate();
  if (typeof toast === 'function') toast('Applied preset “' + name + '”.', '✅');
}
function estPresetDelete(name) {
  if (typeof confirm === 'function' && !confirm('Delete preset “' + name + '”?')) return;
  const all = estPresetGetAll();
  delete all[name];
  estPresetSetAll(all);
  estPresetRender();
}
function estPresetRender() {
  const bar = document.getElementById('est-preset-bar');
  if (!bar) return;
  const all = estPresetGetAll();
  const names = Object.keys(all).sort();
  const arg = n => JSON.stringify(n).replace(/"/g, '&quot;');
  const chips = names.map(n =>
    '<span style="display:inline-flex;align-items:center;gap:2px;background:#F3ECDC;border:1px solid #E0D4BC;border-radius:14px;padding:2px 4px 2px 10px;font-size:12px;">' +
      '<button class="eo-edit-only" onclick="estPresetApply(' + arg(n) + ')" style="background:none;border:none;cursor:pointer;font-size:12px;color:#4A3F2A;padding:2px 2px;">' + _estEsc(n) + '</button>' +
      '<button class="eo-edit-only" title="Delete preset" onclick="estPresetDelete(' + arg(n) + ')" style="background:none;border:none;cursor:pointer;color:#a08a5a;font-size:13px;line-height:1;">×</button>' +
    '</span>').join(' ');
  bar.innerHTML =
    '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">' +
      '<span style="font-size:11px;font-weight:600;color:#6b5f47;text-transform:uppercase;letter-spacing:.04em;">Presets</span>' +
      (chips || '<span style="font-size:12px;color:#9a8f78;">none saved yet</span>') +
      '<button class="btn btn-ghost btn-sm eo-edit-only" style="margin-left:auto;" onclick="estPresetSave()">💾 Save current</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="estPreviewEstimate()">👁 Preview</button>' +
    '</div>';
}

// ── Stale-price detection ──
// Compares each calculator-priced metal line's quoted price/ozt against the
// current Materials Library price; flags drifted rows red and shows the banner.
async function estCheckStalePrices() {
  const banner = document.getElementById('est-stale-banner');
  const rows = document.querySelectorAll('#est-materials .est-row');
  let anyStale = false;
  const prices = await estCalcLoadMetalPrices();
  rows.forEach(row => {
    if (row.dataset.calcRow !== '1') return;
    const src = row.dataset.source;
    if (src !== 'metal-weight' && src !== 'metal-direct' && src !== 'resize') return;
    let ci = null; try { ci = JSON.parse(row.dataset.calc || 'null'); } catch (e) {}
    if (!ci || !ci.metalType) return;
    const cur = prices[ci.metalType], quoted = ci.pricePerOzt;
    let stale = false;
    if (typeof cur === 'number' && cur > 0 && typeof quoted === 'number' && quoted > 0) {
      stale = Math.abs(cur - quoted) / quoted >= 0.03;   // ≥3% drift
      if (stale) {
        anyStale = true;
        row.style.boxShadow = 'inset 3px 0 0 #C0392B';
        row.dataset.stale = '1';
        row.title = (EST_SOURCE_LABEL[src] || '') + ' — metal price moved ' + Math.round(Math.abs(cur - quoted) / quoted * 100) + '% since quoted';
      }
    }
    if (!stale) { delete row.dataset.stale; _estApplyRowProvenance(row, src); }  // restore normal gold stripe
  });
  if (banner) banner.style.display = anyStale ? '' : 'none';
}

// ── Customer-facing estimate preview ──
// A clean, branded view of what the customer sees: line items at MARKED
// (customer-facing) prices, labor, shipping, tax, total — no raw costs, markup,
// or margin. Shown in an overlay; "Print" opens a standalone printable window.
let _estPreviewDoc = '';
function _estBuildPreviewContent() {
  const rows = document.querySelectorAll('#est-materials .est-row');
  const mult = estMultiplier;
  const money = n => '$' + (n || 0).toFixed(2);
  const items = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc = (inputs[0]?.value || '').trim();
    const base = estCostBase(inputs[1]);
    if (desc || base) items.push({ desc: desc || 'Item', price: base * mult });
  });
  const labor    = parseFloat(document.getElementById('est-labor')?.value) || 0;
  const shipping = parseFloat(document.getElementById('est-shipping')?.value) || 0;
  const adj      = parseFloat(document.getElementById('est-adjustment')?.value) || 0;
  const taxOn    = document.getElementById('est-tax-toggle')?.checked || false;
  const subtotal = items.reduce((a, i) => a + i.price, 0) + labor;
  const adjusted = subtotal + adj;
  const tax      = taxOn ? adjusted * 0.0825 : 0;
  const total    = adjusted + shipping + tax;
  const custName = (typeof getFullName === 'function' ? getFullName() : '') || 'Valued Customer';
  const itemRows = items.map(i =>
    '<tr><td style="padding:8px 0;border-bottom:1px solid #eee;">' + _estEsc(i.desc) + '</td>' +
    '<td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">' + money(i.price) + '</td></tr>').join('');
  const sumRow = (label, val, strong) =>
    '<tr><td style="padding:4px 0;color:' + (strong ? '#3a2f18' : '#666') + ';' + (strong ? 'font-weight:700;' : '') + '">' + label + '</td>' +
    '<td style="padding:4px 0;text-align:right;' + (strong ? 'font-weight:700;' : '') + '">' + money(val) + '</td></tr>';
  return '' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;color:#2a2416;max-width:520px;margin:0 auto;">' +
      '<div style="text-align:center;border-bottom:2px solid #C8A24B;padding-bottom:10px;margin-bottom:14px;">' +
        '<div style="font-size:20px;font-weight:700;letter-spacing:.02em;">Stones Throw Studio</div>' +
        '<div style="font-size:12px;color:#8a7d5f;">Custom Jewelry Estimate</div>' +
      '</div>' +
      '<div style="font-size:13px;margin-bottom:10px;">Prepared for <strong>' + _estEsc(custName) + '</strong></div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px;">' + itemRows + '</table>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:10px;">' +
        (labor ? sumRow('Labor', labor) : '') +
        (adj ? sumRow('Adjustment', adj) : '') +
        (shipping ? sumRow('Shipping', shipping) : '') +
        (taxOn ? sumRow('Sales Tax (8.25%)', tax) : '') +
        '<tr><td colspan="2"><hr style="border:none;border-top:1px solid #C8A24B;margin:6px 0;"></td></tr>' +
        sumRow('Estimate Total', total, true) +
      '</table>' +
      '<div style="font-size:11px;color:#9a8f78;margin-top:16px;text-align:center;">This estimate is valid for 30 days. Final pricing may vary with materials market and design changes.</div>' +
    '</div>';
}
function estPreviewEstimate() {
  const content = _estBuildPreviewContent();
  _estPreviewDoc = content;
  let overlay = document.getElementById('est-preview-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'est-preview-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,16,8,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:12px;padding:24px;max-width:600px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.3);">' +
      content +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;">' +
        '<button class="btn btn-ghost btn-sm" onclick="estPreviewPrint()">🖨 Print</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'est-preview-overlay\').style.display=\'none\'">Close</button>' +
      '</div>' +
    '</div>';
  overlay.style.display = 'flex';
}
function estPreviewPrint() {
  const w = window.open('', '_blank');
  if (!w) { if (typeof toast === 'function') toast('Allow pop-ups to print the estimate.', '⚠️'); return; }
  w.document.write('<!doctype html><html><head><title>Estimate — Stones Throw Studio</title></head><body style="margin:32px;">' + (_estPreviewDoc || '') + '</body></html>');
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 200);
}

// Initial render so the panel is populated wherever #est-calc-panel exists
// (desktop modal — re-rendered with real context when it opens; intake Step 3
// — where estSetItemType from the Piece Type change keeps it current). Safe to
// run against a hidden modal.
function _estCalcInit() { if (document.getElementById('est-calc-panel')) estCalcRender(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _estCalcInit);
else _estCalcInit();
