// ════════════════════════════════════════════
//  INTAKE CLIENT PROFILES  —  js/intake-profiles.js
//  Loaded ONLY by intake.html (before js/intake.js).
//  Persistent Client Profile store (brief 1.1) + returning-client
//  detection banner (brief 1.6).
//
//  Store: localStorage['sts-customers'] = { v, updated, profiles: [...] }
//  Profile: { id, name, email, phone, address{}, sensitivities[],
//             ringSizeText, styleProfile{}, occasions[], orderIds[],
//             orderCount, lastOrderAt, lastOrderLabel, updatedAt }
//
//  Offline-first: profiles are built and matched entirely from local
//  data; when online, a read-only pull of the Notion pipeline's order
//  list enriches the store (never touches ORDERS — notionStartupSync
//  is unsafe outside the main app). Mirroring to a Notion "Customers"
//  database is deferred until that database exists; `updatedAt` is
//  kept per profile so a future push can diff.
// ════════════════════════════════════════════

// ── Store ─────────────────────────────────────────────────────
function _custLoad() {
  try {
    const s = JSON.parse(localStorage.getItem('sts-customers') || 'null');
    if (s && Array.isArray(s.profiles)) return s;
  } catch (e) {}
  return { v: 1, updated: 0, profiles: [] };
}

function _custSave(db) {
  db.updated = Date.now();
  try { localStorage.setItem('sts-customers', JSON.stringify(db)); } catch (e) {}
}

// ── Normalizers ───────────────────────────────────────────────
function _custNormPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d;
}
function _custNormEmail(e) { return String(e || '').trim().toLowerCase(); }
function _custNormName(n)  { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); }

// ── Order → profile field extraction ──────────────────────────
function _custOrderDate(o) {
  if (o.takeIn)   { const t = Date.parse(o.takeIn);   if (t) return t; }
  if (o.deadline) { const t = Date.parse(o.deadline); if (t) return t; }
  const ts = parseInt(String(o.id || '').replace(/^u/, ''), 10);
  return ts > 1000000000000 ? ts : 0;
}

function _custOrderLabel(o) {
  const what = (o.desc || o.jobDesc || '').split('\n')[0].slice(0, 48);
  const t = _custOrderDate(o);
  const when = t ? new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
  return [what, when].filter(Boolean).join(', ');
}

function _custAddressFromOrder(o) {
  const a = o.shippingAddress || {};
  const street = a.street || o.addrStreet || '';
  if (!street && !(a.city || o.addrCity)) return null;
  return {
    street,
    street2: a.street2 || o.addrStreet2 || '',
    city:    a.city    || o.addrCity    || '',
    state:   a.state   || o.addrState   || '',
    zip:     a.zip     || o.addrZip     || '',
    country: a.country || o.addrCountry || 'United States',
  };
}

// ── Upsert — one order folded into the store. Newest contact wins;
//    profile-only fields (ring sizes, style, occasions) are never
//    clobbered by order data. ──
function stsCustUpsertFromOrder(order, db) {
  const own = !db;
  if (own) db = _custLoad();
  const phone = _custNormPhone(order.phone);
  const email = _custNormEmail(order.email);
  const name  = _custNormName(order.name);
  if (!phone && !email && !name) { return null; }

  let p = null;
  if (phone) p = db.profiles.find(x => _custNormPhone(x.phone) === phone);
  if (!p && email) p = db.profiles.find(x => _custNormEmail(x.email) === email);
  if (!p && name)  p = db.profiles.find(x => _custNormName(x.name) === name && !x.phone && !x.email);
  if (!p) {
    p = { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6),
          name: '', email: '', phone: '', address: null, sensitivities: [],
          ringSizes: [], ringSizeText: '', wrist: '', neck: '',
          styleProfile: {}, occasions: [], orderIds: [],
          orderCount: 0, lastOrderAt: 0, lastOrderLabel: '', updatedAt: 0 };
    db.profiles.push(p);
  }
  // Backfill containers on profiles saved by earlier store versions
  if (!Array.isArray(p.ringSizes)) p.ringSizes = [];
  if (!Array.isArray(p.occasions)) p.occasions = [];
  if (!Array.isArray(p.sensitivities)) p.sensitivities = [];

  const when = _custOrderDate(order);
  const newer = when >= (p.lastOrderAt || 0);
  if (order.name  && (newer || !p.name))  p.name  = order.name;
  if (order.email && (newer || !p.email)) p.email = order.email.trim();
  if (order.phone && (newer || !p.phone)) p.phone = order.phone.trim();
  const addr = _custAddressFromOrder(order);
  if (addr && (newer || !p.address)) p.address = addr;
  (order.sensitivities || []).forEach(s => {
    if (s && !p.sensitivities.includes(s)) p.sensitivities.push(s);
  });
  if (order.ringSize && (newer || !p.ringSizeText)) p.ringSizeText = order.ringSize;

  // Ring registry entries: merge by hand+finger — newer measurement wins
  (order.ringSizes || []).forEach(e => {
    if (!e || !e.hand || !e.finger) return;
    const i = p.ringSizes.findIndex(x => x.hand === e.hand && x.finger === e.finger);
    if (i < 0) p.ringSizes.push({ ...e });
    else if ((e.date || '') >= (p.ringSizes[i].date || '')) p.ringSizes[i] = { ...e };
  });
  if (order.wrist && (newer || !p.wrist)) p.wrist = order.wrist;
  if (order.neck  && (newer || !p.neck))  p.neck  = order.neck;
  if (order.styleProfile && (newer || !p.styleProfile || !Object.keys(p.styleProfile).length)) {
    p.styleProfile = { ...order.styleProfile };
  }
  // Occasion → annual-reminder material on the profile
  if (order.gift && (order.gift.occasion || order.gift.occasionDate)) {
    if (!p.occasions.some(o => o.orderId === order.id)) {
      p.occasions.push({
        occasion: order.gift.occasion, date: order.gift.occasionDate,
        recipient: order.gift.recipient, relationship: order.gift.relationship,
        orderId: order.id,
      });
    }
  }

  if (order.id && !p.orderIds.includes(order.id)) p.orderIds.push(order.id);
  p.orderCount = p.orderIds.length;
  if (newer) { p.lastOrderAt = when; p.lastOrderLabel = _custOrderLabel(order); }
  p.updatedAt = Date.now();

  if (own) _custSave(db);
  return p;
}

// ── Migration / refresh — fold a whole order list in (idempotent;
//    orderIds de-dupe repeat passes). Oldest→newest so "newest
//    contact wins" falls out of the upsert. ──
function stsCustRebuildFromOrders(orders) {
  if (!Array.isArray(orders) || !orders.length) return;
  const db = _custLoad();
  orders.slice().sort((a, b) => _custOrderDate(a) - _custOrderDate(b))
        .forEach(o => stsCustUpsertFromOrder(o, db));
  _custSave(db);
}

// ── Online enrichment — read-only pull of the pipeline's order list.
//    Deliberately NOT notionStartupSync(): that function rebuilds
//    ORDERS and calls main-app-only globals. This never touches ORDERS.
async function stsCustEnrichFromNotion() {
  if (!navigator.onLine || typeof PIPELINE_PROXY === 'undefined') return;
  try {
    const r = await fetch(PIPELINE_PROXY);
    if (!r.ok) return;
    const remote = await r.json();
    if (Array.isArray(remote) && remote.length) stsCustRebuildFromOrders(remote);
  } catch (e) { /* enrichment is best-effort */ }
}

// ── Matching (brief 1.6) — local first, ranked ────────────────
function stsCustMatch(q) {
  const name  = _custNormName(q.name);
  const phone = _custNormPhone(q.phone);
  const email = _custNormEmail(q.email);
  const nameOk  = name.length >= 3;
  const phoneOk = phone.length >= 4;
  const emailOk = /.+@.+\..+/.test(email);
  if (!nameOk && !phoneOk && !emailOk) return [];

  const scored = [];
  _custLoad().profiles.forEach(p => {
    let score = 0;
    if (emailOk && p.email && _custNormEmail(p.email) === email) score += 100;
    if (phoneOk && p.phone) {
      const pp = _custNormPhone(p.phone);
      if (pp === phone) score += 90;
      else if (pp.endsWith(phone) || phone.endsWith(pp)) score += 70;
    }
    if (nameOk && p.name) {
      const pn = _custNormName(p.name);
      if (pn === name) score += 60;
      else if (pn.startsWith(name)) score += 50;
      else if (pn.includes(name)) score += 40;
    }
    if (score) scored.push({ p, score });
  });
  return scored
    .sort((a, b) => (b.score - a.score)
      || ((b.p.orderCount || 0) - (a.p.orderCount || 0))
      || ((b.p.lastOrderAt || 0) - (a.p.lastOrderAt || 0)))
    .slice(0, 3).map(s => s.p);
}

// ── Returning-client banner UI ────────────────────────────────
let _profDebounce = null;
let _profLoadedId = null;   // profile currently applied to the form
let _profUndo = null;       // field snapshot from before the fill

function _profFieldIds() {
  return ['f-email', 'f-phone', 'f-addr-street', 'f-addr-street2', 'f-addr-city',
          'f-addr-state', 'f-addr-zip', 'f-addr-country', 'f-sensitivity-note',
          'f-wrist', 'f-neck', 'f-sizing'];
}

function intakeProfileFieldInput() {
  clearTimeout(_profDebounce);
  if (_profLoadedId) return; // a profile is applied — no re-matching until undo/reset
  _profDebounce = setTimeout(() => {
    const g = id => document.getElementById(id)?.value || '';
    const matches = stsCustMatch({
      name: (g('f-firstname') + ' ' + g('f-lastname')).trim(),
      phone: g('f-phone'),
      email: g('f-email'),
    });
    _profRenderBanner(matches);
  }, 300);
}

function _profEsc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function _profRenderBanner(matches) {
  const fg = document.getElementById('client-match-fg');
  if (!fg) return;
  if (!matches.length) { fg.style.display = 'none'; fg.innerHTML = ''; return; }
  const rows = matches.map(p => {
    const meta = [
      p.orderCount + ' past order' + (p.orderCount === 1 ? '' : 's'),
      p.lastOrderLabel ? 'last: ' + p.lastOrderLabel : '',
      matches.length > 1 && p.phone ? '…' + _custNormPhone(p.phone).slice(-4) : '',
    ].filter(Boolean).join(' · ');
    return '<div class="client-banner-row">'
      + '<span class="cb-text"><strong>' + _profEsc(p.name || '(no name)') + '</strong> — ' + _profEsc(meta) + '</span>'
      + '<button type="button" class="cb-load" onclick="intakeLoadProfile(\'' + p.id + '\')">Load profile</button>'
      + '</div>';
  }).join('');
  fg.innerHTML = '<div class="client-banner">' + rows
    + '<button type="button" class="cb-dismiss" onclick="intakeProfileDismiss()" aria-label="Dismiss">✕</button></div>';
  fg.style.display = '';
}

function intakeProfileDismiss() {
  const fg = document.getElementById('client-match-fg');
  if (fg) { fg.style.display = 'none'; fg.innerHTML = ''; }
}

function intakeLoadProfile(pid) {
  const p = _custLoad().profiles.find(x => x.id === pid);
  if (!p) return;

  // Snapshot for undo
  _profUndo = { fields: {}, checks: {}, name: [
    document.getElementById('f-firstname')?.value || '',
    document.getElementById('f-lastname')?.value || '',
  ]};
  _profFieldIds().forEach(id => { _profUndo.fields[id] = document.getElementById(id)?.value || ''; });
  document.querySelectorAll('#f-sensitivities input').forEach(c => { _profUndo.checks[c.value] = c.checked; });
  _profUndo.regClient = _regEntries.client.map(e => ({ ...e }));
  _profUndo.style = _styleCollect();

  if (p.name && typeof setNameFields === 'function') setNameFields(p.name);
  const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  set('f-email', p.email);
  set('f-phone', p.phone);
  const phoneEl = document.getElementById('f-phone');
  if (phoneEl && typeof fmtPhoneInput === 'function') fmtPhoneInput(phoneEl);
  if (p.address) {
    set('f-addr-street',  p.address.street);
    set('f-addr-street2', p.address.street2);
    set('f-addr-city',    p.address.city);
    set('f-addr-state',   p.address.state);
    set('f-addr-zip',     p.address.zip);
    set('f-addr-country', p.address.country);
  }
  // Sensitivities: known chip values check their boxes, the rest joins the note
  const boxes = [...document.querySelectorAll('#f-sensitivities input')];
  const leftovers = [];
  (p.sensitivities || []).forEach(s => {
    const box = boxes.find(b => b.value === s);
    if (box) box.checked = true;
    else if (s) leftovers.push(s);
  });
  if (leftovers.length) set('f-sensitivity-note', leftovers.join('; '));

  // Ring registry, wrist/neck, and style chips from the profile
  if (Array.isArray(p.ringSizes) && p.ringSizes.length) {
    _regEntries.client = p.ringSizes.map(e => ({ ...e }));
    regRenderHands();
    regPrefillSizing();
  }
  set('f-wrist', p.wrist);
  set('f-neck', p.neck);
  if (p.styleProfile && Object.keys(p.styleProfile).length) styleApply(p.styleProfile);

  if (typeof intakeSensChanged === 'function') intakeSensChanged();
  if (typeof toggleShippingAddress === 'function') toggleShippingAddress();

  _profLoadedId = pid;
  const fg = document.getElementById('client-match-fg');
  if (fg) {
    fg.innerHTML = '<div class="client-banner loaded">'
      + '<span class="cb-text">✓ Profile loaded — <strong>' + _profEsc(p.name) + '</strong></span>'
      + '<button type="button" class="cb-load" onclick="intakeProfileUndo()">Undo</button></div>';
    fg.style.display = '';
  }
  if (typeof toast === 'function') toast('Profile loaded ✓', '👤', 1800);
}

function intakeProfileUndo() {
  if (_profUndo) {
    const [fn, ln] = _profUndo.name;
    const f = document.getElementById('f-firstname'), l = document.getElementById('f-lastname');
    if (f) f.value = fn;
    if (l) l.value = ln;
    Object.entries(_profUndo.fields).forEach(([id, v]) => {
      const el = document.getElementById(id); if (el) el.value = v;
    });
    document.querySelectorAll('#f-sensitivities input').forEach(c => {
      c.checked = !!_profUndo.checks[c.value];
    });
    _regEntries.client = (_profUndo.regClient || []).map(e => ({ ...e }));
    regRenderHands();
    styleApply(_profUndo.style || { aesthetic: [] });
    if (typeof intakeSensChanged === 'function') intakeSensChanged();
    if (typeof toggleShippingAddress === 'function') toggleShippingAddress();
  }
  intakeProfileReset();
  intakeProfileFieldInput(); // re-run matching against the restored fields
}

// Called from intakeReset() so the next customer starts clean
function intakeProfileReset() {
  _profLoadedId = null;
  _profUndo = null;
  clearTimeout(_profDebounce);
  intakeProfileDismiss();
}

// ════════════════════════════════════════════
//  SECTION 1 ACCORDIONS — ring registry (1.2) · occasion (1.4) ·
//  style profile (1.5). All order-level state that upserts onto the
//  Client Profile at submit.
// ════════════════════════════════════════════

// ── Shared accordion + chip plumbing ──────────────────────────
function accToggle(name) {
  const row = document.getElementById('acc-' + name);
  const body = document.getElementById('acc-' + name + '-body');
  if (!row || !body) return;
  const open = row.classList.toggle('open');
  body.style.display = open ? '' : 'none';
}

function selChip(btn, group) {
  const wrap = btn.parentElement;
  if (!wrap.dataset.multi) {
    wrap.querySelectorAll('.sel-chip.on').forEach(c => { if (c !== btn) c.classList.remove('on'); });
  }
  btn.classList.toggle('on');
  if (group === 'occ') occChanged();
  if (group === 'style') styleChanged();
}

function _chipSel(containerId) {
  return document.querySelector('#' + containerId + ' .sel-chip.on')?.textContent || '';
}

// ── 1.2 Ring size registry ────────────────────────────────────
let _regEntries = { client: [], recipient: [] }; // {hand,finger,size,conf,date}
let _regPerson = 'client';
let _regDial = null; // {hand, finger} while the size dial is open

const _REG_CONF_COLORS = { measured: '#2E9E44', told: '#D99A26', estimated: '#D96C26' };
const _REG_CONF_LABELS = { measured: 'Measured in-studio', told: 'Told to us', estimated: 'From existing ring' };
const _REG_FINGER_NAMES = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring finger', pinky: 'Pinky' };
const _REG_FINGER_GEO = [
  { f: 'pinky',  x: 6,  y: 42, w: 15, h: 44 },
  { f: 'ring',   x: 25, y: 24, w: 16, h: 62 },
  { f: 'middle', x: 45, y: 16, w: 17, h: 70 },
  { f: 'index',  x: 66, y: 28, w: 16, h: 58 },
];

function _regList() { return _regEntries[_regPerson]; }
function _regFmtSize(v) { return String(v).replace(/\.?0+$/, '') || '0'; }

function _regHandSvg(hand) {
  const W = 106, mirror = hand === 'R';
  const mx = (x, w) => mirror ? W - x - w : x;
  const entryFor = f => _regList().find(e => e.hand === hand && e.finger === f);

  const palm = '<rect x="' + mx(8, 74) + '" y="86" width="74" height="44" rx="16" fill="#F3EFE9" stroke="#C8BFB4" stroke-width="1.5"/>';

  const fingerShape = (f, x, y, w, h, textX, textY) => {
    const entry = entryFor(f);
    const sel = _regDial && _regDial.hand === hand && _regDial.finger === f;
    const fill = sel ? '#F1DFB6' : entry ? '#F8F0E0' : '#FAF8F5';
    const stroke = (sel || entry) ? '#C9983A' : '#C8BFB4';
    let s = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (w / 2) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"/>';
    if (entry) {
      s += '<circle cx="' + (x + w / 2) + '" cy="' + (y + 7) + '" r="3.5" fill="' + (_REG_CONF_COLORS[entry.conf] || '#888') + '"/>'
         + '<text x="' + textX + '" y="' + textY + '" text-anchor="middle" font-size="9.5" font-weight="700" fill="#6A5A3A">' + _regFmtSize(entry.size) + '</text>';
    }
    return '<g class="rf-finger" data-hand="' + hand + '" data-finger="' + f + '">' + s + '</g>';
  };

  const fingers = _REG_FINGER_GEO.map(g => {
    const x = mx(g.x, g.w);
    return fingerShape(g.f, x, g.y, g.w, g.h + 14, x + g.w / 2, g.y + g.h + 8);
  }).join('');

  // Thumb — angled off the palm's outer edge
  const tx = mirror ? 6 : 85, pivotX = mirror ? 13 : 92, rot = mirror ? 26 : -26;
  const tEntry = entryFor('thumb');
  const tSel = _regDial && _regDial.hand === hand && _regDial.finger === 'thumb';
  const tFill = tSel ? '#F1DFB6' : tEntry ? '#F8F0E0' : '#FAF8F5';
  const tStroke = (tSel || tEntry) ? '#C9983A' : '#C8BFB4';
  let thumb = '<g class="rf-finger" data-hand="' + hand + '" data-finger="thumb">'
    + '<rect x="' + tx + '" y="58" width="15" height="42" rx="7.5" transform="rotate(' + rot + ' ' + pivotX + ' 60)" fill="' + tFill + '" stroke="' + tStroke + '" stroke-width="1.5"/>';
  if (tEntry) {
    thumb += '<circle cx="' + (mirror ? 8 : 98) + '" cy="55" r="3.5" fill="' + (_REG_CONF_COLORS[tEntry.conf] || '#888') + '"/>'
           + '<text x="' + (mirror ? 14 : 92) + '" y="115" text-anchor="middle" font-size="9.5" font-weight="700" fill="#6A5A3A">' + _regFmtSize(tEntry.size) + '</text>';
  }
  thumb += '</g>';

  // 190px wide ⇒ ~29px finger rects — chunky enough for fingertip taps
  return '<svg viewBox="0 0 106 136" width="190" height="244" xmlns="http://www.w3.org/2000/svg">' + palm + thumb + fingers + '</svg>';
}

function regRenderHands() {
  const wrap = document.getElementById('reg-hands');
  if (!wrap) return;
  wrap.innerHTML =
    '<div class="reg-hand-wrap">' + _regHandSvg('L') + '<div class="reg-hand-label">LEFT</div></div>' +
    '<div class="reg-hand-wrap">' + _regHandSvg('R') + '<div class="reg-hand-label">RIGHT</div></div>';
  regUpdateSummary();
}

function regSetPerson(person) {
  _regPerson = person;
  document.getElementById('reg-tab-client')?.classList.toggle('on', person === 'client');
  document.getElementById('reg-tab-recipient')?.classList.toggle('on', person === 'recipient');
  regDialClose();
}

function regOpenDial(hand, finger) {
  _regDial = { hand, finger };
  const dial = document.getElementById('reg-dial');
  if (!dial) return;
  const existing = _regList().find(e => e.hand === hand && e.finger === finger);
  const selSize = existing ? existing.size : 6.5;
  const selConf = existing ? existing.conf : 'measured';

  let sizes = '';
  for (let q = 4; q <= 64; q++) { // US 1–16 in quarter steps
    const v = q / 4;
    sizes += '<button type="button" class="reg-size' + (v === selSize ? ' on' : '') + '" data-size="' + v + '">' + _regFmtSize(v) + '</button>';
  }
  const confs = Object.keys(_REG_CONF_LABELS).map(k =>
    '<button type="button" class="reg-conf-btn' + (k === selConf ? ' on' : '') + '" data-conf="' + k + '">'
    + '<span class="reg-conf-dot" style="background:' + _REG_CONF_COLORS[k] + '"></span>' + _REG_CONF_LABELS[k] + '</button>').join('');

  dial.innerHTML =
    '<div class="reg-dial-title">' + (hand === 'L' ? 'Left' : 'Right') + ' · ' + _REG_FINGER_NAMES[finger] + '</div>' +
    '<div class="reg-wheel" id="reg-wheel">' + sizes + '</div>' +
    '<div class="reg-conf">' + confs + '</div>' +
    '<div class="reg-dial-actions">' +
      '<button type="button" class="btn btn-gold" onclick="regDialSave()">Save size</button>' +
      (existing ? '<button type="button" class="btn btn-outline" onclick="regDialRemove()">Remove</button>' : '') +
      '<button type="button" class="btn btn-ghost" onclick="regDialClose()">Cancel</button>' +
    '</div>';
  dial.style.display = '';
  const wheel = dial.querySelector('#reg-wheel');
  const on = wheel?.querySelector('.reg-size.on');
  if (wheel && on) wheel.scrollLeft = on.offsetLeft - wheel.clientWidth / 2 + on.offsetWidth / 2;
  regRenderHands(); // highlight the selected finger
}

function regDialSave() {
  if (!_regDial) return;
  const dial = document.getElementById('reg-dial');
  const size = parseFloat(dial?.querySelector('.reg-size.on')?.dataset.size);
  const conf = dial?.querySelector('.reg-conf-btn.on')?.dataset.conf || 'measured';
  if (!size) { regDialClose(); return; }
  const list = _regList();
  const i = list.findIndex(e => e.hand === _regDial.hand && e.finger === _regDial.finger);
  const entry = { hand: _regDial.hand, finger: _regDial.finger, size, conf, date: new Date().toISOString().slice(0, 10) };
  if (i >= 0) list[i] = entry; else list.push(entry);
  regDialClose();
  regPrefillSizing();
}

function regDialRemove() {
  if (!_regDial) return;
  const list = _regList();
  const i = list.findIndex(e => e.hand === _regDial.hand && e.finger === _regDial.finger);
  if (i >= 0) list.splice(i, 1);
  regDialClose();
  regPrefillSizing();
}

function regDialClose() {
  _regDial = null;
  const dial = document.getElementById('reg-dial');
  if (dial) { dial.style.display = 'none'; dial.innerHTML = ''; }
  regRenderHands();
}

function regUpdateSummary() {
  const el = document.getElementById('reg-summary');
  if (!el) return;
  const c = _regEntries.client;
  const parts = c.slice(0, 3).map(e => e.hand + ' ' + e.finger + ' ' + _regFmtSize(e.size));
  if (c.length > 3) parts.push('+' + (c.length - 3) + ' more');
  if (_regEntries.recipient.length) parts.push('recipient: ' + _regEntries.recipient.length);
  el.textContent = parts.length ? parts.join(' · ') : 'none on file';
  el.classList.toggle('filled', !!parts.length);
}

// f-sizing pre-fills from the registry but stays editable — the order
// keeps its own snapshot. Gift mode prefers the recipient's sizes.
function regPrefillSizing() {
  const el = document.getElementById('f-sizing');
  if (!el) return;
  const src = (_occGift && _regEntries.recipient.length) ? _regEntries.recipient : _regEntries.client;
  const hint = document.getElementById('sizing-verify-hint');
  if (!src.length) { if (hint) hint.style.display = 'none'; return; }
  const txt = src.map(e => e.hand + ' ' + e.finger + ' ' + _regFmtSize(e.size)).join(', ');
  if (!el.value.trim() || el.dataset.auto === '1') { el.value = txt; el.dataset.auto = '1'; }
  if (hint) {
    const unverified = src.some(e => e.conf !== 'measured');
    hint.textContent = '⚠ Includes non-measured sizes — verify before casting.';
    hint.style.display = (unverified && el.dataset.auto === '1') ? 'block' : 'none';
  }
}

// ── 1.4 Occasion & recipient ──────────────────────────────────
let _occGift = false;

function occSetGift(on) {
  _occGift = on;
  document.getElementById('occ-self-btn')?.classList.toggle('selected', !on);
  document.getElementById('occ-gift-btn')?.classList.toggle('selected', on);
  const block = document.getElementById('occ-gift-block');
  if (block) block.style.display = on ? '' : 'none';
  // Gift mode adds the Recipient tab to the ring-size registry
  const tabs = document.getElementById('reg-tabs');
  if (tabs) tabs.style.display = on ? '' : 'none';
  if (!on) regSetPerson('client');
  occChanged();
}

function _occFmtDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function occChanged() {
  const sum = document.getElementById('occ-summary');
  if (sum) {
    if (_occGift) {
      const rec = document.getElementById('f-gift-recipient')?.value.trim();
      const parts = ['Gift' + (rec ? ' for ' + rec : '')];
      const occ = _chipSel('occ-occasion'); if (occ) parts.push(occ);
      const d = document.getElementById('f-gift-date')?.value; if (d) parts.push(_occFmtDate(d));
      if (document.getElementById('f-gift-surprise')?.checked) parts.push('🤫 surprise');
      sum.textContent = parts.join(' · ');
      sum.classList.add('filled');
    } else {
      sum.textContent = 'for self';
      sum.classList.remove('filled');
    }
  }
  // Gentle flag: occasion lands before the piece's deadline
  const warn = document.getElementById('occ-date-warn');
  if (warn) {
    const d = document.getElementById('f-gift-date')?.value;
    const dl = document.getElementById('f-deadline')?.value;
    if (_occGift && d && dl && d < dl) {
      warn.textContent = '⚠ Occasion (' + _occFmtDate(d) + ') is before the deadline (' + _occFmtDate(dl) + ') — the piece may not be ready in time.';
      warn.style.display = 'block';
    } else warn.style.display = 'none';
  }
  regPrefillSizing(); // gift toggle changes whose sizes feed f-sizing
}

// ── 1.5 Style profile ─────────────────────────────────────────
function _styleCollect() {
  return {
    aesthetic: [...document.querySelectorAll('#style-aesthetic .sel-chip.on')].map(c => c.textContent),
    tone:   _chipSel('style-tone'),
    wear:   _chipSel('style-wear'),
    budget: _chipSel('style-budget'),
  };
}

function styleChanged() {
  const s = _styleCollect();
  const parts = s.aesthetic.slice();
  if (s.tone) parts.push(s.tone);
  if (s.wear) parts.push(s.wear.toLowerCase());
  const sum = document.getElementById('style-summary');
  if (sum) {
    sum.textContent = parts.length ? parts.slice(0, 4).join(' · ') : 'not set';
    sum.classList.toggle('filled', !!parts.length);
  }
}

function styleApply(s) {
  if (!s) return;
  const setOn = (containerId, values) => {
    document.querySelectorAll('#' + containerId + ' .sel-chip').forEach(c => {
      c.classList.toggle('on', values.includes(c.textContent));
    });
  };
  setOn('style-aesthetic', s.aesthetic || []);
  setOn('style-tone',   s.tone   ? [s.tone]   : []);
  setOn('style-wear',   s.wear   ? [s.wear]   : []);
  setOn('style-budget', s.budget ? [s.budget] : []);
  styleChanged();
}

// ── Collect / notes-degradation / reset / dirty — called from intake.js ──
function intakeSection1Collect() {
  const style = _styleCollect();
  const hasStyle = style.aesthetic.length || style.tone || style.wear || style.budget;
  let gift = null;
  if (_occGift) {
    gift = {
      recipient:    document.getElementById('f-gift-recipient')?.value.trim() || '',
      relationship: _chipSel('occ-relationship'),
      occasion:     _chipSel('occ-occasion'),
      occasionDate: document.getElementById('f-gift-date')?.value || '',
      surprise:     !!document.getElementById('f-gift-surprise')?.checked,
      ringSizes:    _regEntries.recipient.map(e => ({ ...e })),
    };
  }
  return {
    ringSizes: _regEntries.client.map(e => ({ ...e })),
    wrist: document.getElementById('f-wrist')?.value.trim() || '',
    neck:  document.getElementById('f-neck')?.value.trim() || '',
    styleProfile: hasStyle ? style : null,
    gift,
  };
}

// Plain-text line for notes so Notion + the printed bag see the gift
// context with zero pipeline changes (cross-cutting rule).
function intakeSection1NotesLine(c) {
  if (!c || !c.gift) return '';
  const g = c.gift;
  const bits = ['🎁 Gift' + (g.recipient ? ' for ' + g.recipient : '') + (g.relationship ? ' (' + g.relationship.toLowerCase() + ')' : '')];
  if (g.occasion) bits.push(g.occasion);
  if (g.occasionDate) bits.push(g.occasionDate);
  if (g.surprise) bits.push('SURPRISE — discretion at pickup, no emails to shared inboxes');
  return bits.join(' — ');
}

function intakeSection1Reset() {
  _regEntries = { client: [], recipient: [] };
  regDialClose();
  ['f-gift-recipient', 'f-gift-date', 'f-wrist', 'f-neck'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const surprise = document.getElementById('f-gift-surprise');
  if (surprise) surprise.checked = false;
  document.querySelectorAll('#acc-occasion-body .sel-chip.on, #acc-style-body .sel-chip.on')
    .forEach(c => c.classList.remove('on'));
  const sizing = document.getElementById('f-sizing');
  if (sizing) delete sizing.dataset.auto;
  const hint = document.getElementById('sizing-verify-hint');
  if (hint) hint.style.display = 'none';
  occSetGift(false);
  styleChanged();
  ['sizes', 'occasion', 'style'].forEach(n => {
    const row = document.getElementById('acc-' + n);
    const body = document.getElementById('acc-' + n + '-body');
    if (row) row.classList.remove('open');
    if (body) body.style.display = 'none';
  });
}

function intakeSection1Dirty() {
  return !!(_regEntries.client.length || _regEntries.recipient.length || _occGift
    || document.querySelector('#acc-style-body .sel-chip.on')
    || document.getElementById('f-wrist')?.value
    || document.getElementById('f-neck')?.value);
}

// ── Wire up the watched fields (script runs at end of body — DOM ready)
['f-firstname', 'f-lastname', 'f-email', 'f-phone'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', intakeProfileFieldInput);
});

// Ring registry: delegated finger taps + dial chip selection
document.getElementById('reg-hands')?.addEventListener('click', e => {
  const finger = e.target.closest('.rf-finger');
  if (finger) regOpenDial(finger.dataset.hand, finger.dataset.finger);
});
document.getElementById('reg-dial')?.addEventListener('click', e => {
  const size = e.target.closest('.reg-size');
  if (size) {
    size.parentElement.querySelectorAll('.reg-size.on').forEach(b => b.classList.remove('on'));
    size.classList.add('on');
    return;
  }
  const conf = e.target.closest('.reg-conf-btn');
  if (conf) {
    conf.parentElement.querySelectorAll('.reg-conf-btn.on').forEach(b => b.classList.remove('on'));
    conf.classList.add('on');
  }
});
// Manual edits to Sizing/Dimensions stop the registry auto-fill
document.getElementById('f-sizing')?.addEventListener('input', function () {
  delete this.dataset.auto;
  const hint = document.getElementById('sizing-verify-hint');
  if (hint) hint.style.display = 'none';
});
// Deadline changes re-evaluate the occasion-before-deadline flag
document.getElementById('f-deadline')?.addEventListener('change', occChanged);

regRenderHands();
