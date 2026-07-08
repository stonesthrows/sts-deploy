// ════════════════════════════════════════════
//  INTAKE  —  js/intake.js
//  Standalone iPad order-intake PWA (intake.html).
//  Creates orders only — editing lives in the main app's Edit Order
//  modal (jewelry-workflow.html + js/orders.js).
//  Depends on: js/sketchpad.js, js/notion.js, js/order-widgets.js.
//  Orders are saved to localStorage ('sts-orders') first, then pushed
//  to Notion via /api/notion-pipeline; anything that fails to push is
//  retried on the next launch / when the network comes back.
// ════════════════════════════════════════════

// ── Local store bootstrap (this page never renders the kanban) ──
let ORDERS = [];
try { ORDERS = JSON.parse(localStorage.getItem('sts-orders') || '[]'); } catch (e) { ORDERS = []; }

function saveToStorage() {
  try { localStorage.setItem('sts-orders', JSON.stringify(ORDERS)); }
  catch (e) { toast('⚠ Could not save locally — storage full?', '⚠'); }
}

function toast(msg, icon = '', dur = 3000) {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = (icon ? '<span>' + icon + '</span>' : '') + '<span>' + msg + '</span>';
  wrap.appendChild(t);
  setTimeout(() => t.remove(), dur);
}

function setConnStatus() { /* no connection dot on this page — badge covers it */ }

// ── Unsynced badge ────────────────────────────────────────────
function intakeUpdateUnsynced() {
  const badge = document.getElementById('intake-unsynced');
  if (!badge) return;
  const n = ORDERS.filter(o => !o.notionId && String(o.id).startsWith('u')).length;
  badge.textContent = n + ' unsynced';
  badge.classList.toggle('hidden', n === 0);
}

// ── 3-step wizard ─────────────────────────────────────────────
let _intakeStep = 1;

function intakeStep(n) {
  _intakeStep = Math.min(3, Math.max(1, n));
  for (let i = 1; i <= 3; i++) {
    const panel = document.getElementById('step-' + i);
    // Step 2 is a flex column (drawer + canvas); 1 and 3 are scroll panels
    if (panel) panel.style.display = (i === _intakeStep) ? (i === 2 ? 'flex' : 'block') : 'none';
  }
  document.querySelectorAll('.intake-tab').forEach(b => {
    const active = parseInt(b.dataset.step, 10) === _intakeStep;
    b.classList.toggle('bg-[#C9983A]', active);
    b.classList.toggle('text-[#201A0A]', active);
    b.classList.toggle('text-[#9FB4C4]', !active);
  });
  const label = document.getElementById('intake-step-label');
  if (label) label.textContent = 'Step ' + _intakeStep + ' of 3';
  document.querySelectorAll('#intake-dots .intake-dot').forEach((d, i) => {
    const active = (i + 1) === _intakeStep;
    d.classList.toggle('bg-[#C9983A]', active || (i + 1) < _intakeStep);
    d.classList.toggle('bg-[#35576D]', !active && (i + 1) > _intakeStep);
    d.classList.toggle('scale-125', active);
  });
  const back = document.getElementById('intake-back-btn');
  if (back) back.classList.toggle('invisible', _intakeStep === 1);
  const next = document.getElementById('intake-next-btn');
  if (next) next.classList.toggle('invisible', _intakeStep === 3);
  document.querySelectorAll('.step-scroll').forEach(p => { p.scrollTop = 0; });
  if (_intakeStep === 2) intakeSizeSketchStage();
}

// ── Design-details drawer (step 2) ────────────────────────────
function intakeToggleDrawer() {
  const drawer = document.getElementById('design-drawer');
  const chev   = document.getElementById('design-drawer-chev');
  if (!drawer) return;
  const open = drawer.style.display !== 'none';
  drawer.style.display = open ? 'none' : '';
  if (chev) chev.style.transform = open ? 'rotate(-90deg)' : '';
  intakeSizeSketchStage();
}

// ── Sketch stage sizing — largest 1000:620 box that fits the free space.
//    The canvas backing store is fixed; only its CSS box is sized here, so
//    strokes are never distorted between what was drawn and what exports. ──
function intakeSizeSketchStage() {
  const wrap  = document.getElementById('sketchpad-fg');
  const stage = document.getElementById('sketch-stage');
  if (!wrap || !stage) return;
  requestAnimationFrame(() => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    const ratio = 1000 / 620;
    let sw = w, sh = w / ratio;
    if (sh > h) { sh = h; sw = h * ratio; }
    stage.style.width  = Math.floor(sw) + 'px';
    stage.style.height = Math.floor(sh) + 'px';
  });
}
window.addEventListener('resize', intakeSizeSketchStage);
window.addEventListener('orientationchange', () => setTimeout(intakeSizeSketchStage, 300));

// ── Apple Pencil ⇄ finger toggle (session-only — resets on relaunch) ──
function intakeToggleFingerDraw() {
  if (typeof SK === 'undefined' || !SK) return;
  SK.penOnly = !SK.penOnly;
  const btn = document.getElementById('sk-finger');
  if (btn) btn.classList.toggle('on', !SK.penOnly);
  const hint = document.getElementById('dock-hint');
  if (hint) hint.textContent = SK.penOnly ? '✎ Apple Pencil only' : '☝ Finger drawing ON';
  toast(SK.penOnly ? 'Apple Pencil only' : 'Finger drawing enabled for this session', '✎');
}

// ── Dirty check + exit ────────────────────────────────────────
function _intakeDirty() {
  const ids = ['f-firstname', 'f-lastname', 'f-email', 'f-phone', 'f-materials',
               'f-sizing', 'f-gemstones', 'f-description', 'f-job-desc', 'f-notes'];
  const fields = ids.some(id => {
    const el = document.getElementById(id);
    return el && el.value && el.value.trim();
  });
  return fields
    || (typeof _oiItems !== 'undefined' && _oiItems.some(it => it.name || it.price))
    || (typeof SK !== 'undefined' && SK && SK.hasInk)
    || (typeof HW !== 'undefined' && HW && HW.hasInk);
}

function intakeExit() {
  if (_intakeDirty() && !confirm('Discard this order? Nothing will be saved.')) return;
  window.removeEventListener('beforeunload', _intakeBeforeUnload);
  location.href = 'jewelry-workflow.html';
}

function _intakeBeforeUnload(e) {
  if (!_intakeDirty()) return;
  e.preventDefault();
  e.returnValue = '';
}
window.addEventListener('beforeunload', _intakeBeforeUnload);

// ── Estimate → order total (inline builder, step 3) ───────────
function intakeUseEstimate() {
  const final = parseFloat((document.getElementById('est-final')?.textContent || '').replace('$', '')) || 0;
  if (!final) { toast('Estimate is $0 — add materials or labor first', '⚠'); return; }
  // Persist material lines in the same "desc — $cost" format the desktop
  // estimate builder parses back out of o.materials (populateEstimateFromOrder)
  const lines = [];
  document.querySelectorAll('#est-materials .est-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc = inputs[0]?.value.trim();
    const cost = parseFloat(inputs[1]?.value) || 0;
    if (desc || cost) lines.push(desc + (cost ? ' — $' + cost.toFixed(2) : ''));
  });
  const mat = document.getElementById('f-materials');
  if (mat && lines.length) mat.value = lines.join('\n');
  const idx = _oiItems.findIndex(it => it.type === 'manual' && it.name === 'Estimate Total');
  if (idx >= 0) _oiItems[idx].price = final;
  else _oiItems.push({ type: 'manual', name: 'Estimate Total', price: final, quantity: 1 });
  oiRender();
  toast('Estimate set as order total ✓', '✓');
}

// ── Save & Close — builds the same order object shape as the old
//    submitOrder() so Notion sync and the desktop app see no difference ──
async function intakeSubmit() {
  const btn = document.getElementById('intake-save-btn');
  if (btn && btn.disabled) return;

  const name = getFullName();
  const desc = jdGetDescValue();
  if (!name || !desc) {
    toast(_jdMode === 'square' ? 'Please fill in Name and select a Square Item' : 'Please fill in Name and Description', '⚠');
    const highlightIds = _jdMode === 'square' ? ['f-firstname'] : ['f-firstname', 'f-description'];
    let jumped = false;
    highlightIds.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value.trim()) {
        el.style.borderColor = '#E05050';
        el.addEventListener('input', () => el.style.borderColor = '', { once: true });
        if (!jumped) { intakeStep(id === 'f-firstname' ? 1 : 2); jumped = true; }
      }
    });
    return;
  }
  if (btn) btn.disabled = true;

  const g = id => document.getElementById(id);
  const items       = _oiItems.map(it => ({ ...it }));
  const addrStreet  = g('f-addr-street').value.trim();
  const addrStreet2 = g('f-addr-street2').value.trim();
  const addrCity    = g('f-addr-city').value.trim();
  const addrState   = g('f-addr-state').value.trim();
  const addrZip     = g('f-addr-zip').value.trim();
  const addrCountry = g('f-addr-country').value.trim() || 'United States';
  const typeVal     = (g('f-order-type') || {}).value || 'order';
  const typeMap     = ORDER_TYPE_STAGES[typeVal] || ORDER_TYPE_STAGES.order;

  const order = {
    id:        'u' + Date.now(),
    name:      name,
    jobDesc:   jdGetJobDescValue(),
    jobDescMode: _jdMode,
    desc:      desc,
    stage:     typeMap.stage,
    deadline:  g('f-deadline').value || null,
    items:     items,
    price:     parseFloat(g('f-price').value)    || 0,
    deposit:   parseFloat(g('f-deposit').value)  || 0,
    shipping:  parseFloat(g('f-shipping').value) || 0,
    ringSize:  oiDeriveRingSizesText(items),
    notionId:  null,
    email:     g('f-email').value.trim(),
    phone:     g('f-phone').value.trim(),
    takeIn:    g('f-takein').value || null,
    pickup:    g('f-pickup').value || null,
    trackingNumber:  null,
    trackingCarrier: null,
    shippingAddress: { street: addrStreet, street2: addrStreet2, city: addrCity, state: addrState, zip: addrZip, country: addrCountry },
    addrStreet, addrStreet2, addrCity, addrState, addrZip, addrCountry,
    contactSource: g('f-source').value   || null,
    assignee:      g('f-assignee').value || null,
    orderType:     typeVal,
    contactMethod: '',
    pieceType:     g('f-piece-type').value || '',
    sizing:        g('f-sizing').value.trim(),
    gemstones:     g('f-gemstones').value.trim(),
    finish:        [...document.querySelectorAll('#f-finish input:checked')].map(c => c.value),
    sketchImg:     (typeof sketchExport === 'function') ? sketchExport() : null,
    customerNotes: g('f-customer-notes').value.trim() || '',
    notes:         g('f-notes').value.trim() || '',
  };

  ORDERS.push(order);
  saveToStorage();

  const doneSub = document.getElementById('intake-done-sub');
  const doneTitle = document.getElementById('intake-done-title');
  if (doneTitle) doneTitle.textContent = name + ' — ' + typeMap.label;
  if (doneSub) doneSub.textContent = 'Syncing to Notion…';
  const done = document.getElementById('intake-done');
  if (done) { done.classList.remove('hidden'); done.classList.add('flex'); }

  const notionId = await notionCreateOrder(order);
  if (notionId) {
    order.notionId = notionId;
    saveToStorage();
    if (doneSub) doneSub.textContent = '✓ Synced to Notion' + (order.sketchImg ? ' (sketch attached)' : '');
  } else {
    if (doneSub) doneSub.textContent = '⚠ Saved on this iPad — will sync to Notion when back online. It won\'t appear on other devices until then.';
  }
  intakeUpdateUnsynced();
  if (btn) btn.disabled = false;
}

// ── Reset for the next customer (no reload — must work offline) ──
function intakeReset() {
  ['f-firstname', 'f-lastname', 'f-email', 'f-phone', 'f-deadline', 'f-job-desc', 'f-description',
   'f-materials', 'f-deposit', 'f-shipping', 'f-notes', 'f-customer-notes',
   'f-piece-type', 'f-sizing', 'f-gemstones',
   'f-addr-street', 'f-addr-street2', 'f-addr-city', 'f-addr-state', 'f-addr-zip']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.style.borderColor = ''; }
    });
  document.querySelectorAll('#f-finish input').forEach(c => c.checked = false);
  ['f-pickup', 'f-source', 'f-assignee'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const country = document.getElementById('f-addr-country');
  if (country) country.value = 'United States';
  const takein = document.getElementById('f-takein');
  if (takein) takein.value = new Date().toISOString().slice(0, 10);
  if (typeof sketchReset === 'function') sketchReset();
  if (typeof hwClear === 'function') hwClear();
  if (typeof hwToggle === 'function') hwToggle(false);
  const jdType = document.getElementById('f-jobdesc-type');
  if (jdType) jdType.value = 'custom';
  _jdMode = 'custom';
  jdApplyVisibility('custom');
  oiInit();
  clearEstimate();
  const custNotes = document.getElementById('f-customer-notes');
  if (custNotes) custNotes.value = '';
  setOrderType('order');
  toggleShippingAddress();
  intakeStep(1);
}

function intakeNew() {
  const done = document.getElementById('intake-done');
  if (done) { done.classList.add('hidden'); done.classList.remove('flex'); }
  intakeReset();
}

// ── Anthropic key for the handwriting converter — the standalone PWA has
//    its own localStorage silo, so the key saved in the main app's Designs
//    tab doesn't reach here automatically ──
function intakeSetKey() {
  const current = localStorage.getItem('sts-anthropic-key') || '';
  const key = prompt('Anthropic API key for handwriting-to-type\n(stored only on this device):', current);
  if (key === null) return;
  if (key.trim()) { localStorage.setItem('sts-anthropic-key', key.trim()); toast('API key saved ✓', '✓'); }
  else { localStorage.removeItem('sts-anthropic-key'); toast('API key cleared', '✓'); }
}

// ── Init ──────────────────────────────────────────────────────
(function intakeInit() {
  const takein = document.getElementById('f-takein');
  if (takein && !takein.value) takein.value = new Date().toISOString().slice(0, 10);

  oiInit();
  jdApplyVisibility('custom');
  toggleShippingAddress();
  addMaterialRow();      // one empty estimate line ready to go
  setMultiplier(2.5);
  intakeStep(1);
  intakeSizeSketchStage();
  intakeUpdateUnsynced();

  // Prefill via query params (main app's "New Order for <customer>" links)
  const params = new URLSearchParams(location.search);
  if (params.get('name'))  setNameFields(params.get('name'));
  if (params.get('email')) { const el = document.getElementById('f-email'); if (el) el.value = params.get('email'); }
  if (params.get('type')  && ORDER_TYPE_STAGES[params.get('type')]) setOrderType(params.get('type'));

  // Push any orders that never made it to Notion (offline intake at a market)
  if (navigator.onLine) notionPushUnsynced().then(intakeUpdateUnsynced);
  window.addEventListener('online', () => {
    toast('Back online — syncing…', '↻');
    notionPushUnsynced().then(intakeUpdateUnsynced);
  });
})();
