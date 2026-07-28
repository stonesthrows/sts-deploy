// ════════════════════════════════════════════
//  ORDER CARD MESSAGES  —  js/order-messages.js
//  The Messages tab on the order card (see the .eo-tabs bar in
//  jewelry-workflow.html). Shows the SAME per-customer thread the Customer
//  Card shows — messages are keyed by customer, not by order — filtered to
//  the open order by default, with a scope toggle to widen to everything
//  about that person. Anything sent from here is tagged to the open order.
//
//  All storage and transport live in js/customer-messages.js; this file is
//  a second view onto MESSAGES_DATA, not a second copy of it.
// ════════════════════════════════════════════

var _eoMsgScope = 'order';   // 'order' | 'all'

// The open order — the card records it in a hidden field (same source
// js/order-widgets.js reads for the estimate).
function _eoMsgOrder() {
  var el = document.getElementById('f-editing-id');
  if (!el || !el.value || typeof ORDERS === 'undefined') return null;
  return ORDERS.find(function(o) { return o.id === el.value; }) || null;
}

function _eoMsgVisible(o) {
  var all = messagesFor(custKey(o.name));
  return _eoMsgScope === 'all'
    ? all
    : all.filter(function(m) { return m.orderId === o.id; });
}

// Called when the card opens, on every poll, and on scope change.
function eoRenderMessages() {
  var thread = document.getElementById('eo-msg-thread');
  if (!thread) return;
  var o = _eoMsgOrder();
  if (!o) { thread.innerHTML = ''; return; }

  var key    = custKey(o.name);
  var myName = localStorage.getItem(MSG_STAFF_NAME_KEY) || '';

  // Scope toggle: counts, and the customer's name on the wider option.
  var custEl = document.getElementById('eo-msg-cust');
  if (custEl) custEl.textContent = (o.name || '').split(' ')[0] || 'customer';
  var nOrder = document.getElementById('eo-msg-n-order');
  var nAll   = document.getElementById('eo-msg-n-all');
  var allMsgs = messagesFor(key);
  if (nOrder) nOrder.textContent = allMsgs.filter(function(m) { return m.orderId === o.id; }).length || '';
  if (nAll)   nAll.textContent   = allMsgs.length || '';
  var bo = document.getElementById('eo-msg-scope-order');
  var ba = document.getElementById('eo-msg-scope-all');
  if (bo) bo.classList.toggle('active', _eoMsgScope === 'order');
  if (ba) ba.classList.toggle('active', _eoMsgScope === 'all');

  // Only count as read once the tab is actually on screen. The card renders
  // this pane whenever it opens (and on every poll), so marking here
  // unconditionally would clear the unread badge for messages nobody has
  // looked at yet — the badge would never once be seen.
  var pane = document.getElementById('eo-pane-messages');
  if (pane && pane.classList.contains('active')) {
    // Clear at the scope being read: filtered to this order marks only this
    // order, so a message about their OTHER order stays unread; the wider
    // view marks the whole customer.
    markMessagesViewed(key, _eoMsgScope === 'all' ? null : o.id);
  }

  var msgs = _eoMsgVisible(o);
  if (!msgs.length) {
    thread.innerHTML = '<div class="ct-exp-gmail-msg">'
      + (_messagesLoaded
          ? (_eoMsgScope === 'order'
              ? 'Nothing about this order yet — ask a question below.'
              : 'No messages about ' + esc(o.name) + ' yet.')
          : '⏳ Loading…')
      + '</div>';
  } else {
    // In the wider view the order tag is what tells two threads apart, so
    // it stays; filtered to one order it would repeat on every bubble.
    var showTag = _eoMsgScope === 'all';
    var ctx = { type: 'eo' };
    thread.innerHTML = msgs.map(function(m) {
      return renderMessageBubble(m, myName, showTag, ctx);
    }).join('');
    thread.scrollTop = thread.scrollHeight;
  }

  var note = document.getElementById('eo-msg-tagnote');
  if (note) note.innerHTML = '📦 Tagged to this order';
  var sig = document.getElementById('eo-msg-sig');
  if (sig) sig.innerHTML = staffSelectHtml('eo-msg-staff');

  eoUpdateMsgTabBadge();
  if (typeof renderMessageBell === 'function') renderMessageBell();
  if (typeof renderAllOrderMsgChips === 'function') renderAllOrderMsgChips();
}

function eoMsgSetScope(scope) {
  _eoMsgScope = (scope === 'all') ? 'all' : 'order';
  eoRenderMessages();
}

// Unread on the tab always means "about this order" — the tab belongs to
// the order, so a message about the customer's other job shouldn't light
// it up. The scope toggle is where the wider count lives.
function eoUpdateMsgTabBadge() {
  var badge = document.getElementById('eo-tab-msg-badge');
  if (!badge) return;
  var o = _eoMsgOrder();
  if (!o) { badge.textContent = ''; return; }
  var n = unreadMessageCount(custKey(o.name), o.id);
  badge.textContent = n > 0 ? String(n) : '';
  badge.style.display = n > 0 ? '' : 'none';
}

function eoHandleMsgKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    eoSendMessage();
  }
}

function eoSendMessage() {
  var o = _eoMsgOrder();
  if (!o) return;
  var input = document.getElementById('eo-msg-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;

  var author = requireStaffName('eo-msg-staff');
  if (!author) return;

  input.value = '';

  var key = custKey(o.name);
  // Sent from an order card, so it is always tagged to that order — even
  // while the wider scope is showing.
  var temp = {
    notionPageId: null,
    customerKey:  key,
    customerName: o.name,
    author:       author,
    text:         text,
    orderId:      o.id,
    orderLabel:   o.desc || '',
    createdAt:    new Date().toISOString(),
    _saving:      true,
  };
  MESSAGES_DATA.push(temp);
  eoRenderMessages();

  fetch('/api/notion-messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerKey:  temp.customerKey,
      customerName: temp.customerName,
      author:       temp.author,
      text:         temp.text,
      orderId:      temp.orderId,
      orderLabel:   temp.orderLabel,
      createdAt:    temp.createdAt,
    }),
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; }); })
    .then(function(res) {
      if (!res.ok) {
        MESSAGES_DATA.splice(MESSAGES_DATA.indexOf(temp), 1);
        eoRenderMessages();
        console.error('notion-messages POST error:', res);
        alert('Send failed ' + res.status + ': ' + (res.data.error || 'unknown'));
        return;
      }
      temp.notionPageId = res.data.notionPageId;
      temp._saving = false;
      eoRenderMessages();
    })
    .catch(function(err) {
      MESSAGES_DATA.splice(MESSAGES_DATA.indexOf(temp), 1);
      eoRenderMessages();
      console.error('notion-messages POST catch:', err);
      alert('Failed to send message: ' + err);
    });
}
