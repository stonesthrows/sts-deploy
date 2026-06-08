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

  return '<div class="gt-thread' + priCls + '" data-thread-id="' + tid + '" onclick="gtExpandThread(this)">' +
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
  if (!threadId || !_gmailTokenValid()) return;

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
    actionsEl.dataset.threadId = thread.id;
    actionsEl.dataset.toEmail  = fromEmail;
    actionsEl.dataset.subject  = subject;
    actionsEl.dataset.msgId    = msgId;
    actionsEl.dataset.refs     = refs;
    actionsEl.style.display    = '';

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
  var threadId  = actionsEl.dataset.threadId;
  var to        = actionsEl.dataset.toEmail;
  var subject   = actionsEl.dataset.subject;
  var msgId     = actionsEl.dataset.msgId;
  var refs      = actionsEl.dataset.refs;

  btn.textContent = 'Sending…';
  btn.disabled    = true;

  var fullBody = body + '\n\n--\nKyle Gross\n512-217-3455\nwww.stonesthrowjewelry.com\nStones Throw Studio · Sunset Valley Farmers Market';

  _sendReply(threadId, to, subject, fullBody, msgId, refs)
    .then(function(){
      compose.innerHTML = '<div class="gt-sent-msg">✓ Reply sent!</div>';
      var replyBtn = card.querySelector('.gt-reply-btn');
      if (replyBtn) replyBtn.style.display = 'none';
      card.querySelector('.gt-unread-dot') && card.querySelector('.gt-unread-dot').remove();
    })
    .catch(function(e){
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
  var card      = btn.closest('.gt-thread');
  var actionsEl = card.querySelector('.gt-body-actions');
  var threadId  = actionsEl.dataset.threadId;

  if (!confirm('Move this conversation to Trash?')) return;
  btn.textContent = 'Moving…';
  btn.disabled    = true;

  fetch('https://www.googleapis.com/gmail/v1/users/me/threads/' + threadId + '/trash', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + _gmailAccessToken }
  }).then(function(r){
    if (!r.ok) { btn.textContent = '🗑 Trash'; btn.disabled = false; return; }
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
  }).catch(function(){
    btn.textContent = '🗑 Trash';
    btn.disabled    = false;
  });
}

// ── Public: load threads into UI ──────────────

function loadGmailThreads(data) {
  var threads = data.threads || [];
  _renderPriorityBanner(threads);
  _renderStats(threads);
  _section('reply',  threads.filter(function(t){ return t.category === 'needs-reply'; }));
  _section('orders', threads.filter(function(t){ return t.category === 'orders'; }));

  document.getElementById('gt-loading').style.display = 'none';
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
      if (resp.error) { _updateAuthUI(false); return; }
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

function gmailSignIn() {
  if (!_gmailTokenClient) { initGmailAuth(); setTimeout(gmailSignIn, 600); return; }
  _gmailTokenClient.requestAccessToken({ prompt: '' });
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

  fetch('https://www.googleapis.com/gmail/v1/users/me/threads?q=in:inbox+-in:draft+newer_than:14d&maxResults=30', { headers: hdrs })
    .then(function(r){ return r.json(); })
    .then(function(listData){
      var ids = (listData.threads || []).map(function(t){ return t.id; });
      return Promise.all(ids.map(function(id){
        return fetch(
          'https://www.googleapis.com/gmail/v1/users/me/threads/' + id +
          '?format=metadata&metadataHeaders=Subject,From,Date',
          { headers: hdrs }
        ).then(function(r){ return r.json(); });
      }));
    })
    .then(function(threadDetails){
      var threads = [];
      threadDetails.forEach(function(thread){
        var msgs    = thread.messages || [];
        var lastMsg = msgs[msgs.length - 1];
        if (!lastMsg) return;

        var h = {};
        ((lastMsg.payload && lastMsg.payload.headers) || []).forEach(function(hdr){
          h[hdr.name.toLowerCase()] = hdr.value;
        });

        var rawFrom   = h['from'] || '';
        var fromName  = rawFrom.replace(/<[^>]+>/, '').trim().replace(/^"|"$/g, '').trim();
        var fromEmail = (rawFrom.match(/<([^>]+)>/) || ['', rawFrom])[1].trim();
        var subject   = h['subject'] || '(no subject)';
        var snippet   = _decodeSnippet(lastMsg.snippet || '');
        var labelIds  = lastMsg.labelIds || [];
        var isUnread  = labelIds.indexOf('UNREAD')    !== -1;
        var isImp     = labelIds.indexOf('IMPORTANT') !== -1;
        var dateObj   = h['date'] ? new Date(h['date']) : new Date();

        var category = _categorize(fromEmail, subject);
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

// ── Auto-init ─────────────────────────────────
loadCachedThreads() || _refreshFromJson(false);
initGmailAuth();
