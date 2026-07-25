// ════════════════════════════════════════════
//  INTAKE · AI NOTE TAKER  —  js/intake-ai-notes.js
//  A Fireflies-style meeting recorder for the in-person consult that
//  happens while an order is being written up. Records the conversation,
//  transcribes it live, then hands the transcript to Claude for a
//  structured recap: overview, key points, action items, and — the part
//  that matters here — the order details the client actually said out
//  loud, offered back as one-tap fills for the intake form.
//
//  Three views behind one overlay (#ai-notes):
//    record   — live transcript, speaker toggle, optional audio capture
//    summary  — AI recap + "Detected order details" + Ask-the-transcript
//    library  — every past consult, searchable, with audio playback
//
//  AUTO MODE (default on) is how this is meant to be used day to day: the
//  panel stays shut and the consult records itself as a safety net. It
//  arms on page load and starts on the first touch of the intake form —
//  not on load — for two reasons: an iPad sitting open at a market
//  shouldn't be recording an empty booth, and Safari only lets
//  getUserMedia/SpeechRecognition start from a user gesture, which that
//  first tap provides. It stops inside intakeSubmit() when the order is
//  saved, and the recap is folded into the order's notes on the way
//  through. At that moment the recap also gets what was actually typed
//  into the form, so it can flag things the client said that never made
//  it onto the order — the "what did I miss" pass (see _ainMissed).
//  Edits opened via ?editId= never auto-start: those happen at the bench,
//  not in front of a client. The ● chip in the header is always visible
//  while recording — auto mode is never silent.
//
//  Transcription uses the Web Speech API (window.SpeechRecognition /
//  webkitSpeechRecognition) — the same engine js/intake-sheet.js already
//  relies on for the sketch dock's mic. It stops itself after a pause, so
//  _ainRestart() brings it straight back while the session is still live;
//  a consult runs 20+ minutes and would otherwise die at the first lull.
//  Devices without it (older iOS Safari, Firefox) still get the whole AI
//  half — they type or paste the transcript instead, and every downstream
//  feature works identically.
//
//  Audio capture is a separate, opt-in MediaRecorder track: on some
//  browsers a second mic consumer fights with speech recognition, so it
//  defaults OFF and any failure to start is non-fatal — the transcript is
//  the product, the recording is a convenience for checking a number
//  later. Only the newest few recordings keep their audio (AIN_MAX_AUDIO)
//  so the store can't grow without bound.
//
//  Sessions persist in IndexedDB via js/storage.js under 'intake-ai-notes'
//  — never localStorage; an audio Blob would blow its quota instantly.
//  Depends on: js/storage.js, js/order-widgets.js (setNameFields), and
//  js/intake.js (toast, fmtPhoneInput, intakeApplyTypeLayout).
// ════════════════════════════════════════════

const AIN_STORE_KEY   = 'intake-ai-notes';
const AIN_MAX_SESSIONS = 40;   // pruned oldest-first
const AIN_MAX_AUDIO    = 8;    // newest N sessions keep their audio blob
const AIN_MODEL        = 'claude-sonnet-5';

let _ainSessions  = [];        // newest first — mirrors the IndexedDB record
let _ainCur       = null;      // session being recorded or viewed
let _ainRec       = null;      // live SpeechRecognition instance
let _ainRecording = false;     // user intent: is this consult still running?
let _ainStopping  = false;     // guards the restart loop during a real stop
let _ainPaused    = false;
let _ainSpeaker   = 'client';
let _ainStartedAt = 0;         // performance clock for the current run
let _ainElapsed   = 0;         // ms banked across pause/resume cycles
let _ainTick      = null;
let _ainInterim   = '';        // in-flight (non-final) speech, shown greyed
let _ainMedia = null, _ainChunks = [], _ainStream = null;
let _ainAudioUrl  = null;      // object URL for the summary view's <audio>
let _ainView      = 'record';
let _ainBusy      = false;     // an AI call is in flight
let _ainQuery     = '';        // library search box
let _ainApplied   = {};        // field key → true once filled into the form
let _ainArmed     = false;     // auto mode: waiting for the first form touch
let _ainMissed    = [];        // things said in the consult but not on the order

const _ainEsc = t => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function _ainToast(msg, icon, dur) {
  if (typeof toast === 'function') toast(msg, icon || '', dur || 3000);
}

function _ainSpeechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// ── Session store ─────────────────────────────────────────────
// One array under one key: a consult list is short and always read whole,
// so a per-session key would only add round-trips.
async function ainLoadSessions() {
  try {
    const saved = await stsStoreGet(AIN_STORE_KEY);
    _ainSessions = Array.isArray(saved) ? saved : [];
  } catch (e) {
    _ainSessions = [];
  }
  return _ainSessions;
}

async function _ainPersist() {
  // Prune before writing, not after: the pruned copy is what should hit disk.
  _ainSessions.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  if (_ainSessions.length > AIN_MAX_SESSIONS) _ainSessions.length = AIN_MAX_SESSIONS;
  _ainSessions.forEach((s, i) => { if (i >= AIN_MAX_AUDIO && s.audio) { s.audio = null; s.audioDropped = true; } });
  try {
    await stsStoreSet(AIN_STORE_KEY, _ainSessions);
  } catch (e) {
    console.warn('AI notes: save failed', e);
    _ainToast('Couldn\'t save this consult locally', '⚠');
  }
}

function _ainUpsert(session) {
  if (!session) return;
  const i = _ainSessions.findIndex(s => s.id === session.id);
  if (i >= 0) _ainSessions[i] = session; else _ainSessions.unshift(session);
}

async function ainDeleteSession(id) {
  const s = _ainSessions.find(x => x.id === id);
  if (!s) return;
  if (!confirm('Delete "' + (s.title || 'this consult') + '"? This can\'t be undone.')) return;
  _ainSessions = _ainSessions.filter(x => x.id !== id);
  if (_ainCur && _ainCur.id === id) _ainCur = null;
  await _ainPersist();
  ainRender();
}

// ── Overlay open/close ────────────────────────────────────────
function ainOpen() {
  const el = document.getElementById('ai-notes');
  if (!el) return;
  el.classList.remove('hidden');
  // A finished consult opens on its recap; otherwise straight to the recorder.
  _ainView = (_ainCur && _ainCur.summary) ? 'summary' : 'record';
  ainLoadSessions().then(() => ainRender());
  ainRender();
}

function ainClose() {
  // Closing the panel must not silently kill a running consult — the panel
  // is just a window onto it, and the header chip keeps showing it's live.
  const el = document.getElementById('ai-notes');
  if (el) el.classList.add('hidden');
  _ainRevokeAudioUrl();
}

function ainSetView(v) {
  _ainView = v;
  ainRender();
}

// ── Header chip — a recording consult stays visible from any step ──
function ainUpdateChip() {
  const chip = document.getElementById('ain-chip');
  if (!chip) return;
  if (_ainRecording) {
    chip.classList.add('on');
    chip.innerHTML = (_ainPaused ? '❚❚' : '●') + ' <span>' + _ainClock(_ainNow()) + '</span>';
  } else {
    chip.classList.remove('on');
    // The label collapses to the mic alone on narrow screens (see the
    // .ain-chip-lbl media query) — the top bar is already tight on an iPad.
    chip.innerHTML = '🎙<span class="ain-chip-lbl">AI Notes</span>';
  }
}

function _ainNow() {
  return _ainElapsed + ((_ainRecording && !_ainPaused && _ainStartedAt) ? (performance.now() - _ainStartedAt) : 0);
}

function _ainClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60), sec = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
}

function _ainStartTick() {
  clearInterval(_ainTick);
  _ainTick = setInterval(() => {
    ainUpdateChip();
    const t = document.getElementById('ain-timer');
    if (t) t.textContent = _ainClock(_ainNow());
  }, 500);
}

// ── Auto mode ─────────────────────────────────────────────────
// Default on. Two prefs, both sticky: the toggle itself, and a separate
// "the browser refused the mic" latch so a denied permission doesn't
// re-prompt on every single order.
function _ainAutoEnabled() {
  try { return localStorage.getItem('sts-ain-auto') !== '0'; } catch (e) { return true; }
}

function _ainAutoDenied() {
  try { return localStorage.getItem('sts-ain-auto-denied') === '1'; } catch (e) { return false; }
}

function _ainSetAutoDenied(v) {
  try { localStorage.setItem('sts-ain-auto-denied', v ? '1' : '0'); } catch (e) {}
}

function ainToggleAutoPref() {
  const on = !_ainAutoEnabled();
  try { localStorage.setItem('sts-ain-auto', on ? '1' : '0'); } catch (e) {}
  if (on) {
    // Turning it back on clears the refusal latch — the user is explicitly
    // asking to try again, so let the browser prompt once more.
    _ainSetAutoDenied(false);
    ainArmAutoStart();
  } else {
    _ainArmed = false;
  }
  ainRender();
}

// Arms the one-shot trigger. Re-armed after every save (via ainReset) so
// the next customer records without anyone remembering to press anything.
function ainArmAutoStart() {
  if (_ainArmed || !_ainAutoEnabled() || _ainAutoDenied()) return;
  const main = document.querySelector('main');
  if (!main) return;
  _ainArmed = true;
  // Capture phase + a single handler for both event types: whichever the
  // device fires first (tap or hardware keyboard) is "the order started".
  const fire = () => {
    main.removeEventListener('pointerdown', fire, true);
    main.removeEventListener('keydown', fire, true);
    _ainArmed = false;
    _ainAutoStart();
  };
  main.addEventListener('pointerdown', fire, true);
  main.addEventListener('keydown', fire, true);
}

function _ainAutoStart() {
  if (_ainRecording || !_ainAutoEnabled() || _ainAutoDenied()) return;
  if (!_ainSpeechSupported()) return;          // nothing to auto-start
  // An edit loaded via ?editId= is bench work, not a consult in front of a
  // client — never start the mic for one. (_editingOrder lives in intake.js.)
  if (typeof _editingOrder !== 'undefined' && _editingOrder) return;
  // Don't clobber a consult the user already recorded and hasn't saved.
  if (_ainCur && _ainCur.segments.length && !_ainCur.summary) return;
  ainStartRecording({ auto: true });
}

// ── Recording ─────────────────────────────────────────────────
function ainToggleRecord() {
  if (_ainRecording) ainStopRecording(); else ainStartRecording();
}

async function ainStartRecording(opts) {
  if (_ainRecording) return;
  const auto = !!(opts && opts.auto);
  // A new run continues the open session when one is already going (resume
  // after a stop mid-consult), otherwise starts a fresh one.
  if (!_ainCur || _ainCur.summary) {
    _ainCur = {
      id: 'ain' + Date.now(),
      startedAt: Date.now(),
      title: '',
      customer: (typeof getFullName === 'function' ? getFullName() : '') || '',
      segments: [],
      summary: null,
      asks: [],
      audio: null,
      audioType: '',
      durationMs: 0,
      auto: auto,
      orderId: null,
    };
    _ainElapsed = 0;
    _ainApplied = {};
    _ainMissed = [];
  }
  _ainRecording = true;
  _ainStopping = false;
  _ainPaused = false;
  _ainStartedAt = performance.now();
  _ainStartTick();

  if (_ainAudioEnabled()) await _ainStartAudio();
  _ainStartRecognition();
  // Auto mode is never silent: say it out loud once, then let the pulsing
  // header chip carry it. Anything louder would be in the way all day.
  if (auto) _ainToast('Recording this consult — tap the chip to view', '🎙', 3200);
  ainRender();
}

function _ainStartRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || _ainRec || _ainPaused || !_ainRecording) return;
  const rec = new SR();
  _ainRec = rec;
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = (e.results[i][0].transcript || '').trim();
      if (!text) continue;
      if (e.results[i].isFinal) _ainPushSegment(text);
      else interim += (interim ? ' ' : '') + text;
    }
    _ainInterim = interim;
    _ainRenderTranscript();
  };
  rec.onerror = ev => {
    // 'no-speech' and 'aborted' are ordinary in a long consult; only a
    // permission failure is worth interrupting the user over.
    if (ev && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed')) {
      // Latch the refusal so auto mode stops re-prompting on every order.
      // Flipping the Auto chip back on clears it and tries once more.
      _ainSetAutoDenied(true);
      _ainToast('Mic blocked — auto-record is off until you allow it', '⚠', 5000);
      ainStopRecording();
    }
  };
  rec.onend = () => {
    _ainRec = null;
    _ainInterim = '';
    // Recognition self-terminates after a lull. While the consult is still
    // running that's not an ending — restart it and keep listening.
    if (_ainRecording && !_ainStopping && !_ainPaused) _ainRestart();
    else _ainRenderTranscript();
  };
  try {
    rec.start();
  } catch (e) {
    _ainRec = null;
  }
}

function _ainRestart() {
  setTimeout(() => {
    if (_ainRecording && !_ainStopping && !_ainPaused && !_ainRec) _ainStartRecognition();
  }, 250);
}

function _ainPushSegment(text) {
  if (!_ainCur) return;
  const last = _ainCur.segments[_ainCur.segments.length - 1];
  // Recognition restarts mid-sentence constantly; merging same-speaker runs
  // that land within a few seconds keeps the transcript readable instead of
  // shredding one thought into six one-line bubbles.
  if (last && last.speaker === _ainSpeaker && (_ainNow() - last.endMs) < 4000) {
    last.text += ' ' + text;
    last.endMs = _ainNow();
  } else {
    _ainCur.segments.push({ ms: _ainNow(), endMs: _ainNow(), speaker: _ainSpeaker, text: text });
  }
}

function ainTogglePause() {
  if (!_ainRecording) return;
  _ainPaused = !_ainPaused;
  if (_ainPaused) {
    _ainElapsed = _ainNow();
    _ainStartedAt = 0;
    _ainStopRecognition();
    if (_ainMedia && _ainMedia.state === 'recording') { try { _ainMedia.pause(); } catch (e) {} }
  } else {
    _ainStartedAt = performance.now();
    _ainStopping = false;
    if (_ainMedia && _ainMedia.state === 'paused') { try { _ainMedia.resume(); } catch (e) {} }
    _ainStartRecognition();
  }
  ainRender();
}

// _ainStopping stays true until the next explicit start/resume — it's the
// flag the pending onend reads to know this ending was asked for rather
// than the engine timing out mid-consult.
function _ainStopRecognition() {
  _ainStopping = true;
  if (_ainRec) { try { _ainRec.stop(); } catch (e) {} }
  _ainRec = null;
  _ainInterim = '';
}

// opts.autoSummarize=false when the save path is going to drive the
// summary itself (it needs the form snapshot attached to that one call).
async function ainStopRecording(opts) {
  if (!_ainRecording) return;
  const autoSummarize = !(opts && opts.autoSummarize === false);
  _ainElapsed = _ainNow();
  _ainRecording = false;
  _ainPaused = false;
  _ainStartedAt = 0;
  clearInterval(_ainTick); _ainTick = null;
  _ainStopRecognition();
  await _ainStopAudio();
  // An empty run (mic tapped by accident, nothing said) is dropped rather
  // than filed — the library is for consults, not for stray taps.
  if (_ainCur && _ainCur.segments.length) {
    _ainCur.durationMs = _ainElapsed;
    if (!_ainCur.title) _ainCur.title = _ainDefaultTitle(_ainCur);
    _ainUpsert(_ainCur);
    await _ainPersist();
  }
  ainUpdateChip();
  ainRender();
  // Auto-summarize the moment the consult ends — that's the whole point of
  // the feature; making the user tap a second button just delays the recap.
  if (autoSummarize && _ainCur && _ainTranscriptText(_ainCur).length > 80) ainSummarize();
}

function _ainDefaultTitle(s) {
  const who = (s.customer || '').trim();
  const d = new Date(s.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (who ? who + ' — consult' : 'Consult') + ' · ' + d;
}

// ── Optional audio track ──────────────────────────────────────
function _ainAudioEnabled() {
  try { return localStorage.getItem('sts-ain-audio') === '1'; } catch (e) { return false; }
}

function ainToggleAudioPref() {
  const on = !_ainAudioEnabled();
  try { localStorage.setItem('sts-ain-audio', on ? '1' : '0'); } catch (e) {}
  if (on && _ainRecording && !_ainMedia) _ainStartAudio();
  if (!on && _ainMedia) _ainStopAudio();
  ainRender();
}

async function _ainStartAudio() {
  if (_ainMedia || !navigator.mediaDevices || !window.MediaRecorder) return;
  try {
    _ainStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _ainChunks = [];
    _ainMedia = new MediaRecorder(_ainStream);
    _ainMedia.ondataavailable = e => { if (e.data && e.data.size) _ainChunks.push(e.data); };
    _ainMedia.start(1000);
  } catch (e) {
    // Non-fatal by design — a denied or contended mic still leaves the
    // transcript running, which is the part the recap needs.
    console.warn('AI notes: audio capture unavailable', e);
    _ainMedia = null;
    _ainReleaseStream();
  }
}

function _ainReleaseStream() {
  if (_ainStream) { try { _ainStream.getTracks().forEach(t => t.stop()); } catch (e) {} }
  _ainStream = null;
}

function _ainStopAudio() {
  return new Promise(resolve => {
    if (!_ainMedia) { _ainReleaseStream(); resolve(); return; }
    const mr = _ainMedia;
    _ainMedia = null;
    mr.onstop = () => {
      try {
        if (_ainChunks.length && _ainCur) {
          const blob = new Blob(_ainChunks, { type: mr.mimeType || 'audio/webm' });
          _ainCur.audio = blob;
          _ainCur.audioType = blob.type;
        }
      } catch (e) { console.warn('AI notes: audio assembly failed', e); }
      _ainChunks = [];
      _ainReleaseStream();
      resolve();
    };
    try { mr.stop(); } catch (e) { _ainChunks = []; _ainReleaseStream(); resolve(); }
  });
}

function _ainRevokeAudioUrl() {
  if (_ainAudioUrl) { try { URL.revokeObjectURL(_ainAudioUrl); } catch (e) {} }
  _ainAudioUrl = null;
}

// ── Transcript helpers ────────────────────────────────────────
function _ainSpeakerLabel(sp) { return sp === 'studio' ? 'Studio' : 'Client'; }

function ainSetSpeaker(sp) {
  _ainSpeaker = sp;
  ainRender();
}

function _ainTranscriptText(s) {
  if (!s) return '';
  return (s.segments || [])
    .map(seg => '[' + _ainClock(seg.ms) + '] ' + _ainSpeakerLabel(seg.speaker) + ': ' + seg.text)
    .join('\n');
}

function ainEditSegment(i) {
  if (!_ainCur || !_ainCur.segments[i]) return;
  const cur = _ainCur.segments[i].text;
  const next = prompt('Edit this line — fix a name, a stone, a number:', cur);
  if (next == null) return;
  const v = next.trim();
  if (v) _ainCur.segments[i].text = v;
  else _ainCur.segments.splice(i, 1);
  _ainRenderTranscript();
  if (!_ainRecording) { _ainUpsert(_ainCur); _ainPersist(); }
}

function ainFlipSegmentSpeaker(i) {
  if (!_ainCur || !_ainCur.segments[i]) return;
  _ainCur.segments[i].speaker = _ainCur.segments[i].speaker === 'client' ? 'studio' : 'client';
  _ainRenderTranscript();
  if (!_ainRecording) { _ainUpsert(_ainCur); _ainPersist(); }
}

// Manual entry — the fallback path on browsers with no speech recognition,
// and the repair path when someone wants to paste notes typed elsewhere.
function ainAddTypedLine() {
  const box = document.getElementById('ain-manual');
  if (!box) return;
  const v = box.value.trim();
  if (!v) return;
  if (!_ainCur) {
    _ainCur = {
      id: 'ain' + Date.now(), startedAt: Date.now(), title: '',
      customer: (typeof getFullName === 'function' ? getFullName() : '') || '',
      segments: [], summary: null, asks: [], audio: null, audioType: '', durationMs: 0,
    };
    _ainElapsed = 0;
    _ainApplied = {};
  }
  _ainCur.segments.push({ ms: _ainNow(), endMs: _ainNow(), speaker: _ainSpeaker, text: v });
  box.value = '';
  _ainRenderTranscript();
}

// ── Claude calls ──────────────────────────────────────────────
async function _ainClaude(payload) {
  const apiKey = (function () { try { return localStorage.getItem('sts-anthropic-key') || undefined; } catch (e) { return undefined; } })();
  const resp = await fetch('/api/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ apiKey, model: AIN_MODEL }, payload)),
  });
  if (!resp.ok) throw new Error('API error ' + resp.status);
  const data = await resp.json();
  if (data && data.error) throw new Error(data.error.message || 'API error');
  return ((data.content && data.content[0] && data.content[0].text) || '').trim();
}

function _ainParseJson(raw) {
  const cleaned = String(raw).replace(/```json\n?/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  // Models occasionally wrap the object in a sentence; take the outermost
  // brace pair rather than failing the whole recap over a stray preamble.
  const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(cleaned.slice(a, b + 1)); } catch (e) {} }
  throw new Error('Could not parse the AI response');
}

// The form snapshot is what makes this a safety net rather than just a
// recap: with the typed order in hand, the model can name the things the
// client said that never landed on it. Only the save path passes one.
const _AIN_SNAPSHOT_FIELDS = [
  ['Customer',        () => (typeof getFullName === 'function' ? getFullName() : '')],
  ['Email',           'f-email'], ['Phone', 'f-phone'],
  ['Order type',      'f-order-type'], ['Piece type', 'f-piece-type'],
  ['Order name',      'f-job-desc'], ['Description', 'f-description'],
  ['Materials',       'f-materials'], ['Stones', 'f-gemstones'],
  ['Sizing',          'f-sizing'], ['Inside stamping', 'f-stamping'],
  ['Deadline',        'f-deadline'], ['Take in', 'f-takein'],
  ['Pickup',          'f-pickup'], ['Repair details', 'f-repair-notes'],
  ['Current size',    'f-resize-from'], ['Desired size', 'f-resize-to'],
  ['Price',           'f-price'], ['Deposit', 'f-deposit'],
  ['Internal notes',  'f-notes'], ['Notes for customer', 'f-customer-notes'],
];

function _ainFormSnapshot() {
  const lines = [];
  _AIN_SNAPSHOT_FIELDS.forEach(([label, src]) => {
    const v = (typeof src === 'function') ? src() : ((document.getElementById(src) || {}).value || '');
    const t = String(v == null ? '' : v).trim();
    lines.push(label + ': ' + (t || '(blank)'));
  });
  return lines.join('\n');
}

function _ainSummaryPrompt(hasSnapshot) {
  const today = new Date().toISOString().slice(0, 10);
  const missedRule = hasSnapshot
    ? '\n- "missed": the safety-net check. Compare the transcript against the ORDER AS ENTERED below. '
      + 'List anything the client stated that is absent from the order, or where the order contradicts what was said '
      + '(a different size, metal, date, or price). One short line each, naming the field: '
      + '"Deadline — she said before Sept 1, order has no deadline". '
      + 'Only flag real, checkable gaps: never small talk, never a detail that IS on the order in different words, '
      + 'and never something the transcript merely implies. An empty array is the correct and common answer.'
    : '\n- "missed": return an empty array — no order was supplied to compare against.';
  return 'You are the note-taker for Stones Throw Studio, a custom jewelry shop in Austin, Texas. '
    + 'You are given the transcript of an in-person or phone consult between studio staff ("Studio") and a customer ("Client"). '
    + 'The transcript comes from live speech recognition, so it contains mishearings, missing punctuation, and no spelling of names — '
    + 'read for intent, and never invent a detail that was not said.\n'
    + 'Today is ' + today + '. Resolve relative dates ("in three weeks", "before the wedding in June") against it.\n\n'
    + 'Return ONLY a valid JSON object with these exact keys:\n'
    + '{"title":string,'
    + '"overview":string,'
    + '"key_points":string[],'
    + '"action_items":[{"text":string,"owner":"Studio"|"Client"}],'
    + '"fields":{"customer_name":string|null,"email":string|null,"phone":string|null,'
    + '"order_type":"order"|"repair"|"resize"|null,'
    + '"piece_type":"Ring"|"Ear Cuff"|"Necklace"|"Bracelet"|"Earrings"|"Pendant"|"Other"|null,'
    + '"job_desc":string|null,"description":string|null,"materials":string|null,"gemstones":string|null,'
    + '"ring_size":string|null,"stamping":string|null,"deadline":"YYYY-MM-DD"|null,'
    + '"pickup_location":"Bell Market"|"Mueller Market"|"Chaparral Crossing Market"|"Sunset Valley Farmer\'s Market"|"Austin Flea"|"Studio"|"To be Shipped"|null,'
    + '"repair_notes":string|null,"resize_from":string|null,"resize_to":string|null,'
    + '"budget":string|null,"sensitivities":string[]},'
    + '"missed":string[]}\n\n'
    + 'Guidance:\n'
    + '- "title": 3–7 words naming the customer and the piece, e.g. "Sarah — rose gold engagement ring".\n'
    + '- "overview": 2–4 sentences on what the customer wants and what was agreed.\n'
    + '- "key_points": the design and logistics decisions, one per line, specific (metal, stones, size, finish, budget, timing). Omit small talk.\n'
    + '- "action_items": only things someone must actually do after the conversation — quotes to send, stones to source, photos the client owes.\n'
    + '- "fields": ONLY values the transcript states. Use null for anything not said — a guess here silently corrupts an order.\n'
    + '- "order_type": "repair" for fixing existing jewelry, "resize" for ring sizing only, "order" for new custom work.\n'
    + '- "job_desc" is a short order name; "description" is a fuller sentence describing the piece.\n'
    + '- "budget": the number or range the client said, as text (e.g. "$1,200–1,500"). Never guess a price.\n'
    + '- "sensitivities": metal allergies or skin reactions mentioned (e.g. "nickel", "sterling turns skin green"). Empty array if none.'
    + missedRule + '\n'
    + 'Return ONLY the JSON object, no other text.';
}

// snapshot: the order as typed, supplied only by the save path so the
// model can run the "what did I miss" comparison. Absent for a manual
// Summarize/Re-summarize tap, which is a plain recap.
async function ainSummarize(snapshot) {
  if (!_ainCur || _ainBusy) return;
  const transcript = _ainTranscriptText(_ainCur);
  if (transcript.trim().length < 20) {
    _ainToast('Nothing recorded yet to summarize', '⚠');
    return;
  }
  _ainBusy = true;
  // Re-rendering into the summary view is right when the panel is open and
  // wrong at save time, where the user is looking at the Saved overlay.
  if (!snapshot) _ainView = 'summary';
  ainRender();
  try {
    const raw = await _ainClaude({
      max_tokens: 2000,
      system: _ainSummaryPrompt(!!snapshot),
      messages: [{ role: 'user', content: 'Consult transcript:\n\n' + transcript
        + (snapshot ? '\n\n─────\nORDER AS ENTERED:\n\n' + snapshot : '') }],
    });
    const p = _ainParseJson(raw);
    _ainCur.summary = {
      overview:     (p.overview || '').trim(),
      key_points:   Array.isArray(p.key_points) ? p.key_points.filter(Boolean) : [],
      action_items: (Array.isArray(p.action_items) ? p.action_items : [])
                      .filter(a => a && a.text)
                      .map(a => ({ text: String(a.text), owner: a.owner === 'Client' ? 'Client' : 'Studio', done: false })),
      fields:       (p.fields && typeof p.fields === 'object') ? p.fields : {},
      // Only a snapshot run can produce a real gap list. A later manual
      // Re-summarize has nothing to compare against, so it keeps the one
      // the save already found instead of blanking it.
      missed:       snapshot
                      ? (Array.isArray(p.missed) ? p.missed.filter(Boolean).map(String) : [])
                      : ((_ainCur.summary && _ainCur.summary.missed) || []),
    };
    _ainMissed = _ainCur.summary.missed;
    if (p.title) _ainCur.title = String(p.title).trim();
    if (!_ainCur.title) _ainCur.title = _ainDefaultTitle(_ainCur);
    if (!_ainCur.customer && _ainCur.summary.fields.customer_name) _ainCur.customer = _ainCur.summary.fields.customer_name;
    _ainUpsert(_ainCur);
    await _ainPersist();
    // At save time the Saved overlay is already talking; don't stack a toast
    // on top of it.
    if (!snapshot) _ainToast('Consult summarized', '✨');
  } catch (err) {
    console.warn('AI notes: summarize failed', err);
    if (!snapshot) _ainToast('Summary failed — ' + (err.message || 'try again'), '⚠', 4500);
  } finally {
    _ainBusy = false;
    ainRender();
  }
}

// Ask-the-transcript: answers come strictly from what was said, so an
// unanswerable question reads as "not discussed" instead of a plausible
// invention that would end up on a work order.
async function ainAsk() {
  const box = document.getElementById('ain-ask-input');
  if (!box || !_ainCur || _ainBusy) return;
  const q = box.value.trim();
  if (!q) return;
  box.value = '';
  _ainCur.asks = _ainCur.asks || [];
  _ainCur.asks.push({ q: q, a: null });
  _ainBusy = true;
  ainRender();
  try {
    const answer = await _ainClaude({
      max_tokens: 700,
      system: 'You answer questions about a single jewelry-consult transcript for Stones Throw Studio. '
        + 'Answer only from the transcript. If it does not say, reply exactly "Not discussed in this consult." '
        + 'Be brief — two or three sentences at most — and quote the relevant line when it helps.',
      messages: [{ role: 'user', content: 'Transcript:\n\n' + _ainTranscriptText(_ainCur) + '\n\nQuestion: ' + q }],
    });
    _ainCur.asks[_ainCur.asks.length - 1].a = answer || '(no answer)';
    _ainUpsert(_ainCur);
    await _ainPersist();
  } catch (err) {
    _ainCur.asks[_ainCur.asks.length - 1].a = '⚠ ' + (err.message || 'Request failed');
  } finally {
    _ainBusy = false;
    ainRender();
  }
}

// ── Save path (called from js/intake.js intakeSubmit) ─────────
// Stops a running consult and gets the recap in hand before the order
// object is built, so ainNotesTextForOrder() has something to contribute
// and the gap check can be shown on the Saved overlay.
//
// Hard-capped: someone standing at a market stall does not wait on an API
// call to close out an order. If the summary hasn't landed by AIN_SAVE_WAIT
// the save proceeds without it — the transcript is already filed, and the
// recap catches up in the library a few seconds later.
const AIN_SAVE_WAIT = 12000;

async function ainFinalizeForSave() {
  _ainMissed = [];
  if (_ainRecording) await ainStopRecording({ autoSummarize: false });
  if (!_ainCur || !_ainCur.segments.length) return null;

  const snapshot = _ainFormSnapshot();
  const done = ainSummarize(snapshot);          // resolves; never rejects
  const timedOut = Symbol('timeout');
  let timer;
  const race = await Promise.race([
    done.then(() => 'done'),
    new Promise(r => { timer = setTimeout(() => r(timedOut), AIN_SAVE_WAIT); }),
  ]);
  clearTimeout(timer);
  if (race === timedOut) {
    // Let it finish in the background and file itself — just don't hold the
    // save open for it.
    _ainToast('Consult saved — recap still finishing', '🎙', 3000);
    return null;
  }
  return (_ainCur && _ainCur.summary) || null;
}

// Stamps the consult with the order it belongs to, so the library row can
// point at it and "what did she actually say" is one search away later.
function ainAttachToOrder(orderId, customerName) {
  if (!_ainCur || !_ainCur.segments.length) return null;
  _ainCur.orderId = orderId || null;
  if (customerName) _ainCur.customer = customerName;
  if (!_ainCur.title || /^Consult ·/.test(_ainCur.title)) _ainCur.title = _ainDefaultTitle(_ainCur);
  _ainUpsert(_ainCur);
  _ainPersist();
  return _ainCur.id;
}

function ainMissedItems() {
  return _ainMissed.slice();
}

// Renders the gap check onto the Saved overlay. Deliberately advisory and
// dismissible: the order is already saved and synced by this point, and a
// transcript is not authoritative enough to block on or auto-apply.
function ainRenderMissedCard() {
  const card = document.getElementById('ain-missed-card');
  if (!card) return;
  if (!_ainMissed.length) { card.style.display = 'none'; card.innerHTML = ''; return; }
  card.style.display = 'block';
  card.innerHTML =
    '<div class="ain-missed-head">⚠ ' + _ainMissed.length + ' thing' + (_ainMissed.length > 1 ? 's' : '')
    + ' came up in the consult that ' + (_ainMissed.length > 1 ? 'aren\'t' : 'isn\'t') + ' on the order</div>'
    + '<ul class="ain-missed-list">' + _ainMissed.map(m => '<li>' + _ainEsc(m) + '</li>').join('') + '</ul>'
    + '<button type="button" class="ain-missed-btn" onclick="ainOpenFromSaved()">Open the consult notes</button>';
}

// From the Saved overlay: the order is written, so this is for reading the
// transcript back, not for editing — real edits live in the main app. The
// panel stacks ABOVE the Saved overlay rather than replacing it, so closing
// it returns to New Intake / Return to App instead of a dead end.
function ainOpenFromSaved() {
  _ainView = 'summary';
  ainOpen();
}

function ainToggleActionItem(i) {
  if (!_ainCur || !_ainCur.summary) return;
  const a = _ainCur.summary.action_items[i];
  if (!a) return;
  a.done = !a.done;
  _ainUpsert(_ainCur);
  _ainPersist();
  ainRender();
}

// ── Detected order details → the intake form ──────────────────
// Every mapping is explicit, and nothing is written without the user
// ticking it: the transcript is a lossy source, and a wrong metal or
// deadline filled in silently is worse than an empty field.
const _AIN_FIELD_MAP = [
  { key: 'customer_name',   label: 'Customer',        apply: v => { if (typeof setNameFields === 'function') setNameFields(v); } },
  { key: 'email',           label: 'Email',           el: 'f-email' },
  { key: 'phone',           label: 'Phone',           el: 'f-phone', after: () => { const e = document.getElementById('f-phone'); if (e && typeof fmtPhoneInput === 'function') fmtPhoneInput(e); } },
  { key: 'order_type',      label: 'Order type',      el: 'f-order-type', display: v => ({ order: 'Custom Design', repair: 'Repair', resize: 'Resize' }[v] || v), after: v => { if (typeof intakeApplyTypeLayout === 'function') intakeApplyTypeLayout(v); } },
  { key: 'piece_type',      label: 'Piece type',      el: 'f-piece-type', after: v => { if (typeof intakeApplyPieceType === 'function') intakeApplyPieceType(v); } },
  { key: 'job_desc',        label: 'Order name',      el: 'f-job-desc' },
  { key: 'description',     label: 'Description',     el: 'f-description' },
  { key: 'materials',       label: 'Materials',       el: 'f-materials', after: () => { if (typeof intakeSensChanged === 'function') intakeSensChanged(); } },
  { key: 'gemstones',       label: 'Stones',          el: 'f-gemstones', after: () => { if (typeof intakeSensChanged === 'function') intakeSensChanged(); } },
  { key: 'ring_size',       label: 'Sizing',          el: 'f-sizing' },
  { key: 'stamping',        label: 'Inside stamping', el: 'f-stamping' },
  { key: 'deadline',        label: 'Deadline',        el: 'f-deadline' },
  { key: 'pickup_location', label: 'Pickup',          el: 'f-pickup', after: () => { if (typeof toggleShippingAddress === 'function') toggleShippingAddress(); } },
  { key: 'repair_notes',    label: 'Repair details',  el: 'f-repair-notes' },
  { key: 'resize_from',     label: 'Current size',    el: 'f-resize-from' },
  { key: 'resize_to',       label: 'Desired size',    el: 'f-resize-to' },
];

function _ainDetected() {
  const f = (_ainCur && _ainCur.summary && _ainCur.summary.fields) || {};
  const out = [];
  _AIN_FIELD_MAP.forEach(m => {
    const v = f[m.key];
    if (v == null || String(v).trim() === '') return;
    out.push({ map: m, value: String(v).trim(), display: m.display ? m.display(String(v).trim()) : String(v).trim() });
  });
  return out;
}

function ainApplyDetected() {
  const rows = _ainDetected();
  let filled = 0;
  rows.forEach((row, i) => {
    const cb = document.getElementById('ain-fld-' + i);
    if (!cb || !cb.checked) return;
    const m = row.map;
    if (m.apply) {
      m.apply(row.value);
    } else {
      const el = document.getElementById(m.el);
      if (!el) return;
      if (el.tagName === 'SELECT') {
        // Only take a select value the dropdown actually offers — a bogus
        // option would blank the field instead of leaving it alone.
        const ok = [...el.options].some(o => o.value === row.value);
        if (!ok) return;
      }
      el.value = row.value;
    }
    if (m.after) m.after(row.value);
    _ainApplied[m.key] = true;
    filled++;
  });
  if (filled) {
    _ainToast('Filled ' + filled + ' field' + (filled > 1 ? 's' : '') + ' from the consult', '✓');
    ainRender();
  } else {
    _ainToast('Nothing selected to fill', '⚠', 2000);
  }
}

function ainSelectAllDetected(on) {
  _ainDetected().forEach((row, i) => {
    const cb = document.getElementById('ain-fld-' + i);
    if (cb) cb.checked = on;
  });
}

// The recap as plain text — appended to the order's Internal Notes so the
// consult survives on the work order and in Notion even for people who
// never open this panel.
function ainNotesTextForOrder() {
  if (!_ainCur || !_ainCur.summary) return '';
  const s = _ainCur.summary;
  const lines = ['🎙 AI consult notes — ' + (_ainCur.title || '')];
  if (s.overview) lines.push(s.overview);
  if (s.key_points.length) lines.push('Key points:', ...s.key_points.map(k => '• ' + k));
  const open = s.action_items.filter(a => !a.done);
  if (open.length) lines.push('Action items:', ...open.map(a => '☐ ' + a.owner + ': ' + a.text));
  if ((s.missed || []).length) lines.push('Mentioned but not entered on the order:', ...s.missed.map(m => '? ' + m));
  if (s.fields && s.fields.budget) lines.push('Budget discussed: ' + s.fields.budget);
  const sens = (s.fields && s.fields.sensitivities) || [];
  if (sens.length) lines.push('⚠ Mentioned sensitivities: ' + sens.join(', '));
  return lines.filter(Boolean).join('\n');
}

function ainAppendToNotes() {
  const text = ainNotesTextForOrder();
  if (!text) { _ainToast('Summarize the consult first', '⚠', 2500); return; }
  const el = document.getElementById('f-notes');
  if (!el) return;
  if (el.value.includes(text)) { _ainToast('Already in the notes', '✓', 2000); return; }
  el.value = (el.value.trim() ? el.value.trim() + '\n\n' : '') + text;
  _ainToast('Added to Internal Notes', '✓');
}

// ── New-intake reset (called from intakeReset) ────────────────
// A recording in progress is deliberately left alone: staff often start
// the consult before touching the form, and wiping it on a form reset
// would throw away the only copy of a live conversation.
function ainReset() {
  if (_ainRecording) return;
  _ainCur = null;
  _ainApplied = {};
  _ainMissed = [];
  _ainView = 'record';
  _ainRevokeAudioUrl();
  ainRenderMissedCard();
  ainUpdateChip();
  // Re-arm so the next customer records without anyone remembering to.
  ainArmAutoStart();
  const el = document.getElementById('ai-notes');
  if (el && !el.classList.contains('hidden')) ainRender();
}

// ── Library ───────────────────────────────────────────────────
function ainLibrarySearch(v) {
  _ainQuery = v || '';
  _ainRenderLibraryList();
}

function _ainMatches(s, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay = [s.title, s.customer,
    s.summary ? s.summary.overview : '',
    s.summary ? (s.summary.key_points || []).join(' ') : '',
    (s.segments || []).map(x => x.text).join(' ')].join(' ').toLowerCase();
  return hay.includes(needle);
}

function ainOpenSession(id) {
  const s = _ainSessions.find(x => x.id === id);
  if (!s) return;
  if (_ainRecording) { _ainToast('Stop the current recording first', '⚠', 2500); return; }
  _ainRevokeAudioUrl();
  _ainCur = s;
  _ainElapsed = s.durationMs || 0;
  _ainApplied = {};
  _ainView = s.summary ? 'summary' : 'record';
  ainRender();
}

// ── Rendering ─────────────────────────────────────────────────
function ainRender() {
  const host = document.getElementById('ain-body');
  if (!host) return;
  document.querySelectorAll('#ai-notes .ain-tab').forEach(t => t.classList.toggle('on', t.dataset.view === _ainView));
  if (_ainView === 'record')  host.innerHTML = _ainRecordHtml();
  if (_ainView === 'summary') host.innerHTML = _ainSummaryHtml();
  if (_ainView === 'library') host.innerHTML = _ainLibraryHtml();
  if (_ainView === 'record')  _ainRenderTranscript();
  if (_ainView === 'library') _ainRenderLibraryList();
  if (_ainView === 'summary') _ainMountAudio();
  ainUpdateChip();
}

function _ainRecordHtml() {
  const supported = _ainSpeechSupported();
  const audioOn = _ainAudioEnabled();
  const autoOn = _ainAutoEnabled();
  let h = '';

  h += '<div class="ain-rec-bar">';
  h += '<button type="button" class="ain-rec-btn' + (_ainRecording ? ' live' : '') + '" onclick="ainToggleRecord()" '
     + 'aria-label="' + (_ainRecording ? 'Stop recording' : 'Start recording') + '">'
     + (_ainRecording ? '■' : '●') + '</button>';
  h += '<div class="ain-rec-meta">';
  h += '<div class="ain-timer" id="ain-timer">' + _ainClock(_ainNow()) + '</div>';
  h += '<div class="ain-rec-state">'
     + (_ainRecording ? (_ainPaused ? 'Paused' : 'Listening…') : (_ainCur && _ainCur.segments.length ? 'Stopped' : 'Ready'))
     + (_ainRecording && audioOn && _ainMedia ? ' · recording audio' : '') + '</div>';
  h += '</div>';
  if (_ainRecording) {
    h += '<button type="button" class="btn btn-outline" onclick="ainTogglePause()">' + (_ainPaused ? '▶ Resume' : '❚❚ Pause') + '</button>';
  }
  if (!_ainRecording && _ainCur && _ainCur.segments.length) {
    h += '<button type="button" class="btn btn-gold" onclick="ainSummarize()">✨ Summarize</button>';
  }
  h += '</div>';

  // Speaker toggle — Web Speech gives no diarization, so who is talking is
  // a manual switch. It only tags lines recorded from here on.
  h += '<div class="ain-speaker">'
     + '<span class="ain-speaker-lbl">Tag next lines as</span>'
     + '<button type="button" class="ain-chip' + (_ainSpeaker === 'client' ? ' on' : '') + '" onclick="ainSetSpeaker(\'client\')">Client</button>'
     + '<button type="button" class="ain-chip' + (_ainSpeaker === 'studio' ? ' on' : '') + '" onclick="ainSetSpeaker(\'studio\')">Studio</button>'
     + '<span style="flex:1"></span>'
     + '<button type="button" class="ain-chip' + (autoOn ? ' on' : '') + '" onclick="ainToggleAutoPref()" '
     + 'title="Start recording by itself when an order is started, stop when it is saved">⚡ Auto ' + (autoOn ? 'on' : 'off') + '</button>'
     + '<button type="button" class="ain-chip' + (audioOn ? ' on' : '') + '" onclick="ainToggleAudioPref()" '
     + 'title="Keep an audio recording alongside the transcript">🔊 Audio ' + (audioOn ? 'on' : 'off') + '</button>'
     + '</div>';

  if (autoOn && !_ainRecording && !(_ainCur && _ainCur.segments.length)) {
    h += '<div class="ain-note">'
       + (_ainAutoDenied()
          ? 'Auto-record is paused — this browser blocked the microphone. Tap <strong>⚡ Auto</strong> above to ask again.'
          : 'Auto-record is on: this starts by itself the moment you touch the order form, and stops when you Save &amp; Close. '
            + 'You don\'t need to open this panel — it\'s here for when you want to check what was said.')
       + '</div>';
  }

  if (!supported) {
    h += '<div class="ain-note">This browser can\'t transcribe speech. Type or paste the conversation below — '
       + 'the summary, action items and form-fill all still work.</div>';
  }

  h += '<div class="ain-transcript" id="ain-transcript"></div>';

  h += '<div class="ain-manual-row">'
     + '<textarea id="ain-manual" class="ain-manual" rows="2" placeholder="Type a line (or paste notes) and press Add…"></textarea>'
     + '<button type="button" class="btn btn-outline" onclick="ainAddTypedLine()">Add</button>'
     + '</div>';
  return h;
}

function _ainRenderTranscript() {
  // Recording keeps running with the panel closed (that's the point of the
  // header chip), so skip the DOM work entirely when nothing is on screen —
  // interim results fire several times a second.
  const panel = document.getElementById('ai-notes');
  if (!panel || panel.classList.contains('hidden')) return;
  const el = document.getElementById('ain-transcript');
  if (!el) return;
  const segs = (_ainCur && _ainCur.segments) || [];
  if (!segs.length && !_ainInterim) {
    el.innerHTML = '<div class="ain-empty">Nothing captured yet. Tap ● and talk the order through with the client — '
      + 'every line lands here with a timestamp.</div>';
    return;
  }
  let h = segs.map((s, i) =>
    '<div class="ain-seg ' + (s.speaker === 'studio' ? 'studio' : 'client') + '">'
    + '<div class="ain-seg-head">'
    + '<button type="button" class="ain-seg-who" onclick="ainFlipSegmentSpeaker(' + i + ')" title="Switch speaker">'
    + _ainEsc(_ainSpeakerLabel(s.speaker)) + '</button>'
    + '<span class="ain-seg-t">' + _ainClock(s.ms) + '</span>'
    + '<button type="button" class="ain-seg-edit" onclick="ainEditSegment(' + i + ')" title="Edit or delete">✎</button>'
    + '</div>'
    + '<div class="ain-seg-text">' + _ainEsc(s.text) + '</div></div>'
  ).join('');
  if (_ainInterim) h += '<div class="ain-seg interim"><div class="ain-seg-text">' + _ainEsc(_ainInterim) + '…</div></div>';
  el.innerHTML = h;
  el.scrollTop = el.scrollHeight;
}

function _ainSummaryHtml() {
  if (_ainBusy && (!_ainCur || !_ainCur.summary)) {
    return '<div class="ain-empty">✨ Reading the consult…</div>';
  }
  if (!_ainCur || !_ainCur.summary) {
    return '<div class="ain-empty">No summary yet. Record a consult, then tap <strong>Summarize</strong>.</div>';
  }
  const s = _ainCur.summary;
  let h = '';
  h += '<div class="ain-title">' + _ainEsc(_ainCur.title) + '</div>';
  h += '<div class="ain-sub">' + new Date(_ainCur.startedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
     + ' · ' + _ainClock(_ainCur.durationMs || 0) + ' · ' + ((_ainCur.segments || []).length) + ' lines</div>';

  if (_ainCur.audio || _ainCur.audioDropped) {
    h += _ainCur.audio
      ? '<div id="ain-audio-wrap" class="ain-audio"></div>'
      : '<div class="ain-note">Audio for this consult was cleared to save space — the transcript is kept in full.</div>';
  }

  // The safety-net result goes first — it's the one thing here that might
  // need acting on, and it's only ever populated by a save-time run.
  const missed = (s.missed || []);
  if (missed.length) {
    h += '<div class="ain-sec">Said in the consult, not on the order</div>'
       + '<ul class="ain-list ain-list-warn">' + missed.map(m => '<li>' + _ainEsc(m) + '</li>').join('') + '</ul>';
  }

  if (s.overview) h += '<div class="ain-sec">Overview</div><div class="ain-prose">' + _ainEsc(s.overview) + '</div>';

  if (s.key_points.length) {
    h += '<div class="ain-sec">Key points</div><ul class="ain-list">'
       + s.key_points.map(k => '<li>' + _ainEsc(k) + '</li>').join('') + '</ul>';
  }

  if (s.action_items.length) {
    h += '<div class="ain-sec">Action items</div><div class="ain-actions">'
       + s.action_items.map((a, i) =>
           '<label class="ain-action' + (a.done ? ' done' : '') + '">'
           + '<input type="checkbox" ' + (a.done ? 'checked' : '') + ' onchange="ainToggleActionItem(' + i + ')">'
           + '<span class="ain-owner">' + _ainEsc(a.owner) + '</span>'
           + '<span>' + _ainEsc(a.text) + '</span></label>').join('')
       + '</div>';
  }

  const detected = _ainDetected();
  if (detected.length) {
    h += '<div class="ain-sec">Detected order details '
       + '<button type="button" class="ain-mini" onclick="ainSelectAllDetected(true)">all</button>'
       + '<button type="button" class="ain-mini" onclick="ainSelectAllDetected(false)">none</button></div>';
    h += '<div class="ain-fields">' + detected.map((row, i) => {
      const done = _ainApplied[row.map.key];
      return '<label class="ain-fld' + (done ? ' applied' : '') + '">'
        + '<input type="checkbox" id="ain-fld-' + i + '" ' + (done ? '' : 'checked') + '>'
        + '<span class="ain-fld-lbl">' + _ainEsc(row.map.label) + '</span>'
        + '<span class="ain-fld-val">' + _ainEsc(row.display) + '</span>'
        + (done ? '<span class="ain-fld-done">filled ✓</span>' : '') + '</label>';
    }).join('') + '</div>';
    h += '<button type="button" class="btn btn-gold ain-wide" onclick="ainApplyDetected()">↧ Fill the checked fields</button>';
  }

  const budget = s.fields && s.fields.budget;
  const sens = (s.fields && s.fields.sensitivities) || [];
  if (budget || sens.length) {
    h += '<div class="ain-sec">Mentioned</div><div class="ain-prose">';
    if (budget) h += 'Budget: <strong>' + _ainEsc(budget) + '</strong>';
    if (budget && sens.length) h += '<br>';
    if (sens.length) h += '⚠ Sensitivities: <strong>' + _ainEsc(sens.join(', ')) + '</strong>';
    h += '</div>';
  }

  h += '<div class="ain-sec">Ask this consult</div>';
  h += '<div class="ain-asks">' + ((_ainCur.asks || []).map(a =>
        '<div class="ain-ask"><div class="ain-ask-q">' + _ainEsc(a.q) + '</div>'
        + '<div class="ain-ask-a">' + (a.a == null ? '…' : _ainEsc(a.a)) + '</div></div>').join('')) + '</div>';
  h += '<div class="ain-ask-row">'
     + '<input type="text" id="ain-ask-input" class="ain-ask-input" placeholder="Did she say which finger?" '
     + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();ainAsk();}">'
     + '<button type="button" class="btn btn-outline" onclick="ainAsk()"' + (_ainBusy ? ' disabled' : '') + '>Ask</button>'
     + '</div>';

  h += '<div class="ain-foot">'
     + '<button type="button" class="btn btn-outline" onclick="ainAppendToNotes()">＋ Add to Internal Notes</button>'
     + '<button type="button" class="btn btn-outline" onclick="ainSummarize()"' + (_ainBusy ? ' disabled' : '') + '>↻ Re-summarize</button>'
     + '</div>';
  return h;
}

function _ainMountAudio() {
  const wrap = document.getElementById('ain-audio-wrap');
  if (!wrap || !_ainCur || !_ainCur.audio) return;
  _ainRevokeAudioUrl();
  try {
    _ainAudioUrl = URL.createObjectURL(_ainCur.audio);
    const a = document.createElement('audio');
    a.controls = true;
    a.src = _ainAudioUrl;
    a.style.width = '100%';
    wrap.appendChild(a);
  } catch (e) { /* playback is a nicety; never block the recap on it */ }
}

function _ainLibraryHtml() {
  return '<div class="ain-search-wrap">'
    + '<span class="ain-search-icon">🔍</span>'
    + '<input type="text" class="ain-search" id="ain-search" placeholder="Search consults — a name, a stone, anything said…" '
    + 'value="' + _ainEsc(_ainQuery) + '" oninput="ainLibrarySearch(this.value)" autocomplete="off">'
    + '</div><div id="ain-lib-list"></div>';
}

function _ainRenderLibraryList() {
  const el = document.getElementById('ain-lib-list');
  if (!el) return;
  const rows = _ainSessions.filter(s => _ainMatches(s, _ainQuery));
  if (!rows.length) {
    el.innerHTML = '<div class="ain-empty">' + (_ainQuery ? 'No consult mentions that.' : 'No saved consults yet.') + '</div>';
    return;
  }
  el.innerHTML = rows.map(s => {
    const when = new Date(s.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const blurb = (s.summary && s.summary.overview) || (s.segments && s.segments[0] && s.segments[0].text) || '';
    const open = s.summary ? s.summary.action_items.filter(a => !a.done).length : 0;
    const gaps = s.summary ? (s.summary.missed || []).length : 0;
    return '<div class="ain-lib-row" onclick="ainOpenSession(\'' + s.id + '\')">'
      + '<div class="ain-lib-main">'
      + '<div class="ain-lib-title">' + _ainEsc(s.title || 'Untitled consult') + '</div>'
      + '<div class="ain-lib-sub">' + when + ' · ' + _ainClock(s.durationMs || 0)
      + (open ? ' · ' + open + ' open action' + (open > 1 ? 's' : '') : '')
      + (gaps ? ' · ⚠ ' + gaps + ' not on the order' : '')
      + (s.orderId ? ' · 🔗 order' : '')
      + (s.audio ? ' · 🔊' : '') + '</div>'
      + '<div class="ain-lib-blurb">' + _ainEsc(blurb.slice(0, 140)) + '</div>'
      + '</div>'
      + '<button type="button" class="ain-lib-del" onclick="event.stopPropagation();ainDeleteSession(\'' + s.id + '\')" aria-label="Delete">✕</button>'
      + '</div>';
  }).join('');
}

// ── Leaving the page ──────────────────────────────────────────
// Called from intakeExit(). Discarding the ORDER shouldn't discard the
// conversation — a consult is its own record and lives in the library, so
// this files it rather than dropping it. Awaited by the caller so the
// IndexedDB write actually lands before navigation.
async function ainStopForExit() {
  window.removeEventListener('beforeunload', _ainBeforeUnload);
  if (_ainRecording) await ainStopRecording({ autoSummarize: false });
}

// True while a consult is running — lets intakeExit() say so in its confirm.
function ainIsRecording() { return _ainRecording; }

function _ainBeforeUnload(e) {
  if (!_ainRecording) return;
  e.preventDefault();
  e.returnValue = '';
  return '';
}

// ── Boot ──────────────────────────────────────────────────────
// Warm the session list so the library and the header chip are correct on
// first open, and make sure a live consult isn't lost to an accidental
// page close (the intake form has its own beforeunload guard; this adds
// the recording to the reasons to stay).
(function () {
  if (typeof stsStoreGet !== 'function') return;
  ainLoadSessions().then(ainUpdateChip);
  // Arm auto mode once the page (and any ?editId= load) has settled — the
  // trigger checks _editingOrder at fire time, but arming late also keeps
  // the boot's own synthetic focus/scroll from counting as "order started".
  if (document.readyState === 'complete') setTimeout(ainArmAutoStart, 300);
  else window.addEventListener('load', () => setTimeout(ainArmAutoStart, 300));
  window.addEventListener('beforeunload', _ainBeforeUnload);
})();
