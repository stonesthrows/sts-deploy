// ════════════════════════════════════════════
//  PAPER MODE  —  js/intake-paper.js
//  Goodnotes-style handwritten intake, 3 screens:
//    Screen 1 (this file) — the handwriting page: circle the order type /
//      piece type / pickup market, write customer info, materials, and
//      item/notes on ruled lines — everything handwritten + OCR'd, no
//      chip UI. Screen 2 (Sketch) is optional — see the toggle below.
//    Screen 2 — the EXISTING #step-2 (full sketch canvas + dock + bottom
//      sheet), reused as-is. Skippable per-order via the Sketch toggle.
//    Screen 3 — the EXISTING #step-3 (Estimate Builder), reused as-is with
//      the Order Items/Total block hidden via CSS (see intake.html).
//  Screen 1's page is two stacked canvases:
//    #paper-template — the printed form (redrawn at any size, never inked)
//    #paper-canvas   — transparent ink layer (sketchpad.js pad, Pencil-only)
//  Invisible zones over the page tell the OCR what each region means; a
//  moment after the pen lifts in a zone, its crop goes to /api/claude-proxy
//  and the recognized value appears as a tappable "ghost type" chip that
//  writes into the same hidden f-* fields the typed wizard uses — so
//  intakeSubmit(), Notion sync, and the desktop app see no difference.
//  A whole-page vision pass at Save & Close (same prompt family as the
//  js/drive.js bag reader) catches anything the zone passes missed.
//  Loads after js/intake.js and wraps its entry points; never edits them.
// ════════════════════════════════════════════

let PAPER = null;      // ink pad (sketchpad.js _padCreate)
let _paperOn = false;

// zone id → mapped app value tables (mirror the js/drive.js bag reader)
const _PAPER_PICKUP = {
  SVFM: "Sunset Valley Farmer's Market", Bell: 'Bell Market', TXFM: 'Mueller Market',
  CCFM: 'Chaparral Crossing Market', Flea: 'Austin Flea', Studio: 'Studio', Ship: 'To be Shipped',
};
const _PAPER_TYPE = { Custom: 'order', Resize: 'resize', Repair: 'repair' };
const _PAPER_PAID = { Cash: 'Cash', Credit: 'Credit Card' }; // Check has no f-paid-by option — lands in notes

let _paperZones = [];         // live zone objects: {id,kind,label,rect,options?,field?,hasInk,value,_t,_dirty,chip}
const _paperWrote = {};       // fieldId → last value Paper wrote (typed edits always win over re-OCR)
const _paperMaterialRefs = {}; // zone id ('materials-1'..'materials-6') -> its _oiItems entry
let _paperChain = Promise.resolve(); // sequential OCR queue — no parallel API bursts

// ── Page layout — single source of truth for the template drawing, the
//    OCR zone rects, and the chip positions. All pixel math, recomputed on
//    every resize, so landscape/portrait both work. The Sketch page is a
//    separate screen now (see paperGoScreen below) — this page is a single
//    full-width work-order page: circles, ruled fields, a multi-line
//    Materials block, and Notes. No chip UI anywhere on it — everything
//    here is handwritten + OCR'd, same as the rest of the page. ──────────
function _paperLayout(w, h) {
  const landscape = w >= h;
  const M = Math.round(Math.min(w, h) * 0.04);
  const innerW = w - M * 2;
  const zones = [];
  let y = M + Math.round(Math.min(w, h) * 0.028); // room for the printed title line

  // Circle strips — order type + pickup market, like the top of the bag
  const optH = Math.max(42, Math.round(h * 0.055));
  if (landscape) {
    zones.push({ id: 'ordertype', kind: 'circle', label: 'ORDER TYPE', options: ['Custom', 'Resize', 'Repair'],
                 rect: { x: M, y, w: Math.round(innerW * 0.32), h: optH } });
    zones.push({ id: 'pickup', kind: 'circle', label: 'PICKUP', options: ['SVFM', 'Bell', 'TXFM', 'CCFM', 'Flea', 'Studio', 'Ship'],
                 rect: { x: M + Math.round(innerW * 0.36), y, w: innerW - Math.round(innerW * 0.36), h: optH } });
    y += optH + 6;
  } else {
    zones.push({ id: 'ordertype', kind: 'circle', label: 'ORDER TYPE', options: ['Custom', 'Resize', 'Repair'],
                 rect: { x: M, y, w: innerW, h: optH } });
    y += optH + 2;
    zones.push({ id: 'pickup', kind: 'circle', label: 'PICKUP', options: ['SVFM', 'Bell', 'TXFM', 'CCFM', 'Flea', 'Studio', 'Ship'],
                 rect: { x: M, y, w: innerW, h: optH } });
    y += optH + 6;
  }
  // Inside Ring Stamping — its own full-width ruled row, in the slot the
  // Order Type/Pickup circles leave open (same position Piece Type used
  // to occupy before it was replaced by this).
  zones.push({ id: 'stamping', kind: 'text', label: 'INSIDE RING STAMPING',
               hint: 'an engraved inscription', rect: { x: M, y, w: innerW, h: optH } });
  y += optH + 6;

  // Fields fill the full page width (no sketch column, no side panel).
  const fieldW = innerW;
  const fieldsBottom = h - M;
  const availAll = fieldsBottom - y;
  const MAT_ROWS = 6;
  // Materials gets a near-fixed reservation for 6 priced lines (each one a
  // compact Item & Price row: a description rule + $ + a price rule — see
  // the 'itemprice' case in _paperDrawTemplate, reused verbatim for all 6).
  // Reserved BEFORE the other rows are sized so the promised line count
  // holds on a typical iPad even as the rest of the page compresses around
  // it. Capped at 55% of the space so it can't crowd out everything else.
  const matRowTarget = 46;
  const materialsTarget = MAT_ROWS * matRowTarget;
  const materialsH = Math.max(6 * 36, Math.min(materialsTarget, Math.round(availAll * 0.55)));
  const matRowH = Math.floor(materialsH / MAT_ROWS);
  // Remaining budget for the other rows. Divisor covers 4 plain rows (name /
  // phone+email / takein+deadline / ringsize+paidby) + Notes' own minimum
  // share — Notes isn't a separate "whatever's left" claim on top of this
  // (that double-counting overflowed the canvas before): its weight is
  // baked into the same divisor so the sum of every row, including Notes'
  // minimum, exactly equals the space available.
  const avail = availAll - materialsH;
  const rowH = Math.max(40, Math.min(90, Math.floor(avail / 6)));
  const half = Math.round(fieldW * 0.5) - 6;
  let fy = y;
  const row = (id, kind, label, x, wd, hh, extra) => {
    zones.push(Object.assign({ id, kind, label, rect: { x, y: fy, w: wd, h: hh } }, extra || {}));
  };
  row('name',  'text', 'Name',  M, fieldW, rowH, { field: 'f-firstname' }); fy += rowH;
  row('phone', 'text', 'Phone', M, half, rowH, { field: 'f-phone', hint: 'a US phone number' });
  row('email', 'text', 'Email', M + half + 12, fieldW - half - 12, rowH, { field: 'f-email', hint: 'an email address' }); fy += rowH;
  row('takein',   'date', 'Take In',  M, half, rowH, { field: 'f-takein' });
  row('deadline', 'date', 'Deadline', M + half + 12, fieldW - half - 12, rowH, { field: 'f-deadline' }); fy += rowH;
  row('ringsize', 'text', 'Ring Size', M, Math.round(fieldW * 0.34), rowH, { hint: 'a ring size number' });
  row('paidby', 'check', 'Paid By', M + Math.round(fieldW * 0.34) + 12, fieldW - Math.round(fieldW * 0.34) - 12, rowH,
      { options: ['Cash', 'Credit', 'Check'] }); fy += rowH;
  // Materials — 6 stacked priced lines, replacing both the old free-text
  // Materials block and the standalone Item & Price line. Only the first
  // row prints the section label; label() is a no-op on '' for the rest.
  for (let i = 1; i <= MAT_ROWS; i++) {
    row('materials-' + i, 'itemprice', i === 1 ? 'MATERIALS' : '', M, fieldW, matRowH);
    fy += matRowH;
  }
  row('notes', 'notes', 'Notes', M, fieldW, Math.max(40, fieldsBottom - fy));
  return zones;
}

// ── Printed-form rendering onto #paper-template ───────────────────────────
function _paperDrawTemplate(ctx, w, h, zones) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#FDF8EE';                       // warm paper on the dark desk
  ctx.fillRect(0, 0, w, h);
  const M = Math.round(Math.min(w, h) * 0.04);
  ctx.fillStyle = '#C9983A';
  ctx.font = '800 12px -apple-system, system-ui, sans-serif';
  ctx.fillText('STONES THROW STUDIO  ·  WORK ORDER', M, M + 4);

  const label = (z) => {
    ctx.fillStyle = '#A5834A';
    ctx.font = '700 11px -apple-system, system-ui, sans-serif';
    ctx.fillText(z.label.toUpperCase(), z.rect.x, z.rect.y + 12);
  };
  const rule = (x, y, wd) => {
    ctx.strokeStyle = '#E4D2B0';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + wd, y); ctx.stroke();
  };

  zones.forEach(z => {
    const r = z.rect;
    switch (z.kind) {
      case 'circle': {
        label(z);
        ctx.fillStyle = '#6B5836';
        ctx.font = '600 15px -apple-system, system-ui, sans-serif';
        const widths = z.options.map(o => ctx.measureText(o).width);
        const total = widths.reduce((a, b) => a + b, 0);
        const gap = Math.max(14, (r.w - total) / (z.options.length + 1));
        let x = r.x + gap * 0.6;
        const ty = r.y + r.h - Math.round((r.h - 16) / 2) + 2;
        z.options.forEach((o, i) => { ctx.fillText(o, x, ty); x += widths[i] + gap; });
        break;
      }
      case 'check': {
        label(z);
        ctx.font = '600 14px -apple-system, system-ui, sans-serif';
        const cy = r.y + r.h - 24;
        let x = r.x + 2;
        z.options.forEach(o => {
          ctx.strokeStyle = '#B99B62';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, cy, 15, 15);
          ctx.fillStyle = '#6B5836';
          ctx.fillText(o, x + 20, cy + 13);
          x += 20 + ctx.measureText(o).width + 18;
        });
        break;
      }
      case 'itemprice': {
        // Compact: description rule + $ + price rule, near the row's
        // bottom like a plain text field — used 6x (Materials lines 1-6),
        // so it must stay legible without the padding a single standalone
        // row could afford. label() no-ops on '' for rows 2-6.
        label(z);
        const ry = r.y + r.h - 10;
        const priceW = Math.max(64, Math.round(r.w * 0.22));
        const itemW = r.w - priceW - 14;
        rule(r.x, ry, itemW);
        ctx.fillStyle = '#A5834A';
        ctx.font = '700 14px -apple-system, system-ui, sans-serif';
        ctx.fillText('$', r.x + itemW + 14, ry - 2);
        rule(r.x + itemW + 30, ry, priceW - 16);
        break;
      }
      case 'notes': {
        label(z);
        for (let y = r.y + Math.min(46, Math.round(r.h * 0.3)); y <= r.y + r.h - 4; y += 34) rule(r.x, y, r.w);
        break;
      }
      default: { // text / date ruled fields
        label(z);
        rule(z.rect.x, z.rect.y + z.rect.h - 10, z.rect.w);
      }
    }
  });
}

// ── Sizing — backing stores match the stage box; ink is snapshotted and
//    redrawn scaled on resize/rotate (same model as intakeSizeSketchStage) ──
function _paperSize() {
  const stage = document.getElementById('paper-stage');
  if (!stage || !PAPER) return;
  requestAnimationFrame(() => {
    const w = Math.round(stage.clientWidth);
    const h = Math.round(stage.clientHeight);
    if (!w || !h) return;
    const tpl = document.getElementById('paper-template');
    const ink = PAPER.canvas;
    const resized = ink.width !== w || ink.height !== h;
    if (resized) {
      const prevURL = PAPER.hasInk ? ink.toDataURL('image/png') : null;
      ink.width = w; ink.height = h;
      _padBlank(PAPER);
      PAPER.undo.length = 0; // old snapshots are at the wrong scale
      PAPER.redo.length = 0;
      if (prevURL) {
        const img = new Image();
        img.onload = () => { PAPER.ctx.drawImage(img, 0, 0, w, h); };
        img.src = prevURL;
      }
    }
    if (tpl && (tpl.width !== w || tpl.height !== h || resized)) {
      tpl.width = w; tpl.height = h;
    }
    _paperRelayout(w, h);
  });
}

// Recompute zones for the current size, carrying per-zone runtime state
// (ink flags, recognized values, chips) across by id.
function _paperRelayout(w, h) {
  const prev = {};
  _paperZones.forEach(z => { prev[z.id] = z; });
  _paperZones = _paperLayout(w, h);
  _paperZones.forEach(z => {
    const p = prev[z.id];
    if (p) { z.hasInk = p.hasInk; z.value = p.value; z._dirty = p._dirty; z.chip = p.chip; z._t = p._t; }
  });
  const tpl = document.getElementById('paper-template');
  if (tpl) _paperDrawTemplate(tpl.getContext('2d'), w, h, _paperZones);
  _paperZones.forEach(z => { if (z.chip) _paperChipPlace(z); });
}

// ── Stroke → zone tracking. A parallel set of pointer listeners on the ink
//    canvas builds each stroke's bounding box; on pen-up every intersecting
//    zone is marked dirty and its conversion (re)scheduled. ────────────────
let _pStroke = null;

function _paperWireStrokes() {
  const c = PAPER.canvas;
  const pt = e => {
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  c.addEventListener('pointerdown', e => {
    if (!e.isPrimary || !_padAccepts(PAPER, e)) return;
    const p = pt(e);
    _pStroke = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y, eraser: PAPER.tool === 'eraser' };
  });
  c.addEventListener('pointermove', e => {
    if (!_pStroke || !PAPER.drawing) return;
    for (const ev of ((e.getCoalescedEvents && e.getCoalescedEvents()) || [e])) {
      const p = pt(ev);
      _pStroke.minX = Math.min(_pStroke.minX, p.x); _pStroke.maxX = Math.max(_pStroke.maxX, p.x);
      _pStroke.minY = Math.min(_pStroke.minY, p.y); _pStroke.maxY = Math.max(_pStroke.maxY, p.y);
    }
  });
  const up = () => {
    if (!_pStroke) return;
    const s = _pStroke; _pStroke = null;
    const pad = 6;
    _paperZones.forEach(z => {
      const r = z.rect;
      const hit = s.minX - pad < r.x + r.w && s.maxX + pad > r.x && s.minY - pad < r.y + r.h && s.maxY + pad > r.y;
      if (!hit) return;
      if (!s.eraser) z.hasInk = true;
      z._dirty = true;
      _paperChipSet(z, 'pending', '✍ …');
      clearTimeout(z._t);
      z._t = setTimeout(() => _paperEnqueue(z), 1800); // convert ~2s after the pen settles
    });
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
}

// ── OCR queue — strictly sequential so a burst of zones doesn't fan out
//    parallel API calls from an iPad at a market ─────────────────────────
function _paperEnqueue(z) {
  if (!z._dirty) return;
  _paperChain = _paperChain.then(() => _paperConvert(z)).catch(() => {});
}

// Cancel pending timers and drain the queue — Save & Close calls this so no
// half-finished zone conversion races the whole-page pass.
async function _paperFlush() {
  _paperZones.forEach(z => {
    if (z._t) { clearTimeout(z._t); z._t = null; }
    if (z._dirty) _paperEnqueue(z);
  });
  await _paperChain;
}

// Zone crop: printed template + ink composited on white, so vision sees the
// printed options/labels it needs for circle & checkbox reads.
function _paperCrop(z) {
  const pad = 8;
  const tpl = document.getElementById('paper-template');
  const r = z.rect;
  const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
  const w = Math.min(PAPER.canvas.width - x, r.w + pad * 2);
  const h = Math.min(PAPER.canvas.height - y, r.h + pad * 2);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  if (tpl) ctx.drawImage(tpl, x, y, w, h, 0, 0, w, h);
  ctx.drawImage(PAPER.canvas, x, y, w, h, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

function _paperPromptFor(z) {
  const today = new Date().toISOString().slice(0, 10);
  const base = 'This is a cropped region of a handwritten jewelry work-order form. ';
  switch (z.kind) {
    case 'date':
      return base + 'It is the "' + z.label + '" date field — ignore the printed label and ruled line, read only the handwriting. '
        + 'Return ONLY valid JSON: {"value":""} with the date formatted YYYY-MM-DD (today is ' + today
        + ' — if the year is missing assume the next occurrence). Use "" if blank or illegible.';
    case 'circle':
      return base + 'It shows these printed options: ' + z.options.join(', ') + '. Staff circle or mark exactly one with a pen. '
        + 'Return ONLY valid JSON: {"value":""} where value is the single circled/marked option copied exactly from the list, or "" if none is clearly marked.';
    case 'check':
      return base + 'It shows printed checkboxes labeled: ' + z.options.join(', ') + '. An X or check mark in/over a box selects it. '
        + 'Return ONLY valid JSON: {"value":""} where value is the single checked label copied exactly, or "" if none is marked.';
    case 'itemprice':
      return base + 'It is one line of the Materials section: a material or component (metal, karat, finish, gemstone — type/cut/carat/setting) '
        + 'is handwritten on the long line and its dollar price after the printed $. '
        + 'Copy the exact words — do not substitute similar-sounding products. Return ONLY valid JSON: {"item":"","price":null} (price numeric, no $; use ""/null if blank or illegible).';
    case 'notes':
      return base + 'It is the Notes area. Transcribe ALL handwriting verbatim, preserving line breaks as \\n. Do not summarize. '
        + 'Return ONLY valid JSON: {"value":""} — "" if blank.';
    default:
      return base + 'It is the "' + z.label + '" field' + (z.hint ? ' (' + z.hint + ')' : '')
        + ' — ignore the printed label and ruled line, read only the handwriting. '
        + 'Return ONLY valid JSON: {"value":""} — "" if blank or illegible.';
  }
}

async function _paperConvert(z) {
  z._dirty = false;
  const apiKey = localStorage.getItem('sts-anthropic-key') || undefined;
  _paperChipSet(z, 'converting', '… reading');
  try {
    const resp = await fetch('/api/claude-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: _paperCrop(z) } },
          { type: 'text', text: _paperPromptFor(z) },
        ] }],
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error((err.error && err.error.message) || ('API error ' + resp.status));
    }
    const data = await resp.json();
    const raw = ((data.content && data.content[0] && data.content[0].text) || '').trim();
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
    _paperApply(z, parsed);
  } catch (err) {
    console.warn('Paper OCR failed for zone', z.id, err);
    _paperChipSet(z, 'err', '⚠ tap to retry');
  }
}

// ── Writing recognized values into the form ───────────────────────────────
// Overwrite policy: a zone owns its field. Re-writing ink re-converts and
// overwrites — unless the user typed something else by hand, which wins.
function _paperFieldOpen(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  const cur = (el.value || '').trim();
  return !cur || cur === (_paperWrote[id] || '');
}

function _paperSetField(id, val) {
  if (!val || !_paperFieldOpen(id)) return false;
  const el = document.getElementById(id);
  el.value = val;
  _paperWrote[id] = el.value;
  return true;
}

function _paperNoteAppend(line) {
  const el = document.getElementById('f-notes');
  if (!el || !line || el.value.includes(line)) return;
  el.value = (el.value ? el.value + '\n' : '') + line;
}

function _paperApply(z, parsed) {
  // All 6 Materials rows share kind 'itemprice' (id materials-1..materials-6)
  // — dispatch on kind here since the switch below is id-keyed.
  if (z.kind === 'itemprice') {
    const item = ((parsed && parsed.item) || '').toString().trim();
    const price = (parsed && parsed.price != null) ? parseFloat(parsed.price) : NaN;
    _paperApplyMaterialLine(z.id, item, price);
    z.value = item + (!isNaN(price) && price > 0 ? ' · $' + price : '');
    _paperChipSet(z, z.value ? 'value' : null, z.value);
    return;
  }
  const val = ((parsed && parsed.value) || '').toString().trim();
  switch (z.id) {
    case 'name': {
      if (val && _paperFieldOpen('f-firstname') && _paperFieldOpen('f-lastname')) {
        setNameFields(val);
        _paperWrote['f-firstname'] = document.getElementById('f-firstname').value;
        _paperWrote['f-lastname']  = document.getElementById('f-lastname').value;
      }
      break;
    }
    case 'phone': {
      if (_paperSetField('f-phone', val)) {
        const el = document.getElementById('f-phone');
        if (typeof fmtPhoneInput === 'function') fmtPhoneInput(el);
        _paperWrote['f-phone'] = el.value;
      }
      break;
    }
    case 'email': _paperSetField('f-email', val); break;
    case 'takein':   if (/^\d{4}-\d{2}-\d{2}$/.test(val)) _paperSetField('f-takein', val); break;
    case 'deadline': if (/^\d{4}-\d{2}-\d{2}$/.test(val)) _paperSetField('f-deadline', val); break;
    case 'ringsize': if (val) _paperSetField('f-sizing', /[a-z]/i.test(val) ? val : 'ring size ' + val); break;
    case 'ordertype': _paperApplyOrderType(val); break;
    case 'stamping': _paperSetField('f-stamping', val); break;
    case 'pickup': {
      if (_PAPER_PICKUP[val]) {
        _paperSetField('f-pickup', _PAPER_PICKUP[val]);
        if (typeof toggleShippingAddress === 'function') toggleShippingAddress();
      }
      break;
    }
    case 'paidby': {
      if (_PAPER_PAID[val]) _paperSetField('f-paid-by', _PAPER_PAID[val]);
      else if (val === 'Check') _paperNoteAppend('Paid by check');
      break;
    }
    case 'notes': _paperSetField('f-notes', val); break;
  }
  z.value = val;
  _paperChipSet(z, val ? 'value' : null, val);
}

// Each Materials row owns one manual order item — re-OCR of that row
// updates it in place instead of stacking duplicates. oiRender() recomputes
// f-price from every row's item together. A row with text but no legible
// price still gets an entry (price 0) so its text isn't silently dropped —
// staff can fill the price in later via the Estimate Builder (Screen 3).
function _paperApplyMaterialLine(zoneId, item, price) {
  const hasPrice = !isNaN(price) && price > 0;
  if (item || hasPrice) {
    let ref = _paperMaterialRefs[zoneId];
    if (ref && _oiItems.includes(ref)) {
      if (item) ref.name = item;
      if (hasPrice) ref.price = price;
    } else {
      ref = { type: 'manual', name: item || 'Materials line', price: hasPrice ? price : 0, quantity: 1 };
      _paperMaterialRefs[zoneId] = ref;
      _oiItems.push(ref);
    }
    oiRender();
  }
  _paperSyncMaterialsFields();
}

// Mirrors every Materials row's item text into f-description (joined, the
// order summary), f-materials (first row, short single-line descriptor),
// and f-gemstones (all rows joined, multi-line — the field actually built
// for this). Re-runs the sensitivity-vs-alloy warning, which normally
// fires on these fields' oninput — a programmatic .value= doesn't trigger
// that on its own.
function _paperSyncMaterialsFields() {
  const items = [];
  for (let i = 1; i <= 6; i++) {
    const ref = _paperMaterialRefs['materials-' + i];
    if (ref && ref.name) items.push(ref.name);
  }
  const wroteDesc = _paperSetField('f-description', items.join(' · '));
  const wroteMat  = _paperSetField('f-materials', items[0] || '');
  const wroteGem  = _paperSetField('f-gemstones', items.join('\n'));
  if ((wroteDesc || wroteMat || wroteGem) && typeof intakeSensChanged === 'function') intakeSensChanged();
}

// Order type drives the pipeline stage AND intakeApplyTypeLayout, which
// resets _oiItems on a genuine type change — re-adopt every Materials
// row's item after.
function _paperApplyOrderType(opt) {
  const type = _PAPER_TYPE[opt];
  if (!type) return;
  const sel = document.getElementById('f-order-type');
  if (!sel || sel.value === type) return;
  const keep = Object.values(_paperMaterialRefs).filter(ref => _oiItems.includes(ref));
  intakeApplyTypeLayout(type);
  let changed = false;
  keep.forEach(ref => { if (!_oiItems.includes(ref)) { _oiItems.push(ref); changed = true; } });
  if (changed) oiRender();
  _paperWrote['f-order-type'] = type;
}

// ── Ghost-type chips — the Goodnotes-style recognized text under the ink ──
function _paperChipSet(z, state, text) {
  if (!state) {
    if (z.chip) { z.chip.remove(); z.chip = null; }
    return;
  }
  if (!z.chip) {
    z.chip = document.createElement('div');
    z.chip.className = 'paper-chip';
    z.chip.addEventListener('click', () => _paperChipTap(z));
    document.getElementById('paper-chips')?.appendChild(z.chip);
  }
  z.chip.classList.toggle('converting', state === 'pending' || state === 'converting');
  z.chip.classList.toggle('err', state === 'err');
  z.chip.textContent = (state === 'value' ? '⌨ ' : '') + (text || '');
  z._chipState = state;
  _paperChipPlace(z);
}

function _paperChipPlace(z) {
  if (!z.chip) return;
  const stage = document.getElementById('paper-stage');
  const sw = stage ? stage.clientWidth : 0;
  z.chip.style.right = Math.max(4, sw - (z.rect.x + z.rect.w)) + 'px';
  z.chip.style.top = (z.rect.y + z.rect.h - 8) + 'px';
}

function _paperChipTap(z) {
  if (z._chipState === 'err') { z._dirty = true; _paperEnqueue(z); return; }
  if (z._chipState === 'converting' || z._chipState === 'pending') return;
  const hint = (z.options && z.options.length) ? ' (' + z.options.join(' / ') + ')' : '';
  const v = prompt('Correct "' + z.label + '"' + hint + ':', z.value || '');
  if (v === null) return;
  _paperApply(z, z.kind === 'itemprice' ? _paperParseItemEdit(v) : { value: v.trim() });
}

// Chip-edit of the item line accepts "gold ring $95"-style text.
function _paperParseItemEdit(v) {
  const m = v.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*$/);
  return { item: v.replace(/\$?\s*\d+(?:\.\d{1,2})?\s*$/, '').replace(/[·—-]\s*$/, '').trim(), price: m ? parseFloat(m[1]) : null };
}

// ── Whole-page safety net — one vision pass with the js/drive.js bag-reader
//    prompt family; fills ONLY still-empty fields (zone results win). ──────
async function _paperPagePass() {
  if (!PAPER || !PAPER.hasInk) return;
  const apiKey = localStorage.getItem('sts-anthropic-key') || undefined;
  toast('Reading the full page…', '✨', 2500);
  try {
    const page = paperExportPage(true);
    const resp = await fetch('/api/claude-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        model: 'claude-haiku-4-5',
        max_tokens: 700,
        system: _paperPagePrompt(),
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: page } },
          { type: 'text', text: 'Extract the order information from this handwritten work order page.' },
        ] }],
      }),
    });
    if (!resp.ok) throw new Error('API error ' + resp.status);
    const data = await resp.json();
    const raw = ((data.content && data.content[0] && data.content[0].text) || '').trim();
    const p = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```/g, '').trim());
    _paperMergePagePass(p);
  } catch (err) {
    console.warn('Paper page pass failed:', err);
    // Non-fatal by design: the ink page is saved regardless, zone results stand.
  }
}

function _paperPagePrompt() {
  return 'You are an order intake assistant for Stones Throw Studio, a custom jewelry shop. '
    + 'The image is a handwritten digital work-order page with printed labels: circled ORDER TYPE (Custom, Resize, Repair), '
    + 'circled PICKUP market (SVFM = Sunset Valley Farmer\'s Market, Bell = Bell Market, TXFM = Mueller Market, CCFM = Chaparral Crossing Market, Flea = Austin Flea, Studio = Studio, Ship = To be Shipped), '
    + 'ruled fields (Inside Ring Stamping, Name, Phone, Email, Take In, Deadline, Ring Size), Paid By checkboxes (Cash, Credit, Check), '
    + 'a Materials section of up to 6 lines, each pairing a material or gemstone description with its own price after a printed $, and a Notes area.\n'
    + 'CRITICAL ACCURACY RULES: copy the exact words you see — never substitute similar-sounding products; if a word is unclear write it as-is with [?] after it; look closely at numerals.\n'
    + 'Capture ALL text in the Notes area verbatim, preserving line breaks as \\n — do not skip or summarize. Also transcribe any handwriting written OUTSIDE the labeled fields into notes.\n'
    + 'Return ONLY a valid JSON object with these exact keys (null for anything not visible):\n'
    + '{"customer_name":string|null,"email":string|null,"phone":string|null,"take_in_date":"YYYY-MM-DD"|null,"deadline":"YYYY-MM-DD"|null,'
    + '"pickup_location":"Bell Market"|"Mueller Market"|"Chaparral Crossing Market"|"Sunset Valley Farmer\'s Market"|"Austin Flea"|"Studio"|"To be Shipped"|null,'
    + '"order_type":"order"|"resize"|"repair","inside_stamping":string|null,'
    + '"description":string|null,"ring_size":string|null,"materials":string|null,'
    + '"price":number|null,"paid_by":"Cash"|"Credit"|"Check"|null,"notes":string|null}\n'
    + 'The "materials" key is a rough combined summary of the Materials section (all lines\' descriptions, joined) — a safety net only, since each line is already read individually elsewhere. '
    + 'The "price" key is the sum of all visible prices in the Materials section, if any are legible.\n'
    + 'For dates, infer the year as ' + new Date().getFullYear() + ' if only month/day is shown. Return ONLY the JSON object, no other text.';
}

function _paperMergePagePass(p) {
  if (!p) return;
  let filled = 0;
  const fillIfEmpty = (id, val) => {
    const el = document.getElementById(id);
    if (el && val && !(el.value || '').trim()) { el.value = val; _paperWrote[id] = el.value; filled++; return true; }
    return false;
  };
  if (p.customer_name && !getFullName()) { setNameFields(p.customer_name); filled++; }
  fillIfEmpty('f-email', (p.email || '').trim());
  if (fillIfEmpty('f-phone', (p.phone || '').trim()) && typeof fmtPhoneInput === 'function') {
    fmtPhoneInput(document.getElementById('f-phone'));
  }
  fillIfEmpty('f-takein',   /^\d{4}-\d{2}-\d{2}$/.test(p.take_in_date || '') ? p.take_in_date : '');
  fillIfEmpty('f-deadline', /^\d{4}-\d{2}-\d{2}$/.test(p.deadline || '') ? p.deadline : '');
  if (fillIfEmpty('f-pickup', p.pickup_location || '') && typeof toggleShippingAddress === 'function') toggleShippingAddress();
  fillIfEmpty('f-description', (p.description || '').trim());
  if (p.ring_size) fillIfEmpty('f-sizing', /[a-z]/i.test(p.ring_size) ? p.ring_size : 'ring size ' + p.ring_size);
  if (p.paid_by && _PAPER_PAID[p.paid_by]) fillIfEmpty('f-paid-by', _PAPER_PAID[p.paid_by]);
  fillIfEmpty('f-notes', (p.notes || '').trim());
  fillIfEmpty('f-stamping', (p.inside_stamping || '').trim());
  // Coarse fallback only — real per-line materials/prices come from the 6
  // dedicated Materials-row zone passes, which run first. Only step in here
  // if NONE of those landed anything yet.
  const hasMaterialRefs = Object.keys(_paperMaterialRefs).length > 0;
  if (!hasMaterialRefs) {
    const materials = (p.materials || '').trim();
    if (materials) { fillIfEmpty('f-materials', materials); fillIfEmpty('f-gemstones', materials); }
    const price = (p.price != null) ? parseFloat(p.price) : NaN;
    if (!isNaN(price) && price > 0 && !(parseFloat(document.getElementById('f-price')?.value) > 0)) {
      _paperApplyMaterialLine('materials-1', materials, price);
      filled++;
    }
  }
  const sel = document.getElementById('f-order-type');
  if (p.order_type && _TYPE_BLOCKS[p.order_type] && sel && sel.value === 'order' && p.order_type !== 'order') {
    _paperApplyOrderType(p.order_type === 'resize' ? 'Resize' : p.order_type === 'repair' ? 'Repair' : 'Custom');
    filled++;
  }
  if (filled) toast('✓ Page read — filled ' + filled + ' more field' + (filled > 1 ? 's' : ''), '✓');
}

// Full-page export: printed template + ink flattened. jpeg=true for the
// vision pass; PNG dataURL otherwise (order.paperPageImg — the permanent
// human record of the handwritten page, like a scanned bag).
function paperExportPage(jpeg) {
  if (!PAPER || !PAPER.hasInk) return null;
  const tpl = document.getElementById('paper-template');
  const c = document.createElement('canvas');
  c.width = PAPER.canvas.width; c.height = PAPER.canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FDF8EE';
  ctx.fillRect(0, 0, c.width, c.height);
  if (tpl) ctx.drawImage(tpl, 0, 0);
  ctx.drawImage(PAPER.canvas, 0, 0);
  return jpeg ? c.toDataURL('image/jpeg', 0.85).split(',')[1] : c.toDataURL('image/png');
}

// ── Tools / dock ──────────────────────────────────────────────────────────
function paperSetTool(tool) {
  if (!PAPER) return;
  PAPER.tool = tool;
  ['pen', 'pencil', 'eraser'].forEach(t => document.getElementById('pp-' + t)?.classList.toggle('active', t === tool));
}

function paperUndo() { if (PAPER) _padUndo(PAPER); }
function paperRedo() { if (PAPER) _padRedo(PAPER); }

function paperClear() {
  if (!PAPER || !PAPER.hasInk) return;
  PAPER.undo.push(_padSnapshot(PAPER));
  if (PAPER.undo.length > 20) PAPER.undo.shift();
  PAPER.redo.length = 0;
  _padBlank(PAPER);
  PAPER.hasInk = false;
  _paperZones.forEach(z => { z.hasInk = false; z._dirty = false; clearTimeout(z._t); z._t = null; });
  // Recognized values and filled fields survive a page clear on purpose —
  // clearing ink shouldn't silently discard data the staff already verified.
}

function paperDockToggle() {
  document.getElementById('paper-dock')?.classList.toggle('collapsed');
}

// ── 3-screen navigation ────────────────────────────────────────────────────
// Screen 1 = #paper-mode (this file's handwriting page + Metal/Stone panel).
// Screen 2 = the EXISTING #step-2 (full sketch canvas/dock/bottom sheet),
// Screen 3 = the EXISTING #step-3 (Estimate Builder; Order Items/Total
// hidden via the body.paper-on CSS rule in intake.html) — both reused as-is,
// just shown/hidden here instead of relocated. Mirrors intakeStep()'s
// show-one-hide-the-rest pattern, driven by Paper mode's own footer
// (#paper-footer) since the typed wizard's footer stays hidden throughout.
let _paperScreen = 1;
let _paperSketchOn = true; // Screen 2 is optional — not every order needs a sketch
const _PAPER_SCREEN_LABEL = { 1: 'Handwriting', 2: 'Sketch', 3: 'Estimate' };

function _paperFlow() { return _paperSketchOn ? [1, 2, 3] : [1, 3]; }

function paperGoScreen(n) {
  const flow = _paperFlow();
  if (!flow.includes(n)) return;
  _paperScreen = n;
  const s1 = document.getElementById('paper-mode');
  if (s1) s1.style.display = (n === 1) ? 'flex' : 'none';
  const s2 = document.getElementById('step-2');
  if (s2) s2.style.display = (n === 2) ? 'flex' : 'none';
  const s3 = document.getElementById('step-3');
  if (s3) s3.style.display = (n === 3) ? 'block' : 'none';
  if (n === 1) _paperSize();
  if (n === 2 && typeof intakeSizeSketchStage === 'function') intakeSizeSketchStage();
  _paperRenderNav();
}

function paperNext() {
  const flow = _paperFlow(), i = flow.indexOf(_paperScreen);
  if (i >= 0 && i < flow.length - 1) paperGoScreen(flow[i + 1]);
}

function paperBack() {
  const flow = _paperFlow(), i = flow.indexOf(_paperScreen);
  if (i > 0) paperGoScreen(flow[i - 1]);
}

// Turning the Sketch page off doesn't discard any ink already drawn on SK —
// only navigation is affected (SK.hasInk is independent of this toggle). If
// it's off and no ink was ever drawn, sketchExport() already returns null
// today — no order-schema change needed either way.
function paperSetSketchOn(on) {
  _paperSketchOn = !!on;
  if (!_paperSketchOn && _paperScreen === 2) { paperGoScreen(1); return; }
  _paperRenderNav();
}
function paperToggleSketchOn() { paperSetSketchOn(!_paperSketchOn); }

function _paperRenderNav() {
  const flow = _paperFlow();
  const idx = flow.indexOf(_paperScreen);
  const dots = document.getElementById('paper-dots');
  if (dots) {
    dots.innerHTML = flow.map(s =>
      '<button type="button" class="paper-dot' + (s === _paperScreen ? ' on' : '') + '" onclick="paperGoScreen(' + s + ')" aria-label="' + _PAPER_SCREEN_LABEL[s] + '"></button>'
    ).join('');
  }
  const label = document.getElementById('paper-screen-label');
  if (label) label.textContent = _PAPER_SCREEN_LABEL[_paperScreen] + ' · ' + (idx + 1) + ' of ' + flow.length;
  const back = document.getElementById('paper-back-btn');
  if (back) back.classList.toggle('invisible', idx <= 0);
  const next = document.getElementById('paper-next-btn');
  if (next) next.classList.toggle('invisible', idx === flow.length - 1);
  const toggle = document.getElementById('paper-sketch-toggle');
  if (toggle) toggle.classList.toggle('on', _paperSketchOn);
}

// ── Mode toggle + init ────────────────────────────────────────────────────
function paperToggle(on) {
  _paperOn = (on !== undefined) ? !!on : !_paperOn;
  document.body.classList.toggle('paper-on', _paperOn);
  const btn = document.getElementById('paper-mode-btn');
  if (btn) btn.textContent = _paperOn ? '⌨ Form' : '✍ Paper';
  if (_paperOn) {
    _paperEnsureInit();
    paperGoScreen(_paperScreen);
  } else if (typeof intakeStep === 'function') {
    // Re-assert the typed wizard's own step visibility — paperGoScreen() was
    // the last thing to set #step-2/#step-3's inline display, and only
    // #step-1 is force-hidden by CSS while Paper mode is on.
    intakeStep(_intakeStep);
  }
  try { localStorage.setItem('sts-intake-paper', _paperOn ? '1' : '0'); } catch (e) {}
}

function _paperEnsureInit() {
  if (PAPER) return;
  PAPER = _padCreate('paper-canvas', { penOnly: true }); // Apple Pencil only, like the sketch pad
  if (!PAPER) return;
  PAPER.transparent = true; // ink over the DOM-independent template canvas
  PAPER.widths.pen = 3.5;   // handwriting weight, not sketch weight
  PAPER.widths.pencil = 2;
  _padBlank(PAPER);
  _paperWireStrokes();
}
window.addEventListener('resize', () => { if (_paperOn && _paperScreen === 1) _paperSize(); });
window.addEventListener('orientationchange', () => { if (_paperOn && _paperScreen === 1) setTimeout(_paperSize, 300); });

function _paperResetState() {
  if (PAPER) {
    _padBlank(PAPER);
    PAPER.hasInk = false;
    PAPER.undo.length = 0;
    PAPER.redo.length = 0;
  }
  _paperZones.forEach(z => {
    z.hasInk = false; z._dirty = false; z.value = '';
    clearTimeout(z._t); z._t = null;
    _paperChipSet(z, null);
  });
  Object.keys(_paperWrote).forEach(k => delete _paperWrote[k]);
  Object.keys(_paperMaterialRefs).forEach(k => delete _paperMaterialRefs[k]);
  _paperScreen = 1;
  _paperSketchOn = true;
  if (_paperOn) paperGoScreen(1);
}

// ── Wrap the intake.js entry points (loaded before this file) ─────────────
const _ppDirty = _intakeDirty;
_intakeDirty = function () {
  return _ppDirty() || !!(PAPER && PAPER.hasInk);
};

const _ppReset = intakeReset;
intakeReset = function () {
  _ppReset();
  _paperResetState();
};

// Save & Close from Paper mode: finish reading the ink (pending zones →
// whole-page pass), then the normal review screen. The chips + filled
// fields ARE the field-level review; the review overlay stays the
// client-facing confirmation it already is. The Sketch screen (when used)
// draws straight onto SK via #step-2 — nothing to hand off here anymore.
const _ppReviewOpen = intakeReviewOpen;
intakeReviewOpen = async function () {
  if (_paperOn && PAPER && PAPER.hasInk) {
    await _paperFlush();
    await _paperPagePass();
  }
  if (_paperOn) {
    // Validation deep-links (intakeStep) don't reach Paper mode's screens —
    // jump back to the Handwriting screen so the gap is visible, not silent.
    if (!getFullName()) { toast('Write the customer name before saving (or tap its chip to type it)', '⚠', 4000); paperGoScreen(1); return; }
    const type = document.getElementById('f-order-type')?.value || 'order';
    if (type !== 'repair' && !(document.getElementById('f-description')?.value || '').trim()) {
      toast('Write the item / description before saving', '⚠', 4000);
      paperGoScreen(1);
      return;
    }
  }
  _ppReviewOpen();
};

// Restore the last-used mode — staff preference persists across customers.
(function () {
  try { if (localStorage.getItem('sts-intake-paper') === '1') paperToggle(true); } catch (e) {}
})();
