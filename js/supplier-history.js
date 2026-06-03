// ════════════════════════════════════════════
//  SUPPLIER ORDER HISTORY  —  pages/supplier-history.js
// ════════════════════════════════════════════

var OH_KEY        = 'sot_history_v1';
var OH_NOTION_DB  = 'ce32844c-fd51-4a3c-87a5-30ae79e16f8d';

// ── State ─────────────────────────────────────
var ohOrders    = [];
var ohSupFilter = 'all';
var ohYearFilter= String(new Date().getFullYear()); // default current year
var ohSortCol   = 'd';
var ohSortAsc   = false;
var ohEditId    = null;
var ohSelected  = new Set();

// ── Bootstrap ─────────────────────────────────
function ohInit() {
  ohLoad();
  ohRebuildYearDropdown();
  ohWireFilters();
  ohWireSort();
  ohWireAddBtn();
  ohWireSelection();
  ohWireCsvImport();
  ohWireNotionBtns();
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'oh-notion-data') ohHandleNotionLoad(e.data.orders || []);
  });
  ohRender();
  ohUpdateTs();
}

// ── Persistence ───────────────────────────────
function ohLoad() {
  try {
    var raw = localStorage.getItem(OH_KEY);
    if (raw) ohOrders = JSON.parse(raw);
    ohOrders.forEach(function(o){ if (o.amt != null) o.amt = parseFloat(o.amt) || null; });
  } catch(e) { ohOrders = []; }
  ohDedupeExisting();
}

// One-time cleanup: remove duplicate orders already in localStorage
function ohDedupeExisting() {
  var seen = {}, result = [];
  ohOrders.forEach(function(o) {
    var key = o.orderNum || o.invNum || o.id;
    if (!seen[key]) { seen[key] = true; result.push(o); }
  });
  if (result.length < ohOrders.length) {
    ohOrders = result;
    ohSave();
  }
}
function ohSave() {
  try { localStorage.setItem(OH_KEY, JSON.stringify(ohOrders)); } catch(e) {}
}

// ── Filters ───────────────────────────────────
function ohWireFilters() {
  var sf = document.getElementById('ohSf');
  if (sf) sf.addEventListener('click', function(e) {
    var btn = e.target.closest('.oh-fbtn[data-sup]');
    if (!btn) return;
    sf.querySelectorAll('.oh-fbtn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    ohSupFilter = btn.dataset.sup;
    ohRender();
  });
  var yf = document.getElementById('ohYearFilter');
  if (yf) yf.addEventListener('change', function() {
    ohYearFilter = yf.value;
    ohRender();
  });
}

function ohRebuildYearDropdown() {
  var sel = document.getElementById('ohYearFilter');
  if (!sel) return;
  var currentYear = String(new Date().getFullYear());
  // Collect all years present in data
  var years = new Set();
  years.add(currentYear);
  ohOrders.forEach(function(o){ if (o.date && o.date.length >= 4) years.add(o.date.slice(0,4)); });
  var sorted = Array.from(years).sort().reverse();
  sel.innerHTML = '<option value="all">All Years</option>'
    + sorted.map(function(y){
        return '<option value="' + y + '"' + (y === ohYearFilter ? ' selected' : '') + '>' + y + '</option>';
      }).join('');
}

function ohResetFilters() {
  ohSelected.clear();
  ohSupFilter = 'all';
  var sf = document.getElementById('ohSf');
  if (sf) {
    sf.querySelectorAll('.oh-fbtn').forEach(function(b){ b.classList.remove('active'); });
    var all = sf.querySelector('.oh-fbtn[data-sup="all"]');
    if (all) all.classList.add('active');
  }
}

// ── Sort ──────────────────────────────────────
function ohWireSort() {
  var tbl = document.querySelector('.oh-table');
  if (!tbl) return;
  tbl.addEventListener('click', function(e) {
    var th = e.target.closest('th[data-ohcol]');
    if (!th) return;
    var col = th.dataset.ohcol;
    if (ohSortCol === col) { ohSortAsc = !ohSortAsc; }
    else { ohSortCol = col; ohSortAsc = col !== 'd'; }
    tbl.querySelectorAll('th[data-ohcol]').forEach(function(h){
      h.classList.remove('sorted');
      h.textContent = h.textContent.replace(/ [▲▼]$/, '');
    });
    th.classList.add('sorted');
    th.textContent = th.textContent + (ohSortAsc ? ' ▲' : ' ▼');
    ohRender();
  });
}

// ── Multi-select & bulk delete ────────────────
function ohWireSelection() {
  var selectAll = document.getElementById('ohSelectAll');
  if (selectAll) {
    selectAll.addEventListener('change', function() {
      var tbody = document.getElementById('ohTbody');
      if (!tbody) return;
      tbody.querySelectorAll('.oh-row-cb').forEach(function(cb) {
        cb.checked = selectAll.checked;
        if (selectAll.checked) ohSelected.add(cb.dataset.id);
        else ohSelected.delete(cb.dataset.id);
        cb.closest('tr').classList.toggle('oh-selected', selectAll.checked);
      });
      ohUpdateBulkBar();
    });
  }
}

function ohToggleRow(id, checked) {
  if (checked) ohSelected.add(id);
  else ohSelected.delete(id);
  var selectAll = document.getElementById('ohSelectAll');
  if (selectAll) {
    var cbs = document.querySelectorAll('.oh-row-cb');
    selectAll.checked = cbs.length > 0 && ohSelected.size === cbs.length;
    selectAll.indeterminate = ohSelected.size > 0 && ohSelected.size < cbs.length;
  }
  ohUpdateBulkBar();
}

function ohUpdateBulkBar() {
  var bar = document.getElementById('ohBulkBar');
  var lbl = document.getElementById('ohBulkCount');
  if (!bar) return;
  var n = ohSelected.size;
  if (n > 0) {
    bar.classList.add('visible');
    lbl.textContent = n + ' selected';
  } else {
    bar.classList.remove('visible');
  }
}

function ohClearSelection() {
  ohSelected.clear();
  document.querySelectorAll('.oh-row-cb').forEach(function(cb){ cb.checked = false; });
  var selectAll = document.getElementById('ohSelectAll');
  if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
  document.querySelectorAll('.oh-table tr.oh-selected').forEach(function(tr){ tr.classList.remove('oh-selected'); });
  ohUpdateBulkBar();
}

function ohDeleteSelected() {
  var n = ohSelected.size;
  if (n === 0) return;
  if (!confirm('Delete ' + n + ' order' + (n !== 1 ? 's' : '') + '? This cannot be undone.')) return;
  ohOrders = ohOrders.filter(function(o){ return !ohSelected.has(o.id); });
  ohSelected.clear();
  ohSave();
  var selectAll = document.getElementById('ohSelectAll');
  if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
  ohUpdateBulkBar();
  ohRender();
  toast('Deleted ' + n + ' order' + (n !== 1 ? 's' : ''), '🗑');
}

// ── Add / Edit modal ──────────────────────────
function ohWireAddBtn() {
  var btn = document.getElementById('ohAddBtn');
  if (btn) btn.addEventListener('click', function(){ ohOpenModal(null); });
  var bg = document.getElementById('ohModalBg');
  if (bg) bg.addEventListener('click', function(e){ if (e.target === bg) ohCloseModal(); });
  var saveBtn = document.getElementById('ohModalSave');
  if (saveBtn) saveBtn.addEventListener('click', ohModalSave);
  var cancelBtn = document.getElementById('ohModalCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', ohCloseModal);
}

function ohOpenModal(id) {
  ohEditId = id;
  var modal = document.getElementById('ohModalBg');
  var title = document.getElementById('ohModalTitle');
  if (!modal) return;
  if (id) {
    var ord = ohOrders.filter(function(o){ return o.id === id; })[0];
    if (!ord) return;
    title.textContent = 'Edit Order';
    document.getElementById('ohMDate').value      = ord.date      || '';
    document.getElementById('ohMSup').value       = ord.sup       || 'Rio Grande';
    document.getElementById('ohMOrderNum').value  = ord.orderNum  || '';
    document.getElementById('ohMInvNum').value    = ord.invNum    || '';
    document.getElementById('ohMAmt').value       = ord.amt != null ? ord.amt : '';
    document.getElementById('ohMStatus').value    = ord.status    || 'Processing';
    document.getElementById('ohMShipped').value   = ord.shipped   || '';
    document.getElementById('ohMDelivered').value = ord.delivered || '';
    document.getElementById('ohMNotes').value     = ord.notes     || '';
    var delBtn = document.getElementById('ohModalDelete');
    if (delBtn) delBtn.style.display = '';
  } else {
    title.textContent = 'Add Order';
    document.getElementById('ohMDate').value      = new Date().toISOString().slice(0,10);
    document.getElementById('ohMSup').value       = 'Rio Grande';
    document.getElementById('ohMOrderNum').value  = '';
    document.getElementById('ohMInvNum').value    = '';
    document.getElementById('ohMAmt').value       = '';
    document.getElementById('ohMStatus').value    = 'Processing';
    document.getElementById('ohMShipped').value   = '';
    document.getElementById('ohMDelivered').value = '';
    document.getElementById('ohMNotes').value     = '';
    var delBtn2 = document.getElementById('ohModalDelete');
    if (delBtn2) delBtn2.style.display = 'none';
  }
  modal.classList.add('open');
  document.getElementById('ohMDate').focus();
}
function ohCloseModal() {
  var modal = document.getElementById('ohModalBg');
  if (modal) modal.classList.remove('open');
  ohEditId = null;
}
function ohModalSave() {
  var date      = (document.getElementById('ohMDate').value      || '').trim();
  var sup       = (document.getElementById('ohMSup').value       || '').trim();
  var orderNum  = (document.getElementById('ohMOrderNum').value  || '').trim();
  var invNum    = (document.getElementById('ohMInvNum').value    || '').trim();
  var amtRaw    = (document.getElementById('ohMAmt').value       || '').trim();
  var status    = (document.getElementById('ohMStatus').value    || '').trim();
  var shipped   = (document.getElementById('ohMShipped').value   || '').trim();
  var delivered = (document.getElementById('ohMDelivered').value || '').trim();
  var notes     = (document.getElementById('ohMNotes').value     || '').trim();
  var amt = ohParseAmt(amtRaw);

  if (ohEditId) {
    ohOrders = ohOrders.map(function(o){
      if (o.id !== ohEditId) return o;
      return Object.assign({}, o, {date: date, sup: sup, orderNum: orderNum, invNum: invNum,
        amt: amt, status: status, shipped: shipped, delivered: delivered, notes: notes});
    });
  } else {
    ohOrders.push({ id: 'oh_' + Date.now().toString(36), date: date, sup: sup,
      orderNum: orderNum, invNum: invNum, amt: amt, status: status,
      shipped: shipped, delivered: delivered, notes: notes });
  }
  ohSave();
  ohCloseModal();
  ohRender();
  toast('Order saved');
}
function ohDeleteOrder(id) {
  if (!confirm('Delete this order record?')) return;
  ohOrders = ohOrders.filter(function(o){ return o.id !== id; });
  ohSave();
  ohCloseModal();
  ohRender();
  toast('Order deleted', '🗑');
}

// ── Render ────────────────────────────────────
var SUP_COLOR = { 'Rio Grande':'#2563eb', 'Stuller':'#7c3aed', 'Gesswein':'#059669' };

function ohRender() {
  var tbody = document.getElementById('ohTbody');
  if (!tbody) return;

  var rows = ohOrders.slice();
  if (ohSupFilter !== 'all') rows = rows.filter(function(o){ return o.sup === ohSupFilter; });
  if (ohYearFilter !== 'all') rows = rows.filter(function(o){ return o.date && o.date.slice(0,4) === ohYearFilter; });

  rows.sort(function(a, b){
    var va, vb;
    switch(ohSortCol) {
      case 'd':    va = a.date      || ''; vb = b.date      || ''; break;
      case 's':    va = a.sup       || ''; vb = b.sup       || ''; break;
      case 'o':    va = a.orderNum  || ''; vb = b.orderNum  || ''; break;
      case 'inv':  va = a.invNum    || ''; vb = b.invNum    || ''; break;
      case 'amt':  va = a.amt != null ? a.amt : -1; vb = b.amt != null ? b.amt : -1; break;
      case 'st':   va = a.status    || ''; vb = b.status    || ''; break;
      case 'ship': va = a.shipped   || ''; vb = b.shipped   || ''; break;
      case 'dlv':  va = a.delivered || ''; vb = b.delivered || ''; break;
      default:     va = ''; vb = '';
    }
    var cmp = (va < vb) ? -1 : (va > vb) ? 1 : 0;
    return ohSortAsc ? cmp : -cmp;
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="oh-empty">'
      + (ohOrders.length === 0
          ? 'No orders yet — click <strong>＋ Add Order</strong> to log one, or use <strong>⬆ Import CSV</strong>.'
          : 'No orders match the current filters.')
      + '</td></tr>';
    ohUpdateStats([]);
    return;
  }

  tbody.innerHTML = rows.map(function(o){
    var color   = SUP_COLOR[o.sup] || '#888';
    var amt     = o.amt != null ? parseFloat(o.amt) : null;
    var amtHtml = amt != null && !isNaN(amt)
      ? '<span class="oh-amt">$' + amt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) + '</span>'
      : '<span class="oh-na">—</span>';
    var tip     = o.notes ? ' title="' + ohEsc(o.notes) + '"' : '';
    var checked = ohSelected.has(o.id) ? ' checked' : '';
    var selCls  = ohSelected.has(o.id) ? ' oh-selected' : '';
    return '<tr class="' + selCls + '"' + tip + '>'
      + '<td onclick="event.stopPropagation()" style="padding:0 8px">'
      +   '<input type="checkbox" class="oh-row-cb" data-id="' + o.id + '"' + checked
      +   ' onchange="ohToggleRow(\'' + o.id + '\',this.checked);this.closest(\'tr\').classList.toggle(\'oh-selected\',this.checked)">'
      + '</td>'
      + '<td onclick="ohOpenModal(\'' + o.id + '\')" style="cursor:pointer"><span class="oh-mono">' + (o.date ? ohFmtDate(o.date) : '<span class="oh-na">—</span>') + '</span></td>'
      + '<td onclick="ohOpenModal(\'' + o.id + '\')" style="cursor:pointer"><span class="oh-sup"><span class="oh-dot" style="background:' + color + '"></span>' + ohEsc(o.sup) + '</span></td>'
      + '<td onclick="ohOpenModal(\'' + o.id + '\')" style="cursor:pointer"><span class="oh-mono">' + (o.orderNum ? ohEsc(o.orderNum) : '<span class="oh-na">—</span>') + '</span></td>'
      + '<td onclick="ohOpenModal(\'' + o.id + '\')" style="cursor:pointer"><span class="oh-mono">' + (o.invNum   ? ohEsc(o.invNum)   : '<span class="oh-na">—</span>') + '</span></td>'
      + '<td onclick="ohOpenModal(\'' + o.id + '\')" style="cursor:pointer">' + amtHtml + '</td>'
      + '<td><button class="oh-edit-btn" onclick="event.stopPropagation();ohOpenModal(\'' + o.id + '\')">✏️</button></td>'
      + '</tr>';
  }).join('');

  ohUpdateStats(rows);
}

// ── Stats ─────────────────────────────────────
function ohUpdateStats(rows) {
  var now       = new Date();
  var thisMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var total = 0, count = 0, month = 0;
  rows.forEach(function(o){
    count++;
    var a = o.amt != null ? parseFloat(o.amt) : NaN;
    if (!isNaN(a)) total += a;
    if (o.date && o.date.slice(0,7) === thisMonth && !isNaN(a)) month += a;
  });
  var fmt = function(n){ return '$' + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
  var el  = function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
  el('oh-total', total > 0 ? fmt(total) : '—');
  el('oh-count', count > 0 ? count      : '—');
  el('oh-month', month > 0 ? fmt(month) : '—');
}
function ohUpdateTs() {
  var el = document.getElementById('ohTs');
  if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
}

// ── CSV Import ────────────────────────────────
var OH_RG_SEEN_KEY = 'oh-rg-drive-seen';
var OH_RG_FOLDER   = 'Supplier Invoice CSVs';

function ohWireCsvImport() {
  var input = document.getElementById('ohCsvInput');
  if (input) input.addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var supplierOverride = (document.getElementById('ohImportSupplier') || {}).value || '';
    var reader = new FileReader();
    reader.onload = function(ev){ ohParseCsv(ev.target.result, supplierOverride); };
    reader.readAsText(file);
    input.value = '';
  });
  var helpBtn = document.getElementById('ohCsvHelpBtn');
  if (helpBtn) helpBtn.addEventListener('click', ohShowCsvHelp);
  var rgBtn = document.getElementById('ohRGDriveBtn');
  if (rgBtn) rgBtn.addEventListener('click', function(){ ohSyncRGFromDrive(rgBtn); });
}

function ohSyncRGFromDrive(btn) {
  var clientId = localStorage.getItem('sts-google-client-id');
  if (!clientId) {
    openIntegrationsModal();
    toast('Set up your Google Client ID in Integrations first', 'ℹ');
    return;
  }
  var token = getGoogleToken();
  if (!token) {
    triggerGoogleOAuth(clientId, function(){ ohSyncRGFromDrive(btn); });
    return;
  }
  ohRunRGDriveSync(btn, token);
}

async function ohRunRGDriveSync(btn, token) {
  if (btn) { btn.disabled = true; btn.textContent = '☁ Syncing…'; }

  try {
    // Find the folder
    var q = "name='" + OH_RG_FOLDER + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    var folderResp = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)',
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    if (folderResp.status === 401) {
      clearGoogleToken();
      toast('Google session expired — click Sync RG to reconnect', '⚠');
      return;
    }
    var folderData = await folderResp.json();
    if (!folderData.files || !folderData.files.length) {
      toast('Drive folder "' + OH_RG_FOLDER + '" not found', '⚠');
      return;
    }
    var folderId = folderData.files[0].id;

    // List CSV files
    var csvQ = "'" + folderId + "' in parents and trashed=false and (mimeType='text/csv' or mimeType='text/plain' or name contains '.csv')";
    var filesResp = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(csvQ)
      + '&fields=files(id,name,createdTime)&orderBy=createdTime+desc&pageSize=50',
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    var filesData = await filesResp.json();
    var allFiles  = filesData.files || [];

    var seen = [];
    try { seen = JSON.parse(localStorage.getItem(OH_RG_SEEN_KEY) || '[]'); } catch(e) {}
    var newFiles = allFiles.filter(function(f){ return !seen.includes(f.id); });

    if (!newFiles.length) {
      toast('No new Rio Grande CSVs in Drive — already up to date', 'ℹ');
      return;
    }

    var totalImported = 0;
    for (var i = 0; i < newFiles.length; i++) {
      var file = newFiles[i];
      if (btn) btn.textContent = '☁ Importing ' + (i + 1) + '/' + newFiles.length + '…';
      try {
        var csvResp = await fetch(
          'https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media',
          { headers: { 'Authorization': 'Bearer ' + token } }
        );
        var text = await csvResp.text();
        var before = ohOrders.length;
        ohParseCsvSilent(text, 'Rio Grande');
        totalImported += ohOrders.length - before;
        seen.push(file.id);
      } catch(e) {
        console.warn('Error importing ' + file.name, e);
      }
    }

    localStorage.setItem(OH_RG_SEEN_KEY, JSON.stringify(seen));
    ohRebuildYearDropdown();
    ohRender();
    toast('Imported ' + totalImported + ' Rio Grande order' + (totalImported !== 1 ? 's' : '') + ' from ' + newFiles.length + ' file' + (newFiles.length !== 1 ? 's' : ''));

  } catch(e) {
    console.error('RG Drive sync error:', e);
    toast('Error syncing from Drive — see console', '⚠');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '☁ Sync RG from Drive'; }
  }
}

// Silent variant of ohParseCsv — no toast, no filter reset, returns count
function ohParseCsvSilent(text, supplierOverride) {
  var lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')
                  .filter(function(l){ return l.trim(); });
  if (lines.length < 2) return;

  var rawHeaders = ohCsvSplit(lines[0]);
  rawHeaders[0] = rawHeaders[0].replace(/^﻿/, '');
  var headers = rawHeaders.map(function(h){ return h.toLowerCase().trim().replace(/[^a-z0-9]/g,''); });

  function col(aliases) {
    for (var i = 0; i < aliases.length; i++) {
      var idx = headers.indexOf(aliases[i]);
      if (idx >= 0) return idx;
    }
    for (var i = 0; i < aliases.length; i++) {
      for (var j = 0; j < headers.length; j++) {
        if (headers[j] && (headers[j].indexOf(aliases[i]) >= 0 || aliases[i].indexOf(headers[j]) >= 0)) return j;
      }
    }
    return -1;
  }

  var iDate     = col(['date','orderdate','ordereddate','purchasedate','invoicedate','shipped','shipdate']);
  var iOrderNum = col(['ordernumber','ordernum','orderno','order','ponumber','po']);
  var iInvNum   = col(['invoicenumber','invoicenum','invoiceno','invoice','inv','invoiceid']);
  var iAmt      = col(['amount','total','invoiceamount','invoicetotal','cost','price','subtotal','grandtotal','amt','balance']);
  var iStatus   = col(['status','state','paymentstatus','orderstatus']);
  var iNotes    = col(['notes','note','comments','comment','memo','description','remarks']);

  var newOrders = [];
  for (var r = 1; r < lines.length; r++) {
    var cells = ohCsvSplit(lines[r]);
    (function(cells) {
      function get(i) { return (i >= 0 && i < cells.length) ? cells[i].trim() : ''; }
      var date = ohNormalizeDate(get(iDate));
      var amt  = ohParseAmt(get(iAmt));
      if (!date && !get(iOrderNum) && amt == null) return;
      newOrders.push({
        id:       'oh_' + (Date.now() + r).toString(36),
        date:     date,
        sup:      supplierOverride || 'Rio Grande',
        orderNum: get(iOrderNum),
        invNum:   get(iInvNum),
        amt:      amt,
        status:   ohNormalizeStatus(get(iStatus)) || 'Processing',
        notes:    get(iNotes)
      });
    })(cells);
  }
  newOrders = ohCollapseByOrder(newOrders);
  newOrders = ohFilterExisting(newOrders);
  ohOrders = ohOrders.concat(newOrders);
  ohSave();
}

function ohParseCsv(text, supplierOverride) {
  var lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')
                  .filter(function(l){ return l.trim(); });
  if (lines.length < 2) { toast('CSV has no data rows', '⚠️'); return; }

  // Strip BOM, normalize headers
  var rawHeaders = ohCsvSplit(lines[0]);
  rawHeaders[0] = rawHeaders[0].replace(/^﻿/, '');
  var headers = rawHeaders.map(function(h){ return h.toLowerCase().trim().replace(/[^a-z0-9]/g,''); });

  // Flexible column mapping — exact first, then partial contains
  function col(aliases) {
    for (var i = 0; i < aliases.length; i++) {
      var idx = headers.indexOf(aliases[i]);
      if (idx >= 0) return idx;
    }
    // Partial: header contains alias or alias contains header
    for (var i = 0; i < aliases.length; i++) {
      for (var j = 0; j < headers.length; j++) {
        if (headers[j] && (headers[j].indexOf(aliases[i]) >= 0 || aliases[i].indexOf(headers[j]) >= 0)) {
          return j;
        }
      }
    }
    return -1;
  }

  // Date: try order date first, fall back to shipped/invoice date
  var iDate     = col(['date','orderdate','ordereddate','purchasedate','invoicedate',
                       'shipped','shipdate','shippeddate','shippedon','shippingdate']);
  var iSup      = col(['supplier','vendor','sup','distributor','company']);
  var iOrderNum = col(['ordernumber','ordernum','orderno','order','ponumber','po']);
  var iInvNum   = col(['invoicenumber','invoicenum','invoiceno','invoice','inv','invoiceid']);
  var iAmt      = col(['amount','total','invoiceamount','invoicetotal','cost','price','subtotal','grandtotal','amt','balance']);
  var iStatus   = col(['status','state','paymentstatus','orderstatus']);
  var iNotes    = col(['notes','note','comments','comment','memo','description','remarks']);

  var imported = 0, skipped = 0;
  var newOrders = [];

  for (var r = 1; r < lines.length; r++) {
    var cells = ohCsvSplit(lines[r]);
    // Capture cells in a closure-safe way
    (function(cells) {
      function get(i) { return (i >= 0 && i < cells.length) ? cells[i].trim() : ''; }

      var date = ohNormalizeDate(get(iDate));
      var sup  = supplierOverride || ohNormalizeSup(get(iSup));
      var amt  = ohParseAmt(get(iAmt));

      // Skip fully empty rows
      if (!date && !sup && !get(iOrderNum) && amt == null) { skipped++; return; }

      newOrders.push({
        id:        'oh_' + (Date.now() + r).toString(36),
        date:      date,
        sup:       sup || 'Unknown',
        orderNum:  get(iOrderNum),
        invNum:    get(iInvNum),
        amt:    amt,
        status: ohNormalizeStatus(get(iStatus)) || 'Processing',
        notes:  get(iNotes)
      });
      imported++;
    })(cells);
  }

  if (imported === 0) { toast('No valid rows found in CSV', '⚠️'); return; }

  newOrders = ohCollapseByOrder(newOrders);
  newOrders = ohFilterExisting(newOrders);
  imported  = newOrders.length;

  if (imported === 0) { toast('No new orders to import (all already exist)', 'ℹ'); return; }

  ohOrders = ohOrders.concat(newOrders);
  ohSave();
  // Reset filters so all imported orders are visible
  ohResetFilters();
  ohRebuildYearDropdown();
  ohRender();
  toast('Imported ' + imported + ' order' + (imported !== 1 ? 's' : '') + (skipped ? ' (' + skipped + ' skipped)' : ''));
}

// Collapse line-item rows: one entry per orderNum (or invNum).
// Rio Grande's Total column is the ORDER total repeated on every item row —
// so we keep the first row's amount, not sum them.
function ohCollapseByOrder(orders) {
  var seen = {}, result = [];
  orders.forEach(function(o) {
    var key = o.orderNum || o.invNum || '';
    if (!key || !seen[key]) {
      var copy = Object.assign({}, o);
      if (key) seen[key] = true;
      result.push(copy);
    }
  });
  return result;
}

// Remove orders whose orderNum or invNum already exist in ohOrders
function ohFilterExisting(newOrders) {
  var existing = {};
  ohOrders.forEach(function(o) {
    if (o.orderNum) existing[o.orderNum] = true;
    if (o.invNum)   existing[o.invNum]   = true;
  });
  return newOrders.filter(function(o) {
    return !(o.orderNum && existing[o.orderNum]) && !(o.invNum && existing[o.invNum]);
  });
}

// Quoted-field-aware CSV line split
function ohCsvSplit(line) {
  var result = [], cur = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

// Parse amount string → number or null
function ohParseAmt(s) {
  if (!s) return null;
  // Remove $, commas, spaces; handle European comma-decimal "1.234,56" → "1234.56"
  var clean = s.replace(/[$\s]/g,'');
  // If both . and , are present, treat . as thousands separator, , as decimal
  if (clean.indexOf('.') >= 0 && clean.indexOf(',') >= 0) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      clean = clean.replace(/\./g,'').replace(',','.');
    } else {
      clean = clean.replace(/,/g,'');
    }
  } else {
    clean = clean.replace(/,/g,'');
  }
  var n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

// Date string → YYYY-MM-DD
function ohNormalizeDate(s) {
  if (!s || s === '-' || s === '—') return '';
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // M/D/YYYY or M/D/YY
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    var y = m[3].length === 2 ? '20' + m[3] : m[3];
    return y + '-' + m[1].padStart(2,'0') + '-' + m[2].padStart(2,'0');
  }
  // M-D-YYYY
  var m2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m2) return m2[3] + '-' + m2[1].padStart(2,'0') + '-' + m2[2].padStart(2,'0');
  var d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  return '';
}

// Normalize supplier name
function ohNormalizeSup(s) {
  if (!s) return '';
  var l = s.toLowerCase();
  if (l.indexOf('rio') >= 0 || l === 'rg')       return 'Rio Grande';
  if (l.indexOf('stull') >= 0)                    return 'Stuller';
  if (l.indexOf('gess') >= 0)                     return 'Gesswein';
  return s.trim();
}

// Normalize status
function ohNormalizeStatus(s) {
  if (!s) return '';
  var l = s.toLowerCase();
  if (l.indexOf('process') >= 0 || l.indexOf('pending') >= 0 || l.indexOf('open') >= 0) return 'Processing';
  if (l.indexOf('paid') >= 0)                                                             return 'Paid';
  if (l.indexOf('due') >= 0 || l.indexOf('owed') >= 0 || l.indexOf('unpaid') >= 0)      return 'Due';
  if (l.indexOf('deliver') >= 0 || l.indexOf('receiv') >= 0 || l.indexOf('complet') >= 0) return 'Delivered';
  return '';
}

function ohShowCsvHelp() {
  var example = [
    'date,supplier,order number,invoice number,amount,notes',
    '2026-05-01,Rio Grande,1234567,INV-001,142.50,Spring metals restock',
    '2026-05-10,Stuller,9876543,INV-002,89.00,Onyx stones',
    '2026-05-20,Gesswein,555000,INV-003,54.75,'
  ].join('\n');
  alert('Expected CSV columns (names are flexible — partial matches work):\n\n'
    + example
    + '\n\nColumn tips:\n'
    + '• Supplier: Rio Grande / Stuller / Gesswein (partial OK — "rio", "stull", "gess")\n'
    + '• Dates: YYYY-MM-DD or M/D/YYYY\n'
    + '• Amount: $1,234.56 or 1234.56 or 1.234,56 all work\n'
    + '• Rio Grande OrderHistory CSVs: multi-line-item orders are collapsed to one entry automatically');
}

// ── Notion Integration ────────────────────────
function ohWireNotionBtns() {
  var saveBtn = document.getElementById('ohNotionSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', ohSaveNotion);
  var loadBtn = document.getElementById('ohNotionLoadBtn');
  if (loadBtn) loadBtn.addEventListener('click', ohLoadNotion);
}

function ohSaveNotion() {
  if (ohOrders.length === 0) { toast('No orders to save', '⚠️'); return; }
  var btn = document.getElementById('ohNotionSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '☁ Saving…'; }
  setTimeout(function(){ if (btn) { btn.disabled = false; btn.textContent = '☁ Save to Notion'; } }, 4000);
  safeSendPrompt('save supplier orders to notion: ' + JSON.stringify({
    notion_db: OH_NOTION_DB,
    orders: ohOrders
  }));
  toast('Saving to Notion…', '☁');
}

function ohLoadNotion() {
  var btn = document.getElementById('ohNotionLoadBtn');
  if (btn) { btn.disabled = true; btn.textContent = '☁ Loading…'; }
  var timeout = setTimeout(function(){
    window.removeEventListener('message', _ohNotionLoadHandler);
    if (btn) { btn.disabled = false; btn.textContent = '☁ Load from Notion'; }
    toast('No response from Notion', '⚠️');
  }, 20000);
  function _ohNotionLoadHandler(e) {
    if (!e.data || e.data.type !== 'oh-notion-data') return;
    clearTimeout(timeout);
    window.removeEventListener('message', _ohNotionLoadHandler);
    if (btn) { btn.disabled = false; btn.textContent = '☁ Load from Notion'; }
    ohHandleNotionLoad(e.data.orders || []);
  }
  window.addEventListener('message', _ohNotionLoadHandler);
  safeSendPrompt('load supplier orders from notion: ' + JSON.stringify({ notion_db: OH_NOTION_DB }));
}

function ohHandleNotionLoad(loaded) {
  if (!loaded.length) { toast('No orders found in Notion', '⚠️'); return; }
  // Upsert by id
  var byId = {};
  ohOrders.forEach(function(o){ byId[o.id] = o; });
  var added = 0, updated = 0;
  loaded.forEach(function(no){
    if (byId[no.id]) { Object.assign(byId[no.id], no); updated++; }
    else             { ohOrders.push(no); added++; }
  });
  ohSave();
  ohResetFilters();
  ohRebuildYearDropdown();
  ohRender();
  toast('Loaded ' + loaded.length + ' orders from Notion (' + added + ' new, ' + updated + ' updated)');
}

// ── Helpers ───────────────────────────────────
function ohFmtDate(ds) {
  if (!ds || ds === '—') return '—';
  return new Date(ds).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

function ohEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
