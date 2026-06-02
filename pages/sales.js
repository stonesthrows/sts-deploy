// ════════════════════════════════════════════
//  SALES  —  pages/sales.js
//  Renders the Sales tab from SQUARE_WEEKENDS + ORDERS data
// ════════════════════════════════════════════

function renderSales() {
  var el = document.getElementById('salesContent');
  if (!el) return;

  // ── Stats ─────────────────────────────────
  var weeks    = SQUARE_WEEKENDS.slice(-8);
  var lastWeek = SQUARE_WEEKENDS[SQUARE_WEEKENDS.length - 1] || {};
  var prevWeek = SQUARE_WEEKENDS[SQUARE_WEEKENDS.length - 2] || {};
  var totalYTD = SQUARE_WEEKENDS.reduce(function(s,w){ return s + (w.total||0); }, 0);
  var totalTx  = SQUARE_WEEKENDS.reduce(function(s,w){ return s + (w.num_transactions||0); }, 0);
  var avgWeek  = SQUARE_WEEKENDS.length ? totalYTD / SQUARE_WEEKENDS.length : 0;
  var avgTx    = SQUARE_WEEKENDS.length ? totalTx / SQUARE_WEEKENDS.length : 0;

  var lastTotal = lastWeek.total || 0;
  var prevTotal = prevWeek.total || 0;
  var weekChange = prevTotal ? ((lastTotal - prevTotal) / prevTotal * 100).toFixed(0) : 0;
  var changeSign = weekChange >= 0 ? '+' : '';
  var changeCls  = weekChange >= 0 ? 'color:#2A7A48' : 'color:#C43030';

  // Active orders pipeline value
  var pipelineVal = ORDERS
    .filter(function(o){ return !['complete','delivered'].includes(o.stage); })
    .reduce(function(s,o){ return s + (o.price||0); }, 0);

  var html = '';

  // ── Stat Cards ────────────────────────────
  html += '<div class="sales-stats">';
  html += statCard('💰', 'si-gold',   'Last Weekend',   '$' + lastTotal.toLocaleString(),
    '<span style="' + changeCls + ';font-size:11px;font-weight:600">' + changeSign + weekChange + '% vs prior</span>');
  html += statCard('📅', 'si-green',  'YTD Market Sales','$' + Math.round(totalYTD).toLocaleString(), SQUARE_WEEKENDS.length + ' weekends');
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
    html += '<div class="sales-bar-lbl"><span>' + w.label + '</span><span style="font-weight:700">$' + Math.round(w.total).toLocaleString() + '</span></div>';
    html += '<div class="sales-bar-track"><div class="sales-bar-fill" style="width:' + pct + '%;background:linear-gradient(90deg,#C9983A,#E8B850)"></div></div>';
    html += '<div class="sales-bar-lbl" style="font-size:11px;color:#9A8860">';
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
  var stageOrder = ['inquiry','sketch','needs-est','quote','wait-cust','est-appr','order-mat','materials','build','ready-pick','complete'];
  var stageLabels = {
    'inquiry':'Inquiry','sketch':'Sketch','needs-est':'Needs Estimate','quote':'Estimate Sent',
    'wait-cust':'Waiting on Customer','est-appr':'Estimate Approved','order-mat':'Order Materials',
    'materials':'Waiting on Materials','build':'At the Bench','ready-pick':'Ready for Pickup','complete':'Completed'
  };
  var maxVal = 1;
  stageOrder.forEach(function(s){ if (stageMap[s]) maxVal = Math.max(maxVal, stageMap[s].value); });
  stageOrder.forEach(function(s) {
    if (!stageMap[s]) return;
    var d = stageMap[s];
    var pct = Math.round((d.value / maxVal) * 100);
    html += '<div class="sales-bar-row">';
    html += '<div class="sales-bar-lbl"><span>' + stageLabels[s] + ' (' + d.count + ')</span><span style="font-weight:700">$' + d.value.toLocaleString() + '</span></div>';
    html += '<div class="sales-bar-track"><div class="sales-bar-fill" style="width:' + pct + '%;background:#6A9AD4"></div></div>';
    html += '</div>';
  });
  html += '</div></div></div>';
  html += '</div>'; // sales-row

  // ── Weekly table ──────────────────────────
  html += '<div class="sales-card" style="margin-top:14px">';
  html += '<div class="sales-card-head">All Weekend Sales</div>';
  html += '<div class="sales-card-body" style="padding:0">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<thead><tr style="background:#F8F3EC;border-bottom:1px solid #E4DDD4">';
  ['Weekend','Saturday','Sunday','Total','Transactions'].forEach(function(h) {
    html += '<th style="padding:9px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#7A7268">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  var allWeeks = SQUARE_WEEKENDS.slice().reverse();
  allWeeks.forEach(function(w, i) {
    var bg = i % 2 === 0 ? '#fff' : '#FDFAF6';
    html += '<tr style="background:' + bg + ';border-bottom:1px solid #F4EFE8">';
    html += '<td style="padding:8px 16px;font-weight:600">' + w.label + '</td>';
    html += '<td style="padding:8px 16px">$' + (w.saturday||0).toLocaleString() + '</td>';
    html += '<td style="padding:8px 16px">$' + (w.sunday||0).toLocaleString() + '</td>';
    html += '<td style="padding:8px 16px;font-weight:700;color:#2A7A48">$' + Math.round(w.total).toLocaleString() + '</td>';
    html += '<td style="padding:8px 16px;color:#7A7268">' + (w.num_transactions||0) + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';

  el.innerHTML = html;
}

function statCard(icon, iconCls, label, value, sub) {
  return '<div class="stat-card">'
    + '<div class="stat-icon ' + iconCls + '">' + icon + '</div>'
    + '<div><div class="stat-label">' + label + '</div>'
    + '<div class="stat-value">' + value + '</div>'
    + (sub ? '<div style="font-size:11px;color:#7A7268;margin-top:2px">' + sub + '</div>' : '')
    + '</div></div>';
}
