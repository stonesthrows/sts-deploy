// ════════════════════════════════════════════
//  CALENDAR  —  js/calendar.js
//  Google Calendar API v3 integration
// ════════════════════════════════════════════

const CAL_TOKEN_KEY  = 'sts-gcal-token';
const CAL_EXPIRY_KEY = 'sts-gcal-token-expiry';

let _calOauthCallback = null;
let _calCurrentDate   = new Date();   // month being rendered
let _calEvents        = [];           // cached events for current view

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

// Re-use the same redirect URI as drive.js (already registered in Google Cloud).
// Both drive.js and calendar.js listen for 'sts-google-oauth'; calendar.js saves
// to its own token key and only fires _calOauthCallback when it's waiting.
window.addEventListener('message', function (e) {
  if (e.origin !== window.location.origin) return;
  if (!e.data || e.data.type !== 'sts-google-oauth') return;
  if (!_calOauthCallback) return;  // only act when a calendar auth is in progress
  localStorage.setItem(CAL_TOKEN_KEY, e.data.token);
  localStorage.setItem(CAL_EXPIRY_KEY, String(Date.now() + parseInt(e.data.expiresIn) * 1000));
  toast('Google Calendar connected ✓', '📅');
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
  // Use the same redirect URI as drive.js so no extra URI needs registering
  const redirectUri = window.location.origin + window.location.pathname;
  const scopes = 'https://www.googleapis.com/auth/calendar';
  const url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id='    + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&response_type=token'
    + '&scope='        + encodeURIComponent(scopes)
    + '&prompt=select_account'
    + '&login_hint=kyle%40stonesthrowjewelry.com';
  const popup = window.open(url, 'gcal-oauth', 'width=520,height=620,scrollbars=yes,resizable=yes');
  if (!popup) {
    toast('Popup blocked — allow popups and try again', '⚠');
    _calOauthCallback = null;
  }
}

// ── API helpers ───────────────────────────────

function calFetch(path, options) {
  const token = calGetToken();
  if (!token) return Promise.reject(new Error('no-token'));
  return fetch('https://www.googleapis.com/calendar/v3' + path, Object.assign({
    headers: { Authorization: 'Bearer ' + token }
  }, options || {}));
}

// ── Load events ───────────────────────────────

function calLoadEvents(token) {
  // Fetch events for the displayed month ± a few days padding
  const y = _calCurrentDate.getFullYear();
  const m = _calCurrentDate.getMonth();
  const timeMin = new Date(y, m, 1).toISOString();
  const timeMax = new Date(y, m + 1, 0, 23, 59, 59).toISOString();

  const url = '/calendars/primary/events'
    + '?timeMin=' + encodeURIComponent(timeMin)
    + '&timeMax=' + encodeURIComponent(timeMax)
    + '&singleEvents=true'
    + '&orderBy=startTime'
    + '&maxResults=200';

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
    .catch(function (err) {
      if (err.message === 'no-token') return;
      console.error('Calendar load error', err);
    });
}

// ── Render ────────────────────────────────────

function calRender() {
  calRenderGrid();
  calRenderUpcoming();
}

function calRenderGrid() {
  const y = _calCurrentDate.getFullYear();
  const m = _calCurrentDate.getMonth();

  const monthName = _calCurrentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  document.getElementById('cal-month-label').textContent = monthName;

  const firstDay = new Date(y, m, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const today = new Date();
  const todayStr = today.toDateString();

  // Build event lookup: dateStr → [event, ...]
  const eventMap = {};
  _calEvents.forEach(function (ev) {
    const dt = ev.start && (ev.start.date || (ev.start.dateTime && ev.start.dateTime.slice(0, 10)));
    if (!dt) return;
    if (!eventMap[dt]) eventMap[dt] = [];
    eventMap[dt].push(ev);
  });

  const grid = document.getElementById('cal-grid');
  // Header row
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = days.map(function (d) { return '<div class="cal-hdr">' + d + '</div>'; }).join('');

  // Blanks before first day
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell cal-blank"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj   = new Date(y, m, d);
    const isToday   = dateObj.toDateString() === todayStr;
    const dateKey   = dateObj.toISOString().slice(0, 10);
    const evs       = eventMap[dateKey] || [];
    const dotHtml   = evs.slice(0, 3).map(function () { return '<span class="cal-dot"></span>'; }).join('');
    const moreHtml  = evs.length > 3 ? '<span class="cal-more">+' + (evs.length - 3) + '</span>' : '';
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
    if (!dtStr) return false;
    return new Date(dtStr) >= now;
  }).slice(0, 10);

  const list = document.getElementById('cal-upcoming');
  if (!upcoming.length) {
    list.innerHTML = '<div class="cal-empty">No upcoming events this month.</div>';
    return;
  }

  list.innerHTML = upcoming.map(function (ev) {
    const dtStr = ev.start.dateTime || ev.start.date;
    const dt    = new Date(dtStr);
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
      + '</div>'
      + '</div>';
  }).join('');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Day click → mini event list ───────────────

function calDayClick(dateKey) {
  const evs = _calEvents.filter(function (ev) {
    const dt = ev.start && (ev.start.date || (ev.start.dateTime && ev.start.dateTime.slice(0, 10)));
    return dt === dateKey;
  });
  if (!evs.length) {
    // Open add-event modal pre-filled with this date
    calOpenAddModal(dateKey);
    return;
  }
  // Show events for this day in a simple toast-style alert for now
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

function calOpenAddModal(prefillDate) {
  const modal = document.getElementById('cal-add-modal');
  document.getElementById('cal-ev-title').value = '';
  document.getElementById('cal-ev-date').value  = prefillDate || new Date().toISOString().slice(0, 10);
  document.getElementById('cal-ev-time').value  = '09:00';
  document.getElementById('cal-ev-end-time').value = '10:00';
  document.getElementById('cal-ev-desc').value  = '';
  document.getElementById('cal-ev-all-day').checked = false;
  calToggleAllDay();
  modal.style.display = 'flex';
}

function calCloseAddModal() {
  document.getElementById('cal-add-modal').style.display = 'none';
}

function calToggleAllDay() {
  const allDay = document.getElementById('cal-ev-all-day').checked;
  document.getElementById('cal-time-row').style.display = allDay ? 'none' : '';
}

function calSaveEvent() {
  const token = calGetToken();
  if (!token) {
    calTriggerOAuth(calSaveEvent);
    return;
  }

  const title   = document.getElementById('cal-ev-title').value.trim();
  const date    = document.getElementById('cal-ev-date').value;
  const allDay  = document.getElementById('cal-ev-all-day').checked;
  const time    = document.getElementById('cal-ev-time').value;
  const endTime = document.getElementById('cal-ev-end-time').value;
  const desc    = document.getElementById('cal-ev-desc').value.trim();

  if (!title) { toast('Event title is required', '⚠'); return; }
  if (!date)  { toast('Date is required', '⚠'); return; }

  let body;
  if (allDay) {
    body = {
      summary: title,
      description: desc || undefined,
      start: { date: date },
      end:   { date: date }
    };
  } else {
    body = {
      summary: title,
      description: desc || undefined,
      start: { dateTime: date + 'T' + time + ':00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      end:   { dateTime: date + 'T' + endTime + ':00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
    };
  }

  const saveBtn = document.getElementById('cal-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
    .then(function (r) {
      if (r.status === 401) { calClearToken(); throw new Error('auth'); }
      if (!r.ok) throw new Error('api-error');
      return r.json();
    })
    .then(function () {
      toast('Event saved ✓', '📅');
      calCloseAddModal();
      calLoadEvents();
    })
    .catch(function (err) {
      if (err.message !== 'auth') toast('Failed to save event', '⚠');
    })
    .finally(function () {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Event';
    });
}

// ── Connect / show-connect ────────────────────

function calShowConnect() {
  document.getElementById('cal-connect-banner').style.display = '';
  document.getElementById('cal-main').style.display = 'none';
}

function calHideConnect() {
  document.getElementById('cal-connect-banner').style.display = 'none';
  document.getElementById('cal-main').style.display = '';
}

function calConnect() {
  calTriggerOAuth(function () {
    calHideConnect();
    calLoadEvents();
  });
}

// ── Init (called when tab is opened) ─────────

function calInit() {
  if (window._calInited) {
    // Already loaded — just refresh if token present
    if (calGetToken()) calLoadEvents();
    return;
  }
  window._calInited = true;
  _calCurrentDate = new Date();

  const token = calGetToken();
  if (token) {
    calHideConnect();
    calLoadEvents();
  } else {
    calShowConnect();
  }
}
