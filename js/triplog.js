// ════════════════════════════════════════════
//  TRIPLOG  —  js/triplog.js
//  Mileage log, trip viewer, local edits
// ════════════════════════════════════════════

// Requests go through a Cloudflare Worker proxy to avoid CORS
const TRIPLOG_PROXY     = 'https://triplog-proxy.kyle-3c9.workers.dev';
const IRS_RATE_2026     = 0.70;   // $0.70/mile — update each Jan if needed
const TL_STORAGE_KEY    = 'sts-triplog-edits';
const TL_ODO_KEY        = 'sts-odometer-log';  // weekly odometer readings

let tlTrips      = [];   // raw trips from API
let tlEdits      = {};   // { tripId: { mileage, startOdometer, endOdometer, activity, notes } }
let tlEditingId  = null; // trip id currently open in edit modal

// ── Init ──────────────────────────────────────
function tlInit() {
  if (window._tlInited) return;
  window._tlInited = true;

  // Set default date range: last 7 days
  const today   = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  document.getElementById('tlStartDate').value = tlFmtDate(weekAgo);
  document.getElementById('tlEndDate').value   = tlFmtDate(today);

  // Load any saved local edits
  try { tlEdits = JSON.parse(localStorage.getItem(TL_STORAGE_KEY) || '{}'); } catch(e) { tlEdits = {}; }

  odoRender();
  tlFetch();
}

function tlFmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// ── Fetch trips from TripLog API ─────────────
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
    const url = `${TRIPLOG_PROXY}?startDate=${start}&endDate=${end}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    tlTrips = (data.trips || []).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    tlRender();
  } catch(err) {
    document.getElementById('tlBody').innerHTML =
      `<tr><td colspan="6" style="text-align:center;padding:32px;color:#c0392b">
        Error: ${err.message}.<br>
        <span style="font-size:12px;color:var(--text-dim)">TripLog's API may not allow browser requests (CORS). Try the MCP server instead.</span>
      </td></tr>`;
    console.error('TripLog fetch error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Load Trips';
  }
}

// ── Merge API trip with any local edits ───────
function tlMerge(trip) {
  const e = tlEdits[trip.id];
  if (!e) return trip;
  return { ...trip, ...e };
}

// ── Render table + summary stats ─────────────
function tlRender() {
  const trips = tlTrips.map(tlMerge);

  if (!trips.length) {
    document.getElementById('tlBody').innerHTML = '';
    document.getElementById('tlEmpty').style.display = 'block';
    tlRenderStats([]);
    return;
  }
  document.getElementById('tlEmpty').style.display = 'none';

  // ── Stats
  tlRenderStats(trips);

  // ── Table rows
  const rows = trips.map(t => {
    const dt        = new Date(t.startTime);
    const dateStr   = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr   = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const from      = t.fromLocation?.display || '—';
    const to        = t.toLocation?.display   || '—';
    const miles     = Number(t.mileage || 0).toFixed(1);
    const isBiz     = t.activity === 'Business';
    const edited    = !!tlEdits[t.id];
    const actBadge  = isBiz
      ? `<span class="tl-badge tl-biz">Business</span>`
      : `<span class="tl-badge tl-per">Personal</span>`;
    const editDot   = edited ? '<span class="tl-edit-dot" title="Locally edited">✎</span>' : '';

    return `<tr>
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
        <button class="tl-edit-btn" onclick="tlOpenEdit(${t.id})">Edit</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('tlBody').innerHTML = rows;
  odoRender(); // refresh delta now that trips are loaded
}

function tlRenderStats(trips) {
  const totalMiles = trips.reduce((s, t) => s + Number(t.mileage || 0), 0);
  const bizMiles   = trips.filter(t => t.activity === 'Business').reduce((s, t) => s + Number(t.mileage || 0), 0);
  const perMiles   = trips.filter(t => t.activity === 'Personal').reduce((s, t) => s + Number(t.mileage || 0), 0);
  const reimburse  = bizMiles * IRS_RATE_2026;

  document.getElementById('tlStatTrips').textContent   = trips.length;
  document.getElementById('tlStatTotal').textContent   = totalMiles.toFixed(1);
  document.getElementById('tlStatBiz').textContent     = bizMiles.toFixed(1);
  document.getElementById('tlStatPer').textContent     = perMiles.toFixed(1);
  document.getElementById('tlStatReimb').textContent   = '$' + reimburse.toFixed(2);
}

// ── Edit Modal ────────────────────────────────
function tlOpenEdit(id) {
  const raw  = tlTrips.find(t => t.id === id);
  if (!raw) return;
  const trip = tlMerge(raw);
  tlEditingId = id;

  document.getElementById('tlEditTitle').textContent =
    `Edit Trip — ${new Date(trip.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
  document.getElementById('tlEditFrom').textContent   = trip.fromLocation?.display || '—';
  document.getElementById('tlEditTo').textContent     = trip.toLocation?.display   || '—';
  document.getElementById('tlEditMiles').value        = Number(trip.mileage || 0).toFixed(1);
  document.getElementById('tlEditStartOdo').value     = trip.startOdometer ?? '';
  document.getElementById('tlEditEndOdo').value       = trip.endOdometer   ?? '';
  document.getElementById('tlEditActivity').value     = trip.activity       || 'Business';
  document.getElementById('tlEditNotes').value        = trip.notes          || '';

  // Show reset btn only if edits exist
  document.getElementById('tlEditResetBtn').style.display = tlEdits[id] ? 'inline-flex' : 'none';

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

function tlSaveEdit() {
  if (!tlEditingId) return;
  const miles    = parseFloat(document.getElementById('tlEditMiles').value);
  const startOdo = parseFloat(document.getElementById('tlEditStartOdo').value);
  const endOdo   = parseFloat(document.getElementById('tlEditEndOdo').value);
  const activity = document.getElementById('tlEditActivity').value;
  const notes    = document.getElementById('tlEditNotes').value.trim();

  if (isNaN(miles) || miles < 0) { toast('Enter a valid mileage', '⚠️'); return; }

  tlEdits[tlEditingId] = {
    mileage:        miles,
    startOdometer:  isNaN(startOdo) ? undefined : startOdo,
    endOdometer:    isNaN(endOdo)   ? undefined : endOdo,
    activity,
    notes:          notes || null,
  };
  // Remove undefined keys
  Object.keys(tlEdits[tlEditingId]).forEach(k => {
    if (tlEdits[tlEditingId][k] === undefined) delete tlEdits[tlEditingId][k];
  });

  try { localStorage.setItem(TL_STORAGE_KEY, JSON.stringify(tlEdits)); } catch(e) {}

  tlCloseEdit();
  tlRender();
  toast('Trip updated locally', '✎');
}

function tlResetEdit() {
  if (!tlEditingId) return;
  delete tlEdits[tlEditingId];
  try { localStorage.setItem(TL_STORAGE_KEY, JSON.stringify(tlEdits)); } catch(e) {}
  tlCloseEdit();
  tlRender();
  toast('Edit cleared — showing original', '↺');
}

// ── Export to CSV ─────────────────────────────
function tlExportCSV() {
  if (!tlTrips.length) { toast('No trips to export', '⚠️'); return; }
  const trips = tlTrips.map(tlMerge);
  const rows  = [['Date', 'Start Time', 'From', 'To', 'Miles', 'Activity', 'Start Odometer', 'End Odometer', 'Notes', 'Reimbursement']];
  trips.forEach(t => {
    const dt   = new Date(t.startTime);
    const reimb = t.activity === 'Business' ? (Number(t.mileage || 0) * IRS_RATE_2026).toFixed(2) : '0.00';
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
    ]);
  });
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `trips-${document.getElementById('tlStartDate').value}-to-${document.getElementById('tlEndDate').value}.csv` });
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported', '📥');
}

// ════════════════════════════════════════════
//  ODOMETER LOG
// ════════════════════════════════════════════

function odoLoadLog() {
  try { return JSON.parse(localStorage.getItem(TL_ODO_KEY) || '[]'); } catch(e) { return []; }
}

function odoSaveLog(log) {
  try { localStorage.setItem(TL_ODO_KEY, JSON.stringify(log)); } catch(e) {}
}

function odoRender() {
  const log = odoLoadLog();
  const isFriday = new Date().getDay() === 5;

  // Friday banner
  const banner = document.getElementById('odoFridayBanner');
  if (banner) {
    const alreadyLoggedToday = log.some(e => e.date === tlFmtDate(new Date()));
    banner.style.display = (isFriday && !alreadyLoggedToday) ? 'flex' : 'none';
  }

  // Last TripLog odometer
  const lastTrip = tlTrips.length ? tlTrips[tlTrips.length - 1] : null;
  const lastTLOdo = lastTrip ? (tlEdits[lastTrip.id]?.endOdometer ?? lastTrip.endOdometer) : null;
  const lastTLEl = document.getElementById('odoLastTL');
  if (lastTLEl) lastTLEl.textContent = lastTLOdo ? lastTLOdo.toLocaleString() : '—';

  // Last logged reading & delta
  const lastEntry = log[log.length - 1];
  const lastLogEl = document.getElementById('odoLastLogged');
  const deltaEl   = document.getElementById('odoDelta');
  if (lastLogEl) lastLogEl.textContent = lastEntry ? lastEntry.reading.toLocaleString() : '—';
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

  // History table
  const tbody = document.getElementById('odoHistoryBody');
  if (!tbody) return;
  if (!log.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-dim)">No readings logged yet</td></tr>';
    return;
  }
  tbody.innerHTML = [...log].reverse().map(e => {
    const diff = (lastTLOdo != null) ? (e.reading - lastTLOdo) : null;
    const diffStr = diff === null ? '—' : (diff === 0 ? '<span class="odo-delta ok">✓ Sync</span>' : `<span class="odo-delta ${diff > 0 ? 'warn' : 'err'}">${diff > 0 ? '+' : ''}${diff}</span>`);
    return `<tr>
      <td>${new Date(e.date + 'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</td>
      <td style="font-weight:700">${e.reading.toLocaleString()}</td>
      <td>${diffStr}</td>
      <td style="color:var(--text-dim);font-size:12px">${e.notes || '—'}</td>
    </tr>`;
  }).join('');
}

function odoSaveReading() {
  const readingVal = document.getElementById('odoReadingInput').value.trim();
  const notes      = document.getElementById('odoNotesInput').value.trim();
  const reading    = parseInt(readingVal, 10);
  if (isNaN(reading) || reading < 0) { toast('Enter a valid odometer reading', '⚠️'); return; }

  const log   = odoLoadLog();
  const today = tlFmtDate(new Date());
  // Remove any existing entry for today before adding updated one
  const filtered = log.filter(e => e.date !== today);
  filtered.push({ date: today, reading, notes: notes || null });
  odoSaveLog(filtered);

  document.getElementById('odoReadingInput').value = '';
  document.getElementById('odoNotesInput').value   = '';
  odoRender();
  toast('Odometer reading saved', '🚗');
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
