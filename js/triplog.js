// ════════════════════════════════════════════
//  TRIPLOG  —  js/triplog.js
//  Mileage log, trip viewer, persistent edits,
//  gap trips, odometer chain viewer, health bar
// ════════════════════════════════════════════

const TRIPLOG_PROXY  = 'https://triplog-proxy.kyle-3c9.workers.dev';
const IRS_RATE_2026  = 0.70;
const TL_ODO_KEY     = 'sts-odometer-log';

let tlTrips     = [];   // raw trips from TripLog API (sorted asc)
let tlEdits     = {};   // { tripId: { mileage, startOdometer, endOdometer, activity, notes } }
let tlGapTrips  = [];   // [ { id:'gap-xxx', startTime, endTime, mileage, startOdometer, endOdometer, activity, notes, fromLocation:{display}, toLocation:{display}, _isGapTrip:true } ]
let tlEditingId = null; // id currently open in edit modal (number or 'gap-xxx')
let tlPersistTimer = null; // debounce handle for KV saves

// ── Init ──────────────────────────────────────────────────────────────
function tlInit() {
  if (window._tlInited) return;
  window._tlInited = true;

  const today   = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  document.getElementById('tlStartDate').value = tlFmtDate(weekAgo);
  document.getElementById('tlEndDate').value   = tlFmtDate(today);

  tlLoadPersisted().then(() => {
    odoRender();
    tlFetch();
  });
}

function tlFmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// ── Persist: load from KV (fall back to localStorage) ────────────────
async function tlLoadPersisted() {
  try {
    const res  = await fetch(`${TRIPLOG_PROXY}?action=edits`);
    if (!res.ok) throw new Error('KV load failed');
    const data = await res.json();
    tlEdits    = data.edits    || {};
    tlGapTrips = data.gapTrips || [];
  } catch (e) {
    // Fallback to localStorage
    try { tlEdits    = JSON.parse(localStorage.getItem('sts-triplog-edits')   || '{}'); } catch { tlEdits = {}; }
    try { tlGapTrips = JSON.parse(localStorage.getItem('sts-triplog-gaps')    || '[]'); } catch { tlGapTrips = []; }
    console.warn('KV load failed, using localStorage:', e.message);
  }
}

// ── Persist: save to KV (debounced 800ms) + mirror to localStorage ───
function tlPersist() {
  // Mirror locally immediately (instant fallback)
  try {
    localStorage.setItem('sts-triplog-edits', JSON.stringify(tlEdits));
    localStorage.setItem('sts-triplog-gaps',  JSON.stringify(tlGapTrips));
  } catch {}

  // Debounce KV writes (avoid hammering on rapid edits)
  clearTimeout(tlPersistTimer);
  tlPersistTimer = setTimeout(async () => {
    try {
      await fetch(`${TRIPLOG_PROXY}?action=edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edits: tlEdits, gapTrips: tlGapTrips }),
      });
    } catch (e) {
      console.warn('KV save failed (localStorage still updated):', e.message);
    }
  }, 800);
}

// ── Fetch trips from TripLog API ──────────────────────────────────────
async function tlFetch() {
  const start = document.getElementById('tlStartDate').value;
  const end   = document.getElementById('tlEndDate').value;
  if (!start || !end) { toast('Pick a start and end date', '⚠️'); return; }

  const btn = document.getElementById('tlFetchBtn');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  document.getElementById('tlBody').innerHTML =
    '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-dim)">Fetching trips…</td></tr>';
  document.getElementById('tlEmpty').style.display = 'none';

  try {
    const res  = await fetch(`${TRIPLOG_PROXY}?startDate=${start}&endDate=${end}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    tlTrips = (data.trips || []).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    tlRender();
  } catch (err) {
    document.getElementById('tlBody').innerHTML =
      `<tr><td colspan="6" style="text-align:center;padding:32px;color:#c0392b">
        Error: ${err.message}.<br>
        <span style="font-size:12px;color:var(--text-dim)">Check the proxy or TripLog API key.</span>
      </td></tr>`;
    console.error('TripLog fetch error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Load Trips';
  }
}

// ── Merge API trip with any local edits ───────────────────────────────
function tlMerge(trip) {
  const e = tlEdits[trip.id];
  return e ? { ...trip, ...e } : trip;
}

// ── Build combined sorted trip list (API trips + gap trips in range) ──
function tlCombinedTrips() {
  const start = document.getElementById('tlStartDate').value;
  const end   = document.getElementById('tlEndDate').value;
  const gapsInRange = tlGapTrips.filter(g => {
    const d = g.startTime.slice(0, 10);
    return d >= start && d <= end;
  });
  const all = [
    ...tlTrips.map(tlMerge),
    ...gapsInRange,
  ];
  return all.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
}

// ── Render table + stats + health bar + chain viewer ─────────────────
function tlRender() {
  const trips = tlCombinedTrips();

  tlRenderHealthBar();

  if (!trips.length) {
    document.getElementById('tlBody').innerHTML = '';
    document.getElementById('tlEmpty').style.display = 'block';
    tlRenderStats([]);
    return;
  }
  document.getElementById('tlEmpty').style.display = 'none';
  tlRenderStats(trips);

  // Build chain gap map: for each trip index, check gap BEFORE it
  const chainGaps = {};  // index → gap miles (non-zero = problem)
  for (let i = 1; i < trips.length; i++) {
    const prev = trips[i - 1];
    const curr = trips[i];
    const prevEnd  = prev.endOdometer   ?? null;
    const currStart = curr.startOdometer ?? null;
    if (prevEnd !== null && currStart !== null) {
      const gap = currStart - prevEnd;
      if (Math.abs(gap) >= 0.5) chainGaps[i] = gap;
    }
  }

  const rows = [];
  trips.forEach((t, i) => {
    // Insert chain gap indicator row before this trip if needed
    if (chainGaps[i] !== undefined) {
      const gap     = chainGaps[i];
      const sign    = gap > 0 ? '+' : '';
      const cls     = gap > 0 ? 'tl-chain-gap-over' : 'tl-chain-gap-under';
      const icon    = gap > 0 ? '⚠' : '⚠';
      const label   = gap > 0
        ? `${sign}${gap.toFixed(1)} mi untracked between trips`
        : `${sign}${gap.toFixed(1)} mi — odometer went backwards`;
      rows.push(`<tr class="tl-chain-gap-row ${cls}">
        <td colspan="6">
          <span class="tl-chain-gap-icon">${icon}</span>
          <span class="tl-chain-gap-label">${label}</span>
          ${gap > 0 ? `<button class="tl-gap-add-btn" onclick="tlOpenNewGapTrip(${trips[i-1].endOdometer ?? 0}, ${trips[i].startOdometer ?? 0}, '${trips[i-1].startTime?.slice(0,10) || ''}')">＋ Add Gap Trip</button>` : ''}
        </td>
      </tr>`);
    }

    const dt       = new Date(t.startTime);
    const dateStr  = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr  = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const from     = t.fromLocation?.display || '—';
    const to       = t.toLocation?.display   || '—';
    const miles    = Number(t.mileage || 0).toFixed(1);
    const isBiz    = t.activity === 'Business';
    const isGap    = !!t._isGapTrip;
    const edited   = !!tlEdits[t.id];

    const actBadge = isBiz
      ? `<span class="tl-badge tl-biz">Business</span>`
      : `<span class="tl-badge tl-per">Personal</span>`;

    const editDot = isGap
      ? '<span class="tl-edit-dot tl-gap-dot" title="Local gap trip — not in TripLog">📍</span>'
      : edited
        ? (tlEdits[t.id]._syncFailed
          ? '<span class="tl-edit-dot tl-sync-fail" title="Sync failed — edit saved locally">⚠</span>'
          : '<span class="tl-edit-dot" title="Locally edited — saved to cloud">✎</span>')
        : '';

    const rowClass = isGap ? 'tl-gap-trip-row' : '';

    rows.push(`<tr class="${rowClass}">
      <td class="tl-td-date">${dateStr}<br><span class="tl-time">${timeStr}</span></td>
      <td class="tl-td-route">
        <span class="tl-from">${from}</span>
        <span class="tl-arrow">→</span>
        <span class="tl-to">${to}</span>
      </td>
      <td class="tl-td-miles">${miles}</td>
      <td class="tl-td-act">${actBadge}</td>
      <td class="tl-td-odo">
        <span class="tl-odo">${t.startOdometer?.toLocaleString() ?? '—'} → ${t.endOdometer?.toLocaleString() ?? '—'}</span>
      </td>
      <td class="tl-td-edit">${editDot}
        <button class="tl-edit-btn" onclick="tlOpenEdit('${t.id}')">Edit</button>
        ${isGap ? `<button class="tl-del-btn" onclick="tlDeleteGapTrip('${t.id}')" title="Delete gap trip">✕</button>` : ''}
      </td>
    </tr>`);
  });

  document.getElementById('tlBody').innerHTML = rows.join('');
  odoRender();
}

// ── Health Bar ────────────────────────────────────────────────────────
function tlRenderHealthBar() {
  const bar = document.getElementById('tlHealthBar');
  if (!bar) return;

  const odoLog     = odoLoadLog();
  const lastEntry  = odoLog.length ? odoLog[odoLog.length - 1] : null;
  const lastTrip   = tlTrips.length ? tlTrips[tlTrips.length - 1] : null;
  const lastTLOdo  = lastTrip
    ? (tlEdits[lastTrip.id]?.endOdometer ?? lastTrip.endOdometer)
    : null;

  if (!lastEntry && !lastTLOdo) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';

  const tlOdoStr   = lastTLOdo   != null ? lastTLOdo.toLocaleString()   : '—';
  const logOdoStr  = lastEntry   ? lastEntry.reading.toLocaleString()    : '—';
  const logDate    = lastEntry   ? new Date(lastEntry.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

  let diffHtml = '';
  if (lastEntry && lastTLOdo != null) {
    const diff = lastEntry.reading - lastTLOdo;
    const cls  = diff === 0 ? 'health-ok' : Math.abs(diff) <= 10 ? 'health-warn' : 'health-err';
    const icon = diff === 0 ? '✓' : '⚠';
    diffHtml = `<span class="tl-health-diff ${cls}">${icon} ${diff === 0 ? 'In sync' : `${diff > 0 ? '+' : ''}${diff} mi gap`}</span>`;
  }

  bar.innerHTML = `
    <span class="tl-health-item">
      <span class="tl-health-label">Last TripLog odo</span>
      <span class="tl-health-val">${tlOdoStr}</span>
    </span>
    <span class="tl-health-sep">↔</span>
    <span class="tl-health-item">
      <span class="tl-health-label">Your reading <span style="opacity:0.6">(${logDate})</span></span>
      <span class="tl-health-val">${logOdoStr}</span>
    </span>
    ${diffHtml}
    <button class="tl-health-log-btn" onclick="document.getElementById('odoLogCard').scrollIntoView({behavior:'smooth'})">Log Reading</button>
  `;
}

// ── Stats ─────────────────────────────────────────────────────────────
function tlRenderStats(trips) {
  const totalMiles = trips.reduce((s, t) => s + Number(t.mileage || 0), 0);
  const bizMiles   = trips.filter(t => t.activity === 'Business').reduce((s, t) => s + Number(t.mileage || 0), 0);
  const perMiles   = trips.filter(t => t.activity === 'Personal').reduce((s, t) => s + Number(t.mileage || 0), 0);
  document.getElementById('tlStatTrips').textContent  = trips.length;
  document.getElementById('tlStatTotal').textContent  = totalMiles.toFixed(1);
  document.getElementById('tlStatBiz').textContent    = bizMiles.toFixed(1);
  document.getElementById('tlStatPer').textContent    = perMiles.toFixed(1);
  document.getElementById('tlStatReimb').textContent  = '$' + (bizMiles * IRS_RATE_2026).toFixed(2);
}

// ── Edit Modal (works for both API trips and gap trips) ───────────────
function tlOpenEdit(id) {
  // id may be a number (API trip) or string like 'gap-xxx'
  const isGap   = String(id).startsWith('gap-');
  const raw     = isGap
    ? tlGapTrips.find(g => g.id === id)
    : tlTrips.find(t => t.id === Number(id));
  if (!raw) return;
  const trip    = isGap ? raw : tlMerge(raw);
  tlEditingId   = isGap ? id : Number(id);

  document.getElementById('tlEditTitle').textContent =
    `${isGap ? '📍 Edit Gap Trip' : 'Edit Trip'} — ${new Date(trip.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
  document.getElementById('tlEditFrom').textContent   = trip.fromLocation?.display || '—';
  document.getElementById('tlEditTo').textContent     = trip.toLocation?.display   || '—';
  document.getElementById('tlEditMiles').value        = Number(trip.mileage || 0).toFixed(1);
  document.getElementById('tlEditStartOdo').value     = trip.startOdometer ?? '';
  document.getElementById('tlEditEndOdo').value       = trip.endOdometer   ?? '';
  document.getElementById('tlEditActivity').value     = trip.activity      || 'Personal';
  document.getElementById('tlEditNotes').value        = trip.notes         || '';
  document.getElementById('tlEditResetBtn').style.display = (!isGap && tlEdits[id]) ? 'inline-flex' : 'none';

  document.getElementById('tlEditModal').classList.add('active');
  document.getElementById('tlEditOverlay').classList.add('active');
}

function tlCloseEdit() {
  document.getElementById('tlEditModal').classList.remove('active');
  document.getElementById('tlEditOverlay').classList.remove('active');
  tlEditingId = null;
}

function tlAutoCalcMiles() {
  const start = parseFloat(document.getElementById('tlEditStartOdo').value);
  const end   = parseFloat(document.getElementById('tlEditEndOdo').value);
  if (!isNaN(start) && !isNaN(end) && end >= start) {
    document.getElementById('tlEditMiles').value = (end - start).toFixed(1);
  }
}

async function tlSaveEdit() {
  if (tlEditingId === null) return;
  const miles    = parseFloat(document.getElementById('tlEditMiles').value);
  const startOdo = parseFloat(document.getElementById('tlEditStartOdo').value);
  const endOdo   = parseFloat(document.getElementById('tlEditEndOdo').value);
  const activity = document.getElementById('tlEditActivity').value;
  const notes    = document.getElementById('tlEditNotes').value.trim();

  if (isNaN(miles) || miles < 0) { toast('Enter a valid mileage', '⚠️'); return; }

  const isGap = String(tlEditingId).startsWith('gap-');
  const saveBtn = document.getElementById('tlEditSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  const id = tlEditingId;
  tlCloseEdit();

  if (isGap) {
    // Gap trip — update locally only
    const idx = tlGapTrips.findIndex(g => g.id === id);
    if (idx >= 0) {
      tlGapTrips[idx] = {
        ...tlGapTrips[idx],
        mileage:       miles,
        startOdometer: isNaN(startOdo) ? tlGapTrips[idx].startOdometer : startOdo,
        endOdometer:   isNaN(endOdo)   ? tlGapTrips[idx].endOdometer   : endOdo,
        activity,
        notes: notes || null,
      };
    }
    tlPersist();
    toast('Gap trip updated ✓', '📍');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
    tlRender();
    return;
  }

  // API trip — try to sync to TripLog, persist edit regardless
  const edit = {
    mileage:       miles,
    startOdometer: isNaN(startOdo) ? undefined : startOdo,
    endOdometer:   isNaN(endOdo)   ? undefined : endOdo,
    activity,
    notes: notes || null,
  };
  Object.keys(edit).forEach(k => { if (edit[k] === undefined) delete edit[k]; });

  try {
    const res = await fetch(`${TRIPLOG_PROXY}?tripId=${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    delete tlEdits[id];
    tlPersist();
    toast('Trip synced to TripLog ✓', '🚗');
  } catch (err) {
    tlEdits[id] = { ...edit, _syncFailed: true };
    tlPersist();
    toast('Sync failed — edit saved to cloud ✓', '⚠️');
    console.error('TripLog write error:', err);
  }

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
  tlRender();
}

function tlResetEdit() {
  if (tlEditingId === null || String(tlEditingId).startsWith('gap-')) return;
  delete tlEdits[tlEditingId];
  tlPersist();
  tlCloseEdit();
  tlRender();
  toast('Edit cleared — showing original TripLog data', '↺');
}

// ── Gap Trip Creation ─────────────────────────────────────────────────
// Called from chain gap indicator row (pre-filled with odo context)
function tlOpenNewGapTrip(startOdo, endOdo, date) {
  document.getElementById('gapTripModal').classList.add('active');
  document.getElementById('gapTripOverlay').classList.add('active');
  document.getElementById('gapTripDate').value       = date || tlFmtDate(new Date());
  document.getElementById('gapTripStartOdo').value   = startOdo || '';
  document.getElementById('gapTripEndOdo').value     = endOdo   || '';
  document.getElementById('gapTripActivity').value   = 'Personal';
  document.getElementById('gapTripFrom').value       = '';
  document.getElementById('gapTripTo').value         = '';
  document.getElementById('gapTripNotes').value      = '';
  gapAutoCalcMiles();
}

// Also accessible via "+ Add Gap Trip" button in the UI
function tlOpenNewGapTripBlank() {
  tlOpenNewGapTrip('', '', tlFmtDate(new Date()));
}

function gapAutoCalcMiles() {
  const start = parseFloat(document.getElementById('gapTripStartOdo').value);
  const end   = parseFloat(document.getElementById('gapTripEndOdo').value);
  const el    = document.getElementById('gapTripMiles');
  if (!isNaN(start) && !isNaN(end) && end >= start) {
    el.value = (end - start).toFixed(1);
  }
}

function tlCloseGapTrip() {
  document.getElementById('gapTripModal').classList.remove('active');
  document.getElementById('gapTripOverlay').classList.remove('active');
}

function tlSaveGapTrip() {
  const date     = document.getElementById('gapTripDate').value;
  const startOdo = parseFloat(document.getElementById('gapTripStartOdo').value);
  const endOdo   = parseFloat(document.getElementById('gapTripEndOdo').value);
  const miles    = parseFloat(document.getElementById('gapTripMiles').value);
  const activity = document.getElementById('gapTripActivity').value;
  const from     = document.getElementById('gapTripFrom').value.trim()  || 'Unknown';
  const to       = document.getElementById('gapTripTo').value.trim()    || 'Unknown';
  const notes    = document.getElementById('gapTripNotes').value.trim() || null;

  if (!date)         { toast('Enter a date', '⚠️'); return; }
  if (isNaN(miles) || miles <= 0) { toast('Enter valid mileage', '⚠️'); return; }

  const newGap = {
    id:            'gap-' + Date.now(),
    startTime:     date + 'T00:00:00.000Z',
    endTime:       date + 'T00:00:00.000Z',
    mileage:       miles,
    startOdometer: isNaN(startOdo) ? null : startOdo,
    endOdometer:   isNaN(endOdo)   ? null : endOdo,
    activity,
    notes,
    fromLocation:  { display: from },
    toLocation:    { display: to },
    _isGapTrip:    true,
  };

  tlGapTrips.push(newGap);
  tlPersist();
  tlCloseGapTrip();
  tlRender();
  toast('Gap trip added ✓', '📍');
}

function tlDeleteGapTrip(id) {
  if (!confirm('Delete this gap trip?')) return;
  tlGapTrips = tlGapTrips.filter(g => g.id !== id);
  tlPersist();
  tlRender();
  toast('Gap trip deleted', '🗑');
}

// ── Export to CSV (includes gap trips + local edits) ──────────────────
function tlExportCSV() {
  const trips = tlCombinedTrips();
  if (!trips.length) { toast('No trips to export', '⚠️'); return; }

  const rows = [['Date', 'Start Time', 'From', 'To', 'Miles', 'Activity',
                 'Start Odometer', 'End Odometer', 'Notes', 'Reimbursement', 'Source']];
  trips.forEach(t => {
    const dt    = new Date(t.startTime);
    const reimb = t.activity === 'Business' ? (Number(t.mileage || 0) * IRS_RATE_2026).toFixed(2) : '0.00';
    const src   = t._isGapTrip ? 'Gap Trip (Local)' : (tlEdits[t.id] ? 'TripLog (Edited)' : 'TripLog');
    rows.push([
      dt.toLocaleDateString('en-US'),
      dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      t.fromLocation?.display || '',
      t.toLocation?.display   || '',
      Number(t.mileage || 0).toFixed(1),
      t.activity || '',
      t.startOdometer ?? '',
      t.endOdometer   ?? '',
      t.notes         || '',
      reimb,
      src,
    ]);
  });

  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: `trips-${document.getElementById('tlStartDate').value}-to-${document.getElementById('tlEndDate').value}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV exported', '📥');
}

// ════════════════════════════════════════════
//  TRIP VERIFICATION — header pill
// ════════════════════════════════════════════

const TV_KEY = 'sts-trips-verified';
let tvLoaded = false, tvPanelOpen = false;

function tvInit() {
  const day = new Date().getDay();
  if (day < 1 || day > 5) return;
  if (localStorage.getItem(TV_KEY) === tlFmtDate(new Date())) return;
  document.getElementById('tvWrap').style.display = 'block';
}

function tvToggle() {
  const panel = document.getElementById('tvPanel');
  tvPanelOpen = !tvPanelOpen;
  panel.style.display = tvPanelOpen ? 'block' : 'none';
  if (tvPanelOpen && !tvLoaded) tvLoadYesterday();
}

async function tvLoadYesterday() {
  tvLoaded = true;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr  = tlFmtDate(yesterday);
  const dayLabel = yesterday.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  document.getElementById('tvPanelDate').textContent = `${dayLabel}'s Trips`;
  document.getElementById('tvPanelBody').innerHTML   =
    '<div style="text-align:center;padding:20px;color:var(--text-dim)">Loading…</div>';

  try {
    const res   = await fetch(`${TRIPLOG_PROXY}?startDate=${dateStr}&endDate=${dateStr}`);
    const data  = await res.json();
    const trips = (data.trips || []).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    tvRenderPanel(trips, dayLabel);
  } catch (e) {
    document.getElementById('tvPanelBody').innerHTML =
      `<div class="tv-no-trips">Could not load trips: ${e.message}</div>`;
  }
}

function tvRenderPanel(trips, dayLabel) {
  if (!trips.length) {
    document.getElementById('tvPanelBody').innerHTML =
      `<div class="tv-no-trips">No trips recorded for ${dayLabel}.<br>
       <span style="font-size:11px">If you drove, trips may be missing.</span></div>`;
    return;
  }
  const totalMiles = trips.reduce((s, t) => s + Number(t.mileage || 0), 0);
  const startOdo   = trips[0].startOdometer;
  const endOdo     = trips[trips.length - 1].endOdometer;
  const rows = trips.map(t => {
    const time = new Date(t.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `<div class="tv-trip-row">
      <span class="tv-trip-time">${time}</span>
      <span class="tv-trip-route"><span class="tv-trip-from">${t.fromLocation?.display || '—'}</span><br>→ ${t.toLocation?.display || '—'}</span>
      <span class="tv-trip-miles">${Number(t.mileage || 0).toFixed(1)} mi</span>
    </div>`;
  }).join('');
  document.getElementById('tvPanelBody').innerHTML =
    rows + `<div class="tv-summary">${trips.length} trip${trips.length > 1 ? 's' : ''} · ${totalMiles.toFixed(1)} mi · Odo: ${startOdo?.toLocaleString() ?? '—'} → ${endOdo?.toLocaleString() ?? '—'}</div>`;
}

function tvConfirm() {
  localStorage.setItem(TV_KEY, tlFmtDate(new Date()));
  document.getElementById('tvWrap').style.display = 'none';
  document.getElementById('tvPanel').style.display = 'none';
  tvPanelOpen = false;
  toast('Trips verified ✓', '🚗');
}

function tvFlag() {
  localStorage.setItem(TV_KEY, tlFmtDate(new Date()));
  document.getElementById('tvWrap').style.display = 'none';
  document.getElementById('tvPanel').style.display = 'none';
  tvPanelOpen = false;
  toast('Flagged — check TripLog for missing or incorrect trips', '⚠️');
}

document.addEventListener('click', function (e) {
  if (tvPanelOpen && !e.target.closest('.tv-wrap')) {
    document.getElementById('tvPanel').style.display = 'none';
    tvPanelOpen = false;
  }
});

document.addEventListener('DOMContentLoaded', tvInit);

// ════════════════════════════════════════════
//  ODOMETER LOG
// ════════════════════════════════════════════

function odoLoadLog() {
  try { return JSON.parse(localStorage.getItem(TL_ODO_KEY) || '[]'); } catch { return []; }
}
function odoSaveLog(log) {
  try { localStorage.setItem(TL_ODO_KEY, JSON.stringify(log)); } catch {}
}

function odoRender() {
  const log = odoLoadLog();

  const banner = document.getElementById('odoWeekdayBanner');
  if (banner) {
    const day = new Date().getDay();
    const alreadyToday = log.some(e => e.date === tlFmtDate(new Date()));
    banner.style.display = (day >= 1 && day <= 5 && !alreadyToday) ? 'flex' : 'none';
  }

  const lastTrip  = tlTrips.length ? tlTrips[tlTrips.length - 1] : null;
  const lastTLOdo = lastTrip ? (tlEdits[lastTrip.id]?.endOdometer ?? lastTrip.endOdometer) : null;
  const lastEntry = log.length ? log[log.length - 1] : null;

  const lastTLEl  = document.getElementById('odoLastTL');
  const lastLogEl = document.getElementById('odoLastLogged');
  const deltaEl   = document.getElementById('odoDelta');

  if (lastTLEl)  lastTLEl.textContent  = lastTLOdo  != null ? lastTLOdo.toLocaleString()    : '—';
  if (lastLogEl) lastLogEl.textContent = lastEntry   ? lastEntry.reading.toLocaleString()    : '—';

  if (deltaEl) {
    if (lastEntry && lastTLOdo != null) {
      const diff = lastEntry.reading - lastTLOdo;
      deltaEl.textContent = diff === 0 ? '✓ In sync' : `${diff > 0 ? '+' : ''}${diff} mi vs TripLog`;
      deltaEl.className   = 'odo-delta ' + (diff === 0 ? 'ok' : diff > 0 ? 'warn' : 'err');
    } else {
      deltaEl.textContent = '—';
      deltaEl.className   = 'odo-delta';
    }
  }

  const tbody = document.getElementById('odoHistoryBody');
  if (!tbody) return;
  if (!log.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-dim)">No readings logged yet</td></tr>';
    return;
  }
  tbody.innerHTML = [...log].reverse().map(e => {
    const diff    = lastTLOdo != null ? (e.reading - lastTLOdo) : null;
    const diffStr = diff === null ? '—'
      : diff === 0 ? '<span class="odo-delta ok">✓ Sync</span>'
      : `<span class="odo-delta ${diff > 0 ? 'warn' : 'err'}">${diff > 0 ? '+' : ''}${diff}</span>`;
    return `<tr>
      <td>${new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</td>
      <td style="font-weight:700">${e.reading.toLocaleString()}</td>
      <td>${diffStr}</td>
      <td style="color:var(--text-dim);font-size:12px">${e.notes || '—'}</td>
    </tr>`;
  }).join('');

  tlRenderHealthBar();
}

async function odoSaveReading() {
  const readingVal = document.getElementById('odoReadingInput').value.trim();
  const notes      = document.getElementById('odoNotesInput').value.trim();
  const reading    = parseInt(readingVal, 10);
  if (isNaN(reading) || reading < 0) { toast('Enter a valid odometer reading', '⚠️'); return; }

  const log     = odoLoadLog();
  const today   = tlFmtDate(new Date());
  const filtered = log.filter(e => e.date !== today);
  filtered.push({ date: today, reading, notes: notes || null });
  odoSaveLog(filtered);

  document.getElementById('odoReadingInput').value = '';
  document.getElementById('odoNotesInput').value   = '';
  odoRender();
  toast('Odometer reading saved', '🚗');
  await odoReconcile(filtered);
}

// ════════════════════════════════════════════
//  MILEAGE RECONCILIATION
// ════════════════════════════════════════════

async function odoReconcile(log) {
  if (!log) log = odoLoadLog();
  if (log.length < 2) {
    toast('Log yesterday\'s odometer first to reconcile', '⚠️');
    return;
  }
  const current  = log[log.length - 1];
  const previous = log[log.length - 2];
  const actualMiles = current.reading - previous.reading;
  const startDate   = previous.date;
  const endDate     = current.date;

  let trips;
  try {
    const res  = await fetch(`${TRIPLOG_PROXY}?startDate=${startDate}&endDate=${endDate}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    trips = (data.trips || []).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  } catch (err) {
    toast('Could not fetch trips for reconciliation', '⚠️');
    return;
  }

  if (!trips.length) {
    toast('No trips recorded for this period — check TripLog for missing trips', '⚠️');
    return;
  }

  const recordedMiles = trips.reduce((s, t) => s + Number(t.mileage || 0), 0);
  const gap = actualMiles - recordedMiles;
  if (Math.abs(gap) < 0.1) { toast('✓ In sync — no mileage correction needed', '🚗'); return; }

  const proposed = trips.map(t => {
    const orig  = Number(t.mileage || 0);
    const share = recordedMiles > 0 ? orig / recordedMiles : 1 / trips.length;
    return { ...t, _origMileage: orig, _proposedMileage: Math.max(0, parseFloat((orig + gap * share).toFixed(1))) };
  });

  odoShowReconcilePanel(proposed, actualMiles, recordedMiles, gap, startDate, endDate);
}

function odoShowReconcilePanel(trips, actualMiles, recordedMiles, gap, startDate, endDate) {
  const gapSign   = gap > 0 ? '+' : '';
  const dateLabel = startDate === endDate
    ? new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : `${startDate} → ${endDate}`;

  document.getElementById('reconPeriod').textContent   = dateLabel;
  document.getElementById('reconActual').textContent   = actualMiles.toFixed(1);
  document.getElementById('reconRecorded').textContent = recordedMiles.toFixed(1);
  document.getElementById('reconGap').textContent      = `${gapSign}${gap.toFixed(1)} mi`;
  document.getElementById('reconGap').className        = 'recon-gap ' + (gap > 0 ? 'recon-over' : 'recon-under');

  document.getElementById('reconTripBody').innerHTML = trips.map(t => {
    const dt   = new Date(t.startTime);
    const diff = t._proposedMileage - t._origMileage;
    const diffStr = diff === 0 ? '' : `<span class="recon-diff ${diff > 0 ? 'recon-over' : 'recon-under'}">${diff > 0 ? '+' : ''}${diff.toFixed(1)}</span>`;
    return `<tr>
      <td style="color:var(--text-dim);font-size:12px">${dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}<br>${dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</td>
      <td style="font-size:12px">${t.fromLocation?.display||'—'} → ${t.toLocation?.display||'—'}</td>
      <td style="text-align:right">${t._origMileage.toFixed(1)}</td>
      <td style="text-align:right;font-weight:700">${t._proposedMileage.toFixed(1)} ${diffStr}</td>
    </tr>`;
  }).join('');

  document.getElementById('reconModal')._trips = trips;
  document.getElementById('reconModal').classList.add('active');
  document.getElementById('reconOverlay').classList.add('active');
}

function odoCloseReconcile() {
  document.getElementById('reconModal').classList.remove('active');
  document.getElementById('reconOverlay').classList.remove('active');
}

async function odoApplyReconcile() {
  const trips   = document.getElementById('reconModal')._trips;
  if (!trips?.length) return;

  const applyBtn = document.getElementById('reconApplyBtn');
  applyBtn.disabled = true; applyBtn.textContent = 'Syncing…';

  let ok = 0, fail = 0;
  for (const t of trips) {
    if (Math.abs(t._proposedMileage - t._origMileage) < 0.05) { ok++; continue; }
    try {
      const res = await fetch(`${TRIPLOG_PROXY}?tripId=${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mileage: t._proposedMileage }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      delete tlEdits[t.id];
      ok++;
    } catch (err) {
      tlEdits[t.id] = { mileage: t._proposedMileage, _syncFailed: true };
      fail++;
    }
  }

  tlPersist();
  applyBtn.disabled = false; applyBtn.textContent = 'Apply & Sync';
  odoCloseReconcile();

  if (fail === 0) toast(`Reconciliation complete — ${ok} trip${ok !== 1 ? 's' : ''} synced ✓`, '🚗');
  else            toast(`${ok} synced, ${fail} failed — failed trips saved to cloud`, '⚠️');

  tlRender();
}

function odoDeleteLast() {
  const log = odoLoadLog();
  if (!log.length) return;
  if (!confirm('Delete the most recent odometer entry?')) return;
  log.pop();
  odoSaveLog(log);
  odoRender();
  toast('Entry deleted', '🗑');
}

// ── Dashboard widget: latest trip + expected odometer ─────────────────
let _dashTriplogLoaded = false;

async function dashTriplogLoad(force) {
  if (!force && _dashTriplogLoaded) return;
  _dashTriplogLoaded = true;

  const el = document.getElementById('tlDashContent');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--text3);font-size:13px;">Loading…</span>';

  const today   = new Date();
  const lookback = new Date(today);
  lookback.setDate(today.getDate() - 14);
  const start = lookback.toISOString().slice(0, 10);
  const end   = today.toISOString().slice(0, 10);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res  = await fetch(`${TRIPLOG_PROXY}?startDate=${start}&endDate=${end}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const trips = (data.trips || []).sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    dashTriplogRender(trips[0] || null);
  } catch (err) {
    clearTimeout(timeout);
    const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
    el.innerHTML = `<span style="color:#c0392b;font-size:13px;">⚠ Couldn't load trips — ${msg}</span>`;
  }
}

function dashTriplogRender(trip) {
  const el = document.getElementById('tlDashContent');
  if (!el) return;

  if (!trip) {
    el.innerHTML = '<span style="color:var(--text3);font-size:13px;">No recent trips found.</span>';
    return;
  }

  const dt       = new Date(trip.startTime);
  const dateStr  = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const miles    = (trip.mileage ?? 0).toFixed(1);
  const odo      = trip.endOdometer != null ? Math.round(trip.endOdometer).toLocaleString() : '—';
  const from     = trip.fromLocation?.display || '—';
  const to       = trip.toLocation?.display   || '—';
  const activity = trip.activity || '—';

  el.innerHTML = `
    <div class="tl-dash-date-block">
      <div class="tl-dash-date">${dateStr}</div>
      <div class="tl-dash-activity">${activity}</div>
    </div>
    <div class="tl-dash-route">
      <span class="tl-dash-from">${from}</span>
      <span class="tl-dash-arrow">→</span>
      <span class="tl-dash-to">${to}</span>
    </div>
    <div class="tl-dash-divider"></div>
    <div class="tl-dash-stats">
      <div class="tl-dash-stat">
        <div class="tl-dash-stat-val">${miles}</div>
        <div class="tl-dash-stat-lbl">Miles</div>
      </div>
      <div class="tl-dash-stat" title="Odometer at end of this trip">
        <div class="tl-dash-stat-val">${odo}</div>
        <div class="tl-dash-stat-lbl">Odometer</div>
      </div>
    </div>
  `;
}
