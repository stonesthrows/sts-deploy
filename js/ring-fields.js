// ════════════════════════════════════════════
//  RING FIELDS — shared Ring piece-type engine
//
//  Used by BOTH intake.html (js/intake.js) and jewelry-workflow.html's Edit
//  Order modal (js/orders.js). Operates purely on DOM ids
//  (f-piece-type, f-ring-count, rings-dynamic-list, f-ring-*-N,
//  ring-fields-shared) — no page-specific dependencies — so it's included
//  as-is in both pages. intake.js and orders.js never run on the same page,
//  so there's no runtime collision from the shared `_intakeRings` state.
//
//  Each caller page wires its own onchange on #f-piece-type to
//  ringFieldsApplyPieceType(); intake.html additionally re-renders the
//  bottom parameter sheet after calling it (see intakeApplyPieceType in
//  js/intake.js) — that part is intake-only and stays there.
// ════════════════════════════════════════════

// ── Ring piece type: N-ring dynamic fields ─────────────────────
// Replaces the shared Materials/Finish/Gemstones fields + the sheet's
// Individual/Couple 2-ring cap with one field-set per ring (any count),
// each with its own name (once there's more than one) and an independent
// Ring Type (Meditation Ring / Simple Band / Custom Ring) — each type has
// its own field set — plus an optional inside-ring stamping.
function _intakeBlankRing() {
  return {
    name: '', category: '', stamping: '',
    medWidth: '', medTexture: '', medSpinners: '', medSpinnerStyle: '', medSize: '',
    bandWidth: '', bandTexture: '', bandSize: '',
    customSize: '', customWidth: '', customGauge: '', customMetal: '', customTexture: [], customNotes: '',
    customProfile: 'Flat', customAllowance: '1',
  };
}

// ── Ring blank length calculator ───────────────────────────────
// Jewelers cut a straight length of stock, bend it into a circle, and solder
// the seam. The stock's own thickness sits at the bend, so the flat length
// needed is the CIRCUMFERENCE AT THE STOCK'S MID-THICKNESS, not at the
// ring's bare inside diameter — that's why thickness (gauge) is added to
// diameter before multiplying by π. Same physical reasoning for both
// profiles: Flat stock's relevant dimension is its thickness (the short
// axis, perpendicular to the bend), not its face width, so `f-ring-
// customwidth-N` never factors into this — a wider band with the same
// gauge needs the same blank length. Round wire has no separate
// width/thickness distinction, so its own diameter plays both roles.
//
// Ring size → inside diameter (mm), standard US/Canada chart, whole and
// half sizes 3–16; quarters are linearly interpolated between these.
const RING_SIZE_ID_MM = {
  3: 14.1, 3.5: 14.5, 4: 14.9, 4.5: 15.3, 5: 15.7, 5.5: 16.1,
  6: 16.5, 6.5: 16.9, 7: 17.3, 7.5: 17.7, 8: 18.2, 8.5: 18.6,
  9: 19.0, 9.5: 19.4, 10: 19.8, 10.5: 20.2, 11: 20.6, 11.5: 21.0,
  12: 21.4, 12.5: 21.8, 13: 22.2, 13.5: 22.6, 14: 23.0, 14.5: 23.4,
  15: 23.8, 15.5: 24.2, 16: 24.6,
};

// Gauge → thickness/diameter (mm), standard B&S (Brown & Sharpe / AWG)
// jewelry gauge scale — the same scale is used to describe both round wire
// diameter and sheet/flat-stock thickness.
const RING_GAUGE_MM = {
  6: 4.115, 8: 3.264, 10: 2.588, 12: 2.053, 14: 1.628, 16: 1.291,
  18: 1.024, 20: 0.812, 22: 0.643, 24: 0.511, 26: 0.405, 28: 0.320,
};

// Interpolates inside diameter (mm) for any size (quarters included)
// between the chart's whole/half-size entries.
function _ringSizeToIdMm(size) {
  const s = parseFloat(size);
  if (!Number.isFinite(s)) return null;
  const keys = Object.keys(RING_SIZE_ID_MM).map(Number).sort((a, b) => a - b);
  if (s <= keys[0]) return RING_SIZE_ID_MM[keys[0]];
  if (s >= keys[keys.length - 1]) return RING_SIZE_ID_MM[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    const lo = keys[i], hi = keys[i + 1];
    if (s >= lo && s <= hi) {
      const t = (s - lo) / (hi - lo);
      return RING_SIZE_ID_MM[lo] + t * (RING_SIZE_ID_MM[hi] - RING_SIZE_ID_MM[lo]);
    }
  }
  return null;
}

// Parses a free-text gauge field ("18ga", "18 gauge", "18") and interpolates
// thickness (mm) between the standard even-gauge entries above.
function _ringGaugeToMm(gaugeText) {
  const m = String(gaugeText || '').match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  const g = parseFloat(m[1]);
  const keys = Object.keys(RING_GAUGE_MM).map(Number).sort((a, b) => a - b);
  if (g <= keys[0]) return RING_GAUGE_MM[keys[0]];
  if (g >= keys[keys.length - 1]) return RING_GAUGE_MM[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    const lo = keys[i], hi = keys[i + 1];
    if (g >= lo && g <= hi) {
      const t = (g - lo) / (hi - lo);
      return RING_GAUGE_MM[lo] + t * (RING_GAUGE_MM[hi] - RING_GAUGE_MM[lo]);
    }
  }
  return null;
}

// Blank length = π × (inside diameter + stock thickness) + cut allowance.
// Returns null if size or gauge isn't parseable yet.
function ringBlankLengthMm(sizeText, gaugeText, allowanceText) {
  const id = _ringSizeToIdMm(sizeText);
  const t = _ringGaugeToMm(gaugeText);
  if (id === null || t === null) return null;
  const allowance = parseFloat(allowanceText);
  const a = Number.isFinite(allowance) ? allowance : 0;
  return Math.PI * (id + t) + a;
}

// Recomputes and displays the blank length for one Custom Ring block from
// its current DOM values (reads live so it works mid-typing, same pattern
// as ringFieldsRenderStampingSummary).
function ringFieldsUpdateBlankLength(i) {
  const g = id => document.getElementById(id);
  const out = g('f-ring-blanklen-' + i);
  if (!out) return;
  const size = g('f-ring-customsize-' + i)?.value;
  const gauge = g('f-ring-customgauge-' + i)?.value;
  const allowance = g('f-ring-customallowance-' + i)?.value;
  const mm = ringBlankLengthMm(size, gauge, allowance);
  if (mm === null) {
    out.textContent = 'Enter ring size + gauge to calculate';
    return;
  }
  const inches = mm / 25.4;
  out.textContent = 'Blank length: ' + mm.toFixed(1) + ' mm (' + inches.toFixed(2) + ' in)';
}
let _intakeRings = [_intakeBlankRing()];

// Shows/hides the Number-of-Rings + dynamic ring blocks vs. the shared
// (non-Ring) field set, based on the selected Piece Type. Callers that also
// have a bottom parameter sheet (intake.html) re-render it after calling
// this — that's page-specific and lives in the caller, not here.
function ringFieldsApplyPieceType(pieceType) {
  const isRing = pieceType === 'Ring';
  const countFg = document.getElementById('ring-count-fg');
  const dynWrap = document.getElementById('rings-dynamic-wrap');
  const shared  = document.getElementById('ring-fields-shared');
  if (countFg) countFg.style.display = isRing ? '' : 'none';
  if (dynWrap) dynWrap.style.display = isRing ? '' : 'none';
  if (shared)  shared.style.display  = isRing ? 'none' : 'contents';
  if (isRing) {
    intakeRenderRingBlocks();
  } else {
    const summary = document.getElementById('est-ring-stamping-summary');
    if (summary) { summary.innerHTML = ''; summary.style.display = 'none'; }
  }
}

// Compact "Ring N — Size X — 'stamping'" glance list shown in the Estimate
// Builder (both apps have a #est-ring-stamping-summary container there) so
// staff building a quote can see size/stamping without scrolling up to the
// Design section. Reads straight from the DOM rather than `_intakeRings` so
// it can be called on every keystroke (see the delegated listener below)
// without re-rendering the ring blocks or fighting the user's typing.
function ringFieldsRenderStampingSummary() {
  const el = document.getElementById('est-ring-stamping-summary');
  if (!el) return;
  const g = id => document.getElementById(id);
  const blocks = document.querySelectorAll('#rings-dynamic-list .ring-block');
  const multi = blocks.length > 1;
  const esc = v => String(v || '').replace(/</g, '&lt;');
  const rows = [...blocks].map((block, i) => {
    const category = g('f-ring-category-' + i)?.value || '';
    const size = category === 'Meditation Ring' ? g('f-ring-medsize-' + i)?.value
               : category === 'Simple Band'     ? g('f-ring-bandsize-' + i)?.value
               : category === 'Custom Ring'     ? g('f-ring-customsize-' + i)?.value
               : '';
    const stamping = g('f-ring-stamping-' + i)?.value || '';
    if (!size && !stamping) return '';
    const name = g('f-ring-name-' + i)?.value || '';
    const label = multi ? ('Ring ' + (i + 1) + (name ? ' (' + name + ')' : '')) : 'Ring';
    return '<div class="est-ring-stamp-row"><strong>' + esc(label) + '</strong>'
      + (size ? ' — Size ' + esc(size) : '')
      + (stamping ? ' — “' + esc(stamping) + '”' : '')
      + '</div>';
  }).filter(Boolean).join('');
  el.innerHTML = rows;
  el.style.display = rows ? '' : 'none';
}
document.addEventListener('input',  e => { if (e.target.closest?.('#rings-dynamic-list')) ringFieldsRenderStampingSummary(); });
document.addEventListener('change', e => { if (e.target.closest?.('#rings-dynamic-list')) ringFieldsRenderStampingSummary(); });

// Live blank-length recalc for Custom Ring blocks — delegated the same way
// as the stamping summary above, scoped to the size/gauge/profile/allowance
// inputs so it doesn't run on every keystroke in unrelated fields.
document.addEventListener('input', e => {
  const block = e.target.closest?.('.ring-block');
  if (!block || !e.target.matches('[id^="f-ring-customsize-"], [id^="f-ring-customgauge-"], [id^="f-ring-customallowance-"]')) return;
  const i = [...block.parentElement.children].indexOf(block);
  ringFieldsUpdateBlankLength(i);
});
document.addEventListener('change', e => {
  const block = e.target.closest?.('.ring-block');
  if (!block || !e.target.matches('[id^="f-ring-customprofile-"]')) return;
  const i = [...block.parentElement.children].indexOf(block);
  ringFieldsUpdateBlankLength(i);
});

function _intakeCollectRingsFromDom() {
  const blocks = document.querySelectorAll('#rings-dynamic-list .ring-block');
  if (!blocks.length) return _intakeRings;
  const g = id => document.getElementById(id);
  // Reads every category's fields regardless of which category is currently
  // rendered for a given ring — fields not in the DOM just fall back to ''/[]
  // via the optional chaining below, and a ring's data for a category it's
  // NOT currently showing simply isn't touched (so switching category and
  // back restores what was there before).
  return [...blocks].map((block, i) => ({
    name:            g('f-ring-name-' + i)?.value.trim() || '',
    category:        g('f-ring-category-' + i)?.value || '',
    stamping:        g('f-ring-stamping-' + i)?.value.trim() || '',
    medWidth:        g('f-ring-medwidth-' + i)?.value || '',
    medTexture:      g('f-ring-medtexture-' + i)?.value || '',
    medSpinners:     g('f-ring-medspinners-' + i)?.value || '',
    medSpinnerStyle: g('f-ring-medspinnerstyle-' + i)?.value || '',
    medSize:         g('f-ring-medsize-' + i)?.value || '',
    bandWidth:       g('f-ring-bandwidth-' + i)?.value || '',
    bandTexture:     g('f-ring-bandtexture-' + i)?.value || '',
    bandSize:        g('f-ring-bandsize-' + i)?.value || '',
    customSize:      g('f-ring-customsize-' + i)?.value.trim() || '',
    customWidth:     g('f-ring-customwidth-' + i)?.value.trim() || '',
    customGauge:     g('f-ring-customgauge-' + i)?.value.trim() || '',
    customMetal:     g('f-ring-custommetal-' + i)?.value.trim() || '',
    customTexture:   [...block.querySelectorAll('.ring-custom-texture input:checked')].map(c => c.value),
    customNotes:     g('f-ring-customnotes-' + i)?.value.trim() || '',
    customProfile:   g('f-ring-customprofile-' + i)?.value || 'Flat',
    customAllowance: g('f-ring-customallowance-' + i)?.value.trim() || '1',
  }));
}

// Switching a single ring's Type re-renders all ring blocks (simplest way
// to swap that ring's field set), so snapshot every ring's current DOM
// values first or the others' typed-but-not-yet-synced data would be lost.
function intakeSetRingCategory(i, category) {
  _intakeRings = _intakeCollectRingsFromDom();
  if (_intakeRings[i]) _intakeRings[i].category = category;
  intakeRenderRingBlocks();
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

// Quarter-size steps from min to max inclusive, e.g. _intakeSizeOptions(4,13)
// → ["4","4.25","4.5","4.75","5",…,"13"].
function _intakeSizeOptions(min, max) {
  const out = [];
  for (let q = min * 4; q <= max * 4; q++) out.push(String(q / 4));
  return out;
}

function _intakeSelectHtml(id, options, current) {
  return '<select id="' + id + '">'
    + '<option value="">— Select —</option>'
    + options.map(o => '<option value="' + o + '"' + (o === current ? ' selected' : '') + '>' + o + '</option>').join('')
    + '</select>';
}

// The 3 Ring Types each have their own field set — Meditation Ring and
// Simple Band are fixed product lines (enumerated widths/textures/sizes),
// Custom Ring is free-text/free-select like a bespoke piece.
function _intakeRingCategoryFieldsHtml(i, r) {
  const esc = v => String(v || '').replace(/"/g, '&quot;');
  if (r.category === 'Meditation Ring') {
    return `
      <div class="fg">
        <label>Width of Ring</label>
        ${_intakeSelectHtml('f-ring-medwidth-' + i, ['6mm', '8mm', '10mm'], r.medWidth)}
      </div>
      <div class="fg">
        <label>Texture</label>
        ${_intakeSelectHtml('f-ring-medtexture-' + i, ['Bodhi Leaf', 'Round Hammer'], r.medTexture)}
      </div>
      <div class="fg">
        <label>Number of Spinners</label>
        ${_intakeSelectHtml('f-ring-medspinners-' + i, ['1', '2', '3'], r.medSpinners)}
      </div>
      <div class="fg">
        <label>Style of Spinner Ring</label>
        ${_intakeSelectHtml('f-ring-medspinnerstyle-' + i, ['Leaf', 'Orbit Tricolor'], r.medSpinnerStyle)}
      </div>
      <div class="fg">
        <label>Ring Size</label>
        ${_intakeSelectHtml('f-ring-medsize-' + i, _intakeSizeOptions(4, 13), r.medSize)}
      </div>`;
  }
  if (r.category === 'Simple Band') {
    return `
      <div class="fg">
        <label>Band Width</label>
        ${_intakeSelectHtml('f-ring-bandwidth-' + i, ['4mm', '6mm', '8mm', '10mm'], r.bandWidth)}
      </div>
      <div class="fg">
        <label>Band Texture</label>
        ${_intakeSelectHtml('f-ring-bandtexture-' + i, ['Small Rounded', 'Large Rounded', 'Vertical Lined', 'Horizontal Lined', 'Smooth'], r.bandTexture)}
      </div>
      <div class="fg">
        <label>Band Size</label>
        ${_intakeSelectHtml('f-ring-bandsize-' + i, _intakeSizeOptions(4, 15), r.bandSize)}
      </div>`;
  }
  if (r.category === 'Custom Ring') {
    return `
      <div class="fg">
        <label>Ring Size</label>
        <input type="text" id="f-ring-customsize-${i}" value="${esc(r.customSize)}" placeholder="e.g. 7">
      </div>
      <div class="fg">
        <label>Ring Width</label>
        <input type="text" id="f-ring-customwidth-${i}" value="${esc(r.customWidth)}" placeholder="e.g. 4mm">
      </div>
      <div class="fg">
        <label>Ring Gauge</label>
        <input type="text" id="f-ring-customgauge-${i}" value="${esc(r.customGauge)}" placeholder="e.g. 18ga">
      </div>
      <div class="fg">
        <label>Stock Profile</label>
        ${_intakeSelectHtml('f-ring-customprofile-' + i, ['Flat', 'Round'], r.customProfile || 'Flat')}
      </div>
      <div class="fg">
        <label>Cut Allowance (mm)</label>
        <input type="number" id="f-ring-customallowance-${i}" value="${esc(r.customAllowance || '1')}" step="0.1" min="0" placeholder="1">
      </div>
      <div class="fg full">
        <label>Ring Blank Length</label>
        <div id="f-ring-blanklen-${i}" style="font-size:14px;font-weight:600;color:#4A3F2A;padding:6px 0;">Enter ring size + gauge to calculate</div>
      </div>
      <div class="fg">
        <label>Metal</label>
        <input type="text" id="f-ring-custommetal-${i}" value="${esc(r.customMetal)}" placeholder="e.g. 14k yellow gold">
      </div>
      <div class="fg">
        <label>Texture</label>
        <div class="finish-checks ring-custom-texture">
          <label><input type="checkbox" value="Polished" ${r.customTexture.includes('Polished') ? 'checked' : ''}> Polished</label>
          <label><input type="checkbox" value="Hammered/Textured" ${r.customTexture.includes('Hammered/Textured') ? 'checked' : ''}> Hammered</label>
          <label><input type="checkbox" value="Matte" ${r.customTexture.includes('Matte') ? 'checked' : ''}> Matte</label>
          <label><input type="checkbox" value="Oxidized" ${r.customTexture.includes('Oxidized') ? 'checked' : ''}> Oxidized</label>
        </div>
      </div>
      <div class="fg full">
        <label>Notes</label>
        <textarea id="f-ring-customnotes-${i}" placeholder="Any additional detail…" style="min-height:40px;">${esc(r.customNotes)}</textarea>
      </div>`;
  }
  return '';
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
        <label>Ring Type</label>
        <select id="f-ring-category-${i}" onchange="intakeSetRingCategory(${i}, this.value)">
          <option value="">— Select —</option>
          <option value="Meditation Ring" ${r.category === 'Meditation Ring' ? 'selected' : ''}>Meditation Ring</option>
          <option value="Simple Band" ${r.category === 'Simple Band' ? 'selected' : ''}>Simple Band</option>
          <option value="Custom Ring" ${r.category === 'Custom Ring' ? 'selected' : ''}>Custom Ring</option>
        </select>
      </div>
      ${_intakeRingCategoryFieldsHtml(i, r)}
      <div class="fg">
        <label>Inside Ring Stamping <span style="font-weight:400;">(optional)</span></label>
        <input type="text" id="f-ring-stamping-${i}" value="${esc(r.stamping)}" placeholder="e.g. Forever &amp; Always">
      </div>
    </div>
  `).join('');
  ringFieldsRenderStampingSummary();
  _intakeRings.forEach((r, i) => { if (r.category === 'Custom Ring') ringFieldsUpdateBlankLength(i); });
}

// Normalizes one ring's category-specific fields into the
// {size, materials, finish, gemstones} shape the legacy flat fields expect —
// a single place that knows how each Ring Type maps onto that shape.
function _intakeRingSummary(r) {
  if (r.category === 'Meditation Ring') {
    const spinners = r.medSpinners ? (r.medSpinners + ' spinner' + (r.medSpinners === '1' ? '' : 's')) : '';
    return {
      size: r.medSize,
      materials: ['Meditation Ring', r.medWidth, r.medTexture].filter(Boolean).join(', ')
        + (spinners ? ' — ' + spinners + (r.medSpinnerStyle ? ' (' + r.medSpinnerStyle + ')' : '') : ''),
      finish: [],
      gemstones: '',
    };
  }
  if (r.category === 'Simple Band') {
    return {
      size: r.bandSize,
      materials: ['Simple Band', r.bandWidth, r.bandTexture].filter(Boolean).join(', '),
      finish: [],
      gemstones: '',
    };
  }
  if (r.category === 'Custom Ring') {
    return {
      size: r.customSize,
      materials: [r.customMetal, r.customWidth, r.customGauge].filter(Boolean).join(', '),
      finish: r.customTexture || [],
      gemstones: r.customNotes,
    };
  }
  return { size: '', materials: '', finish: [], gemstones: '' };
}

// Flat, backward-compatible fields derived from rings[] — the desktop
// workflow app and print templates only ever understood a single ring
// (materials/gemstones/finish/sizing/stamping) plus an optional 2nd ring
// (ringSize2/stamping2, gated by orderFor==='couple'). Ring orders with
// more than 2 rings still get full detail in order.rings; these flat
// fields surface rings 1-2 only, same as the old Individual/Couple cap.
function _intakeRingsLegacyFields(rings) {
  const multi = rings.length > 1;
  const summaries = rings.map(_intakeRingSummary);
  const label = (r, i) => multi ? ('Ring ' + (i + 1) + (r.name ? ' (' + r.name + ')' : '')) : '';
  const join = (key, sep = '; ') => rings
    .map((r, i) => summaries[i][key] ? (label(r, i) ? label(r, i) + ': ' + summaries[i][key] : summaries[i][key]) : '')
    .filter(Boolean).join(sep);
  return {
    // Newline-joined (not '; ') so the desktop Edit Order view's Estimate
    // Builder (populateEstimateFromOrder in js/order-widgets.js, which
    // splits o.materials on '\n') gives each ring its own Materials row
    // instead of showing all rings squashed into one row's description.
    materials: join('materials', '\n'),
    gemstones: join('gemstones'),
    finish:    [...new Set(summaries.flatMap(s => s.finish || []))],
    sizing:    summaries[0] && summaries[0].size ? ('sz ' + summaries[0].size) : '',
    ringSize2: summaries[1] && summaries[1].size ? ('sz ' + summaries[1].size) : '',
    stamping:  (rings[0] && rings[0].stamping) || '',
    stamping2: (rings[1] && rings[1].stamping) || '',
    orderFor:  multi ? 'couple' : 'individual',
  };
}

// Resets ring state to a single blank entry — called by each page's own
// reset/close routine (intakeReset() in js/intake.js, closeEditOrderModal()
// in js/orders.js) so the next order started doesn't inherit stale data.
function ringFieldsReset() {
  _intakeRings = [_intakeBlankRing()];
  const summary = document.getElementById('est-ring-stamping-summary');
  if (summary) { summary.innerHTML = ''; summary.style.display = 'none'; }
}
