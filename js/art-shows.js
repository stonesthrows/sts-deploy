// ════════════════════════════════════════════
//  ART SHOWS  —  js/art-shows.js
//  Manually-maintained tracker of art/craft show application deadlines,
//  fees, and requirements. Zapplication and CaFÉ (callforentry.org) both
//  block automated scraping and gate real listings behind login, so this
//  is not a live feed — Kyle looks shows up on those sites and logs them
//  here. Stored in Cloudflare KV via /api/art-shows.
// ════════════════════════════════════════════

const ART_SHOW_SOURCES = {
  zapplication: { label: 'ZAPPlication', url: 'https://www.zapplication.org/' },
  cafe:         { label: 'CaFÉ',         url: 'https://www.callforentry.org/' },
  other:        { label: 'Other',        url: '' },
};

let _artShows = [];
let _artShowsLoaded = false;
let _artShowsFilter = 'upcoming'; // 'upcoming' | 'applied' | 'passed' | 'all'
let _artShowsEditId = null;       // null = new, string = editing existing

// ── Load ─────────────────────────────────────
async function artShowsInit() {
  if (_artShowsLoaded) { artShowsRender(); return; }
  await artShowsLoad();
}

async function artShowsLoad() {
  const list = document.getElementById('as-list');
  if (list && !_artShowsLoaded) {
    list.innerHTML = '<div class="oh-empty">Loading art shows…</div>';
  }
  try {
    const resp = await fetch('/api/art-shows');
    if (!resp.ok) throw new Error('status ' + resp.status);
    _artShows = await resp.json();
  } catch (e) {
    if (list) list.innerHTML = '<div class="oh-empty">Could not load art shows — ' + escHtml(String(e.message || e)) + '</div>';
    return;
  }
  _artShowsLoaded = true;
  artShowsRender();
}

// ── Date / urgency helpers ────────────────────
function _asToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Parses a plain "YYYY-MM-DD" as a local calendar date (not UTC midnight),
// so "days until" doesn't shift by a day depending on the viewer's timezone.
function _asParseDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

function _asDaysUntil(dateStr) {
  const d = _asParseDate(dateStr);
  if (!d) return null;
  return Math.round((d - _asToday()) / 86400000);
}

function _asUrgency(dateStr, applied) {
  const days = _asDaysUntil(dateStr);
  if (days === null) return 'none';
  if (days < 0) return applied ? 'applied-passed' : 'passed';
  if (days <= 7) return 'urgent';
  if (days <= 21) return 'soon';
  return 'normal';
}

function _asFmtDate(dateStr) {
  const d = _asParseDate(dateStr);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function _asFmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  return '$' + num.toLocaleString(undefined, { minimumFractionDigits: num % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

const ART_SHOW_STATUS_LABELS = {
  interested: 'Interested',
  applied:    'Applied',
  accepted:   'Accepted',
  rejected:   'Rejected',
  skipped:    'Skipped',
};

// ── Filter / render ────────────────────────────
function artShowsSetFilter(f) {
  _artShowsFilter = f;
  document.querySelectorAll('.as-fbtn').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
  artShowsRender();
}

function _asFilteredSorted() {
  let shows = _artShows.slice();
  if (_artShowsFilter === 'upcoming') {
    shows = shows.filter(s => _asDaysUntil(s.deadline) === null || _asDaysUntil(s.deadline) >= 0);
  } else if (_artShowsFilter === 'applied') {
    shows = shows.filter(s => s.status === 'applied' || s.status === 'accepted');
  } else if (_artShowsFilter === 'passed') {
    shows = shows.filter(s => { const d = _asDaysUntil(s.deadline); return d !== null && d < 0; });
  }
  shows.sort((a, b) => {
    const da = _asDaysUntil(a.deadline), db = _asDaysUntil(b.deadline);
    if (da === null && db === null) return (a.name || '').localeCompare(b.name || '');
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
  return shows;
}

function artShowsRender() {
  const list = document.getElementById('as-list');
  if (!list) return;

  const shows = _asFilteredSorted();
  const count = document.getElementById('as-count');
  if (count) count.textContent = shows.length ? shows.length + ' show' + (shows.length !== 1 ? 's' : '') : '';

  if (!shows.length) {
    list.innerHTML = `
      <div class="oh-empty">
        ${_artShows.length === 0
          ? 'No art shows tracked yet. Look one up on ZAPPlication or CaFÉ, then click <strong>+ Add Show</strong>.'
          : 'Nothing matches this filter.'}
      </div>`;
    return;
  }

  list.innerHTML = shows.map(_asCardHtml).join('');
}

function _asCardHtml(s) {
  const days = _asDaysUntil(s.deadline);
  const urgency = _asUrgency(s.deadline, s.status === 'applied' || s.status === 'accepted');
  let dueBadge = '';
  if (days !== null) {
    if (urgency === 'urgent') dueBadge = `<span class="as-badge as-badge-urgent">${days <= 0 ? 'Due today' : days + 'd left'}</span>`;
    else if (urgency === 'soon') dueBadge = `<span class="as-badge as-badge-soon">${days}d left</span>`;
    else if (urgency === 'passed') dueBadge = `<span class="as-badge as-badge-passed">Passed</span>`;
    else if (urgency === 'applied-passed') dueBadge = `<span class="as-badge as-badge-normal">Closed</span>`;
    else dueBadge = `<span class="as-badge as-badge-normal">${days}d left</span>`;
  }

  const statusLabel = ART_SHOW_STATUS_LABELS[s.status] || 'Interested';
  const statusCls = (s.status === 'applied' || s.status === 'accepted') ? 'as-status-ok'
    : (s.status === 'rejected') ? 'as-status-danger' : 'as-status-neutral';

  const src = ART_SHOW_SOURCES[s.sourceSite] || null;
  const link = s.websiteUrl || (src && src.url) || '';
  const srcLabel = s.sourceSite === 'other' ? (s.sourceLabel || 'Other') : (src ? src.label : '');

  const fees = [];
  if (s.applicationFee !== undefined && s.applicationFee !== null && s.applicationFee !== '') {
    fees.push(`<div class="as-fee"><span>Application fee</span><strong>${_asFmtMoney(s.applicationFee)}</strong></div>`);
  }
  if (s.boothFee !== undefined && s.boothFee !== null && s.boothFee !== '') {
    fees.push(`<div class="as-fee"><span>Booth fee</span><strong>${_asFmtMoney(s.boothFee)}</strong></div>`);
  }

  return `
    <div class="as-card as-urgency-${urgency}">
      <div class="as-card-head">
        <div class="as-card-title-wrap">
          <div class="as-card-title">${escHtml(s.name || 'Untitled show')}</div>
          ${s.location ? `<div class="as-card-loc">📍 ${escHtml(s.location)}</div>` : ''}
        </div>
        ${dueBadge}
      </div>
      <div class="as-card-body">
        <div class="as-deadline">
          <span class="as-deadline-label">Application deadline</span>
          <span class="as-deadline-date">${_asFmtDate(s.deadline)}</span>
        </div>
        ${s.eventDates ? `<div class="as-event-dates">🗓 ${escHtml(s.eventDates)}</div>` : ''}
        ${fees.length ? `<div class="as-fees">${fees.join('')}</div>` : ''}
        ${s.requirements ? `<div class="as-requirements">${escHtml(s.requirements)}</div>` : ''}
      </div>
      <div class="as-card-foot">
        <span class="as-status-chip ${statusCls}">${statusLabel}</span>
        ${srcLabel ? `<span class="as-source-chip">${escHtml(srcLabel)}</span>` : ''}
        <div class="as-card-actions">
          ${link ? `<a class="btn btn-outline btn-sm" href="${escHtml(link)}" target="_blank" rel="noopener">Open ↗</a>` : ''}
          <button class="btn btn-outline btn-sm" onclick="artShowsOpenForm('${s.id}')">Edit</button>
          <button class="btn btn-outline btn-sm" onclick="artShowsDelete('${s.id}')">Delete</button>
        </div>
      </div>
    </div>`;
}

// ── Add / edit form ────────────────────────────
function artShowsOpenForm(id) {
  _artShowsEditId = id || null;
  const s = id ? _artShows.find(x => x.id === id) : null;

  document.getElementById('asModalTitle').textContent = s ? 'Edit Show' : 'Add Show';
  document.getElementById('asName').value = s ? (s.name || '') : '';
  document.getElementById('asLocation').value = s ? (s.location || '') : '';
  document.getElementById('asSourceSite').value = s ? (s.sourceSite || 'zapplication') : 'zapplication';
  document.getElementById('asSourceLabel').value = s ? (s.sourceLabel || '') : '';
  document.getElementById('asWebsiteUrl').value = s ? (s.websiteUrl || '') : '';
  document.getElementById('asDeadline').value = s ? (s.deadline || '') : '';
  document.getElementById('asEventDates').value = s ? (s.eventDates || '') : '';
  document.getElementById('asApplicationFee').value = s && s.applicationFee !== undefined && s.applicationFee !== null ? s.applicationFee : '';
  document.getElementById('asBoothFee').value = s && s.boothFee !== undefined && s.boothFee !== null ? s.boothFee : '';
  document.getElementById('asRequirements').value = s ? (s.requirements || '') : '';
  document.getElementById('asStatus').value = s ? (s.status || 'interested') : 'interested';
  artShowsToggleSourceLabel();

  document.getElementById('asModalBg').classList.add('open');
  setTimeout(() => document.getElementById('asName').focus(), 30);
}

function artShowsToggleSourceLabel() {
  const site = document.getElementById('asSourceSite').value;
  document.getElementById('asSourceLabelRow').style.display = site === 'other' ? '' : 'none';
}

function artShowsCloseForm(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('asModalBg').classList.remove('open');
}

async function artShowsSave() {
  const name = document.getElementById('asName').value.trim();
  if (!name) { alert('Show name is required.'); return; }
  const deadline = document.getElementById('asDeadline').value;
  if (!deadline) { alert('Application deadline is required.'); return; }

  const show = {
    id: _artShowsEditId || undefined,
    name,
    location: document.getElementById('asLocation').value.trim(),
    sourceSite: document.getElementById('asSourceSite').value,
    sourceLabel: document.getElementById('asSourceLabel').value.trim(),
    websiteUrl: document.getElementById('asWebsiteUrl').value.trim(),
    deadline,
    eventDates: document.getElementById('asEventDates').value.trim(),
    applicationFee: document.getElementById('asApplicationFee').value === '' ? null : Number(document.getElementById('asApplicationFee').value),
    boothFee: document.getElementById('asBoothFee').value === '' ? null : Number(document.getElementById('asBoothFee').value),
    requirements: document.getElementById('asRequirements').value.trim(),
    status: document.getElementById('asStatus').value,
  };

  const saveBtn = document.getElementById('asSaveBtn');
  if (saveBtn) saveBtn.disabled = true;
  try {
    const resp = await fetch('/api/art-shows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(show),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || ('Save failed (' + resp.status + ')'));
    }
    const res = await resp.json();
    const pos = _artShows.findIndex(x => x.id === res.show.id);
    if (pos !== -1) _artShows[pos] = res.show; else _artShows.push(res.show);
    artShowsCloseForm();
    artShowsRender();
    if (typeof toast === 'function') toast('Show saved', '✓');
  } catch (e) {
    alert('Could not save: ' + e.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function artShowsDelete(id) {
  const s = _artShows.find(x => x.id === id);
  if (!s) return;
  if (!confirm('Delete "' + (s.name || 'this show') + '"?')) return;

  try {
    const resp = await fetch('/api/art-shows?id=' + encodeURIComponent(id), { method: 'DELETE' });
    if (!resp.ok) throw new Error('status ' + resp.status);
    _artShows = _artShows.filter(x => x.id !== id);
    artShowsRender();
    if (typeof toast === 'function') toast('Show deleted', '🗑');
  } catch (e) {
    alert('Could not delete: ' + e.message);
  }
}

function artShowsOpenSource(site) {
  const src = ART_SHOW_SOURCES[site];
  if (src && src.url) window.open(src.url, '_blank', 'noopener');
}
