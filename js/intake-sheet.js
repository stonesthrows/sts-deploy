// ════════════════════════════════════════════
//  BOTTOM PARAMETER SHEET  —  js/intake-sheet.js
//  Loaded ONLY by intake.html (after intake-profiles.js, before
//  intake.js). Brief 2.1 (sheet) + 2.2 (structured stones) + 2.5
//  (smart defaults from the loaded client profile).
//
//  The sheet is the Custom Design parameter surface on Step 2 — it
//  writes into the hidden Step-1 fields (f-sizing / f-ringsize2 /
//  f-stamping / f-stamping2) so intakeSubmit() and the Notion pipeline
//  never change. Repair/Resize/Square layouts are untouched (they never
//  reach Step 2). Metal/Stone entry is handwritten now (Paper mode's
//  Screen 1, js/intake-paper.js) or typed directly into Step 1's plain
//  f-materials/f-gemstones fields — no chip UI for them anymore.
// ════════════════════════════════════════════

// _psStones stays declared (always empty) only because js/intake.js's
// intakeSubmit() still reads it for order.stones — structured per-stone
// capture was chip-UI-only and is retired; order.gemstones (free text)
// carries stone info now. Safe to leave at [] indefinitely.
let _psStones = [];
let _psDetent = 'peek';

// ── Reference Photos (Photos tab) ─────────────────────────────
// Client-shown inspiration/existing-piece photos — distinct from the
// sketch-canvas underlay (which is a single trace guide, never saved).
// Downscaled client-side before storing so a handful of camera photos
// don't blow the localStorage quota or Notion's 4.5 MiB per-file cap.
const RP_MAX_PHOTOS = 6;
const RP_MAX_DIM = 1280;
const RP_JPEG_QUALITY = 0.82;
let _refPhotos = []; // array of JPEG dataURLs

function _rpResizeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, RP_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', RP_JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function rpPick() {
  if (_refPhotos.length >= RP_MAX_PHOTOS) {
    if (typeof toast === 'function') toast('Up to ' + RP_MAX_PHOTOS + ' reference photos per order', '⚠', 2600);
    return;
  }
  document.getElementById('rp-file')?.click();
}

async function rpFilesChosen(input) {
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  const room = RP_MAX_PHOTOS - _refPhotos.length;
  for (const file of files.slice(0, room)) {
    try { _refPhotos.push(await _rpResizeFile(file)); } catch (e) { /* skip a bad file */ }
  }
  if (files.length > room && typeof toast === 'function') {
    toast('Only added ' + Math.max(room, 0) + ' — up to ' + RP_MAX_PHOTOS + ' reference photos per order', '⚠', 3000);
  }
  rpRenderGrid();
  if (typeof intakeTabsRefresh === 'function') intakeTabsRefresh();
}

function rpRemove(i) {
  _refPhotos.splice(i, 1);
  rpRenderGrid();
  if (typeof intakeTabsRefresh === 'function') intakeTabsRefresh();
}

function rpRenderGrid() {
  const grid = document.getElementById('rp-grid');
  if (!grid) return;
  const thumbs = _refPhotos.map((src, i) =>
    '<div class="rp-thumb"><img src="' + src + '" alt="Reference photo">'
    + '<button type="button" class="rp-x" onclick="rpRemove(' + i + ')" aria-label="Remove photo">✕</button></div>'
  ).join('');
  const canAdd = _refPhotos.length < RP_MAX_PHOTOS;
  grid.innerHTML = thumbs
    + (canAdd ? '<button type="button" class="rp-add" onclick="rpPick()">＋<span>Add</span></button>' : '');
}

// ── Pane rendering ────────────────────────────────────────────
function psRenderPanes() {
  const sizing = document.getElementById('ps-pane-sizing');
  if (sizing) {
    let wheel = '';
    for (let q = 4; q <= 64; q++) {
      const v = q / 4;
      wheel += '<button type="button" class="ps-chip" data-v="' + v + '">' + String(v).replace(/\.?0+$/, '') + '</button>';
    }
    sizing.innerHTML =
      '<div class="ps-label">Order For</div>'
      + '<div class="ps-chips" id="ps-orderfor">'
      + '<button type="button" class="ps-chip on" data-v="individual">Individual</button>'
      + '<button type="button" class="ps-chip" data-v="couple">Couple</button>'
      + '</div>'
      + '<div class="ps-label" id="ps-ringsize-label">Ring Size (US)</div>'
      + '<div class="ps-wheel ps-chips" id="ps-ringsize">' + wheel + '</div>'
      + '<div id="ps-ring2-wrap" style="display:none;">'
      + '<div class="ps-label">Ring Size (US) — Ring 2</div>'
      + '<div class="ps-wheel ps-chips" id="ps-ringsize2">' + wheel + '</div>'
      + '</div>'
      + '<div class="ps-label">Band</div>'
      + '<div>'
      + '<span class="ps-step">Width <button type="button" onclick="psStep(\'width\',-0.5)">−</button><span class="ps-step-val" id="ps-width-val">—</span><button type="button" onclick="psStep(\'width\',0.5)">＋</button></span>'
      + '<span class="ps-step">Thickness <button type="button" onclick="psStep(\'thick\',-0.25)">−</button><span class="ps-step-val" id="ps-thick-val">—</span><button type="button" onclick="psStep(\'thick\',0.25)">＋</button></span>'
      + '</div>'
      + '<div class="ps-label" id="ps-stamping-label">Ring Stamping</div>'
      + '<input type="text" class="ps-input" id="ps-stamping" placeholder="e.g. Forever &amp; Always" style="width:100%;">'
      + '<div id="ps-stamping2-wrap" style="display:none;margin-top:8px;">'
      + '<div class="ps-label">Ring Stamping — Ring 2</div>'
      + '<input type="text" class="ps-input" id="ps-stamping2" placeholder="e.g. To the moon and back" style="width:100%;">'
      + '</div>';
  }
  const photos = document.getElementById('ps-pane-photos');
  if (photos) {
    photos.innerHTML =
      '<div class="ps-label">Reference Photos <span style="font-weight:400;text-transform:none;letter-spacing:0;">— shown by the client, not the sketch</span></div>'
      + '<div class="rp-grid" id="rp-grid"></div>'
      + '<div class="rp-hint">' + RP_MAX_PHOTOS + ' max — synced to Notion with the order</div>';
    rpRenderGrid();
  }
  const notes = document.getElementById('ps-pane-notes');
  if (notes) {
    notes.innerHTML =
      '<div class="ps-voice-chips" id="ps-voice-chips"></div>'
      + '<div class="ps-label">Design Notes <span style="font-weight:400;text-transform:none;letter-spacing:0;">— saved to Internal Notes</span></div>'
      + '<textarea class="ps-input" id="ps-notes" placeholder="Lower bezel profile, gloves, client hates prongs…"></textarea>';
    psVoiceRenderChips();
  }
}

// ── 2.4 Voice-to-note capture — press-and-hold the dock mic ──
// webkitSpeechRecognition where available. The brief's fallback (record →
// transcribe via /api/claude-proxy) isn't viable — the Claude API doesn't
// accept audio — so unsupported devices get a graceful toast instead.
let _voiceNotes = [];   // {t: '2:14 PM', text}
let _voiceRec = null;
let _voiceBuf = '';

function psVoiceRenderChips() {
  const wrap = document.getElementById('ps-voice-chips');
  if (!wrap) return;
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  wrap.innerHTML = _voiceNotes.map((n, i) =>
    '<div class="ps-voice-chip"><span class="pv-time">🎙 ' + esc(n.t) + '</span><span>' + esc(n.text) + '</span>'
    + '<button type="button" class="pv-x" onclick="psVoiceRemove(' + i + ')" aria-label="Delete note">✕</button></div>'
  ).join('');
}

function psVoiceRemove(i) {
  _voiceNotes.splice(i, 1);
  psVoiceRenderChips();
}

// Timestamped lines joined into f-notes at submit (readable degradation)
function psVoiceNotesText() {
  return _voiceNotes.map(n => n.t + ' — ' + n.text).join('\n');
}

function psVoiceReset() {
  _voiceNotes = [];
  _voiceBuf = '';
  psVoiceRenderChips();
}

function _voiceStart() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById('voice-btn');
  if (!SR) {
    if (typeof toast === 'function') toast('Voice dictation isn\'t supported on this device', '⚠', 3000);
    return;
  }
  if (_voiceRec) return;
  _voiceBuf = '';
  _voiceRec = new SR();
  _voiceRec.continuous = true;
  _voiceRec.interimResults = false;
  _voiceRec.lang = 'en-US';
  _voiceRec.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) _voiceBuf += (_voiceBuf ? ' ' : '') + e.results[i][0].transcript.trim();
    }
  };
  _voiceRec.onend = () => {
    _voiceRec = null;
    btn?.classList.remove('recording');
    if (_voiceBuf) {
      const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      _voiceNotes.push({ t, text: _voiceBuf });
      _voiceBuf = '';
      psVoiceRenderChips();
      if (typeof toast === 'function') toast('Note added — see the sheet\'s Notes tab', '🎙', 2400);
    }
  };
  _voiceRec.onerror = () => { /* onend handles cleanup */ };
  try {
    _voiceRec.start();
    btn?.classList.add('recording');
  } catch (e) { _voiceRec = null; }
}

function _voiceStop() {
  if (_voiceRec) { try { _voiceRec.stop(); } catch (e) {} }
}

(function () {
  const btn = document.getElementById('voice-btn');
  if (!btn) return;
  btn.addEventListener('pointerdown', e => { e.stopPropagation(); _voiceStart(); });
  btn.addEventListener('pointerup', _voiceStop);
  btn.addEventListener('pointercancel', _voiceStop);
  btn.addEventListener('pointerleave', _voiceStop);
})();

// ── Detents ───────────────────────────────────────────────────
function psSetDetent(d) {
  _psDetent = d;
  const sheet = document.getElementById('param-sheet');
  if (!sheet) return;
  sheet.classList.remove('peek', 'half', 'full', 'dragging');
  sheet.classList.add(d);
  sheet.style.height = '';
}

function psSetTab(name) {
  document.querySelectorAll('#ps-tabs .ps-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('#param-sheet .ps-pane').forEach(p => p.classList.toggle('on', p.id === 'ps-pane-' + name));
  if (name === 'notes') {
    const ta = document.getElementById('ps-notes');
    const src = document.getElementById('f-notes');
    if (ta && src) ta.value = src.value;
  }
  if (name === 'sizing') _psSyncSizingFromRegistry();
}

// ── Drag: live height while dragging, snap to the nearest detent ──
(function () {
  const handle = document.getElementById('ps-handle');
  const sheet = document.getElementById('param-sheet');
  if (!handle || !sheet) return;
  let drag = null;
  handle.addEventListener('pointerdown', e => {
    drag = { y0: e.clientY, h0: sheet.getBoundingClientRect().height, moved: false };
    sheet.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = drag.y0 - e.clientY;
    if (Math.abs(dy) > 6) drag.moved = true;
    const parentH = sheet.parentElement.getBoundingClientRect().height;
    const h = Math.max(48, Math.min(parentH * 0.86, drag.h0 + dy));
    sheet.style.height = h + 'px';
  });
  const end = e => {
    if (!drag) return;
    const wasTap = !drag.moved;
    drag = null;
    if (wasTap) {
      // Tap on the handle bar toggles peek ⇄ half. Tab buttons never reach
      // here — they stopPropagation on pointerdown (dock discipline).
      psSetDetent(_psDetent === 'peek' ? 'half' : 'peek');
      return;
    }
    const parentH = sheet.parentElement.getBoundingClientRect().height;
    const h = sheet.getBoundingClientRect().height;
    const targets = [['peek', 48], ['half', parentH * 0.38], ['full', parentH * 0.86]];
    targets.sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h));
    psSetDetent(targets[0][0]);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);

  // Tab tap: switch pane and make sure the sheet is at least half open
  document.getElementById('ps-tabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.ps-tab');
    if (!tab) return;
    psSetTab(tab.dataset.tab);
    if (_psDetent === 'peek') psSetDetent('half');
  });

  // Touching the canvas dismisses the sheet to peek — the "point at the
  // drawing" moment must never be blocked
  document.getElementById('sketch-canvas')?.addEventListener('pointerdown', () => {
    if (_psDetent !== 'peek') psSetDetent('peek');
  });
})();

// ── Chip selection (delegated across all panes) ───────────────
document.querySelectorAll('.ps-pane').forEach(pane => {
  pane.addEventListener('click', e => {
    const chip = e.target.closest('.ps-chip');
    if (!chip) return;
    const wrap = chip.parentElement;
    // First tap in a group with a hollow suggestion resolves it (2.5)
    wrap.querySelectorAll('.ps-chip.suggested').forEach(c => c.classList.remove('suggested'));
    if (!wrap.dataset.multi) {
      wrap.querySelectorAll('.ps-chip.on').forEach(c => { if (c !== chip) c.classList.remove('on'); });
    }
    chip.classList.toggle('on');
    psWrite();
  });
});

function _psSel(group) {
  const el = document.querySelector('#ps-' + group + ' .ps-chip.on');
  return el ? el.dataset.v : '';
}
function _psSelAll(group) {
  return [...document.querySelectorAll('#ps-' + group + ' .ps-chip.on')].map(c => c.dataset.v);
}

// ── Band steppers ─────────────────────────────────────────────
const _psBand = { width: 0, thick: 0 };
function psStep(dim, delta) {
  _psBand[dim] = Math.max(0, Math.round((_psBand[dim] + delta) * 100) / 100);
  const el = document.getElementById('ps-' + dim + '-val');
  if (el) el.textContent = _psBand[dim] ? _psBand[dim] + ' mm' : '—';
  psWrite();
}

// ── Serialize sheet state → hidden Step-1 fields + peek summary ──
function psWrite() {
  // Order For (Individual/Couple) → shows/hides the 2nd ring size wheel +
  // 2nd stamping input, and gates whether they submit at all.
  const orderFor = _psSel('orderfor') || 'individual';
  const isCouple = orderFor === 'couple';
  if (typeof intakeSetOrderFor === 'function') intakeSetOrderFor(orderFor);
  const ring2Wrap = document.getElementById('ps-ring2-wrap');
  if (ring2Wrap) ring2Wrap.style.display = isCouple ? '' : 'none';
  const stamping2Wrap = document.getElementById('ps-stamping2-wrap');
  if (stamping2Wrap) stamping2Wrap.style.display = isCouple ? '' : 'none';
  const ringsizeLabel = document.getElementById('ps-ringsize-label');
  if (ringsizeLabel) ringsizeLabel.textContent = 'Ring Size (US)' + (isCouple ? ' — Ring 1' : '');

  // Sizing → f-sizing ("sz 6.5 · 4mm wide · 1.5mm thick")
  const sz = _psSel('ringsize');
  const parts = [];
  if (sz) parts.push('sz ' + sz);
  if (_psBand.width) parts.push(_psBand.width + 'mm wide');
  if (_psBand.thick) parts.push(_psBand.thick + 'mm thick');
  const sizing = document.getElementById('f-sizing');
  if (sizing && (parts.length || sizing.dataset.auto === '2')) {
    sizing.value = parts.join(' · ');
    sizing.dataset.auto = '2'; // sheet-owned — registry prefill leaves it alone
  }
  // 2nd ring size (Couple only) → f-ringsize2
  const sz2 = isCouple ? _psSel('ringsize2') : '';
  const ringsize2El = document.getElementById('f-ringsize2');
  if (ringsize2El) ringsize2El.value = sz2 ? ('sz ' + sz2) : '';
  // Ring stamping(s) → f-stamping / f-stamping2 (2nd only when Couple)
  const stampEl = document.getElementById('ps-stamping');
  const fStamp  = document.getElementById('f-stamping');
  if (fStamp) fStamp.value = stampEl ? stampEl.value.trim() : '';
  const stamp2El = document.getElementById('ps-stamping2');
  const fStamp2  = document.getElementById('f-stamping2');
  if (fStamp2) fStamp2.value = (isCouple && stamp2El) ? stamp2El.value.trim() : '';
  // Peek summary — the one-line echo ("sz 6.5 · 4mm wide")
  const sumParts = [];
  if (sz) sumParts.push('sz ' + sz);
  if (_psBand.width) sumParts.push(_psBand.width + 'mm wide');
  const sum = document.getElementById('ps-summary');
  if (sum) sum.textContent = sumParts.length ? sumParts.join(' · ') : 'tap a tab to set sizing';
}

// Sizing wheel pre-select from the ring registry (client, or recipient in
// gift mode) — only when the user hasn't picked a size in the sheet yet
function _psSyncSizingFromRegistry() {
  if (_psSel('ringsize')) return;
  try {
    const src = (typeof _occGift !== 'undefined' && _occGift && _regEntries.recipient.length)
      ? _regEntries.recipient : _regEntries.client;
    const ring = src.find(e => e.finger === 'ring') || src[0];
    if (!ring) return;
    const chip = document.querySelector('#ps-ringsize .ps-chip[data-v="' + ring.size + '"]');
    if (chip) {
      chip.classList.add('suggested');
      const wheel = document.getElementById('ps-ringsize');
      if (wheel) wheel.scrollLeft = chip.offsetLeft - wheel.clientWidth / 2 + chip.offsetWidth / 2;
    }
  } catch (e) {}
}

// ── Reset for the next intake — called from intakeReset() ─────
function psReset() {
  _psBand.width = 0; _psBand.thick = 0;
  _refPhotos = [];
  psRenderPanes();
  psSetTab('sizing');
  psSetDetent('peek');
  const sum = document.getElementById('ps-summary');
  if (sum) sum.textContent = 'tap a tab to set sizing';
}

// ── Init ──────────────────────────────────────────────────────
psRenderPanes();
// Notes pane ↔ f-notes two-way sync + full detent for the keyboard
document.getElementById('ps-pane-notes')?.addEventListener('input', e => {
  if (e.target.id !== 'ps-notes') return;
  const dst = document.getElementById('f-notes');
  if (dst) dst.value = e.target.value;
});
// Stamping inputs (typed, not tapped) → re-run psWrite() so f-stamping /
// f-stamping2 stay in sync as the user types.
document.getElementById('ps-pane-sizing')?.addEventListener('input', e => {
  if (e.target.id === 'ps-stamping' || e.target.id === 'ps-stamping2') psWrite();
});
document.getElementById('ps-pane-notes')?.addEventListener('focusin', e => {
  if (e.target.id === 'ps-notes') psSetDetent('full');
});
