// ════════════════════════════════════════════
//  SUPPLIER ORDER HISTORY  —  pages/supplier-history.js
// ════════════════════════════════════════════

var OH_KEY              = 'sot_history_v1';
var OH_API              = '/api/notion-orders';   // GET (read)
var OH_WRITE_API        = '/api/notion-write';    // POST / DELETE (write)
var OH_RECEIPTS_FOLDER  = 'STS Receipts';
var OH_RECEIPTS_SEEN    = 'oh-receipts-seen';

// Tax categories for line-item breakdown
var OH_CATS = ['Materials', 'Tools', 'Shipping', 'Other'];
var OH_CAT_COLOR = { Materials: '#059669', Tools: '#2563eb', Shipping: '#f59e0b', Other: '#888' };

// Keyword hints for free, offline category guessing (CSV imports, backfill fallback)
var OH_CAT_KEYWORDS = {
  Materials: ['wire','chain','finding','stone','gem','metal','silver','gold','bezel','jump ring',
    'clasp','bead','cabochon','sheet','wax','casting','solder','flux','enamel','cord','leather',
    'crystal','pearl','resin','patina','alloy','brass','copper','tubing','prong','setting','blank',
    'sterling','ingot','shot','granule','rivet'],
  Tools: ['plier','torch','hammer','mandrel','saw blade','file','drill','bur','buffer','tumbler',
    'kiln','dapping','anvil','vise','clamp','punch','mold','mould','machine','tool','equipment',
    'scale','magnifier','loupe','bench block','welder','engraver','rolling mill','press','ring stick',
    'flex shaft','polishing motor'],
  Shipping: ['shipping','freight','postage','delivery fee','handling fee'],
  Other: ['tax','membership','subscription','warranty','misc fee'],
};

// Guess a single tax category from free text (notes/description). Returns null if no match.
function ohGuessCategory(text) {
  if (!text) return null;
  var l = text.toLowerCase();
  var best = null, bestScore = 0;
  Object.keys(OH_CAT_KEYWORDS).forEach(function(cat) {
    var score = OH_CAT_KEYWORDS[cat].reduce(function(s, kw){ return s + (l.indexOf(kw) >= 0 ? 1 : 0); }, 0);
    if (score > bestScore) { best = cat; bestScore = score; }
  });
  return best;
}

// Build a single-category line item from free text, if a category can be guessed
function ohGuessLineItems(notes, amt) {
  if (amt == null) return [];
  var cat = ohGuessCategory(notes);
  if (!cat) return [];
  return [{ desc: (notes || '').trim(), category: cat, amt: amt }];
}

// ── State ─────────────────────────────────────
var ohOrders          = [];
var ohSupFilter       = 'all';
var ohYearFilter      = String(new Date().getFullYear());
var ohEditId          = null;
var ohSelected        = new Set();
var ohCollapsedSups   = new Set();
var ohModalLineItems  = [];
var ohModalReceiptDriveId = null;

// ── Bootstrap ─────────────────────────────────
function ohInit() {
  ohLoadCache();
  ohMigrateSupplierNames();
  ohMigrateNotionDb();
  ohRebuildYearDropdown();
  ohWireFilters();
  ohWireAddBtn();
  ohWireSelection();
  ohWireCsvImport();
  ohRender();
  ohUpdateTs();
  ohFetchFromNotion();
  // Auto-check receipts folder after load settles
  setTimeout(function() { ohCheckReceipts(null, true); }, 3000);
}

// ── Persistence (localStorage cache) ──────────
function ohLoadCache() {
  try {
    var raw = localStorage.getItem(OH_KEY);
    if (raw) ohOrders = JSON.parse(raw);
    ohOrders.forEach(function(o){ if (o.amt != null) o.amt = parseFloat(o.amt) || null; });
  } catch(e) { ohOrders = []; }
  ohDedupeExisting();
}

// One-time migration: normalize any supplier names that slipped through before rules were added
function ohMigrateSupplierNames() {
  var changed = false;
  ohOrders.forEach(function(o) {
    var normalized = ohNormalizeSup(o.sup || '');
    if (normalized && normalized !== o.sup) { o.sup = normalized; changed = true; }
  });
  if (changed) ohCacheLocally();
}

// One-time migration: cached notionPageId values point into the old
// (now-deleted) Notion database. Strip them so saves create fresh pages
// in the current database instead of PATCHing dead ones.
var OH_DB_MIGRATION_KEY = 'oh-notion-db-migrated-v2';
function ohMigrateNotionDb() {
  if (localStorage.getItem(OH_DB_MIGRATION_KEY)) return;
  var changed = false;
  ohOrders.forEach(function(o) {
    if (o.notionPageId) { delete o.notionPageId; changed = true; }
  });
  if (changed) ohCacheLocally();
  localStorage.setItem(OH_DB_MIGRATION_KEY, '1');
}

function ohDedupeExisting() {
  var seen = {}, result = [];
  ohOrders.forEach(function(o) {
    var key = o.orderNum || o.invNum || o.id;
    if (!seen[key]) { seen[key] = true; result.push(o); }
  });
  if (result.length < ohOrders.length) { ohOrders = result; ohCacheLocally(); }
}

function ohCacheLocally() {
  try { localStorage.setItem(OH_KEY, JSON.stringify(ohOrders)); } catch(e) {}
}

// ── Notion: load all orders ────────────────────
function ohFetchFromNotion() {
  ohSetSyncStatus('loading');
  fetch(OH_API)
    .then(function(r) { return r.json(); })
    .then(function(orders) {
      if (!Array.isArray(orders)) throw new Error('Bad response');
      orders.forEach(function(o){ if (o.amt != null) o.amt = parseFloat(o.amt) || null; });

      // Merge: Notion is authoritative for anything it knows about,
      // but keep any local-only records not yet synced (avoids wiping
      // data when the Notion DB is empty or sync hasn't run yet).
      var notionIds = new Set(orders.map(function(o){ return o.id; }));
      var localOnly = ohOrders.filter(function(o){ return !notionIds.has(o.id); });
      ohOrders = orders.concat(localOnly);

      ohDedupeExisting();
      ohCacheLocally();
      ohRebuildYearDropdown();
      ohRender();
      ohSetSyncStatus('ok');
      ohUpdateTs();

      // Push any local-only records up to Notion now
      if (localOnly.length) {
        console.log('ohFetchFromNotion: pushing ' + localOnly.length + ' local-only record(s) to Notion');
        ohBatchSync(localOnly);
      }
    })
    .catch(function(err) {
      console.warn('Notion fetch failed, using cache:', err);
      ohSetSyncStatus('offline');
    });
}

// ── Push all local orders to Notion (manual button) ───────────────────────
async function ohPushAllToNotion() {
  var btn = document.getElementById('ohPushNotionBtn');
  if (!ohOrders.length) { toast('No orders to push', 'ℹ'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⬆ Pushing…'; }
  ohSetSyncStatus('saving');

  // Test with first order to surface any real error
  try {
    var testOrder = ohOrders[0];
    var r = await fetch(OH_WRITE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testOrder),
    });
    var data = await r.json();
    if (!r.ok || data.error) {
      var msg = data.error || ('HTTP ' + r.status);
      toast('Notion error: ' + msg, '⚠');
      alert('Notion sync failed:\n\n' + msg + '\n\nFull response: ' + JSON.stringify(data));
      if (btn) { btn.disabled = false; btn.textContent = '⬆ Push to Notion'; }
      ohSetSyncStatus('offline');
      return;
    }
  } catch(err) {
    toast('Notion sync failed: ' + err.message, '⚠');
    alert('Notion sync error:\n\n' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = '⬆ Push to Notion'; }
    ohSetSyncStatus('offline');
    return;
  }

  // First one worked — batch sync the rest with live progress
  var total = ohOrders.length;
  toast('Pushing ' + total + ' orders to Notion…', '⬆');
  ohBatchSync(ohOrders, function(done, total, finished) {
    if (!btn) return;
    if (finished) {
      btn.disabled = false;
      btn.textContent = '⬆ Push to Notion';
      toast('Synced ' + total + ' orders to Notion ✓', '✓');
    } else {
      btn.textContent = '⬆ ' + done + ' / ' + total;
    }
  });
}

// ── Auto-categorize uncategorized orders (manual button) ──────────────────
// Tier 1: orders with a saved receipt image get re-scanned via Claude Vision
// for real line items. Tier 2 (fallback, and used when Google/Anthropic keys
// aren't configured): free keyword guess from the order's notes.
function ohCategorizeAll(btn) {
  var clientId      = localStorage.getItem('sts-google-client-id');
  var anthropicKey  = localStorage.getItem('sts-anthropic-key');
  if (clientId && anthropicKey) {
    var token = getGoogleToken();
    if (!token) {
      triggerGoogleOAuth(clientId, function(){ ohRunCategorizeAll(btn, getGoogleToken(), anthropicKey); });
      return;
    }
    ohRunCategorizeAll(btn, token, anthropicKey);
  } else {
    ohRunCategorizeAll(btn, null, null);
  }
}

async function ohRunCategorizeAll(btn, token, anthropicKey) {
  var candidates = ohOrders.filter(function(o){ return !(o.lineItems && o.lineItems.length); });
  if (!candidates.length) { toast('All orders already categorized', 'ℹ'); return; }

  var useVision = !!(token && anthropicKey);
  if (btn) { btn.disabled = true; }

  var changed = [];
  for (var i = 0; i < candidates.length; i++) {
    var o = candidates[i];
    if (btn) btn.textContent = '🏷 ' + (i + 1) + '/' + candidates.length + '…';
    var didCategorize = false;
    if (useVision && o.driveFileId) {
      didCategorize = await ohCategorizeViaVision(o, token, anthropicKey);
    }
    if (!didCategorize) {
      var guess = ohGuessLineItems(o.notes, o.amt);
      if (guess.length) { o.lineItems = guess; didCategorize = true; }
    }
    if (didCategorize) changed.push(o);
  }

  if (changed.length) {
    ohCacheLocally();
    ohRender();
    toast('Categorized ' + changed.length + ' order' + (changed.length !== 1 ? 's' : '') + ' — syncing to Notion…');
    ohBatchSync(changed, function(done, total, finished) {
      if (!btn) return;
      if (finished) {
        btn.disabled = false;
        btn.textContent = '🏷 Categorize All';
        toast('Synced ' + total + ' categorized order' + (total !== 1 ? 's' : '') + ' ✓', '✓');
      } else {
        btn.textContent = '🏷 syncing ' + done + '/' + total;
      }
    });
  } else {
    if (btn) { btn.disabled = false; btn.textContent = '🏷 Categorize All'; }
    toast('Could not auto-categorize the rest — try editing them manually', 'ℹ');
  }
}

// Re-scans a saved receipt image via Claude Vision and fills in line items.
// Leaves the order's existing `amt` (total) untouched — only adds the breakdown.
async function ohCategorizeViaVision(o, token, anthropicKey) {
  try {
    var metaR = await fetch('https://www.googleapis.com/drive/v3/files/' + o.driveFileId + '?fields=mimeType',
      { headers: { 'Authorization': 'Bearer ' + token } });
    if (metaR.status === 401) { clearGoogleToken(); return false; }
    var meta = await metaR.json();
    var mimeType = meta.mimeType || 'image/jpeg';

    var imgR = await fetch('https://www.googleapis.com/drive/v3/files/' + o.driveFileId + '?alt=media',
      { headers: { 'Authorization': 'Bearer ' + token } });
    if (!imgR.ok) return false;
    var blob   = await imgR.blob();
    var base64 = await ohBlobToBase64(blob);
    var data   = await ohReceiptVision(base64, mimeType, anthropicKey);
    if (!data || !Array.isArray(data.line_items)) return false;

    var lineItems = data.line_items.map(function(li) {
      return {
        desc:     li.description || '',
        category: OH_CATS.indexOf(li.category) >= 0 ? li.category : 'Other',
        amt:      li.amount != null ? parseFloat(li.amount) : null,
      };
    }).filter(function(li){ return li.amt != null; });

    if (!lineItems.length) return false;
    o.lineItems = lineItems;
    return true;
  } catch(e) {
    console.warn('Backfill vision failed for', o.id, e);
    return false;
  }
}

// ── Notion: upsert one order ───────────────────
function ohSyncOrder(order) {
  return fetch(OH_WRITE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.notionPageId) {
      ohOrders = ohOrders.map(function(o) {
        return o.id === order.id ? Object.assign({}, o, { notionPageId: data.notionPageId }) : o;
      });
      ohCacheLocally();
    }
  })
  .catch(function(err) { console.warn('Notion sync failed for', order.id, err); });
}

// ── Notion: delete one order ───────────────────
function ohDeleteFromNotion(notionPageId) {
  if (!notionPageId) return;
  fetch(OH_WRITE_API + '?pageId=' + encodeURIComponent(notionPageId), { method: 'DELETE' })
    .catch(function(err) { console.warn('Notion delete failed:', err); });
}

// ── Notion: batch sync (for CSV imports) ───────
// Sequential, one at a time with 600ms gaps — avoids Notion rate limits
function ohBatchSync(orders, onProgress) {
  if (!orders.length) { ohSetSyncStatus('ok'); return; }
  var i = 0;
  function next() {
    if (i >= orders.length) { ohSetSyncStatus('ok'); if (onProgress) onProgress(i, orders.length, true); return; }
    ohSetSyncStatus('saving');
    if (onProgress) onProgress(i, orders.length, false);
    ohSyncOrder(orders[i++]).then(function() {
      setTimeout(next, 600);
    });
  }
  next();
}

// ── Sync status indicator ──────────────────────
function ohSetSyncStatus(state) {
  var el = document.getElementById('ohTs');
  if (!el) return;
  if      (state === 'loading') el.textContent = 'Loading from Notion…';
  else if (state === 'saving')  el.textContent = 'Saving…';
  else if (state === 'offline') el.textContent = 'Offline — showing cached data';
  else    ohUpdateTs();
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

// ── Supplier group toggle ─────────────────────
function ohToggleSup(sup) {
  if (ohCollapsedSups.has(sup)) ohCollapsedSups.delete(sup);
  else ohCollapsedSups.add(sup);
  ohRender();
}

// ── (sort wiring removed — rows sorted within groups by date) ──
function ohWireSort() {
  // no-op: table headers are no longer sortable; within-group sort is date desc
  var tbl = document.querySelector('.oh-table');
  if (!tbl) return;
  tbl.addEventListener('click', function(e) {
    var th = e.target.closest('th[data-ohcol]');
    if (!th) return;
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
  var toDelete = ohOrders.filter(function(o){ return ohSelected.has(o.id); });
  ohOrders = ohOrders.filter(function(o){ return !ohSelected.has(o.id); });
  ohSelected.clear();
  ohCacheLocally();
  toDelete.forEach(function(o){ ohDeleteFromNotion(o.notionPageId); });
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
  var addLiBtn = document.getElementById('ohAddLineItemBtn');
  if (addLiBtn) addLiBtn.addEventListener('click', function(){
    ohModalLineItems.push({ desc: '', category: 'Materials', amt: null });
    ohRenderLineItems();
  });
  var receiptBg = document.getElementById('ohReceiptModalBg');
  if (receiptBg) receiptBg.addEventListener('click', function(e){ if (e.target === receiptBg) ohCloseReceiptModal(); });
  var receiptCloseBtn = document.getElementById('ohReceiptCloseBtn');
  if (receiptCloseBtn) receiptCloseBtn.addEventListener('click', ohCloseReceiptModal);
}

// ── Receipt viewer popup ──────────────────────
function ohShowReceipt(driveFileId) {
  if (!driveFileId) return;
  var bg    = document.getElementById('ohReceiptModalBg');
  var frame = document.getElementById('ohReceiptFrame');
  var open  = document.getElementById('ohReceiptOpenLink');
  if (!bg || !frame) return;
  frame.src = 'https://drive.google.com/file/d/' + driveFileId + '/preview';
  if (open) open.href = 'https://drive.google.com/file/d/' + driveFileId + '/view';
  bg.classList.add('open');
}
function ohCloseReceiptModal() {
  var bg    = document.getElementById('ohReceiptModalBg');
  var frame = document.getElementById('ohReceiptFrame');
  if (bg) bg.classList.remove('open');
  if (frame) frame.src = 'about:blank';
}

// ── Line items (tax categorization) ───────────
function ohRenderLineItems() {
  var wrap = document.getElementById('ohLineItems');
  if (!wrap) return;
  wrap.innerHTML = ohModalLineItems.map(function(li, i) {
    return '<div class="oh-li-row" data-idx="' + i + '">'
      + '<input type="text" class="oh-li-desc" placeholder="Description" value="' + ohEsc(li.desc || '') + '">'
      + '<select class="oh-li-cat">' + OH_CATS.map(function(c) {
          return '<option value="' + c + '"' + (li.category === c ? ' selected' : '') + '>' + c + '</option>';
        }).join('') + '</select>'
      + '<input type="number" step="0.01" min="0" class="oh-li-amt" placeholder="0.00" value="' + (li.amt != null ? li.amt : '') + '">'
      + '<button type="button" class="oh-li-remove" title="Remove line item">✕</button>'
      + '</div>';
  }).join('') || '<div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">No line items — Amount below is used as-is.</div>';

  wrap.querySelectorAll('.oh-li-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.closest('.oh-li-row').dataset.idx, 10);
      ohModalLineItems.splice(idx, 1);
      ohRenderLineItems();
      ohRecomputeLineItemTotal();
    });
  });
  wrap.querySelectorAll('.oh-li-desc, .oh-li-cat, .oh-li-amt').forEach(function(el) {
    el.addEventListener('input', ohSyncLineItemsFromDom);
    el.addEventListener('change', ohSyncLineItemsFromDom);
  });
  ohRecomputeLineItemTotal();
}

function ohSyncLineItemsFromDom() {
  var wrap = document.getElementById('ohLineItems');
  if (!wrap) return;
  wrap.querySelectorAll('.oh-li-row').forEach(function(row) {
    var idx = parseInt(row.dataset.idx, 10);
    if (!ohModalLineItems[idx]) return;
    ohModalLineItems[idx].desc     = row.querySelector('.oh-li-desc').value;
    ohModalLineItems[idx].category = row.querySelector('.oh-li-cat').value;
    ohModalLineItems[idx].amt      = ohParseAmt(row.querySelector('.oh-li-amt').value);
  });
  ohRecomputeLineItemTotal();
}

function ohRecomputeLineItemTotal() {
  var amtField = document.getElementById('ohMAmt');
  var summary  = document.getElementById('ohLineItemsSummary');
  if (!ohModalLineItems.length) {
    if (amtField) amtField.readOnly = false;
    if (summary) summary.textContent = '';
    return;
  }
  var total = ohModalLineItems.reduce(function(s, li){ return s + (parseFloat(li.amt) || 0); }, 0);
  if (amtField) { amtField.value = total.toFixed(2); amtField.readOnly = true; }
  if (summary) {
    var byCat = {};
    ohModalLineItems.forEach(function(li) {
      var a = parseFloat(li.amt) || 0;
      byCat[li.category] = (byCat[li.category] || 0) + a;
    });
    summary.textContent = Object.keys(byCat).map(function(c) {
      return c + ': $' + byCat[c].toFixed(2);
    }).join('  ·  ');
  }
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
    document.getElementById('ohMCarrier').value   = ord.carrier   || '';
    document.getElementById('ohMTracking').value  = ord.trackingNumber || '';
    document.getElementById('ohMNotes').value     = ord.notes     || '';
    ohModalLineItems = (ord.lineItems || []).map(function(li){ return Object.assign({}, li); });
    ohRenderLineItems();
    var delBtn = document.getElementById('ohModalDelete');
    if (delBtn) delBtn.style.display = '';
    ohModalReceiptDriveId = ord.driveFileId || null;
    var recLink = document.getElementById('ohModalReceiptLink');
    if (recLink) recLink.style.display = ord.driveFileId ? 'inline-flex' : 'none';
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
    document.getElementById('ohMCarrier').value   = '';
    document.getElementById('ohMTracking').value  = '';
    document.getElementById('ohMNotes').value     = '';
    ohModalLineItems = [];
    ohRenderLineItems();
    ohModalReceiptDriveId = null;
    var recLink2 = document.getElementById('ohModalReceiptLink');
    if (recLink2) recLink2.style.display = 'none';
    var delBtn2 = document.getElementById('ohModalDelete');
    if (delBtn2) delBtn2.style.display = 'none';
  }
  modal.classList.add('open');
  document.getElementById('ohMDate').focus();
}
function ohCloseModal() {
  var modal = document.getElementById('ohModalBg');
  if (modal) modal.classList.remove('open');
  var amtField = document.getElementById('ohMAmt');
  if (amtField) amtField.readOnly = false;
  ohEditId = null;
  ohModalLineItems = [];
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
  var carrier   = (document.getElementById('ohMCarrier').value   || '').trim();
  var tracking  = (document.getElementById('ohMTracking').value  || '').trim();
  var notes     = (document.getElementById('ohMNotes').value     || '').trim();
  ohSyncLineItemsFromDom();
  var lineItems = ohModalLineItems.filter(function(li){ return (li.desc || '').trim() || li.amt != null; });
  var amt       = lineItems.length
    ? lineItems.reduce(function(s, li){ return s + (parseFloat(li.amt) || 0); }, 0)
    : ohParseAmt(amtRaw);
  var saved;
  var fields = { date: date, sup: sup, orderNum: orderNum, invNum: invNum, amt: amt,
    status: status, shipped: shipped, delivered: delivered, carrier: carrier,
    trackingNumber: tracking, notes: notes, lineItems: lineItems };

  if (ohEditId) {
    ohOrders = ohOrders.map(function(o){
      if (o.id !== ohEditId) return o;
      saved = Object.assign({}, o, fields);
      return saved;
    });
  } else {
    saved = Object.assign({ id: 'oh_' + Date.now().toString(36) }, fields);
    ohOrders.push(saved);
  }
  ohCacheLocally();
  ohCloseModal();
  ohRender();
  toast('Order saved');
  if (saved) ohSyncOrder(saved);
}
function ohLookupTracking(btn) {
  var orderNum = (document.getElementById('ohMOrderNum').value || '').trim();
  ssLookupTracking({
    numberField:  'ohMTracking',
    carrierField: 'ohMCarrier',
    orderNumberGuess: orderNum,
    button: btn,
  });
}

function ohDeleteOrder(id) {
  if (!confirm('Delete this order record?')) return;
  var target = ohOrders.find(function(o){ return o.id === id; });
  ohOrders = ohOrders.filter(function(o){ return o.id !== id; });
  ohCacheLocally();
  ohCloseModal();
  ohRender();
  toast('Order deleted', '🗑');
  if (target) ohDeleteFromNotion(target.notionPageId);
}

// ── Render ────────────────────────────────────
var SUP_COLOR = { 'Rio Grande':'#2563eb', 'Stuller':'#7c3aed', 'Gesswein':'#059669' };

function ohRender() {
  var tbody = document.getElementById('ohTbody');
  if (!tbody) return;

  var rows = ohOrders.slice();
  if (ohSupFilter  !== 'all') rows = rows.filter(function(o){ return o.sup === ohSupFilter; });
  if (ohYearFilter !== 'all') rows = rows.filter(function(o){ return o.date && o.date.slice(0,4) === ohYearFilter; });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="oh-empty">'
      + (ohOrders.length === 0
          ? 'No orders yet — click <strong>＋ Add Order</strong> to log one, or use <strong>⬆ Import CSV</strong>.'
          : 'No orders match the current filters.')
      + '</td></tr>';
    ohUpdateStats([]);
    return;
  }

  // Group by supplier
  var groups = {};
  rows.forEach(function(o) {
    var s = o.sup || 'Unknown';
    if (!groups[s]) groups[s] = [];
    groups[s].push(o);
  });

  // Sort each group by date descending
  Object.keys(groups).forEach(function(s) {
    groups[s].sort(function(a, b) {
      return (a.date || '') < (b.date || '') ? 1 : -1;
    });
  });

  // Suppliers alphabetically
  var sups = Object.keys(groups).sort();

  var html = sups.map(function(sup) {
    var supRows  = groups[sup];
    var color    = SUP_COLOR[sup] || '#888';
    var collapsed = ohCollapsedSups.has(sup);
    var supTotal = supRows.reduce(function(s, o) { return s + (parseFloat(o.amt) || 0); }, 0);
    var chevron  = collapsed ? '▶' : '▼';
    var meta     = supRows.length + ' order' + (supRows.length !== 1 ? 's' : '')
                 + ' · $' + supTotal.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

    var hdr = '<tr class="oh-sup-hdr" onclick="ohToggleSup(\'' + ohEsc(sup) + '\')">'
      + '<td colspan="6"><div class="oh-sup-hdr-inner">'
      + '<span class="oh-sup-chevron">' + chevron + '</span>'
      + '<span class="oh-dot" style="background:' + color + '"></span>'
      + '<span class="oh-sup-name">' + ohEsc(sup) + '</span>'
      + '<span class="oh-sup-meta">' + meta + '</span>'
      + '</div></td></tr>';

    if (collapsed) return hdr;

    var dataRows = supRows.map(function(o) {
      var amt     = o.amt != null ? parseFloat(o.amt) : null;
      var amtHtml = amt != null && !isNaN(amt)
        ? '<span class="oh-amt">$' + amt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) + '</span>'
        : '<span class="oh-na">—</span>';
      var cats = Array.from(new Set((o.lineItems || []).map(function(li){ return li.category; })));
      if (cats.length) {
        amtHtml += '<span class="oh-cat-dots">' + cats.map(function(c) {
          return '<span class="oh-dot" style="background:' + (OH_CAT_COLOR[c] || '#888') + '" title="' + ohEsc(c) + '"></span>';
        }).join('') + '</span>';
      }
      var tip     = o.notes ? ' title="' + ohEsc(o.notes) + '"' : '';
      var checked = ohSelected.has(o.id) ? ' checked' : '';
      var selCls  = ohSelected.has(o.id) ? ' oh-selected' : '';
      return '<tr class="oh-sup-data-row' + selCls + '"' + tip + '>'
        + '<td onclick="event.stopPropagation()" style="padding:0 8px">'
        +   '<input type="checkbox" class="oh-row-cb" data-id="' + o.id + '"' + checked
        +   ' onchange="ohToggleRow(\'' + o.id + '\',this.checked);this.closest(\'tr\').classList.toggle(\'oh-selected\',this.checked)">'
        + '</td>'
        + '<td onclick="ohOpenModal(\'' + o.id + '\')" style="cursor:pointer"><span class="oh-mono">' + (o.date ? ohFmtDate(o.date) : '<span class="oh-na">—</span>') + '</span></td>'
        + '<td onclick="ohOpenModal(\'' + o.id + '\')" style="cursor:pointer"><span class="oh-mono">' + (o.orderNum ? ohEsc(o.orderNum) : '<span class="oh-na">—</span>') + '</span></td>'
        + '<td onclick="ohOpenModal(\'' + o.id + '\')" style="cursor:pointer"><span class="oh-mono">' + (o.invNum   ? ohEsc(o.invNum)   : '<span class="oh-na">—</span>') + '</span></td>'
        + '<td onclick="ohOpenModal(\'' + o.id + '\')" style="cursor:pointer">' + amtHtml + '</td>'
        + '<td style="white-space:nowrap">'
        +   (o.driveFileId ? '<button type="button" class="oh-receipt-btn" onclick="event.stopPropagation();ohShowReceipt(\'' + o.driveFileId + '\')" title="View receipt">🧾</button>' : '')
        +   '<button class="oh-edit-btn" onclick="event.stopPropagation();ohOpenModal(\'' + o.id + '\')">✏️</button>'
        + '</td>'
        + '</tr>';
    }).join('');

    return hdr + dataRows;
  }).join('');

  tbody.innerHTML = html;
  ohUpdateStats(rows);
}

// ── Stats ─────────────────────────────────────
function ohUpdateStats(rows) {
  var now       = new Date();
  var thisMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var total = 0, count = 0, month = 0;
  var catTotals = { Materials: 0, Tools: 0, Shipping: 0, Other: 0 };
  var categorized = 0;
  rows.forEach(function(o){
    count++;
    var a = o.amt != null ? parseFloat(o.amt) : NaN;
    if (!isNaN(a)) total += a;
    if (o.date && o.date.slice(0,7) === thisMonth && !isNaN(a)) month += a;
    (o.lineItems || []).forEach(function(li) {
      var la = parseFloat(li.amt) || 0;
      catTotals[li.category] = (catTotals[li.category] || 0) + la;
      categorized += la;
    });
  });
  var fmt = function(n){ return '$' + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
  var el  = function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
  el('oh-total', total > 0 ? fmt(total) : '—');
  el('oh-count', count > 0 ? count      : '—');
  el('oh-month', month > 0 ? fmt(month) : '—');
  el('oh-cat-materials', fmt(catTotals.Materials));
  el('oh-cat-tools',     fmt(catTotals.Tools));
  el('oh-cat-shipping',  fmt(catTotals.Shipping));
  el('oh-cat-other',     fmt(catTotals.Other));
  el('oh-cat-uncat',     fmt(Math.max(0, total - categorized)));
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
  var recBtn = document.getElementById('ohReceiptsBtn');
  if (recBtn) recBtn.addEventListener('click', function(){ ohCheckReceipts(recBtn, false); });
}

// ── Receipt Watch ─────────────────────────────
function ohCheckReceipts(btn, silent) {
  var clientId = localStorage.getItem('sts-google-client-id');
  if (!clientId) { if (!silent) { openIntegrationsModal(); toast('Set up your Google Client ID in Integrations first', 'ℹ'); } return; }
  var anthropicKey = localStorage.getItem('sts-anthropic-key');
  if (!anthropicKey) { if (!silent) { openIntegrationsModal(); toast('Enter your Anthropic API key in Integrations to read receipts', 'ℹ'); } return; }
  var token = getGoogleToken();
  if (!token) {
    if (silent) return; // don't pop OAuth on auto-check
    triggerGoogleOAuth(clientId, function(){ ohCheckReceipts(btn, false); });
    return;
  }
  ohRunReceiptsCheck(btn, token, anthropicKey, silent);
}

async function ohRunReceiptsCheck(btn, token, anthropicKey, silent) {
  if (btn) { btn.disabled = true; btn.textContent = '📷 Checking…'; }
  try {
    // Find STS Receipts folder
    var q = "name='" + OH_RECEIPTS_FOLDER + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    var fr = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)',
      { headers: { 'Authorization': 'Bearer ' + token } });
    if (fr.status === 401) { clearGoogleToken(); toast('Google session expired — click Check Receipts to reconnect', '⚠'); return; }
    var fd = await fr.json();
    if (!fd.files || !fd.files.length) { if (!silent) toast('Drive folder "' + OH_RECEIPTS_FOLDER + '" not found', '⚠'); return; }
    var folderId = fd.files[0].id;

    // List image + PDF files
    var fq = "'" + folderId + "' in parents and trashed=false and (mimeType contains 'image/' or mimeType='application/pdf')";
    var filesR = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(fq)
      + '&fields=files(id,name,mimeType,createdTime)&orderBy=createdTime+desc&pageSize=50',
      { headers: { 'Authorization': 'Bearer ' + token } });
    var filesD = await filesR.json();
    var allFiles = filesD.files || [];

    var seen = [];
    try { seen = JSON.parse(localStorage.getItem(OH_RECEIPTS_SEEN) || '[]'); } catch(e) {}
    var newFiles = allFiles.filter(function(f){ return !seen.includes(f.id); });

    if (!newFiles.length) { if (!silent) toast('No new receipts — already up to date', 'ℹ'); return; }

    if (!silent) toast('Reading ' + newFiles.length + ' receipt' + (newFiles.length !== 1 ? 's' : '') + ' with Claude Vision…', '📷');

    var imported = 0;
    for (var i = 0; i < newFiles.length; i++) {
      var file = newFiles[i];
      if (btn) btn.textContent = '📷 Reading ' + (i+1) + '/' + newFiles.length + '…';
      try {
        var imgR = await fetch('https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media',
          { headers: { 'Authorization': 'Bearer ' + token } });
        var blob   = await imgR.blob();
        var base64 = await ohBlobToBase64(blob);
        var data   = await ohReceiptVision(base64, file.mimeType, anthropicKey);
        if (data) {
          var lineItems = Array.isArray(data.line_items) ? data.line_items.map(function(li) {
            return {
              desc:     li.description || '',
              category: OH_CATS.indexOf(li.category) >= 0 ? li.category : 'Other',
              amt:      li.amount != null ? parseFloat(li.amount) : null,
            };
          }).filter(function(li){ return li.amt != null; }) : [];
          var order = {
            id:          'rec_' + file.id.slice(0, 12),
            date:        data.date     || '',
            sup:         ohNormalizeSup(data.supplier || '') || 'Unknown',
            orderNum:    data.order_number   || '',
            invNum:      data.invoice_number || '',
            amt:         lineItems.length
              ? lineItems.reduce(function(s, li){ return s + li.amt; }, 0)
              : (data.amount != null ? parseFloat(data.amount) : null),
            notes:       data.notes || file.name,
            driveFileId: file.id,
            lineItems:   lineItems,
          };
          // Skip if already imported by order/inv number
          var existing = ohFilterExisting([order]);
          if (existing.length) {
            ohOrders.push(order);
            imported++;
          }
        }
        seen.push(file.id);
      } catch(e) { console.warn('Receipt error', file.name, e); seen.push(file.id); }
    }

    localStorage.setItem(OH_RECEIPTS_SEEN, JSON.stringify(seen));
    if (imported > 0) {
      ohCacheLocally();
      ohRebuildYearDropdown();
      ohRender();
      var newOnes = ohOrders.slice(ohOrders.length - imported);
      ohBatchSync(newOnes);
      toast('Imported ' + imported + ' receipt' + (imported !== 1 ? 's' : '') + ' from Drive', '📷');
    } else if (!silent) {
      toast('Receipts checked — no new orders found', 'ℹ');
    }
  } catch(e) {
    console.error('Receipt check error:', e);
    if (!silent) toast('Error checking receipts — see console', '⚠');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📷 Check Receipts'; }
  }
}

async function ohReceiptVision(base64, mimeType, key) {
  var isPdf = mimeType === 'application/pdf';
  var source = isPdf
    ? { type: 'base64', media_type: 'application/pdf', data: base64 }
    : { type: 'base64', media_type: mimeType, data: base64 };
  var contentType = isPdf ? 'document' : 'image';

  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':                                 key,
      'anthropic-version':                         '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type':                              'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: contentType, source: source },
        { type: 'text', text:
          'Extract purchase info from this business receipt or invoice for a jewelry-making business. '
          + 'Also break down each line item and categorize it for tax purposes as one of: '
          + '"Materials" (raw materials/supplies consumed making jewelry — metals, stones, findings, wire, chain, packaging), '
          + '"Tools" (equipment, tools, machinery — durable items, not consumed), '
          + '"Shipping" (shipping/freight/postage charges), '
          + '"Other" (fees, taxes, anything else). '
          + 'Return ONLY a JSON object with these keys (null/empty if not found): '
          + '{"supplier": string, "date": "YYYY-MM-DD", "amount": number, '
          + '"invoice_number": string, "order_number": string, "notes": string, '
          + '"line_items": [{"description": string, "amount": number, "category": "Materials"|"Tools"|"Shipping"|"Other"}]}. '
          + 'line_items should cover all charges on the receipt (including shipping/tax as their own entries if itemized) so they sum to roughly the total amount. '
          + 'No other text.'
        }
      ]}]
    })
  });
  if (!resp.ok) { console.warn('Vision API error', resp.status); return null; }
  var body = await resp.json();
  var raw  = (body.content && body.content[0] && body.content[0].text) || '';
  try { return JSON.parse(raw.replace(/```json\n?/g,'').replace(/```/g,'').trim()); }
  catch(e) { console.warn('Receipt parse error:', raw); return null; }
}

function ohBlobToBase64(blob) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result.slice(e.target.result.indexOf(',') + 1)); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
      var date  = ohNormalizeDate(get(iDate));
      var amt   = ohParseAmt(get(iAmt));
      var notes = get(iNotes);
      if (!date && !get(iOrderNum) && amt == null) return;
      newOrders.push({
        id:       'oh_' + (Date.now() + r).toString(36),
        date:     date,
        sup:      supplierOverride || 'Rio Grande',
        orderNum: get(iOrderNum),
        invNum:   get(iInvNum),
        amt:      amt,
        status:   ohNormalizeStatus(get(iStatus)) || 'Processing',
        notes:    notes,
        lineItems: ohGuessLineItems(notes, amt),
      });
    })(cells);
  }
  newOrders = ohCollapseByOrder(newOrders);
  newOrders = ohFilterExisting(newOrders);
  ohOrders = ohOrders.concat(newOrders);
  ohCacheLocally();
  ohBatchSync(newOrders);
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

      var date  = ohNormalizeDate(get(iDate));
      var sup   = supplierOverride || ohNormalizeSup(get(iSup));
      var amt   = ohParseAmt(get(iAmt));
      var notes = get(iNotes);

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
        notes:  notes,
        lineItems: ohGuessLineItems(notes, amt),
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
  ohCacheLocally();
  ohResetFilters();
  ohRebuildYearDropdown();
  ohRender();
  toast('Imported ' + imported + ' order' + (imported !== 1 ? 's' : '') + (skipped ? ' (' + skipped + ' skipped)' : '') + ' — syncing to Notion…');
  ohBatchSync(newOrders);
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
  if (l.indexOf('home depot') >= 0)               return 'The Home Depot';
  if (l.indexOf('lowe') >= 0)                     return "Lowe's";
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

// ── Helpers ───────────────────────────────────
function ohFmtDate(ds) {
  if (!ds || ds === '—') return '—';
  // Parse as local date (not UTC) to avoid timezone-shift off-by-one
  var parts = ds.split('-');
  if (parts.length === 3) {
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
  }
  return new Date(ds).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

function ohEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
