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
          ringSizeText: '', styleProfile: {}, occasions: [], orderIds: [],
          orderCount: 0, lastOrderAt: 0, lastOrderLabel: '', updatedAt: 0 };
    db.profiles.push(p);
  }

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
          'f-addr-state', 'f-addr-zip', 'f-addr-country', 'f-sensitivity-note'];
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

// ── Wire up the watched fields (script runs at end of body — DOM ready)
['f-firstname', 'f-lastname', 'f-email', 'f-phone'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', intakeProfileFieldInput);
});
