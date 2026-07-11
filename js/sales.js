// ════════════════════════════════════════════
//  SALES  —  pages/sales.js
//  Renders the Sales tab from SQUARE_WEEKENDS + ORDERS data
// ════════════════════════════════════════════

// ── Square sync helpers ───────────────────────────────────────────────────────

async function _salesSqFetch(path) {
  var token = localStorage.getItem('sts-square-token');
  if (!token) throw new Error('No Square token — add it in ⚙ Integrations');
  var res = await fetch('/api/square', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path, method: 'GET', token: token }),
  });
  var json = await res.json();
  if (!res.ok) throw new Error((json.errors && json.errors[0] && json.errors[0].detail) || JSON.stringify(json));
  return json;
}

async function _fetchDayTotal(dateObj) {
  // Returns { total, num_transactions } for a full calendar day (local midnight → next midnight, in UTC RFC3339)
  var start = new Date(dateObj);
  start.setHours(0, 0, 0, 0);
  var end = new Date(start);
  end.setDate(end.getDate() + 1);

  var total = 0, txCount = 0, cursor = null;
  do {
    var qs = '?location_id=D7EZ98V48F79A'
      + '&begin_time=' + encodeURIComponent(start.toISOString())
      + '&end_time='   + encodeURIComponent(end.toISOString())
      + '&limit=200'
      + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    var data = await _salesSqFetch('/v2/payments' + qs);
    var payments = data.payments || [];
    payments.forEach(function(p) {
      if (p.status !== 'COMPLETED') return;
      total    += (p.total_money && p.total_money.amount) ? p.total_money.amount / 100 : 0;
      txCount  += 1;
    });
    cursor = data.cursor || null;
  } while (cursor);

  return { total: Math.round(total * 100) / 100, num_transactions: txCount };
}

// Finds the most recent Saturday relative to today
function _lastSaturday() {
  var d = new Date();
  var day = d.getDay(); // 0=Sun…6=Sat
  var daysBack = day === 6 ? 0 : (day + 1);
  d.setDate(d.getDate() - daysBack);
  d.setHours(0, 0, 0, 0);
  return d;
}

function _weekendLabel(satDate) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var sun = new Date(satDate);
  sun.setDate(sun.getDate() + 1);
  var satStr = months[satDate.getMonth()] + ' ' + satDate.getDate();
  var sunStr = (sun.getMonth() !== satDate.getMonth() ? months[sun.getMonth()] + ' ' : '') + sun.getDate();
  return satStr + '-' + sunStr;
}

// ── localStorage persistence ─────────────────────────────────────────────────

var SALES_LS_KEY = 'sts-square-weekends';

function _loadSyncedWeekends() {
  try { return JSON.parse(localStorage.getItem(SALES_LS_KEY) || '[]'); } catch(e) { return []; }
}

function _saveSyncedWeekend(entry) {
  var stored = _loadSyncedWeekends();
  var idx = stored.findIndex(function(w){ return w.weekend === entry.weekend; });
  if (idx >= 0) { stored[idx] = entry; } else { stored.push(entry); }
  localStorage.setItem(SALES_LS_KEY, JSON.stringify(stored));
}

// Merges hardcoded baseline with localStorage overrides (synced data wins)
function _mergedWeekends() {
  var synced = _loadSyncedWeekends();
  var syncedMap = {};
  synced.forEach(function(w){ syncedMap[w.weekend] = w; });

  var base = SQUARE_WEEKENDS.map(function(w){
    return syncedMap[w.weekend] || w;
  });
  // Append any synced entries not in the hardcoded baseline
  synced.forEach(function(w){
    if (!SQUARE_WEEKENDS.find(function(b){ return b.weekend === w.weekend; })) {
      base.push(w);
    }
  });
  base.sort(function(a,b){ return a.weekend < b.weekend ? -1 : a.weekend > b.weekend ? 1 : 0; });
  return base;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

async function syncSquareSales() {
  var btn = document.getElementById('salesSyncBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }

  try {
    var sat = _lastSaturday();
    var sun = new Date(sat);
    sun.setDate(sun.getDate() + 1);

    var pad = function(n){ return String(n).padStart(2,'0'); };
    var weekendKey = sat.getFullYear() + '-' + pad(sat.getMonth()+1) + '-' + pad(sat.getDate());

    var satResult = await _fetchDayTotal(sat);
    var sunResult = await _fetchDayTotal(sun);

    var entry = {
      weekend:          weekendKey,
      label:            _weekendLabel(sat),
      saturday:         satResult.total,
      sunday:           sunResult.total,
      total:            Math.round((satResult.total + sunResult.total) * 100) / 100,
      num_transactions: satResult.num_transactions + sunResult.num_transactions,
    };

    _saveSyncedWeekend(entry);

    if (btn) { btn.disabled = false; btn.textContent = '↻ Sync from Square'; }
    renderSales();

    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#2A7A48;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.18)';
    toast.textContent = 'Synced ' + entry.label + ' — $' + entry.total.toLocaleString();
    document.body.appendChild(toast);
    setTimeout(function(){ toast.remove(); }, 4000);

  } catch(err) {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Sync from Square'; }
    alert('Square sync failed: ' + err.message);
  }
}

// ── Auto-sync once per day ───────────────────────────────────────────────────
// Called once when the Sales tab is first shown. Silently syncs at most once
// per calendar day so data stays current without manual intervention.

function salesAutoSync() {
  var token = localStorage.getItem('sts-square-token');
  if (!token) return;

  var now      = new Date();
  var todayKey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
  var lastKey  = localStorage.getItem('sts-square-autosync-date');
  if (lastKey === todayKey) return;

  localStorage.setItem('sts-square-autosync-date', todayKey);
  syncSquareSales();
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderSales() {
  var el = document.getElementById('salesContent');
  if (!el) return;

  // ── Stats ─────────────────────────────────
  var allData  = _mergedWeekends();
  var weeks    = allData.slice(-8);
  var lastWeek = allData[allData.length - 1] || {};
  var prevWeek = allData[allData.length - 2] || {};
  var totalYTD = allData.reduce(function(s,w){ return s + (w.total||0); }, 0);
  var totalTx  = allData.reduce(function(s,w){ return s + (w.num_transactions||0); }, 0);
  var avgWeek  = allData.length ? totalYTD / allData.length : 0;
  var avgTx    = allData.length ? totalTx / allData.length : 0;

  var lastTotal = lastWeek.total || 0;
  var prevTotal = prevWeek.total || 0;
  var weekChange = prevTotal ? ((lastTotal - prevTotal) / prevTotal * 100).toFixed(0) : 0;
  var changeSign = weekChange >= 0 ? '+' : '';
  var changeCls  = weekChange >= 0 ? 'up' : 'down';

  // Active orders pipeline value
  var pipelineVal = ORDERS
    .filter(function(o){ return !['complete','delivered'].includes(o.stage); })
    .reduce(function(s,o){ return s + (o.price||0); }, 0);

  var html = '';

  // ── Sync button + auto-update note ───────
  html += '<div class="sales-toolbar">';
  html += '<span class="sales-toolbar-note">⏱ Auto-updates every Saturday &amp; Sunday evening</span>';
  html += '<button id="salesSyncBtn" class="sales-sync-btn" onclick="syncSquareSales()">↻ Sync from Square</button>';
  html += '</div>';

  // ── Stat Cards ────────────────────────────
  html += '<div class="sales-stats">';
  html += statCard('💰', 'si-gold',   'Last Weekend',   '$' + lastTotal.toLocaleString(),
    '<span class="sales-delta ' + changeCls + '">' + changeSign + weekChange + '% vs prior</span>');
  html += statCard('📅', 'si-green',  'YTD Market Sales','$' + Math.round(totalYTD).toLocaleString(), allData.length + ' weekends');
  html += statCard('📊', 'si-purple', 'Avg / Weekend',  '$' + Math.round(avgWeek).toLocaleString(), Math.round(avgTx) + ' avg transactions');
  html += statCard('🔧', 'si-red',    'Active Pipeline', '$' + pipelineVal.toLocaleString(),
    ORDERS.filter(function(o){ return !['complete','delivered'].includes(o.stage); }).length + ' open orders');
  html += '</div>';

  // ── Charts row ────────────────────────────
  html += '<div class="sales-row">';

  // Weekend revenue bars
  html += '<div class="sales-card">';
  html += '<div class="sales-card-head">Weekend Market Sales — Last 8 Weeks</div>';
  html += '<div class="sales-card-body">';
  var maxWeek = Math.max.apply(null, weeks.map(function(w){ return w.total||0; }));
  html += '<div class="sales-bar-wrap">';
  weeks.forEach(function(w) {
    var pct = maxWeek ? Math.round((w.total / maxWeek) * 100) : 0;
    var satPct = maxWeek ? Math.round(((w.saturday||0) / maxWeek) * 100) : 0;
    var sunPct = maxWeek ? Math.round(((w.sunday||0)   / maxWeek) * 100) : 0;
    html += '<div class="sales-bar-row">';
    html += '<div class="sales-bar-lbl"><span>' + w.label + '</span><span class="sales-bar-amt">$' + Math.round(w.total).toLocaleString() + '</span></div>';
    html += '<div class="sales-bar-track"><div class="sales-bar-fill sf-gold" style="width:' + pct + '%"></div></div>';
    html += '<div class="sales-bar-lbl sales-bar-sub">';
    html += '<span>Sat $' + Math.round(w.saturday||0).toLocaleString() + '</span>';
    html += '<span>Sun $' + Math.round(w.sunday||0).toLocaleString() + '</span></div>';
    html += '</div>';
  });
  html += '</div></div></div>';

  // Order pipeline by stage
  html += '<div class="sales-card">';
  html += '<div class="sales-card-head">Active Orders by Stage</div>';
  html += '<div class="sales-card-body">';
  html += '<div class="sales-bar-wrap">';
  var stageMap = {};
  ORDERS.forEach(function(o) {
    if (['delivered'].includes(o.stage)) return;
    if (!stageMap[o.stage]) stageMap[o.stage] = { count:0, value:0 };
    stageMap[o.stage].count++;
    stageMap[o.stage].value += (o.price||0);
  });
  var stageOrder = ['inquiry','sketch','needs-est','quote','wait-cust','est-appr','deposit-wait','deposit-paid','order-mat','materials','wait-cust-ship','build','ready-pick','complete'];
  var stageLabels = {
    'inquiry':'Inquiry','sketch':'Sketch','needs-est':'Needs Estimate','quote':'Estimate Sent',
    'wait-cust':'Waiting on Customer','est-appr':'Estimate Approved',
    'deposit-wait':'Waiting on Deposit','deposit-paid':'Deposit Paid',
    'order-mat':'Order Materials',
    'materials':'Waiting on Materials','wait-cust-ship':'Waiting on Customer Shipment','build':'At the Bench','ready-pick':'Ready for Pickup','complete':'Completed'
  };
  var maxVal = 1;
  stageOrder.forEach(function(s){ if (stageMap[s]) maxVal = Math.max(maxVal, stageMap[s].value); });
  stageOrder.forEach(function(s) {
    if (!stageMap[s]) return;
    var d = stageMap[s];
    var pct = Math.round((d.value / maxVal) * 100);
    html += '<div class="sales-bar-row">';
    html += '<div class="sales-bar-lbl"><span>' + stageLabels[s] + ' (' + d.count + ')</span><span class="sales-bar-amt">$' + d.value.toLocaleString() + '</span></div>';
    html += '<div class="sales-bar-track"><div class="sales-bar-fill sf-blue" style="width:' + pct + '%"></div></div>';
    html += '</div>';
  });
  html += '</div></div></div>';
  html += '</div>'; // sales-row

  // ── Weekly table ──────────────────────────
  html += '<div class="sales-card sales-block">';
  html += '<div class="sales-card-head">All Weekend Sales</div>';
  html += '<div class="sales-card-body sales-flush">';
  html += '<div class="sales-table-wrap"><table class="sales-table">';
  html += '<thead><tr>';
  ['Weekend','Saturday','Sunday','Total','Transactions'].forEach(function(h) {
    html += '<th>' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  var allWeeks = allData.slice().reverse();
  allWeeks.forEach(function(w) {
    html += '<tr>';
    html += '<td class="sales-td-label">' + w.label + '</td>';
    html += '<td>$' + (w.saturday||0).toLocaleString() + '</td>';
    html += '<td>$' + (w.sunday||0).toLocaleString() + '</td>';
    html += '<td class="sales-td-total">$' + Math.round(w.total).toLocaleString() + '</td>';
    html += '<td class="sales-td-muted">' + (w.num_transactions||0) + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div></div></div>';

  // ════════════════════════════════════════════
  // ── Custom Order Revenue ──────────────────
  // ════════════════════════════════════════════

  html += '<div class="sales-section">';
  html += '<div class="sales-section-head">';
  html += '<div>';
  html += '<div class="sales-section-title">✏️ Custom Order Revenue</div>';
  html += '<div class="sales-section-sub">Completed orders from the pipeline — separate from market sales</div>';
  html += '</div></div>';

  var completedOrders = ORDERS.filter(function(o) {
    return o.stage === 'complete' || o.stage === 'delivered';
  }).sort(function(a, b) {
    var da = a.completedAt || a.deadline || '';
    var db = b.completedAt || b.deadline || '';
    return db < da ? -1 : db > da ? 1 : 0;
  });

  var customTotal  = completedOrders.reduce(function(s,o){ return s + (o.finalPrice || o.price || 0); }, 0);
  var customCount  = completedOrders.length;
  var customAvg    = customCount ? customTotal / customCount : 0;
  var activeCount  = ORDERS.filter(function(o){ return o.stage !== 'complete' && o.stage !== 'delivered'; }).length;
  var activeVal    = ORDERS.filter(function(o){ return o.stage !== 'complete' && o.stage !== 'delivered'; })
                           .reduce(function(s,o){ return s + (o.price||0); }, 0);

  html += '<div class="sales-stats">';
  html += statCard('💎', 'si-gold',   'Total Completed',  '$' + Math.round(customTotal).toLocaleString(), customCount + ' orders');
  html += statCard('📊', 'si-purple', 'Avg Order Value',  '$' + Math.round(customAvg).toLocaleString(),  'per completed order');
  html += statCard('🔧', 'si-red',    'Active Pipeline',  '$' + activeVal.toLocaleString(),              activeCount + ' open orders');
  html += '</div>';

  html += '<div class="sales-card">';
  html += '<div class="sales-card-head">Completed Orders</div>';
  html += '<div class="sales-card-body sales-flush">';

  if (!completedOrders.length) {
    html += '<div class="sales-empty">No completed orders yet</div>';
  } else {
    html += '<div class="sales-table-wrap"><table class="sales-table">';
    html += '<thead><tr>';
    ['Customer','Description','Type','Amount','Completed','Paid By'].forEach(function(h) {
      html += '<th>' + h + '</th>';
    });
    html += '</tr></thead><tbody>';

    var typeLabels = { order:'Custom', estimate:'Estimate', repair:'Repair' };
    completedOrders.forEach(function(o) {
      var amount   = o.finalPrice || o.price || 0;
      var dateStr  = o.completedAt ? new Date(o.completedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
                   : o.deadline    ? new Date(o.deadline).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
                   : '<span class="sales-td-muted">Unknown</span>';
      var typeLabel = typeLabels[o.orderType] || 'Custom';
      var paidBy   = o.paidBy ? esc(o.paidBy) : '<span class="sales-td-muted">—</span>';
      html += '<tr>';
      html += '<td class="sales-td-label">'  + esc(o.name || '—') + '</td>';
      html += '<td class="sales-td-desc">' + esc(o.desc || '—') + '</td>';
      html += '<td><span class="sales-chip">' + typeLabel + '</span></td>';
      html += '<td class="sales-td-total">$' + amount.toLocaleString() + '</td>';
      html += '<td>' + dateStr + '</td>';
      html += '<td class="sales-td-muted">' + paidBy + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  html += '</div></div></div>'; // close card, section

  el.innerHTML = html;
}

function statCard(icon, iconCls, label, value, sub) {
  return '<div class="stat-card">'
    + '<div class="stat-icon ' + iconCls + '">' + icon + '</div>'
    + '<div><div class="stat-label">' + label + '</div>'
    + '<div class="stat-value">' + value + '</div>'
    + (sub ? '<div class="stat-sub">' + sub + '</div>' : '')
    + '</div></div>';
}
