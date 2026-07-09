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

// ── Wizard: 3 steps for Custom Design, 1 (Items & Price folded onto page 1,
//    no sketch page) for Repair/Resize/Square Item ────────────────────────
let _intakeStep = 1;

function _intakeMaxStep() {
  const type = document.getElementById('f-order-type')?.value || 'order';
  return type === 'order' ? 3 : 1;
}

function intakeStep(n) {
  const maxStep = _intakeMaxStep();
  _intakeStep = Math.min(maxStep, Math.max(1, n));
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
  if (label) label.textContent = 'Step ' + _intakeStep + ' of ' + maxStep;
  document.querySelectorAll('#intake-dots .intake-dot').forEach((d, i) => {
    const active = (i + 1) === _intakeStep;
    d.classList.toggle('bg-[#C9983A]', active || (i + 1) < _intakeStep);
    d.classList.toggle('bg-[#35576D]', !active && (i + 1) > _intakeStep);
    d.classList.toggle('scale-125', active);
  });
  const back = document.getElementById('intake-back-btn');
  if (back) back.classList.toggle('invisible', _intakeStep === 1);
  const next = document.getElementById('intake-next-btn');
  if (next) next.classList.toggle('invisible', _intakeStep === maxStep);
  document.querySelectorAll('.step-scroll').forEach(p => { p.scrollTop = 0; });
  if (_intakeStep === 2) intakeSizeSketchStage();
}

// ── Order-type layout switch (step 1 Design Details) ──────────
// One dropdown drives both the fields shown AND Notion categorization.
// square-item reuses the shared square item-entry mode (_jdMode); every
// other type is plain-text custom mode.
const _TYPE_BLOCKS = { order: 'type-custom', repair: 'type-repair', resize: 'type-resize', 'square-item': 'type-square' };

// Tracks the previously-active order type so a genuine change (not a
// re-application of the same type on init/reset) can reset Items & Price.
let _intakeCurrentOrderType = 'order';

function intakeApplyTypeLayout(type) {
  type = _TYPE_BLOCKS[type] ? type : 'order';
  const sel = document.getElementById('f-order-type');
  if (sel && sel.value !== type) sel.value = type;

  // Items & Price is tied to whichever order type is active — switching
  // types starts it fresh rather than carrying over stale items/total from
  // whatever was previously selected (e.g. a Custom Design Estimate Total
  // bleeding into a freshly-picked Square Item's Total).
  if (_intakeCurrentOrderType !== type) _oiItems = [];
  _intakeCurrentOrderType = type;

  _jdMode = (type === 'square-item') ? 'square' : 'custom';
  Object.entries(_TYPE_BLOCKS).forEach(([t, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (t === type) ? '' : 'none';
  });

  // Repair / Resize / Square Item collapse to a single page: Items & Price
  // moves up under Design Details and the sketch page + Estimate Builder
  // aren't part of their flow. Custom Design keeps the original 3-step
  // wizard with Items & Price (Estimate Builder only) on step 3.
  const isSingle = type !== 'order';

  // Relocate the Items & Price block itself (only one instance of these
  // ids exists — reparenting it is what makes this "the same page 1").
  const grid        = document.getElementById('items-price-grid');
  const step1Card    = document.getElementById('step1-items-price-card');
  const step3Card    = document.getElementById('step3-card');
  const estimateCard = document.getElementById('intake-estimate');
  if (grid && step1Card && step3Card) {
    if (isSingle) {
      step1Card.style.display = '';
      step1Card.appendChild(grid);
    } else {
      step1Card.style.display = 'none';
      step3Card.insertBefore(grid, estimateCard || null);
    }
  }

  // Order Items sub-section: manual entry for Repair/Resize; Square Item
  // picks items via the step-1 catalog picker instead; Custom Design shows
  // only the Estimate Builder (no manual Order Items at all).
  const oiSection = document.getElementById('oi-section');
  if (oiSection) oiSection.style.display = (isSingle && type !== 'square-item') ? '' : 'none';

  // Total/Deposit/Balance Due travel with the relocated block for the 3
  // single-page types; hidden on Custom Design's Items & Price page
  // (Internal Notes stays visible either way — it's outside this toggle).
  ['price-fg', 'deposit-fg', 'balance-fg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isSingle ? '' : 'none';
  });
  intakeUpdateShippingField();

  // Estimate Builder is Custom-Design-only.
  if (estimateCard) estimateCard.style.display = isSingle ? 'none' : '';

  // Single-page types have no step nav at all.
  const footer = document.getElementById('intake-footer');
  const stepProgress = document.getElementById('intake-step-progress');
  if (footer) footer.style.display = isSingle ? 'none' : '';
  if (stepProgress) stepProgress.style.display = isSingle ? 'none' : '';
  // Refresh nav state either way — switching back to Custom Design needs the
  // Back/Next/tabs recomputed against the now-3-step max just as much as
  // switching to a single-page type needs to snap back to page 1.
  intakeStep(isSingle ? 1 : _intakeStep);

  if (typeof onOrderTypeChange === 'function') onOrderTypeChange(); // #ot-hint stage label
  if (typeof oiRender === 'function') oiRender(); // route items into the now-active container
}

// Shipping ($) only makes sense once Customer Info says the order is
// actually being shipped (Pickup Location → "To be Shipped"), and only on
// the 3 single-page types that carry the whole Items & Price block —
// Custom Design hides that whole block regardless (see intakeApplyTypeLayout).
function intakeUpdateShippingField() {
  const el = document.getElementById('shipping-fg');
  if (!el) return;
  const type = document.getElementById('f-order-type')?.value || 'order';
  const isShipped = document.getElementById('f-pickup')?.value === 'To be Shipped';
  el.style.display = (type !== 'order' && isShipped) ? '' : 'none';
}

// Resize → single Sizing/Dimensions string (Notion 'Sizing / Dimensions').
// Delegates to the shared formatter (js/order-widgets.js) so the string
// format only lives in one place — orders.js uses the same helper.
function _intakeResizeSizing() {
  const from = (document.getElementById('f-resize-from')?.value || '').trim();
  const to   = (document.getElementById('f-resize-to')?.value   || '').trim();
  return formatResizeSizing(from, to);
}

// ── Sketch stage sizing — fills the ENTIRE step, edge to edge, no letterboxing.
//    #sketch-stage is 100%/100% of its flex parent via CSS; the only job here
//    is keeping the CANVAS's backing store (its actual pixel grid) in sync
//    with that rendered size, since a canvas defaults to a fixed resolution
//    (was 1000×620) regardless of its CSS box — leaving it fixed is exactly
//    what caused the unused strips of space. Resizing a canvas element clears
//    it by spec, so any existing ink is snapshotted and redrawn at the new
//    size first. This is safe because intake.html is the ONLY place
//    #sketch-canvas is ever drawn on — the desktop app just displays a
//    static <img> of the finished sketch (js/orders.js eoLoadSketch), never
//    the live canvas — so there's no fixed-resolution export format to protect.
function intakeSizeSketchStage() {
  const stage = document.getElementById('sketch-stage');
  if (!stage) return;
  requestAnimationFrame(() => {
    const w = Math.round(stage.clientWidth);
    const h = Math.round(stage.clientHeight);
    if (!w || !h || typeof SK === 'undefined' || !SK) return;
    const canvas = SK.canvas;
    if (canvas.width === w && canvas.height === h) return; // already sized — don't wipe ink for nothing
    const prevURL = SK.hasInk ? canvas.toDataURL('image/png') : null;
    canvas.width  = w;
    canvas.height = h;
    _padBlank(SK);
    // Old undo/redo snapshots were captured at the previous resolution —
    // replaying them now would draw at the wrong scale, so drop them.
    SK.undo.length = 0;
    SK.redo.length = 0;
    if (prevURL) {
      const img = new Image();
      img.onload = () => { SK.ctx.drawImage(img, 0, 0, w, h); };
      img.src = prevURL;
    }
    _intakeClampDockToStage();
  });
}
window.addEventListener('resize', intakeSizeSketchStage);
window.addEventListener('orientationchange', () => setTimeout(intakeSizeSketchStage, 300));

// Keep a dragged dock inside the stage after the stage itself resizes
// (e.g. rotating the iPad) — otherwise it could end up stranded off-canvas.
function _intakeClampDockToStage() {
  const dock  = document.getElementById('sketch-dock');
  const stage = document.getElementById('sketch-stage');
  if (!dock || !stage || (!dock.style.left && !dock.style.top)) return; // still in its default CSS corner
  const sr = stage.getBoundingClientRect();
  const dr = dock.getBoundingClientRect();
  const left = Math.max(0, Math.min(parseFloat(dock.style.left) || 0, sr.width  - dr.width));
  const top  = Math.max(0, Math.min(parseFloat(dock.style.top)  || 0, sr.height - dr.height));
  dock.style.left = left + 'px';
  dock.style.top  = top  + 'px';
}

// ── Draggable tool dock — grab the header bar, drop anywhere over the canvas ──
let _dockDrag = null;

function intakeDockDragStart(e) {
  const dock  = document.getElementById('sketch-dock');
  const stage = document.getElementById('sketch-stage');
  if (!dock || !stage) return;
  const dr = dock.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  _dockDrag = { id: e.pointerId, dx: e.clientX - dr.left, dy: e.clientY - dr.top, sr, dw: dr.width, dh: dr.height };
  // Switch from right-anchored to left/top so JS can position it freely.
  dock.style.left  = (dr.left - sr.left) + 'px';
  dock.style.top   = (dr.top  - sr.top)  + 'px';
  dock.style.right = 'auto';
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  window.addEventListener('pointermove',   intakeDockDragMove);
  window.addEventListener('pointerup',     intakeDockDragEnd);
  window.addEventListener('pointercancel', intakeDockDragEnd);
  e.preventDefault();
}

function intakeDockDragMove(e) {
  if (!_dockDrag || e.pointerId !== _dockDrag.id) return;
  const dock = document.getElementById('sketch-dock');
  const { sr, dx, dy, dw, dh } = _dockDrag;
  let left = e.clientX - sr.left - dx;
  let top  = e.clientY - sr.top  - dy;
  left = Math.max(0, Math.min(left, sr.width  - dw));
  top  = Math.max(0, Math.min(top,  sr.height - dh));
  dock.style.left = left + 'px';
  dock.style.top  = top  + 'px';
}

function intakeDockDragEnd() {
  _dockDrag = null;
  window.removeEventListener('pointermove',   intakeDockDragMove);
  window.removeEventListener('pointerup',     intakeDockDragEnd);
  window.removeEventListener('pointercancel', intakeDockDragEnd);
}

// Restore the dock to its default top-right corner (used on a fresh intake).
function intakeResetDockPos() {
  const dock = document.getElementById('sketch-dock');
  if (dock) { dock.style.left = ''; dock.style.top = ''; dock.style.right = ''; dock.classList.remove('collapsed'); }
}

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
               'f-sizing', 'f-gemstones', 'f-description', 'f-job-desc', 'f-notes',
               'f-repair-notes', 'f-resize-from', 'f-resize-to'];
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

  const g = id => document.getElementById(id);
  const typeVal = (g('f-order-type') || {}).value || 'order';
  const isSquare = typeVal === 'square-item';

  const name = getFullName();
  // Order Name / Order Description are plain fields now (no _jdMode switch).
  const orderName = g('f-job-desc').value.trim();
  let   desc      = g('f-description').value.trim();
  // Square Item: fall back to the picked catalog item names if no description typed.
  if (isSquare && !desc && typeof _jdSquareItemNames === 'function') desc = _jdSquareItemNames();

  const flag = (id) => {
    const el = g(id);
    if (el) { el.style.borderColor = '#E05050'; el.addEventListener('input', () => el.style.borderColor = '', { once: true }); }
  };
  if (!name) { toast('Please fill in the customer name', '⚠'); flag('f-firstname'); intakeStep(1); return; }
  if (!desc) { toast('Please add an Order Description', '⚠'); flag('f-description'); intakeStep(1); return; }
  if (btn) btn.disabled = true;

  const items       = _oiItems.map(it => ({ ...it }));
  const addrStreet  = g('f-addr-street').value.trim();
  const addrStreet2 = g('f-addr-street2').value.trim();
  const addrCity    = g('f-addr-city').value.trim();
  const addrState   = g('f-addr-state').value.trim();
  const addrZip     = g('f-addr-zip').value.trim();
  const addrCountry = g('f-addr-country').value.trim() || 'United States';
  const typeMap     = ORDER_TYPE_STAGES[typeVal] || ORDER_TYPE_STAGES.order;

  // Type-specific fields: repair instructions and resize sizes are now
  // first-class fields (repairNotes / resizeFrom / resizeTo), read by the
  // Edit Order modal's Repair/Resize modules. Resize also mirrors a combined
  // string into `sizing` for Notion's "Sizing / Dimensions" property.
  const isRepair    = typeVal === 'repair';
  const isResize    = typeVal === 'resize';
  const repairNotes = isRepair ? g('f-repair-notes').value.trim() : '';
  const resizeFrom  = isResize ? g('f-resize-from').value.trim() : '';
  const resizeTo    = isResize ? g('f-resize-to').value.trim()   : '';
  const notes       = g('f-notes').value.trim();
  const sizing      = isResize ? _intakeResizeSizing() : g('f-sizing').value.trim();

  const order = {
    id:        'u' + Date.now(),
    name:      name,
    jobDesc:   orderName,
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
    sizing:        sizing,
    gemstones:     g('f-gemstones').value.trim(),
    finish:        [...document.querySelectorAll('#f-finish input:checked')].map(c => c.value),
    sketchImg:     (typeof sketchExport === 'function') ? sketchExport() : null,
    customerNotes: g('f-customer-notes').value.trim() || '',
    notes:         notes,
    repairNotes:   repairNotes,
    resizeFrom:    resizeFrom,
    resizeTo:      resizeTo,
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
   'f-piece-type', 'f-sizing', 'f-gemstones', 'f-repair-notes', 'f-resize-from', 'f-resize-to',
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
  oiInit();
  clearEstimate();
  const custNotes = document.getElementById('f-customer-notes');
  if (custNotes) custNotes.value = '';
  intakeApplyTypeLayout('order');
  intakeResetDockPos();
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
  intakeApplyTypeLayout('order');
  toggleShippingAddress();
  addMaterialRow();      // one empty estimate line ready to go
  setMultiplier(2.5);
  intakeStep(1);
  intakeSizeSketchStage();
  intakeUpdateUnsynced();

  // Prefill via query params (main app's "New Order for <customer>" links).
  // Only the 4 intake-supported types apply — anything else (e.g. a synced
  // order's 'etsy-order') falls back to Custom Design.
  const params = new URLSearchParams(location.search);
  if (params.get('name'))  setNameFields(params.get('name'));
  if (params.get('email')) { const el = document.getElementById('f-email'); if (el) el.value = params.get('email'); }
  if (params.get('type')  && _TYPE_BLOCKS[params.get('type')]) intakeApplyTypeLayout(params.get('type'));

  // Push any orders that never made it to Notion (offline intake at a market)
  if (navigator.onLine) notionPushUnsynced().then(intakeUpdateUnsynced);
  window.addEventListener('online', () => {
    toast('Back online — syncing…', '↻');
    notionPushUnsynced().then(intakeUpdateUnsynced);
  });
})();
