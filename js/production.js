// ════════════════════════════════════════════
//  PRODUCTION  —  pages/production.js
//  Production overview tab + Supplier Order Tracker (SOT)
// ════════════════════════════════════════════

function renderProduction() {
  var grid = document.getElementById('prodGrid');
  if (!grid) return;

  var buildStages = ['build','ready-pick','order-mat','materials'];
  var activeOrders = ORDERS.filter(function(o) {
    return buildStages.includes(o.stage);
  });

  if (!activeOrders.length) {
    grid.innerHTML = '<div class="prod-placeholder" style="grid-column:1/-1">No orders currently in production.</div>';
    return;
  }

  var stageLabels = {
    'order-mat':   'Order Materials',
    'materials':   'Waiting on Materials',
    'build':       'At the Bench',
    'ready-pick':  'Ready for Pickup'
  };
  var stageColors = {
    'order-mat':  '#A86028',
    'materials':  '#9050CC',
    'build':      '#2A68B8',
    'ready-pick': '#1E84A8'
  };

  var html = '';
  buildStages.forEach(function(stage) {
    var stageOrders = activeOrders.filter(function(o){ return o.stage === stage; });
    if (!stageOrders.length) return;
    html += '<div class="prod-card">';
    html += '<div class="prod-card-head" style="border-left:3px solid ' + (stageColors[stage]||'#999') + '">'
          + stageLabels[stage] + ' <span style="font-weight:400;color:#9A8860;margin-left:6px">(' + stageOrders.length + ')</span></div>';
    html += '<div class="prod-card-body">';
    stageOrders.forEach(function(o) {
      var dl = deadlineInfo(o.deadline);
      html += '<div style="padding:9px 0;border-bottom:1px solid #F4EFE8;display:flex;justify-content:space-between;align-items:flex-start">';
      html += '<div>'
            + '<div style="font-size:13px;font-weight:700;color:var(--text)">' + o.name + '</div>'
            + '<div style="font-size:11.5px;color:#6A6460;margin-top:2px">' + o.desc + '</div>'
            + '</div>';
      html += '<div style="text-align:right;flex-shrink:0;margin-left:12px">'
            + '<span class="o-tag ' + dl.cls + '">' + dl.text + '</span>'
            + (o.price ? '<div style="font-size:11px;color:#9A8860;margin-top:3px">$' + o.price.toLocaleString() + '</div>' : '')
            + '</div>';
      html += '</div>';
    });
    html += '</div></div>';
  });

  grid.innerHTML = html || '<div class="prod-placeholder" style="grid-column:1/-1">No active production orders.</div>';
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
}
