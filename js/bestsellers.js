// ════════════════════════════════════════════
//  BEST SELLERS ANALYTICS  —  js/bestsellers.js
//  Georgina's category view of Square market sales: best sellers per
//  product category (Earrings / Rings / Pendants / …) with monthly,
//  quarterly and yearly stats, a projected-revenue figure, and a
//  restock-focus list — all from the same server-side weekend-sales
//  store the Replenishment page fills (/api/weekend-sales, KV key
//  replenish:weekend-sales).
//    · Reads the store; Replenishment's page-open sync remains the
//      primary path for the trailing weekends it tracks. This page ADDS
//      two things of its own: (1) history — a one-time backfill of Square
//      order history from BS_BACKFILL_START, written as final:true,
//      backfilled:true weekend entries (Replenish only looks at the last
//      8 Saturdays and skips final entries, so the backfill cannot
//      disturb its math); and (2) a live same-day top-up — see
//      _bsAutoSyncWeekend below.
//    · Live sync: nobody may open Replenishment on a market day, so this
//      page pulls THIS weekend's Square orders itself whenever it's
//      opened on a Saturday or Sunday at/after BS_AUTO_SYNC_HOUR Central
//      time (checked via America/Chicago regardless of device timezone),
//      throttled to once per BS_AUTO_SYNC_THROTTLE_MS. Written the same
//      shape as Replenish's own sync (final only once the weekend's
//      Mon 00:00 boundary has passed) — not marked backfilled, so
//      Replenish's velocity math treats it exactly like its own sync.
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
//      across each item's variations. Square can report a NEGATIVE count
//      (sold without ever being received) — that is floored at 0 for the
//      math, or it reads as "you are 19 in the hole" and invents work.
//      Rows are merged by item name first: the same product often exists
//      as several Square items, and un-merged each fragment rounds its
//      own ceil() up to 1+. Retired and non-stock items (services,
//      gift cards, .Discontinued categories) are skipped — see
//      _bsRestockEligible. Permanent jewelry is skipped only while it
//      has no Square stock count: welds aren't stock, but the premade
//      chain bracelets are, and those stay on the list.
//  Loaded ONLY by jewelry-workflow.html, after inventory.js (needs
//  INV_LOCATION_ID + INV_*_CAT_IDS) and sales.js (reuses statCard()).
//  Uses toast() from app.js. Touches NO other tab's code or data.
// ════════════════════════════════════════════

var BS_LOOKBACK_WEEKENDS = 12;           // velocity window (final weekends with sales)
var BS_COVER_WEEKENDS    = 4;            // restock focus covers this many market weekends
var BS_TOP_N             = 8;            // bars per category card
var BS_BACKFILL_START    = '2025-01-04'; // first Saturday of 2025
var BS_TREND_N           = 10;           // items shown in the Trends sparkline grid
var BS_TREND_PERIODS     = 8;            // periods of history per sparkline
var BS_AUTO_SYNC_HOUR       = 14;              // 2pm Central — market's usually open by then
var BS_AUTO_SYNC_THROTTLE_MS = 10 * 60 * 1000; // don't re-hit Square more than once per 10 min

// Restock focus never asks for these. Category names are matched
// case-insensitively; a leading dot is Square's convention here for
// "not a live category" (.Discontinued). Names match whole words, so
// "Repair" is skipped but "Repair Cuff" would not be.
var BS_SKIP_CAT_RE  = /^\.|discontinued|retired/i;
var BS_SKIP_NAME_RE = /^(repair|resize|sizing|shipping|deposit|gift ?card|custom order|upgrade to .*chain)$/i;

// The whole-name list above only catches a service billed under exactly
// that word. Square's real tickets carry qualifiers — "USPS First Class
// Shipping", "Resize Ring-Texas" — so these terms are matched as words
// ANYWHERE in the name. Kept to words no piece is named after: nothing
// in the catalog is a "… shipping …" or "… resize …". Ambiguous words
// (repair, sizing on its own) stay whole-name only, so a hypothetical
// "Repair Cuff" product would survive.
var BS_SKIP_NAME_ANY_RE = /\b(shipping|postage|re-?siz(e|ed|ing)|gift ?card|deposit)\b/i;

// Restock focus ignores anything selling slower than this many units per
// market weekend (weighted velocity, after same-piece names are merged).
// 0.25 ≈ one sale every four markets. Anything under that is a one-off
// or a trickle, and asking to "make 1" of forty different pieces buries
// the handful that actually move. Raise toward 0.5 for a tighter list.
var BS_MIN_VELOCITY = 0.25;

// Square carries some pieces under two separate catalog items (an older
// name and the current one). Restock focus merges those into one row so
// the velocity and on-hand counts aren't split. Key = lowercased Square
// item name, value = the name the merged row should display under.
// Only used by restock focus — the per-category bestseller cards still
// show Square's own names.
var BS_ALIAS_NAMES = {
  'chevron stacker':          'Stacker (Single Chevron)',
  'stacker (single chevron)': 'Stacker (Single Chevron)',
  'stacker':                  'Stacker (Regular)',
  'stacker (regular)':        'Stacker (Regular)',
  'square stacker':           'Stacker (Square)',
  'stacker (square)':         'Stacker (Square)',
  'chevron ear cuff':         'Chevron Ear Cuff',
  'chevron ear cuffs':        'Chevron Ear Cuff',
  // "~ Tapered" is a genuinely different hoop and stays its own row.
  'twist hoops':              'Twist Hoops',
  'twist hoops ~ regular':    'Twist Hoops',
  'twist hoop (variations)':  'Twist Hoops',
};

// Display name for an item in restock focus, after alias merging.
function _bsRestockName(itemId) {
  var raw = String(_bsNameOf(itemId)).trim();
  return BS_ALIAS_NAMES[raw.toLowerCase()] || raw;
}

// ── Design focus cards ─────────────────────────
// The restock board only ever lists designs clearing BS_MIN_VELOCITY, and it
// says nothing about year over year. These cards give a product family its
// own cut on a far longer window than the 12-weekend velocity: units over
// the trailing 12 months against the 12 before, recent-half momentum, live
// on-hand, and a make-count for a short run.
//   · Pendants need it most — the whole family sells under the floor, so not
//     one pendant has ever reached the board.
//   · Earrings are the opposite shape: the top dozen designs are all on the
//     board already, so the card earns its place on the year-over-year
//     column and the long tail sitting below the floor.
var BS_FOCUS_N            = 5;   // designs called out as the focus set
var BS_FOCUS_RECENT_DAYS  = 182; // "still selling" window (~6 months)
var BS_FOCUS_COVER_MONTHS = 3;   // a design's make-count covers this much demand
var BS_FOCUS_WINDOW_DAYS  = 730; // total history the cards read

// Parts, add-ons and bench services ring up beside the designs they attach
// to and share their categories ("Chain Only", "Titanium Ball for Seamless
// Hoop", "Ring Repair-Texas"). They aren't designs and would pad the tail of
// every card. Note this is deliberately broader than restock focus's
// BS_SKIP_NAME_RE, which keeps "repair" whole-name-only so a hypothetical
// "Repair Cuff" product survives — these cards are an advisory design list,
// where wrongly omitting a piece costs far less than listing a repair
// ticket as a design to go and make.
var BS_FOCUS_SKIP_RE = /\b(add-?on|chain only|ball for|repairs?)\b/i;

// Product lines that belong on NO card, checked against name and category
// before any family is offered the item. Nose rings are the case: they're
// their own Inventory tab, INV_NOSERING_CAT_IDS is still empty so they
// arrive only as a Square category name, and their names collide with two
// families at once — "Nose Rings" reads as a ring, "Double Hoop Faux Nose
// Ring" reads as a hoop. A per-family veto can't fix that, because whichever
// family is tested first claims it before the vetoing one is reached.
var BS_FOCUS_EXCLUDE_RE = /\bnose\b/i;

// A family claims an item by app family label, by Square category name, or
// by the item's own name — in that order of preference but any one is
// enough. Name matters because category alone misses real sellers: the
// best-selling pendant sits in Square's "Seedpod Designs" category and the
// Haloed Pendant has no category at all. Families are tested IN ORDER and an
// item joins the first that claims it, so nothing lands on two cards.
var BS_FOCUS_FAMILIES = [
  { key: 'pendants', icon: '📿', title: 'Pendant focus',
    family: 'Pendants',
    re: /\b(pendant|necklace)s?\b/i,
    note: 'Every pendant sells below the ' + BS_MIN_VELOCITY
        + '/weekend floor the board above uses, so none of them appear there — this card is their cut.' },
  // Ear cuffs come BEFORE earrings and deliberately carry no `family`.
  // inventory.js files ear cuffs under the same 'Earrings' family as studs,
  // hoops and dangles, so a family label here would claim the whole lot and
  // leave the earring card empty. Matching on name/category instead splits
  // them, and first-claim-wins keeps "Hoop Ear Cuffs" out of the hoops card.
  { key: 'earcuffs', icon: '🌀', title: 'Ear cuff focus',
    re: /\b(ear ?cuffs?|earcuffs?)\b/i,
    // Two ear cuff categories aren't named "ear cuff" at all. "Cuff
    // Bracelets" is a bracelet and must not match, so no bare \bcuff\b.
    catRe: /\b(ear ?cuffs?|earcuffs?|stackable cuffs?|wide cuffs?)\b/i,
    note: 'Ear cuffs are your deepest line — the top dozen designs already appear on the board above, so this card is for the year-over-year column and the tail selling under the '
        + BS_MIN_VELOCITY + '/weekend floor.' },
  // Everything else worn on the ear. Keeps the 'Earrings' family label as a
  // catch-all so a new stud or dangle lands here without a regex change.
  { key: 'earrings', icon: '🌿', title: 'Earring focus',
    family: 'Earrings',
    re: /\b(earrings?|studs?|hoops?|ear ?climbers?|flatbacks?|threaders?)\b/i,
    note: 'Apart from Seamless Hoops this is a long tail — nearly every stud, dangle and climber sells under the '
        + BS_MIN_VELOCITY + '/weekend floor, so the board never shows them.' },
  // Rings are the biggest family by a distance (stackers alone clear 1,400
  // units a year), so most of this card IS on the restock board. It earns
  // its place on year-over-year and on the designs below the floor.
  //   · The family label does the heavy lifting: the stackers are named
  //     "Stacker (Regular)" etc with no "ring" in the name at all, and are
  //     caught only because Stackable Rings is in INV_RING_CAT_IDS.
  //   · Nose rings would otherwise match on \bring\b; they're kept off every
  //     card by BS_FOCUS_EXCLUDE_RE, not by a veto here — see that comment.
  //   · Meditation rings ARE folded in here. They have their own Inventory
  //     tab but no entry in _bsFamilyDefs, so they arrive by category name.
  //     Give them their own def if they ever deserve a card of their own.
  { key: 'rings', icon: '💍', title: 'Ring focus',
    family: 'Rings',
    re: /\b(rings?|stackers?|bands?)\b/i,
    note: 'Rings are your deepest family, so most of this card also appears on the board above — the value here is the year-over-year column and the designs selling under the '
        + BS_MIN_VELOCITY + '/weekend floor. Meditation rings are included.' },
];

var _bsSales           = null;  // /api/weekend-sales blob { weekends, varMap }
var _bsCatMap          = null;  // { items: {itemId:{cats:[],name,vars:[]}}, catNames: {catId:name} }
var _bsOnHand          = {};    // variationId -> on-hand count
var _bsOnHandReady     = false; // on-hand fetch finished (rows show '…' until then)
var _bsItemNames       = {};    // itemId -> name (from sales entries, backfill resolution)
var _bsLoading         = false;
var _bsBackfillRunning = false;
var _bsAutoSyncing     = false; // live same-day weekend sync in flight
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
  if (['restock','focus','trends','items'].indexOf(v.tab) < 0) v.tab = 'restock';
  return v;
}

function _bsSaveView(v) {
  try { localStorage.setItem('sts-bs-view', JSON.stringify({ type: v.type, sort: v.sort, tab: v.tab })); } catch (e) {}
}

function bsSetType(type) {
  var v = _bsView();
  v.type = type;
  _bsSaveView(v);
  _bsPeriod = _bsPeriodOfDate(new Date(), type); // reset to the current period
  bsRender();
}

function bsSetTab(tab) {
  var v = _bsView();
  v.tab = tab;
  _bsSaveView(v);
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
// v4 entries also carry a deleted flag for items gone from Square
// entirely; the bump forces one refetch so those drop out of the
// Bestseller list and restock focus alongside archived designs.
var BS_CAT_CACHE_KEY = 'sts-bs-catmap-v4';
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
        return {
          cats: cats, name: d.name || '', ptype: d.product_type || 'REGULAR',
          archived: !!d.is_archived,
          vars: (d.variations || []).map(function(v){ return v.id; }),
        };
      };
      Object.keys(items).forEach(function(id){ _bsCatMap.items[id] = entryFromItem(items[id]); });
      batch.forEach(function(id) {
        if (_bsCatMap.items[id]) return;
        var v = variations[id];
        var parentId = v && v.item_variation_data && v.item_variation_data.item_id;
        if (parentId && items[parentId]) _bsCatMap.items[id] = entryFromItem(items[parentId]);
        else _bsCatMap.items[id] = { cats: [], name: '', vars: [], deleted: true }; // gone from Square — can never get a category
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

// Archived in Square, or deleted from Square entirely (both leave an
// item with no resolvable category) — keep these out of the Bestseller
// breakdown and restock focus rather than lumping them into Uncategorized.
function _bsIsDiscontinued(itemId) {
  var entry = _bsCatMap && _bsCatMap.items[itemId];
  return !!(entry && (entry.archived || entry.deleted));
}

// Raw Square category names for an item (not the app family label) —
// what the skip rules read.
function _bsCatNamesOf(itemId) {
  var entry = _bsCatMap && _bsCatMap.items[itemId];
  if (!entry || !entry.cats) return [];
  return entry.cats.map(function(c){ return (_bsCatMap.catNames[c] || ''); });
}

// Permanent jewelry, by app family or by raw Square category name —
// INV_PERM_CAT_IDS is empty until someone assigns categories in ⚙ Manage
// Items, so in practice these arrive as the Square name "Permanent
// Jewelry" rather than the 'Perm. Jewelry' family label.
function _bsIsPermJewelry(itemId) {
  if (_bsAppCategory(itemId) === 'Perm. Jewelry') return true;
  return _bsCatNamesOf(itemId).some(function(n){ return /perm(anent)?[\s.]*jewel/i.test(n); });
}

// Is this catalog id a real stockable SKU at all — not a service line
// item, retired category, or skip-listed name? Independent of whether
// Square still carries it as a live listing: a renamed piece's old id
// (now archived/deleted) is still a valid SKU for BS_ALIAS_NAMES merging
// in bsRestockFocus, it just isn't eligible on its own (see below). Items
// with no catalog entry stay eligible — an unresolved lookup shouldn't
// silently drop a real seller.
function _bsRestockSkuValid(itemId) {
  var entry = _bsCatMap && _bsCatMap.items[itemId];
  if (entry && entry.ptype && entry.ptype !== 'REGULAR') return false;
  var nm = String(_bsNameOf(itemId)).trim();
  if (BS_SKIP_NAME_RE.test(nm)) return false;
  if (BS_SKIP_NAME_ANY_RE.test(nm)) return false;
  return !_bsCatNamesOf(itemId).some(function(n){ return n && BS_SKIP_CAT_RE.test(n); });
}

// Should this item's OWN listing ever appear in restock focus on its
// own — i.e. is it also still live in Square? Used only to gate the
// on-hand fetch: an archived/deleted id never needs fresh stock counts
// pulled for itself, even though its past sales may still feed a merged
// row under a newer id (see bsRestockFocus / BS_ALIAS_NAMES).
function _bsRestockEligible(itemId) {
  return _bsRestockSkuValid(itemId) && !_bsIsDiscontinued(itemId);
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
    if (_bsIsDiscontinued(id)) return;
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
    if (!_bsRestockEligible(itemId)) return;
    Object.keys(varsByItem[itemId] || {}).forEach(function(v){ idSet[v] = true; });
  });
  // The focus cards read a two-year window, not the velocity window, so many
  // of their designs sold nothing recent enough to be picked up above.
  _bsFocusItemIds().forEach(function(itemId) {
    if (!_bsRestockEligible(itemId)) return;
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
//
// One row per product NAME, not per Square item id: the same piece is
// often several catalog items (old listings, per-market re-adds), and a
// row each means four fragments at 0.3/wknd ask for 2 apiece instead of
// one row at 1.2/wknd asking for 5. Velocity, revenue and tracked stock
// are summed across the merged ids. Names that differ but mean the same
// piece are folded together first via BS_ALIAS_NAMES.
function bsRestockFocus(vel, includeCovered) {
  var varsByItem = _bsVarsByItem();
  var groups = {}; // nameKey -> row

  Object.keys(vel.units).forEach(function(id) {
    var v = vel.units[id];
    if (!(v > 0)) return;
    if (!_bsRestockSkuValid(id)) return;
    var name = _bsRestockName(id);
    var key = name.toLowerCase();
    var g = groups[key];
    if (!g) {
      g = groups[key] = {
        ids: [], name: name, cat: _bsAppCategory(id), pj: false, anyLive: false,
        vel: 0, rev: 0, have: null, need: 0, make: 0,
      };
    }
    g.ids.push(id);
    // A renamed piece's old id may be archived/deleted while its current
    // id is still live — the row stays eligible as long as one id is.
    g.anyLive = g.anyLive || !_bsIsDiscontinued(id);
    g.pj = g.pj || _bsIsPermJewelry(id);
    g.vel += v;
    g.rev += vel.revenue[id] || 0;
    // Prefer a real family label over the Uncategorized fallback
    if (g.cat === 'Uncategorized') g.cat = _bsAppCategory(id);
    if (_bsOnHandReady) {
      var have = _bsItemOnHand(id, varsByItem);
      if (have != null) g.have = (g.have || 0) + have;
    }
  });

  var rows = [];
  Object.keys(groups).forEach(function(key) {
    var g = groups[key];
    // Every id under this name is archived/deleted — a genuinely
    // discontinued design, not just a rename with a live successor.
    if (!g.anyLive) return;
    // Permanent jewelry is welded per customer, not stocked, so an
    // untracked PJ row can never be "covered" and would sit at the top
    // forever. Premade chain bracelets ARE stocked, so the test is
    // tracking, not category: a PJ row with a Square count stays.
    if (g.pj && _bsOnHandReady && g.have == null) return;
    // Too slow to be worth a bench slot. Tested on the merged velocity,
    // so two listings of the same piece are judged together.
    if (g.vel < BS_MIN_VELOCITY) return;
    g.need = Math.ceil(g.vel * BS_COVER_WEEKENDS);
    // Square reports negative counts for stock sold but never received.
    // Floor at 0: it means "none on hand", not "owes 19".
    g.make = Math.max(0, g.need - Math.max(0, g.have || 0));
    if (!includeCovered && _bsOnHandReady && g.have != null && g.make <= 0) return; // covered
    rows.push(g);
  });

  rows.sort(function(a, b){ return (b.make - a.make) || (b.rev - a.rev); });
  return rows;
}

// ── Design focus (aggregation) ─────────────────
function _bsFamilyClaims(def, itemId) {
  var name = String(_bsNameOf(itemId));
  var cats = _bsCatNamesOf(itemId);
  // `family` is optional: a def that shares an inventory.js family with a
  // sibling def (ear cuffs vs the rest of the earrings) matches on name and
  // category only, and relies on being listed first.
  if (def.family && _bsAppCategory(itemId) === def.family) return true;
  var catRe = def.catRe || def.re;
  if (cats.some(function(n){ return n && catRe.test(n); })) return true;
  return def.re.test(name);
}

// The family an item belongs to, or null. First claim wins.
function _bsFocusFamilyOf(itemId) {
  if (BS_FOCUS_EXCLUDE_RE.test(String(_bsNameOf(itemId)))) return null;
  if (_bsCatNamesOf(itemId).some(function(n){ return n && BS_FOCUS_EXCLUDE_RE.test(n); })) return null;
  for (var i = 0; i < BS_FOCUS_FAMILIES.length; i++) {
    if (_bsFamilyClaims(BS_FOCUS_FAMILIES[i], itemId)) return BS_FOCUS_FAMILIES[i].key;
  }
  return null;
}

// One family's designs with sales in the window, merged by name the same way
// restock focus merges them (BS_ALIAS_NAMES, then lowercased name) so a
// renamed listing and its successor count as one design rather than two half
// designs. Note this is for genuinely separate catalog items only. A plain
// RENAME needs no merging here: weekend entries are keyed by Square item id
// and _bsNameOf prefers the live catalog name, so an item's whole history
// groups under whatever it is called today. (Square's own reports do NOT do
// this — they keep the name as it was at the time of each sale, so one
// renamed item shows up there as two rows. Don't read those as duplicates.)
//   → [{ ids, name, cat, y1, y0, recent, rev1, rev0, anyLive }]
function _bsFamilyGroups(def) {
  var weekends = (_bsSales && _bsSales.weekends) || {};
  var now = Date.now(), DAY = 86400000;
  var groups = {};
  Object.keys(weekends).forEach(function(k) {
    var e = weekends[k];
    if (!e || e.final !== true) return;
    var age = (now - new Date(k + 'T00:00:00').getTime()) / DAY;
    if (age < 0 || age > BS_FOCUS_WINDOW_DAYS) return;
    var its = e.items || {};
    Object.keys(its).forEach(function(id) {
      var qty = its[id].qty || 0;
      if (!(qty > 0)) return;
      if (!_bsRestockSkuValid(id)) return; // drops chain upgrades, shipping, retired categories
      if (_bsFocusFamilyOf(id) !== def.key) return;
      var name = _bsRestockName(id);
      if (BS_FOCUS_SKIP_RE.test(name)) return;
      var g = groups[name.toLowerCase()];
      if (!g) {
        g = groups[name.toLowerCase()] = {
          ids: [], name: name, cat: _bsAppCategory(id), anyLive: false,
          y1: 0, y0: 0, recent: 0, rev1: 0, rev0: 0,
        };
      }
      if (g.ids.indexOf(id) < 0) g.ids.push(id);
      g.anyLive = g.anyLive || !_bsIsDiscontinued(id);
      if (g.cat === 'Uncategorized') g.cat = _bsAppCategory(id);
      var rev = its[id].revenue || 0;
      if (age <= BS_FOCUS_WINDOW_DAYS / 2) {
        g.y1 += qty; g.rev1 += rev;
        if (age <= BS_FOCUS_RECENT_DAYS) g.recent += qty;
      } else {
        g.y0 += qty; g.rev0 += rev;
      }
    });
  });
  // Every listing under this name archived or deleted — genuinely retired,
  // not a rename with a live successor.
  return Object.keys(groups).map(function(k){ return groups[k]; })
    .filter(function(g){ return g.anyLive; });
}

// Item ids the focus cards need stock counts for. The slow-moving ones are
// exactly what the velocity-driven on-hand fetch skips, so _bsLoadOnHand
// asks for these explicitly — otherwise their On hand column is all '—'.
function _bsFocusItemIds() {
  var ids = [];
  BS_FOCUS_FAMILIES.forEach(function(def) {
    _bsFamilyGroups(def).forEach(function(g){ ids = ids.concat(g.ids); });
  });
  return ids;
}

// Rank and classify one family. focus = the BS_FOCUS_N biggest two-year
// earners still selling in the recent half; watch = still selling, outside
// the top; fading = sold inside the window but nothing lately.
function bsFamilyFocus(def) {
  var varsByItem = _bsVarsByItem();
  var rows = _bsFamilyGroups(def);
  rows.forEach(function(g) {
    g.rev = g.rev1 + g.rev0;
    g.have = null;
    if (_bsOnHandReady) {
      g.ids.forEach(function(id) {
        var h = _bsItemOnHand(id, varsByItem);
        if (h != null) g.have = (g.have || 0) + h;
      });
    }
    // A BS_FOCUS_COVER_MONTHS run at the last 12 months' rate, less what's on
    // the shelf. Square reports negatives for stock sold but never received
    // — floor at 0, it means "none on hand", not "owes 11".
    g.make = Math.max(0, Math.ceil(g.y1 * (BS_FOCUS_COVER_MONTHS / 12)) - Math.max(0, g.have || 0));
    g.status = g.recent > 0 ? 'watch' : 'fading';
  });
  rows.sort(function(a, b){ return (b.rev - a.rev) || (b.y1 - a.y1); });
  rows.filter(function(r){ return r.status === 'watch'; })
      .slice(0, BS_FOCUS_N)
      .forEach(function(r){ r.status = 'focus'; });
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
      var tab = _bsView().tab;
      // Restock and Focus repaint in place; the other tabs need a full
      // re-render to pick the counts up.
      if (tab === 'restock' || tab === 'focus') _bsRenderStockTab(vel);
      else bsRender();
    });
  }
  _bsAutoSyncWeekend(); // fire-and-forget; re-renders itself once it lands
}

// ── Live same-day sync (Sat/Sun market afternoons) ─────────────────────
// Central time regardless of device timezone, so a market iPad set to the
// wrong clock timezone doesn't skip the window.
function _bsCentralNowParts() {
  try {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hourCycle: 'h23',
    }).formatToParts(new Date());
    var map = {};
    parts.forEach(function(p){ map[p.type] = p.value; });
    return { weekday: map.weekday, hour: parseInt(map.hour, 10) };
  } catch (e) { return null; } // Intl/timeZone unsupported — auto-sync just stays off
}

function _bsInAutoSyncWindow() {
  var p = _bsCentralNowParts();
  return !!p && (p.weekday === 'Sat' || p.weekday === 'Sun') && p.hour >= BS_AUTO_SYNC_HOUR;
}

// This weekend's Saturday key, by device-local date — same convention as
// every other weekend key in this file (_bsLastEndedSaturday etc).
function _bsCurrentWeekendSatKey() {
  var d = new Date();
  var day = d.getDay(); // 0=Sun…6=Sat
  d.setDate(d.getDate() - (day === 6 ? 0 : day + 1));
  d.setHours(0, 0, 0, 0);
  return _bsDateKey(d);
}

// Pull just THIS weekend's orders and PATCH them to the shared store —
// Replenish's _rpSyncSales recipe, narrowed to one weekend and run from
// here so sales show up without anyone opening Replenishment first.
async function _bsAutoSyncWeekend() {
  if (_bsAutoSyncing || !_bsSales || !_bsInAutoSyncWindow()) return;
  var lastRun = parseInt(localStorage.getItem('sts-bs-autosync-at') || '0', 10);
  if (Date.now() - lastRun < BS_AUTO_SYNC_THROTTLE_MS) return;

  var satKey = _bsCurrentWeekendSatKey();
  var already = _bsSales.weekends[satKey];
  if (already && already.final === true) return; // weekend's fully closed out already

  _bsAutoSyncing = true;
  localStorage.setItem('sts-bs-autosync-at', String(Date.now()));
  try {
    var fetched = await _bsFetchWeekendOrders(satKey);
    var varMap = _bsSales.varMap || (_bsSales.varMap = {});
    var unknownIds = Object.keys(fetched.byVar).filter(function(v){ return !varMap[v]; });
    var varPatch = unknownIds.length ? await _bsResolveVarIds(unknownIds) : {};
    Object.keys(varPatch).forEach(function(v){ varMap[v] = varPatch[v]; });

    var items = {};
    Object.keys(fetched.byVar).forEach(function(v) {
      var itemId = varMap[v] ? varMap[v].itemId : v;
      var name   = varMap[v] ? varMap[v].itemName : fetched.byVar[v].name;
      var e = items[itemId] = items[itemId] || { name: name, qty: 0, revenue: 0 };
      e.qty += fetched.byVar[v].qty;
      e.revenue += Math.round(fetched.byVar[v].revenue * 100) / 100;
    });
    var end = new Date(satKey + 'T00:00:00'); end.setDate(end.getDate() + 2);
    var entry = {
      label: _bsWeekendLabel(satKey),
      syncedAt: new Date().toISOString(),
      final: new Date() >= end,
      items: items,
      uncatalogued: fetched.uncatalogued,
    };

    var weekendPatch = {}; weekendPatch[satKey] = entry;
    await fetch('/api/weekend-sales', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekends: weekendPatch, varMap: varPatch }),
    });

    _bsSales.weekends[satKey] = entry;
    try { await _bsEnsureCatMap(_bsAllItemIds()); } catch (e) {}
    _bsOnHandReady = false; // this weekend may have sold something not counted yet
    bsRender();
    var vel = bsVelocity(_bsSales.weekends);
    _bsLoadOnHand(vel).then(function() {
      _bsOnHandReady = true;
      var tab = _bsView().tab;
      // Restock and Focus repaint in place; the other tabs need a full
      // re-render to pick the counts up.
      if (tab === 'restock' || tab === 'focus') _bsRenderStockTab(vel);
      else bsRender();
    });
  } catch (e) { /* silent — throttle window or next tab open retries */ }
  _bsAutoSyncing = false;
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
  html += '<div class="bs-seg" role="tablist" aria-label="View">';
  [['restock','🔧 Restock'],['focus','🎯 Focus'],['trends','📈 Trends'],['items','📋 Items']].forEach(function(t) {
    html += '<button class="bs-seg-btn' + (view.tab === t[0] ? ' active' : '') + '" role="tab" aria-selected="'
      + (view.tab === t[0]) + '" onclick="bsSetTab(\'' + t[0] + '\')">' + t[1] + '</button>';
  });
  html += '</div>';
  // Restock and Focus both read their own fixed windows (the velocity
  // lookback / the two-year design history), not the selected period, so the
  // period picker would be a dead control on either.
  if (view.tab !== 'restock' && view.tab !== 'focus') {
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
  }
  if (view.tab === 'items') {
    html += '<button class="btn btn-outline btn-sm" onclick="bsToggleSort()" title="Rank items by quantity or revenue">⇅ '
      + (view.sort === 'revenue' ? 'Revenue' : 'Qty') + '</button>';
  }
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

  if (view.tab === 'restock') {
    html += '<div id="bsRestock"></div>';
  } else if (view.tab === 'focus') {
    html += '<div id="bsFocus"></div>';
  } else if (view.tab === 'trends') {
    html += bsRenderTrendsTab(buckets, view);
  } else {
    html += bsRenderItemsTab(cur, prev, proj, vel, view, isCurrentPeriod);
  }

  el.innerHTML = html;
  _bsRenderStockTab(vel);
}

// Both stock-backed tabs paint after the shell is in the DOM, and both have
// to repaint on their own once the Square on-hand fetch lands. One entry
// point so a caller never has to know which tab is showing.
function _bsRenderStockTab(vel) {
  var tab = _bsView().tab;
  if (tab === 'restock') _bsRenderRestockBoard(vel);
  else if (tab === 'focus') _bsRenderFocusBoard();
}

// ── Items tab: flat sortable table of every item in the selected period ──
function bsRenderItemsTab(cur, prev, proj, vel, view, isCurrentPeriod) {
  var html = '';
  var delta = bsPeriodDelta(cur ? cur.revenue : 0, prev ? prev.revenue : null);
  var deltaHtml = delta == null ? 'no prior period'
    : '<span class="sales-delta ' + (delta >= 0 ? 'up' : 'down') + '">'
      + (delta >= 0 ? '+' : '') + delta.toFixed(0) + '% vs ' + _bsEsc(_bsPeriodLabel(_bsShiftPeriod(_bsPeriod, -1))) + '</span>';
  var projSub = !isCurrentPeriod
    ? 'period complete'
    : _bsMoney(proj.actual) + ' actual + ' + _bsMoney(vel.totalRevenue) + '/wknd × ' + proj.remaining + ' Sat' + (proj.remaining !== 1 ? 's' : '') + ' left';

  html += '<div class="sales-stats bs-stats-3">';
  html += statCard('📦', 'si-purple', _bsEsc(_bsPeriodLabel(_bsPeriod)) + ' Units',
    Math.round(cur ? cur.units : 0).toLocaleString(),
    (cur ? cur.satKeys.length : 0) + ' market weekend' + (cur && cur.satKeys.length === 1 ? '' : 's'));
  html += statCard('💰', 'si-gold', _bsEsc(_bsPeriodLabel(_bsPeriod)) + ' Revenue',
    _bsMoney(cur ? cur.revenue : 0), deltaHtml);
  html += statCard('📈', 'si-green', 'Projected ' + _bsEsc(_bsPeriodLabel(_bsPeriod)),
    isCurrentPeriod ? _bsMoney(proj.revenue) : _bsMoney(cur ? cur.revenue : 0),
    '<span class="bs-proj-note">' + projSub + '</span>');
  html += '</div>';

  var rows = [];
  if (cur) {
    Object.keys(cur.items).forEach(function(id) {
      if (_bsIsDiscontinued(id)) return;
      var it = cur.items[id];
      if (!(it.qty > 0)) return;
      rows.push({
        name: it.name || _bsNameOf(id), cat: _bsAppCategory(id),
        qty: it.qty, revenue: it.revenue, price: it.qty ? it.revenue / it.qty : 0,
        vel: vel.units[id] || 0, have: _bsOnHandReady ? _bsItemOnHand(id) : null,
      });
    });
  }
  var sortKey = view.sort === 'qty' ? 'qty' : 'revenue';
  rows.sort(function(a, b){ return b[sortKey] - a[sortKey]; });

  html += '<div class="sales-card sales-block">';
  html += '<div class="sales-card-head">📋 All items — ' + _bsEsc(_bsPeriodLabel(_bsPeriod)) + '</div>';
  html += '<div class="sales-card-body sales-flush">';
  if (!rows.length) {
    html += '<div class="sales-empty">No item sales recorded in ' + _bsEsc(_bsPeriodLabel(_bsPeriod)) + '.</div>';
  } else {
    html += '<div class="sales-table-wrap"><table class="sales-table"><thead><tr>';
    ['Item','Category','Qty','Revenue','Avg $','~ per wknd','On hand'].forEach(function(h) {
      html += '<th>' + h + '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function(r) {
      html += '<tr>'
        + '<td class="sales-td-label">' + _bsEsc(r.name) + '</td>'
        + '<td class="sales-td-muted">' + _bsEsc(r.cat) + '</td>'
        + '<td>' + Math.round(r.qty) + '</td>'
        + '<td>' + _bsMoney(r.revenue) + '</td>'
        + '<td>' + _bsMoney(r.price) + '</td>'
        + '<td>' + (Math.round(r.vel * 10) / 10) + '</td>'
        + '<td>' + (r.have == null ? '<span class="sales-td-muted">—</span>' : r.have) + '</td>'
        + '</tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div></div>';

  if (cur && cur.uncatalogued > 0) {
    html += '<div class="bs-footnote">⚠ ' + Math.round(cur.uncatalogued) + ' sale'
      + (Math.round(cur.uncatalogued) !== 1 ? 's' : '') + ' in ' + _bsEsc(_bsPeriodLabel(_bsPeriod))
      + ' rang up as custom amounts (no catalog item) — their revenue isn\'t in these numbers.</div>';
  }
  return html;
}

// ── Trends tab: sparkline per top item across recent periods ──
function _bsTrendHistoryKeys() {
  var keys = [], k = _bsPeriod;
  for (var i = 0; i < BS_TREND_PERIODS; i++) { keys.unshift(k); k = _bsShiftPeriod(k, -1); }
  return keys;
}

function bsRenderTrendsTab(buckets, view) {
  var cur = buckets[_bsPeriod] || null;
  var metric = view.sort === 'qty' ? 'qty' : 'revenue';
  var ranked = cur ? Object.keys(cur.items)
    .filter(function(id){ return !_bsIsDiscontinued(id) && cur.items[id][metric] > 0; })
    .sort(function(a, b){ return cur.items[b][metric] - cur.items[a][metric]; })
    .slice(0, BS_TREND_N) : [];

  if (!ranked.length) {
    return '<div class="sales-empty">No item sales recorded in ' + _bsEsc(_bsPeriodLabel(_bsPeriod)) + '.</div>';
  }

  var histKeys = _bsTrendHistoryKeys();
  var html = '<div class="bs-spark-grid">';
  ranked.forEach(function(id) {
    var hist = histKeys.map(function(k) {
      var b = buckets[k], it = b && b.items[id];
      return it ? (it[metric] || 0) : 0;
    });
    html += bsSparkCard(cur.items[id].name || _bsNameOf(id), _bsAppCategory(id), hist, metric);
  });
  html += '</div>';
  return html;
}

function bsSparkCard(name, cat, hist, metric) {
  var w = 200, h = 40, n = hist.length;
  var max = Math.max.apply(null, hist.concat([1]));
  var min = Math.min.apply(null, hist);
  var pts = hist.map(function(v, i) {
    var x = (i / (n - 1)) * w;
    var y = h - ((v - min) / ((max - min) || 1)) * (h - 4) - 2;
    return x + ',' + y;
  });
  var areaPath = 'M0,' + h + ' L' + pts.join(' L') + ' L' + w + ',' + h + ' Z';
  var first = hist[0], last = hist[n - 1];
  var pct = first ? Math.round(((last - first) / first) * 100) : (last > 0 ? 100 : 0);
  var cls = pct > 5 ? 'up' : pct < -5 ? 'down' : 'flat';
  var lastPt = pts[pts.length - 1].split(',');
  var total = hist.reduce(function(s, v){ return s + v; }, 0);
  return '<div class="spark-card">'
    + '<div class="spark-name">' + _bsEsc(name) + '</div>'
    + '<div class="spark-cat">' + _bsEsc(cat) + '</div>'
    + '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
      + '<path class="spark-area" d="' + areaPath + '"></path>'
      + '<polyline class="spark-line" points="' + pts.join(' ') + '"></polyline>'
      + '<circle class="spark-dot" cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="3"></circle>'
    + '</svg>'
    + '<div class="spark-foot"><span class="sales-td-muted">' + (metric === 'qty' ? Math.round(total) + ' pcs' : _bsMoney(total)) + '</span>'
    + '<span class="trend-pill ' + cls + '">' + (pct > 0 ? '+' : '') + pct + '%</span></div>'
  + '</div>';
}

// ── Focus tab: one design card per product family ──
function _bsRenderFocusBoard() {
  var el = document.getElementById('bsFocus');
  if (!el) return;
  if (!_bsOnHandReady) {
    el.innerHTML = '<div class="sales-empty">Checking Square stock levels…</div>';
    return;
  }
  var html = '<div class="bs-urgency-note">Units over the last 12 months against the 12 before, per design. '
    + 'Names are merged across renamed and duplicate listings; parts, add-ons and bench services are left out.</div>';
  html += bsRenderFocusCards();
  el.innerHTML = html;
}

function bsRenderFocusCards() {
  return BS_FOCUS_FAMILIES.map(bsRenderFocusCard).join('');
}

function bsRenderFocusCard(def) {
  var rows = bsFamilyFocus(def);
  if (!rows.length) return '';
  var rank = { focus: 0, watch: 1, fading: 2 };
  rows.sort(function(a, b){ return (rank[a.status] - rank[b.status]) || (b.rev - a.rev); });

  var html = '<div class="sales-card sales-block">';
  html += '<div class="sales-card-head">' + def.icon + ' ' + _bsEsc(def.title)
       + ' — last 12 months vs the 12 before</div>';
  html += '<div class="sales-card-body sales-flush">';
  html += '<div class="sales-table-wrap"><table class="sales-table"><thead><tr>';
  ['Design','12 mo','Prior 12','Last 6 mo','2-yr net','On hand','Make'].forEach(function(h) {
    html += '<th>' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  rows.forEach(function(r) {
    var pill  = r.status === 'focus' ? 'up' : r.status === 'fading' ? 'down' : 'flat';
    var label = r.status === 'focus' ? 'Focus' : r.status === 'fading' ? 'Fading' : 'Watch';
    var make  = r.status === 'fading' ? '<span class="sales-td-muted">—</span>'
              : r.make > 0 ? r.make
              : '<span class="sales-td-muted">✓</span>';
    html += '<tr>'
      + '<td class="sales-td-label">' + _bsEsc(r.name) + ' <span class="trend-pill ' + pill + '">' + label + '</span></td>'
      + '<td>' + Math.round(r.y1) + '</td>'
      + '<td class="sales-td-muted">' + Math.round(r.y0) + '</td>'
      + '<td>' + Math.round(r.recent) + '</td>'
      + '<td>' + _bsMoney(r.rev) + '</td>'
      + '<td>' + (r.have == null ? '<span class="sales-td-muted">—</span>' : r.have) + '</td>'
      + '<td>' + make + '</td>'
      + '</tr>';
  });
  html += '</tbody></table></div>';
  html += '</div></div>';
  html += '<div class="bs-footnote">Make covers ' + BS_FOCUS_COVER_MONTHS
    + ' months at the last 12 months’ rate, less what Square has on hand. ' + def.note + '</div>';
  return html;
}

// ── Restock tab: urgency board (make now / make soon / covered) ──
function _bsRenderRestockBoard(vel) {
  var el = document.getElementById('bsRestock');
  if (!el) return;
  if (!vel) vel = bsVelocity((_bsSales && _bsSales.weekends) || {});
  if (!_bsOnHandReady) {
    el.innerHTML = '<div class="sales-empty">Checking Square stock levels…</div>';
    return;
  }
  var rows = bsRestockFocus(vel, true);
  var crit    = rows.filter(function(r){ return (r.have == null || r.have <= 0) && r.make > 0; });
  var soon    = rows.filter(function(r){ return r.have > 0 && r.make > 0; });
  var covered = rows.filter(function(r){ return r.make <= 0; });
  var cols = [
    ['bad',  '🔴 Make now',  crit,    'Nothing critical right now.'],
    ['warn', '🟡 Make soon', soon,    'Nothing running low.'],
    ['good', '🟢 Covered',   covered, 'Nothing covered yet.'],
  ];

  var html = '<div class="bs-urgency-note">Cover ' + BS_COVER_WEEKENDS
    + ' market weekends at current velocity (last ' + vel.weekends + ' weekend' + (vel.weekends !== 1 ? 's' : '') + ', recent weighted heavier)</div>';
  html += '<div class="bs-urgency-cols">';
  cols.forEach(function(c) {
    html += '<div class="bs-ucol">';
    html += '<div class="bs-ucol-head"><span class="bs-dot bs-dot-' + c[0] + '"></span>' + c[1] + ' <span class="sales-td-muted">(' + c[2].length + ')</span></div>';
    if (!c[2].length) {
      html += '<div class="sales-empty" style="text-align:left;padding:16px 4px">' + c[3] + '</div>';
    } else {
      c[2].forEach(function(r) {
        html += '<div class="bs-ucard bs-ucard-' + c[0] + '">'
          + '<div class="bs-ucard-top"><span>' + _bsEsc(r.name) + '</span><span class="bs-ucard-make">' + (r.make > 0 ? r.make : '✓') + '</span></div>'
          + '<div class="bs-ucard-sub">' + _bsEsc(r.cat) + ' · ' + (r.have == null ? 'untracked' : r.have + ' on hand')
          + ' · ' + (Math.round(r.vel * 10) / 10) + '/wknd</div>'
          + '</div>';
      });
    }
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
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
