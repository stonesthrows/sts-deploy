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

function _padCreate(canvasId, opts) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const pad = {
    canvas,
    ctx: canvas.getContext('2d'),
    tool: 'pen',            // 'pen' | 'eraser'
    width: 5,               // stroke width in canvas units
    eraserWidth: 28,
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
  return pad;
}

function _padBlank(pad) {
  pad.ctx.fillStyle = '#fff';
  pad.ctx.fillRect(0, 0, pad.canvas.width, pad.canvas.height);
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
  e.preventDefault();
  pad.canvas.setPointerCapture(e.pointerId);
  pad.undo.push(_padSnapshot(pad));
  if (pad.undo.length > 20) pad.undo.shift();
  pad.redo.length = 0;
  pad.drawing = true;
  const ctx = pad.ctx;
  ctx.lineCap = ctx.lineJoin = 'round';
  // Eraser paints white — the canvas is white-filled, so exports stay
  // white-backed with no transparency to composite.
  ctx.strokeStyle = pad.tool === 'eraser' ? '#fff' : '#1A1A1A';
  ctx.lineWidth   = pad.tool === 'eraser' ? pad.eraserWidth : pad.width;
  const p = _padPoint(pad, e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + 0.01, p.y + 0.01); // a tap leaves a dot
  ctx.stroke();
}

function _padMove(pad, e) {
  if (!pad.drawing) return;
  const events = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  for (const ev of (events.length ? events : [e])) {
    const p = _padPoint(pad, ev);
    pad.ctx.lineTo(p.x, p.y);
  }
  pad.ctx.stroke();
}

function _padUp(pad, e) {
  if (!pad.drawing) return;
  pad.drawing = false;
  pad.hasInk = true;
  pad.dirty = true;
}

// ── Design sketch toolbar handlers ────────────────────────────

function sketchSetTool(tool, btn) {
  if (!SK) return;
  SK.tool = tool;
  document.getElementById('sk-pen').classList.toggle('active', tool === 'pen');
  document.getElementById('sk-eraser').classList.toggle('active', tool === 'eraser');
}

function sketchSetWidth(w, btn) {
  if (!SK) return;
  SK.width = w;
  sketchSetTool('pen');
  document.querySelectorAll('#sketchpad-fg .sk-w').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
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

function sketchExport() {
  return (SK && SK.hasInk) ? SK.canvas.toDataURL('image/png') : null;
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
  } catch (err) {
    if (status) status.textContent = '❌ ' + (err.message || err);
    toast('Handwriting conversion failed: ' + (err.message || err), '✗');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Init (scripts load at end of body — canvases already exist) ──
function sketchInit() {
  SK = _padCreate('sketch-canvas');
  HW = _padCreate('hw-canvas', { background: _hwBackground });
  if (HW) HW.width = 6; // handwriting pen is fixed medium
}
sketchInit();
