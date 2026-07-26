// ════════════════════════════════════════════
//  CUSTOMER MESSAGES  —  js/customer-messages.js
//  Internal-staff Q&A thread per customer ("Team Messages" section on the
//  Customer Card), stored in Notion via /api/notion-messages. Mirrors
//  js/notes.js's flat-list-in-Notion pattern (fetch-all + client filter),
//  not the heavier order-sync pipeline in js/notion.js.
// ════════════════════════════════════════════

var MESSAGES_DATA   = [];   // flat array of { notionPageId, customerKey, customerName, author, text, createdAt }
var _messagesLoaded  = false;
var _messagesPoller  = null;

const MSG_STAFF_NAME_KEY = 'sts-staff-name';
const MSG_LASTVIEWED_KEY = 'sts-msg-lastviewed';

function custKey(name) {
  return String(name || '').trim().toLowerCase();
}

function messagesFor(customerKey) {
  return MESSAGES_DATA.filter(function(m) { return m.customerKey === customerKey; });
}

// ── Load ─────────────────────────────────────
function loadMessages() {
  fetch('/api/notion-messages')
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; }); })
    .then(function(res) {
      _messagesLoaded = true;
      if (!res.ok) { console.error('notion-messages GET error:', res); return; }
      MESSAGES_DATA = res.data || [];
      _msgRenderOpenThreads();
      if (typeof renderAllMessageBadges === 'function') renderAllMessageBadges();
    })
    .catch(function(err) {
      _messagesLoaded = true;
      _msgRenderOpenThreads();
      console.error('notion-messages GET catch:', err);
    });
  if (!_messagesPoller) {
    _messagesPoller = setInterval(loadMessages, 30000);
  }
}

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && _messagesLoaded) loadMessages();
});

// Re-render any currently-open customer message panels after a poll refresh
// (never rebuild the whole Customers table here — that would collapse
// whatever row the user has open, same hazard refreshOpenCustomerExpands
// exists to avoid for the Gmail/order sections).
function _msgRenderOpenThreads() {
  document.querySelectorAll('.ct-row-wrap.ct-open').forEach(function(wrap) {
    var idx = parseInt(wrap.id.replace('ct-wrap-', ''), 10);
    var c = (typeof CUSTOMERS !== 'undefined') ? CUSTOMERS[idx] : null;
    if (!c) return;
    renderMessageThread(idx, custKey(c.name));
  });
}

// ── Staff identity ───────────────────────────
// No login exists in this app (shared X-STS-Key, not per-user) — "author"
// is a free-text, unenforced label a staff member sets once per browser.
function getStaffName() {
  var name = localStorage.getItem(MSG_STAFF_NAME_KEY) || '';
  if (name) return name;
  name = (prompt('Your name, so teammates know who\'s asking:') || '').trim();
  if (name) localStorage.setItem(MSG_STAFF_NAME_KEY, name);
  return name;
}

function changeStaffName(idx) {
  var current = localStorage.getItem(MSG_STAFF_NAME_KEY) || '';
  var name = (prompt('Your name, so teammates know who\'s asking:', current) || '').trim();
  if (!name) return;
  localStorage.setItem(MSG_STAFF_NAME_KEY, name);
  var c = (typeof CUSTOMERS !== 'undefined') ? CUSTOMERS[idx] : null;
  if (c) renderMessageThread(idx, custKey(c.name));
}

// ── Unread tracking (per-device, never synced) ───────────────
function _msgLastViewedMap() {
  try { return JSON.parse(localStorage.getItem(MSG_LASTVIEWED_KEY) || '{}'); }
  catch (e) { return {}; }
}

function markMessagesViewed(customerKey) {
  var map = _msgLastViewedMap();
  map[customerKey] = new Date().toISOString();
  try { localStorage.setItem(MSG_LASTVIEWED_KEY, JSON.stringify(map)); } catch (e) {}
}

function unreadMessageCount(customerKey) {
  var map   = _msgLastViewedMap();
  var since = map[customerKey];
  var msgs  = messagesFor(customerKey);
  if (!since) return msgs.length;
  return msgs.filter(function(m) { return m.createdAt > since; }).length;
}

// Updates the "N unread" chip on every currently-rendered customer row.
// Safe to call at any time — looks elements up by id and skips rows that
// aren't in the DOM (e.g. filtered out by search/sub-tab).
function renderAllMessageBadges() {
  if (typeof CUSTOMERS === 'undefined') return;
  CUSTOMERS.forEach(function(c, idx) {
    var el = document.getElementById('ct-msg-badge-' + idx);
    if (!el) return;
    var count = unreadMessageCount(custKey(c.name));
    el.innerHTML = count > 0 ? '💬 ' + count : '';
  });
}

// ── Render ───────────────────────────────────
// Renders the thread for a currently-open customer panel. Since messages
// are always fully loaded in memory (small, business-scale dataset — see
// loadMessages()), no per-open network fetch is needed; this just paints
// from MESSAGES_DATA and marks the thread as viewed on this device.
function loadMessagesForCustomer(customerName, idx) {
  renderMessageThread(idx, custKey(customerName));
}

function renderMessageThread(idx, customerKey) {
  var container = document.getElementById('ct-msg-' + idx);
  if (!container) return;

  markMessagesViewed(customerKey);
  var badge = document.getElementById('ct-msg-badge-' + idx);
  if (badge) badge.innerHTML = '';

  var msgs   = messagesFor(customerKey);
  var myName = localStorage.getItem(MSG_STAFF_NAME_KEY) || '';

  if (!msgs.length) {
    container.innerHTML = '<div class="ct-exp-gmail-msg">'
      + (_messagesLoaded ? 'No messages yet — be the first to ask a question.' : '⏳ Loading…')
      + '</div>';
  } else {
    container.innerHTML = msgs.map(function(m) {
      var isSelf = !!myName && m.author === myName;
      var cls = 'msg-bubble ' + (isSelf ? 'msg-bubble-self' : 'msg-bubble-other');
      if (m._saving) cls += ' saving';
      var time = new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return '<div class="' + cls + '">'
        + '<div class="msg-bubble-meta"><span class="msg-author">' + esc(m.author || 'Unknown') + '</span>'
        + '<span class="msg-time">' + esc(time) + '</span></div>'
        + '<div class="msg-bubble-text">' + esc(m.text) + '</div>'
        + '</div>';
    }).join('');
    container.scrollTop = container.scrollHeight;
  }

  var sig = document.getElementById('ct-msg-sig-' + idx);
  if (sig) {
    sig.innerHTML = myName
      ? 'Sending as: ' + esc(myName) + ' <a href="#" onclick="changeStaffName(' + idx + ');event.preventDefault();event.stopPropagation();return false;">(change)</a>'
      : '';
  }
}

// ── Send ─────────────────────────────────────
function sendCustomerMessage(idx) {
  var c = (typeof CUSTOMERS !== 'undefined') ? CUSTOMERS[idx] : null;
  if (!c) return;
  var input = document.getElementById('ct-msg-input-' + idx);
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;

  var author = getStaffName();
  if (!author) return; // cancelled the one-time name prompt

  input.value = '';

  var customerKey = custKey(c.name);
  var temp = {
    notionPageId: null,
    customerKey:  customerKey,
    customerName: c.name,
    author:       author,
    text:         text,
    createdAt:    new Date().toISOString(),
    _saving:      true,
  };
  MESSAGES_DATA.push(temp);
  renderMessageThread(idx, customerKey);

  fetch('/api/notion-messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerKey:  temp.customerKey,
      customerName: temp.customerName,
      author:       temp.author,
      text:         temp.text,
      createdAt:    temp.createdAt,
    }),
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; }); })
    .then(function(res) {
      if (!res.ok) {
        MESSAGES_DATA.splice(MESSAGES_DATA.indexOf(temp), 1);
        renderMessageThread(idx, customerKey);
        var msg = 'Send failed ' + res.status + ': ' + (res.data.error || 'unknown');
        console.error('notion-messages POST error:', res);
        alert(msg);
        return;
      }
      temp.notionPageId = res.data.notionPageId;
      temp._saving = false;
      renderMessageThread(idx, customerKey);
    })
    .catch(function(err) {
      MESSAGES_DATA.splice(MESSAGES_DATA.indexOf(temp), 1);
      renderMessageThread(idx, customerKey);
      console.error('notion-messages POST catch:', err);
      alert('Failed to send message: ' + err);
    });
}

function handleMessageComposeKey(event, idx) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendCustomerMessage(idx);
  }
}

// Called from saveCustomerEdit() (js/customers.js) when a customer is
// renamed — re-keys already-loaded messages locally so the thread doesn't
// vanish from the card for the rest of this session. The underlying Notion
// records keep the old "Customer Key" (renames are rare and a re-key PATCH
// loop isn't otherwise needed by this feature), so a fresh Notion pull on
// another device will still group them under the old key until that's
// addressed separately.
function rekeyCustomerMessages(oldName, newName) {
  var oldKey = custKey(oldName);
  var newKey = custKey(newName);
  if (!oldKey || oldKey === newKey) return;
  MESSAGES_DATA.forEach(function(m) {
    if (m.customerKey === oldKey) {
      m.customerKey  = newKey;
      m.customerName = newName;
    }
  });
}
