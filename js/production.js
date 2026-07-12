// ════════════════════════════════════════════
//  PRODUCTION  —  pages/production.js
//  Ready-to-pickup / awaiting delivery board
// ════════════════════════════════════════════

// Columns in display order
var PROD_COLUMNS = [
  { key: 'Studio',                    label: 'Studio',                    icon: '🏠', color: '#5b8dd9' },
  { key: 'Bell Market',               label: 'Bell Market',               icon: '🔔', color: '#c0a060' },
  { key: 'Mueller Market',            label: 'Mueller Market',            icon: '🌿', color: '#6abf8a' },
  { key: 'Chaparral Crossing Market', label: 'Chaparral Crossing Market', icon: '🌵', color: '#e07a50' },
  { key: 'Sunset Valley',             label: 'Sunset Valley',             icon: '🌅', color: '#b06abf' },
  { key: '__ship__',                  label: 'To be Shipped',             icon: '📦', color: '#457b9d' },
  { key: '__limbo__',                 label: 'In Limbo',                  icon: '❓', color: '#9A8860' },
];

// Sub-cards inside the "To be Shipped" column, grouped by order source
var SHIP_SUBGROUPS = [
  { key: 'custom',  label: 'Custom Orders',  icon: '💍' },
  { key: 'etsy',    label: 'Etsy Orders',    icon: '🛍' },
  { key: 'shopify', label: 'Shopify Orders', icon: '🛒' },
];

function prodShipGroup(o) {
  if (o.shipChannel)               return o.shipChannel;
  if (o.id.startsWith('etsy-'))    return 'etsy';
  if (o.id.startsWith('shopify-')) return 'shopify';
  return 'custom';
}

function prodGetColumn(o) {
  if (o.stage === 'cancelled') return '__cancelled__';
  if (o.stage === 'ship-out') return '__ship__';
  if (!o.pickup || o.pickup === 'To be Shipped') {
    return (!o.pickup) ? '__limbo__' : '__ship__';
  }
  var known = PROD_COLUMNS.map(function(c){ return c.key; });
  return known.includes(o.pickup) ? o.pickup : '__limbo__';
}

// Track which month folders are open (persists for the session)
var prodOpenMonths = {};
var prodDraggedId  = null;
var prodSearchTerm = '';

function prodSetSearch(val) {
  prodSearchTerm = (val || '').toLowerCase().trim();
  renderProduction();
}

// ── Drag handlers ─────────────────────────────────────────────

function prodDragStart(ev, id) {
  prodDraggedId = id;
  ev.dataTransfer.effectAllowed = 'move';
  setTimeout(function() {
    var el = document.getElementById('prod-card-' + id);
    if (el) el.style.opacity = '0.4';
  }, 0);
}

function prodDragEnd(ev) {
  if (prodDraggedId) {
    var el = document.getElementById('prod-card-' + prodDraggedId);
    if (el) el.style.opacity = '';
  }
  prodDraggedId = null;
  document.querySelectorAll('.prod-col-body, .prod-sub-body').forEach(function(b) {
    b.classList.remove('prod-drag-over');
  });
}

function prodDragOver(ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  ev.currentTarget.classList.add('prod-drag-over');
}

function prodDragLeave(ev) {
  ev.currentTarget.classList.remove('prod-drag-over');
}

function prodApplyMove(o, colKey) {
  // Determine new stage and pickup from the target column
  if (colKey === '__ship__') {
    o.stage  = 'ready-pick';
    o.pickup = 'To be Shipped';
  } else if (colKey === '__limbo__') {
    o.stage  = 'ready-pick';
    o.pickup = null;
  } else if (colKey === '__cancelled__') {
    o.stage       = 'cancelled';
    o.pickup      = null;
    o.cancelledAt = o.cancelledAt || new Date().toISOString().slice(0, 10);
    delete o.deliveredAt;
  } else {
    o.stage  = 'ready-pick';
    o.pickup = colKey;
  }

  // Clear delivery stamps when pulled back to active board
  delete o.deliveredAt;

  saveToStorage();
  if (typeof notionUpdateStage === 'function') notionUpdateStage(o.notionId, o.stage);
  renderProduction();
  toast(o.name + ' moved to ' + (colKey === '__ship__' ? 'To be Shipped' : colKey === '__limbo__' ? 'In Limbo' : colKey), '📍');
}

function prodDrop(ev, colKey) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('prod-drag-over');
  if (!prodDraggedId) return;
  var o = getOrder(prodDraggedId);
  if (!o) { prodDraggedId = null; return; }
  prodApplyMove(o, colKey);
  prodDraggedId = null;
}

// Drop directly onto a Custom/Etsy/Shopify sub-card inside "To be Shipped" —
// manually (re)assigns the channel, overriding the id-prefix default.
function prodDropShip(ev, subKey) {
  ev.preventDefault();
  ev.stopPropagation();
  ev.currentTarget.classList.remove('prod-drag-over');
  if (!prodDraggedId) return;
  var o = getOrder(prodDraggedId);
  if (!o) { prodDraggedId = null; return; }
  o.shipChannel = subKey;
  prodApplyMove(o, '__ship__');
  prodDraggedId = null;
}

// ── Tap-to-move sheet (mobile/iPad — drag-and-drop doesn't fire on touch) ──
var prodStageSheetOrderId = null;

function openProdStageSheet(id) {
  var o = getOrder(id);
  if (!o) return;
  prodStageSheetOrderId = id;
  var curCol = prodGetColumn(o);

  document.getElementById('stageSheetTitle').textContent = 'Move "' + o.name + '"';
  var body = document.getElementById('stageSheetBody');
  body.innerHTML = PROD_COLUMNS.map(function(col) {
    return '<button class="ss-option ' + (curCol === col.key ? 'ss-current' : '') + '"'
         + ' onclick="pickProdDestFromSheet(\'' + col.key + '\')">'
         + '<span>' + col.icon + ' ' + col.label + '</span>'
         + '<span class="ss-check">✓</span>'
         + '</button>';
  }).join('');

  document.getElementById('stageSheetOverlay').classList.add('active');
  document.getElementById('stageSheet').classList.add('active');
}

function pickProdDestFromSheet(colKey) {
  var o = getOrder(prodStageSheetOrderId);
  if (o) prodApplyMove(o, colKey);
  closeStageSheet();
}

// ── Render ────────────────────────────────────────────────────

function renderProduction() {
  var grid = document.getElementById('prodGrid');
  if (!grid) return;

  var q = prodSearchTerm;
  var readyOrders = ORDERS.filter(function(o) {
    if (o.stage === 'ready-pick' || o.stage === 'ship-out') { /* check below */ }
    // Only show cancelled orders in the active column if they have no date yet
    else if (o.stage === 'cancelled' && !o.cancelledAt) { /* check below */ }
    else return false;
    if (q) {
      var haystack = ((o.name || '') + ' ' + (o.desc || '')).toLowerCase();
      if (haystack.indexOf(q) < 0) return false;
    }
    return true;
  });

  var html = '';

  // ── Active board ─────────────────────────────────────────────
  html += '<div class="prod-board">';
  PROD_COLUMNS.forEach(function(col) {
    var colOrders = readyOrders.filter(function(o){ return prodGetColumn(o) === col.key; });

    html += '<div class="prod-col">';
    html += '<div class="prod-col-head" style="border-top:3px solid ' + col.color + '">'
          + '<span class="prod-col-icon">' + col.icon + '</span>'
          + '<span class="prod-col-label">' + col.label + '</span>'
          + '<span class="prod-col-count" style="background:' + col.color + '">' + colOrders.length + '</span>'
          + '</div>';
    html += '<div class="prod-col-body"'
          + ' data-col-key="' + col.key + '"'
          + ' ondragover="prodDragOver(event)"'
          + ' ondragleave="prodDragLeave(event)"'
          + ' ondrop="prodDrop(event,\'' + col.key + '\')">';

    if (col.key === '__ship__') {
      SHIP_SUBGROUPS.forEach(function(sub) {
        var subOrders = colOrders.filter(function(o){ return prodShipGroup(o) === sub.key; });
        html += '<div class="prod-sub-wrap' + (subOrders.length ? '' : ' prod-sub-empty') + '">';
        html += '<div class="prod-sub-head">'
              + '<span>' + sub.icon + ' ' + sub.label + '</span>'
              + '<span class="prod-sub-count">' + subOrders.length + '</span>'
              + '</div>';
        html += '<div class="prod-sub-body"'
              + ' ondragover="prodDragOver(event)"'
              + ' ondragleave="prodDragLeave(event)"'
              + ' ondrop="prodDropShip(event,\'' + sub.key + '\')">';
        if (!subOrders.length) {
          html += '<div class="prod-col-empty">Drop here</div>';
        } else {
          subOrders.forEach(function(o) { html += prodOrderCardHTML(o, true); });
        }
        html += '</div></div>';
      });
    } else if (!colOrders.length) {
      html += '<div class="prod-col-empty">Drop here</div>';
    } else {
      colOrders.forEach(function(o) {
        html += prodOrderCardHTML(o, true);
      });
    }

    html += '</div></div>';
  });
  html += '</div>';

  if (!readyOrders.length) {
    html += '<div class="prod-empty" style="margin-top:-8px">No orders ready — drag one up from the archive to reactivate.</div>';
  }

  // ── Year / Month / Type archive ───────────────────────────────
  var archiveOrders = ORDERS.filter(function(o) {
    if (o.stage !== 'delivered' && o.stage !== 'complete' && o.stage !== 'cancelled') return false;
    if (q) {
      var archiveHaystack = ((o.name || '') + ' ' + (o.desc || '')).toLowerCase();
      if (archiveHaystack.indexOf(q) < 0) return false;
    }
    return true;
  });

  html += '<div class="prod-archive">';
  html += '<div class="prod-archive-title">📁 Order Archive</div>';

  var ARCHIVE_YEARS = [2026, 2025, 2024];

  ARCHIVE_YEARS.forEach(function(year) {
    var yearStr = String(year);
    var yearKey = 'year-' + yearStr;
    var yearOpen = !!prodOpenMonths[yearKey] || !!q;

    // Bucket orders into months for this year
    var monthBuckets = {};
    archiveOrders.forEach(function(o) {
      var dateStr = o.stage === 'cancelled'
        ? (o.cancelledAt || o.deliveredAt || o.completedAt || '')
        : (o.deliveredAt || o.completedAt || '');
      if (!dateStr || !dateStr.startsWith(yearStr)) return;
      var mk = dateStr.slice(0, 7);
      if (!monthBuckets[mk]) monthBuckets[mk] = { completed: [], cancelled: [] };
      if (o.stage === 'cancelled') monthBuckets[mk].cancelled.push(o);
      else monthBuckets[mk].completed.push(o);
    });

    var yearTotal = archiveOrders.filter(function(o) {
      var d = o.stage === 'cancelled'
        ? (o.cancelledAt || o.deliveredAt || o.completedAt || '')
        : (o.deliveredAt || o.completedAt || '');
      return d.startsWith(yearStr);
    }).length;

    if (q && yearTotal === 0) return;

    html += '<div class="prod-year-folder" id="prod-year-' + yearStr + '">';
    html += '<div class="prod-year-head" onclick="prodToggleMonth(\'' + yearKey + '\')">'
          + '<span class="prod-folder-icon">' + (yearOpen ? '📂' : '📁') + '</span>'
          + '<span class="prod-year-label">' + yearStr + '</span>'
          + '<span class="prod-folder-meta">' + yearTotal + ' order' + (yearTotal !== 1 ? 's' : '') + '</span>'
          + '<span class="prod-folder-chevron">' + (yearOpen ? '▴' : '▾') + '</span>'
          + '</div>';

    if (yearOpen) {
      html += '<div class="prod-year-body">';

      var monthKeys = Object.keys(monthBuckets).sort().reverse();
      monthKeys.forEach(function(mk) {
        var bucket   = monthBuckets[mk];
        var mTotal   = bucket.completed.length + bucket.cancelled.length;
        var mOpen    = !!prodOpenMonths[mk] || !!q;
        var mLabel   = prodMonthLabel(mk);

        html += '<div class="prod-month-folder" id="prod-folder-' + mk + '">';
        html += '<div class="prod-month-head" onclick="prodToggleMonth(\'' + mk + '\')">'
              + '<span class="prod-folder-icon">' + (mOpen ? '📂' : '📁') + '</span>'
              + '<span class="prod-folder-label">' + mLabel + '</span>'
              + '<span class="prod-folder-meta">' + mTotal + ' order' + (mTotal !== 1 ? 's' : '') + '</span>'
              + '<span class="prod-folder-chevron">' + (mOpen ? '▴' : '▾') + '</span>'
              + '</div>';

        if (mOpen) {
          html += '<div class="prod-month-body">';

          // ── Completed sub-folder ──
          if (bucket.completed.length) {
            var ck   = mk + '-completed';
            var cOpen = !!prodOpenMonths[ck] || !!q;
            var cVal  = bucket.completed.reduce(function(s, o){ return s + (o.finalPrice || o.price || 0); }, 0);
            html += '<div class="prod-subfolder">';
            html += '<div class="prod-subfolder-head sf-completed" onclick="prodToggleMonth(\'' + ck + '\')">'
                  + '<span>' + (cOpen ? '📂' : '📁') + '</span>'
                  + '<span class="prod-subfolder-label">✓ Completed Orders</span>'
                  + '<span class="prod-folder-meta">' + bucket.completed.length
                  + (cVal ? ' · $' + cVal.toLocaleString() : '') + '</span>'
                  + '<span class="prod-folder-chevron">' + (cOpen ? '▴' : '▾') + '</span>'
                  + '</div>';
            if (cOpen) {
              html += '<div class="prod-subfolder-body">';
              bucket.completed.forEach(function(o) { html += prodOrderCardHTML(o, false); });
              html += '</div>';
            }
            html += '</div>';
          }

          // ── Cancelled sub-folder ──
          if (bucket.cancelled.length) {
            var xk   = mk + '-cancelled';
            var xOpen = !!prodOpenMonths[xk] || !!q;
            html += '<div class="prod-subfolder">';
            html += '<div class="prod-subfolder-head sf-cancelled" onclick="prodToggleMonth(\'' + xk + '\')">'
                  + '<span>' + (xOpen ? '📂' : '📁') + '</span>'
                  + '<span class="prod-subfolder-label">🚫 Cancelled Orders</span>'
                  + '<span class="prod-folder-meta">' + bucket.cancelled.length + '</span>'
                  + '<span class="prod-folder-chevron">' + (xOpen ? '▴' : '▾') + '</span>'
                  + '</div>';
            if (xOpen) {
              html += '<div class="prod-subfolder-body">';
              bucket.cancelled.forEach(function(o) { html += prodOrderCardHTML(o, false); });
              html += '</div>';
            }
            html += '</div>';
          }

          html += '</div>'; // prod-month-body
        }
        html += '</div>'; // prod-month-folder
      });

      html += '</div>'; // prod-year-body
    }
    html += '</div>'; // prod-year-folder
  });

  html += '</div>'; // prod-archive

  if (!readyOrders.length && !archiveOrders.length) {
    html = q
      ? '<div class="prod-empty">No orders match "' + prodSearchTerm.replace(/</g, '&lt;') + '".</div>'
      : '<div class="prod-empty">No orders yet.</div>';
  }

  grid.innerHTML = html;
}

function prodOrderCardHTML(o, showDeliverBtn) {
  var dl = deadlineInfo(o.deadline);
  var deliveredLine = (o.deliveredAt || o.completedAt)
    ? '<div class="prod-delivered-on">Completed ' + fmtDate(o.deliveredAt || o.completedAt) + '</div>'
    : '';
  var html = '<div class="prod-order-card"'
           + ' id="prod-card-' + o.id + '"'
           + ' draggable="true"'
           + ' ondragstart="prodDragStart(event,\'' + o.id + '\')"'
           + ' ondragend="prodDragEnd(event)"'
           + (showDeliverBtn ? ' onpointerdown="cardPointerDown(event,\'' + o.id + '\',\'prod\')"' : '')
           + ' onclick="openOrderCard(\'' + o.id + '\')">';
  html += '<div class="prod-card-drag-handle" title="Drag to move">⠿</div>';
  if (showDeliverBtn) {
    html += '<button class="prod-move-btn" title="Move to another location"'
          + ' onclick="event.stopPropagation();openProdStageSheet(\'' + o.id + '\')">↪</button>';
  }
  var nameHtml = showDeliverBtn
    ? prodEsc(o.name)
    : '<span class="prod-cust-link" onclick="event.stopPropagation();prodOpenCustomer(\'' + prodEsc((o.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")) + '\')" title="View all orders for this customer">' + prodEsc(o.name) + '</span>';
  html += '<div class="prod-order-name">' + nameHtml + '</div>';
  html += '<div class="prod-order-desc">' + prodEsc(o.desc) + '</div>';
  html += '<div class="prod-order-foot">';
  html += '<span class="o-tag ' + dl.cls + '">' + dl.text + '</span>';
  if (o.price || o.finalPrice) {
    html += '<span class="prod-order-price">$' + (o.finalPrice || o.price).toLocaleString() + '</span>';
  }
  html += '</div>';
  if (o.contactedAt) {
    html += '<div class="prod-contacted-badge">✓ Contacted ' + fmtDate(o.contactedAt) + '</div>';
  }
  if (deliveredLine) html += deliveredLine;
  if (o.cancelledAt && o.stage === 'cancelled') {
    html += '<div class="prod-delivered-on">Cancelled ' + fmtDate(o.cancelledAt) + '</div>';
  }
  if (o.pdfUrl) {
    html += '<a class="prod-pdf-btn" href="' + prodEsc(o.pdfUrl) + '" target="_blank" onclick="event.stopPropagation()">📄 View PDF</a>';
    if (!showDeliverBtn) {
      var cachedOcr = prodOcrCache(o.id);
      html += '<button class="prod-scan-btn" id="prod-scan-btn-' + o.id + '"'
            + ' onclick="event.stopPropagation();prodScanPdf(\'' + o.id + '\',\'' + o.pdfUrl.replace(/'/g,"\\'") + '\')">'
            + (cachedOcr ? '🔍 Re-scan PDF' : '🔍 Scan PDF') + '</button>';
      var saveBtn = '<button class="prod-ocr-save-btn" onclick="event.stopPropagation();prodSaveToCustomerOpen(\'' + o.id + '\',\'' + prodEsc((o.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")) + '\')">📋 Save to Customer</button>';
      if (cachedOcr) {
        html += '<div class="prod-ocr-panel" id="prod-ocr-panel-' + o.id + '">'
              + '<div class="prod-ocr-head" onclick="event.stopPropagation();prodToggleOcr(\'' + o.id + '\')">'
              + '📝 Extracted Text <span id="prod-ocr-chev-' + o.id + '">▾</span></div>'
              + '<div class="prod-ocr-body" id="prod-ocr-body-' + o.id + '" style="display:none">'
              + prodEsc(cachedOcr) + '</div>'
              + '<div style="padding:6px 8px 8px">' + saveBtn + '</div>'
              + '</div>';
      } else {
        html += '<div class="prod-ocr-panel" id="prod-ocr-panel-' + o.id + '" style="display:none">'
              + '<div class="prod-ocr-head" onclick="event.stopPropagation();prodToggleOcr(\'' + o.id + '\')">'
              + '📝 Extracted Text <span id="prod-ocr-chev-' + o.id + '">▾</span></div>'
              + '<div class="prod-ocr-body" id="prod-ocr-body-' + o.id + '" style="display:none"></div>'
              + '<div style="padding:6px 8px 8px" id="prod-ocr-save-wrap-' + o.id + '" style="display:none">' + saveBtn + '</div>'
              + '</div>';
      }
    }
  }
  if (showDeliverBtn && o.stage !== 'cancelled') {
    html += '<button class="prod-delivered-btn" onclick="event.stopPropagation();prodMarkDelivered(\'' + o.id + '\')">✓ Mark Completed</button>';
  }
  if (!showDeliverBtn) {
    var safeName  = prodEsc((o.name  || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
    html += '<div class="prod-archive-actions">'
          + '<button class="prod-archive-btn prod-archive-btn-order"'
          + ' onclick="event.stopPropagation();prodArchiveAction(\'' + safeName + '\',\'order\')">'
          + '＋ New Order</button>'
          + '<button class="prod-archive-btn prod-archive-btn-repair"'
          + ' onclick="event.stopPropagation();prodArchiveAction(\'' + safeName + '\',\'repair\')">'
          + '🔧 Repair</button>'
          + '</div>';
  }
  html += '</div>';
  return html;
}

function prodMonthLabel(key) {
  var parts = key.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function prodToggleMonth(key) {
  prodOpenMonths[key] = !prodOpenMonths[key];
  // When a month folder (YYYY-MM) is opened, auto-expand its Completed sub-folder
  if (prodOpenMonths[key] && /^\d{4}-\d{2}$/.test(key)) {
    prodOpenMonths[key + '-completed'] = true;
  }
  renderProduction();
}

// ── Archive action confirmation modal ────────────────────────

var _prodActionType = 'order';

function prodArchiveAction(name, type) {
  _prodActionType = type;
  var title = type === 'repair' ? '🔧 New Repair Job' : '＋ New Order';
  var titleEl = document.getElementById('prodActionModalTitle');
  if (titleEl) titleEl.textContent = title;

  var input = document.getElementById('prodActionName');
  if (input) { input.value = name; }

  // Show match note if customer is already on file
  prodActionNameInput(name);

  var bg = document.getElementById('prodActionModalBg');
  if (bg) { bg.classList.add('open'); setTimeout(function(){ if(input) input.focus(); }, 50); }
}

function prodActionNameInput(val) {
  var note    = document.getElementById('prodActionMatchNote');
  var suggest = document.getElementById('prodActionSuggest');
  if (!note || !suggest) return;

  var q = (val || '').trim().toLowerCase();
  if (!q) { note.textContent = ''; suggest.style.display = 'none'; return; }

  // Exact / fuzzy match against CUSTOMERS
  var matches = (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : []).filter(function(c) {
    return c.name.toLowerCase().indexOf(q) >= 0;
  }).slice(0, 6);

  var exact = matches.find(function(c){ return c.name.toLowerCase() === q; });
  if (exact) {
    note.textContent = '✓ Matches existing customer — will link to their record.';
    note.style.color = '#2a7a4a';
  } else if (matches.length) {
    note.textContent = 'No exact match — choose below or continue as typed.';
    note.style.color = '#8A5A10';
  } else {
    note.textContent = 'No existing customer found — a new record will be created.';
    note.style.color = '#6A8898';
  }

  if (matches.length && !exact) {
    suggest.innerHTML = matches.map(function(c) {
      var esc = prodEsc(c.name);
      var safe = prodEsc((c.name || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
      return '<div style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #eee;"'
           + ' onmouseover="this.style.background=\'#F4F0E8\'"'
           + ' onmouseout="this.style.background=\'\'"'
           + ' onclick="prodActionSelectCustomer(\'' + safe + '\')">'
           + esc + '</div>';
    }).join('');
    suggest.style.display = 'block';
  } else {
    suggest.style.display = 'none';
  }
}

function prodActionSelectCustomer(name) {
  var input = document.getElementById('prodActionName');
  if (input) input.value = name;
  document.getElementById('prodActionSuggest').style.display = 'none';
  prodActionNameInput(name);
}

function prodActionConfirm() {
  var input = document.getElementById('prodActionName');
  var name  = input ? input.value.trim() : '';
  if (!name) { if (input) input.focus(); return; }

  // Find email from CUSTOMERS if available
  var cust  = (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : [])
              .find(function(c){ return c.name.toLowerCase() === name.toLowerCase(); });
  var email = cust ? (cust.email || '') : '';

  prodActionModalClose();
  if (typeof prefillFromCustomer === 'function') prefillFromCustomer(name, email, _prodActionType);
}

function prodActionModalClose() {
  var bg = document.getElementById('prodActionModalBg');
  if (bg) bg.classList.remove('open');
  var suggest = document.getElementById('prodActionSuggest');
  if (suggest) suggest.style.display = 'none';
}

// ── Click customer name → jump to Customers tab and expand row ─

function prodOpenCustomer(name) {
  if (typeof CUSTOMERS === 'undefined') return;
  var idx = CUSTOMERS.findIndex(function(c){ return c.name.toLowerCase() === name.toLowerCase(); });
  if (idx < 0) { toast('No customer record found for ' + name, '👥'); return; }

  // Switch to the customers sub-tab
  var parentEl = document.querySelector('[data-parent="custom-orders"]');
  if (typeof switchParent === 'function') switchParent('custom-orders', parentEl);
  var subEl = document.querySelector('.sub-nav-tab[data-tab="customers"]');
  if (typeof switchSubTab === 'function') switchSubTab('customers', subEl);

  // Switch sub-tab filter to "all" so the customer is visible
  if (typeof switchCustTab === 'function') switchCustTab('all', document.querySelector('.cst-tab[data-cst="all"]'));

  // Expand the matching row and scroll to it
  setTimeout(function() {
    if (typeof toggleCustomerRow === 'function') {
      var wrap = document.getElementById('ct-wrap-' + idx);
      if (wrap && !wrap.classList.contains('ct-open')) toggleCustomerRow(idx);
      if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 80);
}

function prodMarkDelivered(id) {
  var o = getOrder(id);
  if (!o) return;
  var dateStr = new Date().toISOString().slice(0, 10);
  o.stage = 'delivered';
  o.deliveredAt = dateStr;
  prodOpenMonths[dateStr.slice(0, 7)] = true;
  saveToStorage();
  // Push the full order (not just a stage-only patch) so the completion
  // date lands in Notion's "Completed At" property in the same request.
  if (typeof notionUpdateOrder === 'function') notionUpdateOrder(o);
  renderProduction();
  toast(o.name + ' marked as completed ✓', '✓');
}

// ════════════════════════════════════════════
//  PDF OCR  —  via Cloud Vision API
// ════════════════════════════════════════════

var OCR_CACHE_KEY = 'sts-ocr-cache-v1';

function prodOcrCache(orderId, setText) {
  try {
    var cache = JSON.parse(localStorage.getItem(OCR_CACHE_KEY) || '{}');
    if (setText !== undefined) {
      cache[orderId] = setText;
      localStorage.setItem(OCR_CACHE_KEY, JSON.stringify(cache));
      return setText;
    }
    return cache[orderId] || null;
  } catch(e) { return null; }
}

// Extract Google Drive file ID from a Drive URL
function prodDriveFileId(url) {
  var m = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

function prodToggleOcr(orderId) {
  var body = document.getElementById('prod-ocr-body-' + orderId);
  var chev = document.getElementById('prod-ocr-chev-' + orderId);
  if (!body) return;
  var open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  if (chev) chev.textContent = open ? '▴' : '▾';
}

async function prodScanPdf(orderId, pdfUrl) {
  // Check Gmail/Drive auth token
  if (typeof _gmailAccessToken === 'undefined' || !_gmailAccessToken ||
      (typeof _gmailTokenValid === 'function' && !_gmailTokenValid())) {
    toast('Connect Gmail first to enable Drive access for PDF scanning', '🔑');
    if (typeof gmailSignIn === 'function') gmailSignIn(true);
    return;
  }

  var fileId = prodDriveFileId(pdfUrl);
  if (!fileId) { toast('Could not parse Google Drive file ID from URL', '⚠️'); return; }

  // Update button to loading state
  var btn = document.getElementById('prod-scan-btn-' + orderId);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Scanning…'; }

  try {
    var resp = await fetch('/api/pdf-ocr', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fileId: fileId, accessToken: _gmailAccessToken }),
    });

    var data = await resp.json();

    if (!resp.ok || data.error) {
      throw new Error(data.error || 'OCR request failed');
    }

    var text = data.text || '(no text found)';

    // Cache result
    prodOcrCache(orderId, text);

    // Show panel
    var panel = document.getElementById('prod-ocr-panel-' + orderId);
    var body  = document.getElementById('prod-ocr-body-' + orderId);
    var chev  = document.getElementById('prod-ocr-chev-' + orderId);
    if (panel) panel.style.display = '';
    if (body)  { body.textContent = text; body.style.display = ''; }
    if (chev)  chev.textContent = '▴';

    // Show the save-to-customer button (only present when panel was hidden before scan)
    var saveWrap = document.getElementById('prod-ocr-save-wrap-' + orderId);
    if (saveWrap) saveWrap.style.display = '';

    if (btn) { btn.disabled = false; btn.textContent = '🔍 Re-scan PDF'; }
    toast('PDF scanned — ' + (data.pageCount || 1) + ' page' + (data.pageCount !== 1 ? 's' : ''), '📝');

  } catch(e) {
    var panel = document.getElementById('prod-ocr-panel-' + orderId);
    if (panel) {
      panel.style.display = '';
      panel.innerHTML = '<div class="prod-ocr-error">⚠️ ' + prodEsc(e.message) + '</div>';
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Scan PDF'; }
    toast('OCR failed: ' + e.message, '⚠️');
  }
}

// ── Save OCR text to Customer record ────────────────────────

function prodFixCaps(s) {
  if (!s) return s;
  // If the string is entirely uppercase letters/spaces/punctuation, convert to Title Case
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) {
    return s.replace(/\w\S*/g, function(w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }
  return s;
}

function prodParseOcrText(text) {
  var result = { name: '', email: '', phone: '', address: '', jobDesc: '', notes: '' };
  if (!text) return result;

  var nameM   = text.match(/\bname[:\s]+([^\n\r]+)/i);
  var emailM  = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  var phoneM  = text.match(/(?:phone|tel|cell|ph)[:\s]*([+\d()\-.\s]{7,20})/i)
             || text.match(/\b(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})\b/);
  var addrM   = text.match(/(?:address|addr)[:\s]+([^\n\r]+)/i);

  // Job description: look for labelled line, then fall back to "description" label
  var jobM    = text.match(/(?:job\s*desc(?:ription)?|work\s*desc(?:ription)?|service|repair\s*desc(?:ription)?)[:\s]+([^\n\r]+)/i)
             || text.match(/\bdescription[:\s]+([^\n\r]+)/i);

  // Notes: any line after a "notes" / "special instructions" / "instructions" label
  var notesM  = text.match(/(?:notes?|special\s+instructions?|instructions?|comments?)[:\s]+([^\n\r]+)/i);

  if (nameM)  result.name    = prodFixCaps(nameM[1].trim());
  if (emailM) result.email   = emailM[0].trim();
  if (phoneM) result.phone   = (phoneM[1] || phoneM[0]).trim();
  if (addrM)  result.address = prodFixCaps(addrM[1].trim());
  if (jobM)   result.jobDesc = prodFixCaps(jobM[1].trim());
  if (notesM) result.notes   = prodFixCaps(notesM[1].trim());
  return result;
}

var _prodSaveOrderId   = null;
var _prodSaveOrderName = null;

function prodSaveToCustomerOpen(orderId, orderName) {
  var text = prodOcrCache(orderId);
  if (!text) { toast('No scanned text found — scan the PDF first', '⚠️'); return; }

  _prodSaveOrderId   = orderId;
  _prodSaveOrderName = orderName;

  var parsed = prodParseOcrText(text);

  // Find matching customer by order name to pre-fill name field
  var custName = parsed.name || orderName || '';
  if (!parsed.name && orderName) {
    var match = (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : [])
      .find(function(c){ return c.name.toLowerCase() === orderName.toLowerCase(); });
    if (match) {
      custName       = match.name;
      parsed.email   = parsed.email   || match.email   || '';
      parsed.phone   = parsed.phone   || match.phone   || '';
      parsed.address = parsed.address || match.address || '';
    }
  }

  var f = {
    name:    document.getElementById('prodSaveName'),
    email:   document.getElementById('prodSaveEmail'),
    phone:   document.getElementById('prodSavePhone'),
    address: document.getElementById('prodSaveAddress'),
    jobDesc: document.getElementById('prodSaveJobDesc'),
    notes:   document.getElementById('prodSaveNotes'),
  };
  if (f.name)    f.name.value    = custName;
  if (f.email)   f.email.value   = parsed.email;
  if (f.phone)   f.phone.value   = parsed.phone;
  if (f.address) f.address.value = parsed.address;
  if (f.jobDesc) f.jobDesc.value = parsed.jobDesc;
  if (f.notes)   f.notes.value   = parsed.notes;

  var bg = document.getElementById('prodSaveCustomerBg');
  if (bg) bg.classList.add('open');
  setTimeout(prodValidateSaveFields, 0);
}

function prodValidateSaveFields() {
  var email = (document.getElementById('prodSaveEmail') || {}).value || '';
  var phone = (document.getElementById('prodSavePhone') || {}).value || '';
  var eWarn = document.getElementById('prodSaveEmailWarn');
  var pWarn = document.getElementById('prodSavePhoneWarn');

  if (eWarn) {
    var emailOk = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    eWarn.textContent = emailOk ? '' : '⚠️ Doesn\'t look like a valid email address';
  }
  if (pWarn) {
    var digits = phone.replace(/\D/g, '');
    var phoneOk = !phone || digits.length === 10 || digits.length === 11;
    pWarn.textContent = phoneOk ? '' : '⚠️ Phone has ' + digits.length + ' digits — expected 10 or 11';
  }
}

function prodSaveToCustomerClose() {
  var bg = document.getElementById('prodSaveCustomerBg');
  if (bg) bg.classList.remove('open');
}

function prodSaveToCustomerConfirm() {
  var name    = (document.getElementById('prodSaveName')    || {}).value || '';
  var email   = (document.getElementById('prodSaveEmail')   || {}).value || '';
  var phone   = (document.getElementById('prodSavePhone')   || {}).value || '';
  var address = (document.getElementById('prodSaveAddress') || {}).value || '';
  var jobDesc = (document.getElementById('prodSaveJobDesc') || {}).value || '';
  var notes   = (document.getElementById('prodSaveNotes')   || {}).value || '';

  name = name.trim();
  if (!name) { toast('Name is required', '⚠️'); return; }

  // Combine job description and notes into the customer notes field
  var combinedNotes = [jobDesc.trim() ? 'Job: ' + jobDesc.trim() : '', notes.trim()].filter(Boolean).join('\n');

  var customers = (typeof CUSTOMERS !== 'undefined') ? CUSTOMERS : [];

  // Find existing customer (case-insensitive)
  var idx = customers.findIndex(function(c){ return c.name.toLowerCase() === name.toLowerCase(); });
  var isNew = idx < 0;
  var cust = isNew ? { id: 'c-' + Date.now(), name: name } : Object.assign({}, customers[idx]);

  if (email)         cust.email   = email;
  if (phone)         cust.phone   = phone;
  if (address)       cust.address = address;
  if (combinedNotes) cust.notes   = combinedNotes;

  if (isNew) {
    customers.push(cust);
  } else {
    customers[idx] = cust;
  }

  // Persist to localStorage cache and re-render customers tab immediately
  if (typeof saveCustomersToCache === 'function') saveCustomersToCache();
  if (typeof renderCustomers      === 'function') renderCustomers();

  // Also update the order record with the parsed desc and notes
  var order = (typeof ORDERS !== 'undefined') ? getOrder(_prodSaveOrderId) : null;
  if (order) {
    if (jobDesc.trim()) order.desc  = jobDesc.trim();
    if (notes.trim())   order.notes = notes.trim();
    // Update contact info on order too
    if (email)   order.email = email;
    if (phone)   order.phone = phone;
    if (typeof saveToStorage === 'function') saveToStorage();

    // Patch Custom Orders pipeline in Notion
    if (order.notionId) {
      var patch = { notionId: order.notionId };
      if (jobDesc.trim()) patch.desc  = jobDesc.trim();
      if (notes.trim())   patch.notes = notes.trim();
      if (email)          patch.email = email;
      if (phone)          patch.phone = phone;
      fetch('/api/notion-pipeline', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      }).catch(function(e){ console.warn('Pipeline patch error:', e); });
    }
  }

  prodSaveToCustomerClose();
  toast((isNew ? 'Customer created: ' : 'Customer updated: ') + name, '✓');
}

// ============================================================
//  SUPPLIER ORDER TRACKER (SOT)
// ============================================================

var CATALOG = [
  {id:'rg_107374',sup:'rg',cat:'Metals — Wire',name:'14/20 Yellow Gold-Filled Round Wire, 16-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_108314',sup:'rg',cat:'Metals — Wire',name:'Argentium® Silver Round Wire, 14-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_108316',sup:'rg',cat:'Metals — Wire',name:'Argentium® Silver Round Wire, 16-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_108318',sup:'rg',cat:'Metals — Wire',name:'Argentium® Silver Round Wire, 18-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_108320',sup:'rg',cat:'Metals — Wire',name:'Argentium® Silver Round Wire, 20-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_108720',sup:'rg',cat:'Metals — Wire',name:'Argentium® Silver Round Wire, 20-Ga., 1/2-Hard',desc:'By the OZT'},
  {id:'rg_107375',sup:'rg',cat:'Metals — Wire',name:'14/20 Yellow Gold-Filled Round Wire, 18-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_107376',sup:'rg',cat:'Metals — Wire',name:'14/20 Yellow Gold-Filled Round Wire, 20-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_107820',sup:'rg',cat:'Metals — Wire',name:'14/20 Yellow Gold-Filled Round Wire, 20-Ga., 1/2-Hard',desc:'By the OZT'},
  {id:'rg_600118',sup:'rg',cat:'Metals — Wire',name:'14K Yellow Gold Round Wire, 18-Ga., Soft',desc:'By the DWT'},
  {id:'rg_604120',sup:'rg',cat:'Metals — Wire',name:'18K Yellow Gold Round Wire, 20-Ga., Soft',desc:'By the DWT'},
  {id:'rg_108216',sup:'rg',cat:'Metals — Sheet & Stock',name:'Argentium® Silver 6" Sheet, 16-Ga., Dead-Soft',desc:'By the OZT, cut to order'},
  {id:'rg_108218',sup:'rg',cat:'Metals — Sheet & Stock',name:'Argentium® Silver 6" Sheet, 18-Ga., Dead-Soft',desc:'By the OZT, cut to order'},
  {id:'rg_108220',sup:'rg',cat:'Metals — Sheet & Stock',name:'Argentium® Silver 6" Sheet, 20-Ga., Dead-Soft',desc:'By the OZT, cut to order'},
  {id:'rg_107432',sup:'rg',cat:'Metals — Sheet & Stock',name:'14/20 Yellow Gold-Filled 4" Double-Clad Sheet, 22-Ga., Soft',desc:'By the OZT, cut to order'},
  {id:'rg_108651',sup:'rg',cat:'Metals — Sheet & Stock',name:'Argentium® Silver Sheet Solder, 30-Ga., Medium',desc:'By the OZT, cut to order'},
  {id:'rg_600825',sup:'rg',cat:'Metals — Sheet & Stock',name:'14K Plumb Yellow Gold Chip Solder',desc:'By the DWT'},
  {id:'rg_643125B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 3.2mm Heart Link Cable Chain',desc:'By the foot'},
  {id:'rg_617837B',sup:'rg',cat:'Chains',name:'Sterling Silver 3.4mm Flat Heart Link Chain',desc:'By the foot'},
  {id:'rg_643030B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 2.2mm Figaro Chain',desc:'By the foot'},
  {id:'rg_632379B',sup:'rg',cat:'Chains',name:'Sterling Silver 2.2mm Diamond-Cut Figaro Chain',desc:'By the foot'},
  {id:'rg_643012B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 2mm Dapped Long & Short Chain',desc:'By the foot'},
  {id:'rg_683164B',sup:'rg',cat:'Chains',name:'Sterling Silver 2.5mm Dapped Flat Oval Cable Chain',desc:'By the foot'},
  {id:'rg_632370B',sup:'rg',cat:'Chains',name:'Sterling Silver 1.3mm Dapped Bar & Link Chain',desc:'By the foot'},
  {id:'rg_656431B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.65mm Cable Chain w/ Blue Enamel Beads',desc:'By the foot'},
  {id:'rg_656437B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.65mm Cable Chain w/ Pink Enamel Beads',desc:'By the foot'},
  {id:'rg_656434B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.65mm Cable Chain w/ Turquoise Enamel Beads',desc:'By the foot'},
  {id:'rg_656436B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.65mm Cable Chain w/ White Enamel Beads',desc:'By the foot'},
  {id:'rg_617936B',sup:'rg',cat:'Chains',name:'Sterling Silver 1.9mm Oval Cable Chain',desc:'By the foot'},
  {id:'rg_924236',sup:'rg',cat:'Findings & Clasps',name:'14/20 Yellow Gold-Filled 1.6mm Round Jump Ring',desc:'22 ga, per pack'},
  {id:'rg_927039',sup:'rg',cat:'Findings & Clasps',name:'14/20 Yellow Gold-Filled 1.4mm Round Jump Ring',desc:'23 ga, per pack'},
  {id:'rg_924426',sup:'rg',cat:'Findings & Clasps',name:'14/20 Yellow Gold-Filled 2.5mm Round Jump Ring',desc:'22 ga, per pack'},
  {id:'rg_926781',sup:'rg',cat:'Findings & Clasps',name:'Argentium® Silver 1.6mm ID Round Jump Ring',desc:'22 ga, per pack'},
  {id:'rg_926746',sup:'rg',cat:'Findings & Clasps',name:'Argentium® Silver 2.5mm ID Round Jump Ring',desc:'22 ga, per pack'},
  {id:'rg_926788',sup:'rg',cat:'Findings & Clasps',name:'Argentium® Silver 8.9 x 4.7mm Oval Tag, 24-Ga.',desc:'Per pack'},
  {id:'rg_631018',sup:'rg',cat:'Findings & Clasps',name:'Translucent Rubber Ear Wire Guard',desc:'Per pack'},
  {id:'rg_704224',sup:'rg',cat:'Bench Tools & Supplies',name:'The WHIP Ceramic Crucible (Melting Dish), 2.0-Ozt.',desc:'Per pack'},
  {id:'rg_341100',sup:'rg',cat:'Bench Tools & Supplies',name:'Super Q Tungsten Vanadium Krause Bur, 1mm',desc:'Per pack'},
  {id:'rg_342020',sup:'rg',cat:'Bench Tools & Supplies',name:'LYNX Krause Bur, 1mm',desc:'Per pack'},
  {id:'rg_338125',sup:'rg',cat:'Bench Tools & Supplies',name:'Mounted Mini Fiber Wheel, Coarse',desc:'7/8" dia'},
  {id:'rg_338124',sup:'rg',cat:'Bench Tools & Supplies',name:'Mounted Mini Fiber Wheel, Fine',desc:'7/8" dia'},
  {id:'rg_705137',sup:'rg',cat:'Bench Tools & Supplies',name:'Delft Clay',desc:'4.4 lb'},
  {id:'rg_706051',sup:'rg',cat:'Bench Tools & Supplies',name:'Ancient Bronze Casting Grain',desc:'Per lb'},
  {id:'rg_700512',sup:'rg',cat:'Bench Tools & Supplies',name:'Matt™ Green Wax Ring Tube, Flat-Top, Center Hole',desc:'5/8" hole'},
  {id:'rg_700224',sup:'rg',cat:'Bench Tools & Supplies',name:'Ferris® Gold Wax Ring Tube, Flat-Top, Center Hole',desc:'T-150'},
  {id:'rg_700241',sup:'rg',cat:'Bench Tools & Supplies',name:'Ferris® Gold Wax Ring Tube, Flat-Top, Off-Center Hole',desc:'T-250'},
  {id:'rg_330704',sup:'rg',cat:'Bench Tools & Supplies',name:'Yellow-Treated Buffing Wheel, 1" x 16-Ply',desc:'Pack of 10'},
  {id:'st_49572',sup:'stuller',cat:'Metals — Wire',name:'14K Yellow Gold 16 Gauge Wire, 1/2 Hard',desc:'Straight, by the inch'},
  {id:'st_95007',sup:'stuller',cat:'Metals — Wire',name:'14K Palladium White Gold 16 Gauge Wire, 1/2 Hard',desc:'Straight, by the inch'},
  {id:'st_991004',sup:'stuller',cat:'Metals — Sheet & Stock',name:'14K Palladium White Gold Flat Sizing Stock, 6x1.25mm',desc:'By the inch'},
  {id:'st_24284',sup:'stuller',cat:'Findings & Clasps',name:'Sterling Silver 6mm Round Magnetic Clasp',desc:'Per piece'},
  {id:'st_105491',sup:'stuller',cat:'Gemstones',name:'Natural Onyx, 13x11mm Rectangle Buff Top',desc:'Per stone'},
  {id:'st_13077',sup:'stuller',cat:'Gemstones',name:'Natural Onyx, 12x10mm Rectangle Buff Top',desc:'Per stone'},
  {id:'st_24191',sup:'stuller',cat:'Gemstones',name:'Natural London Blue Topaz, 8x6mm Oval Faceted AA',desc:'Per stone'},
  {id:'st_104740',sup:'stuller',cat:'Gemstones',name:'Natural Mozambique Garnet, 5mm Round Faceted AA',desc:'Per stone'},
  {id:'st_342542',sup:'stuller',cat:'Gemstones',name:'Lab-Grown Diamond, 3mm Round Full-Cut VS F+',desc:'Per stone'},
  {id:'st_170890',sup:'stuller',cat:'Bench Tools & Supplies',name:'Radiant Glow™ Treated Polishing Cloths, 4x4"',desc:'Per pack (SKU: 17-0890)'},
  {id:'st_247246',sup:'stuller',cat:'Gemstones',name:'Natural Tanzanite, 2.5mm Round Faceted AA',desc:'Per stone'},
  {id:'st_264580',sup:'stuller',cat:'Gemstones',name:'Natural Citrine, 2.5mm Round Faceted AAA',desc:'Per stone'},
  {id:'st_12834',sup:'stuller',cat:'Gemstones',name:'Natural Pink Tourmaline, 2.5mm Round Faceted AA',desc:'Per stone'},
  {id:'st_119641',sup:'stuller',cat:'Gemstones',name:'Lab-Grown Blue Sapphire, 2.5mm Round Faceted',desc:'Per stone'},
  {id:'st_243407',sup:'stuller',cat:'Gemstones',name:'Natural Arizona Peridot, 2.5mm Round Faceted AA',desc:'Per stone'},
  {id:'st_66865',sup:'stuller',cat:'Gemstones',name:'Lab-Grown Ruby, 2.5mm Round Faceted',desc:'Per stone'},
  {id:'st_134220',sup:'stuller',cat:'Gemstones',name:'Natural Blue Sheen Moonstone, 2.5mm Round Faceted AAA',desc:'Per stone'},
  {id:'st_76051',sup:'stuller',cat:'Gemstones',name:'Lab-Grown Alexandrite, 2.5mm Round Faceted',desc:'Per stone'},
  {id:'st_62509',sup:'stuller',cat:'Gemstones',name:'Lab-Grown Emerald, 2.5mm Round Faceted',desc:'Per stone'},
  {id:'st_777333',sup:'stuller',cat:'Gemstones',name:'Stuller Lab-Grown Moissanite™, 2.5mm Round Faceted DEF',desc:'Per stone'},
  {id:'st_104286',sup:'stuller',cat:'Gemstones',name:'Natural White Sapphire, 2.5mm Round Diamond-Cut AA',desc:'Per stone'},
  {id:'st_12826',sup:'stuller',cat:'Gemstones',name:'Natural Aquamarine, 2.5mm Round Faceted AA',desc:'Per stone'},
  {id:'st_104734',sup:'stuller',cat:'Gemstones',name:'Natural Mozambique Garnet, 2.5mm Round Faceted AA',desc:'Per stone'},
  {id:'st_216213',sup:'stuller',cat:'Gemstones',name:'Natural Amethyst, 2.5mm Round Faceted AA',desc:'Per stone'},

  // ── Added from Rio Grande order history (items reordered 2+ times) ──
  {id:'rg_108312',sup:'rg',cat:'Metals — Wire',name:'Argentium® Silver Round Wire, 12-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_101528',sup:'rg',cat:'Metals — Wire',name:'14/20 Yellow Gold-Filled Bead Wire, .060"',desc:'By the OZT'},
  {id:'rg_678880B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.7mm Cable w/ Tube Beads Chain',desc:'By the foot'},
  {id:'rg_926807',sup:'rg',cat:'Findings & Clasps',name:'Argentium® Silver 2.5mm ID Round Jump Ring',desc:'20 ga, per pack'},
  {id:'rg_600116',sup:'rg',cat:'Metals — Wire',name:'14K Yellow Gold Round Wire, 16-Ga., Soft',desc:'By the OZT'},
  {id:'rg_676055B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 2.4mm Long & Short Dapped Chain',desc:'By the foot'},
  {id:'rg_108214',sup:'rg',cat:'Metals — Sheet & Stock',name:'Argentium® Silver 6" Sheet, 14-Ga., Dead-Soft',desc:'By the OZT, cut to order'},
  {id:'rg_100914',sup:'rg',cat:'Metals — Wire',name:'Sterling Silver Bead Wire, 14-Ga.',desc:'By the OZT'},
  {id:'rg_613754',sup:'rg',cat:'Findings & Clasps',name:'Sterling Silver 10.1mm Lobster Clasp',desc:'Per piece'},
  {id:'rg_603116',sup:'rg',cat:'Metals — Wire',name:'14K Rose Gold Round Wire, 16-Ga., Soft',desc:'By the OZT'},
  {id:'rg_108222',sup:'rg',cat:'Metals — Sheet & Stock',name:'Argentium® Silver 6" Sheet, 22-Ga., Dead-Soft',desc:'By the OZT, cut to order'},
  {id:'rg_679538B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.3mm Elongated Rolo Chain',desc:'By the foot'},
  {id:'rg_107301',sup:'rg',cat:'Metals — Wire',name:'14/20 Rose Gold-Filled Round Wire, 18-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_107372',sup:'rg',cat:'Metals — Wire',name:'14/20 Yellow Gold-Filled Round Wire, 12-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_926876',sup:'rg',cat:'Findings & Clasps',name:'Argentium® Silver 1.6mm ID Round Jump Ring',desc:'20 ga, per pack'},
  {id:'rg_600120',sup:'rg',cat:'Metals — Wire',name:'14K Yellow Gold Round Wire, 20-Ga., Soft',desc:'By the OZT'},
  {id:'rg_101526',sup:'rg',cat:'Metals — Wire',name:'14/20 Yellow Gold-Filled Bead Wire, .075"',desc:'By the OZT'},
  {id:'rg_615831B',sup:'rg',cat:'Chains',name:'Sterling Silver 1.7mm Cable w/ Tube Beads Chain',desc:'By the foot'},
  {id:'rg_107302',sup:'rg',cat:'Metals — Wire',name:'14/20 Rose Gold-Filled Round Wire, 20-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_101529',sup:'rg',cat:'Metals — Wire',name:'14/20 Yellow Gold-Filled Bead Wire, .093"',desc:'By the OZT'},
  {id:'rg_40501511',sup:'rg',cat:'Bench Tools & Supplies',name:'Ring Tray Insert, 72-Slit, Flocked Foam, Black',desc:'Per pack'},
  {id:'rg_613081B',sup:'rg',cat:'Chains',name:'Sterling Silver 1.6mm Long & Short Chain',desc:'By the foot'},
  {id:'rg_101523',sup:'rg',cat:'Metals — Wire',name:'Sterling Silver Bead Wire, .060"',desc:'By the OZT'},
  {id:'rg_628672B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.7mm Long & Short Flat Chain',desc:'By the foot'},
  {id:'rg_100912',sup:'rg',cat:'Metals — Wire',name:'Sterling Silver Bead Wire, 12-Ga.',desc:'By the OZT'},
  {id:'rg_107300',sup:'rg',cat:'Metals — Wire',name:'14/20 Rose Gold-Filled Round Wire, 16-Ga., Dead-Soft',desc:'By the OZT'},
  {id:'rg_108224',sup:'rg',cat:'Metals — Sheet & Stock',name:'Argentium® Silver 6" Sheet, 24-Ga., Dead-Soft',desc:'By the OZT, cut to order'},
  {id:'rg_603120',sup:'rg',cat:'Metals — Wire',name:'14K Rose Gold Round Wire, 20-Ga., Soft',desc:'By the OZT'},
  {id:'rg_643029B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.9mm Figaro Chain',desc:'By the foot'},
  {id:'rg_114707',sup:'rg',cat:'Bench Tools & Supplies',name:'F. Dick Half-Round Ring File, Cut #4',desc:'Per piece'},
  {id:'rg_926741',sup:'rg',cat:'Findings & Clasps',name:'Argentium® Silver 1.6mm ID Round Jump Ring',desc:'24 ga, per pack'},
  {id:'rg_342476',sup:'rg',cat:'Bench Tools & Supplies',name:'Technique Vanadium Drill Bit, 1.00mm',desc:'Per piece'},
  {id:'rg_45032321',sup:'rg',cat:'Bench Tools & Supplies',name:'Paper-Covered Box, 3-1/16" x 2-1/8" x 1", Navy Blue',desc:'Per piece'},
  {id:'rg_504008',sup:'rg',cat:'Bench Tools & Supplies',name:'Rondas Purple Flux',desc:'1 pint'},
  {id:'rg_101521',sup:'rg',cat:'Metals — Wire',name:'Sterling Silver Bead Wire, .093"',desc:'By the OZT'},
  {id:'rg_108716',sup:'rg',cat:'Metals — Wire',name:'Argentium® Silver Round Wire, 16-Ga., 1/2-Hard',desc:'By the OZT'},
  {id:'rg_601118',sup:'rg',cat:'Metals — Wire',name:'14K White Gold Round Wire, 18-Ga., Soft (Contains Nickel)',desc:'By the OZT'},
  {id:'rg_108924',sup:'rg',cat:'Metals — Wire',name:'Argentium® Silver Round Wire, 24-Ga., Hard',desc:'By the OZT'},
  {id:'rg_621644B',sup:'rg',cat:'Chains',name:'Sterling Silver 2.4mm Open Foxtail Chain',desc:'By the foot'},
  {id:'rg_100910',sup:'rg',cat:'Metals — Wire',name:'Sterling Silver Bead Wire, 10-Ga.',desc:'By the OZT'},

  // ── Added from Rio Grande order history (one-off chains, by request) ──
  {id:'rg_643985B',sup:'rg',cat:'Chains',name:'10K Yellow Gold 1.4mm Diamond-Cut Oval Rolo Chain',desc:'By the inch'},
  {id:'rg_678682B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.4mm Dapped Bar & Link Chain',desc:'By the foot'},
  {id:'rg_679918B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.4mm Flat Oval Cable Chain',desc:'By the foot'},
  {id:'rg_675726B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 1.5mm Cable Chain',desc:'By the foot'},
  {id:'rg_643011B',sup:'rg',cat:'Chains',name:'14/20 Yellow Gold-Filled 2.1mm Patterned Long & Short Chain',desc:'By the foot'},
  {id:'rg_643126B',sup:'rg',cat:'Chains',name:'14/20 Rose Gold-Filled 3.2mm Heart Link Chain',desc:'By the foot'},
  {id:'rg_618628B',sup:'rg',cat:'Chains',name:'Sterling Silver 1.1mm Flat Wire Rolo Chain',desc:'By the foot'},
  {id:'rg_619330B',sup:'rg',cat:'Chains',name:'Sterling Silver 1.9mm Patterned Cable Chain',desc:'By the foot'},
  {id:'rg_621635B',sup:'rg',cat:'Chains',name:'Sterling Silver 1.9mm Square Foxtail Chain',desc:'By the foot'},
  {id:'rg_621726B',sup:'rg',cat:'Chains',name:'Sterling Silver 2.4mm Rolo Chain',desc:'By the foot'},
  {id:'rg_616780B',sup:'rg',cat:'Chains',name:'Sterling Silver 2.7mm Flat Rolo Chain',desc:'By the foot'},
  {id:'rg_617800B',sup:'rg',cat:'Chains',name:'Sterling Silver 2.8mm Flat Curb Chain',desc:'By the foot'},
  {id:'rg_612785B',sup:'rg',cat:'Chains',name:'Sterling Silver 2mm Diamond-Cut Rolo Chain',desc:'By the foot'},
  {id:'rg_683693B',sup:'rg',cat:'Chains',name:'Sterling Silver 3mm Flat Heart Link Chain',desc:'By the foot'}
];

var CATALOG_IDS = new Set(CATALOG.map(function(c){return c.id;}));

var SUPPLIERS_META = {
  rg:      {name:'Rio Grande', color:'#e63946'},
  stuller: {name:'Stuller',    color:'#457b9d'}
};

var CAT_ORDER = [
  'Metals — Wire',
  'Metals — Sheet & Stock',
  'Chains',
  'Findings & Clasps',
  'Gemstones',
  'Bench Tools & Supplies'
];

var CAT_COLORS = {
  'Metals — Wire':          '#c0a060',
  'Metals — Sheet & Stock': '#888888',
  'Chains':                      '#5b8dd9',
  'Findings & Clasps':           '#6abf8a',
  'Gemstones':                   '#b06abf',
  'Bench Tools & Supplies':      '#e07a50'
};

// ── State ────────────────────────────────────────────────────
var sotOrder   = {};
var sotCustom  = [];
var sotNotesTxt = '';
var sotFilter  = '';
var sotEditId  = null;
var sotSupCollapsed = {};
var sotCatCollapsed = {};
var sotCustomSuppliers = [];
var sotNotionPageId = null;
var sotNotionTimer  = null;
var sotUpdatedAt    = 0;
var sotCatalogUrls  = {};

// ── Helpers ──────────────────────────────────────────────────
function sotUid() {
  return Math.random().toString(36).slice(2,10) + Date.now().toString(36);
}
function sotGetUnit(desc) {
  var d = (desc||'').toLowerCase();
  if (d.indexOf('by the ozt') >= 0) return 'OZT';
  if (d.indexOf('by the dwt') >= 0) return 'DWT';
  if (d.indexOf('by the foot') >= 0) return 'ft';
  if (d.indexOf('by the inch') >= 0) return 'in';
  if (d.indexOf('per lb') >= 0) return 'lb';
  return null;
}
function sotWeekRange() {
  var now = new Date();
  var day = now.getDay();
  var mon = new Date(now);
  mon.setDate(now.getDate() - (day===0?6:day-1));
  var sun = new Date(mon);
  sun.setDate(mon.getDate()+6);
  var fmt = function(d){ return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
  return fmt(mon) + ' – ' + fmt(sun);
}

// ── Persistence ──────────────────────────────────────────────
// sotUpdatedAt stamps every local edit so sotLoadNotion() can tell
// which device's copy is newer instead of guessing from item counts.
function sotSaveLocal() {
  try {
    localStorage.setItem('sot_order_v1', JSON.stringify({order: sotOrder}));
    localStorage.setItem('sot_custom_v1', JSON.stringify({
      custom: sotCustom,
      suppliers: sotCustomSuppliers,
      catalogUrls: sotCatalogUrls
    }));
    localStorage.setItem('sot_updated_at_v1', String(sotUpdatedAt));
  } catch(e) {}
}
function sotSave() {
  sotUpdatedAt = Date.now();
  sotSaveLocal();
  sotScheduleNotionSave();
}
function sotLoad() {
  try {
    var raw = localStorage.getItem('sot_order_v1')
           || localStorage.getItem('supplier_tracker_v5')
           || localStorage.getItem('supplier_tracker_v4')
           || localStorage.getItem('supplier_tracker_v3');
    if (raw) {
      var d = JSON.parse(raw); sotOrder = d.order || {};
      Object.keys(sotOrder).forEach(function(id) {
        if (typeof sotOrder[id] !== 'object' || sotOrder[id] === null) {
          sotOrder[id] = {qty: Number(sotOrder[id]) || 1, amount: ''};
        } else {
          if (!('qty' in sotOrder[id])) sotOrder[id].qty = 1;
          if (!('amount' in sotOrder[id])) sotOrder[id].amount = '';
        }
      });
    }
    var rawC = localStorage.getItem('sot_custom_v1');
    if (rawC) {
      var dc = JSON.parse(rawC);
      sotCustom = dc.custom || [];
      sotCustomSuppliers = dc.suppliers || [];
      sotCatalogUrls = dc.catalogUrls || {};
    }
    var rawN = localStorage.getItem('sot_notes_v1');
    if (rawN) sotNotesTxt = rawN;
    sotUpdatedAt = Number(localStorage.getItem('sot_updated_at_v1')) || 0;
  } catch(e) {}
}
function sotSaveNotes() {
  sotNotesTxt = (document.getElementById('sotNotes')||{}).value || '';
  sotUpdatedAt = Date.now();
  try { localStorage.setItem('sot_notes_v1', sotNotesTxt); } catch(e) {}
  sotSaveLocal();
  sotScheduleNotionSave();
}

// ── Notion auto-save ─────────────────────────────────────────
function sotSetSyncStatus(state) {
  var el = document.getElementById('sotSyncStatus');
  if (!el) return;
  el.classList.remove('saving', 'saved', 'error');
  if (state === 'saving') { el.textContent = '☁ Saving…'; el.classList.add('saving'); }
  else if (state === 'saved') { el.textContent = '☁ Saved'; el.classList.add('saved'); }
  else if (state === 'error') { el.textContent = '☁ Sync error'; el.classList.add('error'); }
}

function sotScheduleNotionSave() {
  if (sotNotionTimer) clearTimeout(sotNotionTimer);
  sotSetSyncStatus('saving');
  sotNotionTimer = setTimeout(sotSaveNotion, 2000);
}

async function sotSaveNotion() {
  sotNotionTimer = null;
  var now = new Date();
  var day = now.getDay();
  var mon = new Date(now);
  mon.setDate(now.getDate() - (day===0?6:day-1));
  var key = mon.toISOString().slice(0,10);

  var payload = {
    weekKey:      key,
    weekLabel:    sotWeekRange(),
    items:        JSON.stringify(sotOrder),
    notes:        sotNotesTxt,
    custom:       JSON.stringify(sotCustom),
    customSuppliers: JSON.stringify(sotCustomSuppliers),
    updatedAt:    sotUpdatedAt,
    notionPageId: sotNotionPageId || undefined,
  };

  try {
    var r = await fetch('/api/notion-sot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var d = await r.json();
    if (d.error) { sotSetSyncStatus('error'); return; }
    if (d.notionPageId) sotNotionPageId = d.notionPageId;
    sotSetSyncStatus('saved');
  } catch(e) {
    sotSetSyncStatus('error');
  }
}

// Last-write-wins: whichever device saved most recently becomes the
// shared state. Only applies remote data when it's strictly newer
// than what this device already knows about.
async function sotLoadNotion() {
  try {
    var r = await fetch('/api/notion-sot');
    var d = await r.json();
    if (!d.found) return;
    sotNotionPageId = d.notionPageId;
    var remoteUpdatedAt = Number(d.updatedAt) || 0;
    if (remoteUpdatedAt <= sotUpdatedAt) return;

    sotOrder = JSON.parse(d.items || '{}');
    sotCustom = JSON.parse(d.custom || '[]');
    sotCustomSuppliers = JSON.parse(d.customSuppliers || '[]');
    sotNotesTxt = d.notes || '';
    var el = document.getElementById('sotNotes');
    if (el) el.value = sotNotesTxt;

    sotUpdatedAt = remoteUpdatedAt;
    sotSaveLocal();
    sotRenderCatalog();
    sotRenderOrder();
  } catch(e) {}
}

// ── Data helpers ─────────────────────────────────────────────
function sotAllItems() { return CATALOG.concat(sotCustom); }
function sotGetItem(id) {
  return sotAllItems().filter(function(i){return i.id===id;})[0] || null;
}
function sotItemUrl(item) {
  if (!item) return '';
  if (CATALOG_IDS.has(item.id)) return sotCatalogUrls[item.id] || '';
  return item.url || '';
}
function sotAllSuppliers() {
  return Object.keys(SUPPLIERS_META).map(function(id){
    return {id:id, name:SUPPLIERS_META[id].name, color:SUPPLIERS_META[id].color};
  }).concat(sotCustomSuppliers);
}

// ── Render catalog ───────────────────────────────────────────
function sotRenderCatalog() {
  var inner = document.getElementById('sotCatalogInner');
  if (!inner) return;
  var f = sotFilter.toLowerCase();
  var allItems = sotAllItems();
  var suppliers = sotAllSuppliers();
  var html = '';

  suppliers.forEach(function(sup) {
    var items = allItems.filter(function(i){ return i.sup === sup.id; });
    if (f) {
      items = items.filter(function(i){
        return (i.name+' '+i.desc+' '+i.id+' '+(i.cat||''))
          .toLowerCase().indexOf(f) >= 0;
      });
      if (items.length === 0) return;
    }
    var collapsed = sotSupCollapsed[sup.id] ? ' collapsed' : '';
    var checkedCount = items.filter(function(i){return sotOrder[i.id]!==undefined;}).length;

    html += '<div class="sot-supplier-section' + collapsed + '" id="sot-sup-' + sotEsc(sup.id) + '">';
    html += '<div class="sot-supplier-head" onclick="sotToggleSup(\'' + sotEsc(sup.id) + '\')">';
    html += '<span class="sot-supplier-badge" style="background:' + sotEsc(sup.color) + '">'
          + sotEsc(sup.name) + '</span>';
    html += '<span class="sot-supplier-name"></span>';
    if (checkedCount > 0) {
      html += '<span class="sot-supplier-count">' + checkedCount + ' in order</span>';
    }
    html += '<span class="sot-chevron">&#9660;</span></div>';
    html += '<div class="sot-supplier-body">';

    // Categories
    var catsPresent = CAT_ORDER.filter(function(c){
      return items.some(function(i){return i.cat===c;});
    });
    items.forEach(function(i){
      var c = i.cat||'Other';
      if (catsPresent.indexOf(c)<0) catsPresent.push(c);
    });

    catsPresent.forEach(function(cat) {
      var catItems = items.filter(function(i){return (i.cat||'Other')===cat;});
      if (!catItems.length) return;
      var catKey = sup.id + '__' + cat;
      var catColl = sotCatCollapsed[catKey] ? ' collapsed' : '';
      var dot = CAT_COLORS[cat] || '#999';

      html += '<div class="sot-cat-group' + catColl + '">';
      html += '<div class="sot-cat-head" onclick="sotToggleCat(\'' + sotEsc(catKey) + '\')">';
      html += '<span class="sot-cat-dot" style="background:' + dot + '"></span>';
      html += sotEsc(cat);
      html += '<span class="sot-cat-chevron">&#9660;</span></div>';
      html += '<div class="sot-cat-items">';

      catItems.forEach(function(item) {
        var chk  = sotOrder[item.id] !== undefined;
        var isCust = !CATALOG_IDS.has(item.id);
        var url  = sotItemUrl(item);
        html += '<div class="sot-item" id="sot-item-' + sotEsc(item.id) + '">';
        html += '<input class="sot-item-cb" type="checkbox"'
              + (chk ? ' checked' : '')
              + ' onchange="sotToggleItem(\'' + sotEsc(item.id) + '\',this.checked)">';
        html += '<div class="sot-item-info">';
        html += '<div class="sot-item-name">' + sotEsc(item.name) + '</div>';
        if (item.desc) html += '<div class="sot-item-desc">' + sotEsc(item.desc) + '</div>';
        html += '<span class="sot-item-sku">' + sotEsc(item.id) + '</span>';
        if (url) {
          html += '<a class="sot-item-link" href="' + sotEsc(url) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="Open ordering page">&#128279; Order page</a>';
        }
        html += '</div>';
        html += '<div class="sot-item-actions">';
        html += '<button class="sot-item-btn" onclick="sotEditOpen(\'' + sotEsc(item.id) + '\')">Edit</button>';
        if (isCust) {
          html += '<button class="sot-item-btn del" onclick="sotDeleteItem(\'' + sotEsc(item.id) + '\')">Del</button>';
        }
        html += '</div>';
        html += '</div>';
      });

      html += '</div></div>'; // cat-items / cat-group
    });

    // Add-item button & form
    html += '<div style="padding:4px 8px 10px">';
    html += '<button class="sot-item-btn" style="font-size:11px;padding:4px 10px;"'
          + ' onclick="sotToggleAddForm(\'' + sotEsc(sup.id) + '\')">+ Add item</button>';
    html += '<div class="sot-add-form" id="sot-add-form-' + sotEsc(sup.id) + '">';
    html += '<input id="sot-af-name-' + sotEsc(sup.id) + '" type="text" placeholder="Item name...">';
    html += '<input id="sot-af-desc-' + sotEsc(sup.id) + '" type="text" placeholder="Description...">';
    html += '<input id="sot-af-sku-'  + sotEsc(sup.id) + '" type="text" placeholder="SKU / Item #...">';
    html += '<select id="sot-af-cat-' + sotEsc(sup.id) + '">';
    CAT_ORDER.forEach(function(c){ html += '<option>' + sotEsc(c) + '</option>'; });
    html += '<option>Other</option></select>';
    html += '<div class="sot-add-form-row">';
    html += '<button class="btn btn-gold btn-sm" onclick="sotAddItem(\'' + sotEsc(sup.id) + '\')">Add</button>';
    html += '<button class="btn btn-outline btn-sm" onclick="sotToggleAddForm(\'' + sotEsc(sup.id) + '\')">Cancel</button>';
    html += '</div></div></div>';

    html += '</div></div>'; // supplier-body / supplier-section
  });

  inner.innerHTML = html;
}

// ── Render order panel ───────────────────────────────────────
function sotRenderOrder() {
  var badge = document.getElementById('sotOrderBadge');
  var list  = document.getElementById('sotOrderList');
  var empty = document.getElementById('sotEmptyState');
  var week  = document.getElementById('sotWeekLabel');
  if (week) week.textContent = sotWeekRange();

  var ids = Object.keys(sotOrder);
  if (badge) badge.textContent = ids.length;
  if (!list) return;

  if (ids.length === 0) {
    list.innerHTML = '';
    if (empty) { empty.style.display = ''; list.appendChild(empty); }
    return;
  }
  if (empty) empty.style.display = 'none';

  var suppliers = sotAllSuppliers();
  var html = '';

  suppliers.forEach(function(sup) {
    var supIds = ids.filter(function(id){
      var it = sotGetItem(id);
      return it && it.sup === sup.id;
    });
    if (!supIds.length) return;

    html += '<div class="sot-ord-supplier">';
    html += '<div class="sot-ord-sup-label" style="background:' + sotEsc(sup.color) + '">'
          + sotEsc(sup.name) + '</div>';

    var catMap = {};
    supIds.forEach(function(id){
      var it = sotGetItem(id); if (!it) return;
      var cat = it.cat || 'Other';
      if (!catMap[cat]) catMap[cat] = [];
      catMap[cat].push(id);
    });

    var orderedCats = CAT_ORDER.concat(['Other','Gemstones']).filter(function(c,i,a){
      return a.indexOf(c)===i;
    });
    orderedCats.forEach(function(cat){
      if (!catMap[cat] || !catMap[cat].length) return;
      html += '<div class="sot-ord-cat-label">' + sotEsc(cat) + '</div>';
      catMap[cat].forEach(function(id){
        var it = sotGetItem(id); if (!it) return;
        var entry = sotOrder[id];
        if (typeof entry !== 'object' || entry === null) entry = {qty:Number(entry)||1, amount:''};
        var qty = entry.qty || 1;
        var unit = sotGetUnit(it.desc);
        html += '<div class="sot-ord-item">';
        html += '<div class="sot-ord-item-info">';
        if (it.sku) html += '<div class="sot-ord-item-sku">' + sotEsc(it.sku) + '</div>';
        html += '<div class="sot-ord-item-name">' + sotEsc(it.name) + '</div>';
        html += '</div>';
        if (unit) {
          html += '<div class="sot-amt-wrap">';
          html += '<input class="sot-amt-input" type="number" min="0" step="0.1" value="' + sotEsc(entry.amount||'') + '" placeholder="0" oninput="sotSetAmount(\'' + sotEsc(id) + '\',this.value)">';
          html += '<span class="sot-amt-unit">' + sotEsc(unit) + '</span>';
          html += '</div>';
        } else {
          html += '<div class="sot-qty-wrap">';
          html += '<button class="sot-qty-btn" onclick="sotQty(\'' + sotEsc(id) + '\',-1)">&#8722;</button>';
          html += '<span class="sot-qty-val" id="sotq-' + sotEsc(id) + '">' + qty + '</span>';
          html += '<button class="sot-qty-btn" onclick="sotQty(\'' + sotEsc(id) + '\',1)">+</button>';
          html += '</div>';
        }
        html += '<button class="sot-ord-remove" onclick="sotRemove(\'' + sotEsc(id) + '\')" title="Remove">&#215;</button>';
        html += '</div>';
      });
    });
    html += '</div>';
  });

  list.innerHTML = html;
  if (empty) list.appendChild(empty);
}

// ── Interactions ─────────────────────────────────────────────
function sotToggleItem(id, checked) {
  if (checked) { if (sotOrder[id]===undefined) sotOrder[id]={qty:1,amount:''}; }
  else { delete sotOrder[id]; }
  sotSave(); sotRenderOrder();
  var badge = document.getElementById('sotOrderBadge');
  if (badge) badge.textContent = Object.keys(sotOrder).length;
}
function sotQty(id, delta) {
  var entry = sotOrder[id];
  if (typeof entry !== 'object' || entry === null) entry = {qty: Number(entry)||1, amount:''};
  var q = ((entry.qty||1) + delta);
  if (q < 1) q = 1;
  entry.qty = q;
  sotOrder[id] = entry;
  var el = document.getElementById('sotq-'+id);
  if (el) el.textContent = q;
  sotSave();
}
function sotSetAmount(id, val) {
  var entry = sotOrder[id];
  if (typeof entry !== 'object' || entry === null) entry = {qty:1, amount:''};
  entry.amount = String(val||'').trim();
  sotOrder[id] = entry;
  sotSave();
}
function sotRemove(id) {
  delete sotOrder[id];
  sotSave();
  var cb = document.querySelector('#sot-item-'+id+' .sot-item-cb');
  if (cb) cb.checked = false;
  sotRenderOrder();
  var badge = document.getElementById('sotOrderBadge');
  if (badge) badge.textContent = Object.keys(sotOrder).length;
}
function sotClearOrder() {
  if (!confirm("Clear this week's entire order?")) return;
  sotOrder = {};
  sotSave();
  sotRenderCatalog();
  sotRenderOrder();
}
function sotSendToRG() {
  var items = [];
  Object.keys(sotOrder).forEach(function(id) {
    var it = sotGetItem(id);
    if (!it || it.sup !== 'rg') return;
    var entry = sotOrder[id];
    if (typeof entry !== 'object' || entry === null) entry = {qty:Number(entry)||1, amount:''};
    var unit = sotGetUnit(it.desc);
    var code = id.replace(/^rg_/, '');
    items.push({code:code, name:it.name, amount: unit ? (entry.amount||'') : String(entry.qty||1), unit: unit||'qty'});
  });
  if (!items.length) { alert('No Rio Grande items in your order.'); return; }
  var missing = items.filter(function(it){ return it.unit !== 'qty' && !it.amount; });
  if (missing.length) {
    alert('Enter amounts for:\n' + missing.map(function(i){ return '  • ' + i.name.split(',')[0]; }).join('\n'));
    return;
  }
  var lines = items.map(function(it){ return it.code + ': ' + it.name + ' — ' + it.amount + ' ' + it.unit; });
  var text = 'RG Cart Order:\n' + lines.join('\n');
  var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(items))));
  try { navigator.clipboard.writeText(text); } catch(e) {}
  window.open('https://www.riogrande.com/#sts-order=' + encodeURIComponent(encoded), '_blank');
  if (typeof toast === 'function') toast('Order copied + RG opened in new tab', '🛒');
}

// ── Collapse ─────────────────────────────────────────────────
function sotToggleSup(id) {
  sotSupCollapsed[id] = !sotSupCollapsed[id];
  var el = document.getElementById('sot-sup-'+id);
  if (el) el.classList.toggle('collapsed', !!sotSupCollapsed[id]);
}
function sotToggleCat(key) {
  sotCatCollapsed[key] = !sotCatCollapsed[key];
  document.querySelectorAll('.sot-cat-group').forEach(function(g){
    var h = g.querySelector('.sot-cat-head');
    if (h && (h.getAttribute('onclick')||'').indexOf(key) >= 0) {
      g.classList.toggle('collapsed', !!sotCatCollapsed[key]);
    }
  });
}

// ── Search ───────────────────────────────────────────────────
function sotSearch(val) {
  sotFilter = val;
  sotCheckRgPanel(val);
  var catalogEl = document.getElementById('sotCatalog');
  if (catalogEl) catalogEl.classList.toggle('sot-searching', !!val.trim());
  sotRenderCatalog();
}
function sotCheckRgPanel(val) {
  var panel = document.getElementById('sotRgPanel');
  if (!panel) return;
  var clean = val.trim();
  var isRg = /^\d{4,7}[A-Za-z]*$/.test(clean);
  if (isRg) {
    var fullId = 'rg_' + clean;
    var alreadyIn = sotAllItems().some(function(i){return i.id===fullId;});
    if (!alreadyIn) {
      var link = document.getElementById('sotRgLink');
      if (link) link.href = 'https://www.riogrande.com/product/' + clean;
      var nameIn = document.getElementById('sotRgName');
      if (nameIn) nameIn.setAttribute('data-sku', clean);
      panel.classList.add('open');
      return;
    }
  }
  panel.classList.remove('open');
}
function sotRgAdd() {
  var nameEl = document.getElementById('sotRgName');
  var descEl = document.getElementById('sotRgDesc');
  var catEl  = document.getElementById('sotRgCat');
  var name = nameEl ? nameEl.value.trim() : '';
  var desc = descEl ? descEl.value.trim() : '';
  var cat  = catEl  ? catEl.value  : '';
  var sku  = nameEl ? (nameEl.getAttribute('data-sku')||sotUid()) : sotUid();
  if (!name) { alert('Please enter an item name.'); return; }
  sotCustom.push({id:'rg_'+sku, sup:'rg', cat:cat||'Other', name:name, desc:desc});
  sotSave();
  document.getElementById('sotRgPanel').classList.remove('open');
  document.getElementById('sotSearch').value = '';
  sotFilter = '';
  if (nameEl) { nameEl.value=''; nameEl.removeAttribute('data-sku'); }
  if (descEl) descEl.value='';
  if (catEl)  catEl.value='';
  sotRenderCatalog();
}

// ── Add item ─────────────────────────────────────────────────
function sotToggleAddForm(supId) {
  var f = document.getElementById('sot-add-form-'+supId);
  if (f) f.classList.toggle('open');
}
function sotAddItem(supId) {
  var nameEl = document.getElementById('sot-af-name-'+supId);
  var descEl = document.getElementById('sot-af-desc-'+supId);
  var skuEl  = document.getElementById('sot-af-sku-'+supId);
  var catEl  = document.getElementById('sot-af-cat-'+supId);
  var name = nameEl ? nameEl.value.trim() : '';
  var desc = descEl ? descEl.value.trim() : '';
  var sku  = skuEl  ? skuEl.value.trim()  : '';
  var cat  = catEl  ? catEl.value         : '';
  if (!name) { alert('Please enter an item name.'); return; }
  var id = sku ? (supId+'_'+sku) : (supId+'_'+sotUid());
  sotCustom.push({id:id, sup:supId, cat:cat, name:name, desc:desc});
  sotSave();
  sotRenderCatalog();
}

// ── Add supplier ──────────────────────────────────────────────
function sotToggleAddSupplier() {
  var f = document.getElementById('sotAddSupForm');
  if (f) f.classList.toggle('open');
}
function sotAddSupplier() {
  var nameEl  = document.getElementById('sotNewSupName');
  var colorEl = document.getElementById('sotNewSupColor');
  var name  = nameEl  ? nameEl.value.trim()  : '';
  var color = colorEl ? colorEl.value        : '#888';
  if (!name) { alert('Enter a supplier name.'); return; }
  var id = name.toLowerCase().replace(/[^a-z0-9]/g,'_') + '_' + sotUid().slice(0,4);
  sotCustomSuppliers.push({id:id, name:name, color:color});
  sotSave();
  document.getElementById('sotAddSupForm').classList.remove('open');
  if (nameEl) nameEl.value='';
  sotRenderCatalog();
}

// ── Edit / delete ─────────────────────────────────────────────
function sotEditOpen(id) {
  var item = sotGetItem(id);
  if (!item) return;
  var isCust = !CATALOG_IDS.has(id);
  sotEditId = id;
  var el;
  el = document.getElementById('sotEditName'); if(el) { el.value = item.name||''; el.disabled = !isCust; }
  el = document.getElementById('sotEditDesc'); if(el) { el.value = item.desc||''; el.disabled = !isCust; }
  el = document.getElementById('sotEditSku');  if(el) el.value = item.id||'';
  el = document.getElementById('sotEditCat');  if(el) {
    el.innerHTML = '<option value="">— Category —</option>' +
      CAT_ORDER.map(function(c){ return '<option' + (c===item.cat?' selected':'') + '>' + sotEsc(c) + '</option>'; }).join('') +
      '<option' + (item.cat==='Other'?' selected':'') + '>Other</option>';
    el.disabled = !isCust;
  }
  el = document.getElementById('sotEditUrl');  if(el) el.value = sotItemUrl(item);
  el = document.getElementById('sotModalDelete'); if(el) el.style.display = isCust ? '' : 'none';
  document.getElementById('sotModalBg').classList.add('open');
}
function sotEditSave() {
  var isCust = !CATALOG_IDS.has(sotEditId);
  var urlEl = document.getElementById('sotEditUrl');
  var url = urlEl ? urlEl.value.trim() : '';
  if (isCust) {
    var item = sotCustom.filter(function(i){return i.id===sotEditId;})[0];
    if (!item) return;
    var el;
    el = document.getElementById('sotEditName'); if(el) item.name = el.value.trim();
    el = document.getElementById('sotEditDesc'); if(el) item.desc = el.value.trim();
    el = document.getElementById('sotEditCat');  if(el) item.cat  = el.value;
    item.url = url;
  } else {
    if (url) sotCatalogUrls[sotEditId] = url;
    else delete sotCatalogUrls[sotEditId];
  }
  sotSave();
  sotModalBgClose();
  sotRenderCatalog();
  sotRenderOrder();
}
function sotDeleteItem(id) {
  if (CATALOG_IDS.has(id)) return;
  if (!confirm('Remove this item from your catalog?')) return;
  sotCustom = sotCustom.filter(function(i){return i.id!==id;});
  delete sotOrder[id];
  sotSave();
  sotModalBgClose();
  sotRenderCatalog();
  sotRenderOrder();
}
function sotModalClose(e) {
  if (e.target===document.getElementById('sotModalBg')) sotModalBgClose();
}
function sotModalBgClose() {
  var bg = document.getElementById('sotModalBg');
  if (bg) bg.classList.remove('open');
  sotEditId = null;
}

// ── Print ─────────────────────────────────────────────────────
function sotPrint() {
  var ids = Object.keys(sotOrder);
  if (!ids.length) { alert('No items in the order yet.'); return; }
  var lines = ['STONES THROW STUDIO — SUPPLY ORDER','Week of ' + sotWeekRange(),''];
  sotAllSuppliers().forEach(function(sup){
    var supIds = ids.filter(function(id){
      var it = sotGetItem(id); return it && it.sup===sup.id;
    });
    if (!supIds.length) return;
    lines.push('== ' + sup.name.toUpperCase() + ' ==');
    supIds.forEach(function(id){
      var it = sotGetItem(id);
      var entry = sotOrder[id]||{qty:1,amount:''};
      if (typeof entry !== 'object') entry = {qty:Number(entry)||1,amount:''};
      var unit = sotGetUnit(it&&it.desc);
      var qtyStr = unit ? ((entry.amount||'?')+' '+unit) : ('x'+entry.qty);
      if (it) lines.push('  ['+qtyStr+']  '+it.name+(it.desc?' ('+it.desc+')':'')+' | '+id);
    });
    lines.push('');
  });
  var notesVal = (document.getElementById('sotNotes')||{}).value||'';
  if (notesVal.trim()) { lines.push('NOTES'); lines.push(notesVal); }
  var w = window.open('', '_blank');
  w.document.write('<pre style="font-family:monospace;font-size:13px;padding:24px;white-space:pre-wrap">' + lines.join('\n') + '</pre>');
  w.document.close();
  w.print();
}

function sotCopy() {
  var ids = Object.keys(sotOrder);
  if (!ids.length) { alert('No items in the order yet.'); return; }
  var lines = ['STONES THROW STUDIO — SUPPLY ORDER', 'Week of ' + sotWeekRange(), ''];
  sotAllSuppliers().forEach(function(sup){
    var supIds = ids.filter(function(id){ var it = sotGetItem(id); return it && it.sup===sup.id; });
    if (!supIds.length) return;
    lines.push('== ' + sup.name.toUpperCase() + ' ==');
    supIds.forEach(function(id){
      var it = sotGetItem(id);
      var entry = sotOrder[id]||{qty:1,amount:''};
      if (typeof entry !== 'object') entry = {qty:Number(entry)||1,amount:''};
      var unit = sotGetUnit(it&&it.desc);
      var qtyStr = unit ? ((entry.amount||'?')+' '+unit) : ('x'+entry.qty);
      if (it) lines.push('  ['+qtyStr+']  '+it.name+(it.desc?' ('+it.desc+')':'')+' | '+id);
    });
    lines.push('');
  });
  var notesVal = (document.getElementById('sotNotes')||{}).value||'';
  if (notesVal.trim()) { lines.push('NOTES'); lines.push(notesVal); }
  navigator.clipboard.writeText(lines.join('\n')).then(function(){
    toast('Order copied to clipboard ✓', '📋');
  }).catch(function(){ alert(lines.join('\n')); });
}

// ── Initialization ────────────────────────────────────────────
function sotInit() {
  sotLoad();
  sotRenderCatalog();
  sotRenderOrder();
  var notesEl = document.getElementById('sotNotes');
  if (notesEl) notesEl.value = sotNotesTxt;
  sotLoadNotion();
}
