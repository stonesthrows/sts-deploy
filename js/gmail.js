// ════════════════════════════════════════════
//  GMAIL  —  js/gmail.js
//  Standalone Gmail via Google OAuth + REST API
//  Falls back to Claude MCP when in Claude context
// ════════════════════════════════════════════

var GMAIL_CLIENT_ID = '787985557761-4g12h5j9a6h3okq75onbrsv5vo6br719.apps.googleusercontent.com';
var GMAIL_SCOPE     = 'https://www.googleapis.com/auth/gmail.readonly';

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
  var d   = (date instanceof Date) ? date : new Date(date);
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

// ── Categorization ───────────────────────────

function _categorize(senderEmail, subject, labelIds) {
  var se = senderEmail.toLowerCase();
  var su = subject.toLowerCase();

  // Skip: pure marketing / social / noise
  var skipDomains = [
    'facebookmail.com','linkedin.com','twitter.com','instagram.com',
    'strikingly.com','qualtrics-survey.com','judge.me',
    'aftershipmail.com','shared1.ccsend.com','austinmoms.com',
    'pdfhouse.com','alstspecials.com','patrickadairsupplies.com',
    'openrouter.ai','affirm.com','interactivebrokers.com',
    'email.shopify.com','shop.tiktok.com'
  ];
  for (var i = 0; i < skipDomains.length; i++) {
    if (se.includes(skipDomains[i])) return 'skip';
  }
  if (se === 'memories@facebookmail.com') return 'skip';
  if (se.includes('calendar-notification@google.com') && su.includes('no events')) return 'skip';
  if (se.includes('google.com') && su.includes('security talks')) return 'skip';
  if (se.includes('email.etsy.com') && !su.includes('order') && !su.includes('sale') && !su.includes('funds')) return 'skip';

  // Business: known transaction / operational senders
  var bizPatterns = [
    't.shopifyemail.com','support@etsy.com','seller.etsy.com',
    'noreply@messaging.squareup.com','noreply.squarefinancialservices@squareup',
    'no-reply@shipstation.com','noreply@zapplication.org','contactzapp@zapplication.org',
    'cpa.texas.gov','service@paypal.com','riogrande','stuller.com',
    'stamps.com','forms-receipts-noreply@google.com'
  ];
  for (var j = 0; j < bizPatterns.length; j++) {
    if (se.includes(bizPatterns[j])) return 'business';
  }

  // fyi: anything left that's clearly auto-generated
  if (se.includes('noreply') || se.includes('no-reply') ||
      se.includes('donotreply') || se.includes('do.not.reply') ||
      se.includes('notification') || se.includes('automated') ||
      se.includes('automail') || se.includes('@e.') || se.includes('@email.')) {
    return 'fyi';
  }

  // needs-reply: personal email domains
  var personal = ['gmail.com','yahoo.com','hotmail.com','outlook.com',
                  'icloud.com','me.com','aol.com','protonmail.com','msn.com'];
  for (var k = 0; k < personal.length; k++) {
    if (se.endsWith('@' + personal[k])) return 'needs-reply';
  }

  // needs-reply: known business contacts who write personally
  var replyBiz = ['melqua.com','austinjuniorforum.org','ccfm.atx'];
  for (var m = 0; m < replyBiz.length; m++) {
    if (se.includes(replyBiz[m])) return 'needs-reply';
  }

  return 'fyi';
}

function _getPriority(category, senderEmail, subject, isImportant) {
  if (category !== 'needs-reply') {
    // Business high: new orders, tax deadlines, security alerts
    if (subject.includes('order') || subject.includes('tax') || subject.includes('due date') ||
        subject.includes('profile update') || subject.includes('refund')) return 'medium';
    return 'low';
  }
  if (isImportant) return 'high';
  // Customer inquiry is high priority
  var custSigns = ['estimate','quote','order','ring','necklace','pendant','bracelet',
                   'earring','chain','available','price','custom','repair','size'];
  var su = subject.toLowerCase();
  for (var i = 0; i < custSigns.length; i++) {
    if (su.includes(custSigns[i])) return 'high';
  }
  return 'medium';
}

function _getDeadline(subject, snippet) {
  var text = (subject + ' ' + snippet).toLowerCase();
  var m;
  m = text.match(/due (?:on )?(\w+ \d+(?:st|nd|rd|th)?)/i);
  if (m) return m[1].replace(/(st|nd|rd|th)$/i,'');
  if (text.includes('june 10') || text.includes('jun 10') || text.includes('june 10th')) return 'Jun 10';
  if (text.includes('june 22') || text.includes('jun 22') || text.includes('06/22')) return 'Jun 22';
  if (text.includes('wednesday')) {
    var wed = new Date(); wed.setDate(wed.getDate() + ((3 - wed.getDay() + 7) % 7));
    return wed.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  }
  return null;
}

function _getAction(fromName, subject, snippet) {
  var su = subject.toLowerCase(), sn = snippet.toLowerCase();
  if (su.includes('estimate') && sn.includes('yes')) return fromName + ' said YES — confirm order details';
  if (su.includes('estimate') || su.includes('quote'))  return 'Reply with estimate or next steps';
  if (su.includes('available') || su.includes('stackable') || su.includes('bead'))
    return 'Reply: confirm availability / sizing';
  if (su.includes('survey'))   return 'Complete survey by deadline';
  if (su.includes('trail') || su.includes('listing')) return 'Check your listing — reply with corrections';
  if (su.includes('security') || su.includes('quote') || su.includes('appointment'))
    return 'Respond to appointment / quote request';
  return 'Reply to ' + fromName;
}

// ── Render ───────────────────────────────────

function _renderThread(t) {
  var priCls     = t.priority === 'high' ? ' gt-high' : t.priority === 'medium' ? ' gt-medium' : '';
  var unreadDot  = t.unread ? '<span class="gt-unread-dot"></span>' : '';
  var deadlineBadge = t.deadline ? '<span class="gt-deadline-badge">⏰ Due ' + _esc(t.deadline) + '</span>' : '';
  var actionHtml = t.action ? '<div class="gt-action"><span class="gt-action-text">↩ ' + _esc(t.action) + '</span></div>' : '';
  var gmailBtn   = t.gmailUrl
    ? '<a class="gt-gmail-btn" href="' + _esc(t.gmailUrl) + '" target="_blank" onclick="event.stopPropagation()" title="Open in Gmail">✉</a>'
    : '';

  return '<div class="gt-thread' + priCls + '" onclick="gtToggleExpand(this)">' +
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
  '</div>';
}

function gtToggleExpand(el) { el.classList.toggle('gt-expanded'); }

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
  var replyCount = threads.filter(function(t){ return t.category === 'needs-reply'; }).length;
  var unreadCount = threads.filter(function(t){ return t.unread; }).length;
  var html = '';
  if (replyCount)  html += '<span class="gt-stat gt-stat-reply">↩ ' + replyCount + ' need' + (replyCount === 1 ? 's' : '') + ' reply</span>';
  if (unreadCount) html += '<span class="gt-stat">📬 ' + unreadCount + ' unread</span>';
  threads.filter(function(t){ return t.deadline; }).forEach(function(t) {
    html += '<span class="gt-stat gt-stat-deadline">⏰ ' + _esc((t.from||'').split(' ')[0]) + ' due ' + _esc(t.deadline) + '</span>';
  });
  el.innerHTML = html;
}

// ── Public: load threads into UI ──────────────

function loadGmailThreads(data) {
  var threads = data.threads || [];
  _renderPriorityBanner(threads);
  _renderStats(threads);
  _section('reply', threads.filter(function(t){ return t.category === 'needs-reply'; }));
  _section('biz',   threads.filter(function(t){ return t.category === 'business'; }));
  _section('fyi',   threads.filter(function(t){ return t.category === 'fyi'; }));

  document.getElementById('gt-loading').style.display = 'none';
  document.getElementById('gt-empty').style.display   = 'none';
  document.getElementById('gt-content').style.display = '';

  var tsEl = document.getElementById('gmail-last-run');
  if (tsEl) tsEl.textContent = data.fetchedAt ? 'Fetched ' + _formatAge(data.fetchedAt) : 'Live data';

  try {
    localStorage.setItem('sts-gmail-threads', JSON.stringify(data));
  } catch(e) {}
}

// ── Google OAuth ──────────────────────────────

function initGmailAuth() {
  if (typeof google === 'undefined' || !google.accounts) {
    setTimeout(initGmailAuth, 300); return;
  }
  _gmailTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GMAIL_CLIENT_ID,
    scope: GMAIL_SCOPE,
    callback: function(resp) {
      if (resp.error) { _updateAuthUI(false); return; }
      _gmailAccessToken = resp.access_token;
      _gmailTokenExpiry = Date.now() + resp.expires_in * 1000;
      try {
        localStorage.setItem('sts-gmail-token', _gmailAccessToken);
        localStorage.setItem('sts-gmail-token-expiry', String(_gmailTokenExpiry));
      } catch(e) {}
      _updateAuthUI(true);
      fetchGmailDirect();
    }
  });

  // Restore saved token
  try {
    var tok = localStorage.getItem('sts-gmail-token');
    var exp = parseInt(localStorage.getItem('sts-gmail-token-expiry') || '0');
    if (tok && Date.now() < exp - 60000) {
      _gmailAccessToken = tok;
      _gmailTokenExpiry = exp;
      _updateAuthUI(true);
      return;
    }
  } catch(e) {}
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
  } catch(e) {}
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
  if (!_gmailTokenValid()) {
    if (_gmailTokenClient) { _gmailTokenClient.requestAccessToken({ prompt: '' }); return; }
    gmailSignIn(); return;
  }

  document.getElementById('gt-loading').style.display = 'flex';
  document.getElementById('gt-content').style.display = 'none';
  document.getElementById('gt-empty').style.display   = 'none';
  var tsEl = document.getElementById('gmail-last-run');
  if (tsEl) tsEl.textContent = 'Fetching…';

  var headers = { 'Authorization': 'Bearer ' + _gmailAccessToken };

  fetch('https://www.googleapis.com/gmail/v1/users/me/threads?q=in:inbox+-in:draft+newer_than:14d&maxResults=30', { headers: headers })
    .then(function(r){ return r.json(); })
    .then(function(listData) {
      var ids = (listData.threads || []).map(function(t){ return t.id; });
      return Promise.all(ids.map(function(id){
        return fetch(
          'https://www.googleapis.com/gmail/v1/users/me/threads/' + id +
          '?format=metadata&metadataHeaders=Subject,From,Date',
          { headers: headers }
        ).then(function(r){ return r.json(); });
      }));
    })
    .then(function(threadDetails) {
      var threads = [];
      threadDetails.forEach(function(thread) {
        var msgs = thread.messages || [];
        var lastMsg = msgs[msgs.length - 1];
        if (!lastMsg) return;

        var hdrs = {};
        ((lastMsg.payload && lastMsg.payload.headers) || []).forEach(function(h){
          hdrs[h.name.toLowerCase()] = h.value;
        });

        var rawFrom  = hdrs['from'] || '';
        var fromName = rawFrom.replace(/<[^>]+>/, '').trim().replace(/^"|"$/g, '').trim();
        var fromEmail = (rawFrom.match(/<([^>]+)>/) || ['', rawFrom])[1].trim();
        var subject  = hdrs['subject'] || '(no subject)';
        var snippet  = _decodeSnippet(lastMsg.snippet || '');
        var labelIds = lastMsg.labelIds || [];
        var isUnread = labelIds.indexOf('UNREAD') !== -1;
        var isImportant = labelIds.indexOf('IMPORTANT') !== -1;
        var dateStr  = hdrs['date'] || '';
        var dateObj  = dateStr ? new Date(dateStr) : new Date();

        var category = _categorize(fromEmail, subject, labelIds);
        if (category === 'skip') return;

        var priority = _getPriority(category, fromEmail, subject, isImportant);
        var deadline = _getDeadline(subject, snippet);
        var action   = category === 'needs-reply' ? _getAction(fromName || fromEmail, subject, snippet) : null;

        threads.push({
          threadId: thread.id,
          from:     fromName || fromEmail,
          email:    fromEmail,
          subject:  subject,
          snippet:  snippet,
          date:     dateObj.toISOString(),
          age:      _formatAge(dateObj),
          category: category,
          priority: priority,
          action:   action,
          unread:   isUnread,
          deadline: deadline,
          gmailUrl: 'https://mail.google.com/mail/u/0/#inbox/' + thread.id
        });
      });

      loadGmailThreads({ fetchedAt: new Date().toISOString(), threads: threads });
    })
    .catch(function(e) {
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
      'Fetch my Gmail inbox using the Gmail MCP. ' +
      'Use search_threads with query "in:inbox -in:draft newer_than:7d" and pageSize 50. ' +
      'Categorize each thread as "needs-reply", "business", or "fyi". Skip pure marketing/newsletter/spam. ' +
      'For needs-reply use get_thread for better action descriptions. ' +
      'Then call loadGmailThreads({ fetchedAt: new Date().toISOString(), threads: ' +
      '[{ threadId, from, email, subject, snippet, date, age, category, priority, action, unread, deadline, gmailUrl }] }) ' +
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
    .then(function(data) {
      if (data && data.threads && data.threads.length) {
        loadGmailThreads(data);
      } else if (showFeedback) {
        document.getElementById('gt-loading').style.display = 'none';
        document.getElementById('gt-empty').style.display   = '';
      }
    })
    .catch(function() {
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
  } catch(e) {}
  return false;
}

// ── Auto-init ─────────────────────────────────
// Load cached display immediately, then init OAuth
loadCachedThreads() || _refreshFromJson(false);
initGmailAuth();
