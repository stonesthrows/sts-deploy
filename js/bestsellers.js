// ════════════════════════════════════════════
//  BEST SELLERS ANALYTICS  —  js/bestsellers.js
//  Georgina's category view of Square market sales: best sellers per
//  product category (Earrings / Rings / Pendants / …) with monthly,
//  quarterly and yearly stats, a projected-revenue figure, and a
//  restock-focus list — all from the same server-side weekend-sales
//  store the Replenishment page fills (/api/weekend-sales, KV key
//  replenish:weekend-sales).
//    · Reads the store, never re-syncs recent weekends — that stays
//      Replenishment's job. What this page ADDS is history: a one-time
//      backfill of Square order history from BS_BACKFILL_START, written
//      as final:true, backfilled:true weekend entries. Replenish only
//      looks at the last 8 Saturdays and skips final entries, so the
//      backfill cannot disturb its math.
//    · No sale record carries a category, so item → category comes from
//      a client-side catalog map (/v2/catalog/batch-retrieve on the item
//      ids seen in sales), grouped through inventory.js's INV_*_CAT_IDS
//      unions into the app's five product families; unmatched items fall
//      back to their Square category name. Cached 7 days in
//      localStorage['sts-bs-catmap'] with a manual ↻ refresh.
//    · Periods: a weekend belongs to the month/quarter/year containing
//      its SATURDAY. Only final weekends count.
//    · Projection = actuals-to-date + recency-weighted revenue velocity
//      × remaining Saturdays in the period (velocity over the last
//      BS_LOOKBACK_WEEKENDS final weekends with sales — the Replenish
//      recipe with a wider window). The formula is shown on the card.
//    · Restock focus = ceil(unit velocity × BS_COVER_WEEKENDS) − on
//      hand, clamped at 0; on-hand pulled live from Square, pooled
//      across each item's variations.
//  Loaded ONLY by jewelry-workflow.html, after inventory.js (needs
//  INV_LOCATION_ID + INV_*_CAT_IDS) and sales.js (reuses statCard()).
//  Uses toast() from app.js. Touches NO other tab's code or data.
// ════════════════════════════════════════════

var BS_LOOKBACK_WEEKENDS = 12;           // velocity window (final weekends with sales)
var BS_COVER_WEEKENDS    = 4;            // restock focus covers this many market weekends
var BS_TOP_N             = 8;            // bars per category card
var BS_BACKFILL_START    = '2025-01-04'; // first Saturday of 2025

var _bsSales           = null;  // /api/weekend-sales blob { weekends, varMap }
var _bsCatMap          = null;  // { items: {itemId:{cats:[],name,vars:[]}}, catNames: {catId:name} }
var _bsOnHand          = {};    // variationId -> on-hand count
var _bsOnHandReady     = false; // on-hand fetch finished (rows show '…' until then)
var _bsItemNames       = {};    // itemId -> name (from sales entries, backfill resolution)
var _bsLoading         = false;
var _bsBackfillRunning = false;
var _bsPeriod          = null;  // selected period key for the current view type

function _bsEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _bsMoney(n) {
  return '$' + Math.round(n).toLocaleString();
}

// ── Square proxy helper ────────────────────────
// No client token attached — /api/square falls back to the server-side
// SQUARE_TOKEN, same reasoning as inventory.js's _sqFetch. Calls without
// a body (catalog/list) go out as GET, everything else as POST.
function _bsSq(path, body) {
  return fetch('/api/square', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path, method: body ? 'POST' : 'GET', body: body }),
  }).then(function(r) {
    return r.json().then(function(json) {
      if (!r.ok) throw new Error((json.errors && json.errors[0] && json.errors[0].detail) || 'Square error');
      return json;
    });
  });
}

function _bsSleep(ms) { return new Promise(function(res){ setTimeout(res, ms); }); }

// ── Date / period helpers ──────────────────────
function _bsDateKey(d) {
  var p = function(n){ return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Most recent Saturday whose weekend has fully ended (Sat 00:00 + 2 days)
function _bsLastEndedSaturday() {
  var now = new Date();
  var d = new Date(now);
  var day = d.getDay(); // 0=Sun…6=Sat
  d.setDate(d.getDate() - (day === 6 ? 0 : day + 1));
  d.setHours(0, 0, 0, 0);
  var end = new Date(d); end.setDate(end.getDate() + 2);
  if (now < end) d.setDate(d.getDate() - 7); // current weekend still in progress
  return _bsDateKey(d);
}

// Every Saturday key from startKey..endKey inclusive (startKey snapped
// forward to a Saturday if it isn't one)
function _bsSatKeysBetween(startKey, endKey) {
  var d = new Date(startKey + 'T00:00:00');
  var day = d.getDay();
  if (day !== 6) d.setDate(d.getDate() + ((6 - day + 7) % 7));
  var keys = [];
  while (_bsDateKey(d) <= endKey) {
    keys.push(_bsDateKey(d));
    d.setDate(d.getDate() + 7);
  }
  return keys;
}

function _bsWeekendLabel(satKey) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var sat = new Date(satKey + 'T00:00:00');
  var sun = new Date(sat); sun.setDate(sun.getDate() + 1);
  return months[sat.getMonth()] + ' ' + sat.getDate() + '-'
    + (sun.getMonth() !== sat.getMonth() ? months[sun.getMonth()] + ' ' : '') + sun.getDate();
}

// Period key of a date for a view type: YYYY-MM / YYYY-Qn / YYYY
function _bsPeriodOfDate(d, type) {
  var y = d.getFullYear(), m = d.getMonth() + 1;
  if (type === 'year')    return String(y);
  if (type === 'quarter') return y + '-Q' + (Math.floor((m - 1) / 3) + 1);
  return y + '-' + String(m).padStart(2, '0');
}

// A weekend belongs to the period containing its Saturday
function _bsPeriodOf(satKey, type) {
  return _bsPeriodOfDate(new Date(satKey + 'T00:00:00'), type);
}

function _bsPeriodType(pk) {
  if (/^\d{4}$/.test(pk)) return 'year';
  if (/-Q[1-4]$/.test(pk)) return 'quarter';
  return 'month';
}

// [startDate, endDateExclusive] of a period key
function _bsPeriodBounds(pk) {
  var t = _bsPeriodType(pk);
  var y = parseInt(pk.slice(0, 4), 10);
  if (t === 'year')    return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
  if (t === 'quarter') {
    var q = parseInt(pk.slice(6), 10);
    return [new Date(y, (q - 1) * 3, 1), new Date(y, q * 3, 1)];
  }
  var m = parseInt(pk.slice(5, 7), 10);
  return [new Date(y, m - 1, 1), new Date(y, m, 1)];
}

function _bsShiftPeriod(pk, dir) {
  var t = _bsPeriodType(pk);
  var start = _bsPeriodBounds(pk)[0];
  var step = t === 'year' ? 12 : t === 'quarter' ? 3 : 1;
  start.setMonth(start.getMonth() + dir * step);
  return _bsPeriodOfDate(start, t);
}

function _bsPeriodLabel(pk) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var t = _bsPeriodType(pk);
  if (t === 'year')    return pk;
  if (t === 'quarter') return pk.slice(5) + ' ' + pk.slice(0, 4);
  return months[parseInt(pk.slice(5, 7), 10) - 1] + ' ' + pk.slice(0, 4);
}

function _bsSatsInPeriod(pk) {
  var b = _bsPeriodBounds(pk);
  return _bsSatKeysBetween(_bsDateKey(b[0]), _bsDateKey(new Date(b[1].getTime() - 86400000)));
}

// Saturdays in the period whose weekend hasn't finished yet — the market
// weekends the projection still has to account for
function _bsRemainingSaturdays(pk) {
  var now = new Date();
  return _bsSatsInPeriod(pk).filter(function(k) {
    var end = new Date(k + 'T00:00:00'); end.setDate(end.getDate() + 2);
    return end > now;
  }).length;
}

// ── View state (persisted: type + sort) ────────
function _bsView() {
  var v = null;
  try { v = JSON.parse(localStorage.getItem('sts-bs-view')); } catch (e) {}
  if (!v || typeof v !== 'object') v = {};
  if (['month','quarter','year'].indexOf(v.type) < 0) v.type = 'month';
  if (['qty','revenue'].indexOf(v.sort) < 0) v.sort = 'revenue';
  return v;
}

function _bsSaveView(v) {
  try { localStorage.setItem('sts-bs-view', JSON.stringify({ type: v.type, sort: v.sort })); } catch (e) {}
}

function bsSetType(type) {
  var v = _bsView();
  v.type = type;
  _bsSaveView(v);
  _bsPeriod = _bsPeriodOfDate(new Date(), type); // reset to the current period
  bsRender();
}

function bsShiftPeriodSel(dir) {
  if (!_bsPeriod) return;
  _bsPeriod = _bsShiftPeriod(_bsPeriod, dir);
  bsRender();
}

function bsToggleSort() {
  var v = _bsView();
  v.sort = v.sort === 'revenue' ? 'qty' : 'revenue';
  _bsSaveView(v);
  bsRender();
}

// ── Category map (item → Square categories) ────
var BS_CAT_CACHE_KEY = 'sts-bs-catmap';
var BS_CAT_TTL_MS    = 7 * 24 * 60 * 60 * 1000;

// The app's product families, in display order. Each entry unions every
// category id in the matching inventory.js map (values are
// {subTab: [catIds]} objects).
function _bsFamilyDefs() {
  var defs = [];
  var add = function(label, map) {
    if (typeof map === 'undefined' || !map) return;
    var set = {};
    Object.keys(map).forEach(function(sub) {
      (map[sub] || []).forEach(function(id){ set[id] = true; });
    });
    defs.push({ label: label, ids: set });
  };
  add('Earrings',      typeof INV_CAT_IDS          !== 'undefined' ? INV_CAT_IDS          : null);
  add('Rings',         typeof INV_RING_CAT_IDS     !== 'undefined' ? INV_RING_CAT_IDS     : null);
  add('Pendants',      typeof INV_PENDANT_CAT_IDS  !== 'undefined' ? INV_PENDANT_CAT_IDS  : null);
  add('Perm. Jewelry', typeof INV_PERM_CAT_IDS     !== 'undefined' ? INV_PERM_CAT_IDS     : null);
  add('Nose Rings',    typeof INV_NOSERING_CAT_IDS !== 'undefined' ? INV_NOSERING_CAT_IDS : null);
  return defs;
}
var _bsFamilies = null; // built lazily so inventory.js is definitely loaded

function _bsLoadCatCache() {
  try {
    var raw = localStorage.getItem(BS_CAT_CACHE_KEY);
    if (!raw) return null;
    var c = JSON.parse(raw);
    if (!c || !c.ts || (Date.now() - c.ts) > BS_CAT_TTL_MS) return null;
    if (!c.items || typeof c.items !== 'object') return null;
    return { items: c.items, catNames: c.catNames || {} };
  } catch (e) { return null; }
}

function _bsSaveCatCache() {
  if (!_bsCatMap) return;
  try {
    localStorage.setItem(BS_CAT_CACHE_KEY, JSON.stringify({
      ts: Date.now(), items: _bsCatMap.items, catNames: _bsCatMap.catNames,
    }));
  } catch (e) { /* quota — page still works, just refetches next time */ }
}

// Ensure every itemId has a catalog entry (categories + variations).
// batch-retrieve with related objects also hands back parent ITEMs for
// variation-keyed sales rows and the CATEGORY objects themselves.
async function _bsEnsureCatMap(itemIds) {
  if (!_bsCatMap) _bsCatMap = _bsLoadCatCache() || { items: {}, catNames: {} };
  var missing = itemIds.filter(function(id){ return !_bsCatMap.items[id]; });

  for (var i = 0; i < missing.length; i += 500) {
    var batch = missing.slice(i, i + 500);
    try {
      var json = await _bsSq('/v2/catalog/batch-retrieve', { object_ids: batch, include_related_objects: true });
      var items = {}, variations = {};
      (json.objects || []).concat(json.related_objects || []).forEach(function(o) {
        if (o.type === 'ITEM') items[o.id] = o;
        else if (o.type === 'ITEM_VARIATION') variations[o.id] = o;
        else if (o.type === 'CATEGORY') {
          _bsCatMap.catNames[o.id] = (o.category_data && o.category_data.name) || '';
        }
      });
      var entryFromItem = function(it) {
        var d = it.item_data || {};
        var cats = (d.categories || []).map(function(c){ return c.id; });
        if (d.reporting_category && d.reporting_category.id && cats.indexOf(d.reporting_category.id) < 0) cats.push(d.reporting_category.id);
        if (d.category_id && cats.indexOf(d.category_id) < 0) cats.push(d.category_id);
        return { cats: cats, name: d.name || '', vars: (d.variations || []).map(function(v){ return v.id; }) };
      };
      Object.keys(items).forEach(function(id){ _bsCatMap.items[id] = entryFromItem(items[id]); });
      batch.forEach(function(id) {
        if (_bsCatMap.items[id]) return;
        var v = variations[id];
        var parentId = v && v.item_variation_data && v.item_variation_data.item_id;
        if (parentId && items[parentId]) _bsCatMap.items[id] = entryFromItem(items[parentId]);
        else _bsCatMap.items[id] = { cats: [], name: '', vars: [] }; // deleted / unresolvable
      });
    } catch (e) { /* leave unresolved — they render as Uncategorized this visit */ }
  }

  // Fill in any category names batch-retrieve didn't hand back
  var needNames = false;
  Object.keys(_bsCatMap.items).forEach(function(id) {
    (_bsCatMap.items[id].cats || []).forEach(function(c) {
      if (_bsCatMap.catNames[c] == null) needNames = true;
    });
  });
  if (needNames) {
    try {
      var cursor = null;
      do {
        var res = await _bsSq('/v2/catalog/list?types=CATEGORY' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), null);
        (res.objects || []).forEach(function(o) {
          if (o.type === 'CATEGORY') _bsCatMap.catNames[o.id] = (o.category_data && o.category_data.name) || '';
        });
        cursor = res.cursor || null;
      } while (cursor);
    } catch (e) { /* names stay blank — grouping still works via id unions */ }
  }

  _bsSaveCatCache();
}

async function bsRefreshCatMap(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }
  try { localStorage.removeItem(BS_CAT_CACHE_KEY); } catch (e) {}
  _bsCatMap = { items: {}, catNames: {} };
  try {
    await _bsEnsureCatMap(_bsAllItemIds());
    toast('Category map refreshed', '✓');
  } catch (e) {
    toast('Category refresh failed — ' + (e.message || e), '⚠');
  }
  bsRender();
}

// App category for an item: first inventory.js family whose id union
// contains one of the item's Square categories; else the Square category
// name; else Uncategorized.
function _bsAppCategory(itemId) {
  if (!_bsFamilies) _bsFamilies = _bsFamilyDefs();
  var entry = _bsCatMap && _bsCatMap.items[itemId];
  if (!entry || !entry.cats || !entry.cats.length) return 'Uncategorized';
  for (var f = 0; f < _bsFamilies.length; f++) {
    for (var c = 0; c < entry.cats.length; c++) {
      if (_bsFamilies[f].ids[entry.cats[c]]) return _bsFamilies[f].label;
    }
  }
  var name = _bsCatMap.catNames[entry.cats[0]];
  return name || 'Uncategorized';
}

function _bsAllItemIds() {
  var ids = {};
  var weekends = (_bsSales && _bsSales.weekends) || {};
  Object.keys(weekends).forEach(function(k) {
    var its = (weekends[k] && weekends[k].items) || {};
    Object.keys(its).forEach(function(id){ ids[id] = true; });
  });
  return Object.keys(ids);
}

function _bsNameOf(itemId) {
  var entry = _bsCatMap && _bsCatMap.items[itemId];
  return (entry && entry.name) || _bsItemNames[itemId] || 'Unknown item';
}

// ── Pure aggregation ───────────────────────────
// Bucket FINAL weekends into periods for a view type.
// → { periodKey: { satKeys:[], items:{id:{name,qty,revenue}}, units, revenue, uncatalogued } }
function bsBucketPeriods(weekends, type) {
  var out = {};
  Object.keys(weekends).forEach(function(k) {
    var e = weekends[k];
    if (!e || e.final !== true) return;
    var p = _bsPeriodOf(k, type);
    var b = out[p] = out[p] || { satKeys: [], items: {}, units: 0, revenue: 0, uncatalogued: 0 };
    b.satKeys.push(k);
    b.uncatalogued += e.uncatalogued || 0;
    var its = e.items || {};
    Object.keys(its).forEach(function(id) {
      var it = its[id];
      var t = b.items[id] = b.items[id] || { name: it.name || '', qty: 0, revenue: 0 };
      if (!t.name && it.name) t.name = it.name;
      t.qty     += it.qty || 0;
      t.revenue += it.revenue || 0;
      b.units   += it.qty || 0;
      b.revenue += it.revenue || 0;
      if (it.name && !_bsItemNames[id]) _bsItemNames[id] = it.name;
    });
  });
  return out;
}

// Group one period's items by app category, ranked.
// → [{ cat, units, revenue, items:[{id,name,qty,revenue}] }] sorted by sortKey
function bsTopPerCategory(bucket, sortKey) {
  if (!bucket) return [];
  var byCat = {};
  Object.keys(bucket.items).forEach(function(id) {
    var it = bucket.items[id];
    var cat = _bsAppCategory(id);
    var c = byCat[cat] = byCat[cat] || { cat: cat, units: 0, revenue: 0, items: [] };
    c.units   += it.qty;
    c.revenue += it.revenue;
    c.items.push({ id: id, name: it.name || _bsNameOf(id), qty: it.qty, revenue: it.revenue });
  });
  var metric = sortKey === 'qty' ? function(x){ return x.qty != null ? x.qty : x.units; }
                                 : function(x){ return x.revenue; };
  var cats = Object.keys(byCat).map(function(k){ return byCat[k]; });
  cats.forEach(function(c){ c.items.sort(function(a, b){ return metric(b) - metric(a); }); });
  cats.sort(function(a, b){ return metric(b) - metric(a); });
  return cats;
}

// % change vs the prior period (null when there's no baseline)
function bsPeriodDelta(cur, prev) {
  if (!prev) return null;
  return prev === 0 ? null : ((cur - prev) / prev) * 100;
}

// ── Velocity & projection ──────────────────────
// Recency-weighted per-weekend units & revenue over the last
// BS_LOOKBACK_WEEKENDS final weekends WITH sales (the Replenish recipe,
// wider window) — zero-sale weekends are skipped markets, not demand.
function bsVelocity(weekends) {
  var out = { units: {}, revenue: {}, totalUnits: 0, totalRevenue: 0, weekends: 0 };
  var keys = Object.keys(weekends).sort().reverse(); // most recent first
  var used = [];
  for (var i = 0; i < keys.length && used.length < BS_LOOKBACK_WEEKENDS; i++) {
    var e = weekends[keys[i]];
    if (!e || e.final !== true) continue;
    var its = e.items || {};
    var sold = (e.uncatalogued || 0) > 0
      || Object.keys(its).some(function(id){ return its[id].qty > 0; });
    if (!sold) continue;
    used.push(e);
  }
  if (!used.length) return out;

  var n = used.length, wSum = 0, u = {}, r = {}, tu = 0, tr = 0;
  used.forEach(function(e, idx) {
    var weight = n - idx; // most recent = n … oldest = 1
    wSum += weight;
    var its = e.items || {};
    Object.keys(its).forEach(function(id) {
      u[id] = (u[id] || 0) + (its[id].qty || 0) * weight;
      r[id] = (r[id] || 0) + (its[id].revenue || 0) * weight;
      tu += (its[id].qty || 0) * weight;
      tr += (its[id].revenue || 0) * weight;
      if (its[id].name && !_bsItemNames[id]) _bsItemNames[id] = its[id].name;
    });
  });
  Object.keys(u).forEach(function(id){ out.units[id]   = u[id] / wSum; });
  Object.keys(r).forEach(function(id){ out.revenue[id] = r[id] / wSum; });
  out.totalUnits   = tu / wSum;
  out.totalRevenue = tr / wSum;
  out.weekends     = n;
  return out;
}

// projected period revenue = actuals so far + velocity × market weekends left
function bsProject(bucket, vel, periodKey) {
  var remaining = _bsRemainingSaturdays(periodKey);
  var actual = bucket ? bucket.revenue : 0;
  return { revenue: actual + vel.totalRevenue * remaining, remaining: remaining, actual: actual };
}

// ── On-hand (live from Square, pooled per item) ─
function _bsVarsByItem() {
  var map = {}; // itemId -> {varId: true}
  var varMap = (_bsSales && _bsSales.varMap) || {};
  Object.keys(varMap).forEach(function(v) {
    var it = varMap[v].itemId;
    (map[it] = map[it] || {})[v] = true;
  });
  if (_bsCatMap) {
    Object.keys(_bsCatMap.items).forEach(function(it) {
      (_bsCatMap.items[it].vars || []).forEach(function(v) {
        (map[it] = map[it] || {})[v] = true;
      });
    });
  }
  return map;
}

function _bsItemOnHand(itemId, varsByItem) {
  var vars = Object.keys((varsByItem || _bsVarsByItem())[itemId] || {});
  var sum = 0, any = false;
  vars.forEach(function(v) {
    if (_bsOnHand[v] != null) { sum += _bsOnHand[v]; any = true; }
  });
  return any ? sum : null;
}

function _bsLoadOnHand(vel) {
  var varsByItem = _bsVarsByItem();
  var idSet = {};
  Object.keys(vel.units).forEach(function(itemId) {
    if (vel.units[itemId] <= 0) return;
    Object.keys(varsByItem[itemId] || {}).forEach(function(v){ idSet[v] = true; });
  });
  var ids = Object.keys(idSet);
  if (!ids.length) return Promise.resolve();
  // Square caps batch-retrieve at 100 ids per call
  var batches = [];
  for (var i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  return Promise.all(batches.map(function(batch) {
    return _bsSq('/v2/inventory/counts/batch-retrieve', {
      catalog_object_ids: batch, location_ids: [INV_LOCATION_ID],
    }).then(function(data) {
      (data.counts || []).forEach(function(c) {
        _bsOnHand[c.catalog_object_id] = parseInt(c.quantity, 10) || 0;
      });
    }).catch(function(){});
  }));
}

// Restock rows: focus = what to make to cover BS_COVER_WEEKENDS at the
// current unit velocity. Untracked on-hand shows '—' and is kept visible.
function bsRestockFocus(vel) {
  var varsByItem = _bsVarsByItem();
  var rows = [];
  Object.keys(vel.units).forEach(function(id) {
    var v = vel.units[id];
    if (!(v > 0)) return;
    var need = Math.ceil(v * BS_COVER_WEEKENDS);
    var have = _bsOnHandReady ? _bsItemOnHand(id, varsByItem) : null;
    var make = Math.max(0, need - (have || 0));
    if (_bsOnHandReady && have != null && make <= 0) return; // covered
    rows.push({
      id: id, name: _bsNameOf(id), cat: _bsAppCategory(id),
      vel: v, rev: vel.revenue[id] || 0, have: have, need: need, make: make,
    });
  });
  rows.sort(function(a, b){ return (b.make - a.make) || (b.rev - a.rev); });
  return rows;
}

// ── Init & render ──────────────────────────────
async function bestsellersInit() {
  var el = document.getElementById('bsContent');
  if (!el) return;
  if (_bsLoading) return;
  if (_bsSales === null) {
    _bsLoading = true;
    el.innerHTML = '<div class="sales-empty">Loading market sales history…</div>';
    try {
      var r = await fetch('/api/weekend-sales');
      var s = await r.json();
      _bsSales = (s && !s.error) ? s : { weekends: {}, varMap: {} };
    } catch (e) { _bsSales = { weekends: {}, varMap: {} }; }
    try { await _bsEnsureCatMap(_bsAllItemIds()); } catch (e) {}
    _bsLoading = false;
  }
  bsRender();
  if (!_bsOnHandReady) {
    var vel = bsVelocity((_bsSales && _bsSales.weekends) || {});
    _bsLoadOnHand(vel).then(function() {
      _bsOnHandReady = true;
      _bsRenderRestock(vel);
      _bsUpdateFocusCard(vel);
    });
  }
}

function bsRender() {
  var el = document.getElementById('bsContent');
  if (!el || _bsSales === null) return;
  var view = _bsView();
  var weekends = _bsSales.weekends || {};
  if (!_bsPeriod || _bsPeriodType(_bsPeriod) !== view.type) {
    _bsPeriod = _bsPeriodOfDate(new Date(), view.type);
  }

  var buckets = bsBucketPeriods(weekends, view.type);
  var bucketKeys = Object.keys(buckets).sort();
  var curKey = _bsPeriodOfDate(new Date(), view.type);
  var minKey = bucketKeys.length ? (bucketKeys[0] < curKey ? bucketKeys[0] : curKey) : curKey;
  if (_bsPeriod < minKey) _bsPeriod = minKey;
  if (_bsPeriod > curKey) _bsPeriod = curKey;

  var cur  = buckets[_bsPeriod] || null;
  var prev = buckets[_bsShiftPeriod(_bsPeriod, -1)] || null;
  var vel  = bsVelocity(weekends);
  var proj = bsProject(cur, vel, _bsPeriod);
  var isCurrentPeriod = _bsPeriod === curKey;

  var finalCount = Object.keys(weekends).filter(function(k){ return weekends[k] && weekends[k].final === true; }).length;
  var pendingBackfill = _bsBackfillPending().length;

  var html = '';

  // ── Toolbar ──────────────────────────────
  html += '<div class="bs-toolbar">';
  html += '<div class="bs-seg" role="tablist" aria-label="Period type">';
  [['month','Month'],['quarter','Quarter'],['year','Year']].forEach(function(t) {
    html += '<button class="bs-seg-btn' + (view.type === t[0] ? ' active' : '') + '" role="tab" aria-selected="'
      + (view.type === t[0]) + '" onclick="bsSetType(\'' + t[0] + '\')">' + t[1] + '</button>';
  });
  html += '</div>';
  html += '<div class="bs-period-nav">';
  html += '<button class="bs-period-btn" onclick="bsShiftPeriodSel(-1)" aria-label="Previous period"' + (_bsPeriod <= minKey ? ' disabled' : '') + '>‹</button>';
  html += '<span class="bs-period-label">' + _bsEsc(_bsPeriodLabel(_bsPeriod)) + '</span>';
  html += '<button class="bs-period-btn" onclick="bsShiftPeriodSel(1)" aria-label="Next period"' + (_bsPeriod >= curKey ? ' disabled' : '') + '>›</button>';
  html += '</div>';
  html += '<button class="btn btn-outline btn-sm" onclick="bsToggleSort()" title="Rank items by quantity or revenue">⇅ '
    + (view.sort === 'revenue' ? 'Revenue' : 'Qty') + '</button>';
  html += '<span class="bs-toolbar-spacer"></span>';
  html += '<button class="btn btn-outline btn-sm" onclick="bsRefreshCatMap(this)" title="Re-fetch item categories from the Square catalog">↻ Categories</button>';
  html += '<button id="bsBackfillBtn" class="sales-sync-btn" onclick="bsBackfillHistory(this)"'
    + (pendingBackfill === 0 || _bsBackfillRunning ? ' disabled' : '') + '>'
    + (_bsBackfillRunning ? 'Backfilling…'
       : pendingBackfill === 0 ? '✓ History complete'
       : '⬇ Backfill history (' + pendingBackfill + ' wknds)') + '</button>';
  html += '</div>';
  html += '<div id="bsProgressWrap" class="bs-progress-wrap"' + (_bsBackfillRunning ? '' : ' style="display:none"') + '>'
    + '<div class="bs-progress"><div class="bs-progress-fill" id="bsProgressFill"></div></div>'
    + '<div class="bs-progress-note" id="bsProgressNote"></div></div>';

  if (!finalCount) {
    html += '<div class="sales-empty">No completed market weekends in the store yet — open the Replenishment tab once to sync recent weekends, or hit ⬇ Backfill history.</div>';
    el.innerHTML = html;
    return;
  }

  // ── Stat cards ───────────────────────────
  var delta = bsPeriodDelta(cur ? cur.revenue : 0, prev ? prev.revenue : null);
  var deltaHtml = delta == null ? 'no prior period'
    : '<span class="sales-delta ' + (delta >= 0 ? 'up' : 'down') + '">'
      + (delta >= 0 ? '+' : '') + delta.toFixed(0) + '% vs ' + _bsEsc(_bsPeriodLabel(_bsShiftPeriod(_bsPeriod, -1))) + '</span>';
  var projSub = !isCurrentPeriod
    ? 'period complete'
    : _bsMoney(proj.actual) + ' actual + ' + _bsMoney(vel.totalRevenue) + '/wknd × ' + proj.remaining + ' Sat' + (proj.remaining !== 1 ? 's' : '') + ' left';

  html += '<div class="sales-stats">';
  html += statCard('📦', 'si-purple', _bsEsc(_bsPeriodLabel(_bsPeriod)) + ' Units',
    Math.round(cur ? cur.units : 0).toLocaleString(),
    (cur ? cur.satKeys.length : 0) + ' market weekend' + (cur && cur.satKeys.length === 1 ? '' : 's'));
  html += statCard('💰', 'si-gold', _bsEsc(_bsPeriodLabel(_bsPeriod)) + ' Revenue',
    _bsMoney(cur ? cur.revenue : 0), deltaHtml);
  html += statCard('📈', 'si-green', 'Projected ' + _bsEsc(_bsPeriodLabel(_bsPeriod)),
    isCurrentPeriod ? _bsMoney(proj.revenue) : _bsMoney(cur ? cur.revenue : 0),
    '<span class="bs-proj-note">' + projSub + '</span>');
  html += statCard('🔧', 'si-red', 'Restock Focus',
    '<span id="bsFocusCount">' + (_bsOnHandReady ? bsRestockFocus(vel).filter(function(r){ return r.make > 0; }).length : '…') + '</span>',
    'items to make · ' + BS_COVER_WEEKENDS + '-wknd cover');
  html += '</div>';

  // ── Category cards ───────────────────────
  var cats = bsTopPerCategory(cur, view.sort);
  if (!cats.length) {
    html += '<div class="sales-empty">No item sales recorded in ' + _bsEsc(_bsPeriodLabel(_bsPeriod)) + '.</div>';
  } else {
    html += '<div class="bs-cat-grid">';
    cats.forEach(function(c) {
      var top = c.items.slice(0, BS_TOP_N);
      var max = Math.max.apply(null, top.map(function(it) {
        return view.sort === 'qty' ? it.qty : it.revenue;
      }).concat([1]));
      html += '<div class="sales-card bs-cat-card">';
      html += '<div class="sales-card-head">' + _bsEsc(c.cat)
        + ' <span class="bs-cat-tot">' + Math.round(c.units).toLocaleString() + ' pcs · ' + _bsMoney(c.revenue) + '</span></div>';
      html += '<div class="sales-card-body"><div class="sales-bar-wrap">';
      top.forEach(function(it) {
        var val = view.sort === 'qty' ? it.qty : it.revenue;
        var pct = Math.round((val / max) * 100);
        html += '<div class="sales-bar-row">'
          + '<div class="sales-bar-lbl"><span>' + _bsEsc(it.name) + ' <span class="sales-td-muted">×' + Math.round(it.qty) + '</span></span>'
          + '<span class="sales-bar-amt">' + _bsMoney(it.revenue) + '</span></div>'
          + '<div class="sales-bar-track"><div class="sales-bar-fill sf-gold" style="width:' + pct + '%"></div></div>'
          + '</div>';
      });
      if (c.items.length > BS_TOP_N) {
        html += '<div class="bs-cat-more">+ ' + (c.items.length - BS_TOP_N) + ' more item' + (c.items.length - BS_TOP_N !== 1 ? 's' : '') + '</div>';
      }
      html += '</div></div></div>';
    });
    html += '</div>';
  }

  // ── Restock focus table ──────────────────
  html += '<div id="bsRestock"></div>';

  // ── Uncatalogued footnote ────────────────
  if (cur && cur.uncatalogued > 0) {
    html += '<div class="bs-footnote">⚠ ' + Math.round(cur.uncatalogued) + ' sale'
      + (Math.round(cur.uncatalogued) !== 1 ? 's' : '') + ' in ' + _bsEsc(_bsPeriodLabel(_bsPeriod))
      + ' rang up as custom amounts (no catalog item) — their revenue isn\'t in these numbers.</div>';
  }

  el.innerHTML = html;
  _bsRenderRestock(vel);
}

function _bsRenderRestock(vel) {
  var el = document.getElementById('bsRestock');
  if (!el) return;
  if (!vel) vel = bsVelocity((_bsSales && _bsSales.weekends) || {});
  var rows = bsRestockFocus(vel);

  var html = '<div class="sales-card sales-block">';
  html += '<div class="sales-card-head">🔧 Restock focus — cover ' + BS_COVER_WEEKENDS
    + ' market weekends at current velocity (last ' + vel.weekends + ' weekend' + (vel.weekends !== 1 ? 's' : '') + ', recent weighted heavier)</div>';
  html += '<div class="sales-card-body sales-flush">';
  if (!_bsOnHandReady) {
    html += '<div class="sales-empty">Checking Square stock levels…</div>';
  } else if (!rows.length) {
    html += '<div class="sales-empty">Everything with sales velocity is covered 🎉</div>';
  } else {
    html += '<div class="sales-table-wrap"><table class="sales-table bs-restock-table"><thead><tr>';
    ['Item','Category','~ per wknd','On hand','Need ' + BS_COVER_WEEKENDS + 'wk','Make'].forEach(function(h) {
      html += '<th>' + h + '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function(r) {
      html += '<tr>'
        + '<td class="sales-td-label">' + _bsEsc(r.name) + '</td>'
        + '<td class="sales-td-muted">' + _bsEsc(r.cat) + '</td>'
        + '<td>' + (Math.round(r.vel * 10) / 10) + '</td>'
        + '<td>' + (r.have != null ? r.have : '<span class="sales-td-muted" title="Not tracked in Square — counted as 0">—</span>') + '</td>'
        + '<td>' + r.need + '</td>'
        + '<td class="sales-td-total">' + r.make + '</td>'
        + '</tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div></div>';
  el.innerHTML = html;
}

function _bsUpdateFocusCard(vel) {
  var el = document.getElementById('bsFocusCount');
  if (!el) return;
  if (!vel) vel = bsVelocity((_bsSales && _bsSales.weekends) || {});
  el.textContent = bsRestockFocus(vel).filter(function(r){ return r.make > 0; }).length;
}

// ── Backfill (one-time Square order history) ───
function _bsBackfillStartKey() {
  // Testing hook: set localStorage['sts-bs-backfill-start'] to a recent
  // Saturday to trial-run the backfill on a few weekends first.
  var override = null;
  try { override = localStorage.getItem('sts-bs-backfill-start'); } catch (e) {}
  return (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) ? override : BS_BACKFILL_START;
}

function _bsBackfillPending() {
  var weekends = (_bsSales && _bsSales.weekends) || {};
  return _bsSatKeysBetween(_bsBackfillStartKey(), _bsLastEndedSaturday())
    .filter(function(k) {
      var e = weekends[k];
      return !e || e.final !== true; // already-final weekends are never re-pulled
    });
}

// Exact clone of Replenish's weekend query: one weekend's COMPLETED
// orders at the market location, Sat 00:00 → Mon 00:00, per variation id.
async function _bsFetchWeekendOrders(satKey) {
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
    var json = await _bsSq('/v2/orders/search', body);
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

// Batch-resolve variation ids → parent item (Replenish's recipe, writing
// only to Best Sellers' own state)
async function _bsResolveVarIds(varIds) {
  var patch = {};
  for (var i = 0; i < varIds.length; i += 500) {
    var batch = varIds.slice(i, i + 500);
    try {
      var json = await _bsSq('/v2/catalog/batch-retrieve', { object_ids: batch, include_related_objects: true });
      var items = {};
      (json.related_objects || []).concat(json.objects || []).forEach(function(o) {
        if (o.type === 'ITEM') items[o.id] = o;
      });
      Object.keys(items).forEach(function(itemId) {
        var it = items[itemId];
        if (!_bsItemNames[itemId]) _bsItemNames[itemId] = (it.item_data && it.item_data.name) || '';
      });
      (json.objects || []).forEach(function(o) {
        if (o.type !== 'ITEM_VARIATION') return;
        var itemId = (o.item_variation_data && o.item_variation_data.item_id) || null;
        if (!itemId) return;
        patch[o.id] = { itemId: itemId, itemName: _bsItemNames[itemId] || '' };
      });
    } catch (e) { /* unresolved ids fall back to variation-level below */ }
  }
  return patch;
}

function _bsProgress(done, total, msg) {
  var wrap = document.getElementById('bsProgressWrap');
  var fill = document.getElementById('bsProgressFill');
  var note = document.getElementById('bsProgressNote');
  if (wrap) wrap.style.display = '';
  if (fill) fill.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
  if (note) note.textContent = msg;
}

// Roll a batch of fetched weekends up to parent items and PATCH them to
// the shared store as final, backfilled entries. Mutates varMap in place
// (the caller's cross-chunk cache) and merges into _bsSales locally.
async function _bsFlushBackfill(chunk, varMap, totals) {
  var keys = Object.keys(chunk);
  if (!keys.length) return;

  var unknown = {};
  keys.forEach(function(k) {
    Object.keys(chunk[k].byVar).forEach(function(v){ if (!varMap[v]) unknown[v] = true; });
  });
  var varPatch = {};
  var unknownIds = Object.keys(unknown);
  if (unknownIds.length) {
    varPatch = await _bsResolveVarIds(unknownIds);
    Object.keys(varPatch).forEach(function(v){ varMap[v] = varPatch[v]; });
  }

  var now = new Date();
  var weekendPatch = {};
  keys.forEach(function(k) {
    var items = {};
    var byVar = chunk[k].byVar;
    Object.keys(byVar).forEach(function(v) {
      // Deleted/unresolvable catalog objects keep the variation id as the
      // key so their sales still count somewhere visible
      var itemId = varMap[v] ? varMap[v].itemId : v;
      var name   = varMap[v] ? varMap[v].itemName : byVar[v].name;
      var e = items[itemId] = items[itemId] || { name: name, qty: 0, revenue: 0 };
      e.qty += byVar[v].qty;
      e.revenue += Math.round(byVar[v].revenue * 100) / 100;
      totals.units += byVar[v].qty;
      totals.revenue += byVar[v].revenue;
    });
    weekendPatch[k] = {
      label: _bsWeekendLabel(k),
      syncedAt: now.toISOString(),
      final: true,          // weekend is long over — safe to mark final
      backfilled: true,     // provenance marker: written by this backfill
      items: items,
      uncatalogued: chunk[k].uncatalogued,
    };
    totals.weekends += 1;
  });

  await fetch('/api/weekend-sales', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekends: weekendPatch, varMap: varPatch }),
  }).then(function(r) {
    if (!r.ok) throw new Error('store write failed (' + r.status + ')');
  });

  // Merge locally only after the server accepted the write, so a failed
  // PATCH leaves those weekends pending for the next run
  Object.keys(weekendPatch).forEach(function(k){ _bsSales.weekends[k] = weekendPatch[k]; });
  Object.keys(varPatch).forEach(function(v){ (_bsSales.varMap = _bsSales.varMap || {})[v] = varPatch[v]; });
}

async function bsBackfillHistory(btn) {
  if (_bsBackfillRunning || !_bsSales) return;
  var todo = _bsBackfillPending();
  if (!todo.length) {
    if (btn) { btn.textContent = '✓ History complete'; btn.disabled = true; }
    return;
  }

  _bsBackfillRunning = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Backfilling…'; }

  var varMap = {};
  Object.keys((_bsSales.varMap) || {}).forEach(function(v){ varMap[v] = _bsSales.varMap[v]; });
  var totals = { weekends: 0, units: 0, revenue: 0 };
  var failed = [];
  var chunk = {}; // satKey -> {byVar, uncatalogued}

  for (var i = 0; i < todo.length; i++) {
    var k = todo[i];
    _bsProgress(i, todo.length, 'Backfilling ' + _bsWeekendLabel(k) + ' … (' + (i + 1) + '/' + todo.length + ')');
    try {
      chunk[k] = await _bsFetchWeekendOrders(k);
    } catch (e) {
      await _bsSleep(2000); // one retry after a breather, then move on
      try { chunk[k] = await _bsFetchWeekendOrders(k); }
      catch (e2) { failed.push(k); }
    }
    if (Object.keys(chunk).length >= 10 || i === todo.length - 1) {
      try { await _bsFlushBackfill(chunk, varMap, totals); }
      catch (e3) { Object.keys(chunk).forEach(function(fk){ failed.push(fk); }); }
      chunk = {};
    }
    await _bsSleep(150); // be gentle with the Square API
  }
  _bsProgress(todo.length, todo.length, 'Backfill done.');

  _bsBackfillRunning = false;
  try { await _bsEnsureCatMap(_bsAllItemIds()); } catch (e) {}
  _bsOnHandReady = false; // new items may need counts
  toast('Backfilled ' + totals.weekends + ' weekend' + (totals.weekends !== 1 ? 's' : '')
    + ' — ' + Math.round(totals.units) + ' items, ' + _bsMoney(totals.revenue)
    + (failed.length ? ' · ' + failed.length + ' failed (retry with the button)' : ''),
    failed.length ? '⚠' : '✓');
  bestsellersInit();
}
