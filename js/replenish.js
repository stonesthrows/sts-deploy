// ════════════════════════════════════════════
//  ASSORTMENT ENGINE  —  js/replenish.js
//  (tab id stays 'replenish' — the label is what changed. Renaming the id
//   would mean touching NAV_GROUPS, the tab hook, the panel id and every
//   user's persisted sts-nav-sub-inventory value for no visible gain.)
//
//  Phase 6 of the costing/inventory build (the capstone), now sales-driven.
//  One page that answers BOTH halves of the assortment question: what's
//  selling and needs building, AND what has stopped selling and should be
//  retired. The second half is why the page reads the Square catalog and
//  not just the sales feed — a piece that never sells never appears in
//  sales data, so it is invisible to any sales-driven list by construction.
//
//  What's low / what to build (the original engine, unchanged below):
//    · Weekend market sales (Sat 00:00 → Mon 00:00, COMPLETED orders at
//      the market location) are pulled from Square and stored server-side
//      via /api/weekend-sales so every device sees the same numbers.
//      Opening the page syncs any missing/partial weekends.
//    · Velocity = recency-weighted avg units/weekend over the last
//      RP_LOOKBACK_WEEKENDS *final* weekends with sales (zero-sale
//      weekends — skipped markets — are excluded). Sizes are pooled to
//      the parent Square item, since designs restock as a design and the
//      size mix is decided at the bench.
//    · Suggested par = ceil(velocity × RP_COVER_WEEKENDS). It only ever
//      SUGGESTS — the manual par stays authoritative; one click accepts.
//    · On-hand counts come live from Square on page open, pooled across
//      all variations (sizes) of each design's parent item.
//    · Top sellers with no linked design are flagged, not hidden — the
//      best sellers are exactly what must not fall through the cracks.
//    · Buildable = min over BOM lines of (material stock / per-piece
//      consumption incl. waste). No BOM → threshold row + "weigh me".
//    · Shortfalls aggregate into a supplier-grouped shopping list that
//      feeds the Receive Shipment loop.
//    · "→ Queue" creates a Restock Queue card (Notion note, block
//      'Inventory Restock') pre-linked to the design's Square item, so
//      the timers and Phase 5 close-out complete the loop.
//  What's dead / what to sunset (the Assortment half):
//    · The item universe is the whole Square catalog under the app's
//      Inventory categories, not just design-linked items — see
//      _rpLoadUniverse. Services, shipping, gift cards and .Discontinued
//      categories are excluded using bestsellers.js's own skip regexes.
//    · Every item gets a state: restock / healthy / overstocked / fading /
//      sunset / never. See _rpClassify for the exact ladder.
//    · "Sunsetting" writes replenishmentActive:false on the linked design,
//      which is the existing flag _rpComputeQueue already honours — so a
//      sunset piece drops out of the restock queue with no new plumbing.
//  Known limit: a size/variation added in Square after a design's item
//  was first resolved shows up on the next page open (design links are
//  re-resolved every load); sales history itself is never re-fetched.
//  Loaded ONLY by jewelry-workflow.html, after inventory.js (needs
//  INV_LOCATION_ID and the INV_*_CAT_IDS maps) — uses toast() from app.js.
//  js/assort-chat.js loads after this file and reads _rpRows.
// ════════════════════════════════════════════

var RP_LOOKBACK_WEEKENDS = 8; // velocity window
var RP_COVER_WEEKENDS    = 2; // suggested par = velocity × this
var RP_TOP_SELLERS       = 10;

// ── Assortment thresholds ──────────────────────
var AS_TRUE_WINDOW    = 12; // weekends of market history behind velTrue/cover
var AS_STALE_WEEKENDS = 8;  // no sale in N market weekends → sunset candidate
var AS_FADE_WEEKENDS  = 4;  // no sale in N market weekends → fading
var AS_COVER_MIN      = 2;  // fewer than N weekends of cover → restock
var AS_COVER_MAX      = 6;  // more than N weekends of cover, still selling → overstocked
var AS_TREND_WINDOW   = 4;  // recent N active weekends vs the N before them
// Cost fallback when a design has no BOM to price: assume material runs
// this fraction of retail. Rows priced this way are flagged est:true and
// rendered with a ~ so the capital totals never pretend to be measured.
var AS_COST_RATIO     = 0.35;

var _rpDesigns   = null; // designs index
var _rpMaterials = null; // materials library
var _rpSettings  = null; // shop settings (waste defaults)
var _rpSales     = null; // /api/weekend-sales blob { weekends, varMap }
var _rpOnHand    = {};   // squareVariationId -> on-hand count
var _rpItemVars  = {};   // squareItemId (parent) -> [variationIds]
var _rpItemNames = {};   // squareItemId (parent) -> item name
var _rpVelocity  = {};   // squareItemId (parent) -> weighted units/weekend
var _rpVelWeekends = 0;  // how many weekends fed the velocity math
var _rpLoading   = false;
var _rpQueued    = {};   // designId -> true, added to production queue this visit

// ── Assortment state ───────────────────────────
var _rpCatalog   = {};   // squareItemId -> { id, name, category, varIds, price }
var _rpRows      = [];   // computed assortment rows — the table AND the chat read this
var _rpActiveKeys = [];  // Saturday keys of final weekends the market actually ran
var _rpFilter    = 'all';    // active state chip
var _rpCatFilter = 'all';    // active category filter
var _rpSort      = { col: 'tied', dir: 'desc' };

// The six states an item can be in, in classifier order. Labels and the
// colour family are declared once here so the chips, the pills and the
// chat briefing can never drift apart.
var AS_STATES = [
  { key: 'restock',     label: 'Restock',     tone: 'danger' },
  { key: 'healthy',     label: 'Healthy',     tone: 'ok'     },
  { key: 'overstocked', label: 'Overstocked', tone: 'info'   },
  { key: 'fading',      label: 'Fading',      tone: 'warn'   },
  { key: 'sunset',      label: 'Sunset',      tone: 'mute'   },
  { key: 'never',       label: 'Never sold',  tone: 'danger' },
];

function _rpEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function replenishInit() {
  if (typeof acRenderPanel === 'function') acRenderPanel();
  rpRender(true);
}

// ── Square proxy helper ────────────────────────
function _rpSq(path, body) {
  return fetch('/api/square', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path, method: 'POST', body: body }),
  }).then(function(r) {
    return r.json().then(function(json) {
      if (!r.ok) throw new Error((json.errors && json.errors[0] && json.errors[0].detail) || 'Square error');
      return json;
    });
  });
}

function _rpStatus(msg) {
  var note = document.getElementById('rp-note');
  if (note) note.textContent = msg;
}

// ── Data loading ───────────────────────────────
function _rpLoadAll() {
  var pDesigns = fetch('/api/designs').then(function(r){ return r.json(); })
    .then(function(d){ _rpDesigns = Array.isArray(d) ? d : []; })
    .catch(function(){ if (_rpDesigns === null) _rpDesigns = []; });
  var pMats = fetch('/api/materials').then(function(r){ return r.json(); })
    .then(function(m){ _rpMaterials = Array.isArray(m) ? m : []; })
    .catch(function(){ if (_rpMaterials === null) _rpMaterials = []; });
  var pSet = _rpSettings !== null ? Promise.resolve()
    : fetch('/api/shop-settings').then(function(r){ return r.json(); })
        .then(function(s){ _rpSettings = (s && !s.error) ? s : {}; })
        .catch(function(){ _rpSettings = {}; });
  var pSales = fetch('/api/weekend-sales').then(function(r){ return r.json(); })
    .then(function(s){ _rpSales = (s && !s.error) ? s : { weekends: {}, varMap: {} }; })
    .catch(function(){ if (_rpSales === null) _rpSales = { weekends: {}, varMap: {} }; });
  return Promise.all([pDesigns, pMats, pSet, pSales])
    .then(_rpSyncSales)
    .then(_rpResolveDesignItems)
    .then(function() { _rpComputeVelocity(); return _rpLoadOnHand(); })
    .then(_rpLoadUniverse);
}

// ── The item universe (catalog-side, not sales-side) ──
// Everything above this point is driven by what SOLD. A piece that has
// never sold produces no sales record, so it can only be found from the
// catalog. This walks every Square category the Inventory tab knows about
// and pulls the items plus their on-hand counts.
//
// Reads INV_*_CAT_IDS from js/inventory.js. Those are `const`s in another
// script; bestsellers.js's skip regexes load AFTER this file, so both are
// read inside function bodies and typeof-guarded rather than at parse time.
function _rpCatFamilies() {
  var fams = [];
  var add = function(label, map) {
    if (!map) return;
    var ids = [];
    Object.keys(map).forEach(function(k) {
      (map[k] || []).forEach(function(id){ if (ids.indexOf(id) < 0) ids.push(id); });
    });
    if (ids.length) fams.push({ label: label, ids: ids });
  };
  add('Rings',             typeof INV_RING_CAT_IDS       !== 'undefined' ? INV_RING_CAT_IDS       : null);
  add('Meditation Rings',  typeof INV_MEDITATION_CAT_IDS !== 'undefined' ? INV_MEDITATION_CAT_IDS : null);
  add('Pendants',          typeof INV_PENDANT_CAT_IDS    !== 'undefined' ? INV_PENDANT_CAT_IDS    : null);
  add('Permanent Jewelry', typeof INV_PERM_CAT_IDS       !== 'undefined' ? INV_PERM_CAT_IDS       : null);
  add('Faux Nose Rings',   typeof INV_NOSERING_CAT_IDS   !== 'undefined' ? INV_NOSERING_CAT_IDS   : null);
  add('Earrings',          typeof INV_CAT_IDS            !== 'undefined' ? INV_CAT_IDS            : null);
  return fams;
}

// Non-stock lines (services, shipping, gift cards, retired categories)
// would otherwise show as "never sold, N on hand" forever. Reuse
// bestsellers.js's regexes so both pages skip exactly the same things;
// fall back to local copies if that file hasn't parsed yet.
function _rpSkipName(name) {
  var whole = typeof BS_SKIP_NAME_RE !== 'undefined' ? BS_SKIP_NAME_RE
    : /^(repair|resize|sizing|shipping|deposit|gift ?card|custom order|upgrade to .*chain)$/i;
  var any = typeof BS_SKIP_NAME_ANY_RE !== 'undefined' ? BS_SKIP_NAME_ANY_RE
    : /\b(shipping|postage|re-?siz(e|ed|ing)|gift ?card|deposit)\b/i;
  var n = String(name || '').trim();
  return !n || whole.test(n) || any.test(n);
}

// Square moved item→category from a scalar to a list; handle both shapes.
function _rpItemCatIds(itemData) {
  var out = [];
  if (itemData.category_id) out.push(itemData.category_id);
  (itemData.categories || []).forEach(function(c){ if (c && c.id) out.push(c.id); });
  if (itemData.reporting_category && itemData.reporting_category.id) out.push(itemData.reporting_category.id);
  return out;
}

async function _rpLoadUniverse() {
  var fams = _rpCatFamilies();
  var catOf = {}, allIds = [];
  fams.forEach(function(f) {
    f.ids.forEach(function(id){ catOf[id] = f.label; if (allIds.indexOf(id) < 0) allIds.push(id); });
  });
  if (!allIds.length) return; // no categories configured — table falls back to linked designs only

  _rpStatus('Reading the Square catalog…');
  _rpCatalog = {};
  var newVarIds = [], cursor = null, guard = 0;
  do {
    var body = { category_ids: allIds, limit: 100 };
    if (cursor) body.cursor = cursor;
    var json;
    try { json = await _rpSq('/v2/catalog/search-catalog-items', body); }
    catch (e) { break; } // partial universe still renders; retried next open
    (json.items || []).forEach(function(it) {
      var d = it.item_data || {};
      if (d.is_archived) return;
      if (d.product_type && d.product_type !== 'REGULAR') return; // gift cards, appointments
      if (_rpSkipName(d.name)) return;
      var cats = _rpItemCatIds(d);
      var fam = null;
      for (var i = 0; i < cats.length && !fam; i++) fam = catOf[cats[i]] || null;
      if (!fam) return; // matched the search but not one of our families

      var vars = (d.variations || []);
      var price = null;
      vars.forEach(function(v) {
        var vd = v.item_variation_data || {};
        if (price == null && vd.price_money && vd.price_money.amount) price = vd.price_money.amount / 100;
      });
      var varIds = vars.map(function(v){ return v.id; });
      _rpCatalog[it.id] = { id: it.id, name: d.name || '', category: fam, varIds: varIds, price: price };
      // Keep the shared item maps in step so on-hand pooling works the
      // same way for catalog-only items as it does for linked designs.
      if (!_rpItemNames[it.id]) _rpItemNames[it.id] = d.name || '';
      _rpItemVars[it.id] = varIds;
      varIds.forEach(function(v){ if (_rpOnHand[v] == null) newVarIds.push(v); });
    });
    cursor = json.cursor || null;
  } while (cursor && ++guard < 100);

  if (!newVarIds.length) return;
  _rpStatus('Counting stock on hand…');
  // Square caps batch-retrieve at 100 ids per call
  var batches = [];
  for (var j = 0; j < newVarIds.length; j += 100) batches.push(newVarIds.slice(j, j + 100));
  await Promise.all(batches.map(function(batch) {
    return _rpSq('/v2/inventory/counts/batch-retrieve', {
      catalog_object_ids: batch, location_ids: [INV_LOCATION_ID],
    }).then(function(data) {
      (data.counts || []).forEach(function(c) {
        // Square reports negatives for pieces sold but never received.
        // Left unfloored, a -19 reads as "you are 19 in the hole" and
        // invents restock work that doesn't exist.
        _rpOnHand[c.catalog_object_id] = Math.max(parseInt(c.quantity, 10) || 0, 0);
      });
    }).catch(function(){});
  }));
}

// ── Weekend date helpers ───────────────────────
function _rpDateKey(d) {
  var p = function(n){ return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Last n Saturdays (most recent first) as YYYY-MM-DD keys
function _rpSatKeys(n) {
  var d = new Date();
  var day = d.getDay(); // 0=Sun…6=Sat
  d.setDate(d.getDate() - (day === 6 ? 0 : day + 1));
  d.setHours(0, 0, 0, 0);
  var keys = [];
  for (var i = 0; i < n; i++) {
    keys.push(_rpDateKey(d));
    d.setDate(d.getDate() - 7);
  }
  return keys;
}

function _rpWeekendLabel(satKey) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var sat = new Date(satKey + 'T00:00:00');
  var sun = new Date(sat); sun.setDate(sun.getDate() + 1);
  return months[sat.getMonth()] + ' ' + sat.getDate() + '-'
    + (sun.getMonth() !== sat.getMonth() ? months[sun.getMonth()] + ' ' : '') + sun.getDate();
}

// ── Weekend sales sync (Square → server store) ─
// One weekend's COMPLETED orders at the market location, aggregated per
// catalog variation id. Custom-amount lines (no catalog id) are tallied
// separately so undercounting is visible instead of silent.
async function _rpFetchWeekendOrders(satKey) {
  var start = new Date(satKey + 'T00:00:00');
  var end = new Date(start); end.setDate(end.getDate() + 2);
  var byVar = {}, uncatalogued = 0, cursor = null;
  do {
    var body = {
      location_ids: [INV_LOCATION_ID],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: start.toISOString(), end_at: end.toISOString() } },
          state_filter: { states: ['COMPLETED'] },
        },
        sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' },
      },
      limit: 500,
    };
    if (cursor) body.cursor = cursor;
    var json = await _rpSq('/v2/orders/search', body);
    (json.orders || []).forEach(function(order) {
      (order.line_items || []).forEach(function(li) {
        var qty = parseFloat(li.quantity || '1') || 0;
        var rev = (li.total_money && li.total_money.amount) ? li.total_money.amount / 100 : 0;
        if (!li.catalog_object_id) { uncatalogued += qty; return; }
        var e = byVar[li.catalog_object_id] = byVar[li.catalog_object_id] || { qty: 0, revenue: 0, name: li.name || '' };
        e.qty += qty; e.revenue += rev;
      });
    });
    cursor = json.cursor || null;
  } while (cursor);
  return { byVar: byVar, uncatalogued: uncatalogued };
}

// Batch-resolve variation ids → parent item (fills varMap patch, and
// _rpItemVars/_rpItemNames from the related ITEM objects, which carry the
// item's full variation list).
async function _rpResolveVarIds(varIds) {
  var patch = {};
  for (var i = 0; i < varIds.length; i += 500) {
    var batch = varIds.slice(i, i + 500);
    try {
      var json = await _rpSq('/v2/catalog/batch-retrieve', { object_ids: batch, include_related_objects: true });
      var items = {};
      (json.related_objects || []).concat(json.objects || []).forEach(function(o) {
        if (o.type === 'ITEM') items[o.id] = o;
      });
      Object.keys(items).forEach(function(itemId) {
        var it = items[itemId];
        _rpItemNames[itemId] = (it.item_data && it.item_data.name) || _rpItemNames[itemId] || '';
        _rpItemVars[itemId] = ((it.item_data && it.item_data.variations) || []).map(function(v){ return v.id; });
      });
      (json.objects || []).forEach(function(o) {
        if (o.type !== 'ITEM_VARIATION') return;
        var itemId = (o.item_variation_data && o.item_variation_data.item_id) || null;
        if (!itemId) return;
        patch[o.id] = { itemId: itemId, itemName: _rpItemNames[itemId] || '' };
      });
    } catch (e) { /* unresolved ids fall back to variation-level below */ }
  }
  return patch;
}

// Pull any missing or still-partial weekends from Square, roll variation
// sales up to the parent item, and persist to the shared store.
async function _rpSyncSales() {
  if (!_rpSales) _rpSales = { weekends: {}, varMap: {} };
  var keys = _rpSatKeys(RP_LOOKBACK_WEEKENDS);
  var toFetch = keys.filter(function(k) {
    var e = _rpSales.weekends[k];
    return !e || e.final !== true; // partial weekends get re-pulled until final
  });
  if (!toFetch.length) return;

  var fetched = {}; // satKey -> {byVar, uncatalogued}
  for (var i = 0; i < toFetch.length; i++) {
    var k = toFetch[i];
    _rpStatus('Pulling weekend sales ' + _rpWeekendLabel(k) + '… (' + (i + 1) + '/' + toFetch.length + ')');
    try { fetched[k] = await _rpFetchWeekendOrders(k); }
    catch (e) { /* leave missing — retried next page open */ }
  }

  // Resolve any variation ids the shared varMap doesn't know yet
  var varMap = _rpSales.varMap || {};
  var unknown = {};
  Object.keys(fetched).forEach(function(k) {
    Object.keys(fetched[k].byVar).forEach(function(v){ if (!varMap[v]) unknown[v] = true; });
  });
  var varPatch = {};
  var unknownIds = Object.keys(unknown);
  if (unknownIds.length) {
    _rpStatus('Matching sold items to the Square catalog…');
    varPatch = await _rpResolveVarIds(unknownIds);
    Object.keys(varPatch).forEach(function(v){ varMap[v] = varPatch[v]; });
  }

  // Roll each fetched weekend up to parent items and stage the store patch
  var now = new Date();
  var weekendPatch = {};
  Object.keys(fetched).forEach(function(k) {
    var end = new Date(k + 'T00:00:00'); end.setDate(end.getDate() + 2);
    var items = {};
    var byVar = fetched[k].byVar;
    Object.keys(byVar).forEach(function(v) {
      // Deleted/unresolvable catalog objects keep the variation id as the
      // key so their sales still count somewhere visible
      var itemId = varMap[v] ? varMap[v].itemId : v;
      var name   = varMap[v] ? varMap[v].itemName : byVar[v].name;
      var e = items[itemId] = items[itemId] || { name: name, qty: 0, revenue: 0 };
      e.qty += byVar[v].qty;
      e.revenue += Math.round(byVar[v].revenue * 100) / 100;
    });
    weekendPatch[k] = {
      label: _rpWeekendLabel(k),
      syncedAt: now.toISOString(),
      final: now >= end,
      items: items,
      uncatalogued: fetched[k].uncatalogued,
    };
    _rpSales.weekends[k] = weekendPatch[k];
  });

  if (Object.keys(weekendPatch).length || Object.keys(varPatch).length) {
    await fetch('/api/weekend-sales', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekends: weekendPatch, varMap: varPatch }),
    }).catch(function(){}); // store miss = re-sync next open, page still renders
  }
}

// Re-resolve every linked design's variation → parent item each load, so
// _rpItemVars stays fresh (new sizes added in Square get picked up).
function _rpResolveDesignItems() {
  var varMap = (_rpSales && _rpSales.varMap) || {};
  var ids = (_rpDesigns || [])
    .filter(function(d){ return d.squareItemId; })
    .map(function(d){ return d.squareItemId; });
  if (!ids.length) return Promise.resolve();
  return _rpResolveVarIds(ids).then(function(patch) {
    var newEntries = {};
    Object.keys(patch).forEach(function(v) {
      if (!varMap[v]) newEntries[v] = patch[v];
      varMap[v] = patch[v];
    });
    if (_rpSales) _rpSales.varMap = varMap;
    if (Object.keys(newEntries).length) {
      fetch('/api/weekend-sales', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ varMap: newEntries }),
      }).catch(function(){});
    }
  });
}

// ── Velocity (recency-weighted units/weekend) ──
function _rpComputeVelocity() {
  _rpVelocity = {};
  _rpVelWeekends = 0;
  var weekends = (_rpSales && _rpSales.weekends) || {};
  var keys = Object.keys(weekends).sort().reverse(); // most recent first
  var used = [];
  for (var i = 0; i < keys.length && used.length < RP_LOOKBACK_WEEKENDS; i++) {
    var e = weekends[keys[i]];
    if (!e || e.final !== true) continue; // in-progress weekend would skew low
    var sold = (e.uncatalogued || 0) > 0;
    if (!sold) {
      var its = e.items || {};
      sold = Object.keys(its).some(function(id){ return its[id].qty > 0; });
    }
    if (!sold) continue; // zero-sale weekend = market skipped, not demand
    used.push(e);
  }
  if (!used.length) return;

  var n = used.length, wSum = 0, acc = {};
  used.forEach(function(e, idx) {
    var weight = n - idx; // most recent = n … oldest = 1
    wSum += weight;
    var its = e.items || {};
    Object.keys(its).forEach(function(itemId) {
      acc[itemId] = (acc[itemId] || 0) + its[itemId].qty * weight;
      if (!_rpItemNames[itemId]) _rpItemNames[itemId] = its[itemId].name || '';
    });
  });
  Object.keys(acc).forEach(function(itemId){ _rpVelocity[itemId] = acc[itemId] / wSum; });
  _rpVelWeekends = n;
}

// ── Design ↔ Square item helpers ───────────────
function _rpDesignItemId(d) {
  var m = _rpSales && _rpSales.varMap && _rpSales.varMap[d.squareItemId];
  return m ? m.itemId : null;
}

// Pooled on-hand across every size/variation of the design's parent item;
// falls back to just the linked variation if the parent never resolved.
function _rpDesignOnHand(d) {
  var itemId = _rpDesignItemId(d);
  var vars = (itemId && _rpItemVars[itemId]) || [d.squareItemId];
  var sum = 0, any = false;
  vars.forEach(function(v) {
    if (_rpOnHand[v] != null) { sum += _rpOnHand[v]; any = true; }
  });
  return any ? sum : null;
}

function _rpDesignVelocity(d) {
  var itemId = _rpDesignItemId(d);
  return (itemId && _rpVelocity[itemId]) || 0;
}

function _rpSuggestedPar(d) {
  var v = _rpDesignVelocity(d);
  return v > 0 ? Math.ceil(v * RP_COVER_WEEKENDS) : null;
}

function _rpVelTxt(v) {
  return v > 0 ? (Math.round(v * 10) / 10) + '/wk' : '—';
}

// ══ Assortment metrics ═════════════════════════
//
// ⚠ There are deliberately TWO velocities in this file, and conflating
// them is the easiest way to break this page.
//
//   _rpVelocity  (above)  — recency-weighted, and it SKIPS zero-sale
//     weekends, because a skipped market is not zero demand. Right for
//     "how many should I build", which is all it has ever driven.
//
//   velTrue      (below)  — divides by every weekend the market actually
//     ran, zeros included. Right for "has this stopped selling", where
//     the zero weekends ARE the signal. Using the weighted velocity for
//     sunset decisions would make a piece that sold twice a year look
//     identical to one that sells every weekend.
//
// The denominator for velTrue is "active" weekends — final weekends with
// at least one sale of anything. That excludes markets nobody worked
// (which would drag every item toward dead) while still counting the
// weekends the market ran and this piece didn't sell.
function _rpActiveWeekendKeys() {
  var weekends = (_rpSales && _rpSales.weekends) || {};
  return Object.keys(weekends).sort().reverse().filter(function(k) {
    var e = weekends[k];
    if (!e || e.final !== true) return false;
    if ((e.uncatalogued || 0) > 0) return true;
    var its = e.items || {};
    return Object.keys(its).some(function(id){ return its[id].qty > 0; });
  });
}

// Units sold for one item over a slice of active weekends
function _rpUnitsOver(itemId, keys) {
  var weekends = (_rpSales && _rpSales.weekends) || {};
  var n = 0;
  keys.forEach(function(k) {
    var e = weekends[k]; if (!e || !e.items) return;
    var it = e.items[itemId];
    if (it && it.qty > 0) n += it.qty;
  });
  return n;
}

// Lifetime units + revenue across EVERY stored weekend, backfill included
function _rpLifetime(itemId) {
  var weekends = (_rpSales && _rpSales.weekends) || {};
  var units = 0, revenue = 0;
  Object.keys(weekends).forEach(function(k) {
    var e = weekends[k]; if (!e || !e.items) return;
    var it = e.items[itemId]; if (!it) return;
    units += it.qty || 0;
    revenue += it.revenue || 0;
  });
  return { units: units, revenue: Math.round(revenue * 100) / 100 };
}

// How many active weekends back the last sale was. 0 = sold this weekend,
// null = never sold in any stored weekend.
function _rpWeekendsSinceSale(itemId) {
  for (var i = 0; i < _rpActiveKeys.length; i++) {
    if (_rpUnitsOver(itemId, [_rpActiveKeys[i]]) > 0) return i;
  }
  return null;
}

// Material cost of one piece from the design's BOM (metals carry waste).
// Null when there is no BOM, or no material in it carries a cost.
function _rpUnitCost(d) {
  if (!d || !Array.isArray(d.bom) || !d.bom.length) return null;
  var matById = {};
  (_rpMaterials || []).forEach(function(m){ matById[m.notionPageId] = m; });
  var total = 0, any = false;
  d.bom.forEach(function(l) {
    if (!l.materialId || !(l.qty > 0)) return;
    var m = matById[l.materialId]; if (!m) return;
    var unit = m.currentCostPerUnit;
    if (unit == null || isNaN(unit)) return;
    total += _rpPerPiece(d, l, m) * unit;
    any = true;
  });
  return any ? total : null;
}

// Cost basis for "capital sitting in the case", with an honest fallback
// chain. est:true means it was derived from retail, not measured.
function _rpCostBasis(d, cat) {
  var measured = _rpUnitCost(d);
  if (measured != null) return { cost: measured, est: false };
  var retail = (d && d.retailPriceOverride != null) ? d.retailPriceOverride
    : (cat && cat.price != null ? cat.price : null);
  if (retail != null) return { cost: retail * AS_COST_RATIO, est: true };
  return { cost: null, est: false };
}

// Recent N active weekends vs the N before → up / flat / down.
// Needs a full prior window to say anything; short history is 'flat'.
function _rpTrend(itemId) {
  var w = AS_TREND_WINDOW;
  if (_rpActiveKeys.length < w * 2) return 'flat';
  var recent = _rpUnitsOver(itemId, _rpActiveKeys.slice(0, w)) / w;
  var prior  = _rpUnitsOver(itemId, _rpActiveKeys.slice(w, w * 2)) / w;
  if (prior === 0 && recent === 0) return 'flat';
  if (prior === 0) return 'up';
  var change = (recent - prior) / prior;
  if (change > 0.25) return 'up';
  if (change < -0.25) return 'down';
  return 'flat';
}

// The state ladder — first match wins. Order matters: a piece with stock
// and no sales at all is "never", not "restock", even though its cover is
// technically zero.
function _rpClassify(r) {
  if (r.onHand > 0 && r.unitsLTD === 0) return 'never';
  if (r.onHand > 0 && r.sinceSale != null && r.sinceSale >= AS_STALE_WEEKENDS) return 'sunset';
  if (r.trend === 'down' && r.sinceSale != null && r.sinceSale >= AS_FADE_WEEKENDS) return 'fading';
  // A manually set par stays authoritative — that contract predates this
  // page and the cover test only applies where no par has been set.
  if (r.par != null) return r.onHand <= r.par ? 'restock' : (r.cover > AS_COVER_MAX ? 'overstocked' : 'healthy');
  if (r.cover < AS_COVER_MIN) return 'restock';
  if (r.cover > AS_COVER_MAX) return 'overstocked';
  return 'healthy';
}

// ── Build one row per catalog item ─────────────
// Universe = every catalog item, plus any linked design whose item never
// came back from the catalog walk (deleted category, manual pin) so a
// design with a par can never silently vanish from its own page.
function _rpComputeRows() {
  _rpActiveKeys = _rpActiveWeekendKeys();
  var window = _rpActiveKeys.slice(0, AS_TRUE_WINDOW);
  var denom = window.length;

  var designByItem = {};
  (_rpDesigns || []).forEach(function(d) {
    if (!d.squareItemId) return;
    var itemId = _rpDesignItemId(d);
    if (itemId && !designByItem[itemId]) designByItem[itemId] = d;
  });

  // Queue rows carry the BOM/buildability/shortfall math — index them by
  // design so a restock row can show "material for 6 ✓" and a → Queue button.
  var queueByDesign = {};
  _rpComputeQueue().forEach(function(q){ queueByDesign[q.d.id] = q; });

  var itemIds = Object.keys(_rpCatalog);
  Object.keys(designByItem).forEach(function(id){ if (!_rpCatalog[id]) itemIds.push(id); });

  var rows = itemIds.map(function(itemId) {
    var cat = _rpCatalog[itemId] || null;
    var d = designByItem[itemId] || null;

    var onHand = 0, tracked = false;
    ((cat && cat.varIds) || _rpItemVars[itemId] || []).forEach(function(v) {
      if (_rpOnHand[v] != null) { onHand += _rpOnHand[v]; tracked = true; }
    });

    var lt = _rpLifetime(itemId);
    var velTrue = denom ? _rpUnitsOver(itemId, window) / denom : 0;
    var basis = _rpCostBasis(d, cat);

    var r = {
      itemId: itemId,
      name: (d && d.name) || (cat && cat.name) || _rpItemNames[itemId] || 'Unknown item',
      category: (cat && cat.category) || 'Unlinked',
      design: d,
      onHand: onHand,
      tracked: tracked,
      par: (d && d.parLevel != null) ? d.parLevel : null,
      velWeighted: _rpVelocity[itemId] || 0,
      velTrue: velTrue,
      cover: velTrue > 0 ? onHand / velTrue : Infinity,
      unitsLTD: lt.units,
      revenueLTD: lt.revenue,
      sinceSale: _rpWeekendsSinceSale(itemId),
      trend: _rpTrend(itemId),
      unitCost: basis.cost,
      costEst: basis.est,
      tied: basis.cost != null ? basis.cost * onHand : null,
      q: d ? (queueByDesign[d.id] || null) : null,
    };
    r.state = _rpClassify(r);
    return r;
  });

  // Items with zero stock that have also never sold are catalog noise
  // (placeholders, retired lines Square still lists) — nothing to decide.
  return rows.filter(function(r){ return r.onHand > 0 || r.unitsLTD > 0; });
}

// ── On-hand counts (live from Square) ──────────
function _rpLoadOnHand() {
  var idSet = {};
  (_rpDesigns || []).forEach(function(d) {
    if (!d.squareItemId || d.replenishmentActive === false) return;
    var itemId = _rpDesignItemId(d);
    ((itemId && _rpItemVars[itemId]) || [d.squareItemId]).forEach(function(v){ idSet[v] = true; });
  });
  // Top sellers get counts too (for the "have X" readout), even unlinked
  // ones — their variation ids come from the shared varMap inverse.
  var varMap = (_rpSales && _rpSales.varMap) || {};
  var topItems = {};
  Object.keys(_rpVelocity).forEach(function(itemId){ topItems[itemId] = true; });
  Object.keys(varMap).forEach(function(v) {
    if (topItems[varMap[v].itemId]) idSet[v] = true;
  });

  var ids = Object.keys(idSet);
  if (!ids.length) return Promise.resolve();
  // Square caps batch-retrieve at 100 ids per call
  var batches = [];
  for (var i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  return Promise.all(batches.map(function(batch) {
    return _rpSq('/v2/inventory/counts/batch-retrieve', {
      catalog_object_ids: batch, location_ids: [INV_LOCATION_ID],
    }).then(function(data) {
      (data.counts || []).forEach(function(c) {
        _rpOnHand[c.catalog_object_id] = parseInt(c.quantity, 10) || 0;
      });
    }).catch(function(){});
  }));
}

// ── Waste (same priority chain as designs.js / closeout.js) ──
function _rpWastePct(m, overridePct) {
  if (overridePct != null && !isNaN(overridePct)) return overridePct;
  var s = _rpSettings || {};
  var mt = (s.wastePctByMetal || {})[m.metalType];
  if (typeof mt === 'number') return mt;
  return typeof s.wasteDefaultPct === 'number' ? s.wasteDefaultPct : 0;
}

// Per-piece consumption per BOM line for a design
function _rpPerPiece(d, l, m) {
  return m.category === 'metal'
    ? l.qty * (1 + _rpWastePct(m, d.wasteOverridePct != null ? d.wasteOverridePct : null) / 100)
    : l.qty;
}

// ── The queue computation ──────────────────────
// Returns [{d, onHand, par, deficit, batch, vel, sug, buildable, shorts:[{m, need, short, perPiece}]}]
function _rpComputeQueue() {
  var matById = {};
  (_rpMaterials || []).forEach(function(m){ matById[m.notionPageId] = m; });

  var rows = [];
  (_rpDesigns || []).forEach(function(d) {
    if (d.replenishmentActive === false) return;
    if (d.parLevel == null || !d.squareItemId) return;
    var onHand = _rpDesignOnHand(d);
    if (onHand == null) onHand = 0; // not tracked in Square = treat as out
    if (onHand > d.parLevel) return;

    var deficit = d.parLevel - onHand;
    var batch = d.suggestedBatchSize != null && d.suggestedBatchSize > 0 ? d.suggestedBatchSize : Math.max(deficit, 1);
    var buildable = null, shorts = [];
    var bom = Array.isArray(d.bom) ? d.bom.filter(function(l){ return l.materialId && l.qty > 0; }) : [];
    if (bom.length) {
      buildable = Infinity;
      bom.forEach(function(l) {
        var m = matById[l.materialId];
        if (!m) return;
        var per = _rpPerPiece(d, l, m);
        var stock = parseFloat(m.stockLevel) || 0;
        buildable = Math.min(buildable, Math.floor(stock / per));
        var need = per * batch;
        if (need > stock) shorts.push({ m: m, need: need, short: need - stock, perPiece: per });
      });
      if (buildable === Infinity) buildable = null;
      if (buildable != null && buildable < 0) buildable = 0;
    }
    rows.push({
      d: d, onHand: onHand, par: d.parLevel, deficit: deficit, batch: batch,
      vel: _rpDesignVelocity(d), sug: _rpSuggestedPar(d),
      buildable: buildable, shorts: shorts,
    });
  });

  rows.sort(function(a, b){ return b.deficit - a.deficit; });
  return rows;
}

// ── Render ─────────────────────────────────────
async function rpRender(reload) {
  var body = document.getElementById('as-body');
  if (!body) return;
  if (_rpLoading) return;
  if (reload || _rpDesigns === null) {
    _rpLoading = true;
    body.innerHTML = '<tr><td colspan="9" class="oh-empty">Checking weekend sales, the Square catalog, stock, and material levels…</td></tr>';
    await _rpLoadAll();
    _rpLoading = false;
  }

  _rpRows = _rpComputeRows();

  var note = document.getElementById('rp-note');
  if (note) {
    note.textContent = _rpRows.length
      ? _rpRows.length + ' piece' + (_rpRows.length !== 1 ? 's' : '') + ' tracked · '
        + _rpActiveKeys.length + ' market weekend' + (_rpActiveKeys.length !== 1 ? 's' : '') + ' of history'
      : 'No stock or sales history found yet — check the Square categories in the Inventory tab.';
  }

  _rpRenderKpis();
  _rpRenderFilters();
  _rpRenderTable();

  _rpRenderTopSellers();
  _rpRenderShoppingList(_rpComputeQueue());
  _rpRenderParTable();
}

function _rpMoney(n) {
  if (n == null) return '—';
  return '$' + Math.round(n).toLocaleString();
}

// ── Scorecard ──────────────────────────────────
function _rpRenderKpis() {
  var el = document.getElementById('as-kpis');
  if (!el) return;
  var dead = 0, deadN = 0, total = 0, never = 0, below = 0, covers = [], anyEst = false;
  _rpRows.forEach(function(r) {
    if (r.tied != null) { total += r.tied; if (r.costEst) anyEst = true; }
    if (r.state === 'sunset' || r.state === 'never') { deadN++; if (r.tied != null) dead += r.tied; }
    if (r.state === 'never') never++;
    if (r.state === 'restock') below++;
    if (isFinite(r.cover)) covers.push(r.cover);
  });
  // Median, not mean: a handful of dead pieces sit on 40+ weekends of
  // cover and drag an average clean out of the target band, so the tile
  // would read "8.5, target 2–6" on a lineup that is mostly healthy.
  var mid = null;
  if (covers.length) {
    covers.sort(function(a, b){ return a - b; });
    var h = Math.floor(covers.length / 2);
    mid = covers.length % 2 ? covers[h] : (covers[h - 1] + covers[h]) / 2;
    mid = Math.round(mid * 10) / 10;
  }
  var tilde = anyEst ? '~' : '';

  var tiles = [
    { tone: 'crit', v: tilde + _rpMoney(dead), l: 'Dead capital', d: deadN + ' piece' + (deadN !== 1 ? 's' : '') + ', no sale in ' + AS_STALE_WEEKENDS + '+ weekends' },
    { tone: 'warn', v: below,                  l: 'Need restocking', d: 'below par or under ' + AS_COVER_MIN + ' weekends of cover' },
    { tone: 'info', v: tilde + _rpMoney(total),l: 'Total stock at cost', d: _rpRows.length + ' pieces tracked' },
    { tone: 'good', v: mid != null ? mid : '—',l: 'Median weekends of cover', d: 'target ' + AS_COVER_MIN + '–' + AS_COVER_MAX },
    { tone: 'crit', v: never,                  l: 'Never sold', d: 'in stock, zero sales on record' },
  ];
  el.innerHTML = tiles.map(function(t) {
    return '<div class="as-kpi as-kpi-' + t.tone + '">'
      + '<div class="as-kpi-v">' + t.v + '</div>'
      + '<div class="as-kpi-l">' + _rpEsc(t.l) + '</div>'
      + '<div class="as-kpi-d">' + _rpEsc(t.d) + '</div>'
      + '</div>';
  }).join('');
}

// ── State chips + category select ──────────────
function _rpRenderFilters() {
  var el = document.getElementById('as-filters');
  if (!el) return;
  var counts = {};
  _rpRows.forEach(function(r){ counts[r.state] = (counts[r.state] || 0) + 1; });

  var html = '<button class="as-chip' + (_rpFilter === 'all' ? ' as-chip-on' : '')
    + '" onclick="rpSetFilter(\'all\')">All ' + _rpRows.length + '</button>';
  html += AS_STATES.map(function(s) {
    var n = counts[s.key] || 0;
    if (!n) return '';
    return '<button class="as-chip as-chip-' + s.tone + (_rpFilter === s.key ? ' as-chip-on' : '')
      + '" onclick="rpSetFilter(\'' + s.key + '\')">' + s.label + ' ' + n + '</button>';
  }).join('');

  var cats = [];
  _rpRows.forEach(function(r){ if (cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  html += '<select class="as-catsel" onchange="rpSetCatFilter(this.value)" aria-label="Filter by category">'
    + '<option value="all">All categories</option>'
    + cats.map(function(c) {
        return '<option value="' + _rpEsc(c) + '"' + (_rpCatFilter === c ? ' selected' : '') + '>' + _rpEsc(c) + '</option>';
      }).join('')
    + '</select>';
  el.innerHTML = html;
}

function rpSetFilter(state) {
  _rpFilter = state;
  _rpRenderFilters();
  _rpRenderTable();
}

function rpSetCatFilter(v) {
  _rpCatFilter = v;
  _rpRenderTable();
}

function rpSortBy(col) {
  if (_rpSort.col === col) _rpSort.dir = _rpSort.dir === 'asc' ? 'desc' : 'asc';
  else _rpSort = { col: col, dir: col === 'name' || col === 'category' ? 'asc' : 'desc' };
  _rpRenderTable();
}

function _rpVisibleRows() {
  return _rpRows.filter(function(r) {
    if (_rpFilter !== 'all' && r.state !== _rpFilter) return false;
    if (_rpCatFilter !== 'all' && r.category !== _rpCatFilter) return false;
    return true;
  });
}

// ── The table ──────────────────────────────────
var _AS_COLS = [
  { key: 'name',     label: 'Piece',      num: false },
  { key: 'category', label: 'Category',   num: false },
  { key: 'onHand',   label: 'On hand',    num: true  },
  { key: 'velTrue',  label: 'Sells/wknd', num: true  },
  { key: 'cover',    label: 'Cover',      num: true  },
  { key: 'sinceSale',label: 'Last sold',  num: true  },
  { key: 'tied',     label: 'Tied up',    num: true  },
];

// Eight active weekends of unit sales, oldest → newest. Endpoint is
// emphasised so the direction reads without counting points.
function _rpSpark(r) {
  var keys = _rpActiveKeys.slice(0, 8).reverse();
  if (keys.length < 2) return '<span class="as-dim">—</span>';
  var vals = keys.map(function(k){ return _rpUnitsOver(r.itemId, [k]); });
  var max = Math.max.apply(null, vals.concat([1]));
  var w = 46, h = 14, step = w / (vals.length - 1);
  var pts = vals.map(function(v, i) {
    return (i * step).toFixed(1) + ',' + (h - 2 - (v / max) * (h - 4)).toFixed(1);
  });
  var stroke = r.trend === 'up' ? 'var(--ok)' : r.trend === 'down' ? 'var(--danger)' : 'var(--text-dim)';
  var last = pts[pts.length - 1].split(',');
  return '<svg class="as-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"'
    + ' role="img" aria-label="' + r.trend + ' trend over ' + vals.length + ' weekends">'
    + '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + stroke + '" stroke-width="1.5"/>'
    + '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2" fill="' + stroke + '"/>'
    + '</svg>';
}

function _rpCoverTxt(r) {
  if (!isFinite(r.cover)) return '<span class="as-dim">∞</span>';
  var v = Math.round(r.cover * 10) / 10;
  var cls = r.cover < AS_COVER_MIN ? 'as-bad' : r.cover > AS_COVER_MAX ? 'as-wrn' : 'as-good';
  return '<span class="' + cls + '">' + v + '</span>';
}

function _rpLastSoldTxt(r) {
  if (r.sinceSale == null) return '<span class="as-bad">never</span>';
  if (r.sinceSale === 0) return 'this wknd';
  var txt = r.sinceSale + ' wknd' + (r.sinceSale !== 1 ? 's' : '');
  if (r.sinceSale >= AS_STALE_WEEKENDS) return '<span class="as-bad">' + txt + '</span>';
  if (r.sinceSale >= AS_FADE_WEEKENDS) return '<span class="as-wrn">' + txt + '</span>';
  return txt;
}

// The action a row deserves depends on its state: build it, retire it, or
// nothing at all. Sunsetting needs a linked design to carry the flag.
function _rpRowAction(r) {
  var d = r.design;
  if (r.state === 'restock' && d && r.q) {
    if (_rpQueued[d.id]) return '<span class="as-good">✓ queued</span>';
    return '<button class="btn btn-gold btn-sm" onclick="rpAddToQueue(\'' + d.id + '\',' + r.q.batch + ',this)">→ Queue ' + r.q.batch + '</button>';
  }
  if (r.state === 'sunset' || r.state === 'never' || r.state === 'fading') {
    if (!d) return '<span class="as-dim" title="Link this Square item to a design in Designs → Costing to retire it from here">not linked</span>';
    if (d.replenishmentActive === false) return '<span class="as-dim">retired</span>';
    return '<button class="btn btn-sm" onclick="rpSetField(\'' + d.id + '\',\'replenishmentActive\',false)">Retire</button>';
  }
  return '';
}

function _rpRenderTable() {
  var body = document.getElementById('as-body');
  var head = document.getElementById('as-head');
  if (!body) return;

  if (head) {
    head.innerHTML = '<tr>' + _AS_COLS.map(function(c) {
      var on = _rpSort.col === c.key;
      return '<th class="' + (c.num ? 'as-num ' : '') + 'as-sortable' + (on ? ' as-sorted' : '') + '"'
        + ' onclick="rpSortBy(\'' + c.key + '\')" role="button" tabindex="0"'
        + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();rpSortBy(\'' + c.key + '\')}">'
        + c.label + (on ? '<span class="as-caret">' + (_rpSort.dir === 'asc' ? '▲' : '▼') + '</span>' : '')
        + '</th>';
    }).join('') + '<th>Trend</th><th>State</th><th></th></tr>';
  }

  var rows = _rpVisibleRows();
  var dir = _rpSort.dir === 'asc' ? 1 : -1;
  var col = _rpSort.col;
  rows.sort(function(a, b) {
    var av = a[col], bv = b[col];
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    // null last-sold means "never" and Infinity means "never sells" — both
    // are the extreme end of their column, so they sort past every number
    // rather than landing at zero.
    if (av == null) av = Infinity;
    if (bv == null) bv = Infinity;
    if (av === bv) return 0;
    return (av < bv ? -1 : 1) * dir;
  });

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10" class="oh-empty">Nothing in this view.</td></tr>';
    return;
  }

  var stateOf = {};
  AS_STATES.forEach(function(s){ stateOf[s.key] = s; });

  body.innerHTML = rows.map(function(r) {
    var s = stateOf[r.state] || { label: r.state, tone: 'mute' };
    var tied = r.tied == null ? '—' : (r.costEst ? '~' : '') + _rpMoney(r.tied);
    return '<tr>'
      + '<td class="as-name">' + _rpEsc(r.name) + (r.design ? '' : ' <span class="as-unlinked" title="No design is linked to this Square item — link one in Designs → Costing for BOM, par and queue actions">⚠</span>') + '</td>'
      + '<td>' + _rpEsc(r.category) + '</td>'
      + '<td class="as-num' + (r.onHand === 0 ? ' as-bad' : '') + '">' + (r.tracked ? r.onHand : '—') + '</td>'
      + '<td class="as-num">' + (r.velTrue > 0 ? (Math.round(r.velTrue * 10) / 10) : '<span class="as-dim">0</span>') + '</td>'
      + '<td class="as-num">' + _rpCoverTxt(r) + '</td>'
      + '<td class="as-num">' + _rpLastSoldTxt(r) + '</td>'
      + '<td class="as-num" title="' + (r.costEst ? 'Estimated from retail — this design has no costed BOM' : 'From the design BOM') + '">' + tied + '</td>'
      + '<td>' + _rpSpark(r) + '</td>'
      + '<td><span class="as-pill as-pill-' + s.tone + '">' + s.label + '</span></td>'
      + '<td class="as-rowact">' + _rpRowAction(r) + '</td>'
      + '</tr>';
  }).join('');
}

// Suggested-par chip: shown when velocity implies a different par than the
// manual one; clicking accepts it (manual par stays authoritative until then)
function _rpSugChip(d, sug, par) {
  if (sug == null || sug === par) return '';
  return ' <button class="rp-sug" title="Sells ~' + (Math.round(_rpDesignVelocity(d) * 10) / 10)
    + '/weekend × ' + RP_COVER_WEEKENDS + ' weekends cover — click to set par to ' + sug + '"'
    + ' onclick="rpSetField(\'' + d.id + '\',\'parLevel\',' + sug + ')">→ ' + sug + '</button>';
}

// ── Top sellers card ───────────────────────────
// Ranked by recency-weighted units/weekend. Items with no linked design
// are flagged, not hidden — a hot unlinked item has no BOM, no par, and
// no queue button, which is exactly why it needs to be seen.
function _rpRenderTopSellers() {
  var el = document.getElementById('rp-top');
  if (!el) return;
  var itemIds = Object.keys(_rpVelocity).sort(function(a, b){ return _rpVelocity[b] - _rpVelocity[a]; });
  if (!itemIds.length) { el.innerHTML = ''; return; }

  var designByItem = {}; // itemId -> design
  (_rpDesigns || []).forEach(function(d) {
    if (!d.squareItemId || d.replenishmentActive === false) return;
    var itemId = _rpDesignItemId(d);
    if (itemId && !designByItem[itemId]) designByItem[itemId] = d;
  });

  // On-hand per item = sum over its known variations
  var varMap = (_rpSales && _rpSales.varMap) || {};
  var itemOnHand = {};
  Object.keys(varMap).forEach(function(v) {
    if (_rpOnHand[v] == null) return;
    var it = varMap[v].itemId;
    itemOnHand[it] = (itemOnHand[it] || 0) + _rpOnHand[v];
  });
  Object.keys(_rpItemVars).forEach(function(it) {
    _rpItemVars[it].forEach(function(v) {
      if (_rpOnHand[v] == null || (varMap[v] && varMap[v].itemId === it)) return;
      itemOnHand[it] = (itemOnHand[it] || 0) + _rpOnHand[v];
    });
  });

  var uncat = 0;
  var weekends = (_rpSales && _rpSales.weekends) || {};
  Object.keys(weekends).sort().reverse().slice(0, RP_LOOKBACK_WEEKENDS).forEach(function(k) {
    uncat += (weekends[k] && weekends[k].uncatalogued) || 0;
  });

  var html = '<div class="rp-shop-title">📈 Top sellers — last ' + _rpVelWeekends + ' market weekend' + (_rpVelWeekends !== 1 ? 's' : '') + ', recent weighted heavier</div>';
  html += itemIds.slice(0, RP_TOP_SELLERS).map(function(itemId) {
    var v = _rpVelocity[itemId];
    var d = designByItem[itemId];
    var have = itemOnHand[itemId];
    var make = Math.max(Math.ceil(v * RP_COVER_WEEKENDS) - (have || 0), 0);
    var name = (d && d.name) || _rpItemNames[itemId] || 'Unknown item';
    return '<div class="rp-top-row">'
      + '<span class="rp-top-name">' + _rpEsc(name) + (d ? '' : ' <span class="rp-unlinked" title="No design is linked to this Square item — link one in Designs → Costing to get BOM, par, and queue buttons">⚠ not linked</span>') + '</span>'
      + '<span class="rp-vel">~' + (Math.round(v * 10) / 10) + '/wk</span>'
      + '<span class="rp-top-proj">' + (have != null ? 'have ' + have + ' · ' : '')
      + (make > 0 ? 'make <b>' + make + '</b>' : '<span class="rp-ok">covered ✓</span>') + '</span>'
      + '</div>';
  }).join('');
  if (uncat > 0) {
    html += '<div class="rp-top-note">⚠ ' + Math.round(uncat) + ' sale' + (uncat !== 1 ? 's' : '') + ' rang up as custom amounts (no catalog item) — those aren\'t counted here.</div>';
  }
  el.innerHTML = html;
}

// Below-queue table: every linked design's velocity/par/batch/active —
// assistants maintain pars here even for designs currently above par.
function _rpRenderParTable() {
  var body = document.getElementById('rp-par-body');
  if (!body) return;
  var list = (_rpDesigns || []).filter(function(d){ return d.squareItemId; });
  if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="oh-empty">No Square-linked designs yet.</td></tr>'; return; }
  list.sort(function(a, b){ return (a.name || '').localeCompare(b.name || ''); });
  body.innerHTML = list.map(function(d) {
    var onHand = _rpDesignOnHand(d);
    var sug = _rpSuggestedPar(d);
    return '<tr class="' + (d.replenishmentActive === false ? 'mat-inactive' : '') + '">'
      + '<td>' + _rpEsc(d.name || 'Untitled') + '</td>'
      + '<td>' + (onHand != null ? onHand : '—') + '</td>'
      + '<td class="rp-vel">' + _rpVelTxt(_rpDesignVelocity(d)) + '</td>'
      + '<td><input type="number" min="0" step="1" class="rp-inline" value="' + (d.parLevel != null ? d.parLevel : '') + '" placeholder="—" onchange="rpSetField(\'' + d.id + '\',\'parLevel\',this.value)"></td>'
      + '<td>' + (sug != null
          ? (sug === d.parLevel ? '<span class="rp-ok">' + sug + ' ✓</span>' : _rpSugChip(d, sug, d.parLevel))
          : '—')
      + '</td>'
      + '<td><input type="number" min="0" step="1" class="rp-inline" value="' + (d.suggestedBatchSize != null ? d.suggestedBatchSize : '') + '" placeholder="auto" onchange="rpSetField(\'' + d.id + '\',\'suggestedBatchSize\',this.value)"></td>'
      + '<td><input type="checkbox" ' + (d.replenishmentActive !== false ? 'checked' : '') + ' onchange="rpSetField(\'' + d.id + '\',\'replenishmentActive\',this.checked)"></td>'
      + '</tr>';
  }).join('');
}

// ── Shopping list (aggregate shortfall, grouped by supplier) ──
function _rpRenderShoppingList(rows) {
  var el = document.getElementById('rp-shopping');
  if (!el) return;
  var byMat = {}; // materialId -> {m, qty}
  rows.forEach(function(r) {
    r.shorts.forEach(function(s) {
      var e = byMat[s.m.notionPageId] = byMat[s.m.notionPageId] || { m: s.m, qty: 0 };
      e.qty += s.short;
    });
  });
  var mats = Object.keys(byMat).map(function(k){ return byMat[k]; });
  if (!mats.length) { el.innerHTML = ''; return; }

  var bySup = {};
  mats.forEach(function(e) {
    var sup = e.m.supplierDefault || 'No default supplier';
    (bySup[sup] = bySup[sup] || []).push(e);
  });

  var html = '<div class="rp-shop-title">🛒 Shopping list — material short across the queue'
    + ' <button class="btn btn-outline btn-sm" onclick="rpCopyShoppingList()">📋 Copy</button></div>';
  Object.keys(bySup).sort().forEach(function(sup) {
    html += '<div class="rp-shop-sup">' + _rpEsc(sup) + '</div>'
      + bySup[sup].map(function(e) {
          var unit = matUnitAbbr(e.m.unit);
          return '<div class="rp-shop-item">' + _rpEsc(e.m.name) + ' — ' + (Math.round(e.qty * 10) / 10) + unit + '</div>';
        }).join('');
  });
  el.innerHTML = html;
  el.dataset.plain = Object.keys(bySup).sort().map(function(sup) {
    return sup + ':\n' + bySup[sup].map(function(e) {
      var unit = matUnitAbbr(e.m.unit);
      return '  ' + e.m.name + ' — ' + (Math.round(e.qty * 10) / 10) + unit;
    }).join('\n');
  }).join('\n');
}

function rpCopyShoppingList() {
  var el = document.getElementById('rp-shopping');
  if (!el || !el.dataset.plain) return;
  navigator.clipboard.writeText(el.dataset.plain)
    .then(function(){ toast('Shopping list copied', '📋'); })
    .catch(function(){ toast('Copy failed', '⚠'); });
}

// ── Inline par/batch/active editing ────────────
function rpSetField(designId, field, value) {
  var d = (_rpDesigns || []).find(function(x){ return x.id === designId; });
  if (!d) return;
  var v;
  if (field === 'replenishmentActive') v = !!value;
  else {
    v = value === '' ? null : parseInt(value, 10);
    if (v != null && (isNaN(v) || v < 0)) return;
  }
  d[field] = v;
  var patch = { id: designId };
  patch[field] = v;
  fetch('/api/designs', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then(function(r) {
    if (!r.ok) throw new Error();
    rpRender(false); // recompute queue with the new value (no refetch)
  }).catch(function(){ toast('Could not save — check connection', '⚠'); });
}

// ── One-tap add to the Restock Queue ───────────
// A queue card = a Notion note (block 'Inventory Restock') + a record in
// the shared restock-matches store linking it to the Square item, so the
// card arrives pre-matched: timers, stock badges, and the Phase 5
// close-out all just work.
async function rpAddToQueue(designId, batch, btn) {
  var d = (_rpDesigns || []).find(function(x){ return x.id === designId; });
  if (!d) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  try {
    var text = (d.name || 'Design') + ' ×' + batch;
    var r = await fetch('/api/notion-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, block: 'Inventory Restock' }),
    });
    var data = await r.json();
    if (!r.ok || !data.notionPageId) throw new Error(data.error || 'create failed');

    if (d.squareItemId) {
      var patch = {};
      patch[data.notionPageId] = { id: d.squareItemId, name: d.name || '', isCustom: false, isParent: false };
      await fetch('/api/restock-matches', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch(function(){}); // match is a nicety — the card exists either way
    }

    _rpQueued[designId] = true;
    toast('Added to Restock Queue — ' + text, '✓');
    rpRender(false);
  } catch (e) {
    toast('Could not add to queue — ' + (e.message || e), '⚠');
    if (btn) { btn.disabled = false; btn.textContent = '→ Queue ' + batch; }
  }
}
