// ════════════════════════════════════════════
//  BOTTOM PARAMETER SHEET  —  js/intake-sheet.js
//  Loaded ONLY by intake.html (after intake-profiles.js, before
//  intake.js). Brief 2.1 (sheet) + 2.2 (structured stones) + 2.5
//  (smart defaults from the loaded client profile).
//
//  The sheet is the Custom Design parameter surface on Step 2 — it
//  writes into the hidden Step-1 fields (f-materials / f-sizing /
//  f-gemstones / f-piece-type / f-finish checkboxes) so intakeSubmit()
//  and the Notion pipeline never change. Repair/Resize/Square layouts
//  are untouched (they never reach Step 2).
// ════════════════════════════════════════════

// ── Chip config ───────────────────────────────────────────────
const _PS_GROUPS = {
  piece:   { label: 'Piece Type', multi: false, values: ['Ring', 'Ear Cuff', 'Necklace', 'Bracelet', 'Earrings', 'Pendant', 'Other'] },
  tone:    { label: 'Metal', multi: false, values: ['Yellow', 'White', 'Rose', 'Platinum', 'Sterling'] },
  karat:   { label: 'Karat', multi: false, values: ['10k', '14k', '18k'] },
  finish:  { label: 'Texture / Finish', multi: true, values: ['Polished', 'Hammered', 'Matte', 'Oxidized'] },
  stype:   { label: 'Stone', multi: false, values: ['Moissanite', 'Diamond', 'Sapphire', 'Ruby', 'Emerald', 'Opal', 'Turquoise', 'Pearl', 'Garnet', 'Amethyst'] },
  origin:  { label: 'Origin', multi: false, values: ['Natural', 'Lab', 'Client-supplied'] },
  cut:     { label: 'Cut', multi: false, values: ['Round', 'Oval', 'Pear', 'Emerald', 'Marquise', 'Cab'] },
  carat:   { label: 'Size (ct)', multi: false, values: ['0.25', '0.5', '0.75', '1', '1.5', '2', '3'] },
  setting: { label: 'Setting', multi: false, values: ['Bezel', 'Prong ×4', 'Prong ×6', 'Flush', 'Channel', 'Pavé'] },
  role:    { label: 'Role', multi: false, values: ['Center', 'Accent'] },
};

// Sheet finish label → existing #f-finish checkbox value
const _PS_FINISH_MAP = { 'Polished': 'Polished', 'Hammered': 'Hammered/Textured', 'Matte': 'Matte', 'Oxidized': 'Oxidized' };
// Profile metal tone → sheet tone chip (2.5)
const _PS_TONE_FROM_PROFILE = { 'Yellow': 'Yellow', 'White': 'White', 'Rose': 'Rose', 'Silver-only': 'Sterling' };

let _psStones = [];        // committed stones (serialized to the order + f-gemstones)
let _psDetent = 'peek';
let _psSuggestedDone = false; // smart defaults are applied once per intake

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
function _psChipsHtml(group) {
  const cfg = _PS_GROUPS[group];
  return '<div class="ps-label">' + cfg.label + '</div>'
    + '<div class="ps-chips" id="ps-' + group + '" ' + (cfg.multi ? 'data-multi="1"' : '') + '>'
    + cfg.values.map(v => '<button type="button" class="ps-chip" data-v="' + v + '">' + v + '</button>').join('')
    + '</div>';
}

function psRenderPanes() {
  const metal = document.getElementById('ps-pane-metal');
  if (metal) {
    metal.innerHTML = _psChipsHtml('piece') + _psChipsHtml('tone') + _psChipsHtml('karat') + _psChipsHtml('finish')
      + '<div class="ps-sens-warn" id="ps-sens-warn"></div>';
  }
  const stone = document.getElementById('ps-pane-stone');
  if (stone) {
    stone.innerHTML =
      '<div class="ps-stone-list" id="ps-stone-list"></div>'
      + _psChipsHtml('stype')
      + '<input type="text" class="ps-input" id="ps-stone-other" placeholder="Other stone…" style="width:100%;margin-top:2px;">'
      + _psChipsHtml('origin') + _psChipsHtml('cut') + _psChipsHtml('carat')
      + '<input type="text" class="ps-input" id="ps-carat-other" placeholder="Custom size — e.g. 1.2ct or 6mm" inputmode="decimal" style="width:100%;margin-top:2px;">'
      + _psChipsHtml('setting') + _psChipsHtml('role')
      + '<div style="margin-top:12px;"><button type="button" class="btn btn-gold" onclick="psAddStone()">＋ Add stone</button></div>';
  }
  const sizing = document.getElementById('ps-pane-sizing');
  if (sizing) {
    let wheel = '';
    for (let q = 4; q <= 64; q++) {
      const v = q / 4;
      wheel += '<button type="button" class="ps-chip" data-v="' + v + '">' + String(v).replace(/\.?0+$/, '') + '</button>';
    }
    sizing.innerHTML =
      '<div class="ps-label">Ring Size (US)</div>'
      + '<div class="ps-wheel ps-chips" id="ps-ringsize">' + wheel + '</div>'
      + '<div class="ps-label">Band</div>'
      + '<div>'
      + '<span class="ps-step">Width <button type="button" onclick="psStep(\'width\',-0.5)">−</button><span class="ps-step-val" id="ps-width-val">—</span><button type="button" onclick="psStep(\'width\',0.5)">＋</button></span>'
      + '<span class="ps-step">Thickness <button type="button" onclick="psStep(\'thick\',-0.25)">−</button><span class="ps-step-val" id="ps-thick-val">—</span><button type="button" onclick="psStep(\'thick\',0.25)">＋</button></span>'
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
  if (d !== 'peek' && !_psSuggestedDone) psApplySmartDefaults(); // 2.5: pure read at sheet-open
}

function psSetTab(name) {
  document.querySelectorAll('#ps-tabs .ps-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('.ps-pane').forEach(p => p.classList.toggle('on', p.id === 'ps-pane-' + name));
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

// ── Stones (2.2) ──────────────────────────────────────────────
function psAddStone() {
  const type = _psSel('stype') || document.getElementById('ps-stone-other')?.value.trim();
  if (!type) { if (typeof toast === 'function') toast('Pick a stone type first', '⚠'); return; }
  const caratCustom = document.getElementById('ps-carat-other')?.value.trim();
  const stone = {
    type,
    origin:  _psSel('origin'),
    cut:     _psSel('cut'),
    size:    caratCustom || (_psSel('carat') ? _psSel('carat') + 'ct' : ''),
    setting: _psSel('setting'),
    role:    _psSel('role') || (_psStones.length ? 'Accent' : 'Center'),
  };
  _psStones.push(stone);
  // Clear the builder for the next stone
  ['stype', 'origin', 'cut', 'carat', 'setting', 'role'].forEach(g =>
    document.querySelectorAll('#ps-' + g + ' .ps-chip.on').forEach(c => c.classList.remove('on')));
  const other = document.getElementById('ps-stone-other'); if (other) other.value = '';
  const co = document.getElementById('ps-carat-other'); if (co) co.value = '';
  psRenderStoneList();
  psWrite();
}

function psRemoveStone(i) {
  _psStones.splice(i, 1);
  psRenderStoneList();
  psWrite();
}

function _psStoneLine(s) {
  const bits = [s.size, s.cut ? s.cut.toLowerCase() : '', s.type].filter(Boolean).join(' ');
  let line = (s.role || 'Stone') + ': ' + bits;
  if (s.origin === 'Client-supplied') line += ' (CLIENT-SUPPLIED — heirloom: photograph at intake)';
  else if (s.origin) line += ' (' + s.origin.toLowerCase() + ')';
  if (s.setting) line += ', ' + s.setting.toLowerCase() + ' set';
  return line;
}

function psRenderStoneList() {
  const list = document.getElementById('ps-stone-list');
  if (!list) return;
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  list.innerHTML = _psStones.map((s, i) =>
    '<div class="ps-stone-item"><span>💎 ' + esc(_psStoneLine(s)) + '</span>'
    + '<button type="button" class="ps-stone-x" onclick="psRemoveStone(' + i + ')" aria-label="Remove stone">✕</button></div>'
  ).join('');
}

// ── Serialize sheet state → hidden Step-1 fields + peek summary ──
function _psMetalText() {
  const tone = _psSel('tone');
  const karat = _psSel('karat');
  if (!tone) return '';
  if (tone === 'Sterling') return 'Sterling Silver';
  if (tone === 'Platinum') return 'Platinum';
  return (karat ? karat + ' ' : '') + tone + ' Gold';
}

function psWrite() {
  // Metal + finish → f-materials (+ mirror the finish chips onto the
  // existing #f-finish checkboxes that intakeSubmit() reads)
  const metal = _psMetalText();
  const finishes = _psSelAll('finish');
  const mat = document.getElementById('f-materials');
  if (mat) mat.value = [metal, finishes.join(', ')].filter(Boolean).join(' · ');
  document.querySelectorAll('#f-finish input').forEach(c => {
    c.checked = finishes.some(f => _PS_FINISH_MAP[f] === c.value);
  });
  // Piece type → hidden select
  const piece = _psSel('piece');
  const pieceSel = document.getElementById('f-piece-type');
  if (pieceSel && piece) pieceSel.value = piece;
  // Stones → f-gemstones (human-readable, newline per stone)
  const gem = document.getElementById('f-gemstones');
  if (gem) gem.value = _psStones.map(_psStoneLine).join('\n');
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
  // Peek summary — the one-line echo ("14k Rose · 1ct oval moissanite · sz 6.5")
  const sumParts = [];
  if (metal) sumParts.push(metal.replace(' Gold', ''));
  if (_psStones[0]) {
    const s = _psStones[0];
    sumParts.push([s.size, s.cut ? s.cut.toLowerCase() : '', s.type.toLowerCase()].filter(Boolean).join(' '));
  }
  if (sz) sumParts.push('sz ' + sz);
  const sum = document.getElementById('ps-summary');
  if (sum) sum.textContent = sumParts.length ? sumParts.join(' · ') : 'tap a tab to set metal · stone · sizing';
  // Sensitivity conflicts warn inline here (2.5 ties back to 1.3)
  if (typeof intakeSensChanged === 'function') intakeSensChanged();
}

// ── Smart defaults from the loaded profile (2.5) ──────────────
// Hollow "suggested" chips only — never solid, never guessed without a
// loaded profile. First tap in the group solidifies or replaces.
function psApplySmartDefaults() {
  _psSuggestedDone = true;
  if (typeof _profLoadedId === 'undefined' || !_profLoadedId) return;
  let p = null;
  try { p = _custLoad().profiles.find(x => x.id === _profLoadedId); } catch (e) {}
  if (!p || !p.styleProfile) return;
  const tone = _PS_TONE_FROM_PROFILE[p.styleProfile.tone];
  if (tone && !_psSel('tone')) {
    const chip = document.querySelector('#ps-tone .ps-chip[data-v="' + tone + '"]');
    if (chip) chip.classList.add('suggested');
  }
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
  _psStones = [];
  _psBand.width = 0; _psBand.thick = 0;
  _psSuggestedDone = false;
  _refPhotos = [];
  psRenderPanes();
  psRenderStoneList();
  psSetTab('metal');
  psSetDetent('peek');
  const sum = document.getElementById('ps-summary');
  if (sum) sum.textContent = 'tap a tab to set metal · stone · sizing';
}

// ── Init ──────────────────────────────────────────────────────
psRenderPanes();
// Notes pane ↔ f-notes two-way sync + full detent for the keyboard
document.getElementById('ps-pane-notes')?.addEventListener('input', e => {
  if (e.target.id !== 'ps-notes') return;
  const dst = document.getElementById('f-notes');
  if (dst) dst.value = e.target.value;
});
document.getElementById('ps-pane-notes')?.addEventListener('focusin', e => {
  if (e.target.id === 'ps-notes') psSetDetent('full');
});
