// ════════════════════════════════════════════
//  CALENDAR  —  js/calendar.js
//  Google Calendar API v3 + Gmail date scanner
// ════════════════════════════════════════════

const CAL_TOKEN_KEY  = 'sts-gcal-token';
const CAL_EXPIRY_KEY = 'sts-gcal-token-expiry';

let _calOauthCallback = null;
let _calCurrentDate   = new Date();
let _calEvents        = [];

// ── Token helpers ─────────────────────────────

function calGetToken() {
  const token  = localStorage.getItem(CAL_TOKEN_KEY);
  const expiry = parseInt(localStorage.getItem(CAL_EXPIRY_KEY) || '0');
  if (token && Date.now() < expiry - 60000) return token;
  return null;
}

function calClearToken() {
  localStorage.removeItem(CAL_TOKEN_KEY);
  localStorage.removeItem(CAL_EXPIRY_KEY);
  calShowConnect();
}

// ── OAuth ─────────────────────────────────────

window.addEventListener('message', function (e) {
  if (e.origin !== window.location.origin) return;
  if (!e.data || e.data.type !== 'sts-google-oauth') return;
  if (!_calOauthCallback) return;
  localStorage.setItem(CAL_TOKEN_KEY, e.data.token);
  localStorage.setItem(CAL_EXPIRY_KEY, String(Date.now() + parseInt(e.data.expiresIn) * 1000));
  toast('Google Calendar + Gmail connected ✓', '📅');
  const cb = _calOauthCallback; _calOauthCallback = null; cb();
});

function calTriggerOAuth(callback) {
  const clientId = localStorage.getItem('sts-google-client-id');
  if (!clientId) {
    openIntegrationsModal();
    toast('Set your Google Client ID in Integrations first', 'ℹ');
    return;
  }
  _calOauthCallback = callback;
  const redirectUri = window.location.origin + window.location.pathname;
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.readonly'
  ].join(' ');
  const url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id='    + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&response_type=token'
    + '&scope='        + encodeURIComponent(scopes)
    + '&prompt=consent'
    + '&login_hint=kyle%40stonesthrowjewelry.com';
  const popup = window.open(url, 'gcal-oauth', 'width=520,height=620,scrollbars=yes,resizable=yes');
  if (!popup) {
    toast('Popup blocked — allow popups and try again', '⚠');
    _calOauthCallback = null;
  }
}

// ── Calendar API helpers ──────────────────────

function calFetch(path, options) {
  const token = calGetToken();
  if (!token) return Promise.reject(new Error('no-token'));
  return fetch('https://www.googleapis.com/calendar/v3' + path, Object.assign({
    headers: { Authorization: 'Bearer ' + token }
  }, options || {}));
}

function gmailFetch(path) {
  const token = calGetToken();
  if (!token) return Promise.reject(new Error('no-token'));
  return fetch('https://www.googleapis.com/gmail/v1' + path, {
    headers: { Authorization: 'Bearer ' + token }
  });
}

// ── Load calendar events ──────────────────────

function calLoadEvents() {
  const y = _calCurrentDate.getFullYear();
  const m = _calCurrentDate.getMonth();
  const timeMin = new Date(y, m, 1).toISOString();
  const timeMax = new Date(y, m + 1, 0, 23, 59, 59).toISOString();

  const url = '/calendars/primary/events'
    + '?timeMin=' + encodeURIComponent(timeMin)
    + '&timeMax=' + encodeURIComponent(timeMax)
    + '&singleEvents=true&orderBy=startTime&maxResults=200';

  calFetch(url)
    .then(function (r) {
      if (r.status === 401) { calClearToken(); return; }
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.items) return;
      _calEvents = data.items;
      calRender();
    })
    .catch(function (err) { if (err.message !== 'no-token') console.error('Calendar load error', err); });
}

// ── Render ────────────────────────────────────

function calRender() {
  calRenderGrid();
  calRenderUpcoming();
}

function calRenderGrid() {
  const y = _calCurrentDate.getFullYear();
  const m = _calCurrentDate.getMonth();
  document.getElementById('cal-month-label').textContent =
    _calCurrentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  const firstDay    = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr    = new Date().toDateString();

  const eventMap = {};
  _calEvents.forEach(function (ev) {
    const dt = ev.start && (ev.start.date || (ev.start.dateTime && ev.start.dateTime.slice(0, 10)));
    if (!dt) return;
    if (!eventMap[dt]) eventMap[dt] = [];
    eventMap[dt].push(ev);
  });

  const grid = document.getElementById('cal-grid');
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = days.map(function (d) { return '<div class="cal-hdr">' + d + '</div>'; }).join('');
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell cal-blank"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj  = new Date(y, m, d);
    const isToday  = dateObj.toDateString() === todayStr;
    const dateKey  = dateObj.toISOString().slice(0, 10);
    const evs      = eventMap[dateKey] || [];
    const dotHtml  = evs.slice(0, 3).map(function () { return '<span class="cal-dot"></span>'; }).join('');
    const moreHtml = evs.length > 3 ? '<span class="cal-more">+' + (evs.length - 3) + '</span>' : '';
    html += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + '" onclick="calDayClick(\'' + dateKey + '\')">'
      + '<span class="cal-num">' + d + '</span>'
      + '<div class="cal-dots">' + dotHtml + moreHtml + '</div>'
      + '</div>';
  }
  grid.innerHTML = html;
}

function calRenderUpcoming() {
  const now = new Date();
  const upcoming = _calEvents.filter(function (ev) {
    const dtStr = ev.start && (ev.start.dateTime || ev.start.date);
    return dtStr && new Date(dtStr) >= now;
  }).slice(0, 10);

  const list = document.getElementById('cal-upcoming');
  if (!upcoming.length) {
    list.innerHTML = '<div class="cal-empty">No upcoming events this month.</div>';
    return;
  }
  list.innerHTML = upcoming.map(function (ev) {
    const dtStr    = ev.start.dateTime || ev.start.date;
    const dt       = new Date(dtStr);
    const isAllDay = !ev.start.dateTime;
    const timeStr  = isAllDay
      ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        + ' · ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return '<div class="cal-event-row">'
      + '<div class="cal-ev-dot"></div>'
      + '<div class="cal-ev-body">'
      + '<div class="cal-ev-title">' + escHtml(ev.summary || '(No title)') + '</div>'
      + '<div class="cal-ev-time">' + timeStr + '</div>'
      + '</div></div>';
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Day click ─────────────────────────────────

function calDayClick(dateKey) {
  const evs = _calEvents.filter(function (ev) {
    const dt = ev.start && (ev.start.date || (ev.start.dateTime && ev.start.dateTime.slice(0, 10)));
    return dt === dateKey;
  });
  if (!evs.length) { calOpenAddModal(dateKey); return; }
  const lines = evs.map(function (ev) {
    const t = ev.start.dateTime
      ? new Date(ev.start.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' — '
      : '';
    return t + (ev.summary || '(No title)');
  });
  alert(dateKey + '\n\n' + lines.join('\n'));
}

// ── Month navigation ──────────────────────────

function calPrevMonth() {
  _calCurrentDate = new Date(_calCurrentDate.getFullYear(), _calCurrentDate.getMonth() - 1, 1);
  calLoadEvents();
}

function calNextMonth() {
  _calCurrentDate = new Date(_calCurrentDate.getFullYear(), _calCurrentDate.getMonth() + 1, 1);
  calLoadEvents();
}

// ── Add-event modal ───────────────────────────

function calOpenAddModal(prefillDate, prefillTitle) {
  const modal = document.getElementById('cal-add-modal');
  document.getElementById('cal-ev-title').value    = prefillTitle || '';
  document.getElementById('cal-ev-date').value     = prefillDate || new Date().toISOString().slice(0, 10);
  document.getElementById('cal-ev-time').value     = '09:00';
  document.getElementById('cal-ev-end-time').value = '10:00';
  document.getElementById('cal-ev-desc').value     = '';
  document.getElementById('cal-ev-all-day').checked = false;
  calToggleAllDay();
  modal.style.display = 'flex';
}

function calCloseAddModal() {
  document.getElementById('cal-add-modal').style.display = 'none';
}

function calToggleAllDay() {
  document.getElementById('cal-time-row').style.display =
    document.getElementById('cal-ev-all-day').checked ? 'none' : '';
}

function calSaveEvent() {
  const token = calGetToken();
  if (!token) { calTriggerOAuth(calSaveEvent); return; }

  const title   = document.getElementById('cal-ev-title').value.trim();
  const date    = document.getElementById('cal-ev-date').value;
  const allDay  = document.getElementById('cal-ev-all-day').checked;
  const time    = document.getElementById('cal-ev-time').value;
  const endTime = document.getElementById('cal-ev-end-time').value;
  const desc    = document.getElementById('cal-ev-desc').value.trim();

  if (!title) { toast('Event title is required', '⚠'); return; }
  if (!date)  { toast('Date is required', '⚠'); return; }

  const tz   = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = allDay
    ? { summary: title, description: desc || undefined, start: { date }, end: { date } }
    : { summary: title, description: desc || undefined,
        start: { dateTime: date + 'T' + time + ':00', timeZone: tz },
        end:   { dateTime: date + 'T' + endTime + ':00', timeZone: tz } };

  const saveBtn = document.getElementById('cal-save-btn');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function (r) {
      if (r.status === 401) { calClearToken(); throw new Error('auth'); }
      if (!r.ok) throw new Error('api-error');
      return r.json();
    })
    .then(function () { toast('Event saved ✓', '📅'); calCloseAddModal(); calLoadEvents(); })
    .catch(function (err) { if (err.message !== 'auth') toast('Failed to save event', '⚠'); })
    .finally(function () { saveBtn.disabled = false; saveBtn.textContent = 'Save Event'; });
}

// ════════════════════════════════════════════
//  GMAIL DATE SCANNER
// ════════════════════════════════════════════

// Search queries that catch date-sensitive emails
const GMAIL_SCAN_QUERIES = [
  'newer_than:60d (deadline OR "due date" OR "due by" OR "by end of")',
  'newer_than:60d (meeting OR appointment OR interview OR "phone call" OR "zoom" OR "video call")',
  'newer_than:60d ("application deadline" OR "apply by" OR "applications due" OR "submission deadline")',
  'newer_than:60d (schedule OR "follow up" OR "follow-up" OR reminder OR "don\'t forget")',
];

// Date extraction: returns { dateStr: 'YYYY-MM-DD', label: 'human-readable' } or null
function calExtractDate(text) {
  if (!text) return null;
  const now   = new Date();
  const year  = now.getFullYear();

  const MONTHS = {
    jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,
    may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,
    oct:10,october:10,nov:11,november:11,dec:12,december:12
  };

  // ISO / numeric: 2026-06-15 or 6/15/2026 or 6/15/26
  const isoMatch = text.match(/\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
  if (isoMatch) {
    const d = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2])-1, parseInt(isoMatch[3]));
    if (!isNaN(d)) return { dateStr: d.toISOString().slice(0,10), label: d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) };
  }
  const usMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (usMatch) {
    const y2 = usMatch[3] ? (parseInt(usMatch[3]) < 100 ? 2000+parseInt(usMatch[3]) : parseInt(usMatch[3])) : year;
    const d  = new Date(y2, parseInt(usMatch[1])-1, parseInt(usMatch[2]));
    if (!isNaN(d) && d.getMonth() === parseInt(usMatch[1])-1) {
      return { dateStr: d.toISOString().slice(0,10), label: d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) };
    }
  }

  // "June 15" / "June 15, 2026" / "15 June 2026"
  const monthWordRe = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{4}))?\b/i;
  const mwMatch = text.match(monthWordRe);
  if (mwMatch) {
    const mo = MONTHS[mwMatch[1].toLowerCase()];
    const dy = parseInt(mwMatch[2]);
    const yr = mwMatch[3] ? parseInt(mwMatch[3]) : year;
    const d  = new Date(yr, mo-1, dy);
    if (!isNaN(d)) return { dateStr: d.toISOString().slice(0,10), label: d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) };
  }

  // "15 June 2026" order
  const dmyRe = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?(?:\s+(\d{4}))?\b/i;
  const dmyMatch = text.match(dmyRe);
  if (dmyMatch) {
    const mo = MONTHS[dmyMatch[2].toLowerCase()];
    const dy = parseInt(dmyMatch[1]);
    const yr = dmyMatch[3] ? parseInt(dmyMatch[3]) : year;
    const d  = new Date(yr, mo-1, dy);
    if (!isNaN(d)) return { dateStr: d.toISOString().slice(0,10), label: d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) };
  }

  // Relative: "tomorrow", "next Monday" etc.
  const lower = text.toLowerCase();
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now); d.setDate(d.getDate()+1);
    return { dateStr: d.toISOString().slice(0,10), label: 'Tomorrow (' + d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ')' };
  }
  const nextDayMatch = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (nextDayMatch) {
    const DAYS = {monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0};
    const target = DAYS[nextDayMatch[1]];
    const d = new Date(now);
    let diff = target - d.getDay();
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return { dateStr: d.toISOString().slice(0,10), label: 'Next ' + nextDayMatch[1].charAt(0).toUpperCase()+nextDayMatch[1].slice(1) + ' (' + d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ')' };
  }

  return null;
}

// Classify what kind of date item this is
function calClassifyEmail(subject, snippet) {
  const text = (subject + ' ' + snippet).toLowerCase();
  if (/interview|phone screen|hiring|offer/.test(text))               return { tag: 'Interview', color: '#7B61FF' };
  if (/application|apply|submission|deadline/.test(text))             return { tag: 'Deadline', color: '#E05C3A' };
  if (/meeting|zoom|call|video|conference|sync/.test(text))           return { tag: 'Meeting', color: '#3A7BD5' };
  if (/appointment|visit|consultation/.test(text))                    return { tag: 'Appointment', color: '#2BAE66' };
  if (/reminder|follow.?up|don.t forget|due/.test(text))             return { tag: 'Reminder', color: '#C9983A' };
  return { tag: 'Date', color: '#6A8898' };
}

let _scanResults = [];

function calScanGmail() {
  const token = calGetToken();
  if (!token) { calTriggerOAuth(calScanGmail); return; }

  const panel  = document.getElementById('cal-scan-panel');
  const list   = document.getElementById('cal-scan-list');
  panel.style.display = '';
  list.innerHTML = '<div class="cal-empty" style="padding:16px">Scanning Gmail…</div>';
  _scanResults = [];

  // Run all search queries in parallel, dedupe by message ID
  const seen = {};
  const allIds = [];

  Promise.all(GMAIL_SCAN_QUERIES.map(function (q) {
    return gmailFetch('/users/me/messages?maxResults=15&q=' + encodeURIComponent(q))
      .then(function (r) { return r.ok ? r.json() : { messages: [] }; })
      .then(function (data) {
        (data.messages || []).forEach(function (m) {
          if (!seen[m.id]) { seen[m.id] = true; allIds.push(m.id); }
        });
      })
      .catch(function () {});
  }))
  .then(function () {
    if (!allIds.length) {
      list.innerHTML = '<div class="cal-empty" style="padding:16px">No date-related emails found in the last 60 days.</div>';
      return;
    }
    // Fetch metadata for each message (subject + snippet + date)
    return Promise.all(allIds.slice(0, 40).map(function (id) {
      return gmailFetch('/users/me/messages/' + id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=Date')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }));
  })
  .then(function (messages) {
    if (!messages) return;
    const results = [];
    messages.forEach(function (msg) {
      if (!msg) return;
      const headers  = (msg.payload && msg.payload.headers) || [];
      const subject  = (headers.find(function (h) { return h.name === 'Subject'; }) || {}).value || '(No subject)';
      const snippet  = msg.snippet || '';
      const combined = subject + ' ' + snippet;

      const dateInfo = calExtractDate(combined);
      if (!dateInfo) return;

      // Skip dates in the past (>30 days ago)
      const d = new Date(dateInfo.dateStr);
      if (d < new Date(Date.now() - 30 * 86400000)) return;

      const classify = calClassifyEmail(subject, snippet);
      results.push({ subject, snippet, dateInfo, classify, msgId: msg.id });
    });

    // Sort by date ascending
    results.sort(function (a, b) { return a.dateInfo.dateStr.localeCompare(b.dateInfo.dateStr); });
    _scanResults = results;
    calRenderScanResults();
  })
  .catch(function (err) {
    console.error('Gmail scan error', err);
    list.innerHTML = '<div class="cal-empty" style="padding:16px;color:#c00">Scan failed — try reconnecting.</div>';
  });
}

function calRenderScanResults() {
  const list = document.getElementById('cal-scan-list');
  if (!_scanResults.length) {
    list.innerHTML = '<div class="cal-empty" style="padding:16px">No upcoming dates found in Gmail.</div>';
    return;
  }
  list.innerHTML = _scanResults.map(function (r, i) {
    return '<div class="cal-scan-row">'
      + '<div class="cal-scan-meta">'
      + '<span class="cal-scan-tag" style="background:' + r.classify.color + '20;color:' + r.classify.color + ';border:1px solid ' + r.classify.color + '40">' + r.classify.tag + '</span>'
      + '<span class="cal-scan-date">' + r.dateInfo.label + '</span>'
      + '</div>'
      + '<div class="cal-scan-subject">' + escHtml(r.subject) + '</div>'
      + '<div class="cal-scan-snippet">' + escHtml(r.snippet.slice(0, 120)) + (r.snippet.length > 120 ? '…' : '') + '</div>'
      + '<button class="btn btn-outline btn-sm cal-scan-add" onclick="calScanAddEvent(' + i + ')">＋ Add to Calendar</button>'
      + '</div>';
  }).join('');
}

function calScanAddEvent(i) {
  const r = _scanResults[i];
  if (!r) return;
  calOpenAddModal(r.dateInfo.dateStr, r.subject);
}

function calCloseScanPanel() {
  document.getElementById('cal-scan-panel').style.display = 'none';
}

// ── Connect / show-connect ────────────────────

function calShowConnect() {
  document.getElementById('cal-connect-banner').style.display = '';
  document.getElementById('cal-main').style.display = 'none';
}

function calHideConnect() {
  document.getElementById('cal-connect-banner').style.display = 'none';
  document.getElementById('cal-main').style.display = '';
  calRenderGrid();
  document.getElementById('cal-upcoming').innerHTML = '<div class="cal-empty">Loading…</div>';
}

function calConnect() {
  calTriggerOAuth(function () {
    calHideConnect();
    calLoadEvents();
  });
}

// ── Init ──────────────────────────────────────

function calInit() {
  if (window._calInited) {
    if (calGetToken()) calLoadEvents();
    return;
  }
  window._calInited = true;
  _calCurrentDate = new Date();
  const token = calGetToken();
  if (token) { calHideConnect(); calLoadEvents(); }
  else        { calShowConnect(); }
}
