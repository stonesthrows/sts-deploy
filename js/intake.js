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

// ── Sync status chip — three states (brief 4.5):
//    synced → hidden · offline queue → quiet slate · failing while
//    ONLINE → amber (the only state that means something is wrong) ──
function intakeUpdateUnsynced() {
  const badge = document.getElementById('intake-unsynced');
  if (!badge) return;
  const n = _intakeQueued().length;
  badge.classList.remove('state-offline', 'state-error');
  if (!n) { badge.textContent = ''; intakeSyncPopClose(); return; }
  if (navigator.onLine) {
    badge.classList.add('state-error');
    badge.textContent = '⚠ ' + n + ' not syncing';
  } else {
    badge.classList.add('state-offline');
    badge.textContent = '💾 Saved on iPad · ' + n + ' queued';
  }
  if (document.getElementById('sync-pop')?.classList.contains('open')) intakeSyncPopRender();
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
  if (typeof intakeTabsRefresh === 'function') intakeTabsRefresh(); // sketch ink has no input event — catch it on step changes
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
  // Custom Design's SIZING parameters (ring size / band / stamping) still
  // live in the Step-2 bottom sheet's Sizing tab (js/intake-sheet.js) — those
  // specific Step-1 fields stay hidden in the DOM purely as the fields the
  // sheet writes into, so they don't fight it. Piece Type / Materials /
  // Finish / Gemstones have no sheet tab anymore (that chip UI was retired
  // in favor of handwriting on Paper mode's Screen 1) and stay visible here
  // as the plain-text fallback. Repair/Resize/Square layouts untouched.
  if (type === 'order' && typeof psRenderPanes === 'function') {
    ['sizing-fg', 'ringsize2-fg', 'stamping-fg', 'stamping2-fg'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

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
      grid.style.marginTop = '';
      step1Card.style.display = '';
      step1Card.appendChild(grid);
    } else {
      step1Card.style.display = 'none';
      // Custom Design: Estimate Builder drives the Total, so it reads top to
      // bottom — build the estimate, then see Total/Deposit/Balance below it.
      if (estimateCard) { grid.style.marginTop = '24px'; estimateCard.after(grid); }
      else { grid.style.marginTop = ''; step3Card.appendChild(grid); }
    }
  }

  // Order Items sub-section: manual entry for Repair/Resize; Square Item
  // picks items via the step-1 catalog picker instead; Custom Design shows
  // only the Estimate Builder (no manual Order Items at all).
  const oiSection = document.getElementById('oi-section');
  if (oiSection) oiSection.style.display = (isSingle && type !== 'square-item') ? '' : 'none';

  // Repair has no Order Description — the Repair Instructions field covers it.
  const descFg = document.getElementById('orderdesc-fg');
  if (descFg) descFg.style.display = (type === 'repair') ? 'none' : '';

  // Total/Deposit/Balance Due/Paid By show for every order type — deposits
  // are taken at the counter during intake, Custom Design included (its
  // Total is still fed by the Estimate Builder's "Use Estimate").
  ['price-fg', 'deposit-fg', 'balance-fg', 'paid-by-fg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
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

  // Phase-1 UI that keys off the order type (both hoisted from below)
  intakeDepositRefresh();   // split bar only exists on single-page types
  intakeMiniTotalUpdate();  // sticky total only exists for Custom Design
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

// ── Order For (Individual / Couple) — a couple order (e.g. matching
//    wedding bands) needs a second ring size + a second stamping field;
//    an individual order shows just the one of each.
let _intakeOrderFor = 'individual';

function intakeSetOrderFor(val) {
  _intakeOrderFor = (val === 'couple') ? 'couple' : 'individual';
  const isCouple = _intakeOrderFor === 'couple';
  document.getElementById('order-for-individual-btn')?.classList.toggle('selected', !isCouple);
  document.getElementById('order-for-couple-btn')?.classList.toggle('selected', isCouple);
  // Custom Design keeps these two sheet-owned (Step 2's Sizing tab has its
  // own 2nd-ring-size/2nd-stamping controls) — Step 1's copies stay hidden
  // regardless of Individual/Couple so there's only one editing surface.
  if (_intakeCurrentOrderType === 'order') return;
  const ringsize2Fg = document.getElementById('ringsize2-fg');
  if (ringsize2Fg) ringsize2Fg.style.display = isCouple ? '' : 'none';
  const stamping2Fg = document.getElementById('stamping2-fg');
  if (stamping2Fg) stamping2Fg.style.display = isCouple ? '' : 'none';
}

// ── Ring piece type: N-ring dynamic fields ─────────────────────
// Replaces the shared Materials/Finish/Gemstones fields + the sheet's
// Individual/Couple 2-ring cap with one field-set per ring (any count),
// each with its own name (once there's more than one), size, materials,
// texture/finish, gemstones, and an optional inside-ring stamping.
function _intakeBlankRing() {
  return { name: '', size: '', materials: '', finish: [], gemstones: '', stamping: '' };
}
let _intakeRings = [_intakeBlankRing()];

function intakeApplyPieceType(pieceType) {
  const isRing = pieceType === 'Ring';
  const countFg = document.getElementById('ring-count-fg');
  const dynWrap = document.getElementById('rings-dynamic-wrap');
  const shared  = document.getElementById('ring-fields-shared');
  if (countFg) countFg.style.display = isRing ? '' : 'none';
  if (dynWrap) dynWrap.style.display = isRing ? '' : 'none';
  if (shared)  shared.style.display  = isRing ? 'none' : 'contents';
  if (isRing) intakeRenderRingBlocks();
  // Bottom sheet's Sizing tab drops its now-redundant Order-For/ring-size-2/
  // stamping-2 controls while Piece Type is Ring — Step 1's per-ring blocks
  // are the single editing surface for that case.
  if (typeof psRenderPanes === 'function') psRenderPanes();
}

function _intakeCollectRingsFromDom() {
  const blocks = document.querySelectorAll('#rings-dynamic-list .ring-block');
  if (!blocks.length) return _intakeRings;
  return [...blocks].map((block, i) => ({
    name:      document.getElementById('f-ring-name-' + i)?.value.trim() || '',
    size:      document.getElementById('f-ring-size-' + i)?.value.trim() || '',
    materials: document.getElementById('f-ring-materials-' + i)?.value.trim() || '',
    finish:    [...block.querySelectorAll('.ring-finish input:checked')].map(c => c.value),
    gemstones: document.getElementById('f-ring-gemstones-' + i)?.value.trim() || '',
    stamping:  document.getElementById('f-ring-stamping-' + i)?.value.trim() || '',
  }));
}

// Renders a preview of the ring blocks as the user types, WITHOUT writing
// back into #f-ring-count itself — doing that mid-edit (e.g. while the
// field is briefly empty from clearing it to type a new number) fights the
// user's own keystrokes and can trap the field at a clamped value forever.
// The field's displayed value only gets normalized on blur (see below).
function intakeSetRingCount(raw) {
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 8) n = 8;
  _intakeRings = _intakeCollectRingsFromDom();
  while (_intakeRings.length < n) _intakeRings.push(_intakeBlankRing());
  _intakeRings.length = n;
  intakeRenderRingBlocks();
}

// On blur, snap the field's own displayed value into 1-8 so it never shows
// something invalid/out-of-range once the user is done editing it.
function intakeClampRingCount(el) {
  let n = parseInt(el.value, 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 8) n = 8;
  if (el.value != n) el.value = n;
}

function intakeRenderRingBlocks() {
  const list = document.getElementById('rings-dynamic-list');
  if (!list) return;
  const showName = _intakeRings.length > 1;
  const esc = v => String(v || '').replace(/"/g, '&quot;');
  list.innerHTML = _intakeRings.map((r, i) => `
    <div class="ring-block" style="border-top:1px solid #e2e2e2;margin-top:${i ? '12px' : '0'};padding-top:${i ? '12px' : '0'};">
      <div class="fg full"><label>Ring ${i + 1}</label></div>
      ${showName ? `
      <div class="fg">
        <label>Name</label>
        <input type="text" id="f-ring-name-${i}" value="${esc(r.name)}" placeholder="e.g. Sarah" oninput="_intakeRings[${i}].name=this.value">
      </div>` : ''}
      <div class="fg">
        <label>Ring Size</label>
        <input type="text" id="f-ring-size-${i}" value="${esc(r.size)}" placeholder="e.g. 7">
      </div>
      <div class="fg">
        <label>Materials / Metal</label>
        <input type="text" id="f-ring-materials-${i}" value="${esc(r.materials)}" placeholder="e.g. 14k yellow gold">
      </div>
      <div class="fg">
        <label>Texture / Finish</label>
        <div class="finish-checks ring-finish">
          <label><input type="checkbox" value="Polished" ${r.finish.includes('Polished') ? 'checked' : ''}> Polished</label>
          <label><input type="checkbox" value="Hammered/Textured" ${r.finish.includes('Hammered/Textured') ? 'checked' : ''}> Hammered</label>
          <label><input type="checkbox" value="Matte" ${r.finish.includes('Matte') ? 'checked' : ''}> Matte</label>
          <label><input type="checkbox" value="Oxidized" ${r.finish.includes('Oxidized') ? 'checked' : ''}> Oxidized</label>
        </div>
      </div>
      <div class="fg full">
        <label>Gemstones / Components</label>
        <textarea id="f-ring-gemstones-${i}" placeholder="Stones, cuts, settings, beads…" style="min-height:40px;">${esc(r.gemstones)}</textarea>
      </div>
      <div class="fg">
        <label>Inside Ring Stamping <span style="font-weight:400;">(optional)</span></label>
        <input type="text" id="f-ring-stamping-${i}" value="${esc(r.stamping)}" placeholder="e.g. Forever &amp; Always">
      </div>
    </div>
  `).join('');
}

// Flat, backward-compatible fields derived from rings[] — the desktop
// workflow app and print templates only ever understood a single ring
// (materials/gemstones/finish/sizing/stamping) plus an optional 2nd ring
// (ringSize2/stamping2, gated by orderFor==='couple'). Ring orders with
// more than 2 rings still get full detail in order.rings; these flat
// fields surface rings 1-2 only, same as the old Individual/Couple cap.
function _intakeRingsLegacyFields(rings) {
  const multi = rings.length > 1;
  const label = (r, i) => multi ? ('Ring ' + (i + 1) + (r.name ? ' (' + r.name + ')' : '')) : '';
  const join = key => rings
    .map((r, i) => r[key] ? (label(r, i) ? label(r, i) + ': ' + r[key] : r[key]) : '')
    .filter(Boolean).join('; ');
  return {
    materials: join('materials'),
    gemstones: join('gemstones'),
    finish:    [...new Set(rings.flatMap(r => r.finish || []))],
    sizing:    rings[0] && rings[0].size ? ('sz ' + rings[0].size) : '',
    ringSize2: rings[1] && rings[1].size ? ('sz ' + rings[1].size) : '',
    stamping:  (rings[0] && rings[0].stamping) || '',
    stamping2: (rings[1] && rings[1].stamping) || '',
    orderFor:  multi ? 'couple' : 'individual',
  };
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

// ── Dirty check + exit ────────────────────────────────────────
function _intakeDirty() {
  const ids = ['f-firstname', 'f-lastname', 'f-email', 'f-phone', 'f-materials',
               'f-sizing', 'f-ringsize2', 'f-stamping', 'f-stamping2', 'f-gemstones',
               'f-description', 'f-job-desc', 'f-notes',
               'f-repair-notes', 'f-resize-from', 'f-resize-to'];
  const fields = ids.some(id => {
    const el = document.getElementById(id);
    return el && el.value && el.value.trim();
  });
  const ringsDirty = document.getElementById('f-ring-count')?.value > 1
    || [...document.querySelectorAll('#rings-dynamic-list input, #rings-dynamic-list textarea')]
        .some(el => el.type === 'checkbox' ? el.checked : el.value.trim());
  return fields
    || ringsDirty
    || (typeof _oiItems !== 'undefined' && _oiItems.some(it => it.name || it.price))
    || (typeof intakeSection1Dirty === 'function' && intakeSection1Dirty())
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
// Material lines are NOT round-tripped through f-materials: that's a
// single-line <input> which strips the newlines the desktop's
// populateEstimateFromOrder() splits on. intakeSubmit() reads the live
// .est-row DOM instead (see _intakeEstMaterialLines).
function intakeUseEstimate() {
  const final = parseFloat((document.getElementById('est-final')?.textContent || '').replace('$', '')) || 0;
  if (!final) { toast('Estimate is $0 — add materials or labor first', '⚠'); return; }
  document.querySelectorAll('#est-materials .est-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc = inputs[0]?.value.trim();
    const cost = parseFloat(inputs[1]?.value) || 0;
    if (desc) intakePresetHarvest(desc, cost ? String(cost) : ''); // feed the preset chips (3.3)
  });
  const idx = _oiItems.findIndex(it => it.type === 'manual' && it.name === 'Estimate Total');
  if (idx >= 0) _oiItems[idx].price = final;
  else _oiItems.push({ type: 'manual', name: 'Estimate Total', price: final, quantity: 1 });
  oiRender();
  // In compare mode this tap is the crown ★ — the active version becomes
  // the order total; the others persist as declined alternatives (3.4)
  if (_estVariants) {
    _estCrowned = _estActive;
    intakeEstRenderVariants();
  }
  toast('Estimate set as order total ✓', '✓');
}

// Current estimate material rows in the "desc — $cost" newline-joined
// format populateEstimateFromOrder() (desktop) parses back out of
// o.materials. Same read as the desktop's saveEstimateToNotion().
function _intakeEstMaterialLines() {
  const lines = [];
  document.querySelectorAll('#est-materials .est-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc = inputs[0]?.value.trim();
    const cost = parseFloat(inputs[1]?.value) || 0;
    if (desc || cost) lines.push(desc + (cost ? ' — $' + cost.toFixed(2) : ''));
  });
  return lines.join('\n');
}

// Required-field validation shared by the review screen and the save
// itself — flags the first gap and deep-links to it (toast + red border).
function _intakeValidate() {
  const g = id => document.getElementById(id);
  const typeVal = (g('f-order-type') || {}).value || 'order';
  let desc = g('f-description').value.trim();
  if (typeVal === 'square-item' && !desc && typeof _jdSquareItemNames === 'function') desc = _jdSquareItemNames();
  const flag = (id) => {
    const el = g(id);
    if (el) { el.style.borderColor = '#E05050'; el.addEventListener('input', () => el.style.borderColor = '', { once: true }); }
  };
  if (!getFullName()) { toast('Please fill in the customer name', '⚠'); flag('f-firstname'); intakeStep(1); return false; }
  if (!desc && typeVal !== 'repair') { toast('Please add an Order Description', '⚠'); flag('f-description'); intakeStep(1); return false; }
  return true;
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
  // Repair hides the Order Description field — drop any value typed before
  // the type was switched so it doesn't submit invisibly.
  if (typeVal === 'repair') desc = '';

  if (!_intakeValidate()) return;
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
  let sizing        = isResize ? _intakeResizeSizing() : g('f-sizing').value.trim();
  // Individual vs Couple (brief: matching-set orders, e.g. wedding bands) —
  // set from the Step-2 bottom sheet's Sizing tab, so it's Custom-Design-only
  // (Repair/Resize/Square Item never reach that sheet — don't let stale
  // sheet state from an earlier Custom Design session leak into them).
  const isCustomDesign = typeVal === 'order';
  const isRingPiece = isCustomDesign && g('f-piece-type').value === 'Ring';
  const rings       = isRingPiece ? _intakeCollectRingsFromDom() : null;
  const ringLegacy  = rings ? _intakeRingsLegacyFields(rings) : null;
  const orderFor    = isCustomDesign ? (ringLegacy ? ringLegacy.orderFor : (_intakeOrderFor === 'couple' ? 'couple' : 'individual')) : '';
  const ringSize2   = ringLegacy ? ringLegacy.ringSize2 : ((isCustomDesign && orderFor === 'couple') ? g('f-ringsize2').value.trim() : '');
  const stamping    = ringLegacy ? ringLegacy.stamping : (isCustomDesign ? g('f-stamping').value.trim() : '');
  const stamping2   = ringLegacy ? ringLegacy.stamping2 : ((isCustomDesign && orderFor === 'couple') ? g('f-stamping2').value.trim() : '');
  if (ringLegacy) sizing = ringLegacy.sizing;
  // Sensitivities: structured on the order AND joined into notes so Notion +
  // the printed bag see plain text with no pipeline changes (brief 1.3).
  const sens        = intakeSensList();
  // Ring registry / occasion / style (brief 1.2, 1.4, 1.5) — same pattern:
  // structured keys + a readable gift line for notes.
  const s1          = (typeof intakeSection1Collect === 'function') ? intakeSection1Collect() : null;
  const giftLine    = (typeof intakeSection1NotesLine === 'function') ? intakeSection1NotesLine(s1) : '';

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
    paidBy:        g('f-paid-by')?.value || '',
    contactMethod: '',
    // Estimate rows are authoritative for Custom Design (the builder is
    // custom-only); otherwise fall back to the Materials/Metal text. Fixes
    // intake orders reaching Notion with no Materials at all.
    materials:     (typeVal === 'order' && _intakeEstMaterialLines()) || (ringLegacy ? ringLegacy.materials : g('f-materials').value.trim()),
    pieceType:     g('f-piece-type').value || '',
    sizing:        sizing,
    orderFor:      orderFor,
    ringSize2:     ringSize2,
    stamping:      stamping,
    stamping2:     stamping2,
    gemstones:     ringLegacy ? ringLegacy.gemstones : g('f-gemstones').value.trim(),
    finish:        ringLegacy ? ringLegacy.finish : [...document.querySelectorAll('#f-finish input:checked')].map(c => c.value),
    rings:         rings || undefined,
    sketchImg:     (typeof sketchExport === 'function') ? sketchExport() : null, // composite: underlay + ink (2.3)
    sketchInkImg:  (_ul.img && typeof sketchExportInkOnly === 'function') ? sketchExportInkOnly() : null, // ink-only for the bag print
    // Client-shown reference photos (Photos tab in the bottom sheet) —
    // stored locally like the sketch; synced to Notion's 'Reference Photos'
    // files property by the pipeline proxy.
    refPhotos:     (typeof _refPhotos !== 'undefined') ? [..._refPhotos] : [],
    // On-glass signature (4.3) — stored locally on the order like the
    // sketch; absent signature never blocks a save. Pushing it to Notion
    // as an attachment is deferred until the pipeline grows a slot for it.
    signatureImg:  (typeof SIG !== 'undefined' && SIG && SIG.hasInk) ? SIG.canvas.toDataURL('image/png') : null,
    // Paper mode's handwritten page (js/intake-paper.js) — the full-fidelity
    // human record, kept alongside the structured fields OCR'd out of it.
    paperPageImg:  (typeof paperExportPage === 'function') ? paperExportPage() : null,
    customerNotes: g('f-customer-notes').value.trim() || '',
    notes:         [(typeof psVoiceNotesText === 'function') ? psVoiceNotesText() : '',
                    notes,
                    sens.length ? '⚠ Sensitivities: ' + sens.join(', ') : '',
                    giftLine,
                    (_estVariants && _estVariants.length > 1)
                      ? 'Declined options: ' + _estVariants.filter((v, i) => i !== _estCrowned)
                          .map(v => v.label + ' $' + Math.round(_estStateTotal(v)).toLocaleString('en-US')).join(' · ')
                      : ''].filter(Boolean).join('\n'),
    sensitivities: sens,
    ringSizes:     s1 ? s1.ringSizes : [],
    wrist:         s1 ? s1.wrist : '',
    neck:          s1 ? s1.neck : '',
    styleProfile:  s1 ? s1.styleProfile : null,
    gift:          s1 ? s1.gift : null,
    stones:        (typeof _psStones !== 'undefined') ? _psStones.map(st => ({ ...st })) : [],
    // Declined tier alternatives — upsell memory (3.4)
    estimateAlternatives: (_estVariants && _estVariants.length > 1)
      ? _estVariants.map((v, i) => ({ label: v.label, total: Math.round(_estStateTotal(v) * 100) / 100, crowned: i === _estCrowned }))
                    .filter(v => !v.crowned)
      : [],
    repairNotes:   repairNotes,
    resizeFrom:    resizeFrom,
    resizeTo:      resizeTo,
    // Estimate state (Custom Design only) — travels with the order so the
    // desktop Estimate Builder reproduces this exact total instead of
    // recomputing from defaults (labor/adjustment otherwise never leave
    // this iPad's DOM). Matches the shape saveEstimateToNotion() writes.
    estimate: typeVal === 'order' ? {
      labor:      parseFloat(g('est-labor')?.value) || 0,
      shipping:   parseFloat(g('est-shipping')?.value) || 0,
      taxOn:      g('est-tax-toggle')?.checked || false,
      multiplier: (typeof estMultiplier !== 'undefined') ? estMultiplier : 2.5,
      adjustment: (typeof _estAdj !== 'undefined') ? _estAdj : 0,
    } : null,
  };

  ORDERS.push(order);
  saveToStorage();
  // Upsert the Client Profile as a side effect — no separate data-entry chore
  if (typeof stsCustUpsertFromOrder === 'function') stsCustUpsertFromOrder(order);

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
   'f-piece-type', 'f-sizing', 'f-ringsize2', 'f-stamping', 'f-stamping2',
   'f-gemstones', 'f-repair-notes', 'f-resize-from', 'f-resize-to',
   'f-sensitivity-note',
   'f-addr-street', 'f-addr-street2', 'f-addr-city', 'f-addr-state', 'f-addr-zip']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.style.borderColor = ''; }
    });
  document.querySelectorAll('#f-finish input').forEach(c => c.checked = false);
  document.querySelectorAll('#f-sensitivities input').forEach(c => c.checked = false);
  intakeSensChanged();
  intakeSetOrderFor('individual');
  _intakeRings = [_intakeBlankRing()];
  const ringCountEl = document.getElementById('f-ring-count');
  if (ringCountEl) ringCountEl.value = 1;
  intakeRenderRingBlocks();
  intakeApplyPieceType('');
  _depMode = null;
  document.getElementById('est-preset-strip')?.classList.remove('open');
  if (typeof intakeProfileReset === 'function') intakeProfileReset();
  if (typeof intakeSection1Reset === 'function') intakeSection1Reset();
  if (typeof psReset === 'function') psReset();
  if (typeof intakeSigClear === 'function' && SIG) intakeSigClear();
  if (typeof intakeReviewClose === 'function') intakeReviewClose();
  if (typeof intakeEstReset === 'function') intakeEstReset();
  if (typeof ulReset === 'function') ulReset();
  if (typeof psVoiceReset === 'function') psVoiceReset();
  ['f-pickup', 'f-source', 'f-assignee', 'f-paid-by'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
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

// ════════════════════════════════════════════
//  PHASE 1 UX — sticky total, material presets, deposit presets,
//  sensitivities, 3-state sync chip. All intake-only: shared
//  order-widgets.js functions are WRAPPED here, never edited.
// ════════════════════════════════════════════

// ── Long-press helper (pin presets) — cancels on >8px drift ──
function _intakeLongPress(container, resolve) {
  if (!container) return;
  let timer = null, x0 = 0, y0 = 0;
  container.addEventListener('pointerdown', e => {
    x0 = e.clientX; y0 = e.clientY;
    const t = e.target;
    clearTimeout(timer);
    timer = setTimeout(() => { container._lpFired = true; resolve(t); }, 600);
  });
  container.addEventListener('pointermove', e => {
    if (Math.hypot(e.clientX - x0, e.clientY - y0) > 8) clearTimeout(timer);
  });
  ['pointerup', 'pointercancel'].forEach(ev => container.addEventListener(ev, () => clearTimeout(timer)));
}

// ── 3.1 Sticky running total (step 3) ─────────────────────────
let _estTotalBoxVisible = false;
let _miniAnimId = null, _miniShownVal = 0;

function _miniFmt(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function intakeMiniTotalUpdate() {
  const bar = document.getElementById('est-mini-bar');
  if (!bar) return;
  const num = id => parseFloat((document.getElementById(id)?.textContent || '').replace(/[$,]/g, '')) || 0;
  const final = num('est-final');
  const estimateCard = document.getElementById('intake-estimate');
  const estHidden = !estimateCard || estimateCard.style.display === 'none';
  bar.classList.toggle('est-mini-hidden', estHidden || final <= 0 || _estTotalBoxVisible);
  const crumb = document.getElementById('est-mini-crumb');
  if (crumb) {
    const money = n => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    const shipping = parseFloat(document.getElementById('est-shipping')?.value) || 0;
    const taxOn = document.getElementById('est-tax-toggle')?.checked || false;
    crumb.textContent = '= (materials ' + money(num('est-mat-total')) + ' + labor ' + money(num('est-labor-display'))
      + ') × ' + estMultiplier + (shipping > 0 ? ' + shipping' : '') + (taxOn ? ' + tax' : '');
  }
  // ~200ms count animation toward the new total
  const totalEl = document.getElementById('est-mini-total');
  if (!totalEl) return;
  cancelAnimationFrame(_miniAnimId);
  const from = _miniShownVal, t0 = performance.now(), dur = 200;
  // Hidden page = no rAF ticks — set the value directly so it can't go stale
  if (document.hidden || Math.abs(final - from) < 0.005) { totalEl.textContent = _miniFmt(final); _miniShownVal = final; return; }
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    _miniShownVal = from + (final - from) * p;
    totalEl.textContent = _miniFmt(_miniShownVal);
    if (p < 1) _miniAnimId = requestAnimationFrame(step);
  };
  _miniAnimId = requestAnimationFrame(step);
}

// Fade the bar out whenever the real total box is on screen
(function () {
  const box = document.querySelector('#intake-estimate .est-total-box');
  const root = document.getElementById('step-3');
  if (!box || !root || typeof IntersectionObserver === 'undefined') return;
  new IntersectionObserver(entries => {
    _estTotalBoxVisible = entries[0].isIntersecting;
    intakeMiniTotalUpdate();
  }, { root, threshold: 0.15 }).observe(box);
})();

// ── 3.3 Material preset chips ─────────────────────────────────
const _EST_PRESET_SEED = [
  'Sterling Silver Sheet', 'Sterling Silver Wire', '14k Yellow Gold',
  '14k Gold-Fill Wire', 'Casting Grain — Sterling', 'Solder & Consumables',
  'Chain', 'Clasp',
];

function _presetLoad() {
  try {
    const s = JSON.parse(localStorage.getItem('sts-material-presets') || 'null');
    if (s && Array.isArray(s.items)) return s;
  } catch (e) {}
  return { v: 1, items: _EST_PRESET_SEED.map(d => ({ desc: d, cost: '', count: 0, last: 0, pinned: false })) };
}

function _presetSave(s) {
  try { localStorage.setItem('sts-material-presets', JSON.stringify(s)); } catch (e) {}
}

function intakePresetHarvest(desc, cost) {
  desc = (desc || '').trim();
  if (!desc) return;
  const s = _presetLoad();
  const key = desc.toLowerCase();
  let it = s.items.find(i => i.desc.trim().toLowerCase() === key);
  if (!it) { it = { desc, cost: '', count: 0, last: 0, pinned: false }; s.items.push(it); }
  it.count++;
  it.last = Date.now();
  if (cost) it.cost = cost;
  if (s.items.length > 60) {
    s.items.sort((a, b) => (b.pinned - a.pinned) || (b.last - a.last));
    s.items.length = 60;
  }
  _presetSave(s);
}

function intakePresetTogglePin(desc, cost) {
  desc = (desc || '').trim();
  if (!desc) return;
  const s = _presetLoad();
  const key = desc.toLowerCase();
  let it = s.items.find(i => i.desc.trim().toLowerCase() === key);
  if (!it) { it = { desc, cost: cost || '', count: 0, last: 0, pinned: false }; s.items.push(it); }
  it.pinned = !it.pinned;
  if (cost) it.cost = cost;
  _presetSave(s);
  toast(it.pinned ? '★ Pinned "' + it.desc + '"' : 'Unpinned "' + it.desc + '"');
  intakePresetRenderStrip();
}

function intakeEstAddLine() {
  const strip = document.getElementById('est-preset-strip');
  if (!strip) { addMaterialRow(); return; }
  if (strip.classList.toggle('open')) intakePresetRenderStrip();
}

function intakePresetRenderStrip() {
  const strip = document.getElementById('est-preset-strip');
  if (!strip) return;
  const s = _presetLoad();
  const recents = s.items.filter(i => i.count > 0).sort((a, b) => b.last - a.last).slice(0, 6);
  const pinned  = s.items.filter(i => i.pinned && !recents.includes(i));
  const fresh   = s.items.filter(i => !i.pinned && !i.count && !recents.includes(i));
  const chips   = recents.concat(pinned, fresh).slice(0, 12);
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  strip.innerHTML =
    '<button type="button" class="est-preset-chip blank" data-blank="1">＋ Blank line</button>' +
    chips.map(i =>
      '<button type="button" class="est-preset-chip' + (i.pinned ? ' pinned' : '') + '" data-desc="' + esc(i.desc) + '" data-cost="' + esc(i.cost || '') + '">'
      + esc(i.desc) + (i.cost ? ' <span class="chip-cost">$' + esc(i.cost) + '</span>' : '')
      + '</button>'
    ).join('');
}

// Chip tap → add row; long-press chip or a filled estimate row → pin
(function () {
  const strip = document.getElementById('est-preset-strip');
  if (strip) {
    strip.addEventListener('click', e => {
      if (strip._lpFired) { strip._lpFired = false; return; } // long-press already handled
      const chip = e.target.closest('.est-preset-chip');
      if (!chip) return;
      if (chip.dataset.blank) { addMaterialRow(); return; }
      addMaterialRow(chip.dataset.desc, chip.dataset.cost || '');
      toast('Added ' + chip.dataset.desc, '✓', 1600);
    });
    _intakeLongPress(strip, t => {
      const chip = t.closest && t.closest('.est-preset-chip');
      if (chip && !chip.dataset.blank) intakePresetTogglePin(chip.dataset.desc, chip.dataset.cost);
    });
  }
  _intakeLongPress(document.getElementById('est-materials'), t => {
    const row = t.closest && t.closest('.est-row');
    if (!row) return;
    const inputs = row.querySelectorAll('input');
    const desc = (inputs[0] ? inputs[0].value : '').trim();
    if (desc) intakePresetTogglePin(desc, inputs[1] ? inputs[1].value : '');
  });
})();

// ── 3.5 Deposit presets + due-today/balance split bar ─────────
let _depMode = null;       // 0.5 | 1 | 'custom' | null
let _depApplying = false;  // true while a preset writes f-deposit

function _depBase() {
  const price    = parseFloat(document.getElementById('f-price')?.value) || 0;
  const shipping = parseFloat(document.getElementById('f-shipping')?.value) || 0;
  return price + shipping;
}

function intakeDepositManual() { if (!_depApplying) _depMode = 'custom'; }

function intakeDepositPreset(mode) {
  _depMode = mode;
  if (mode === 'custom') {
    document.getElementById('f-deposit')?.focus();
    intakeDepositRefresh();
    return;
  }
  _depApply(false);
}

function _depApply(flash) {
  const f = document.getElementById('f-deposit');
  if (!f || typeof _depMode !== 'number') return;
  const val = Math.round(_depBase() * _depMode * 100) / 100;
  _depApplying = true;
  f.value = val ? val.toFixed(2) : '';
  _depApplying = false;
  eoUpdateBalanceDue();
  if (flash) {
    [f, document.querySelector('.dep-split-bar')].forEach(el => {
      if (!el) return;
      el.classList.remove('dep-flash'); void el.offsetWidth; el.classList.add('dep-flash');
    });
  }
}

function intakeDepositRefresh() {
  const base = _depBase();
  const deposit = parseFloat(document.getElementById('f-deposit')?.value) || 0;
  const fmt = n => '$' + (Math.round(n) === n ? n.toFixed(0) : n.toFixed(2));
  const b50 = document.getElementById('dep-50'), b100 = document.getElementById('dep-100'), bc = document.getElementById('dep-custom');
  if (b50)  { b50.textContent  = base > 0 ? '50% · ' + fmt(base * 0.5) : '50%'; b50.classList.toggle('selected', _depMode === 0.5); }
  if (b100) { b100.textContent = base > 0 ? '100% · ' + fmt(base) : '100%';     b100.classList.toggle('selected', _depMode === 1); }
  if (bc)   bc.classList.toggle('selected', _depMode === 'custom');
  // A stale 50% silently becoming 43% erodes trust — if the total moved
  // after a percent preset was chosen, recompute and flash once.
  if (typeof _depMode === 'number' && Math.abs(deposit - Math.round(base * _depMode * 100) / 100) > 0.005) {
    _depApply(true); // re-enters this function via eoUpdateBalanceDue with matching values
    return;
  }
  const wrap = document.getElementById('deposit-split-fg');
  if (!wrap) return;
  const show = base > 0;
  wrap.style.display = show ? '' : 'none';
  if (!show) return;
  const seg = document.getElementById('dep-split-today');
  if (seg) seg.style.width = Math.max(0, Math.min(100, (deposit / base) * 100)) + '%';
  const lt = document.getElementById('dep-split-label-today');
  const lb = document.getElementById('dep-split-label-balance');
  if (lt) lt.textContent = 'Due today ' + fmt(deposit);
  if (lb) lb.textContent = 'Balance at pickup ' + fmt(Math.max(base - deposit, 0));
}

// ── 1.3 Metal & skin sensitivities (order-level) ──────────────
const _SENS_SHORT = {
  'Nickel': 'Ni', 'Sterling/copper alloys': 'Cu', 'Gold-fill': 'GF',
  'Brass/bronze': 'Brass', 'Plated finishes': 'Plated',
};
const _SENS_CONFLICTS = {
  'Nickel': /nickel|white gold|stainless/i,
  'Sterling/copper alloys': /sterling|\b925\b|copper/i,
  'Gold-fill': /gold[\s-]?fill/i,
  'Brass/bronze': /brass|bronze/i,
  'Plated finishes': /plated|plating|vermeil/i,
};

function intakeSensList() {
  const checks = [...document.querySelectorAll('#f-sensitivities input:checked')].map(c => c.value);
  const note = (document.getElementById('f-sensitivity-note')?.value || '').trim();
  return note ? checks.concat([note]) : checks;
}

function intakeSensChanged() {
  const checks = [...document.querySelectorAll('#f-sensitivities input:checked')].map(c => c.value);
  const badge = document.getElementById('sens-badge');
  if (badge) {
    badge.textContent = checks.length ? '⚠ ' + checks.map(c => _SENS_SHORT[c] || c).join(' · ') : '';
    badge.style.display = checks.length ? 'inline-block' : 'none';
  }
  // Non-blocking inline warning when the materials text names a risky alloy
  const matText = (document.getElementById('f-materials')?.value || '') + ' '
                + (document.getElementById('f-gemstones')?.value || '');
  const hits = checks.filter(c => _SENS_CONFLICTS[c] && _SENS_CONFLICTS[c].test(matText));
  const msg = hits.length ? '⚠ Client sensitivity: ' + hits.join(', ') + ' — double-check this alloy before committing.' : '';
  // Same warning renders in both places: the Step-1 grid (single-page
  // types) and the bottom sheet's Metal pane (Custom Design, brief 2.5)
  ['sens-warn', 'ps-sens-warn'].forEach(id => {
    const warn = document.getElementById(id);
    if (!warn) return;
    warn.textContent = msg;
    warn.style.display = msg ? 'block' : 'none';
  });
}

// ── 4.5 Sync chip popover + manual retry ──────────────────────
function _intakeQueued() {
  return ORDERS.filter(o => !o.notionId && String(o.id).startsWith('u'));
}

function intakeSyncPopToggle() {
  const pop = document.getElementById('sync-pop');
  if (pop && pop.classList.toggle('open')) intakeSyncPopRender();
}

function intakeSyncPopClose() {
  document.getElementById('sync-pop')?.classList.remove('open');
}

function intakeSyncPopRender() {
  const list = document.getElementById('sync-pop-list');
  if (!list) return;
  const q = _intakeQueued();
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  list.innerHTML = q.length
    ? q.map(o => {
        const label = (ORDER_TYPE_STAGES[o.orderType] || ORDER_TYPE_STAGES.order).label;
        const ts = parseInt(String(o.id).slice(1), 10);
        const when = ts ? new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
        return '<div class="sync-pop-row"><span class="sp-name">' + esc(o.name || '(no name)') + '</span>'
             + '<span class="sp-meta">' + esc(label) + (when ? ' · ' + when : '') + '</span></div>';
      }).join('')
    : '<div class="sync-pop-row"><span class="sp-name">All synced ✓</span></div>';
  const retry = document.getElementById('sync-retry-btn');
  if (retry) retry.style.display = q.length ? '' : 'none';
}

async function intakeSyncRetry() {
  const btn = document.getElementById('sync-retry-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try { await notionPushUnsynced(); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Retry now'; }
    intakeUpdateUnsynced();
    if (_intakeQueued().length && navigator.onLine) {
      toast('Still not syncing — check connection or the pipeline token', '⚠', 4500);
    }
  }
}

// Close the popover on any outside tap; re-evaluate chip state on
// connectivity changes (the push itself is handled by the existing listeners)
document.addEventListener('pointerdown', e => {
  const pop = document.getElementById('sync-pop');
  if (pop && pop.classList.contains('open')
      && !e.target.closest('#sync-pop') && !e.target.closest('#intake-unsynced')) {
    intakeSyncPopClose();
  }
});
window.addEventListener('offline', () => intakeUpdateUnsynced());
window.addEventListener('online',  () => intakeUpdateUnsynced());

// ── 3.2 Adjustment line + 3.4 Good/Better/Best tiers ──────────
// Estimate state lifted out of the DOM into a plain object so it can be
// held 2–3 times (variants) and replayed. The adjustment folds in AFTER
// markup and BEFORE tax — applied by the intake-side calcEstimate wrapper,
// never by editing shared order-widgets.js.
let _estAdj = 0;            // dollars added to the marked total (negative = discount)
let _estVariants = null;    // null = compare mode off; else [{label, rows, labor, shipping, taxOn, multiplier, adjustment}]
let _estActive = 0;
let _estCrowned = 0;

function _estReadDom() {
  let matTotal = 0;
  const rows = [];
  document.querySelectorAll('#est-materials .est-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc = inputs[0]?.value.trim() || '';
    const cost = parseFloat(inputs[1]?.value) || 0;
    matTotal += cost;
    if (desc || cost) rows.push({ desc, cost });
  });
  const labor    = parseFloat(document.getElementById('est-labor')?.value) || 0;
  const shipping = parseFloat(document.getElementById('est-shipping')?.value) || 0;
  const taxOn    = document.getElementById('est-tax-toggle')?.checked || false;
  return { rows, matTotal, labor, shipping, taxOn, r: taxOn ? 0.0825 : 0, marked: (matTotal + labor) * estMultiplier };
}

// Re-derives tax + final with the adjustment in place and overwrites the
// totals the shared calcEstimate() just wrote. Runs inside the wrapper.
function intakeEstApplyAdjustment() {
  const adjRow = document.getElementById('est-adj-row');
  const clearBtn = document.getElementById('est-adj-clear');
  if (clearBtn) clearBtn.style.display = _estAdj ? '' : 'none';
  if (!_estAdj) { if (adjRow) adjRow.style.display = 'none'; return; }
  const n = _estReadDom();
  const adjusted = n.marked + _estAdj;
  const tax = n.taxOn ? adjusted * 0.0825 : 0;
  const final = adjusted + n.shipping + tax;
  const fmt = v => '$' + v.toFixed(2);
  if (adjRow) adjRow.style.display = '';
  const disp = document.getElementById('est-adj-display');
  if (disp) disp.textContent = (_estAdj < 0 ? '−$' : '+$') + Math.abs(_estAdj).toFixed(2);
  const margin = document.getElementById('est-adj-margin');
  if (margin) margin.textContent = n.marked ? ((_estAdj / n.marked) * 100).toFixed(1) + '% margin' : '';
  if (document.getElementById('est-tax-display')) document.getElementById('est-tax-display').textContent = fmt(tax);
  if (document.getElementById('est-final')) document.getElementById('est-final').textContent = fmt(final);
}

function _estCurrentFinal() {
  return parseFloat((document.getElementById('est-final')?.textContent || '').replace(/[$,]/g, '')) || 0;
}

function _estSetAdjFromTarget(target) {
  const n = _estReadDom();
  if (!n.marked) { toast('Add materials or labor first', '⚠'); return; }
  // Full precision on purpose: with tax on, a cent-rounded adjustment can
  // leave the final a penny off the round target. Display rounds, math doesn't.
  _estAdj = (target - n.shipping) / (1 + n.r) - n.marked;
  if (Math.abs(_estAdj) < 0.005) _estAdj = 0;
  calcEstimate();
}

function intakeEstRound(step) {
  const final = _estCurrentFinal();
  if (!final) { toast('Add materials or labor first', '⚠'); return; }
  _estSetAdjFromTarget(Math.round(final / step) * step);
}

function intakeEstNudge(delta) {
  const final = _estCurrentFinal();
  if (!final) { toast('Add materials or labor first', '⚠'); return; }
  _estSetAdjFromTarget(Math.round((final + delta) * 100) / 100);
}

function intakeEstAdjClear() {
  _estAdj = 0;
  calcEstimate();
}

// ── Variant (tier) plumbing ───────────────────────────────────
function estStateCapture(label) {
  const n = _estReadDom();
  return { label, rows: n.rows.map(r => ({ ...r })), labor: n.labor, shipping: n.shipping,
           taxOn: n.taxOn, multiplier: estMultiplier, adjustment: _estAdj };
}

function estStateApply(s) {
  const container = document.getElementById('est-materials');
  if (container) container.innerHTML = '';
  const laborEl = document.getElementById('est-labor');
  if (laborEl) laborEl.value = s.labor || '';
  const shipEl = document.getElementById('est-shipping');
  if (shipEl) shipEl.value = s.shipping || '';
  const taxEl = document.getElementById('est-tax-toggle');
  if (taxEl) taxEl.checked = !!s.taxOn;
  _estAdj = s.adjustment || 0;
  setMultiplier(s.multiplier || 2.5);
  if (s.rows.length) s.rows.forEach(r => addMaterialRow(r.desc, r.cost ? String(r.cost) : ''));
  else addMaterialRow();
}

function _estStateTotal(s) {
  const mat = s.rows.reduce((sum, r) => sum + (r.cost || 0), 0);
  const adjusted = (mat + s.labor) * (s.multiplier || 2.5) + (s.adjustment || 0);
  return adjusted * (s.taxOn ? 1.0825 : 1) + (s.shipping || 0);
}

function intakeEstCompare() {
  if (_estVariants && _estVariants.length >= 3) {
    toast('Three versions max — remove one first', '⚠');
    return;
  }
  const nextLetter = String.fromCharCode(65 + (_estVariants ? _estVariants.length : 1)); // B, C
  const label = (prompt('Label for the new version (e.g. "14k / lab"):', 'Option ' + nextLetter) || 'Option ' + nextLetter).trim();
  if (!_estVariants) {
    const base = estStateCapture('Option A');
    _estVariants = [base, { ...estStateCapture(label) }];
    _estActive = 1;
    _estCrowned = 0;
  } else {
    _estVariants[_estActive] = estStateCapture(_estVariants[_estActive].label);
    _estVariants.push(estStateCapture(label));
    _estActive = _estVariants.length - 1;
  }
  estStateApply(_estVariants[_estActive]);
  intakeEstRenderVariants();
}

function intakeEstSwitchVariant(i) {
  if (!_estVariants || i === _estActive) return;
  _estVariants[_estActive] = estStateCapture(_estVariants[_estActive].label);
  _estActive = i;
  estStateApply(_estVariants[i]);
  intakeEstRenderVariants();
}

function intakeEstRemoveVariant(i) {
  if (!_estVariants) return;
  _estVariants.splice(i, 1);
  if (_estCrowned >= _estVariants.length) _estCrowned = 0;
  if (_estVariants.length < 2) {
    if (_estVariants.length === 1) estStateApply(_estVariants[0]);
    _estVariants = null;
    _estActive = 0;
  } else {
    if (_estActive >= _estVariants.length) _estActive = _estVariants.length - 1;
    estStateApply(_estVariants[_estActive]);
  }
  intakeEstRenderVariants();
}

function intakeEstRenderVariants() {
  const bar = document.getElementById('est-variants');
  if (!bar) return;
  if (!_estVariants) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  // keep the active variant's snapshot fresh so inactive totals are honest
  _estVariants[_estActive] = estStateCapture(_estVariants[_estActive].label);
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  bar.style.display = '';
  bar.innerHTML = _estVariants.map((v, i) =>
    '<span class="est-var-chip' + (i === _estActive ? ' active' : '') + '" onclick="intakeEstSwitchVariant(' + i + ')">'
    + (i === _estCrowned ? '★ ' : '') + esc(v.label)
    + ' <span class="ev-total">$' + Math.round(_estStateTotal(v)).toLocaleString('en-US') + '</span>'
    + (_estVariants.length > 1 ? '<button type="button" class="ev-x" onclick="event.stopPropagation();intakeEstRemoveVariant(' + i + ')" aria-label="Remove version">✕</button>' : '')
    + '</span>'
  ).join('');
}

function intakeEstReset() {
  _estAdj = 0;
  _estVariants = null;
  _estActive = 0;
  _estCrowned = 0;
  intakeEstRenderVariants();
}

// ── 2.3 Reference-photo underlay ──────────────────────────────
// Image layer UNDER the ink at ~30% opacity. The ink canvas is flipped
// to transparent-backed (pad.transparent — guarded opt-in in
// sketchpad.js; the desktop's pads never set it). Two-finger pinch/drag
// positions the photo — touch pointers are ignored by the pen-only pad,
// so the gesture can't be confused with Apple Pencil ink.
const _ul = { img: null, x: 0, y: 0, s: 1, opacity: 0.3, visible: true };

function _ulApply() {
  const el = document.getElementById('sketch-underlay');
  if (!el) return;
  const on = _ul.img && _ul.visible;
  el.style.display = on ? 'block' : 'none';
  if (on) {
    el.style.transform = 'translate(' + _ul.x + 'px,' + _ul.y + 'px) scale(' + _ul.s + ')';
    el.style.opacity = _ul.opacity;
  }
  const controls = document.getElementById('ul-controls');
  if (controls) controls.style.display = _ul.img ? '' : 'none';
  const opRow = document.getElementById('ul-opacity-row');
  if (opRow) opRow.style.display = (_ul.img && _ul.visible) ? '' : 'none';
  const toggle = document.getElementById('ul-toggle-btn');
  if (toggle) toggle.classList.toggle('on', _ul.visible);
}

function ulPick() { document.getElementById('ul-file')?.click(); }

function ulFileChosen(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      _ul.img = img;
      _ul.visible = true;
      const el = document.getElementById('sketch-underlay');
      if (el) el.src = img.src;
      // Fit-contain into the stage, centered
      const stage = document.getElementById('sketch-stage');
      const sw = stage?.clientWidth || 800, sh = stage?.clientHeight || 600;
      _ul.s = Math.min(sw / img.naturalWidth, sh / img.naturalHeight) * 0.92;
      _ul.x = (sw - img.naturalWidth * _ul.s) / 2;
      _ul.y = (sh - img.naturalHeight * _ul.s) / 2;
      _ulApply();
      toast('Photo under the ink — two-finger drag / pinch to position', '🖼', 3200);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function ulToggle() {
  if (!_ul.img) return;
  _ul.visible = !_ul.visible;
  _ulApply();
}

function ulRemove() {
  _ul.img = null;
  const el = document.getElementById('sketch-underlay');
  if (el) el.removeAttribute('src');
  _ulApply();
}

function ulSetOpacity(v) {
  _ul.opacity = (parseFloat(v) || 30) / 100;
  const val = document.getElementById('ul-opacity-val');
  if (val) val.textContent = Math.round(_ul.opacity * 100) + '%';
  _ulApply();
}

function ulReset() {
  ulRemove();
  _ul.x = 0; _ul.y = 0; _ul.s = 1; _ul.opacity = 0.3; _ul.visible = true;
  const slider = document.getElementById('ul-opacity');
  if (slider) slider.value = 30;
  const val = document.getElementById('ul-opacity-val');
  if (val) val.textContent = '30%';
}

// Two-finger pinch/drag — tracked on the stage; captured pen strokes
// still bubble here but pointerType 'touch' filtering keeps them apart.
(function () {
  const stage = document.getElementById('sketch-stage');
  if (!stage) return;
  const pts = new Map();
  const mid  = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || !_ul.img) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    if (pts.size === 2) {
      const m0 = mid(), d0 = dist();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const m1 = mid(), d1 = dist();
      const ratio = d1 / d0;
      const r = stage.getBoundingClientRect();
      const mx = m1.x - r.left, my = m1.y - r.top;
      // zoom anchored at the pinch midpoint, then pan by the midpoint delta
      _ul.s = Math.max(0.05, Math.min(8, _ul.s * ratio));
      _ul.x = mx - (mx - (_ul.x + (m1.x - m0.x))) * ratio;
      _ul.y = my - (my - (_ul.y + (m1.y - m0.y))) * ratio;
      _ulApply();
    } else {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  });
  ['pointerup', 'pointercancel'].forEach(ev => stage.addEventListener(ev, e => pts.delete(e.pointerId)));
})();

// Flip the intake sketch pad to transparent-backed so the underlay shows
// through (the pad was created blank by sketchpad.js — nothing to lose)
if (typeof SK !== 'undefined' && SK) { SK.transparent = true; _padBlank(SK); }

// Exports (2.3): composite (underlay + ink) is the default order.sketchImg;
// ink-only stays available for the printed bag.
const _owSketchExport = sketchExport;
sketchExport = function () {
  if (typeof SK === 'undefined' || !SK) return null;
  const hasPhoto = !!(_ul.img && _ul.visible);
  if (!SK.hasInk && !hasPhoto) return null;
  const c = document.createElement('canvas');
  c.width = SK.canvas.width; c.height = SK.canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (hasPhoto) {
    ctx.globalAlpha = _ul.opacity;
    ctx.setTransform(_ul.s, 0, 0, _ul.s, _ul.x, _ul.y);
    ctx.drawImage(_ul.img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(SK.canvas, 0, 0);
  return c.toDataURL('image/png');
};

function sketchExportInkOnly() {
  if (typeof SK === 'undefined' || !SK || !SK.hasInk) return null;
  const c = document.createElement('canvas');
  c.width = SK.canvas.width; c.height = SK.canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(SK.canvas, 0, 0);
  return c.toDataURL('image/png');
}

// ── 4.1 Quick add-on slide-over ───────────────────────────────
// Standing add-ons are hardcoded v1 per the brief; the Square search
// reuses the row plumbing with a reserved 'qa' index — the inline
// oiSelectSquareResult('qa', i) in rendered rows no-ops safely
// (_oiItems['qa'] is undefined), our delegated handler does the work.
const _QA_ADDONS = [
  { name: 'Engraving',     price: 45 },
  { name: 'Rush fee',      price: 50 },
  { name: 'Chain upgrade', price: 30 },
  { name: 'Gift wrap',     price: 5 },
];

function qaOpen() {
  document.getElementById('qa-scrim')?.classList.add('open');
  document.getElementById('qa-panel')?.classList.add('open');
}

function qaClose() {
  document.getElementById('qa-scrim')?.classList.remove('open');
  document.getElementById('qa-panel')?.classList.remove('open');
  const search = document.getElementById('qa-search');
  if (search) search.value = '';
  const box = document.getElementById('oi-results-qa');
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
}

function qaAddManual(name, price) {
  _oiItems.push({ type: 'manual', name, price, quantity: 1 });
  oiRender();
  toast(name + ' +$' + price + ' added', '✓', 2200);
  qaClose();
}

(function () {
  const list = document.getElementById('qa-addon-list');
  if (list) {
    list.innerHTML = _QA_ADDONS.map((a, i) =>
      '<button type="button" class="qa-addon" onclick="qaAddManual(\'' + a.name + '\',' + a.price + ')">'
      + '<span>' + a.name + '</span><span class="qa-price">+$' + a.price + '</span></button>'
    ).join('');
  }
  // Square result tap: adopt the row plumbing's item shape by pushing a
  // placeholder, aliasing the cached results to that index, and letting
  // oiSelectSquareResult() build the item (modifier defaults included).
  document.getElementById('oi-results-qa')?.addEventListener('click', e => {
    const row = e.target.closest('.rq-result-item');
    if (!row) return;
    const i = [...row.parentElement.querySelectorAll('.rq-result-item')].indexOf(row);
    const results = _oiLastResults['qa'] || [];
    if (!results[i]) return;
    const idx = _oiItems.length;
    _oiItems.push({ type: 'square' });
    _oiLastResults[idx] = results;
    oiSelectSquareResult(idx, i);
    delete _oiLastResults[idx];
    toast(results[i].name + ' added', '✓', 2200);
    qaClose();
  });
  // Swipe-right dismissal — can't be confused with drawing (right edge)
  const panel = document.getElementById('qa-panel');
  if (panel) {
    let sx = null;
    panel.addEventListener('pointerdown', e => { sx = e.clientX; });
    panel.addEventListener('pointermove', e => {
      if (sx !== null && e.clientX - sx > 70) { sx = null; qaClose(); }
    });
    panel.addEventListener('pointerup', () => { sx = null; });
  }
})();

// ── 4.4 Step tabs: completion glyphs + long-press peek ────────
function _intakeTabStates() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const s1done = !!(getFullName() && v('f-description'));
  const s1any = ['f-firstname', 'f-lastname', 'f-email', 'f-phone', 'f-description', 'f-job-desc'].some(id => v(id))
    || (typeof intakeSection1Dirty === 'function' && intakeSection1Dirty())
    || intakeSensList().length > 0;
  const sketch = typeof SK !== 'undefined' && SK && SK.hasInk;
  const hasPhotos = typeof _refPhotos !== 'undefined' && _refPhotos.length > 0;
  const params = !!(v('f-materials') || v('f-gemstones') || v('f-sizing') || hasPhotos);
  const price = parseFloat(v('f-price')) || 0;
  const s3any = !!(price || v('f-notes') || v('f-deposit') || _estReadDom().marked > 0);
  const state = (done, any) => done ? 'done' : any ? 'partial' : 'empty';
  return {
    1: state(s1done, s1any),
    2: state(sketch && params, sketch || params),
    3: state(price > 0, s3any),
  };
}

function intakeTabsRefresh() {
  const states = _intakeTabStates();
  const GLYPH = { done: '✓', partial: '●', empty: '○' };
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById('tab-glyph-' + i);
    if (!el) continue;
    el.textContent = GLYPH[states[i]];
    el.className = 'tab-glyph g-' + states[i];
  }
}

function _intakeTabPeekShow(step) {
  const peek = document.getElementById('tab-peek');
  if (!peek) return;
  const v = id => (document.getElementById(id)?.value || '').trim();
  const row = (label, ok, val) =>
    '<div class="tp-row"><span>' + label + '</span><span>' + (val || (ok ? '✓' : '—')) + '</span></div>';
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let html = '';
  if (step === 1) {
    html = '<div class="tp-title">1 · Customer</div>'
      + row('Name', !!getFullName(), esc(getFullName()))
      + row('Contact', !!(v('f-email') || v('f-phone')))
      + row('Description', !!v('f-description'))
      + row('Deadline', !!v('f-deadline'), v('f-deadline'));
  } else if (step === 2) {
    const hasInk = typeof SK !== 'undefined' && SK && SK.hasInk;
    const summary = document.getElementById('ps-summary')?.textContent || '';
    html = '<div class="tp-title">2 · Design</div>'
      + (hasInk ? '<img src="' + SK.canvas.toDataURL('image/png') + '" alt="Sketch">' : '<div class="tp-row"><span>Sketch</span><span>—</span></div>')
      + (summary && !summary.startsWith('tap a tab') ? '<div class="tp-row"><span>Specs</span><span>' + esc(summary) + '</span></div>' : '');
  } else {
    html = '<div class="tp-title">3 · Items &amp; Price</div>'
      + row('Total', false, v('f-price') ? '$' + v('f-price') : '—')
      + row('Deposit', false, v('f-deposit') ? '$' + v('f-deposit') : '—')
      + row('Estimate lines', false, String(_estReadDom().rows.length));
  }
  peek.innerHTML = html;
  peek.classList.add('open');
}

(function () {
  const tabsWrap = document.querySelector('#intake-footer .flex-1');
  if (tabsWrap && typeof _intakeLongPress === 'function') {
    _intakeLongPress(tabsWrap, t => {
      const tab = t.closest && t.closest('.intake-tab');
      if (tab) _intakeTabPeekShow(parseInt(tab.dataset.step, 10));
    });
  }
  // Any tap anywhere dismisses the peek
  document.addEventListener('pointerdown', e => {
    const peek = document.getElementById('tab-peek');
    if (peek && peek.classList.contains('open') && !e.target.closest('#tab-peek')) {
      peek.classList.remove('open');
    }
  });
  // Completion glyphs recompute on the input events that already fire
  let tabsDebounce = null;
  const queue = () => { clearTimeout(tabsDebounce); tabsDebounce = setTimeout(intakeTabsRefresh, 250); };
  document.addEventListener('input', queue);
  document.addEventListener('change', queue);
})();

// ── 4.2 Client-facing review screen + 4.3 on-glass signature ──
// Save & Close is two-beat: intakeReviewOpen() → ✓ Confirm runs the
// unchanged intakeSubmit(). Front-of-house only — no markup, no
// internal notes, no margin.
let SIG = null; // third _padCreate instance — penOnly:false, clients sign with fingers

function _sigBackground(ctx, w, h) {
  ctx.strokeStyle = '#C8BFB4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(24, h - 40);
  ctx.lineTo(w - 24, h - 40);
  ctx.stroke();
  ctx.fillStyle = '#B0A89E';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillText('✕', 24, h - 50);
}

function _sigInit() {
  if (SIG || typeof _padCreate !== 'function') return;
  SIG = _padCreate('sig-canvas', { background: _sigBackground });
  if (SIG) {
    SIG.widths.pen = 4;
    // Signature presence drives the Confirm button's weight
    SIG.canvas.addEventListener('pointerup', () => setTimeout(_rvConfirmState, 0));
  }
}

function _rvConfirmState() {
  const btn = document.getElementById('rv-confirm');
  if (!btn) return;
  const signed = SIG && SIG.hasInk;
  btn.classList.toggle('btn-gold', signed);
  btn.classList.toggle('btn-outline', !signed);
  btn.innerHTML = signed ? '✓ Confirm &amp; Save' : 'Confirm &amp; Save (not signed)';
}

function intakeSigClear() {
  if (!SIG) return;
  _padBlank(SIG);
  SIG.hasInk = false;
  SIG.undo.length = 0;
  SIG.redo.length = 0;
  _rvConfirmState();
}

function intakeReviewOpen() {
  if (!_intakeValidate()) return;
  _sigInit();
  const g = id => document.getElementById(id);
  const money = v => '$' + (parseFloat(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const nameEl = g('rv-name');
  if (nameEl) nameEl.textContent = getFullName();
  // Piece summary: the sheet's peek line for Custom Design, else the description
  const typeVal = (g('f-order-type') || {}).value || 'order';
  const peek = g('ps-summary')?.textContent || '';
  const piece = (typeVal === 'order' && peek && !peek.startsWith('tap a tab'))
    ? peek : g('f-description').value.trim();
  const pieceEl = g('rv-piece');
  if (pieceEl) pieceEl.textContent = piece;
  // Sketch thumbnail
  const img = g('rv-sketch');
  if (img) {
    const hasSketch = typeof SK !== 'undefined' && SK && SK.hasInk;
    img.style.display = hasSketch ? '' : 'none';
    if (hasSketch) img.src = SK.canvas.toDataURL('image/png');
  }
  // Money + logistics rows
  const deadline = g('f-deadline')?.value;
  if (g('rv-deadline')) g('rv-deadline').textContent = deadline
    ? new Date(deadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  if (g('rv-pickup')) g('rv-pickup').textContent = g('f-pickup')?.value || '—';
  const price    = parseFloat(g('f-price')?.value) || 0;
  const deposit  = parseFloat(g('f-deposit')?.value) || 0;
  const shipping = parseFloat(g('f-shipping')?.value) || 0;
  if (g('rv-total')) g('rv-total').textContent = price ? money(price + shipping) : '—';
  const depRow = g('rv-deposit-row');
  if (depRow) depRow.style.display = deposit > 0 ? '' : 'none';
  if (g('rv-deposit')) g('rv-deposit').textContent = money(deposit);
  if (g('rv-balance')) g('rv-balance').textContent = price ? money(Math.max(price + shipping - deposit, 0)) : '—';

  _rvConfirmState();
  const overlay = g('intake-review');
  if (overlay) overlay.classList.remove('hidden');
}

function intakeReviewClose() {
  document.getElementById('intake-review')?.classList.add('hidden');
}

function intakeReviewSkip() {
  intakeReviewClose();
  intakeSubmit();
}

function intakeReviewConfirm() {
  intakeReviewClose();
  intakeSubmit();
}

// ── Wrap the shared order-widgets.js entry points (loaded before this
//    file) so every recalc also refreshes the intake-only UI. The desktop
//    Edit Order modal never loads intake.js, so it is untouched. ──
const _owCalcEstimate = calcEstimate;
calcEstimate = function () {
  _owCalcEstimate();
  intakeEstApplyAdjustment();  // adjustment after markup, before tax (3.2)
  if (_estVariants) intakeEstRenderVariants(); // keep variant totals live (3.4)
  intakeMiniTotalUpdate();
};

const _owUpdateBalanceDue = eoUpdateBalanceDue;
eoUpdateBalanceDue = function () {
  _owUpdateBalanceDue();
  intakeDepositRefresh();
  intakeTabsRefresh(); // item/price changes flow through here (4.4)
};

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

  // Client Profile store: fold local orders in (idempotent), then enrich
  // from Notion when online — read-only, never touches ORDERS.
  if (typeof stsCustRebuildFromOrders === 'function') {
    stsCustRebuildFromOrders(ORDERS);
    if (typeof stsCustEnrichFromNotion === 'function') stsCustEnrichFromNotion();
  }

  // Push any orders that never made it to Notion (offline intake at a market)
  if (navigator.onLine) notionPushUnsynced().then(intakeUpdateUnsynced);
  window.addEventListener('online', () => {
    toast('Back online — syncing…', '↻');
    notionPushUnsynced().then(intakeUpdateUnsynced);
  });
})();
