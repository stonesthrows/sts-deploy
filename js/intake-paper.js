// ════════════════════════════════════════════
//  PAPER MODE  —  js/intake-paper.js
//  Goodnotes-style handwritten intake page for intake.html.
//  The on-screen page recreates the physical STS work-order bag: circle the
//  order type / pickup market, write customer info on ruled lines, sketch in
//  the sketch box. Two stacked canvases:
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
const _PAPER_TYPE = { Custom: 'order', Etsy: 'order', Resize: 'resize', Repair: 'repair' };
const _PAPER_PAID = { Cash: 'Cash', Credit: 'Credit Card' }; // Check has no f-paid-by option — lands in notes

let _paperZones = [];         // live zone objects: {id,kind,label,rect,options?,field?,hasInk,value,_t,_dirty,chip}
const _paperWrote = {};       // fieldId → last value Paper wrote (typed edits always win over re-OCR)
let _paperItemRef = null;     // the _oiItems entry the Item & Price zone owns
let _paperChain = Promise.resolve(); // sequential OCR queue — no parallel API bursts
let _paperKeyHinted = false;

// ── Page layout — single source of truth for the template drawing, the
//    OCR zone rects, and the chip positions. All pixel math, recomputed on
//    every resize, so landscape/portrait both work. ──────────────────────
function _paperLayout(w, h) {
  const landscape = w >= h;
  const M = Math.round(Math.min(w, h) * 0.04);
  const innerW = w - M * 2;
  const zones = [];
  let y = M + Math.round(Math.min(w, h) * 0.028); // room for the printed title line

  // Circle strips — order type + pickup market, like the top of the bag
  const optH = Math.max(42, Math.round(h * 0.055));
  if (landscape) {
    zones.push({ id: 'ordertype', kind: 'circle', label: 'ORDER TYPE', options: ['Custom', 'Etsy', 'Resize', 'Repair'],
                 rect: { x: M, y, w: Math.round(innerW * 0.42), h: optH } });
    zones.push({ id: 'pickup', kind: 'circle', label: 'PICKUP', options: ['SVFM', 'Bell', 'TXFM', 'CCFM', 'Flea', 'Studio', 'Ship'],
                 rect: { x: M + Math.round(innerW * 0.46), y, w: innerW - Math.round(innerW * 0.46), h: optH } });
    y += optH + 6;
  } else {
    zones.push({ id: 'ordertype', kind: 'circle', label: 'ORDER TYPE', options: ['Custom', 'Etsy', 'Resize', 'Repair'],
                 rect: { x: M, y, w: innerW, h: optH } });
    y += optH + 2;
    zones.push({ id: 'pickup', kind: 'circle', label: 'PICKUP', options: ['SVFM', 'Bell', 'TXFM', 'CCFM', 'Flea', 'Studio', 'Ship'],
                 rect: { x: M, y, w: innerW, h: optH } });
    y += optH + 6;
  }

  // Fields column (left in landscape, top in portrait) + sketch box
  const colTop = y;
  const fieldW = landscape ? Math.round(innerW * 0.52) : innerW;
  const fieldsBottom = landscape ? (h - M) : (colTop + Math.round((h - M - colTop) * 0.58));
  const avail = fieldsBottom - colTop;
  const rowH = Math.max(44, Math.min(78, Math.floor(avail / 9)));
  const half = Math.round(fieldW * 0.5) - 6;
  let fy = colTop;
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
  const itemH = Math.round(rowH * 1.4);
  row('itemprice', 'itemprice', 'Item & Price', M, fieldW, itemH); fy += itemH;
  row('notes', 'notes', 'Notes', M, fieldW, Math.max(rowH * 2, fieldsBottom - fy));

  // Sketch box — right column (landscape) / lower half (portrait)
  const sk = landscape
    ? { x: M + fieldW + 16, y: colTop, w: w - M - (M + fieldW + 16), h: h - M - colTop }
    : { x: M, y: fieldsBottom + 10, w: innerW, h: h - M - (fieldsBottom + 10) };
  zones.push({ id: 'sketch', kind: 'sketch', label: 'Sketch', rect: sk });
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
        label(z);
        const r1 = r.y + Math.round(r.h * 0.55);
        rule(r.x, r1, Math.round(r.w * 0.68));
        ctx.fillStyle = '#A5834A';
        ctx.font = '700 15px -apple-system, system-ui, sans-serif';
        ctx.fillText('$', r.x + Math.round(r.w * 0.72), r1 - 2);
        rule(r.x + Math.round(r.w * 0.72) + 14, r1, r.w - Math.round(r.w * 0.72) - 14);
        rule(r.x, r.y + r.h - 8, r.w);
        break;
      }
      case 'notes': {
        label(z);
        for (let y = r.y + Math.min(46, Math.round(r.h * 0.3)); y <= r.y + r.h - 4; y += 34) rule(r.x, y, r.w);
        break;
      }
      case 'sketch': {
        ctx.strokeStyle = '#E4D2B0';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = 'rgba(165,131,74,0.4)';
        ctx.font = '800 11px -apple-system, system-ui, sans-serif';
        ctx.fillText('SKETCH', r.x + 10, r.y + 18);
        ctx.fillStyle = 'rgba(90,130,160,0.14)';
        for (let gx = r.x + 20; gx < r.x + r.w - 6; gx += 26)
          for (let gy = r.y + 30; gy < r.y + r.h - 6; gy += 26) {
            ctx.beginPath(); ctx.arc(gx, gy, 1.1, 0, Math.PI * 2); ctx.fill();
          }
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
      if (z.kind === 'sketch') return; // never OCR'd — pure ink
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
      return base + 'It is the "Item & Price" area: the item/piece description is handwritten on the long line and its dollar price after the printed $. '
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
  const apiKey = localStorage.getItem('sts-anthropic-key');
  if (!apiKey) {
    if (!_paperKeyHinted) {
      _paperKeyHinted = true;
      toast('No API key set (⚙) — ink is saved, but handwriting won\'t auto-fill the fields', '⚠', 4500);
    }
    _paperChipSet(z, null);
    return;
  }
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
    case 'itemprice': {
      const item = ((parsed && parsed.item) || '').toString().trim();
      const price = (parsed && parsed.price != null) ? parseFloat(parsed.price) : NaN;
      if (item) _paperSetField('f-description', item);
      if (!isNaN(price) && price > 0) _paperApplyItemPrice(item, price);
      z.value = item + (!isNaN(price) && price > 0 ? ' · $' + price : '');
      _paperChipSet(z, z.value ? 'value' : null, z.value);
      return;
    }
    case 'notes': _paperSetField('f-notes', val); break;
  }
  z.value = val;
  _paperChipSet(z, val ? 'value' : null, val);
}

// The Item & Price line owns one manual order item — re-OCR updates it in
// place instead of stacking duplicates. oiRender() recomputes f-price.
function _paperApplyItemPrice(item, price) {
  if (_paperItemRef && _oiItems.includes(_paperItemRef)) {
    if (item) _paperItemRef.name = item;
    _paperItemRef.price = price;
  } else {
    _paperItemRef = { type: 'manual', name: item || 'Paper intake item', price, quantity: 1 };
    _oiItems.push(_paperItemRef);
  }
  oiRender();
}

// Order type drives the pipeline stage AND intakeApplyTypeLayout, which
// resets _oiItems on a genuine type change — re-adopt the paper item after.
function _paperApplyOrderType(opt) {
  const type = _PAPER_TYPE[opt];
  if (!type) return;
  if (opt === 'Etsy') _paperSetField('f-source', 'Etsy Message');
  const sel = document.getElementById('f-order-type');
  if (!sel || sel.value === type) return;
  const keep = (_paperItemRef && _oiItems.includes(_paperItemRef)) ? _paperItemRef : null;
  intakeApplyTypeLayout(type);
  if (keep && !_oiItems.includes(keep)) { _oiItems.push(keep); oiRender(); }
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
  const apiKey = localStorage.getItem('sts-anthropic-key');
  if (!apiKey) return;
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
    + 'The image is a handwritten digital work-order page with printed labels: circled ORDER TYPE (Custom, Etsy, Resize, Repair), '
    + 'circled PICKUP market (SVFM = Sunset Valley Farmer\'s Market, Bell = Bell Market, TXFM = Mueller Market, CCFM = Chaparral Crossing Market, Flea = Austin Flea, Studio = Studio, Ship = To be Shipped), '
    + 'ruled fields (Name, Phone, Email, Take In, Deadline, Ring Size), Paid By checkboxes (Cash, Credit, Check), an Item & Price line, a Notes area, and a sketch box.\n'
    + 'CRITICAL ACCURACY RULES: copy the exact words you see — never substitute similar-sounding products; if a word is unclear write it as-is with [?] after it; look closely at numerals.\n'
    + 'Capture ALL text in the Notes area verbatim — do not skip or summarize it. Also transcribe any handwriting written OUTSIDE the labeled fields into notes.\n'
    + 'Return ONLY a valid JSON object with these exact keys (null for anything not visible):\n'
    + '{"customer_name":string|null,"email":string|null,"phone":string|null,"take_in_date":"YYYY-MM-DD"|null,"deadline":"YYYY-MM-DD"|null,'
    + '"pickup_location":"Bell Market"|"Mueller Market"|"Chaparral Crossing Market"|"Sunset Valley Farmer\'s Market"|"Austin Flea"|"Studio"|"To be Shipped"|null,'
    + '"contacted_via":"Etsy Message"|null,"order_type":"order"|"resize"|"repair","description":string|null,"ring_size":string|null,'
    + '"price":number|null,"paid_by":"Cash"|"Credit"|"Check"|null,"notes":string|null}\n'
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
  fillIfEmpty('f-source', p.contacted_via || '');
  fillIfEmpty('f-description', (p.description || '').trim());
  if (p.ring_size) fillIfEmpty('f-sizing', /[a-z]/i.test(p.ring_size) ? p.ring_size : 'ring size ' + p.ring_size);
  if (p.paid_by && _PAPER_PAID[p.paid_by]) fillIfEmpty('f-paid-by', _PAPER_PAID[p.paid_by]);
  fillIfEmpty('f-notes', (p.notes || '').trim());
  const sel = document.getElementById('f-order-type');
  if (p.order_type && _TYPE_BLOCKS[p.order_type] && sel && sel.value === 'order' && p.order_type !== 'order') {
    _paperApplyOrderType(p.order_type === 'resize' ? 'Resize' : p.order_type === 'repair' ? 'Repair' : 'Custom');
    filled++;
  }
  const price = (p.price != null) ? parseFloat(p.price) : NaN;
  if (!isNaN(price) && price > 0 && !_paperItemRef && !(parseFloat(document.getElementById('f-price')?.value) > 0)) {
    _paperApplyItemPrice((p.description || '').trim(), price);
    filled++;
  }
  if (filled) toast('✓ Page read — filled ' + filled + ' more field' + (filled > 1 ? 's' : ''), '✓');
}

// ── Sketch handoff — the sketch box's ink becomes the order's design sketch
//    (drawn into the SK pad so sketchExport(), the review thumbnail, and the
//    bag print all work exactly as they do for a Step-2 sketch). ───────────
function _paperHandoffSketch() {
  const z = _paperZones.find(x => x.id === 'sketch');
  if (!z || !z.hasInk || typeof SK === 'undefined' || !SK) return;
  const r = z.rect;
  const crop = document.createElement('canvas');
  crop.width = r.w; crop.height = r.h;
  crop.getContext('2d').drawImage(PAPER.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  _padBlank(SK);
  const s = Math.min(SK.canvas.width / r.w, SK.canvas.height / r.h, 1);
  SK.ctx.drawImage(crop, (SK.canvas.width - r.w * s) / 2, (SK.canvas.height - r.h * s) / 2, r.w * s, r.h * s);
  SK.hasInk = true;
  SK.dirty = true;
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

// ── Mode toggle + init ────────────────────────────────────────────────────
function paperToggle(on) {
  _paperOn = (on !== undefined) ? !!on : !_paperOn;
  document.body.classList.toggle('paper-on', _paperOn);
  const btn = document.getElementById('paper-mode-btn');
  if (btn) btn.textContent = _paperOn ? '⌨ Form' : '✍ Paper';
  if (_paperOn) { _paperEnsureInit(); _paperSize(); }
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
window.addEventListener('resize', () => { if (_paperOn) _paperSize(); });
window.addEventListener('orientationchange', () => { if (_paperOn) setTimeout(_paperSize, 300); });

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
  _paperItemRef = null;
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
// whole-page pass → sketch handoff), then the normal review screen. The
// chips + filled fields ARE the field-level review; the review overlay
// stays the client-facing confirmation it already is.
const _ppReviewOpen = intakeReviewOpen;
intakeReviewOpen = async function () {
  if (_paperOn && PAPER && PAPER.hasInk) {
    await _paperFlush();
    await _paperPagePass();
    _paperHandoffSketch();
  }
  if (_paperOn) {
    // Validation deep-links (intakeStep) are invisible while the wizard is
    // hidden — surface the gap here instead of silently jumping nowhere.
    if (!getFullName()) { toast('Write the customer name before saving (or tap its chip to type it)', '⚠', 4000); return; }
    const type = document.getElementById('f-order-type')?.value || 'order';
    if (type !== 'repair' && !(document.getElementById('f-description')?.value || '').trim()) {
      toast('Write the item / description before saving', '⚠', 4000);
      return;
    }
  }
  _ppReviewOpen();
};

// Restore the last-used mode — staff preference persists across customers.
(function () {
  try { if (localStorage.getItem('sts-intake-paper') === '1') paperToggle(true); } catch (e) {}
})();
