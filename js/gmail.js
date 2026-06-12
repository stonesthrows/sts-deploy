// ════════════════════════════════════════════
//  GMAIL  —  js/gmail.js
//  Standalone Gmail via Google OAuth + REST API
//  Read, reply, trash — no Claude required
// ════════════════════════════════════════════

var GMAIL_CLIENT_ID = '787985557761-4g12h5j9a6h3okq75onbrsv5vo6br719.apps.googleusercontent.com';
var GMAIL_SCOPE     = 'https://www.googleapis.com/auth/gmail.modify';

var _gmailTokenClient = null;
var _gmailAccessToken = null;
var _gmailTokenExpiry = 0;

// ── Helpers ──────────────────────────────────

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _decodeSnippet(s) {
  return String(s || '')
    .replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#[\d]+;/g,'');
}

function _formatAge(date) {
  var d = (date instanceof Date) ? date : new Date(date);
  var now = new Date();
  var diffM = Math.round((now - d) / 60000);
  if (diffM < 2)    return 'just now';
  if (diffM < 60)   return diffM + 'm ago';
  if (diffM < 120)  return '1h ago';
  if (diffM < 1440) return Math.round(diffM / 60) + 'h ago';
  if (diffM < 2880) return 'yesterday';
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function _avatar(from, category) {
  var initial = (from || '?').trim().charAt(0).toUpperCase();
  var cls = category === 'business' ? ' gt-av-biz' : category === 'fyi' ? ' gt-av-fyi' : '';
  return '<div class="gt-avatar' + cls + '">' + initial + '</div>';
}

function _gmailTokenValid() {
  return !!_gmailAccessToken && Date.now() < _gmailTokenExpiry - 60000;
}

// ── Email body extraction ─────────────────────

function _b64decode(data) {
  try {
    var raw = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    try { return decodeURIComponent(escape(raw)); } catch(e) { return raw; }
  } catch(e) { return ''; }
}

function _findPart(payload, mimeType) {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body && payload.body.data) return payload.body.data;
  var parts = payload.parts || [];
  for (var i = 0; i < parts.length; i++) {
    var found = _findPart(parts[i], mimeType);
    if (found) return found;
  }
  return null;
}

function _extractBody(message) {
  if (!message || !message.payload) return '';
  var plain = _findPart(message.payload, 'text/plain');
  if (plain) return _b64decode(plain);
  var html = _findPart(message.payload, 'text/html');
  if (html) {
    return _b64decode(html)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  return _decodeSnippet(message.snippet || '(No body)');
}

// ── Categorization (whitelist) ────────────────
// Only show: customers, markets/shows, Shopify orders, Etsy orders.
// Everything else is silently skipped.

function _categorize(senderEmail, subject) {
  var se = senderEmail.toLowerCase();
  var su = subject.toLowerCase();

  // ── Shopify & Etsy orders ──────────────────
  if (se.includes('t.shopifyemail.com')) return 'orders';
  if (se === 'support@etsy.com' && su.match(/order|sale|sold|funds|deposit|payment/)) return 'orders';
  if (se.includes('seller.etsy.com') && su.match(/order|sold|sale|ship/)) return 'orders';
  if (se.includes('email.etsy.com') && su.match(/order|sold/)) return 'orders';

  // ── Markets & shows (specific senders) ────
  // Farmer's markets, art trails, art fairs, show organizers
  var marketSenders = [
    'austinjuniorforum.org',
    'travisheightsarttrail.org',
    'contactzapp@zapplication.org',  // show invitations (not payment receipts)
    'bluegenieart.com',
    'bluegenie',
    'renegadecraft.com',
  ];
  for (var m = 0; m < marketSenders.length; m++) {
    if (se.includes(marketSenders[m])) return 'needs-reply';
  }

  // ── Customers & market organizers (personal email domains) ──
  // This catches gmail-based market coordinators (CCFM, Art Trail organizers, etc.)
  // AND all customer inquiries
  var personal = ['gmail.com','yahoo.com','hotmail.com','outlook.com',
                  'icloud.com','me.com','aol.com','protonmail.com',
                  'msn.com','sbcglobal.net','att.net','comcast.net'];
  for (var k = 0; k < personal.length; k++) {
    if (se.endsWith('@' + personal[k])) return 'needs-reply';
  }

  // Skip everything else
  return 'skip';
}

function _getPriority(category, senderEmail, subject, isImportant) {
  if (category === 'orders') return 'high';
  if (isImportant) return 'high';
  if (subject.match(/estimate|quote|order|ring|necklace|pendant|bracelet|earring|chain|available|price|custom|repair|size/i)) return 'high';
  return 'medium';
}

function _getDeadline(subject, snippet) {
  var text = subject + ' ' + snippet;
  if (text.match(/june 10|jun 10/i)) return 'Jun 10';
  if (text.match(/june 22|jun 22|06\/22/i)) return 'Jun 22';
  var m = text.match(/due (?:on )?(\w+ \d+)/i);
  if (m) return m[1];
  return null;
}

function _getAction(fromName, subject, snippet) {
  if (subject.match(/estimate|quote/i) && snippet.match(/yes|proceed|would like/i))
    return fromName + ' said YES — confirm order details';
  if (subject.match(/estimate|quote/i)) return 'Reply with estimate or next steps';
  if (subject.match(/available|stackable|bead/i)) return 'Reply: confirm availability / sizing';
  if (subject.match(/survey/i))        return 'Complete survey by deadline';
  if (subject.match(/trail|listing/i)) return 'Check your listing — reply with corrections';
  if (subject.match(/security|quote|appointment/i)) return 'Respond to appointment/quote request';
  return 'Reply to ' + fromName;
}

// ── Render ───────────────────────────────────

function _renderThread(t) {
  var priCls       = t.priority === 'high' ? ' gt-high' : t.priority === 'medium' ? ' gt-medium' : '';
  var unreadDot    = t.unread ? '<span class="gt-unread-dot"></span>' : '';
  var deadlineBadge = t.deadline ? '<span class="gt-deadline-badge">⏰ Due ' + _esc(t.deadline) + '</span>' : '';
  var actionHtml   = t.action ? '<div class="gt-action"><span class="gt-action-text">↩ ' + _esc(t.action) + '</span></div>' : '';
  var gmailBtn     = t.gmailUrl
    ? '<a class="gt-gmail-btn" href="' + _esc(t.gmailUrl) + '" target="_blank" onclick="event.stopPropagation()" title="Open in Gmail">✉</a>'
    : '';
  var tid = _esc(t.threadId || '');

  var fromEmail = _esc(t.email || '');
  var fromName  = _esc(t.from  || '');

  return '<div class="gt-thread' + priCls + '" data-thread-id="' + tid + '" data-from-email="' + fromEmail + '" data-from-name="' + fromName + '" onclick="gtExpandThread(this)">' +
    '<div class="gt-thread-top">' +
      _avatar(t.from, t.category) +
      '<div class="gt-meta">' +
        '<div class="gt-row1">' +
          unreadDot +
          '<span class="gt-from">' + _esc(t.from) + '</span>' +
          '<span class="gt-date">' + _esc(t.age || '') + '</span>' +
          gmailBtn +
        '</div>' +
        '<div class="gt-subject">' + _esc(t.subject) + '</div>' +
        '<div class="gt-snippet">' + _esc(t.snippet) + '</div>' +
        actionHtml +
        deadlineBadge +
      '</div>' +
    '</div>' +
    '<div class="gt-body-wrap">' +
      '<div class="gt-body-loading">⏳ Loading…</div>' +
      '<div class="gt-body-content"></div>' +
      '<div class="gt-body-actions">' +
        '<button class="gt-body-btn gt-reply-btn" onclick="gtShowReply(this);event.stopPropagation()">↩ Reply</button>' +
        '<button class="gt-body-btn gt-trash-btn" onclick="gtTrash(this);event.stopPropagation()">🗑 Trash</button>' +
        '<button class="gt-body-btn gt-inv-btn" onclick="gtShowInvoice(this);event.stopPropagation()">📋 Invoice</button>' +
        '<button class="gt-body-btn" onclick="gtShowCustomer(this);event.stopPropagation()">👤 Customer</button>' +
      '</div>' +
      '<div class="gt-invoice-compose" style="display:none">' +
        '<div class="gt-inv-type-row">' +
          '<button class="gt-inv-type-btn active" data-type="invoice"  onclick="gtInvSetType(this);event.stopPropagation()">📋 Invoice</button>' +
          '<button class="gt-inv-type-btn"        data-type="estimate" onclick="gtInvSetType(this);event.stopPropagation()">📄 Estimate</button>' +
        '</div>' +
        '<div class="gt-inv-items">' +
          '<div class="gt-inv-item-row">' +
            '<input class="gt-inv-desc" type="text" placeholder="Item (e.g. Custom Figaro Chain)" onclick="event.stopPropagation()">' +
            '<input class="gt-inv-price" type="number" placeholder="0.00" min="0" step="0.01" onclick="event.stopPropagation()">' +
            '<button class="gt-inv-rm" onclick="gtInvRemoveItem(this);event.stopPropagation()">−</button>' +
          '</div>' +
        '</div>' +
        '<button class="gt-inv-add-btn" onclick="gtInvAddItem(this);event.stopPropagation()">+ Add item</button>' +
        '<div class="gt-inv-fields">' +
          '<label>Title <input class="gt-inv-title" type="text" placeholder="e.g. Custom Ring — Balance Due" onclick="event.stopPropagation()"></label>' +
          '<label><span class="gt-inv-due-label">Due date</span> <input class="gt-inv-due" type="date" onclick="event.stopPropagation()"></label>' +
          '<label>Note <input class="gt-inv-note" type="text" placeholder="Optional note to customer…" onclick="event.stopPropagation()"></label>' +
        '</div>' +
        '<div class="gt-inv-foot">' +
          '<button class="btn btn-gold btn-sm" onclick="gtSubmitInvoice(this);event.stopPropagation()">Create Draft</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="gtCancelInvoice(this);event.stopPropagation()">Cancel</button>' +
          '<span class="gt-inv-status"></span>' +
        '</div>' +
      '</div>' +
      '<div class="gt-customer-compose" style="display:none">' +
        '<div class="gt-inv-title">👤 Add to Customers</div>' +
        '<div class="gt-cust-fields">' +
          '<label>Name  <input class="gt-cust-name"  type="text"  placeholder="Full name"           onclick="event.stopPropagation()"></label>' +
          '<label>Email <input class="gt-cust-email" type="email" placeholder="email@example.com"   onclick="event.stopPropagation()"></label>' +
          '<label>Phone <input class="gt-cust-phone" type="tel"   placeholder="Optional"            onclick="event.stopPropagation()"></label>' +
          '<label>Notes <input class="gt-cust-notes" type="text"  placeholder="Optional note…"      onclick="event.stopPropagation()"></label>' +
        '</div>' +
        '<div class="gt-inv-foot">' +
          '<button class="btn btn-gold btn-sm" onclick="gtSubmitCustomer(this);event.stopPropagation()">Save Customer</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="gtCancelCustomer(this);event.stopPropagation()">Cancel</button>' +
          '<span class="gt-inv-status"></span>' +
        '</div>' +
      '</div>' +
      '<div class="gt-reply-compose" style="display:none">' +
        '<textarea class="gt-reply-input" placeholder="Type your reply…" onclick="event.stopPropagation()" rows="5"></textarea>' +
        '<div class="gt-reply-foot">' +
          '<button class="btn btn-gold btn-sm" onclick="gtSendReply(this);event.stopPropagation()">▶ Send</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="gtCancelReply(this);event.stopPropagation()">Cancel</button>' +
          '<span class="gt-reply-sig">— Kyle Gross · 512-217-3455 · stonesthrowjewelry.com</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function _section(idBase, threads) {
  var sec = document.getElementById('gt-' + idBase + '-section');
  if (!sec) return;
  if (!threads.length) { sec.style.display = 'none'; return; }
  document.getElementById('gt-' + idBase + '-list').innerHTML = threads.map(_renderThread).join('');
  document.getElementById('gt-' + idBase + '-count').textContent = threads.length;
  sec.style.display = '';
}

function _renderPriorityBanner(threads) {
  var banner = document.getElementById('gt-priority-banner');
  if (!banner) return;
  var top = threads.find(function(t){ return t.category === 'needs-reply' && t.priority === 'high'; });
  if (!top) { banner.style.display = 'none'; return; }
  banner.style.display = '';
  banner.innerHTML =
    '<div class="gt-banner-label">🎯 Top Priority</div>' +
    '<div class="gt-banner-msg"><strong>' + _esc(top.from) + '</strong> — ' + _esc(top.action || top.subject) + '</div>' +
    (top.gmailUrl ? '<a class="gt-banner-btn" href="' + _esc(top.gmailUrl) + '" target="_blank">Open in Gmail →</a>' : '');
}

function _renderStats(threads) {
  var el = document.getElementById('gt-stats');
  if (!el) return;
  var replyCount  = threads.filter(function(t){ return t.category === 'needs-reply'; }).length;
  var orderCount  = threads.filter(function(t){ return t.category === 'orders'; }).length;
  var unreadCount = threads.filter(function(t){ return t.unread; }).length;
  var html = '';
  if (replyCount)  html += '<span class="gt-stat gt-stat-reply">↩ ' + replyCount + ' need' + (replyCount === 1 ? 's' : '') + ' reply</span>';
  if (orderCount)  html += '<span class="gt-stat gt-stat-reply">🛒 ' + orderCount + ' new order' + (orderCount === 1 ? '' : 's') + '</span>';
  if (unreadCount) html += '<span class="gt-stat">📬 ' + unreadCount + ' unread</span>';
  threads.filter(function(t){ return t.deadline; }).forEach(function(t){
    html += '<span class="gt-stat gt-stat-deadline">⏰ ' + _esc((t.from||'').split(' ')[0]) + ' due ' + _esc(t.deadline) + '</span>';
  });
  el.innerHTML = html;
}

// ── Expand / read ─────────────────────────────

function gtExpandThread(el) {
  var isExpanded = el.classList.toggle('gt-expanded');
  if (!isExpanded || el.classList.contains('gt-body-loaded')) return;

  var threadId = el.dataset.threadId;
  if (!threadId) return;

  if (!_gmailTokenValid()) {
    // No live token — show the snippet we already have as a fallback
    var snippetEl = el.querySelector('.gt-snippet');
    var contentEl = el.querySelector('.gt-body-content');
    var loadingEl = el.querySelector('.gt-body-loading');
    if (contentEl && snippetEl && !el.classList.contains('gt-body-loaded')) {
      if (loadingEl) loadingEl.style.display = 'none';
      contentEl.textContent = snippetEl.textContent || '(Connect Gmail to see full message)';
      contentEl.style.display = '';
      var actionsEl = el.querySelector('.gt-body-actions');
      if (actionsEl) actionsEl.style.display = 'flex';
      el.classList.add('gt-body-loaded');
    }
    return;
  }

  var loadingEl = el.querySelector('.gt-body-loading');
  if (loadingEl) loadingEl.style.display = '';

  fetch(
    'https://www.googleapis.com/gmail/v1/users/me/threads/' + threadId + '?format=full',
    { headers: { 'Authorization': 'Bearer ' + _gmailAccessToken } }
  )
  .then(function(r){ return r.json(); })
  .then(function(thread) {
    var msgs    = thread.messages || [];
    var lastMsg = msgs[msgs.length - 1];
    if (!lastMsg) return;

    var hdrs = {};
    ((lastMsg.payload && lastMsg.payload.headers) || []).forEach(function(h){
      hdrs[h.name.toLowerCase()] = h.value;
    });
    var fromRaw   = hdrs['from'] || '';
    var fromEmail = (fromRaw.match(/<([^>]+)>/) || ['', fromRaw])[1].trim();
    var subject   = hdrs['subject'] || '';
    var msgId     = hdrs['message-id'] || '';
    var refs      = ((hdrs['references'] || '') + ' ' + msgId).trim();

    if (loadingEl) loadingEl.style.display = 'none';

    var contentEl = el.querySelector('.gt-body-content');
    contentEl.textContent = _extractBody(lastMsg);
    contentEl.style.display = '';

    var actionsEl = el.querySelector('.gt-body-actions');
    actionsEl.dataset.toEmail  = fromEmail;
    actionsEl.dataset.subject  = subject;
    actionsEl.dataset.msgId    = msgId;
    actionsEl.dataset.refs     = refs;
    actionsEl.style.display    = 'flex';

    el.classList.add('gt-body-loaded');
  })
  .catch(function(){
    if (loadingEl) loadingEl.textContent = 'Could not load message.';
  });
}

// ── Reply ─────────────────────────────────────

function gtShowReply(btn) {
  var card    = btn.closest('.gt-thread');
  var compose = card.querySelector('.gt-reply-compose');
  compose.style.display = '';
  compose.querySelector('.gt-reply-input').focus();
  btn.style.display = 'none';
}

function gtCancelReply(btn) {
  var card    = btn.closest('.gt-thread');
  var compose = card.querySelector('.gt-reply-compose');
  compose.style.display = 'none';
  compose.querySelector('.gt-reply-input').value = '';
  var replyBtn = card.querySelector('.gt-reply-btn');
  if (replyBtn) replyBtn.style.display = '';
}

function gtSendReply(btn) {
  var card      = btn.closest('.gt-thread');
  var compose   = card.querySelector('.gt-reply-compose');
  var textarea  = compose.querySelector('.gt-reply-input');
  var body      = textarea.value.trim();
  if (!body) { textarea.focus(); return; }

  var actionsEl = card.querySelector('.gt-body-actions');
  var threadId  = card.dataset.threadId;
  var to        = actionsEl.dataset.toEmail;
  var subject   = actionsEl.dataset.subject;
  var msgId     = actionsEl.dataset.msgId;
  var refs      = actionsEl.dataset.refs;

  btn.textContent = 'Sending…';
  btn.disabled    = true;

  var fullBody = body + '\n\n--\nKyle Gross\n512-217-3455\nwww.stonesthrowjewelry.com\nStones Throw Studio · Sunset Valley Farmers Market';

  var timeout = setTimeout(function() {
    btn.textContent = '▶ Send';
    btn.disabled    = false;
    alert('Send timed out — check your Gmail Sent folder to see if it went through.');
  }, 10000);

  _sendReply(threadId, to, subject, fullBody, msgId, refs)
    .then(function(){
      clearTimeout(timeout);
      compose.innerHTML = '<div class="gt-sent-msg">✓ Reply sent!</div>';
      var replyBtn = card.querySelector('.gt-reply-btn');
      if (replyBtn) replyBtn.style.display = 'none';
      var dot = card.querySelector('.gt-unread-dot');
      if (dot) dot.remove();
    })
    .catch(function(e){
      clearTimeout(timeout);
      btn.textContent = '▶ Send';
      btn.disabled    = false;
      alert('Send failed: ' + (e.message || 'Unknown error'));
    });
}

function _sendReply(threadId, to, subject, body, inReplyTo, references) {
  if (!subject.match(/^re:/i)) subject = 'Re: ' + subject;
  var msg = [
    'To: ' + to,
    'Subject: ' + subject,
    'In-Reply-To: ' + inReplyTo,
    'References: ' + references,
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
    '',
    body
  ].join('\r\n');

  var encoded = btoa(unescape(encodeURIComponent(msg)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + _gmailAccessToken,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({ raw: encoded, threadId: threadId })
  }).then(function(r){
    if (!r.ok) return r.json().then(function(e){ throw new Error((e.error && e.error.message) || 'Send failed'); });
    return r.json();
  });
}

// ── Trash ─────────────────────────────────────

function gtTrash(btn) {
  var card     = btn.closest('.gt-thread');
  var threadId = card.dataset.threadId;

  if (!threadId) { if (typeof toast === 'function') toast('No thread ID — try reconnecting Gmail.', '⚠️'); return; }
  if (!_gmailTokenValid()) {
    if (typeof toast === 'function') toast('Gmail not connected — sign in with the Connect Gmail button', '🔑');
    _updateAuthUI(false);
    gmailSignIn(true);
    return;
  }

  // Two-step confirm (no native confirm() which gets silently blocked in PWA/iframe)
  if (btn.dataset.confirmPending !== '1') {
    btn.dataset.confirmPending = '1';
    btn.textContent = 'Sure?';
    btn.style.color = '#c0392b';
    setTimeout(function() {
      if (btn.dataset.confirmPending === '1') {
        btn.dataset.confirmPending = '';
        btn.textContent = '🗑 Trash';
        btn.style.color = '';
      }
    }, 3000);
    return;
  }
  btn.dataset.confirmPending = '';
  btn.textContent = 'Moving…';
  btn.style.color = '';
  btn.disabled    = true;

  fetch('https://www.googleapis.com/gmail/v1/users/me/threads/' + threadId + '/trash', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + _gmailAccessToken }
  }).then(function(r){
    if (r.status === 401 || r.status === 403) {
      // Token expired — clear it, re-auth silently, tell user to retry
      _gmailAccessToken = null; _gmailTokenExpiry = 0;
      try {
        localStorage.removeItem('sts-gmail-token');
        localStorage.removeItem('sts-gmail-token-expiry');
        localStorage.removeItem('sts-gmail-scope');
      } catch(e) {}
      _updateAuthUI(false);
      btn.textContent = '🗑 Trash';
      btn.disabled    = false;
      if (typeof toast === 'function') toast('Session expired — sign in again with Connect Gmail', '🔑');
      gmailSignIn(true);
      return;
    }
    if (!r.ok) {
      btn.textContent = '🗑 Trash';
      btn.disabled    = false;
      if (typeof toast === 'function') toast('Trash failed (' + r.status + ') — try again', '⚠️');
      return;
    }
    card.style.transition  = 'opacity 0.25s';
    card.style.opacity     = '0';
    setTimeout(function(){
      card.style.overflow      = 'hidden';
      card.style.transition    = 'max-height 0.3s ease, margin-bottom 0.3s ease';
      card.style.maxHeight     = card.offsetHeight + 'px';
      setTimeout(function(){
        card.style.maxHeight     = '0';
        card.style.marginBottom  = '0';
        setTimeout(function(){ card.remove(); }, 310);
      }, 20);
    }, 250);
  }).catch(function(e){
    console.error('Trash error:', e);
    btn.textContent = '🗑 Trash';
    btn.disabled    = false;
    if (typeof toast === 'function') toast('Trash failed — check connection', '⚠️');
  });
}

// ── Public: load threads into UI ──────────────

// Global cache of order threads (Etsy + Shopify) for use by renderProduction()
var _cachedOrderThreads = [];

function loadGmailThreads(data) {
  var threads = data.threads || [];

  // Cache order threads so the Production tab can use them
  _cachedOrderThreads = threads.filter(function(t){ return t.category === 'orders'; });
  if (typeof renderProduction === 'function') renderProduction();

  document.getElementById('gt-loading').style.display = 'none';

  if (!threads.length) {
    document.getElementById('gt-empty').style.display   = '';
    document.getElementById('gt-content').style.display = 'none';
    var tsEl2 = document.getElementById('gmail-last-run');
    if (tsEl2) tsEl2.textContent = data.fetchedAt ? 'Fetched ' + _formatAge(data.fetchedAt) : 'Live data';
    try { localStorage.setItem('sts-gmail-threads', JSON.stringify(data)); } catch(e){}
    return;
  }

  _renderPriorityBanner(threads);
  _renderStats(threads);
  _section('reply',  threads.filter(function(t){ return t.category === 'needs-reply'; }));
  _section('orders', threads.filter(function(t){ return t.category === 'orders'; }));

  document.getElementById('gt-empty').style.display   = 'none';
  document.getElementById('gt-content').style.display = '';

  var tsEl = document.getElementById('gmail-last-run');
  if (tsEl) tsEl.textContent = data.fetchedAt ? 'Fetched ' + _formatAge(data.fetchedAt) : 'Live data';

  try { localStorage.setItem('sts-gmail-threads', JSON.stringify(data)); } catch(e){}
}

// ── Google OAuth ──────────────────────────────

function initGmailAuth() {
  if (typeof google === 'undefined' || !google.accounts) {
    setTimeout(initGmailAuth, 300); return;
  }
  _gmailTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GMAIL_CLIENT_ID,
    scope:     GMAIL_SCOPE,
    callback:  function(resp) {
      if (resp.error) {
        _updateAuthUI(false);
        if (typeof toast === 'function') toast('Gmail sign-in failed — click Connect Gmail', '🔑');
        return;
      }
      _gmailAccessToken = resp.access_token;
      _gmailTokenExpiry = Date.now() + resp.expires_in * 1000;
      try {
        localStorage.setItem('sts-gmail-token',        _gmailAccessToken);
        localStorage.setItem('sts-gmail-token-expiry', String(_gmailTokenExpiry));
        localStorage.setItem('sts-gmail-scope',        GMAIL_SCOPE);
      } catch(e){}
      _updateAuthUI(true);
      fetchGmailDirect();
    }
  });

  // Restore saved token — only if scope matches
  try {
    var tok       = localStorage.getItem('sts-gmail-token');
    var exp       = parseInt(localStorage.getItem('sts-gmail-token-expiry') || '0');
    var savedScope = localStorage.getItem('sts-gmail-scope');
    if (tok && Date.now() < exp - 60000 && savedScope === GMAIL_SCOPE) {
      _gmailAccessToken = tok;
      _gmailTokenExpiry = exp;
      _updateAuthUI(true);
      return;
    }
  } catch(e){}

  // Clear stale token (old scope or expired)
  try {
    localStorage.removeItem('sts-gmail-token');
    localStorage.removeItem('sts-gmail-token-expiry');
    localStorage.removeItem('sts-gmail-scope');
  } catch(e){}
  _updateAuthUI(false);
}

function gmailSignIn(forcePopup) {
  if (!_gmailTokenClient) { initGmailAuth(); setTimeout(function(){ gmailSignIn(forcePopup); }, 600); return; }
  _gmailTokenClient.requestAccessToken({ prompt: forcePopup ? 'select_account' : '' });
}

function gmailSignOut() {
  if (_gmailAccessToken && typeof google !== 'undefined') {
    google.accounts.oauth2.revoke(_gmailAccessToken);
  }
  _gmailAccessToken = null; _gmailTokenExpiry = 0;
  try {
    localStorage.removeItem('sts-gmail-token');
    localStorage.removeItem('sts-gmail-token-expiry');
    localStorage.removeItem('sts-gmail-scope');
  } catch(e){}
  _updateAuthUI(false);
  document.getElementById('gt-content').style.display = 'none';
  document.getElementById('gt-empty').style.display   = '';
}

function _updateAuthUI(signedIn) {
  var signInBtn  = document.getElementById('gt-signin-btn');
  var signOutBtn = document.getElementById('gt-signout-btn');
  var statusEl   = document.getElementById('gt-auth-status');
  if (signedIn) {
    if (signInBtn)  signInBtn.style.display  = 'none';
    if (signOutBtn) signOutBtn.style.display = '';
    if (statusEl)   statusEl.textContent     = 'kyle@stonesthrowjewelry.com';
  } else {
    if (signInBtn)  signInBtn.style.display  = '';
    if (signOutBtn) signOutBtn.style.display = 'none';
    if (statusEl)   statusEl.textContent     = '';
  }
}

// ── Direct Gmail API fetch ────────────────────

function fetchGmailDirect() {
  if (!_gmailTokenValid()) { gmailSignIn(); return; }

  document.getElementById('gt-loading').style.display = 'flex';
  document.getElementById('gt-content').style.display = 'none';
  document.getElementById('gt-empty').style.display   = 'none';
  var tsEl = document.getElementById('gmail-last-run');
  if (tsEl) tsEl.textContent = 'Fetching…';

  var hdrs = { 'Authorization': 'Bearer ' + _gmailAccessToken };
  var query = encodeURIComponent('in:inbox -in:draft newer_than:14d');

  fetch('https://www.googleapis.com/gmail/v1/users/me/threads?q=' + query + '&maxResults=30', { headers: hdrs })
    .then(function(r){
      if (r.status === 401 || r.status === 403) {
        _gmailAccessToken = null; _gmailTokenExpiry = 0;
        try { localStorage.removeItem('sts-gmail-token'); localStorage.removeItem('sts-gmail-token-expiry'); localStorage.removeItem('sts-gmail-scope'); } catch(e){}
        _updateAuthUI(false);
        document.getElementById('gt-loading').style.display = 'none';
        document.getElementById('gt-empty').style.display   = '';
        if (tsEl) tsEl.textContent = 'Access denied — disconnect and reconnect Gmail';
        throw new Error('HANDLED_401');
      }
      if (!r.ok) throw new Error('Gmail API error ' + r.status);
      return r.json();
    })
    .then(function(listData){
      var ids = (listData.threads || []).map(function(t){ return t.id; });
      if (!ids.length) return [];
      return Promise.all(ids.map(function(id){
        return fetch(
          'https://www.googleapis.com/gmail/v1/users/me/threads/' + id +
          '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date',
          { headers: hdrs }
        ).then(function(r){ return r.ok ? r.json() : null; });
      }));
    })
    .then(function(threadDetails){
      var threads = [];
      (threadDetails || []).filter(Boolean).forEach(function(thread){
        var msgs     = thread.messages || [];
        var lastMsg  = msgs[msgs.length - 1];
        var firstMsg = msgs[0];
        if (!firstMsg) return;

        // Find the first message NOT sent by Kyle so categorization survives
        // threads where Kyle sent the first or last message
        var customerMsg = msgs.find(function(m) {
          var mh = {};
          ((m.payload && m.payload.headers) || []).forEach(function(hdr){
            mh[hdr.name.toLowerCase()] = hdr.value;
          });
          var fe = (mh['from'] || '').toLowerCase();
          return !fe.includes('stonesthrowjewelry.com') && !fe.includes('kyle@');
        }) || firstMsg;

        var h = {};
        ((customerMsg.payload && customerMsg.payload.headers) || []).forEach(function(hdr){
          h[hdr.name.toLowerCase()] = hdr.value;
        });
        // But use last message for snippet, labels, and date (most recent activity)
        var hLast = {};
        ((lastMsg && lastMsg.payload && lastMsg.payload.headers) || []).forEach(function(hdr){
          hLast[hdr.name.toLowerCase()] = hdr.value;
        });

        var rawFrom   = h['from'] || '';
        var fromName  = rawFrom.replace(/<[^>]+>/, '').trim().replace(/^"|"$/g, '').trim();
        var fromEmail = (rawFrom.match(/<([^>]+)>/) || ['', rawFrom])[1].trim();
        var subject   = h['subject'] || hLast['subject'] || '(no subject)';
        var snippet   = _decodeSnippet((lastMsg || firstMsg).snippet || '');
        var labelIds  = (lastMsg || firstMsg).labelIds || [];
        var isUnread  = labelIds.indexOf('UNREAD')    !== -1;
        var isImp     = labelIds.indexOf('IMPORTANT') !== -1;
        var dateStr   = hLast['date'] || h['date'] || '';
        var dateObj   = dateStr ? new Date(dateStr) : new Date();

        var category = _categorize(fromEmail, subject);
        console.log('[Gmail] from:', fromEmail, '| subject:', subject, '| cat:', category);
        if (category === 'skip') return;

        threads.push({
          threadId: thread.id,
          from:     fromName || fromEmail,
          email:    fromEmail,
          subject:  subject,
          snippet:  snippet,
          date:     dateObj.toISOString(),
          age:      _formatAge(dateObj),
          category: category,
          priority: _getPriority(category, fromEmail, subject, isImp),
          action:   category === 'needs-reply' ? _getAction(fromName || fromEmail, subject, snippet) : null,
          unread:   isUnread,
          deadline: _getDeadline(subject, snippet),
          gmailUrl: 'https://mail.google.com/mail/u/0/#inbox/' + thread.id
        });
      });

      loadGmailThreads({ fetchedAt: new Date().toISOString(), threads: threads });
    })
    .catch(function(e){
      if (e && e.message === 'HANDLED_401') return;  // already showed UI
      console.error('Gmail API error:', e);
      document.getElementById('gt-loading').style.display = 'none';
      document.getElementById('gt-empty').style.display   = '';
      if (tsEl) tsEl.textContent = 'Fetch failed — try reconnecting';
    });
}

// ── Entry points ──────────────────────────────

function runGmailOverview() {
  if (_gmailTokenValid()) {
    fetchGmailDirect();
  } else if (_inClaudeContext()) {
    document.getElementById('gt-loading').style.display = 'flex';
    document.getElementById('gt-content').style.display = 'none';
    document.getElementById('gt-empty').style.display   = 'none';
    safeSendPrompt(
      'Fetch my Gmail inbox using the Gmail MCP. Use search_threads query "in:inbox -in:draft newer_than:7d" pageSize 50. ' +
      'Only include two categories — skip everything else entirely: ' +
      '"needs-reply" = real customers (personal email domains: gmail, yahoo, outlook, icloud, etc.) + farmers market/art market organizers + show invitations. ' +
      '"orders" = Shopify order emails (t.shopifyemail.com) + Etsy order/sale emails (support@etsy.com, seller.etsy.com). ' +
      'Skip: Square, PayPal, ShipStation, tax notices, newsletters, marketing, automated reports — anything not a real person or an order. ' +
      'Use get_thread for needs-reply threads to get better action descriptions. ' +
      'Call loadGmailThreads({ fetchedAt: new Date().toISOString(), threads: [{ threadId, from, email, subject, snippet, date, age, category, priority, action, unread, deadline, gmailUrl }] }) ' +
      'where gmailUrl = "https://mail.google.com/mail/u/0/#inbox/" + threadId.'
    );
  } else {
    gmailSignIn();
  }
}

function loadScheduledBrief() {
  if (_gmailTokenValid()) { fetchGmailDirect(); return; }
  _refreshFromJson(false);
}

function _inClaudeContext() {
  return (typeof sendPrompt === 'function') || (window !== window.parent);
}

function _refreshFromJson(showFeedback) {
  if (showFeedback) {
    document.getElementById('gt-loading').style.display = 'flex';
    document.getElementById('gt-content').style.display = 'none';
    document.getElementById('gt-empty').style.display   = 'none';
  }
  fetch('./gmail-brief.json?t=' + Date.now())
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      if (data && data.threads && data.threads.length) { loadGmailThreads(data); }
      else if (showFeedback) {
        document.getElementById('gt-loading').style.display = 'none';
        document.getElementById('gt-empty').style.display   = '';
      }
    })
    .catch(function(){
      if (showFeedback) {
        document.getElementById('gt-loading').style.display = 'none';
        document.getElementById('gt-empty').style.display   = '';
      }
    });
}

function loadCachedThreads() {
  try {
    var saved = localStorage.getItem('sts-gmail-threads');
    if (!saved) return false;
    var d = JSON.parse(saved);
    if (d && d.threads && d.threads.length) { loadGmailThreads(d); return true; }
  } catch(e){}
  return false;
}

// ── Square Invoice ────────────────────────────

function _gtSqPublishInvoice(invoiceId, version, statusEl) {
  if (statusEl) statusEl.textContent = 'Sending…';
  _gtSqCall('/v2/invoices/' + invoiceId + '/publish', 'POST', { version: version })
    .then(function(d) {
      if (d.invoice) {
        if (statusEl) statusEl.innerHTML = '✓ Sent to customer!';
      } else {
        var msg = ((d.errors || [])[0] || {}).detail || 'Publish failed';
        if (statusEl) statusEl.textContent = '⚠ ' + msg;
      }
    })
    .catch(function(e) {
      if (statusEl) statusEl.textContent = '⚠ ' + (e.message || 'Publish failed');
    });
}

function _gtSqCall(path, method, body) {
  var token = localStorage.getItem('sts-square-token');
  if (!token) return Promise.reject(new Error('No Square token — add it in ⚙ Integrations'));
  return fetch('/api/square', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path, method: method || 'GET', body: body, token: token })
  }).then(function(r){ return r.json(); });
}

function _gtSqLocation() {
  return localStorage.getItem('sts-square-location') || '';
}

function _gtInvDefaultDue() {
  var d = new Date(); d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

function gtInvSetType(btn) {
  var row = btn.closest('.gt-inv-type-row');
  row.querySelectorAll('.gt-inv-type-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  var isEstimate = btn.dataset.type === 'estimate';
  var compose    = btn.closest('.gt-invoice-compose');
  var dueLabel   = compose.querySelector('.gt-inv-due-label');
  if (dueLabel) dueLabel.textContent = isEstimate ? 'Valid until' : 'Due date';
}

function gtShowInvoice(btn) {
  var card        = btn.closest('.gt-thread');
  var compose     = card.querySelector('.gt-invoice-compose');
  var replyCompose = card.querySelector('.gt-reply-compose');
  if (replyCompose) replyCompose.style.display = 'none';
  compose.style.display = '';
  var due = compose.querySelector('.gt-inv-due');
  if (due && !due.value) due.value = _gtInvDefaultDue();
}

function gtCancelInvoice(btn) {
  var compose = btn.closest('.gt-invoice-compose');
  compose.style.display = 'none';
  compose.querySelector('.gt-inv-status').textContent = '';
}

function gtInvAddItem(btn) {
  var itemList = btn.closest('.gt-invoice-compose').querySelector('.gt-inv-items');
  var row = document.createElement('div');
  row.className = 'gt-inv-item-row';
  row.innerHTML =
    '<input class="gt-inv-desc" type="text" placeholder="Item description" onclick="event.stopPropagation()">' +
    '<input class="gt-inv-price" type="number" placeholder="0.00" min="0" step="0.01" onclick="event.stopPropagation()">' +
    '<button class="gt-inv-rm" onclick="gtInvRemoveItem(this);event.stopPropagation()">−</button>';
  itemList.appendChild(row);
  row.querySelector('.gt-inv-desc').focus();
}

function gtInvRemoveItem(btn) {
  var row  = btn.closest('.gt-inv-item-row');
  var list = row.parentNode;
  if (list.querySelectorAll('.gt-inv-item-row').length > 1) row.remove();
}

function gtSubmitInvoice(btn) {
  var card    = btn.closest('.gt-thread');
  var compose = btn.closest('.gt-invoice-compose');
  var status  = compose.querySelector('.gt-inv-status');

  var customerEmail = card.dataset.fromEmail || '';
  var customerName  = card.dataset.fromName  || '';

  if (!customerEmail) { status.textContent = 'No email address — expand the thread first.'; return; }
  if (!_gtSqLocation()) { status.textContent = 'No Location ID — add it in ⚙ Integrations.'; return; }

  var items = [];
  compose.querySelectorAll('.gt-inv-item-row').forEach(function(row) {
    var desc  = row.querySelector('.gt-inv-desc').value.trim();
    var price = parseFloat(row.querySelector('.gt-inv-price').value) || 0;
    if (desc && price > 0) items.push({ name: desc, price: price });
  });
  if (!items.length) { status.textContent = 'Add at least one item with a price.'; return; }

  var activeTypeBtn = compose.querySelector('.gt-inv-type-btn.active');
  var invType = (activeTypeBtn && activeTypeBtn.dataset.type === 'estimate') ? 'ESTIMATE' : 'INVOICE';
  var dueDate = compose.querySelector('.gt-inv-due').value || _gtInvDefaultDue();
  var title   = compose.querySelector('.gt-inv-title').value.trim();
  var note    = compose.querySelector('.gt-inv-note').value.trim();

  btn.textContent = 'Creating…';
  btn.disabled    = true;
  status.textContent = '';

  // Step 1: find or create Square customer by email
  _gtSqCall('/v2/customers/search', 'POST', {
    query: { filter: { email_address: { exact: customerEmail } } }
  })
  .then(function(d) {
    if (d.customers && d.customers.length) return d.customers[0].id;
    var parts = customerName.split(' ');
    return _gtSqCall('/v2/customers', 'POST', {
      idempotency_key: 'sts-cust-' + customerEmail.replace(/\W/g, '') + Date.now(),
      given_name:    parts[0] || customerName,
      family_name:   parts.slice(1).join(' ') || '',
      email_address: customerEmail
    }).then(function(d2) {
      if (d2.customer) return d2.customer.id;
      throw new Error(((d2.errors || [])[0] || {}).detail || 'Could not create customer');
    });
  })
  // Step 2: create order with line items
  .then(function(customerId) {
    return _gtSqCall('/v2/orders', 'POST', {
      idempotency_key: 'sts-ord-' + Date.now(),
      order: {
        location_id: _gtSqLocation(),
        customer_id: customerId,
        line_items: items.map(function(item) {
          return {
            name: item.name,
            quantity: '1',
            base_price_money: { amount: Math.round(item.price * 100), currency: 'USD' }
          };
        })
      }
    }).then(function(d3) {
      if (d3.order) return { customerId: customerId, orderId: d3.order.id };
      throw new Error(((d3.errors || [])[0] || {}).detail || 'Could not create order');
    });
  })
  // Step 3: create draft invoice
  .then(function(ids) {
    return _gtSqCall('/v2/invoices', 'POST', {
      idempotency_key: 'sts-inv-' + Date.now(),
      invoice: Object.assign({
        location_id:       _gtSqLocation(),
        order_id:          ids.orderId,
        primary_recipient: { customer_id: ids.customerId },
        delivery_method:   'EMAIL',
        ...(title ? { title: title } : {}),
        ...(note  ? { description: note } : {}),
        accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false }
      }, invType === 'INVOICE' ? {
        payment_requests: [{ request_type: 'BALANCE', due_date: dueDate, automatic_payment_source: 'NONE' }]
      } : {})
    });
  })
  .then(function(d4) {
    btn.textContent = 'Create Draft';
    btn.disabled    = false;
    if (d4.invoice) {
      var inv      = d4.invoice;
      var url      = 'https://squareup.com/dashboard/invoices/' + inv.id;
      var typeWord = invType === 'ESTIMATE' ? 'estimate' : 'invoice';
      compose.innerHTML =
        '<div class="gt-inv-success">✓ Draft ' + typeWord + ' created — ' +
        '<a href="' + url + '" target="_blank" class="gt-inv-link" onclick="event.stopPropagation()">Review in Square →</a>' +
        ' <button class="btn btn-gold btn-sm" id="gt-inv-send-btn" style="margin-left:8px;" onclick="event.stopPropagation();this.disabled=true;_gtSqPublishInvoice(\'' + inv.id + '\',' + inv.version + ',document.getElementById(\'gt-inv-send-status\'))">▶ Send Now</button>' +
        ' <span id="gt-inv-send-status" style="font-size:12px;margin-left:6px;"></span>' +
        '</div>';
    } else {
      throw new Error(((d4.errors || [])[0] || {}).detail || 'Invoice creation failed');
    }
  })
  .catch(function(e) {
    btn.textContent   = 'Create Draft';
    btn.disabled      = false;
    status.textContent = '⚠ ' + (e.message || 'Unknown error');
  });
}

// ── Customer card ────────────────────────────

function gtShowCustomer(btn) {
  var card    = btn.closest('.gt-thread');
  var compose = card.querySelector('.gt-customer-compose');
  // Close other open panels
  card.querySelector('.gt-invoice-compose').style.display = 'none';
  card.querySelector('.gt-reply-compose').style.display   = 'none';
  compose.style.display = '';
  // Pre-fill from thread data
  compose.querySelector('.gt-cust-name').value  = card.dataset.fromName  || '';
  compose.querySelector('.gt-cust-email').value = card.dataset.fromEmail || '';
  compose.querySelector('.gt-cust-name').focus();
}

function gtCancelCustomer(btn) {
  btn.closest('.gt-customer-compose').style.display = 'none';
}

function gtSubmitCustomer(btn) {
  var compose = btn.closest('.gt-customer-compose');
  var status  = compose.querySelector('.gt-inv-status');

  var name  = compose.querySelector('.gt-cust-name').value.trim();
  var email = compose.querySelector('.gt-cust-email').value.trim();
  var phone = compose.querySelector('.gt-cust-phone').value.trim();
  var notes = compose.querySelector('.gt-cust-notes').value.trim();

  if (!name)  { status.textContent = 'Name is required.'; return; }
  if (!email) { status.textContent = 'Email is required.'; return; }

  // Check if already exists
  var existing = (window.CUSTOMERS || []).find(function(c) {
    return c.name.toLowerCase() === name.toLowerCase() ||
           (c.email && c.email.toLowerCase() === email.toLowerCase());
  });

  if (existing) {
    compose.innerHTML =
      '<div class="gt-inv-success">✓ Already in Customers — ' +
      '<button class="gt-inv-link" style="background:none;border:none;cursor:pointer;padding:0;font-weight:700;" ' +
      'onclick="switchParent(\'custom-orders\');switchSubTab(\'customers\');event.stopPropagation()">View in Customers →</button>' +
      '</div>';
    return;
  }

  btn.textContent = 'Saving…';
  btn.disabled    = true;
  status.textContent = '';

  var customer = {
    name:         name,
    email:        email,
    phone:        phone,
    notes:        notes,
    lastContact:  new Date().toISOString().slice(0, 10),
    totalOrders:  0,
    totalValue:   0,
    activeOrders: 0
  };

  if (window.CUSTOMERS) window.CUSTOMERS.unshift(customer);

  // Sync to Notion if available, then show success
  var syncP = (typeof upsertCustomerToNotion === 'function')
    ? upsertCustomerToNotion(customer)
    : Promise.resolve();

  syncP.then(function() {
    if (typeof renderCustomers === 'function') renderCustomers();
    compose.innerHTML =
      '<div class="gt-inv-success">✓ Customer saved — ' +
      '<button class="gt-inv-link" style="background:none;border:none;cursor:pointer;padding:0;font-weight:700;" ' +
      'onclick="switchParent(\'custom-orders\');switchSubTab(\'customers\');event.stopPropagation()">View in Customers →</button>' +
      '</div>';
  }).catch(function() {
    // Even if Notion fails, local save succeeded
    if (typeof renderCustomers === 'function') renderCustomers();
    compose.innerHTML =
      '<div class="gt-inv-success">✓ Customer saved locally (Notion sync skipped) — ' +
      '<button class="gt-inv-link" style="background:none;border:none;cursor:pointer;padding:0;font-weight:700;" ' +
      'onclick="switchParent(\'custom-orders\');switchSubTab(\'customers\');event.stopPropagation()">View in Customers →</button>' +
      '</div>';
  });
}

// ── Auto-init ─────────────────────────────────
loadCachedThreads() || _refreshFromJson(false);
initGmailAuth();
