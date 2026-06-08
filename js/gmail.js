// ════════════════════════════════════════════
//  GMAIL  —  js/gmail.js
//  Live thread view
// ════════════════════════════════════════════

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _avatar(from, category) {
  var initial = (from || '?').trim().charAt(0).toUpperCase();
  var cls = category === 'business' ? ' gt-av-biz' : category === 'fyi' ? ' gt-av-fyi' : '';
  return '<div class="gt-avatar' + cls + '">' + initial + '</div>';
}

function _renderThread(t) {
  var priCls = t.priority === 'high' ? ' gt-high' : t.priority === 'medium' ? ' gt-medium' : '';
  var actionHtml = t.action
    ? '<div class="gt-action"><span class="gt-action-text">↩ ' + _esc(t.action) + '</span></div>'
    : '';
  return '<div class="gt-thread' + priCls + '">' +
    _avatar(t.from, t.category) +
    '<div class="gt-meta">' +
      '<div class="gt-row1">' +
        '<span class="gt-from">' + _esc(t.from) + '</span>' +
        '<span class="gt-date">' + _esc(t.age || t.date || '') + '</span>' +
      '</div>' +
      '<div class="gt-subject">' + _esc(t.subject) + '</div>' +
      '<div class="gt-snippet">' + _esc(t.snippet) + '</div>' +
      actionHtml +
    '</div>' +
  '</div>';
}

function _formatTs(iso) {
  try {
    var d = new Date(iso), now = new Date();
    var diffM = Math.round((now - d) / 60000);
    if (diffM < 2)   return 'just now';
    if (diffM < 60)  return diffM + 'm ago';
    if (diffM < 120) return '1 hour ago';
    if (diffM < 1440) return Math.round(diffM / 60) + 'h ago';
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  } catch(e) { return iso; }
}

function _section(idBase, threads) {
  var sec = document.getElementById('gt-' + idBase + '-section');
  if (!sec) return;
  if (!threads.length) { sec.style.display = 'none'; return; }
  document.getElementById('gt-' + idBase + '-list').innerHTML = threads.map(_renderThread).join('');
  document.getElementById('gt-' + idBase + '-count').textContent = threads.length;
  sec.style.display = '';
}

// Called by Claude (via safeSendPrompt response) or by loadScheduledBrief
function loadGmailThreads(data) {
  var threads = data.threads || [];
  _section('reply', threads.filter(function(t){ return t.category === 'needs-reply'; }));
  _section('biz',   threads.filter(function(t){ return t.category === 'business'; }));
  _section('fyi',   threads.filter(function(t){ return t.category === 'fyi'; }));

  document.getElementById('gt-loading').style.display = 'none';
  document.getElementById('gt-empty').style.display   = 'none';
  document.getElementById('gt-content').style.display = '';

  var ts = data.fetchedAt ? 'Fetched ' + _formatTs(data.fetchedAt) : 'Live data';
  var tsEl = document.getElementById('gmail-last-run');
  if (tsEl) tsEl.textContent = ts;

  try {
    localStorage.setItem('sts-gmail-threads', JSON.stringify(data));
    localStorage.setItem('sts-gmail-ts', data.fetchedAt || new Date().toISOString());
  } catch(e) {}
}

function runGmailOverview() {
  document.getElementById('gt-loading').style.display = 'flex';
  document.getElementById('gt-content').style.display = 'none';
  document.getElementById('gt-empty').style.display   = 'none';
  var tsEl = document.getElementById('gmail-last-run');
  if (tsEl) tsEl.textContent = 'Fetching…';
  safeSendPrompt(
    'Fetch my Gmail inbox live. Use the gmail MCP search_threads tool to get the 25 most recent inbox threads. ' +
    'For each thread use get_thread to read the content. Score each by importance to my jewelry business. ' +
    'Categorize each thread as: "needs-reply" (requires action/response from me), ' +
    '"business" (orders, shipping, invoices, vendor notifications — no reply needed), ' +
    'or "fyi" (automated, newsletters, low priority). ' +
    'Then call loadGmailThreads({ fetchedAt: new Date().toISOString(), threads: [ ' +
    '{ from, email, subject, snippet, date, age, category, priority, action } ] }) ' +
    'where priority is "high"/"medium"/"low" and action is a short phrase describing what I need to do (for needs-reply only).'
  );
}

function loadScheduledBrief() {
  fetch('./gmail-brief.json?t=' + Date.now())
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      if (data && data.threads) { loadGmailThreads(data); }
      // Ignore legacy plain-text format — rely on cache instead
    })
    .catch(function(){});
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

// ── Auto-init ────────────────────────────
loadCachedThreads();
loadScheduledBrief();
