// ════════════════════════════════════════════
//  GMAIL OVERVIEW  —  pages/gmail.js
//  Brief rendering and scheduled JSON loader
// ════════════════════════════════════════════


// Convert plain-text bullet section to styled HTML
function renderSection(text) {
  if (!text || !text.trim()) return '<span class="gb-empty">Nothing to report.</span>';
  var trimmed = text.trim();
  // Non-bullet single-line messages (e.g. "No new customer emails.")
  if (!trimmed.startsWith('-')) {
    return '<span class="gb-empty">' + trimmed + '</span>';
  }
  var items = trimmed.split('\n')
    .filter(function(l){ return l.trim().startsWith('-'); })
    .map(function(l){
      var content = l.replace(/^[-–]\s*/, '');
      // **bold** → <strong>
      content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      return '<li>' + content + '</li>';
    });
  return '<ul class="gb-list">' + items.join('') + '</ul>';
}

function renderPriority(text) {
  if (!text || !text.trim()) return 'Nothing flagged for today.';
  return text.trim().replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function showBrief(data) {
  var el;
  el = document.getElementById('go-customers');  if (el) el.innerHTML = renderSection(data.customers || '');
  el = document.getElementById('go-business');   if (el) el.innerHTML = renderSection(data.business  || '');
  el = document.getElementById('go-sales-gmail');if (el) el.innerHTML = renderSection(data.sales     || '');
  el = document.getElementById('go-priority');   if (el) el.innerHTML = renderPriority(data.priority  || '');
  document.getElementById('go-run-banner').style.display = 'none';
  document.getElementById('go-grid').style.display = '';
  var label = data.date ? ('Brief — ' + data.date) : 'Brief loaded';
  var tsEl = document.getElementById('gmail-last-run');
  if (tsEl) tsEl.textContent = label;
  try {
    localStorage.setItem('sts-gmail-ts', label);
    localStorage.setItem('sts-gmail-overview', JSON.stringify({
      customers: data.customers || '', business: data.business || '',
      salesGmail: data.sales || '', priority: data.priority || ''
    }));
  } catch(e) {}
}

function runGmailOverview() {
  safeSendPrompt('run morning gmail overview');
  var tsEl = document.getElementById('gmail-last-run');
  if (tsEl) tsEl.textContent = 'Sent to chat — reload page when done';
  toast('Running in chat — reload the page once it\'s done', '📧');
}

// Fetch the JSON written by the scheduled task
function loadScheduledBrief() {
  fetch('./gmail-brief.json?t=' + Date.now())
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      if (!data) return;
      var hasContent = (data.customers || data.business || data.sales || data.priority);
      if (!hasContent) return;
      showBrief(data);
    })
    .catch(function(){});
}

// Fall back to localStorage (for sessions without a fresh JSON)
function loadGmailOverview() {
  try {
    var saved = localStorage.getItem('sts-gmail-overview');
    if (!saved) return;
    var d = JSON.parse(saved);
    var hasContent = (d.customers || d.business || d.salesGmail || d.priority);
    if (!hasContent) return;
    showBrief({ customers: d.customers, business: d.business, sales: d.salesGmail, priority: d.priority });
    var ts = localStorage.getItem('sts-gmail-ts');
    if (ts) { var tsEl = document.getElementById('gmail-last-run'); if (tsEl) tsEl.textContent = ts; }
  } catch(e) {}
}

function saveGmailOverview() {} // kept for compatibility; showBrief handles saving now

// ── Auto-init (app.js loads before gmail.js, so call here instead) ──────────
loadGmailOverview();
loadScheduledBrief();

// ============================================================
