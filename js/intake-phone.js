// ════════════════════════════════════════════
//  CUSTOMER PHONE HANDOFF  —  js/intake-phone.js
//  Loaded ONLY by intake.html (after intake-sheet.js, which owns
//  _refPhotos / rpRenderGrid, and after qrcode-lib.js).
//
//  The Photos tab of the bottom sheet can only reach photos already on
//  *this* device. This adds the missing path: show the customer a QR,
//  they scan it with their own phone camera, pick photos out of their own
//  library on the public /phone-upload page, and the photos land in this
//  order's Reference Photos while the dialog is still open.
//
//  Everything downstream is unchanged — the pulled photos go into the
//  same _refPhotos array a manual ＋ Add would fill, so the save path and
//  the Notion reference-photo sync (functions/api/notion-pipeline.js)
//  never learn this feature exists.
//
//  Session lifecycle: mint on open → poll while open → pull each new
//  slot exactly once → DELETE on close so the bucket doesn't keep a
//  second copy of photos that now live on the order.
// ════════════════════════════════════════════

const IP_POLL_MS = 2500;

let _ipToken   = '';
let _ipTimer   = null;
let _ipPulled  = new Set();   // slot indexes already copied into _refPhotos
let _ipClosing = false;

function _ipGenToken() {
  const rnd = (self.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '')
            : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  return 'up' + rnd.toLowerCase().slice(0, 32);
}

// What the customer sees at the top of the upload page, so a phone with
// two open links can tell them apart.
function _ipLabel() {
  const g = id => (document.getElementById(id)?.value || '').trim();
  const who   = g('f-firstname');
  const piece = g('f-job-desc') || g('f-description') || g('f-piece-type');
  return [who, piece].filter(Boolean).join(' — ').slice(0, 80);
}

function _ipRoom() {
  const max = (typeof RP_MAX_PHOTOS === 'number') ? RP_MAX_PHOTOS : 6;
  const have = (typeof _refPhotos !== 'undefined' && _refPhotos) ? _refPhotos.length : 0;
  return Math.max(0, max - have);
}

// ── Open ──────────────────────────────────────────────────────
async function ipOpen() {
  if (!_ipRoom()) {
    if (typeof toast === 'function') toast('Reference photos are full — remove one first', '⚠', 2600);
    return;
  }

  _ipToken   = _ipGenToken();
  _ipPulled  = new Set();
  _ipClosing = false;

  document.getElementById('ip-scrim')?.classList.add('open');
  document.getElementById('ip-modal')?.classList.add('open');
  _ipRender({ state: 'minting' });

  try {
    const r = await fetch('/api/phone-upload', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ kind: 'create', token: _ipToken, label: _ipLabel() }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      _ipRender({ state: 'error', error: data.error || 'Could not start the upload link.' });
      return;
    }
    _ipRender({ state: 'waiting', link: data.link });
    _ipPoll();
  } catch (e) {
    _ipRender({ state: 'error', error: 'No connection — the customer link needs the studio to be online.' });
  }
}

// ── Poll + pull ───────────────────────────────────────────────
function _ipPoll() {
  clearTimeout(_ipTimer);
  _ipTimer = setTimeout(async () => {
    if (_ipClosing || !_ipToken) return;
    try {
      const r = await fetch('/api/phone-upload?token=' + encodeURIComponent(_ipToken));
      if (r.ok) {
        const { session } = await r.json();
        if (session) await _ipPullNew(session);
      }
    } catch (e) { /* transient — the next tick retries */ }
    if (!_ipClosing) _ipPoll();
  }, IP_POLL_MS);
}

async function _ipPullNew(session) {
  const fresh = (session.slots || []).filter(i => !_ipPulled.has(i));

  for (const idx of fresh) {
    if (!_ipRoom()) break;
    try {
      const r = await fetch('/api/phone-upload?token=' + encodeURIComponent(_ipToken) + '&idx=' + idx);
      if (!r.ok) continue;
      const blob = await r.blob();
      if (!blob || !/^image\//.test(blob.type || '')) continue;
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload  = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      // Already downscaled on the customer's phone to the same 1280px /
      // q0.82 the gallery uses, so it goes in as-is.
      _refPhotos.push(dataUrl);
      _ipPulled.add(idx);
    } catch (e) { /* leave it unpulled; the next tick tries again */ }
  }

  if (fresh.length) {
    if (typeof rpRenderGrid === 'function') rpRenderGrid();
    if (typeof intakeTabsRefresh === 'function') intakeTabsRefresh();
  }

  const done = !!session.done && _ipPulled.size >= (session.slots || []).length;
  _ipRender({
    state: done ? 'done' : 'waiting',
    link:  _ipLink(),
    count: _ipPulled.size,
    full:  !_ipRoom(),
  });
}

function _ipLink() {
  return _ipToken ? location.origin + '/phone-upload?token=' + _ipToken : '';
}

// ── Render ────────────────────────────────────────────────────
function _ipRender(view) {
  const body = document.getElementById('ip-body');
  if (!body) return;

  if (view.state === 'minting') {
    body.innerHTML = '<div class="ip-status">Creating a link…</div>';
    return;
  }
  if (view.state === 'error') {
    body.innerHTML = '<div class="ip-status ip-err">' + _ipEsc(view.error) + '</div>'
                   + '<button type="button" class="ip-btn" onclick="ipOpen()">Try again</button>';
    return;
  }

  const link  = view.link || _ipLink();
  const count = view.count || 0;

  const status = view.state === 'done'
    ? '<div class="ip-status ip-ok">✓ ' + count + ' photo' + (count === 1 ? '' : 's')
      + ' added — the customer tapped Done.</div>'
    : view.full
      ? '<div class="ip-status ip-ok">✓ ' + count + ' added — that\'s the maximum.</div>'
      : count
        ? '<div class="ip-status ip-live">✓ ' + count + ' photo' + (count === 1 ? '' : 's')
          + ' in. Still listening…</div>'
        : '<div class="ip-status ip-live">Waiting for the first photo…</div>';

  body.innerHTML =
      '<div class="ip-qr" id="ip-qr"></div>'
    + '<div class="ip-steps">Have the customer open their <b>camera</b> and point it at this code.</div>'
    + status
    + '<div class="ip-link">' + _ipEsc(link) + '</div>'
    + '<button type="button" class="ip-btn ip-btn-plain" onclick="ipCopyLink()">Copy link instead</button>'
    + '<button type="button" class="ip-btn" onclick="ipClose()">'
      + (count ? 'Done' : 'Cancel') + '</button>';

  _ipDrawQR(document.getElementById('ip-qr'), link);
}

function _ipDrawQR(container, url) {
  if (!container || !url) return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    container.innerHTML = qr.createSvgTag({ scalable: true, cellSize: 4, margin: 2 });
  } catch (e) {
    // Without a QR the link text below is still usable, so degrade quietly.
    container.innerHTML = '<div class="ip-status">Scan code unavailable — use the link below.</div>';
  }
}

function _ipEsc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ipCopyLink() {
  const link = _ipLink();
  if (!link) return;
  const done = () => { if (typeof toast === 'function') toast('Link copied — text it to the customer', '📋'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(done).catch(() => prompt('Copy this link:', link));
  } else { prompt('Copy this link:', link); }
}

// ── Close ─────────────────────────────────────────────────────
function ipClose() {
  _ipClosing = true;
  clearTimeout(_ipTimer);
  _ipTimer = null;

  document.getElementById('ip-scrim')?.classList.remove('open');
  document.getElementById('ip-modal')?.classList.remove('open');

  const pulled = _ipPulled.size;
  const token  = _ipToken;
  _ipToken = '';

  // Photos now live on the order, so drop the server-side copies. Fire and
  // forget — a failed cleanup just means the session ages out on its TTL.
  if (token) {
    fetch('/api/phone-upload?token=' + encodeURIComponent(token), { method: 'DELETE' })
      .catch(() => {});
  }
  if (pulled && typeof toast === 'function') {
    toast(pulled + ' photo' + (pulled === 1 ? '' : 's') + ' added from the customer\'s phone', '📱');
  }
}
