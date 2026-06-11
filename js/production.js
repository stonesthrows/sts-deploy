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
  { key: '__cancelled__',             label: 'Cancelled',                 icon: '🚫', color: '#C04848' },
];

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
  document.querySelectorAll('.prod-col-body').forEach(function(b) {
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

function prodDrop(ev, colKey) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('prod-drag-over');
  if (!prodDraggedId) return;
  var o = ORDERS.find(function(x){ return x.id === prodDraggedId; });
  if (!o) { prodDraggedId = null; return; }

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
  prodDraggedId = null;
  renderProduction();
  toast(o.name + ' moved to ' + (colKey === '__ship__' ? 'To be Shipped' : colKey === '__limbo__' ? 'In Limbo' : colKey), '📍');
}

// ── Render ────────────────────────────────────────────────────

function renderProduction() {
  var grid = document.getElementById('prodGrid');
  if (!grid) return;

  var readyOrders = ORDERS.filter(function(o) {
    return o.stage === 'ready-pick' || o.stage === 'ship-out' || o.stage === 'cancelled';
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
          + ' ondragover="prodDragOver(event)"'
          + ' ondragleave="prodDragLeave(event)"'
          + ' ondrop="prodDrop(event,\'' + col.key + '\')">';

    if (!colOrders.length) {
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
    return o.stage === 'delivered' || o.stage === 'complete' || o.stage === 'cancelled';
  });

  html += '<div class="prod-archive">';
  html += '<div class="prod-archive-title">📁 Order Archive</div>';

  var ARCHIVE_YEARS = [2026, 2025, 2024];

  ARCHIVE_YEARS.forEach(function(year) {
    var yearStr = String(year);
    var yearKey = 'year-' + yearStr;
    var yearOpen = !!prodOpenMonths[yearKey];

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
        var mOpen    = !!prodOpenMonths[mk];
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
            var cOpen = !!prodOpenMonths[ck];
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
            var xOpen = !!prodOpenMonths[xk];
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
    html = '<div class="prod-empty">No orders yet.</div>';
  }

  grid.innerHTML = html;
}

function prodOrderCardHTML(o, showDeliverBtn) {
  var dl = deadlineInfo(o.deadline);
  var deliveredLine = (o.deliveredAt || o.completedAt)
    ? '<div class="prod-delivered-on">Delivered ' + fmtDate(o.deliveredAt || o.completedAt) + '</div>'
    : '';
  var html = '<div class="prod-order-card"'
           + ' id="prod-card-' + o.id + '"'
           + ' draggable="true"'
           + ' ondragstart="prodDragStart(event,\'' + o.id + '\')"'
           + ' ondragend="prodDragEnd(event)"'
           + ' onclick="openOrderCard(\'' + o.id + '\')">';
  html += '<div class="prod-card-drag-handle" title="Drag to move">⠿</div>';
  html += '<div class="prod-order-name">' + o.name + '</div>';
  html += '<div class="prod-order-desc">' + o.desc + '</div>';
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
    html += '<a class="prod-pdf-btn" href="' + o.pdfUrl + '" target="_blank" onclick="event.stopPropagation()">📄 View PDF</a>';
  }
  if (showDeliverBtn && o.stage !== 'cancelled') {
    html += '<button class="prod-delivered-btn" onclick="event.stopPropagation();prodMarkDelivered(\'' + o.id + '\')">✓ Picked Up / Delivered</button>';
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
  renderProduction();
}

function prodMarkDelivered(id) {
  var o = ORDERS.find(function(x){ return x.id === id; });
  if (!o) return;
  var dateStr = new Date().toISOString().slice(0, 10);
  o.stage = 'delivered';
  o.deliveredAt = dateStr;
  prodOpenMonths[dateStr.slice(0, 7)] = true;
  saveToStorage();
  if (typeof notionUpdateStage === 'function') notionUpdateStage(o.notionId, 'delivered');
  renderProduction();
  toast(o.name + ' marked as delivered ✓', '✓');
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
  {id:'st_170890',sup:'stuller',cat:'Bench Tools & Supplies',name:'Radiant Glow™ Treated Polishing Cloths, 4x4"',desc:'Per pack (SKU: 17-0890)'}
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

// ── Helpers ──────────────────────────────────────────────────
function sotUid() {
  return Math.random().toString(36).slice(2,10) + Date.now().toString(36);
}
function sotEsc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
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
function sotSave() {
  try {
    localStorage.setItem('sot_order_v1', JSON.stringify({order: sotOrder}));
    localStorage.setItem('sot_custom_v1', JSON.stringify({
      custom: sotCustom,
      suppliers: sotCustomSuppliers
    }));
  } catch(e) {}
  sotScheduleNotionSave();
}
function sotLoad() {
  try {
    var raw = localStorage.getItem('sot_order_v1')
           || localStorage.getItem('supplier_tracker_v5')
           || localStorage.getItem('supplier_tracker_v4')
           || localStorage.getItem('supplier_tracker_v3');
    if (raw) { var d = JSON.parse(raw); sotOrder = d.order || {}; }
    var rawC = localStorage.getItem('sot_custom_v1');
    if (rawC) {
      var dc = JSON.parse(rawC);
      sotCustom = dc.custom || [];
      sotCustomSuppliers = dc.suppliers || [];
    }
    var rawN = localStorage.getItem('sot_notes_v1');
    if (rawN) sotNotesTxt = rawN;
  } catch(e) {}
}
function sotSaveNotes() {
  sotNotesTxt = (document.getElementById('sotNotes')||{}).value || '';
  try { localStorage.setItem('sot_notes_v1', sotNotesTxt); } catch(e) {}
  sotScheduleNotionSave();
}

// ── Notion auto-save ─────────────────────────────────────────
function sotSetSyncStatus(state) {
  var el = document.getElementById('sotSyncStatus');
  if (!el) return;
  if (state === 'saving') { el.textContent = '☁ Saving…'; el.style.color = 'var(--text3)'; }
  else if (state === 'saved') { el.textContent = '☁ Saved'; el.style.color = '#5a9a5a'; }
  else if (state === 'error') { el.textContent = '☁ Sync error'; el.style.color = '#c44'; }
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

async function sotLoadNotion() {
  try {
    var r = await fetch('/api/notion-sot');
    var d = await r.json();
    if (!d.found) return;
    sotNotionPageId = d.notionPageId;
    var remoteOrder = JSON.parse(d.items || '{}');
    var remoteNotes = d.notes || '';
    // Only overwrite local if remote has more items
    if (Object.keys(remoteOrder).length >= Object.keys(sotOrder).length) {
      sotOrder = remoteOrder;
      if (remoteNotes) {
        sotNotesTxt = remoteNotes;
        var el = document.getElementById('sotNotes');
        if (el) el.value = remoteNotes;
      }
      sotSave();
      sotRenderCatalog();
      sotRenderOrder();
    }
  } catch(e) {}
}

// ── Data helpers ─────────────────────────────────────────────
function sotAllItems() { return CATALOG.concat(sotCustom); }
function sotGetItem(id) {
  return sotAllItems().filter(function(i){return i.id===id;})[0] || null;
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
        html += '<div class="sot-item" id="sot-item-' + sotEsc(item.id) + '">';
        html += '<input class="sot-item-cb" type="checkbox"'
              + (chk ? ' checked' : '')
              + ' onchange="sotToggleItem(\'' + sotEsc(item.id) + '\',this.checked)">';
        html += '<div class="sot-item-info">';
        html += '<div class="sot-item-name">' + sotEsc(item.name) + '</div>';
        if (item.desc) html += '<div class="sot-item-desc">' + sotEsc(item.desc) + '</div>';
        html += '<span class="sot-item-sku">' + sotEsc(item.id) + '</span>';
        html += '</div>';
        if (isCust) {
          html += '<div class="sot-item-actions">';
          html += '<button class="sot-item-btn" onclick="sotEditOpen(\'' + sotEsc(item.id) + '\')">Edit</button>';
          html += '<button class="sot-item-btn del" onclick="sotDeleteItem(\'' + sotEsc(item.id) + '\')">Del</button>';
          html += '</div>';
        }
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
        var qty = sotOrder[id] || 1;
        html += '<div class="sot-ord-item">';
        html += '<div class="sot-ord-item-info">';
        if (it.sku) html += '<div class="sot-ord-item-sku">' + sotEsc(it.sku) + '</div>';
        html += '<div class="sot-ord-item-name">' + sotEsc(it.name) + '</div>';
        html += '</div>';
        html += '<div class="sot-qty-wrap">';
        html += '<button class="sot-qty-btn" onclick="sotQty(\'' + sotEsc(id) + '\',-1)">&#8722;</button>';
        html += '<span class="sot-qty-val" id="sotq-' + sotEsc(id) + '">' + qty + '</span>';
        html += '<button class="sot-qty-btn" onclick="sotQty(\'' + sotEsc(id) + '\',1)">+</button>';
        html += '</div>';
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
  if (checked) { if (sotOrder[id]===undefined) sotOrder[id]=1; }
  else { delete sotOrder[id]; }
  sotSave(); sotRenderOrder();
  var badge = document.getElementById('sotOrderBadge');
  if (badge) badge.textContent = Object.keys(sotOrder).length;
}
function sotQty(id, delta) {
  var q = ((sotOrder[id]||1) + delta);
  if (q < 1) q = 1;
  sotOrder[id] = q;
  var el = document.getElementById('sotq-'+id);
  if (el) el.textContent = q;
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
  var item = sotCustom.filter(function(i){return i.id===id;})[0];
  if (!item) return;
  sotEditId = id;
  var el;
  el = document.getElementById('sotEditName'); if(el) el.value = item.name||'';
  el = document.getElementById('sotEditDesc'); if(el) el.value = item.desc||'';
  el = document.getElementById('sotEditSku');  if(el) el.value = item.id||'';
  el = document.getElementById('sotEditCat');  if(el) el.value = item.cat||'';
  document.getElementById('sotModalBg').classList.add('open');
}
function sotEditSave() {
  var item = sotCustom.filter(function(i){return i.id===sotEditId;})[0];
  if (!item) return;
  var el;
  el = document.getElementById('sotEditName'); if(el) item.name = el.value.trim();
  el = document.getElementById('sotEditDesc'); if(el) item.desc = el.value.trim();
  el = document.getElementById('sotEditCat');  if(el) item.cat  = el.value;
  sotSave();
  sotModalBgClose();
  sotRenderCatalog();
  sotRenderOrder();
}
function sotDeleteItem(id) {
  if (!confirm('Remove this item from your catalog?')) return;
  sotCustom = sotCustom.filter(function(i){return i.id!==id;});
  delete sotOrder[id];
  sotSave();
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
      var qty = sotOrder[id]||1;
      if (it) lines.push('  ['+qty+']  '+it.name+(it.desc?' ('+it.desc+')':'')+' | '+id);
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
      var it = sotGetItem(id); var qty = sotOrder[id]||1;
      if (it) lines.push('  ['+qty+']  '+it.name+(it.desc?' ('+it.desc+')':'')+' | '+id);
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
