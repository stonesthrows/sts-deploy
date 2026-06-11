// ════════════════════════════════════════════
//  CALENDAR  —  js/calendar.js
//  Google Calendar API v3 + Gmail date scanner
//  Uses PKCE auth code flow for persistent sessions
// ════════════════════════════════════════════

const CAL_TOKEN_KEY    = 'sts-gcal-token';
const CAL_EXPIRY_KEY   = 'sts-gcal-token-expiry';
const CAL_REFRESH_KEY  = 'sts-gcal-refresh-token';
const CAL_VERIFIER_KEY = 'sts-gcal-pkce-verifier';

let _calCurrentDate = new Date();
let _calEvents      = [];
let _calRefreshTimer = null;

// ── Token helpers ─────────────────────────────

function calGetToken() {
  const token  = localStorage.getItem(CAL_TOKEN_KEY);
  const expiry = parseInt(localStorage.getItem(CAL_EXPIRY_KEY) || '0');
  if (token && Date.now() < expiry - 60000) return token;
  return null;
}

function calGetRefreshToken() {
  return localStorage.getItem(CAL_REFRESH_KEY);
}

function calSaveTokens(data) {
  localStorage.setItem(CAL_TOKEN_KEY,   data.access_token);
  localStorage.setItem(CAL_EXPIRY_KEY,  String(Date.now() + data.expires_in * 1000));
  if (data.refresh_token) {
    localStorage.setItem(CAL_REFRESH_KEY, data.refresh_token);
  }
  calScheduleRefresh(data.expires_in);
}

function calClearTokens() {
  localStorage.removeItem(CAL_TOKEN_KEY);
  localStorage.removeItem(CAL_EXPIRY_KEY);
  localStorage.removeItem(CAL_REFRESH_KEY);
  localStorage.removeItem(CAL_VERIFIER_KEY);
  if (_calRefreshTimer) clearTimeout(_calRefreshTimer);
  calShowConnect();
}

// ── Auto-refresh ──────────────────────────────

function calScheduleRefresh(expiresInSeconds) {
  if (_calRefreshTimer) clearTimeout(_calRefreshTimer);
  // Refresh 5 minutes before expiry
  const delay = Math.max((expiresInSeconds - 300) * 1000, 10000);
  _calRefreshTimer = setTimeout(calSilentRefresh, delay);
}

async function calSilentRefresh() {
  const refreshToken = calGetRefreshToken();
  const clientId     = localStorage.getItem('sts-google-client-id');
  const clientSecret = localStorage.getItem('sts-google-client-secret');
  if (!refreshToken || !clientId || !clientSecret) return;

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    'refresh_token'
      }).toString()
    });
    const data = await r.json();
    if (data.access_token) {
      calSaveTokens(data);
    } else {
      console.warn('Calendar silent refresh failed', data);
    }
  } catch (err) {
    console.warn('Calendar silent refresh error', err);
    // Retry in 2 minutes
    _calRefreshTimer = setTimeout(calSilentRefresh, 120000);
  }
}

// ── PKCE helpers ──────────────────────────────

function calPKCEVerifier() {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

async function calPKCEChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

// ── OAuth ─────────────────────────────────────

// Listen for the auth code coming back from calendar-oauth.html
window.addEventListener('message', function (e) {
  if (e.origin !== window.location.origin) return;
  if (!e.data || e.data.type !== 'sts-gcal-code') return;
  calHandleCode(e.data.code);
});

async function calTriggerOAuth() {
  const clientId = localStorage.getItem('sts-google-client-id');
  if (!clientId) {
    openIntegrationsModal();
    toast('Set your Google Client ID in Integrations first', 'ℹ');
    return;
  }
  if (!localStorage.getItem('sts-google-client-secret')) {
    openIntegrationsModal();
    toast('Add your OAuth Client Secret in Integrations for persistent login', 'ℹ');
    return;
  }

  const verifier   = calPKCEVerifier();
  const challenge  = await calPKCEChallenge(verifier);
  localStorage.setItem(CAL_VERIFIER_KEY, verifier);

  const redirectUri = window.location.origin + '/calendar-oauth.html';
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.readonly'
  ].join(' ');

  const url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id='             + encodeURIComponent(clientId)
    + '&redirect_uri='          + encodeURIComponent(redirectUri)
    + '&response_type=code'
    + '&scope='                 + encodeURIComponent(scopes)
    + '&code_challenge='        + encodeURIComponent(challenge)
    + '&code_challenge_method=S256'
    + '&access_type=offline'
    + '&prompt=consent'
    + '&login_hint=kyle%40stonesthrowjewelry.com';

  const popup = window.open(url, 'gcal-oauth', 'width=520,height=620,scrollbars=yes,resizable=yes');
  if (!popup) {
    toast('Popup blocked — allow popups and try again', '⚠');
    localStorage.removeItem(CAL_VERIFIER_KEY);
  }
}

async function calHandleCode(code) {
  const verifier    = localStorage.getItem(CAL_VERIFIER_KEY);
  const clientId    = localStorage.getItem('sts-google-client-id');
  const clientSecret = localStorage.getItem('sts-google-client-secret');
  const redirectUri  = window.location.origin + '/calendar-oauth.html';

  if (!verifier || !clientId || !clientSecret) {
    toast('OAuth setup incomplete — check Integrations', '⚠');
    return;
  }
  localStorage.removeItem(CAL_VERIFIER_KEY);

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        code_verifier: verifier,
        grant_type:    'authorization_code'
      }).toString()
    });
    const data = await r.json();
    if (!data.access_token) {
      console.error('Token exchange failed', data);
      toast('Google auth failed — check console', '⚠');
      return;
    }
    calSaveTokens(data);
    toast('Google Calendar connected ✓ (stays connected)', '📅');
    calHideConnect();
    calLoadEvents();
  } catch (err) {
    console.error('Token exchange error', err);
    toast('Google auth error', '⚠');
  }
}

// ── API helpers ───────────────────────────────

async function calEnsureToken() {
  if (calGetToken()) return calGetToken();
  if (calGetRefreshToken()) {
    await calSilentRefresh();
    return calGetToken();
  }
  return null;
}

async function calFetch(path, options) {
  const token = await calEnsureToken();
  if (!token) throw new Error('no-token');
  return fetch('https://www.googleapis.com/calendar/v3' + path, Object.assign({
    headers: { Authorization: 'Bearer ' + token }
  }, options || {}));
}

async function gmailFetch(path) {
  const token = await calEnsureToken();
  if (!token) throw new Error('no-token');
  return fetch('https://www.googleapis.com/gmail/v1' + path, {
    headers: { Authorization: 'Bearer ' + token }
  });
}

// ── Load calendar events ──────────────────────

async function calLoadEvents() {
  const y = _calCurrentDate.getFullYear();
  const m = _calCurrentDate.getMonth();
  const timeMin = new Date(y, m, 1).toISOString();
  const timeMax = new Date(y, m + 1, 0, 23, 59, 59).toISOString();

  const url = '/calendars/primary/events'
    + '?timeMin=' + encodeURIComponent(timeMin)
    + '&timeMax=' + encodeURIComponent(timeMax)
    + '&singleEvents=true&orderBy=startTime&maxResults=200';

  try {
    const r = await calFetch(url);
    if (r.status === 401) { calClearTokens(); return; }
    const data = await r.json();
    if (!data || !data.items) return;
    _calEvents = data.items.filter(function (ev) {
      return (ev.summary || '').trim().toLowerCase() !== 'home';
    });
    calRender();
  } catch (err) {
    if (err.message !== 'no-token') console.error('Calendar load error', err);
  }
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
    const chipHtml = evs.slice(0, 3).map(function (ev) {
      return '<span class="cal-chip">' + escHtml(ev.summary || '(No title)') + '</span>';
    }).join('');
    const moreHtml = evs.length > 3 ? '<span class="cal-more">+' + (evs.length - 3) + ' more</span>' : '';
    html += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + '" onclick="calDayClick(\'' + dateKey + '\')">'
      + '<span class="cal-num">' + d + '</span>'
      + '<div class="cal-dots">' + chipHtml + moreHtml + '</div>'
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

async function calSaveEvent() {
  const token = await calEnsureToken();
  if (!token) { calTriggerOAuth(); return; }

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

  try {
    const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (r.status === 401) { calClearTokens(); toast('Session expired — please reconnect Google Calendar', '⚠'); return; }
    if (!r.ok) {
      const errBody = await r.json().catch(() => ({}));
      console.error('Calendar API error', r.status, errBody);
      throw new Error((errBody.error && errBody.error.message) || ('HTTP ' + r.status));
    }
    toast('Event saved ✓', '📅');
    calCloseAddModal();
    calLoadEvents();
  } catch (err) {
    console.error('calSaveEvent error:', err);
    toast('Failed to save event: ' + err.message, '⚠');
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Save Event';
  }
}

// ════════════════════════════════════════════
//  GMAIL DATE SCANNER
// ════════════════════════════════════════════

const GMAIL_SCAN_QUERIES = [
  'newer_than:60d (deadline OR "due date" OR "due by" OR "by end of")',
  'newer_than:60d (meeting OR appointment OR interview OR "phone call" OR zoom OR "video call")',
  'newer_than:60d ("application deadline" OR "apply by" OR "applications due" OR "submission deadline")',
  'newer_than:60d (schedule OR "follow up" OR "follow-up" OR reminder OR "don\'t forget")',
];

function calExtractDate(text) {
  if (!text) return null;
  const now  = new Date();
  const year = now.getFullYear();
  const MONTHS = {
    jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,
    may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,
    oct:10,october:10,nov:11,november:11,dec:12,december:12
  };
  // ISO: 2026-06-15
  const isoMatch = text.match(/\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
  if (isoMatch) {
    const d = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2])-1, parseInt(isoMatch[3]));
    if (!isNaN(d)) return { dateStr: d.toISOString().slice(0,10), label: d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) };
  }
  // US: 6/15/2026
  const usMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (usMatch) {
    const y2 = usMatch[3] ? (parseInt(usMatch[3]) < 100 ? 2000+parseInt(usMatch[3]) : parseInt(usMatch[3])) : year;
    const d  = new Date(y2, parseInt(usMatch[1])-1, parseInt(usMatch[2]));
    if (!isNaN(d) && d.getMonth() === parseInt(usMatch[1])-1)
      return { dateStr: d.toISOString().slice(0,10), label: d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) };
  }
  // "June 15" / "June 15, 2026"
  const mwMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{4}))?\b/i);
  if (mwMatch) {
    const mo = MONTHS[mwMatch[1].toLowerCase()];
    const d  = new Date(mwMatch[3] ? parseInt(mwMatch[3]) : year, mo-1, parseInt(mwMatch[2]));
    if (!isNaN(d)) return { dateStr: d.toISOString().slice(0,10), label: d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) };
  }
  // "15 June 2026"
  const dmyMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?(?:\s+(\d{4}))?\b/i);
  if (dmyMatch) {
    const mo = MONTHS[dmyMatch[2].toLowerCase()];
    const d  = new Date(dmyMatch[3] ? parseInt(dmyMatch[3]) : year, mo-1, parseInt(dmyMatch[1]));
    if (!isNaN(d)) return { dateStr: d.toISOString().slice(0,10), label: d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) };
  }
  // Relative
  const lower = text.toLowerCase();
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now); d.setDate(d.getDate()+1);
    return { dateStr: d.toISOString().slice(0,10), label: 'Tomorrow (' + d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ')' };
  }
  const nextDay = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (nextDay) {
    const DAYS = {monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0};
    const d = new Date(now);
    let diff = DAYS[nextDay[1]] - d.getDay(); if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return { dateStr: d.toISOString().slice(0,10), label: 'Next ' + nextDay[1].charAt(0).toUpperCase()+nextDay[1].slice(1) + ' (' + d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ')' };
  }
  return null;
}

function calClassifyEmail(subject, snippet) {
  const t = (subject + ' ' + snippet).toLowerCase();
  if (/interview|phone screen|hiring|offer/.test(t))         return { tag: 'Interview',   color: '#7B61FF' };
  if (/application|apply|submission|deadline/.test(t))       return { tag: 'Deadline',    color: '#E05C3A' };
  if (/meeting|zoom|call|video|conference|sync/.test(t))     return { tag: 'Meeting',     color: '#3A7BD5' };
  if (/appointment|visit|consultation/.test(t))              return { tag: 'Appointment', color: '#2BAE66' };
  if (/reminder|follow.?up|don.t forget|due/.test(t))        return { tag: 'Reminder',    color: '#C9983A' };
  return { tag: 'Date', color: '#6A8898' };
}

let _scanResults = [];

async function calScanGmail() {
  const token = await calEnsureToken();
  if (!token) { calTriggerOAuth(); return; }

  const panel = document.getElementById('cal-scan-panel');
  const list  = document.getElementById('cal-scan-list');
  panel.style.display = '';
  list.innerHTML = '<div class="cal-empty" style="padding:16px">Scanning Gmail…</div>';
  _scanResults = [];

  const seen = {}, allIds = [];
  try {
    await Promise.all(GMAIL_SCAN_QUERIES.map(async function (q) {
      const r    = await gmailFetch('/users/me/messages?maxResults=15&q=' + encodeURIComponent(q));
      const data = r.ok ? await r.json() : { messages: [] };
      (data.messages || []).forEach(function (m) {
        if (!seen[m.id]) { seen[m.id] = true; allIds.push(m.id); }
      });
    }));

    if (!allIds.length) {
      list.innerHTML = '<div class="cal-empty" style="padding:16px">No date-related emails found in the last 60 days.</div>';
      return;
    }

    const messages = await Promise.all(allIds.slice(0, 40).map(async function (id) {
      const r = await gmailFetch('/users/me/messages/' + id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=Date');
      return r.ok ? r.json() : null;
    }));

    const results = [];
    messages.forEach(function (msg) {
      if (!msg) return;
      const headers = (msg.payload && msg.payload.headers) || [];
      const subject = (headers.find(function (h) { return h.name === 'Subject'; }) || {}).value || '(No subject)';
      const snippet = msg.snippet || '';
      const dateInfo = calExtractDate(subject + ' ' + snippet);
      if (!dateInfo) return;
      const d = new Date(dateInfo.dateStr);
      if (d < new Date(Date.now() - 30 * 86400000)) return;
      results.push({ subject, snippet, dateInfo, classify: calClassifyEmail(subject, snippet) });
    });

    results.sort(function (a, b) { return a.dateInfo.dateStr.localeCompare(b.dateInfo.dateStr); });
    _scanResults = results;
    calRenderScanResults();
  } catch (err) {
    console.error('Gmail scan error', err);
    list.innerHTML = '<div class="cal-empty" style="padding:16px;color:#c00">Scan failed — try reconnecting.</div>';
  }
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
  if (r) calOpenAddModal(r.dateInfo.dateStr, r.subject);
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
  calTriggerOAuth();
}

// ── Init ──────────────────────────────────────

async function calInit() {
  if (window._calInited) {
    const token = await calEnsureToken();
    if (token) calLoadEvents();
    return;
  }
  window._calInited = true;
  _calCurrentDate = new Date();

  const token = await calEnsureToken();
  if (token) {
    calHideConnect();
    calLoadEvents();
    // Resume auto-refresh timer based on stored expiry
    const expiry = parseInt(localStorage.getItem(CAL_EXPIRY_KEY) || '0');
    const remaining = Math.max(Math.floor((expiry - Date.now()) / 1000), 10);
    calScheduleRefresh(remaining);
  } else {
    calShowConnect();
  }
}
