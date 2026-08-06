// ════════════════════════════════════════════════════════════════════════════
//  PRODUCTION REPORT — the four analysis views
//
//  Loaded after js/restock-sessions.js, which still owns the report's data
//  (fetching sessions, _rqSessionMetrics, the date-range filter, the By Design /
//  By Category rollups and the Square sales join). This file adds the layer
//  none of that computes: how long a piece actually took, and how that compares
//  to every other time the same design was made.
//
//  Views, in tab order:
//    ledger  — session cards benchmarked against their own design's history
//    makers  — per-person throughput and pace, for deciding who gets which batch
//    trends  — the same figures over time, with period-over-period deltas
//    decide  — threshold rules turned into a ranked list of things to do
//
//  Everything derives from one pass (_prDerive) so the four views can never
//  disagree with each other, the way the mockups' shared dataset did.
// ════════════════════════════════════════════════════════════════════════════

/* global _rqReportSessions, _rqReportView, _rqReportRange, _rqSales,
          _rqSessionMetrics, _rqVisibleReportIdxs, _rqRangeStartMs, _rqAggKeyForItem,
          _rqReportAgg, _rqEnsureSales, _rqSessionEditRowHTML, _rqFmtDur, _rqFmtDT,
          _rqFmtMoney, _rqEsc2, _rqMatCostFor, _rqRenderReportBody, _rqQuadrantHTML,
          RQ_SUNSET_SELLTHRU, RQ_SUNSET_MARGIN */

// ── Small formatters ────────────────────────────────────────────────────────

function _prPct(n, dp) { return n == null ? '—' : (n * 100).toFixed(dp || 0) + '%'; }

// A delta that rounds away to nothing gets no sign — "-0%" reads as a real decline.
function _prSgn(n, dp) {
  if (n == null) return '—';
  var v = Math.abs(n * 100).toFixed(dp || 0);
  return (+v === 0 ? '' : n > 0 ? '+' : '−') + v + '%';
}

function _prDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _prMedian(arr) {
  if (!arr.length) return null;
  var a = arr.slice().sort(function(x, y) { return x - y; });
  var m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Monday of the week a timestamp falls in, as YYYY-MM-DD.
function _prWeekKey(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ── Derived layer ───────────────────────────────────────────────────────────

// Pace for one session. Labor is allocated across a session's items by piece
// share (the same rule _rqReportAgg uses), which makes per-item minutes-per-piece
// identical to the session's overall netMin/totalPcs — so one figure covers the
// whole session, and a session that made two designs at once is flagged `mixed`
// rather than pretending each design's number was measured independently.
function _prPace(s) {
  var totalPcs = 0, counted = 0;
  (s.items || []).forEach(function(it) {
    if (it.pieces != null && it.pieces > 0) { totalPcs += it.pieces; counted++; }
  });
  var netMin = (s.netMs || 0) / 60000;
  var totMin = (s.totalMs || 0) / 60000;
  return {
    totalPcs: totalPcs,
    itemCount: counted,
    mixed: counted > 1,
    netMin: netMin,
    totMin: totMin,
    offMin: Math.max(0, totMin - netMin),
    // Sessions predating the Square reconciliation can carry totalMs == netMs;
    // treating that as "100% efficient" would be a fiction, so it reads null.
    eff: totMin > 0 && totMin >= netMin ? netMin / totMin : null,
    minPerPc: (totalPcs > 0 && netMin > 0) ? netMin / totalPcs : null,
  };
}

// Run history per design. Every session that made a design is one run, oldest
// first, scored against that design's own median.
function _prBuildRuns(sessions, idxs) {
  var runs = {}, byIdx = {};

  idxs.forEach(function(i) {
    var s = sessions[i];
    var p = _prPace(s);
    if (p.minPerPc == null) return;
    (s.items || []).forEach(function(it) {
      if (it.pieces == null || it.pieces <= 0) return;
      var key = _rqAggKeyForItem(it);
      var g = runs[key] || (runs[key] = { key: key, name: it.name || '—', list: [] });
      g.name = it.name || g.name;
      var run = {
        idx: i, key: key, name: it.name || '—', pcs: it.pieces,
        minPerPc: p.minPerPc, mixed: p.mixed, eff: p.eff,
        netMin: p.netMin, totMin: p.totMin, offMin: p.offMin, sessionPcs: p.totalPcs,
        when: s.startTime || s.stopTime || null,
        who: (s.employee && s.employee.name) || '',
        rate: (_rqSessionMetrics(s) || {}).rate || 0,
      };
      g.list.push(run);
      // A session's headline benchmark is its biggest item — the thing the
      // bench was actually set up for.
      if (!byIdx[i] || it.pieces > byIdx[i].pcs) byIdx[i] = run;
    });
  });

  Object.keys(runs).forEach(function(k) {
    var g = runs[k];
    g.list.sort(function(a, b) { return new Date(a.when || 0) - new Date(b.when || 0); });

    // A mixed batch's minutes-per-piece is a blend across everything that was on
    // the bench, so it is not a measurement of this design. Where there are
    // enough clean single-design runs, those alone form the comparison
    // population — and a mixed run is then shown but never ranked or scored
    // against it, because "8 twist hoops + 10 seamless hoops in 132 min" says
    // nothing about how long a twist hoop takes.
    var clean = g.list.filter(function(r) { return !r.mixed; });
    var base = clean.length >= 2 ? clean : g.list;
    var inBase = {};
    base.forEach(function(r) { inBase[r.idx] = true; });
    var paces = base.map(function(r) { return r.minPerPc; });
    g.baselineIsClean = clean.length >= 2;
    g.baseN = base.length;
    g.median = _prMedian(paces);
    g.best = Math.min.apply(null, paces);
    g.worst = Math.max.apply(null, paces);
    g.totalPcs = g.list.reduce(function(a, r) { return a + r.pcs; }, 0);
    // Counted over comparable runs only: if one person made every clean batch,
    // the "shop average" is just their own average, and scoring them against it
    // reports 0% — which reads as "exactly average" rather than "no comparison".
    g.makers = Object.keys(base.reduce(function(a, r) { if (r.who) a[r.who] = 1; return a; }, {}));

    g.list.forEach(function(r, n) {
      r.runNo = n + 1;
      r.runsTotal = g.list.length;
      r.median = g.median;
      r.best = g.best;
      r.worst = g.worst;
      r.inBase = !!inBase[r.idx];
      r.comparable = base.length;
      r.deltaPrev = n ? (r.minPerPc - g.list[n - 1].minPerPc) / g.list[n - 1].minPerPc : null;
      if (!r.inBase || base.length < 2) {
        // Either a blended batch, or the only run on record — nothing to be
        // faster or slower than.
        r.delta = null; r.rank = null; r.isBest = false;
        return;
      }
      r.delta = g.median ? (r.minPerPc - g.median) / g.median : null;
      r.rank = 1 + base.filter(function(o) { return o.minPerPc < r.minPerPc; }).length;
      r.isBest = Math.abs(r.minPerPc - g.best) < 1e-9;
    });
  });

  return { byKey: runs, byIdx: byIdx };
}

// Per-maker rollup, plus how each person's pace on a design compares to the
// shop's piece-weighted average for that same design.
function _prMakers(sessions, idxs, runs) {
  // Shop pace per design, piece-weighted, over the comparable runs only — the
  // same population the design's own median uses. A blended batch would
  // otherwise drag a design's shop average toward whatever else was on the
  // bench, and then every maker gets scored against that fiction.
  var shopPace = {}, comparable = {};
  Object.keys(runs.byKey).forEach(function(k) {
    var g = runs.byKey[k], min = 0, pcs = 0;
    comparable[k] = {};
    g.list.forEach(function(r) {
      if (!r.inBase) return;
      comparable[k][r.idx] = true;
      min += r.minPerPc * r.pcs; pcs += r.pcs;
    });
    shopPace[k] = pcs ? min / pcs : null;
  });

  var by = {};
  idxs.forEach(function(i) {
    var s = sessions[i];
    var who = (s.employee && s.employee.name) || '';
    if (!who) return;
    var m = _rqSessionMetrics(s), p = _prPace(s);
    var e = by[who] || (by[who] = {
      who: who, sessions: 0, netMin: 0, totMin: 0, pcs: 0,
      labor: 0, mat: 0, value: 0, rate: 0, _rateN: 0, designs: {},
      unpaidSessions: 0, unpaidHrs: 0,
    });
    e.sessions++;
    e.netMin += p.netMin;
    e.totMin += p.totMin;
    e.pcs += p.totalPcs;
    e.labor += m.laborCost;
    e.mat += m.matCost;
    if (m.hasAnyValue) e.value += m.itemValue;
    if (m.rate > 0) { e.rate += m.rate; e._rateN++; }
    if (m.unpaid) { e.unpaidSessions++; e.unpaidHrs += m.hrs; }
    (s.items || []).forEach(function(it) {
      if (it.pieces == null || it.pieces <= 0 || p.minPerPc == null) return;
      var key = _rqAggKeyForItem(it);
      var d = e.designs[key] || (e.designs[key] = { key: key, name: it.name || '—', min: 0, pcs: 0, seen: 0 });
      d.seen++;
      if (!comparable[key] || !comparable[key][i]) return;   // blended batch — counted, not scored
      d.min += p.minPerPc * it.pieces;
      d.pcs += it.pieces;
    });
  });

  return Object.keys(by).map(function(who) {
    var e = by[who];
    var hrs = e.netMin / 60;
    e.hrs = hrs;
    e.rate = e._rateN ? e.rate / e._rateN : 0;
    e.profit = e.value - e.labor - e.mat;
    e.pcsPerHr = hrs > 0 ? e.pcs / hrs : null;
    e.valPerHr = hrs > 0 ? e.value / hrs : null;
    // What an hour of this person's bench time turns into, against what it costs.
    e.leverage = e.labor > 0 ? e.value / e.labor : null;
    e.eff = e.totMin > 0 && e.totMin >= e.netMin ? e.netMin / e.totMin : null;
    e.paces = Object.keys(e.designs).map(function(k) {
      var d = e.designs[k];
      var mine = d.pcs ? d.min / d.pcs : null;
      var g = runs.byKey[k];
      // Sole maker → there is no shop average to beat. A "0%" here would read
      // as "exactly average" when the honest answer is "nobody else made it".
      var solo = !g || g.makers.length <= 1;
      // Every run this person made of the design was a blended batch, so there
      // is no clean figure of theirs to compare.
      var blendedOnly = mine == null;
      return {
        key: k, name: d.name, pcs: d.pcs, mine: mine, solo: solo, blendedOnly: blendedOnly,
        note: blendedOnly ? 'mixed only' : solo ? 'only maker' : null,
        rel: (solo || blendedOnly || !shopPace[k]) ? null : (mine - shopPace[k]) / shopPace[k],
      };
    }).sort(function(a, b) {
      var aq = a.rel == null, bq = b.rel == null;
      if (aq !== bq) return aq ? 1 : -1;
      if (aq) return 0;
      return a.rel - b.rel;
    });
    delete e.designs;
    delete e._rateN;
    return e;
  }).sort(function(a, b) { return b.hrs - a.hrs; });
}

// Weekly buckets. Units sold is deliberately absent — Square reports sales per
// variation over the whole range, not per week, so there is no honest way to
// split it into weeks. The trends view compares totals instead of faking a line.
function _prWeeks(sessions, idxs) {
  var wk = {};
  idxs.forEach(function(i) {
    var s = sessions[i];
    var k = _prWeekKey(s.startTime || s.stopTime);
    if (!k) return;
    var m = _rqSessionMetrics(s), p = _prPace(s);
    var w = wk[k] || (wk[k] = { k: k, pcs: 0, hrs: 0, value: 0, cost: 0, sessions: 0, byMaker: {} });
    w.sessions++;
    w.pcs += p.totalPcs;
    w.hrs += m.hrs;
    w.cost += m.laborCost + m.matCost;
    if (m.hasAnyValue) w.value += m.itemValue;
    var who = (s.employee && s.employee.name) || 'Unassigned';
    w.byMaker[who] = (w.byMaker[who] || 0) + m.hrs;
  });
  return Object.keys(wk).sort().map(function(k) { return wk[k]; });
}

// Design rollup joined to the Square sales figures for the same range.
function _prDesignRows(sessions, idxs) {
  var rows = _rqReportAgg(sessions, idxs, false).filter(function(g) { return g.key !== '__none__'; });
  var sales = _rqSales[_rqReportRange];
  var ready = sales && sales.status === 'ready';
  rows.forEach(function(g) {
    var rec = (ready && g.squareId) ? sales.byId[g.squareId] : null;
    g.sold = rec ? rec.sold : (ready && g.squareId ? 0 : null);
    g.revenue = rec ? rec.revenue : null;
    g.sellThru = (g.sold != null && g.pcs > 0) ? g.sold / g.pcs : null;
    g.sunset = g.sellThru != null && g.margin != null
      && g.sellThru < RQ_SUNSET_SELLTHRU && g.margin < RQ_SUNSET_MARGIN;
    g.minPerPc = g.pcs > 0 ? (g.hrs * 60) / g.pcs : null;
    g.profitEach = g.pcs > 0 ? g.profit / g.pcs : null;
  });
  return { rows: rows, salesReady: ready, sales: sales };
}

// Smallest "nice" step (1 / 2 / 2.5 / 5 × 10^n) that covers `max` in `n` ticks,
// so an axis reads $0 / $500 / $1.0k rather than $0 / $511 / $1,022.
function _prNiceStep(max, n) {
  var raw = max / n;
  if (!(raw > 0)) return 1;
  var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var norm = raw / mag;
  var mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

// Least-squares slope of y on x. Used for the batch-size rule.
function _prSlope(xs, ys) {
  var n = xs.length;
  if (n < 2) return 0;
  var mx = xs.reduce(function(a, b) { return a + b; }, 0) / n;
  var my = ys.reduce(function(a, b) { return a + b; }, 0) / n;
  var num = 0, den = 0;
  xs.forEach(function(x, i) { num += (x - mx) * (ys[i] - my); den += (x - mx) * (x - mx); });
  return den ? num / den : 0;
}

var PR_FINDING_FLOOR = 40;      // dollars — below this a finding is noise
var PR_FINDING_PER_KIND = 2;    // most cards any one rule may put on the board

// The rules, each returning dollars at stake so the board can rank them.
function _prFindings(sessions, idxs, runs, design) {
  var out = [];
  var rows = design.rows;
  var byKey = {};
  rows.forEach(function(g) { byKey[g.key] = g; });

  var totalHrs = 0, totalValue = 0;
  rows.forEach(function(g) { totalHrs += g.hrs; totalValue += g.value; });
  var shopValPerHr = totalHrs > 0 ? totalValue / totalHrs : 0;
  var bestValPerHr = rows.reduce(function(a, g) {
    return (g.valPerHr != null && g.valPerHr > a) ? g.valPerHr : a;
  }, 0);

  // 1 — Sunset: fails both of the report's existing thresholds.
  rows.filter(function(g) { return g.sunset; }).forEach(function(g) {
    out.push({
      kind: 'Sunset', tone: 'danger', icon: '🌅',
      title: 'Stop making ' + g.name,
      stake: Math.max(0, g.hrs * (bestValPerHr - (g.valPerHr || 0))),
      stakeLab: 'of bench time redirected',
      why: _prPct(g.sellThru) + ' sell-through and ' + _prPct(g.margin)
         + ' margin — under both of the report\'s thresholds ('
         + Math.round(RQ_SUNSET_SELLTHRU * 100) + '% / ' + Math.round(RQ_SUNSET_MARGIN * 100) + '%).',
      evid: [
        g.pcs + ' made, ' + g.sold + ' sold across ' + g.sessionCount + ' session' + (g.sessionCount !== 1 ? 's' : ''),
        g.hrs.toFixed(1) + ' bench hours returning ' + _rqFmtMoney(g.valPerHr || 0)
          + '/hr — the shop\'s best design returns ' + _rqFmtMoney(bestValPerHr) + '/hr',
        _rqFmtMoney(g.mat) + ' of material against ' + _rqFmtMoney(g.value) + ' of output value',
      ],
      view: 'design',
    });
  });

  // 2 — Reprice: demand is proven and it still returns below-average value per hour.
  rows.filter(function(g) {
    return !g.sunset && g.sellThru != null && g.sellThru >= 0.85
        && g.valPerHr != null && shopValPerHr > 0 && g.valPerHr < shopValPerHr;
  }).forEach(function(g) {
    var each = g.pcs > 0 ? g.value / g.pcs : 0;
    var suggested = Math.ceil((each * 1.15) / 2) * 2;
    // Square reports what sold in the range, not what sold of what was made in
    // it, so selling down older stock puts sell-through over 100%. That is a
    // stronger demand signal than "it sold out", not a broken number.
    var outpacing = g.sold > g.pcs;
    out.push({
      kind: 'Reprice', tone: 'warn', icon: '💲',
      title: g.name + ' is priced under its demand',
      stake: (suggested - each) * g.sold,
      stakeLab: 'at the same units sold',
      why: (outpacing
              ? 'Selling faster than the bench makes it — ' + g.sold + ' sold against ' + g.pcs + ' made'
              : _prPct(g.sellThru) + ' sell-through, so it clears what you make')
         + ' — but a bench hour on it returns ' + _rqFmtMoney(g.valPerHr)
         + ' against a shop average of ' + _rqFmtMoney(shopValPerHr) + '.',
      evid: [
        _rqFmtMoney(each) + ' each · ' + _rqFmtMoney(g.profitEach || 0) + ' profit per piece · ' + _prPct(g.margin) + ' margin',
        g.sold + ' sold, ' + g.pcs + ' made in this range'
          + (outpacing ? ' — the difference came out of stock made earlier' : ''),
        _rqFmtMoney(suggested) + ' each would lift it to about '
          + _rqFmtMoney(each > 0 ? g.valPerHr * suggested / each : 0) + '/bench hr',
      ],
      view: 'design',
    });
  });

  // 3 — Pace drift: the latest run is materially slower than the design's median.
  var drifting = {};
  Object.keys(runs.byKey).forEach(function(k) {
    var g = runs.byKey[k];
    var base = g.list.filter(function(r) { return r.inBase; });
    if (base.length < 3) return;
    var last = base[base.length - 1];
    if (last.delta == null || last.delta <= 0.12) return;
    drifting[k] = true;
    var row = byKey[k];
    var pcs = row ? row.pcs : g.totalPcs;
    out.push({
      kind: 'Pace drift', tone: 'warn', icon: '⏱',
      title: (row ? row.name : g.name) + ' is getting slower',
      stake: ((last.minPerPc - g.best) / 60) * (last.rate || 0) * pcs,
      stakeLab: 'if every piece ran at its best pace',
      why: 'The last run was ' + _prSgn(last.delta) + ' off this design\'s median of '
         + g.median.toFixed(1) + ' min/pc.',
      evid: [
        'Run history: ' + base.map(function(r) { return r.minPerPc.toFixed(1); }).join(' → ') + ' min/pc',
        'Best was ' + g.best.toFixed(1) + ' min/pc'
          + (g.baselineIsClean ? '' : ' (no single-design runs on record — this baseline blends mixed batches, so treat it loosely)'),
        last.who ? (last.who + ' ran the last batch of ' + last.pcs + ' on ' + _prDate(last.when))
                 : ('Last batch of ' + last.pcs + ' on ' + _prDate(last.when)),
      ],
      view: 'ledger',
    });
  });

  // 4 — Batch size. Skipped for designs already flagged as drifting: when batches
  // shrank and pace worsened over the same runs, the slope can't tell the two apart.
  Object.keys(runs.byKey).forEach(function(k) {
    var g = runs.byKey[k];
    if (drifting[k]) return;
    // Comparable runs only: in a blended batch the piece count is the whole
    // bench's, so it would enter the regression as a large, fast batch.
    var base = g.list.filter(function(r) { return r.inBase; });
    if (base.length < 3) return;
    var xs = base.map(function(r) { return r.pcs; });
    var ys = base.map(function(r) { return r.minPerPc; });
    var distinct = xs.filter(function(v, i) { return xs.indexOf(v) === i; }).length;
    if (distinct < 3) return;                              // needs real spread in batch size
    var slope = _prSlope(xs, ys);
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    if (slope >= -0.05 || lo <= 0 || (hi - lo) / lo < 0.15) return;
    var big = Math.max.apply(null, xs);
    var avg = Math.round(xs.reduce(function(a, b) { return a + b; }, 0) / xs.length);
    var row = byKey[k];
    var pcs = row ? row.pcs : g.totalPcs;
    var rate = base[base.length - 1].rate || 0;
    out.push({
      kind: 'Batch bigger', tone: 'info', icon: '📦',
      title: 'Run ' + (row ? row.name : g.name) + ' in bigger batches',
      stake: Math.abs(slope) * Math.max(0, big - avg) * pcs / 60 * rate,
      stakeLab: 'of labor at current volume',
      why: 'Each extra piece in the batch takes about ' + Math.abs(slope).toFixed(2)
         + ' min/pc off the whole run.',
      evid: [
        'Batches ran ' + Math.min.apply(null, xs) + '–' + big + ' pieces at '
          + hi.toFixed(1) + ' → ' + lo.toFixed(1) + ' min/pc',
        'Average batch today is ' + avg + ' pieces',
        'At ' + big + ' pieces the run lands near ' + lo.toFixed(1) + ' min/pc',
      ],
      view: 'ledger',
    });
  });

  // 5 — Clock gap: time clocked in but never on a production timer, so it is
  // missing from every design's cost. This is the only reader of dedMin.
  var offMin = 0, clkMin = 0, netMin = 0, offCost = 0;
  var worst = [];
  idxs.forEach(function(i) {
    var s = sessions[i], p = _prPace(s), m = _rqSessionMetrics(s);
    if (p.eff == null) return;
    offMin += p.offMin; clkMin += p.totMin; netMin += p.netMin;
    offCost += (p.offMin / 60) * (m.rate || 0);
    worst.push({ s: s, p: p });
  });
  if (clkMin > 0 && offMin / clkMin > 0.12) {
    worst.sort(function(a, b) { return a.p.eff - b.p.eff; });
    out.push({
      kind: 'Clock gap', tone: 'neutral', icon: '⚠',
      title: _rqFmtDur(offMin * 60000) + ' clocked in but off the timer',
      stake: offCost,
      stakeLab: 'paid, not attributed to any design',
      why: _prPct(offMin / clkMin) + ' of clocked time never landed on a production timer, '
         + 'so it is missing from every design\'s labor cost.',
      evid: worst.slice(0, 3).map(function(w) {
        var nm = (w.s.items && w.s.items[0] && w.s.items[0].name) || 'Session';
        return _prDate(w.s.startTime || w.s.stopTime) + ' · ' + ((w.s.employee && w.s.employee.name) || '—')
             + ' · ' + nm + ' — ' + _rqFmtDur(w.p.offMin * 60000) + ' off-timer of '
             + _rqFmtDur(w.p.totMin * 60000) + ' (' + _prPct(w.p.eff) + ' at the bench)';
      }),
      view: 'ledger',
    });
  }

  // 6 — Missing prices: this labor already counts against profit, but the output
  // value behind it is unknown, so every total on the page is understated.
  var unpriced = [], unpricedLabor = 0;
  idxs.forEach(function(i) {
    var m = _rqSessionMetrics(sessions[i]);
    if (m.hasAnyValue) return;
    unpriced.push(sessions[i]);
    unpricedLabor += m.laborCost;
  });
  if (unpriced.length) {
    out.push({
      kind: 'Data gap', tone: 'neutral', icon: '◐',
      title: unpriced.length + ' session' + (unpriced.length !== 1 ? 's' : '') + ' with no unit price',
      stake: unpricedLabor,
      stakeLab: 'of labor with no value against it',
      why: 'Their labor is subtracted from profit but their output value is unknown, '
         + 'so every profit figure on this page is understated.',
      evid: unpriced.slice(0, 3).map(function(s) {
        var nm = (s.items && s.items[0] && s.items[0].name) || 'Session';
        return _prDate(s.startTime || s.stopTime) + ' · ' + ((s.employee && s.employee.name) || '—') + ' · ' + nm;
      }).concat(unpriced.length > 3 ? ['…and ' + (unpriced.length - 3) + ' more'] : []),
      view: 'ledger',
    });
  }

  // Two passes of triage, because a board nobody reads is worse than no board.
  // First the dollar floor, then a per-rule cap: with enough designs the batch
  // and pace rules will each match a dozen times, and a page of nothing but
  // "run this in bigger batches" buries the one design that should be retired.
  var kept = [], counts = {}, suppressed = 0;
  out.filter(function(f) { return f.stake >= PR_FINDING_FLOOR; })
     .sort(function(a, b) { return b.stake - a.stake; })
     .forEach(function(f) {
       counts[f.kind] = (counts[f.kind] || 0) + 1;
       if (counts[f.kind] <= PR_FINDING_PER_KIND) kept.push(f);
       else suppressed++;
     });
  suppressed += out.filter(function(f) { return f.stake < PR_FINDING_FLOOR; }).length;
  return { list: kept, suppressed: suppressed };
}

// One pass per render. _rqRenderReportBody clears the cache before it dispatches,
// so the several helpers inside a single view share one computation while an edit,
// a range change or a refresh always recomputes from scratch. Caching across
// renders would go stale the moment someone edits a session's piece count in place.
var _prCache = null;

function _prDerive(sessions) {
  if (_prCache && _prCache.sessions === sessions) return _prCache;
  var idxs = _rqVisibleReportIdxs(sessions);
  var runs = _prBuildRuns(sessions, idxs);
  var design = _prDesignRows(sessions, idxs);
  _prCache = {
    sessions: sessions, idxs: idxs, runs: runs, design: design,
    makers: _prMakers(sessions, idxs, runs),
    weeks: _prWeeks(sessions, idxs),
    findings: _prFindings(sessions, idxs, runs, design),
  };
  return _prCache;
}

// Called at the top of every report render. Also drops the tooltip payloads,
// which are held in an array indexed from the generated markup.
function prInvalidate() { _prCache = null; _prTips = []; }

// ── Chart helpers ───────────────────────────────────────────────────────────
// Colours come from tokens so both themes work; the three series tokens are
// validated for colour-vision separation against the light and dark card.

var PR_SERIES = ['var(--pr-ser1)', 'var(--pr-ser2)', 'var(--pr-ser3)'];

function _prGrid(y, x1, x2, label) {
  return '<line x1="' + x1 + '" y1="' + y.toFixed(1) + '" x2="' + x2 + '" y2="' + y.toFixed(1)
       + '" stroke="var(--bdr-light)" stroke-width="1"/>'
       + '<text x="' + (x1 - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="9.5" fill="var(--text3)">'
       + label + '</text>';
}

// A tooltip payload is stashed on the node and read on hover, so the markup
// stays free of quoted HTML inside attributes.
var _prTips = [];
function _prTipRef(html) { _prTips.push(html); return _prTips.length - 1; }

function prTip(el) {
  var body = document.getElementById('prod-report-body');
  var tip = body && body.querySelector('.pr-tip');
  var i = parseInt(el.getAttribute('data-tip'), 10);
  if (!tip || isNaN(i) || _prTips[i] == null) return;
  tip.innerHTML = _prTips[i];
  tip.style.display = 'block';
  var br = body.getBoundingClientRect(), er = el.getBoundingClientRect();
  var tr = tip.getBoundingClientRect();
  var left = er.left - br.left + body.scrollLeft + er.width / 2 + 12;
  var top = er.top - br.top + body.scrollTop - 6;
  if (left + tr.width > body.clientWidth - 6) left = Math.max(4, left - tr.width - 28);
  tip.style.left = left + 'px';
  tip.style.top = Math.max(2, top) + 'px';
}

function prTipHide() {
  var body = document.getElementById('prod-report-body');
  var tip = body && body.querySelector('.pr-tip');
  if (tip) tip.style.display = 'none';
}

function _prHit(attrs, tipHtml) {
  return '<' + attrs + ' data-tip="' + _prTipRef(tipHtml) + '" tabindex="0" class="pr-hit"'
       + ' onmouseenter="prTip(this)" onmouseleave="prTipHide()" onfocus="prTip(this)" onblur="prTipHide()"/>';
}

function _prEmpty(msg) {
  return '<div class="pr-empty">' + _rqEsc2(msg) + '</div>';
}

// ── View 1: Benchmarked Ledger ──────────────────────────────────────────────

var _prLedgerMaker = 'all';
var _prLedgerOffPace = false;

function prSetLedgerMaker(who) {
  _prLedgerMaker = who;
  if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions);
}

function prToggleOffPace() {
  _prLedgerOffPace = !_prLedgerOffPace;
  if (_rqReportSessions) _rqRenderReportBody(_rqReportSessions);
}

function _prRenderLedger(sessions, idxs, body, summaryEl) {
  var d = _prDerive(sessions);
  var makers = d.makers.map(function(m) { return m.who; });

  var shown = idxs.filter(function(i) {
    var s = sessions[i];
    if (_prLedgerMaker !== 'all' && ((s.employee && s.employee.name) || '') !== _prLedgerMaker) return false;
    if (_prLedgerOffPace) {
      var r = d.runs.byIdx[i];
      if (!r || r.delta == null || Math.abs(r.delta) <= 0.08) return false;
    }
    return true;
  }).sort(function(a, b) {
    return new Date(sessions[b].startTime || sessions[b].stopTime || 0)
         - new Date(sessions[a].startTime || sessions[a].stopTime || 0);
  });

  // Summary reflects what is on screen, so the filters actually mean something.
  _prLedgerSummary(sessions, shown, summaryEl);

  var filters = '<div class="pr-filterbar">'
    + '<span class="pr-filter-lab">Maker</span>'
    + '<div class="pr-seg">'
    + '<button class="pr-seg-btn' + (_prLedgerMaker === 'all' ? ' pr-on' : '') + '" onclick="prSetLedgerMaker(\'all\')">Everyone</button>'
    + makers.map(function(w) {
        return '<button class="pr-seg-btn' + (_prLedgerMaker === w ? ' pr-on' : '') + '"'
             + ' onclick="prSetLedgerMaker(\'' + _rqEsc2(w).replace(/'/g, "\\'") + '\')">' + _rqEsc2(w) + '</button>';
      }).join('')
    + '</div>'
    + '<button class="pr-chip-btn' + (_prLedgerOffPace ? ' pr-on' : '') + '" onclick="prToggleOffPace()"'
    + ' title="Only sessions more than 8% off their design\'s median pace">⚑ Off-pace only</button>'
    + '</div>';

  if (!shown.length) {
    body.innerHTML = filters + _prEmpty('No sessions match those filters');
    return;
  }

  var cards = shown.map(function(i) {
    var s = sessions[i];
    var m = _rqSessionMetrics(s);
    var p = _prPace(s);
    var r = d.runs.byIdx[i];
    var primary = (s.items && s.items[0] && s.items[0].name) || '—';
    var extra = (s.items && s.items.length > 1) ? ' <span class="rq-sbar-pcs-inline">+' + (s.items.length - 1) + ' more</span>' : '';
    var emp = s.employee ? s.employee.name : '';

    // Pace chip. Three states: scored against the design's own history, shown
    // but not scored (a blended batch), or no piece count to work from at all.
    var paceHtml = '';
    if (!r) {
      paceHtml = '<span class="pr-pill pr-neutral" title="Pace needs a piece count on the session">no piece count</span>';
    } else if (r.delta != null) {
      var fast = r.delta < -0.05, slow = r.delta > 0.05;
      paceHtml = '<span class="pr-pill ' + (fast ? 'pr-good' : slow ? 'pr-bad' : 'pr-neutral') + '">'
        + r.minPerPc.toFixed(1) + ' min/pc · '
        + (fast ? _prSgn(-r.delta) + ' faster than usual'
                : slow ? _prSgn(r.delta) + ' slower than usual'
                : 'right on pace')
        + '</span>'
        + '<span class="pr-pill pr-neutral" title="Ranked against the '
        + r.comparable + ' comparable run' + (r.comparable !== 1 ? 's' : '') + ' of ' + _rqEsc2(r.name) + '">#'
        + r.rank + ' of ' + r.comparable + (r.isBest ? ' ★' : '') + '</span>';
    } else if (r.mixed) {
      paceHtml = '<span class="pr-pill pr-neutral" title="This session made ' + p.itemCount
        + ' designs at once, so its minutes-per-piece is a blend across the whole batch — there is nothing to compare it against">'
        + r.minPerPc.toFixed(1) + ' min/pc · mixed batch, not compared</span>';
    } else {
      paceHtml = '<span class="pr-pill pr-neutral">' + r.minPerPc.toFixed(1) + ' min/pc · first run on record</span>';
    }

    // Pace bar: this run between the design's best and worst comparable run
    var bar = '';
    if (r && r.inBase && r.comparable > 1 && r.worst > r.best) {
      var frac = (r.minPerPc - r.best) / (r.worst - r.best);
      frac = Math.max(0, Math.min(1, frac));
      var tone = r.delta < -0.05 ? 'pr-mark-good' : r.delta > 0.05 ? 'pr-mark-bad' : 'pr-mark-mid';
      bar = '<div class="pr-pacebar">'
        + '<span class="pr-pacebar-end">slowest ' + r.worst.toFixed(1) + '</span>'
        + '<div class="pr-pacebar-track"><i class="pr-pacebar-mark ' + tone + '" style="left:' + ((1 - frac) * 100).toFixed(1) + '%;"></i></div>'
        + '<span class="pr-pacebar-end pr-pacebar-end-r">' + r.best.toFixed(1) + ' best</span>'
        + '</div>';
    }

    var effHtml = '';
    if (p.eff != null) {
      var effTone = p.eff >= 0.85 ? 'pr-neutral' : p.eff >= 0.72 ? 'pr-warn' : 'pr-bad';
      effHtml = '<span class="pr-pill ' + effTone + '" title="' + Math.round(p.offMin)
        + ' min clocked in but off the production timer">Clocked ' + _rqFmtDur(p.totMin * 60000)
        + ' · ' + _prPct(p.eff) + ' at the bench</span>';
    }

    var valueTxt = m.hasAnyValue
      ? 'Value ' + _rqFmtMoney(m.itemValue) + (m.valueIsEstimate ? ' (est.)' : '')
      : 'Value —';
    var profitTxt = m.hasAnyValue
      ? 'Profit ' + _rqFmtMoney(m.profit) + (m.itemValue > 0 ? ' · ' + _prPct(m.profit / m.itemValue) : '')
      : 'Profit —';

    return '<div class="rq-session-bar pr-card ' + (r && r.delta != null
        ? (r.delta < -0.05 ? 'pr-edge-good' : r.delta > 0.05 ? 'pr-edge-bad' : 'pr-edge-flat')
        : 'pr-edge-flat') + '">'
      + '<div class="pr-card-top">'
      + '<div class="pr-card-id">'
      + '<div class="rq-sbar-name">' + _rqEsc2(primary) + extra
      + (p.totalPcs ? ' <span class="rq-sbar-pcs-inline">· ' + p.totalPcs + ' pc' + (p.totalPcs !== 1 ? 's' : '') + '</span>' : '')
      + '</div>'
      + '<div class="rq-sbar-meta">' + (emp ? _rqEsc2(emp) + ' · ' : '')
      + (s.category ? _rqEsc2(s.category) + ' · ' : '') + _prDate(s.startTime) + '</div>'
      + '</div>'
      + '<div class="pr-card-pace">' + paceHtml + '</div>'
      + '<button class="rq-sbar-del" onclick="rqDeleteReportSession(' + i + ',this)" title="Delete">✕</button>'
      + '</div>'
      + bar
      + '<div class="rq-sbar-footer pr-metrics">'
      + '<span class="rq-sbar-net">Bench ' + _rqFmtDur(s.netMs) + '</span>'
      + effHtml
      + (m.unpaid
          ? '<span class="rq-sbar-pieces" title="A deliberate non-payroll session — the hours count toward output, the cost does not">'
            + 'Labor unpaid <span class="pr-dim">(' + m.hrs.toFixed(1) + 'h)</span></span>'
          : '<span class="rq-sbar-pieces">Labor ' + _rqFmtMoney(m.laborCost) + ' <span class="pr-dim">('
            + m.hrs.toFixed(1) + 'h × ' + _rqFmtMoney(m.rate) + '/hr' + (m.rateIsEstimate ? ', est.' : '') + ')</span></span>')
      + (m.matCost > 0 ? '<span class="rq-sbar-pieces">Mat ' + _rqFmtMoney(m.matCost) + '</span>' : '')
      + '<span class="rq-sbar-pieces">' + valueTxt + '</span>'
      + '<span class="pr-pill ' + (m.hasAnyValue ? (m.profit >= 0 ? 'pr-good' : 'pr-bad') : 'pr-neutral') + '">' + profitTxt + '</span>'
      + '</div>'
      + (s.notes ? '<div class="pr-note">' + _rqEsc2(s.notes) + '</div>' : '')
      + '<div class="rq-sbar-time-row pr-actions">'
      + '<span class="rq-sbar-time-val">▶ ' + _rqFmtDT(s.startTime) + '</span>'
      + '<span class="pr-dim">·</span>'
      + '<span class="rq-sbar-time-val">⏹ ' + _rqFmtDT(s.stopTime) + '</span>'
      + '<button class="rq-sbar-act-btn" onclick="rqStartEditSession(\'report\',' + i + ')">✎ Edit</button>'
      + (s.startTime && s.stopTime
          ? '<button class="rq-sbar-act-btn" id="rq-sync-btn-report-' + i + '" onclick="rqSyncShiftsForSession(\'report\',' + i + ')">⟳ Sync</button>'
          : '')
      + '</div>'
      + _rqSessionEditRowHTML('report', i, s)
      + '</div>';
  }).join('');

  body.innerHTML = filters + cards;
}

function _prLedgerSummary(sessions, idxs, summaryEl) {
  if (!summaryEl) return;
  var labor = 0, mat = 0, value = 0, net = 0, clocked = 0, pcs = 0, unpriced = 0;
  var unpaidN = 0, unpaidHrs = 0;
  idxs.forEach(function(i) {
    var m = _rqSessionMetrics(sessions[i]), p = _prPace(sessions[i]);
    labor += m.laborCost; mat += m.matCost; pcs += p.totalPcs;
    net += p.netMin; if (p.eff != null) clocked += p.totMin;
    if (m.hasAnyValue) value += m.itemValue; else unpriced++;
    // Unpaid sessions cost nothing, so the labor total is already right — but
    // the hours behind it are real, and profit looks better than payroll would.
    if (m.unpaid) { unpaidN++; unpaidHrs += m.hrs; }
  });
  var profit = value - labor - mat;
  var tile = function(lab, val, sub, cls) {
    return '<span class="pr-tile"><b class="pr-tile-lab">' + lab + '</b>'
      + '<b class="pr-tile-val' + (cls ? ' ' + cls : '') + '">' + val + '</b>'
      + '<b class="pr-tile-sub">' + sub + '</b></span>';
  };
  summaryEl.innerHTML = '<div class="pr-tiles">'
    + tile('Sessions', idxs.length, pcs + ' piece' + (pcs !== 1 ? 's' : ''))
    + tile('Bench time', (net / 60).toFixed(1) + 'h', clocked > 0 ? _prPct(net / clocked) + ' of clocked' : 'clock not synced')
    + tile('Labor', _rqFmtMoney(labor),
           (mat > 0 ? '+ ' + _rqFmtMoney(mat) + ' material' : 'no material cost set')
           + (unpaidN ? ' · ' + unpaidHrs.toFixed(1) + 'h unpaid' : ''))
    + tile('Value made', _rqFmtMoney(value), net > 0 ? _rqFmtMoney(value / (net / 60)) + ' / bench hr' : '—')
    + tile('Profit', _rqFmtMoney(profit), value > 0 ? _prPct(profit / value) + ' margin' : '—',
           profit >= 0 ? 'pr-val-good' : 'pr-val-bad')
    + (unpriced ? '<span class="pr-tile pr-tile-warn" title="Labor from these sessions counts against profit, but their output value is unknown">'
        + '<b class="pr-tile-lab">Missing prices</b><b class="pr-tile-val">' + unpriced + '</b>'
        + '<b class="pr-tile-sub">session' + (unpriced !== 1 ? 's' : '') + '</b></span>' : '')
    + '</div>';
}

// ── View 2: Bench Scorecard ─────────────────────────────────────────────────

function _prRenderMakers(sessions, idxs, body, summaryEl) {
  var d = _prDerive(sessions);
  if (summaryEl) summaryEl.innerHTML = '';
  if (!d.makers.length) {
    body.innerHTML = _prEmpty('No sessions in this range carry an employee name');
    return;
  }

  var cards = d.makers.map(function(m, mi) {
    var ser = PR_SERIES[mi % PR_SERIES.length];
    var stat = function(lab, val, sub) {
      return '<div class="pr-stat"><div class="pr-stat-lab">' + lab + '</div>'
        + '<div class="pr-stat-val">' + val + '</div>'
        + '<div class="pr-stat-sub">' + sub + '</div></div>';
    };
    var paces = m.paces.slice(0, 6).map(function(p) {
      var cls = p.rel == null ? 'pr-neutral' : p.rel < -0.04 ? 'pr-good' : p.rel > 0.04 ? 'pr-bad' : 'pr-neutral';
      var tagTitle = p.blendedOnly
        ? 'Every batch of this design this person ran also made something else, so there is no clean pace to compare'
        : 'Nobody else has made this design, so there is no shop average to compare against';
      return '<div class="pr-pace-row">'
        + '<span class="pr-pace-name" title="' + _rqEsc2(p.name) + '">' + _rqEsc2(p.name) + '</span>'
        + '<span class="pr-pace-num">' + (p.mine != null ? p.mine.toFixed(1) + 'm' : '—') + '</span>'
        + (p.note
            ? '<span class="pr-pill pr-neutral pr-pace-tag" title="' + tagTitle + '">' + p.note + '</span>'
            : '<span class="pr-pill ' + cls + ' pr-pace-tag">' + _prSgn(p.rel) + '</span>')
        + '</div>';
    }).join('');

    return '<div class="pr-maker-card" style="border-top-color:' + ser + ';">'
      + '<div class="pr-maker-head">'
      + '<span class="pr-maker-name">' + _rqEsc2(m.who) + '</span>'
      + (m.rate > 0 ? '<span class="pr-pill pr-neutral">' + _rqFmtMoney(m.rate) + '/hr</span>' : '')
      + '<span class="pr-maker-n">' + m.sessions + ' session' + (m.sessions !== 1 ? 's' : '') + '</span>'
      + '</div>'
      + '<div class="pr-stat-grid">'
      + stat('Bench hours', m.hrs.toFixed(1) + 'h', m.eff != null ? _prPct(m.eff) + ' of clocked' : 'clock not synced')
      + stat('Pieces', m.pcs, m.pcsPerHr != null ? m.pcsPerHr.toFixed(1) + ' / hr' : '—')
      + stat('Value made', _rqFmtMoney(m.value), m.valPerHr != null ? _rqFmtMoney(m.valPerHr) + ' / hr' : '—')
      // Unpaid hours cost nothing, so leverage counts value against a labor
      // figure those hours never entered. Say so rather than print a big ×.
      + stat('Return on labor',
             m.unpaidSessions ? '—' : (m.leverage != null ? m.leverage.toFixed(1) + '×' : '—'),
             m.unpaidSessions
               ? m.unpaidHrs.toFixed(1) + 'h of ' + m.hrs.toFixed(1) + 'h unpaid'
               : _rqFmtMoney(m.labor) + ' of labor')
      + '</div>'
      + (paces ? '<div class="pr-sub-lab">Pace vs. shop average</div><div class="pr-pace-list">' + paces + '</div>' : '')
      + '</div>';
  }).join('');

  body.innerHTML = '<div class="pr-tip"></div>'
    + '<div class="pr-maker-grid">' + cards + '</div>'
    + '<div class="pr-two-col">'
    + '<div class="rq-quad-card"><div class="rq-quad-title">Bench hours by week</div>'
    + '<div class="rq-quad-sub">Stacked by maker · hover a column for that week</div>'
    + _prWeeklyStack(d) + '</div>'
    + '<div class="rq-quad-card"><div class="rq-quad-title">Where the clock goes</div>'
    + '<div class="rq-quad-sub">Bench time as a share of clocked time</div>'
    + _prEffBars(d) + '</div>'
    + '</div>'
    + '<div class="rq-agg-note">Pace compares each maker\'s piece-weighted minutes per piece against the shop '
    + 'average for the same design · batches that made several designs at once are counted in the totals but '
    + 'left out of the comparison, since their minutes-per-piece belongs to the whole batch</div>';
}

function _prWeeklyStack(d) {
  var weeks = d.weeks;
  if (!weeks.length) return _prEmpty('No dated sessions in this range');
  var order = d.makers.map(function(m) { return m.who; });
  var W = 640, H = 210, L = 36, R = 12, T = 12, B = 32;
  var pw = W - L - R, ph = H - T - B;
  var max = 0;
  weeks.forEach(function(w) { if (w.hrs > max) max = w.hrs; });
  if (max <= 0) return _prEmpty('No bench hours in this range');
  max = max * 1.12;
  var slot = pw / weeks.length, bw = Math.min(30, slot - 8);
  var Y = function(v) { return T + (1 - v / max) * ph; };

  var svg = '<svg class="pr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img"'
    + ' aria-label="Bench hours per week, stacked by maker">';
  for (var i = 0; i <= 4; i++) svg += _prGrid(Y((max / 4) * i), L, W - R, ((max / 4) * i).toFixed(0) + 'h');

  weeks.forEach(function(w, wi) {
    var x = L + wi * slot + (slot - bw) / 2, acc = 0;
    // Draw smallest-first from the baseline so the tallest band isn't split.
    order.slice().reverse().forEach(function(who, oi) {
      var v = w.byMaker[who] || 0;
      if (v <= 0) return;
      var seriesIdx = order.indexOf(who);
      var y0 = Y(acc + v), y1 = Y(acc);
      var h = Math.max(1, y1 - y0 - 2);       // 2px surface gap between segments
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + bw.toFixed(1)
           + '" height="' + h.toFixed(1) + '" rx="2" fill="' + PR_SERIES[seriesIdx % PR_SERIES.length] + '"/>';
      acc += v;
    });
    var lines = order.filter(function(who) { return (w.byMaker[who] || 0) > 0; })
      .map(function(who) { return _rqEsc2(who) + ' <b>' + w.byMaker[who].toFixed(1) + 'h</b>'; }).join('<br>');
    svg += _prHit('rect x="' + x.toFixed(1) + '" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + ph + '" fill="transparent"',
                  '<b>Week of ' + _prDate(w.k) + '</b><br>' + lines
                  + '<br>Total <b>' + w.hrs.toFixed(1) + 'h</b> · ' + w.pcs + ' pieces');
    svg += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - B + 13) + '" text-anchor="middle" font-size="9" fill="var(--text3)">'
         + _prDate(w.k) + '</text>';
  });
  svg += '</svg>';

  var legend = '<div class="pr-legend">' + order.map(function(who, i) {
    return '<span><i style="background:' + PR_SERIES[i % PR_SERIES.length] + '"></i>' + _rqEsc2(who) + '</span>';
  }).join('') + '</div>';
  return '<div class="pr-svgwrap">' + svg + '</div>' + legend;
}

function _prEffBars(d) {
  var rows = d.makers.filter(function(m) { return m.eff != null; });
  if (!rows.length) return _prEmpty('No sessions here have Square clock data yet — run ⟳ Sync Missing');
  return '<div class="pr-eff-list">' + rows.map(function(m, i) {
    var off = m.totMin - m.netMin;
    return '<div class="pr-eff-row">'
      + '<div class="pr-eff-head"><span>' + _rqEsc2(m.who) + '</span>'
      + '<span class="pr-eff-num"><b>' + _prPct(m.eff) + '</b> · ' + _rqFmtDur(off * 60000) + ' off-timer</span></div>'
      + '<div class="pr-eff-track"><i style="width:' + (m.eff * 100).toFixed(1) + '%;background:'
      + PR_SERIES[i % PR_SERIES.length] + ';"></i></div></div>';
  }).join('') + '</div>'
  + '<div class="rq-agg-note">The gap is time clocked in but off the production timer — setup, restock pulls, walk-ins.</div>';
}

// ── View 3: Trend Console ───────────────────────────────────────────────────

function _prRenderTrends(sessions, idxs, body, summaryEl) {
  var d = _prDerive(sessions);
  if (summaryEl) summaryEl.innerHTML = '';
  if (!d.weeks.length) {
    body.innerHTML = _prEmpty('No dated sessions in this range');
    return;
  }

  // Compare the selected range against the equally long window before it, so
  // "Last 30 days" reads against the 30 days before that.
  var startMs = _rqRangeStartMs(_rqReportRange);
  var cur = _prRollup(sessions, idxs);
  var prevIdxs = [];
  if (startMs != null) {
    var span = Date.now() - startMs;
    sessions.forEach(function(s, i) {
      var t = new Date(s.startTime || s.stopTime || 0).getTime();
      if (t && t >= startMs - span && t < startMs) prevIdxs.push(i);
    });
  }
  var prev = prevIdxs.length ? _prRollup(sessions, prevIdxs) : null;
  var delta = function(a, b) { return (prev && b) ? (a - b) / Math.abs(b) : null; };

  var tile = function(lab, val, dv, sub, lowerIsBetter) {
    var cls = '', txt = sub;
    if (dv != null) {
      var good = lowerIsBetter ? dv < 0 : dv > 0;
      cls = good ? 'pr-val-good' : 'pr-val-bad';
      txt = '<span class="' + cls + '">' + _prSgn(dv) + '</span> vs. prior · ' + sub;
    }
    return '<div class="pr-tile pr-tile-block"><div class="pr-tile-lab">' + lab + '</div>'
      + '<div class="pr-tile-val">' + val + '</div><div class="pr-tile-sub">' + txt + '</div></div>';
  };

  var head = '<div class="pr-tiles pr-tiles-wide">'
    + tile('Pieces made', cur.pcs, delta(cur.pcs, prev && prev.pcs), cur.sessions + ' sessions')
    + tile('Bench hours', cur.hrs.toFixed(1) + 'h', delta(cur.hrs, prev && prev.hrs),
           cur.hrs > 0 ? (cur.pcs / cur.hrs).toFixed(1) + ' pc/hr' : '—')
    + tile('Value made', _rqFmtMoney(cur.value), delta(cur.value, prev && prev.value),
           cur.hrs > 0 ? _rqFmtMoney(cur.value / cur.hrs) + '/hr' : '—')
    + tile('Cost', _rqFmtMoney(cur.labor + cur.mat), delta(cur.labor + cur.mat, prev && (prev.labor + prev.mat)),
           _rqFmtMoney(cur.labor) + ' labor', true)
    + tile('Profit', _rqFmtMoney(cur.profit), delta(cur.profit, prev && prev.profit),
           cur.value > 0 ? _prPct(cur.profit / cur.value) + ' margin' : '—')
    + tile('Margin', cur.value > 0 ? _prPct(cur.profit / cur.value) : '—',
           (prev && prev.value > 0 && cur.value > 0) ? delta(cur.profit / cur.value, prev.profit / prev.value) : null,
           (prev && prev.value > 0) ? 'was ' + _prPct(prev.profit / prev.value) : 'no prior period')
    + '</div>'
    + (prev ? '' : '<div class="rq-agg-note">Pick a bounded date range to compare against the period before it.</div>');

  body.innerHTML = '<div class="pr-tip"></div>' + head
    + '<div class="pr-two-col">'
    + '<div class="rq-quad-card"><div class="rq-quad-title">Output by week</div>'
    + '<div class="rq-quad-sub">Pieces off the bench and the hours behind them</div>'
    + _prOutputChart(d) + '</div>'
    + '<div class="rq-quad-card"><div class="rq-quad-title">Value made vs. what it cost</div>'
    + '<div class="rq-quad-sub">Retail value of output against labor + material · the gap is profit</div>'
    + _prMoneyChart(d) + '</div>'
    + '</div>'
    + '<div class="rq-quad-card"><div class="rq-quad-title">Pace trend, design by design</div>'
    + '<div class="rq-quad-sub">Minutes per piece across every comparable run · lower is faster · the delta runs first to last</div>'
    + _prSparks(d) + '</div>';
}

function _prRollup(sessions, idxs) {
  var r = { sessions: idxs.length, pcs: 0, hrs: 0, labor: 0, mat: 0, value: 0 };
  idxs.forEach(function(i) {
    var m = _rqSessionMetrics(sessions[i]), p = _prPace(sessions[i]);
    r.pcs += p.totalPcs; r.hrs += m.hrs; r.labor += m.laborCost; r.mat += m.matCost;
    if (m.hasAnyValue) r.value += m.itemValue;
  });
  r.profit = r.value - r.labor - r.mat;
  return r;
}

function _prOutputChart(d) {
  var weeks = d.weeks;
  var W = 480, H = 190, L = 34, R = 30, T = 12, B = 30;
  var pw = W - L - R, ph = H - T - B;
  var maxP = 0, maxH = 0;
  weeks.forEach(function(w) { if (w.pcs > maxP) maxP = w.pcs; if (w.hrs > maxH) maxH = w.hrs; });
  if (maxP <= 0) return _prEmpty('No counted pieces in this range');
  var step = Math.max(1, Math.ceil(_prNiceStep(maxP * 1.12, 4)));
  var max = step * 4;
  var slot = pw / weeks.length, bw = Math.min(18, slot - 8);
  var Y = function(v) { return T + (1 - v / max) * ph; };

  var svg = '<svg class="pr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Pieces made per week">';
  for (var i = 0; i <= 4; i++) svg += _prGrid(Y(step * i), L, W - R, String(step * i));
  weeks.forEach(function(w, wi) {
    var x = L + wi * slot + (slot - bw) / 2;
    var y = Y(w.pcs), h = Math.max(2, (H - B) - y);
    svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1)
         + '" height="' + h.toFixed(1) + '" rx="3" fill="var(--pr-ser1)"/>';
    svg += _prHit('rect x="' + (L + wi * slot).toFixed(1) + '" y="' + T + '" width="' + slot.toFixed(1) + '" height="' + ph + '" fill="transparent"',
                  '<b>Week of ' + _prDate(w.k) + '</b><br><b>' + w.pcs + '</b> pieces in <b>' + w.hrs.toFixed(1) + 'h</b><br>'
                  + (w.hrs > 0 ? (w.pcs / w.hrs).toFixed(1) + ' pc/hr · ' : '') + w.sessions + ' session' + (w.sessions !== 1 ? 's' : ''));
    svg += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - B + 13) + '" text-anchor="middle" font-size="9" fill="var(--text3)">'
         + _prDate(w.k) + '</text>';
  });
  // Hours ride as a line on the same plot only if it shares the scale; instead
  // it is labelled per column in the tooltip, so there is never a second y-axis.
  svg += '</svg>';
  return '<div class="pr-svgwrap">' + svg + '</div>'
    + '<div class="pr-legend"><span><i style="background:var(--pr-ser1)"></i>Pieces made · hover for the hours behind each week</span></div>';
}

function _prMoneyChart(d) {
  var weeks = d.weeks;
  var W = 480, H = 190, L = 44, R = 14, T = 12, B = 30;
  var pw = W - L - R, ph = H - T - B;
  var peak = 0;
  weeks.forEach(function(w) { peak = Math.max(peak, w.value, w.cost); });
  if (peak <= 0) return _prEmpty('No priced output in this range');
  var step = _prNiceStep(peak * 1.12, 4), max = step * 4;
  var X = function(i) { return weeks.length === 1 ? L + pw / 2 : L + (i / (weeks.length - 1)) * pw; };
  var Y = function(v) { return T + (1 - v / max) * ph; };

  var svg = '<svg class="pr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img"'
    + ' aria-label="Value made against labor and material cost, per week">';
  for (var i = 0; i <= 4; i++) {
    var v = step * i;
    svg += _prGrid(Y(v), L, W - R, v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + v.toFixed(0));
  }
  var pts = function(f) { return weeks.map(function(w, i) { return X(i).toFixed(1) + ',' + Y(w[f]).toFixed(1); }).join(' '); };
  svg += '<polygon points="' + X(0).toFixed(1) + ',' + (H - B) + ' ' + pts('value') + ' '
       + X(weeks.length - 1).toFixed(1) + ',' + (H - B) + '" fill="var(--pr-ser1-soft)"/>';
  svg += '<polyline points="' + pts('value') + '" fill="none" stroke="var(--pr-ser1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  svg += '<polyline points="' + pts('cost') + '" fill="none" stroke="var(--pr-ser2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  weeks.forEach(function(w, i) {
    svg += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(w.value).toFixed(1) + '" r="4" fill="var(--pr-ser1)" stroke="var(--card-bg)" stroke-width="2"/>'
         + '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(w.cost).toFixed(1) + '" r="4" fill="var(--pr-ser2)" stroke="var(--card-bg)" stroke-width="2"/>';
    svg += _prHit('rect x="' + (X(i) - pw / weeks.length / 2).toFixed(1) + '" y="' + T + '" width="'
                  + (pw / weeks.length).toFixed(1) + '" height="' + ph + '" fill="transparent"',
                  '<b>Week of ' + _prDate(w.k) + '</b><br>Value made <b>' + _rqFmtMoney(w.value) + '</b><br>'
                  + 'Labor + material <b>' + _rqFmtMoney(w.cost) + '</b><br>Profit <b>' + _rqFmtMoney(w.value - w.cost) + '</b>'
                  + (w.value > 0 ? ' · ' + _prPct((w.value - w.cost) / w.value) : ''));
    svg += '<text x="' + X(i).toFixed(1) + '" y="' + (H - B + 13) + '" text-anchor="middle" font-size="9" fill="var(--text3)">'
         + _prDate(w.k) + '</text>';
  });
  svg += '</svg>';
  return '<div class="pr-svgwrap">' + svg + '</div>'
    + '<div class="pr-legend"><span><i style="background:var(--pr-ser1)"></i>Value made</span>'
    + '<span><i style="background:var(--pr-ser2)"></i>Labor + material</span></div>';
}

function _prSparks(d) {
  // Comparable runs only — a blended batch on the line would read as a sudden
  // improvement that never happened.
  var series = {};
  Object.keys(d.runs.byKey).forEach(function(k) {
    var pts = d.runs.byKey[k].list.filter(function(r) { return r.inBase; });
    if (pts.length >= 2) series[k] = pts;
  });
  var keys = Object.keys(series);
  if (!keys.length) return _prEmpty('A design needs at least two comparable runs in this range before a trend means anything');
  keys.sort(function(a, b) { return d.runs.byKey[b].totalPcs - d.runs.byKey[a].totalPcs; });
  return '<div class="pr-spark-grid">' + keys.slice(0, 12).map(function(k) {
    var g = d.runs.byKey[k];
    var v = series[k].map(function(r) { return r.minPerPc; });
    var W = 150, H = 40;
    var lo = Math.min.apply(null, v) * 0.88, hi = Math.max.apply(null, v) * 1.08;
    var X = function(i) { return v.length === 1 ? W / 2 : (i / (v.length - 1)) * W; };
    var Y = function(n) { return hi === lo ? H / 2 : H - ((n - lo) / (hi - lo)) * H; };
    var pts = v.map(function(n, i) { return X(i).toFixed(1) + ',' + Y(n).toFixed(1); }).join(' ');
    var trend = v[0] > 0 ? (v[v.length - 1] - v[0]) / v[0] : null;
    var cls = trend == null ? '' : trend < -0.04 ? 'pr-val-good' : trend > 0.04 ? 'pr-val-bad' : '';
    return '<div class="pr-spark">'
      + '<div class="pr-spark-name" title="' + _rqEsc2(g.name) + '">' + _rqEsc2(g.name) + '</div>'
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="pr-spark-svg" aria-hidden="true">'
      + '<polygon points="0,' + H + ' ' + pts + ' ' + W + ',' + H + '" fill="var(--pr-ser1-soft)"/>'
      + '<polyline points="' + pts + '" fill="none" stroke="var(--pr-ser1)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>'
      + '<circle cx="' + X(v.length - 1).toFixed(1) + '" cy="' + Y(v[v.length - 1]).toFixed(1) + '" r="3" fill="var(--pr-ser1)" vector-effect="non-scaling-stroke"/>'
      + '</svg>'
      + '<div class="pr-spark-foot"><span>' + v[v.length - 1].toFixed(1) + ' m/pc</span>'
      + '<span class="' + cls + '">' + _prSgn(trend) + '</span></div>'
      + '</div>';
  }).join('') + '</div>';
}

// ── View 4: Decision Board ──────────────────────────────────────────────────

function _prRenderDecisions(sessions, idxs, body, summaryEl) {
  var d = _prDerive(sessions);
  if (summaryEl) summaryEl.innerHTML = '';

  if (!_rqSales[_rqReportRange]) _rqEnsureSales(_rqReportRange);
  var sales = _rqSales[_rqReportRange];
  var salesNote = '';
  if (!sales || sales.status === 'loading') {
    salesNote = '<div class="rq-agg-note">Loading Square sales — the sunset and reprice rules need them.</div>';
  } else if (sales.status === 'error') {
    salesNote = '<div class="rq-agg-note">Couldn’t load Square sales — '
      + '<a href="javascript:void(0)" onclick="rqRetrySales()">retry</a>. '
      + 'The sunset and reprice rules are held back until they load.</div>';
  } else if (sales.capped) {
    salesNote = '<div class="rq-agg-note">Sell-through uses the last 365 days of Square sales.</div>';
  }

  var f = d.findings;
  var totalPcs = 0;
  d.idxs.forEach(function(i) { totalPcs += _prPace(sessions[i]).totalPcs; });

  var header = '<div class="pr-board-head">'
    + '<span class="pr-board-count">' + (f.list.length
        ? '<b>' + f.list.length + '</b> thing' + (f.list.length !== 1 ? 's' : '') + ' worth doing'
        : 'Nothing above the threshold')
    + ' across ' + d.idxs.length + ' session' + (d.idxs.length !== 1 ? 's' : '')
    + ', ' + d.design.rows.length + ' design' + (d.design.rows.length !== 1 ? 's' : '')
    + ' and ' + totalPcs + ' piece' + (totalPcs !== 1 ? 's' : '') + '.</span>'
    + '<span class="pr-board-note" title="Findings are hidden when they are worth less than '
    + _rqFmtMoney(PR_FINDING_FLOOR) + ', or when the same rule already has '
    + PR_FINDING_PER_KIND + ' cards on the board">Ranked by dollars at stake'
    + (f.suppressed ? ' · ' + f.suppressed + ' smaller one' + (f.suppressed !== 1 ? 's' : '') + ' hidden' : '')
    + '</span></div>';

  var cards = f.list.length
    ? f.list.map(function(x) {
        return '<div class="pr-finding pr-edge-' + x.tone + '">'
          + '<div class="pr-finding-head">'
          + '<span class="pr-finding-icon">' + x.icon + '</span>'
          + '<span class="pr-pill pr-' + x.tone + '">' + x.kind + '</span>'
          + '<span class="pr-finding-title">' + _rqEsc2(x.title) + '</span>'
          + '<span class="pr-finding-stake"><b>' + _rqFmtMoney(x.stake) + '</b>'
          + '<i>' + _rqEsc2(x.stakeLab) + '</i></span>'
          + '</div>'
          + '<div class="pr-finding-why">' + _rqEsc2(x.why) + '</div>'
          + '<ul class="pr-finding-evid">'
          + x.evid.map(function(e) { return '<li>' + _rqEsc2(e) + '</li>'; }).join('')
          + '</ul>'
          + '<div class="pr-finding-acts">'
          + '<button class="rq-sbar-act-btn" onclick="rqSetReportView(\'' + x.view + '\')">'
          + (x.view === 'ledger' ? 'Open the sessions' : 'Open By Design') + '</button>'
          + '</div></div>';
      }).join('')
    : _prEmpty('No design in this range trips a threshold. The rules look for sunset candidates, '
             + 'underpriced sellers, pace drift, batch-size wins, off-timer clock and missing prices.');

  body.innerHTML = '<div class="pr-tip"></div>' + header + '<div class="pr-finding-list">' + cards + '</div>'
    + salesNote
    + '<div class="pr-two-col pr-two-col-top">'
    + _prQuadCard(d)
    + '<div class="rq-quad-card"><div class="rq-quad-title">The numbers behind it</div>'
    + '<div class="rq-quad-sub">Every design in range · set a material cost to sharpen the margin figures</div>'
    + _prBoardTable(d) + '</div>'
    + '</div>';
}

function _prQuadCard(d) {
  var rows = d.design.rows.filter(function(g) { return g.margin != null && g.sold != null; });
  if (rows.length < 3) {
    return '<div class="rq-quad-card"><div class="rq-quad-title">Margin vs. units sold</div>'
      + _prEmpty('Needs at least three designs with both a margin and a Square sales figure') + '</div>';
  }
  // The existing quadrant already renders exactly this, tooltips and all.
  return _rqQuadrantHTML(rows);
}

function _prBoardTable(d) {
  var rows = d.design.rows.slice().sort(function(a, b) {
    return (b.profit || 0) - (a.profit || 0);
  });
  if (!rows.length) return _prEmpty('Nothing to aggregate in this range');
  var head = '<tr><th>Design</th><th>Made</th><th>Sold</th><th>Sell-thru</th><th>Min/pc</th>'
    + '<th>Mat $/pc</th><th>Profit/pc</th><th>Margin</th><th>$/hr</th></tr>';
  var body = rows.map(function(g) {
    var mc = _rqMatCostFor(g.key);
    return '<tr>'
      + '<td title="' + _rqEsc2(g.name) + '">' + _rqEsc2(g.name) + (g.sunset ? ' <span class="rq-sunset-flag" title="Under both the sell-through and margin thresholds">🌅</span>' : '') + '</td>'
      + '<td>' + g.pcs + '</td>'
      + '<td>' + (g.sold != null ? g.sold : '—') + '</td>'
      + '<td class="' + (g.sellThru == null ? '' : g.sellThru >= 0.7 ? 'pr-val-good' : g.sellThru < RQ_SUNSET_SELLTHRU ? 'pr-val-bad' : '') + '">'
      + (g.sellThru != null ? _prPct(g.sellThru) : '—') + '</td>'
      + '<td>' + (g.minPerPc != null ? g.minPerPc.toFixed(1) : '—') + '</td>'
      + '<td><input class="rq-mat-input" type="number" min="0" step="0.01" placeholder="—" data-key="' + _rqEsc2(g.key) + '"'
      + ' value="' + (mc != null ? mc : '') + '" onchange="rqSetMatCost(this)"></td>'
      + '<td>' + (g.profitEach != null ? _rqFmtMoney(g.profitEach) : '—') + '</td>'
      + '<td class="' + (g.margin == null ? '' : g.margin >= 0.5 ? 'pr-val-good' : g.margin < RQ_SUNSET_MARGIN ? 'pr-val-bad' : 'pr-val-warn') + '">'
      + (g.margin != null ? _prPct(g.margin) : '—') + '</td>'
      + '<td>' + (g.valPerHr != null ? _rqFmtMoney(g.valPerHr) : '—') + '</td>'
      + '</tr>';
  }).join('');
  return '<div class="rq-agg-wrap"><table class="rq-agg-table pr-board-table"><thead>' + head
    + '</thead><tbody>' + body + '</tbody></table></div>';
}
