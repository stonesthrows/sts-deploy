// ════════════════════════════════════════════
//  TOP SELLERS RESTOCK  —  js/top-sellers.js
//  One page that answers: what's been selling, and which of those
//  items are out of (or low on) stock right now.
//    · Sales come live from Square Orders (completed orders over a
//      selectable 7/30/90-day window) — opening the page IS the poll.
//    · On-hand counts come from Square inventory batch-retrieve,
//      same as the Replenishment tab.
//    · Default view shows ONLY items that need restocking (out of
//      stock, or under ~2 weeks of cover at the current sales pace),
//      ranked by units sold. Toggle to see all top sellers.
//    · "→ Queue" creates a Restock Queue card (Notion note, block
//      'Inventory Restock') pre-matched to the Square variation,
//      same one-tap loop as the Replenishment tab.
//  Loaded ONLY by jewelry-workflow.html, after inventory.js (needs
//  INV_LOCATION_ID) — uses toast() from app.js.
// ════════════════════════════════════════════

var _tsRows      = null;   // computed rows, newest fetch
var _tsLoading   = false;
var _tsOrderCt   = 0;      // completed orders scanned in the window
var _tsCustomUnits = 0;    // units sold with no catalog id (custom amounts) — can't be stock-checked
var _tsQueued    = {};     // variationId -> true, added to restock queue this visit
var _tsDays      = (function() {
  try { var d = parseInt(localStorage.getItem('sts-ts-days'), 10); return [7, 30, 90].indexOf(d) >= 0 ? d : 30; }
  catch (e) { return 30; }
})();
var _tsView      = 'restock';   // 'restock' | 'all'

var TS_LOW_COVER_DAYS   = 14;   // under this many days of stock left = "low"
var TS_TARGET_COVER_DAYS = 30;  // suggested make = enough for this many days at pace
var TS_MAX_ALL_ROWS     = 50;   // "all" view caps at the top N sellers

function _tsEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function topSellersInit() {
  var sel = document.getElementById('ts-days');
  if (sel) sel.value = String(_tsDays);
  tsRender(_tsRows === null);
}

// ── Data loading ───────────────────────────────

function _tsSquare(path, method, body) {
  return fetch('/api/square', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path, method: method || 'GET', body: body || undefined }),
  }).then(function(r) {
    return r.json().then(function(data) {
      if (!r.ok) throw new Error((data.errors && data.errors[0] && data.errors[0].detail) || 'Square request failed');
      return data;
    });
  });
}

// Pulls every COMPLETED order closed within the window, aggregates line
// items per catalog variation, then batch-fetches on-hand counts.
async function _tsLoadAll() {
  var end   = new Date();
  var start = new Date(end.getTime() - _tsDays * 24 * 60 * 60 * 1000);

  var byVar = {};  // variationId -> { id, name, variationName, units, revenue }
  _tsOrderCt = 0;
  _tsCustomUnits = 0;

  var cursor = null, pages = 0;
  do {
    var body = {
      location_ids: [INV_LOCATION_ID],
      limit: 500,
      query: {
        filter: {
          state_filter: { states: ['COMPLETED'] },
          date_time_filter: { closed_at: { start_at: start.toISOString(), end_at: end.toISOString() } },
        },
        sort: { sort_field: 'CLOSED_AT', sort_order: 'DESC' },
      },
    };
    if (cursor) body.cursor = cursor;
    var data = await _tsSquare('/v2/orders/search', 'POST', body);
    (data.orders || []).forEach(function(o) {
      _tsOrderCt++;
      (o.line_items || []).forEach(function(li) {
        var qty = parseFloat(li.quantity) || 0;
        if (qty <= 0) return;
        var money = (li.total_money && li.total_money.amount != null) ? li.total_money.amount
                  : (li.gross_sales_money ? li.gross_sales_money.amount : 0);
        if (!li.catalog_object_id) { _tsCustomUnits += qty; return; }
        var e = byVar[li.catalog_object_id] = byVar[li.catalog_object_id]
          || { id: li.catalog_object_id, name: li.name || 'Unnamed item', variationName: li.variation_name || '', units: 0, revenue: 0 };
        e.units   += qty;
        e.revenue += (money || 0) / 100;
      });
    });
    cursor = data.cursor || null;
    pages++;
  } while (cursor && pages < 40);

  // On-hand counts — Square caps batch-retrieve at 100 ids per call.
  // Variations with no count returned aren't inventory-tracked in Square.
  var ids = Object.keys(byVar);
  var onHand = {};
  var batches = [];
  for (var i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  await Promise.all(batches.map(function(batch) {
    return _tsSquare('/v2/inventory/counts/batch-retrieve', 'POST', {
      catalog_object_ids: batch, location_ids: [INV_LOCATION_ID],
    }).then(function(data) {
      (data.counts || []).forEach(function(c) {
        if (c.state && c.state !== 'IN_STOCK') return;
        onHand[c.catalog_object_id] = parseInt(c.quantity, 10) || 0;
      });
    }).catch(function(){});
  }));

  var rows = ids.map(function(id) {
    var e = byVar[id];
    var stock = onHand.hasOwnProperty(id) ? onHand[id] : null; // null = not tracked
    var perDay = e.units / _tsDays;
    var coverDays = stock == null ? null : (stock <= 0 ? 0 : stock / perDay);
    var status = stock == null ? 'untracked'
               : stock <= 0   ? 'out'
               : coverDays < TS_LOW_COVER_DAYS ? 'low' : 'ok';
    var suggested = stock == null ? null
      : Math.max(0, Math.ceil(e.units * TS_TARGET_COVER_DAYS / _tsDays) - Math.max(stock, 0));
    return { id: id, name: e.name, variationName: e.variationName, units: e.units,
             revenue: e.revenue, onHand: stock, coverDays: coverDays, status: status, suggested: suggested };
  });
  rows.sort(function(a, b) { return b.units - a.units || b.revenue - a.revenue; });
  _tsRows = rows;
}

// ── Render ─────────────────────────────────────

async function tsRender(reload) {
  var body = document.getElementById('ts-body');
  if (!body) return;
  if (_tsLoading) return;
  if (reload || _tsRows === null) {
    _tsLoading = true;
    body.innerHTML = '<tr><td colspan="8" class="oh-empty">Pulling ' + _tsDays + ' days of Square sales…</td></tr>';
    try {
      await _tsLoadAll();
    } catch (e) {
      _tsLoading = false;
      body.innerHTML = '<tr><td colspan="8" class="oh-empty">Could not reach Square — ' + _tsEsc(e.message || e) + '</td></tr>';
      return;
    }
    _tsLoading = false;
  }

  var all = _tsRows || [];
  var needs = all.filter(function(r) { return r.status === 'out' || r.status === 'low'; });
  var untracked = all.filter(function(r) { return r.status === 'untracked'; });
  var shown = _tsView === 'restock' ? needs : all.slice(0, TS_MAX_ALL_ROWS);

  var note = document.getElementById('ts-note');
  if (note) {
    note.textContent = _tsOrderCt + ' completed order' + (_tsOrderCt !== 1 ? 's' : '')
      + ' · ' + all.length + ' item' + (all.length !== 1 ? 's' : '') + ' sold'
      + ' · ' + needs.length + ' need' + (needs.length === 1 ? 's' : '') + ' restock';
  }
  var viewBtn = document.getElementById('ts-view-btn');
  if (viewBtn) viewBtn.textContent = _tsView === 'restock' ? 'Show all top sellers' : 'Show restock only';

  if (!shown.length) {
    body.innerHTML = '<tr><td colspan="8" class="oh-empty">'
      + (all.length
          ? (_tsView === 'restock' ? 'Every top seller is stocked 🎉 — nothing under ' + TS_LOW_COVER_DAYS + ' days of cover.' : 'No items to show.')
          : 'No completed Square sales in the last ' + _tsDays + ' days.')
      + '</td></tr>';
  } else {
    body.innerHTML = shown.map(function(r, i) {
      var rank = _tsView === 'restock' ? (all.indexOf(r) + 1) : (i + 1);
      var chip = r.status === 'out' ? '<span class="ts-chip ts-chip-out">OUT</span>'
               : r.status === 'low' ? '<span class="ts-chip ts-chip-low">LOW</span>'
               : r.status === 'untracked' ? '<span class="ts-chip ts-chip-untracked">not tracked</span>' : '';
      var stockTxt = r.onHand == null ? '—'
        : (r.onHand <= 0 ? '<span class="rp-short-n">' + r.onHand + '</span>' : r.onHand);
      var coverTxt = r.coverDays == null ? '—'
        : r.coverDays <= 0 ? '<span class="rp-short-n">0</span>'
        : r.coverDays > 999 ? '999+'
        : (r.coverDays < TS_LOW_COVER_DAYS
            ? '<span class="rp-short-n">' + Math.round(r.coverDays) + 'd</span>'
            : '<span class="rp-ok">' + Math.round(r.coverDays) + 'd</span>');
      var action = _tsQueued[r.id]
        ? '<span class="rp-ok">✓ queued</span>'
        : (r.suggested > 0
            ? '<button class="btn btn-gold btn-sm" onclick="tsAddToQueue(\'' + r.id + '\',this)">→ Queue ' + r.suggested + '</button>'
            : '—');
      return '<tr>'
        + '<td>' + rank + '</td>'
        + '<td>' + _tsEsc(r.name)
          + (r.variationName ? ' <span class="ts-sub">' + _tsEsc(r.variationName) + '</span>' : '')
          + chip + '</td>'
        + '<td>' + (Math.round(r.units * 10) / 10) + '</td>'
        + '<td>$' + Math.round(r.revenue).toLocaleString() + '</td>'
        + '<td>' + stockTxt + '</td>'
        + '<td>' + coverTxt + '</td>'
        + '<td>' + (r.suggested == null ? '—' : r.suggested) + '</td>'
        + '<td>' + action + '</td>'
        + '</tr>';
    }).join('');
  }

  var foot = document.getElementById('ts-foot');
  if (foot) {
    var bits = [];
    bits.push('Days Left = on-hand stock ÷ sales pace over the last ' + _tsDays + ' days. '
      + 'Suggested = enough to cover ~' + TS_TARGET_COVER_DAYS + ' days at that pace, minus what\'s on hand.');
    if (_tsView === 'restock' && untracked.length) {
      bits.push(untracked.length + ' sold item' + (untracked.length !== 1 ? 's aren\'t' : ' isn\'t')
        + ' inventory-tracked in Square, so stock can\'t be checked — see "Show all top sellers".');
    }
    if (_tsCustomUnits > 0) {
      bits.push(Math.round(_tsCustomUnits) + ' unit' + (_tsCustomUnits !== 1 ? 's' : '')
        + ' sold as custom amounts (no catalog item) — not shown.');
    }
    foot.innerHTML = bits.map(function(b) { return '<div>' + b + '</div>'; }).join('');
  }
}

// ── Controls ───────────────────────────────────

function tsSetDays(v) {
  var d = parseInt(v, 10);
  if ([7, 30, 90].indexOf(d) < 0) return;
  _tsDays = d;
  try { localStorage.setItem('sts-ts-days', String(d)); } catch (e) {}
  tsRender(true);
}

function tsToggleView() {
  _tsView = _tsView === 'restock' ? 'all' : 'restock';
  tsRender(false);
}

// ── One-tap add to the Restock Queue ───────────
// Same loop as the Replenishment tab: the queue card is a Notion note
// (block 'Inventory Restock') plus a restock-matches record linking it
// to the Square variation, so it arrives pre-matched.
async function tsAddToQueue(variationId, btn) {
  var r = (_tsRows || []).find(function(x) { return x.id === variationId; });
  if (!r) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  try {
    var label = r.name + (r.variationName ? ' — ' + r.variationName : '');
    var text = label + ' ×' + r.suggested;
    var res = await fetch('/api/notion-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, block: 'Inventory Restock' }),
    });
    var data = await res.json();
    if (!res.ok || !data.notionPageId) throw new Error(data.error || 'create failed');

    var patch = {};
    patch[data.notionPageId] = { id: r.id, name: label, isCustom: false, isParent: false };
    await fetch('/api/restock-matches', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(function(){}); // match is a nicety — the card exists either way

    _tsQueued[variationId] = true;
    toast('Added to Restock Queue — ' + text, '✓');
    tsRender(false);
  } catch (e) {
    toast('Could not add to queue — ' + (e.message || e), '⚠');
    if (btn) { btn.disabled = false; btn.textContent = '→ Queue ' + r.suggested; }
  }
}
