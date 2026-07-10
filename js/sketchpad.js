// ════════════════════════════════════════════
//  DESIGN SKETCHPAD + HANDWRITING STRIP  —  New Order form
//  Two canvases:
//    #hw-canvas     — handwriting strip (Name/Email/Phone/Deadline ruled
//                     lines) converted to typed fields via Claude vision
//    #sketch-canvas — freehand design sketch saved on the order as a
//                     base64 PNG (order.sketchImg) and synced to Notion
//  Fixed backing stores (1000px wide) displayed at CSS width:100% — the
//  New Order panel is display:none until shown, so layout can't be
//  measured at init; coordinates are mapped per-event instead.
// ════════════════════════════════════════════

let SK = null;   // design sketch pad
let HW = null;   // handwriting strip pad

// ── Shared pad plumbing ───────────────────────────────────────

// Per-tool stroke presets (S / M / L). Each tool keeps its own weight so
// switching Pen ⇄ Pencil ⇄ Eraser never disturbs the others' sizes.
const SK_PRESETS = {
  pen:    { S: 2.5, M: 5,   L: 12 },
  pencil: { S: 1.5, M: 2.5, L: 5  },
  marker: { S: 8,   M: 14,  L: 22 },
  water:  { S: 12,  M: 22,  L: 36 },
  eraser: { S: 16,  M: 28,  L: 48 },
};

function _padCreate(canvasId, opts) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const pad = {
    canvas,
    ctx: canvas.getContext('2d'),
    tool: 'pen',            // 'pen' | 'pencil' | 'marker' | 'water' | 'eraser'
    // Independent stroke weight per tool (canvas units)
    widths: { pen: 5, pencil: 2.5, marker: 14, water: 22, eraser: 28 },
    // Independent stroke opacity per tool (0–1), user-adjustable via the dock slider
    opacities: { pen: 1, pencil: 0.55, marker: 0.35, water: 0.3, eraser: 1 },
    // Independent line-smoothing strength per tool (0–1, 1 = fully smoothed)
    flows: { pen: 1, pencil: 1, marker: 1, water: 1, eraser: 1 },
    penOnly: !!(opts && opts.penOnly), // true → ignore finger/touch, Apple Pencil only
    drawing: false,
    hasInk: false,          // anything drawn/loaded — drives export-null-if-blank
    dirty: false,           // changed since load/reset — drives re-export on edit-save
    undo: [], redo: [],     // {url, ink} snapshots, capped at 20
    background: (opts && opts.background) || null,
  };
  _padBlank(pad);
  canvas.addEventListener('pointerdown',   e => _padDown(pad, e));
  canvas.addEventListener('pointermove',   e => _padMove(pad, e));
  canvas.addEventListener('pointerup',     e => _padUp(pad, e));
  canvas.addEventListener('pointercancel', e => _padUp(pad, e));
  _padWireTapGestures(pad);
  return pad;
}

// Two-finger tap ⇒ undo, three-finger tap ⇒ redo. Only live on a pen-only
// pad (SK): touch is already ignored there for drawing, so fingers are free
// for gestures — skip entirely once "Allow finger drawing" is toggled on,
// since a tap can't then be told apart from a deliberate short stroke.
function _padWireTapGestures(pad) {
  const el = pad.canvas;
  const touches = new Map(); // pointerId -> {x, y} at touchdown
  const MOVE_TOL = 14, TAP_MS = 400;
  let gestureStart = 0, peak = 0, moved = false;

  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || !pad.penOnly) return;
    if (touches.size === 0) { gestureStart = performance.now(); peak = 0; moved = false; }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    peak = Math.max(peak, touches.size);
  });
  el.addEventListener('pointermove', e => {
    const t = touches.get(e.pointerId);
    if (!t || moved) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > MOVE_TOL) moved = true;
  });
  const release = e => {
    if (!touches.has(e.pointerId)) return;
    touches.delete(e.pointerId);
    if (touches.size > 0) return; // gesture still in progress — wait for the last finger up
    if (moved || performance.now() - gestureStart >= TAP_MS) return;
    if (peak === 2) {
      if (SK.undo.length) { sketchUndo(); toast('Undo', '↩'); } else toast('Nothing to undo', '↩');
    } else if (peak === 3) {
      if (SK.redo.length) { sketchRedo(); toast('Redo', '↪'); } else toast('Nothing to redo', '↪');
    }
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}

// Coarse pointer ⇒ a touchscreen is present (iPad, phone). Used so pen-only
// pads reject finger input on tablets while a desktop mouse still works.
function _hasCoarsePointer() {
  return !!(window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches);
}

// Apple Pencil isolation: on a pen-only pad only pointerType==='pen' draws.
// A desktop mouse is allowed as a fallback ONLY when no touchscreen exists, so
// a finger/palm on an iPad is ignored entirely.
function _padAccepts(pad, e) {
  if (!pad.penOnly) return true;
  if (e.pointerType === 'pen') return true;
  if (e.pointerType === 'mouse' && !_hasCoarsePointer()) return true;
  return false;
}

function _padBlank(pad) {
  // pad.transparent is opt-in (intake's photo underlay flips it on SK at
  // runtime) — pads that never set it keep the white-backed behavior.
  if (pad.transparent) {
    pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  } else {
    pad.ctx.fillStyle = '#fff';
    pad.ctx.fillRect(0, 0, pad.canvas.width, pad.canvas.height);
  }
  if (pad.background) pad.background(pad.ctx, pad.canvas.width, pad.canvas.height);
}

function _padPoint(pad, e) {
  const r = pad.canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (pad.canvas.width  / r.width),
    y: (e.clientY - r.top)  * (pad.canvas.height / r.height),
  };
}

function _padSnapshot(pad) {
  return { url: pad.canvas.toDataURL('image/png'), ink: pad.hasInk };
}

function _padRestore(pad, snap) {
  const img = new Image();
  img.onload = () => {
    _padBlank(pad);
    pad.ctx.drawImage(img, 0, 0);
  };
  img.src = snap.url;
  pad.hasInk = snap.ink;
}

function _padDown(pad, e) {
  if (!e.isPrimary) return;
  if (!_padAccepts(pad, e)) return; // finger/touch ignored on pen-only pads
  e.preventDefault();
  pad.canvas.setPointerCapture(e.pointerId);
  pad.undo.push(_padSnapshot(pad));
  if (pad.undo.length > 20) pad.undo.shift();
  pad.redo.length = 0;
  pad.drawing = true;
  const ctx = pad.ctx;
  ctx.lineCap = ctx.lineJoin = 'round';
  // Eraser paints white — the canvas is white-filled, so exports stay
  // white-backed with no transparency to composite. Pencil is a lighter,
  // semi-transparent grey for a softer graphite line; Pen is solid ink.
  // Marker is a translucent highlighter color composited with 'multiply' so
  // overlapping strokes deepen like real ink instead of just re-flattening.
  // Opacity is user-adjustable per tool via the dock slider (pad.opacities).
  // On a transparent-backed pad (pad.transparent) the eraser must punch
  // holes instead of painting white, or it would mask the photo underlay —
  // that takes priority since 'eraser' and 'marker' are mutually exclusive.
  ctx.globalAlpha = pad.opacities[pad.tool] != null ? pad.opacities[pad.tool] : 1;
  // Watercolor also multiplies: overlapping washes and existing strokes
  // deepen/bleed into each other instead of flattening over one another.
  ctx.globalCompositeOperation = (pad.transparent && pad.tool === 'eraser') ? 'destination-out'
                                : (pad.tool === 'marker' || pad.tool === 'water') ? 'multiply'
                                : 'source-over';
  ctx.strokeStyle = pad.tool === 'eraser' ? '#fff'
                  : pad.tool === 'pencil' ? '#4A4A4A'
                  : pad.tool === 'marker' ? '#FFD400'
                  : '#1A1A1A';
  ctx.lineWidth   = pad.widths[pad.tool] || 5;
  const p = _padPoint(pad, e);
  if (pad.tool === 'water') {
    // Watercolor doesn't stroke a path — it stamps soft dabs (see _padDab).
    // _last/_pathPos are still tracked so _padMove can smooth the dab path
    // through the same flow-blended curve the other tools use.
    pad._lastDab = p;
    pad._last = p;
    pad._pathPos = p;
    _padDab(pad, p.x, p.y);
    return;
  }
  pad._last = p;    // anchor for the quadratic-through-midpoints smoothing in _padMove
  pad._pathPos = p; // actual path endpoint so far — lets _padMove stroke only new segments
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + 0.01, p.y + 0.01); // a tap leaves a dot
  ctx.stroke();
}

// ── Watercolor brush ──────────────────────────────────────────
// One soft dab: a radial gradient that fades to fully transparent at the
// rim, so dabs have no hard edge. Stamped densely along the pointer path
// (under 'multiply' + the tool's globalAlpha), overlapping dabs pool and
// deepen organically — a cheap, convincing wash without the cost of live
// pixel sampling on a 1000px canvas.
function _padDab(pad, x, y) {
  const ctx = pad.ctx;
  const r = Math.max(2, (pad.widths.water || 22) / 2);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0,    'rgba(61,126,194,0.55)');
  g.addColorStop(0.65, 'rgba(61,126,194,0.30)');
  g.addColorStop(1,    'rgba(61,126,194,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Walk from the last stamped dab toward (x,y) at fixed spacing, stamping as
// we go. Fixed spacing (not per-event) keeps wash density independent of
// pointer speed, so fast strokes don't come out lighter than slow ones.
function _padWaterTo(pad, x, y) {
  const spacing = Math.max(2, (pad.widths.water || 22) / 5);
  let dx = x - pad._lastDab.x, dy = y - pad._lastDab.y;
  let d = Math.hypot(dx, dy);
  while (d >= spacing) {
    const t = spacing / d;
    pad._lastDab = { x: pad._lastDab.x + dx * t, y: pad._lastDab.y + dy * t };
    _padDab(pad, pad._lastDab.x, pad._lastDab.y);
    dx = x - pad._lastDab.x; dy = y - pad._lastDab.y;
    d = Math.hypot(dx, dy);
  }
}

// Smooths the raw point stream by curving through the midpoint of each
// consecutive pair, using the raw point as the quadratic control — the
// standard fix for jagged/stepped freehand canvas lines during fast tracking.
// "Flow" (pad.flows, 0–1) blends the curve endpoint between the raw point
// (flow 0 — control point coincides with the path's current point, which
// degenerates the quadratic into a plain straight segment) and the fully
// smoothed midpoint (flow 1).
//
// Each iteration starts a FRESH path from pad._pathPos and strokes only that
// one new segment, rather than replaying the whole stroke-so-far. Replaying
// is harmless for opaque source-over tools (repainting solid pixels is
// idempotent) but breaks non-idempotent blends like the marker's 'multiply'
// — already-drawn segments would get re-composited on every move, darkening
// the start of a stroke far more than its end.
function _padMove(pad, e) {
  if (!pad.drawing) return;
  const flow = pad.flows[pad.tool] != null ? pad.flows[pad.tool] : 1;
  const events = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  if (pad.tool === 'water') {
    // Same flow-blended quadratic as the path tools below, but flattened into
    // short chords and dabbed along each — otherwise "Smooth" would be a
    // dead control for this tool while doing real work for every other one.
    for (const ev of (events.length ? events : [e])) {
      const p = _padPoint(pad, ev);
      const mid = { x: (pad._last.x + p.x) / 2, y: (pad._last.y + p.y) / 2 };
      const endX = p.x + (mid.x - p.x) * flow;
      const endY = p.y + (mid.y - p.y) * flow;
      const STEPS = 8;
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS, it = 1 - t;
        const qx = it * it * pad._pathPos.x + 2 * it * t * pad._last.x + t * t * endX;
        const qy = it * it * pad._pathPos.y + 2 * it * t * pad._last.y + t * t * endY;
        _padWaterTo(pad, qx, qy);
      }
      pad._pathPos = { x: endX, y: endY };
      pad._last = p;
    }
    return;
  }
  const ctx = pad.ctx;
  // One path per handler call (chaining every coalesced point into it) rather
  // than one path per point — chained curves join seamlessly via lineJoin,
  // while separate per-point paths would each get their own round end-caps,
  // showing as visible beading/scalloping along the stroke.
  //
  // That still leaves a cap at the SEAM between this call's path and the
  // previous call's — 'round' would paint a full circle there too, and for
  // any non-opaque tool (pencil's alpha, marker's multiply) that circle
  // re-composites over the same pixels the previous call's end-cap already
  // painted, darkening a visible bead at every handler call boundary. 'butt'
  // ends the stroke flush at the seam instead, so consecutive calls join
  // with no overlap and no gap. The initial down-dot in _padDown still wants
  // 'round' (a butt-capped near-zero-length line is nearly invisible), so
  // only override it here for the continuing strokes.
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(pad._pathPos.x, pad._pathPos.y);
  for (const ev of (events.length ? events : [e])) {
    const p = _padPoint(pad, ev);
    const mid = { x: (pad._last.x + p.x) / 2, y: (pad._last.y + p.y) / 2 };
    const endX = p.x + (mid.x - p.x) * flow;
    const endY = p.y + (mid.y - p.y) * flow;
    ctx.quadraticCurveTo(pad._last.x, pad._last.y, endX, endY);
    pad._pathPos = { x: endX, y: endY };
    pad._last = p;
  }
  ctx.stroke();
}

function _padUp(pad, e) {
  if (!pad.drawing) return;
  pad.drawing = false;
  pad.ctx.globalAlpha = 1; // reset so snapshots/other paints stay opaque
  pad.ctx.globalCompositeOperation = 'source-over'; // reset after marker's 'multiply' / eraser's 'destination-out'
  pad.hasInk = true;
  pad.dirty = true;
}

// ── Design sketch toolbar handlers ────────────────────────────

function sketchSetTool(tool, btn) {
  if (!SK) return;
  SK.tool = tool;
  ['pen', 'pencil', 'marker', 'water', 'eraser'].forEach(t => {
    const b = document.getElementById('sk-' + t);
    if (b) b.classList.toggle('active', t === tool);
  });
  sketchSyncSizeUI();    // reflect this tool's own stored weight
  sketchSyncOpacityUI(); // reflect this tool's own stored opacity
  sketchSyncFlowUI();    // reflect this tool's own stored smoothing
}

// Accepts a numeric weight OR a preset label ('S'|'M'|'L'), resolved against
// the CURRENT tool's preset table. Only the active tool's width changes.
function sketchSetWidth(w, btn) {
  if (!SK) return;
  if (typeof w === 'string') {
    const table = SK_PRESETS[SK.tool] || SK_PRESETS.pen;
    w = table[w] != null ? table[w] : parseFloat(w) || 5;
  }
  SK.widths[SK.tool] = w;
  sketchSyncSizeUI();
}

// Live drag of the dock slider — sets the active tool's weight.
function sketchSliderInput(v) {
  if (!SK) return;
  SK.widths[SK.tool] = parseFloat(v) || 1;
  sketchSyncSizeUI();
}

// Live drag of the opacity slider (0–100 in the UI) — sets the active tool's alpha (0–1).
function sketchOpacitySliderInput(v) {
  if (!SK) return;
  SK.opacities[SK.tool] = Math.max(0.05, (parseFloat(v) || 100) / 100);
  sketchSyncOpacityUI();
}

// Push SK's current tool opacity into the slider, percent readout, and preview dot.
function sketchSyncOpacityUI() {
  if (!SK) return;
  const o = SK.opacities[SK.tool] != null ? SK.opacities[SK.tool] : 1;
  const pct = Math.round(o * 100);
  const slider = document.getElementById('sk-opacity-slider');
  if (slider) slider.value = pct;
  const val = document.getElementById('sk-opacity-val');
  if (val) val.textContent = pct + '%';
  const dot = document.getElementById('sk-opacity-dot');
  if (dot) dot.style.opacity = o;
}

// Live drag of the flow/smoothing slider (0–100 in the UI) — sets the active tool's flow (0–1).
function sketchFlowSliderInput(v) {
  if (!SK) return;
  SK.flows[SK.tool] = Math.max(0, Math.min(1, (parseFloat(v) || 0) / 100));
  sketchSyncFlowUI();
}

// Push SK's current tool flow into the slider, percent readout, and preview dot
// (dot corners round off from square → circle as smoothing increases).
function sketchSyncFlowUI() {
  if (!SK) return;
  const f = SK.flows[SK.tool] != null ? SK.flows[SK.tool] : 1;
  const pct = Math.round(f * 100);
  const slider = document.getElementById('sk-flow-slider');
  if (slider) slider.value = pct;
  const val = document.getElementById('sk-flow-val');
  if (val) val.textContent = pct + '%';
  const dot = document.getElementById('sk-flow-dot');
  if (dot) dot.style.borderRadius = (f * 50) + '%';
}

// Push SK's current tool weight into the slider, numeric readout, size-preview
// dot, and preset highlight. Central so every entry point stays consistent.
function sketchSyncSizeUI() {
  if (!SK) return;
  const w = SK.widths[SK.tool] || 5;
  const slider = document.getElementById('sk-size-slider');
  if (slider) slider.value = w;
  const val = document.getElementById('sk-size-val');
  if (val) val.textContent = (Math.round(w * 10) / 10) + ' px';
  const dot = document.getElementById('sk-size-dot');
  if (dot) {
    const d = Math.max(4, Math.min(34, w));
    dot.style.width = d + 'px';
    dot.style.height = d + 'px';
    dot.style.background = SK.tool === 'eraser' ? '#C7D4DE'
                         : SK.tool === 'pencil' ? '#9AA6B0'
                         : SK.tool === 'marker' ? '#FFD400'
                         : SK.tool === 'water'  ? '#3D7EC2' : '#E8EEF2';
  }
  const table = SK_PRESETS[SK.tool] || SK_PRESETS.pen;
  document.querySelectorAll('#sketchpad-fg .dock-preset').forEach(b => {
    const label = (b.textContent || '').trim();
    b.classList.toggle('active', table[label] === w);
  });
}

// Fold the dock away to the edge (leaving the subtle reopen trigger) / restore.
function sketchDockToggle() {
  const dock = document.getElementById('sketch-dock');
  if (dock) dock.classList.toggle('collapsed');
}

// Show/hide the technical grid layer (#sketch-grid) — a drawing aid only,
// layered under the ink and deliberately never exported (see sketchExport).
function sketchGridToggle() {
  const grid = document.getElementById('sketch-grid');
  if (!grid) return;
  const on = grid.classList.toggle('on');
  const btn = document.getElementById('sk-grid-btn');
  if (btn) btn.classList.toggle('on', on);
}

function sketchUndo() {
  if (!SK || !SK.undo.length) return;
  SK.redo.push(_padSnapshot(SK));
  _padRestore(SK, SK.undo.pop());
  SK.dirty = true;
}

function sketchRedo() {
  if (!SK || !SK.redo.length) return;
  SK.undo.push(_padSnapshot(SK));
  _padRestore(SK, SK.redo.pop());
  SK.dirty = true;
}

function sketchClear() {
  if (!SK || (!SK.hasInk && !SK.undo.length)) return;
  SK.undo.push(_padSnapshot(SK));
  if (SK.undo.length > 20) SK.undo.shift();
  SK.redo.length = 0;
  _padBlank(SK);
  SK.hasInk = false;
  SK.dirty = true; // a deliberate clear counts as a change so edit-save deletes the sketch
}

// ── Sketch state for orders.js ────────────────────────────────

// Flatten to a white-backed PNG. The ink canvas may be transparent-backed
// (pad.transparent — the layered-stage model), but order.sketchImg and the
// Notion sync always expect an opaque white-backed image. The on-screen grid
// overlay (#sketch-grid) is a drawing aid only and is deliberately NOT baked
// into exports. (intake.js overrides this wholesale to also composite its
// reference-photo underlay.)
function sketchExport() {
  if (!SK || !SK.hasInk) return null;
  const c = document.createElement('canvas');
  c.width = SK.canvas.width; c.height = SK.canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(SK.canvas, 0, 0);
  return c.toDataURL('image/png');
}

function sketchIsDirty() {
  return !!(SK && SK.dirty);
}

// Restore an existing order's sketch for further editing.
function sketchLoad(dataURL) {
  if (!SK) return;
  SK.undo.length = 0;
  SK.redo.length = 0;
  _padBlank(SK);
  SK.hasInk = true;
  SK.dirty = false;
  const img = new Image();
  img.onload = () => {
    const s = Math.min(SK.canvas.width / img.width, SK.canvas.height / img.height, 1);
    const w = img.width * s, h = img.height * s;
    SK.ctx.drawImage(img, (SK.canvas.width - w) / 2, (SK.canvas.height - h) / 2, w, h);
  };
  img.src = dataURL;
}

function sketchReset() {
  if (!SK) return;
  SK.undo.length = 0;
  SK.redo.length = 0;
  SK.hasInk = false;
  SK.dirty = false;
  _padBlank(SK);
}

// Sampled djb2 over the dataURL — cheap change-detection fingerprint used
// by notion.js to decide when the sketch needs re-uploading to Notion.
function sketchHash(str) {
  if (!str) return null;
  let h = 5381;
  for (let i = 0; i < str.length; i += 7) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36) + ':' + str.length;
}

// View a card's sketch in the shared photo lightbox (view-only — the
// Replace/Remove buttons are wired to photo handlers, so hide them;
// viewPhoto restores them).
function viewSketch(orderId) {
  const o = (typeof ORDERS !== 'undefined') ? ORDERS.find(x => x.id === orderId) : null;
  if (!o || !o.sketchImg) return;
  const actions = document.querySelector('#photoLightbox .lb-actions');
  if (actions) actions.style.display = 'none';
  document.getElementById('lightboxImg').src = o.sketchImg;
  document.getElementById('lbTitle').textContent = o.name + ' — design sketch';
  document.getElementById('photoLightbox').classList.add('open');
}

// ── Handwriting strip ─────────────────────────────────────────

const HW_LINES = ['Name', 'Email', 'Phone', 'Deadline'];

function _hwBackground(ctx, w, h) {
  const rowH = h / HW_LINES.length;
  HW_LINES.forEach((label, i) => {
    const top = i * rowH;
    ctx.fillStyle = '#B0A89E';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillText(label, 14, top + 28);
    ctx.strokeStyle = '#E4DDD4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, top + rowH - 12);
    ctx.lineTo(w - 14, top + rowH - 12);
    ctx.stroke();
  });
}

// Collapse/expand the handwriting strip (collapsed by default on Step 1).
// While open it REPLACES the typed customer fields (via .hw-open CSS) so the
// writing surface gets the full step height; Convert fills the fields and
// swaps back to typed view.
function hwToggle(open) {
  const fg  = document.getElementById('hw-fg');
  const btn = document.getElementById('hw-toggle-btn');
  if (!fg) return;
  const show = (open !== undefined) ? open : fg.classList.contains('hw-collapsed');
  fg.classList.toggle('hw-collapsed', !show);
  const grid = fg.closest('.form-grid');
  if (grid) grid.classList.toggle('hw-open', show);
  if (btn) btn.textContent = show ? '⌨ Type instead' : '✍ Handwrite instead';
}

function hwClear() {
  if (!HW) return;
  HW.undo.length = 0;
  HW.redo.length = 0;
  HW.hasInk = false;
  HW.dirty = false;
  _padBlank(HW);
  const st = document.getElementById('hw-status');
  if (st) st.textContent = '';
}

// Send the handwriting strip to Claude vision (same /api/claude-proxy +
// localStorage key the Designs tab uses) and fill ONLY empty form fields.
async function hwConvert(btn) {
  if (!HW) return;
  if (!HW.hasInk) { toast('Nothing written on the lines yet', '⚠'); return; }
  const apiKey = localStorage.getItem('sts-anthropic-key');
  if (!apiKey) { toast('Anthropic API key not set — save it in the Designs tab first', '⚠'); return; }
  const status = document.getElementById('hw-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = '⏳ Reading handwriting…';
  try {
    const b64   = HW.canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    const today = new Date().toISOString().slice(0, 10);
    const resp  = await fetch('/api/claude-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        model: 'claude-opus-4-8',
        max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: 'This is a handwritten customer-info strip from a jewelry order form. It has four labeled ruled lines: Name, Email, Phone, Deadline. Read the handwriting on each line. Return ONLY valid JSON with no other text:\n{"firstName":"","lastName":"","email":"","phone":"","deadline":""}\nSplit the name into first + last. Format deadline as YYYY-MM-DD (today is ' + today + ' — if the year is missing assume the next occurrence). Use "" for any blank or illegible line.' },
        ]}],
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error((err.error && err.error.message) || ('API error ' + resp.status));
    }
    const data    = await resp.json();
    const raw     = ((data.content && data.content[0] && data.content[0].text) || '').trim();
    const parsed  = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
    let filled = 0;
    const fillIfEmpty = (id, val) => {
      const el = document.getElementById(id);
      if (el && val && !el.value.trim()) { el.value = val; filled++; return el; }
      return null;
    };
    fillIfEmpty('f-firstname', (parsed.firstName || '').trim());
    fillIfEmpty('f-lastname',  (parsed.lastName  || '').trim());
    fillIfEmpty('f-email',     (parsed.email     || '').trim());
    const phoneEl = fillIfEmpty('f-phone', (parsed.phone || '').trim());
    if (phoneEl && typeof fmtPhoneInput === 'function') fmtPhoneInput(phoneEl);
    fillIfEmpty('f-deadline', /^\d{4}-\d{2}-\d{2}$/.test(parsed.deadline || '') ? parsed.deadline : '');
    if (status) status.textContent = filled ? ('✓ Filled ' + filled + ' field' + (filled > 1 ? 's' : '') + ' — review above') : 'No empty fields to fill';
    toast(filled ? '✓ Converted — review the fields' : 'Nothing converted — fields already filled or unreadable', filled ? '✓' : '⚠');
    if (filled) hwToggle(false); // swap back to the typed fields to review the result
  } catch (err) {
    if (status) status.textContent = '❌ ' + (err.message || err);
    toast('Handwriting conversion failed: ' + (err.message || err), '✗');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Init (scripts load at end of body — canvases already exist) ──
function sketchInit() {
  SK = _padCreate('sketch-canvas', { penOnly: true }); // Apple Pencil only
  HW = _padCreate('hw-canvas', { background: _hwBackground });
  if (HW) HW.widths.pen = 6; // handwriting pen is fixed medium
  // A #sketch-grid element means the host page uses the layered stage
  // (white .sketch-stage, DOM layers beneath the ink) — flip the ink canvas
  // to transparent-backed so those layers show through; sketchExport()
  // re-adds the white backing. intake.js sets this again for its photo
  // underlay, which is redundant but harmless.
  if (SK && document.getElementById('sketch-grid')) {
    SK.transparent = true;
    _padBlank(SK);
  }
  sketchSyncSizeUI();         // prime the dock controls to the default weight
  sketchSyncOpacityUI();      // prime the dock controls to the default opacity
  sketchSyncFlowUI();         // prime the dock controls to the default smoothing
}
sketchInit();
