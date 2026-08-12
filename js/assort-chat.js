// ════════════════════════════════════════════
//  ASSORTMENT ASSISTANT  —  js/assort-chat.js
//  The chat panel docked beside the Assortment table. It answers questions
//  about the lineup from the numbers the page has already computed, and
//  proposes changes as chips the user clicks.
//    · Reads _rpRows / _rpActiveKeys from js/replenish.js — it never
//      fetches or recomputes anything itself, so the answer and the table
//      can never disagree.
//    · Every turn resends a freshly built briefing, so the numbers can't
//      go stale mid-conversation after a par edit or a retire.
//    · Category rollups are computed HERE, in JS, and handed to the model
//      pre-summed. Asking a model to add up 300 rows of TSV produces
//      confident, slightly wrong totals; handing it the total does not.
//    · The model NEVER writes. It may propose actions in a fenced
//      ```sts-actions block; those become chips, and only a click calls
//      rpSetField / rpAddToQueue. Unrecognised ops are dropped silently.
//  Transport is the same /api/claude-proxy path js/intake-ai-notes.js
//  uses — the ANTHROPIC_API_KEY Pages secret covers it, with the legacy
//  localStorage key as an override. Loaded AFTER js/replenish.js.
// ════════════════════════════════════════════

var AC_MODEL      = 'claude-sonnet-5';
var AC_MAX_TOKENS = 1400;
// Rough character budget for the item table in the briefing. Well inside
// the model's window; the point is latency and cost, not capacity.
var AC_TSV_BUDGET = 60000;

var _acHistory = [];   // [{role, content}] — this session only
var _acBusy    = false;
var _acActions = {};   // chipId -> action object, kept out of the DOM

var AC_SUGGESTIONS = [
  'What should I stop making?',
  'What should I build this week?',
  'How are earrings doing?',
  "What's tying up the most money?",
  'Anything trending up?',
];

function _acEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Minimal markdown ───────────────────────────
// The repo has no markdown renderer and this needs three things only.
// Escapes first, so nothing the model emits can inject markup.
function _acMd(raw) {
  var text = _acEsc(String(raw || '').trim());
  var blocks = text.split(/\n{2,}/);
  return blocks.map(function(block) {
    var lines = block.split('\n');
    var isList = lines.every(function(l){ return /^\s*[-*]\s+/.test(l) || !l.trim(); });
    var inline = function(s) {
      return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
              .replace(/`([^`]+)`/g, '<code>$1</code>');
    };
    if (isList && lines.some(function(l){ return l.trim(); })) {
      return '<ul>' + lines.filter(function(l){ return l.trim(); })
        .map(function(l){ return '<li>' + inline(l.replace(/^\s*[-*]\s+/, '')) + '</li>'; })
        .join('') + '</ul>';
    }
    return '<p>' + inline(lines.join('<br>')) + '</p>';
  }).join('');
}

// ── Briefing ───────────────────────────────────
function _acStateCounts(rows) {
  var c = {};
  rows.forEach(function(r){ c[r.state] = (c[r.state] || 0) + 1; });
  return AS_STATES.map(function(s){ return c[s.key] ? s.label + ' ' + c[s.key] : null; })
    .filter(Boolean).join(', ') || 'none';
}

function _acRollups(rows) {
  var by = {};
  rows.forEach(function(r) {
    var e = by[r.category] = by[r.category] || { n: 0, onHand: 0, units: 0, revenue: 0, tied: 0, rows: [] };
    e.n++;
    e.onHand += r.onHand;
    e.units += r.unitsLTD;
    e.revenue += r.revenueLTD;
    if (r.tied != null) e.tied += r.tied;
    e.rows.push(r);
  });
  return Object.keys(by).sort().map(function(k) {
    var e = by[k];
    return k + ': ' + e.n + ' pieces, ' + e.onHand + ' on hand, '
      + e.units + ' units sold lifetime, $' + Math.round(e.revenue) + ' revenue lifetime, $'
      + Math.round(e.tied) + ' tied up. States — ' + _acStateCounts(e.rows) + '.';
  }).join('\n');
}

function _acRowLine(r) {
  return [
    r.name,
    r.category,
    r.onHand,
    Math.round(r.velTrue * 100) / 100,
    isFinite(r.cover) ? Math.round(r.cover * 10) / 10 : 'never',
    r.sinceSale == null ? 'never' : r.sinceSale,
    r.unitsLTD,
    Math.round(r.revenueLTD),
    r.tied == null ? '' : Math.round(r.tied),
    r.trend,
    r.par == null ? '' : r.par,
    r.state,
    r.design ? r.design.id : '',
  ].join('\t');
}

function _acBriefing() {
  var rows = (typeof _rpRows !== 'undefined' && _rpRows) || [];
  var visible = typeof _rpVisibleRows === 'function' ? _rpVisibleRows() : rows;

  var header = [
    'You are the assortment advisor built into Stones Throw Studio\'s workflow app.',
    'Kyle runs a jewelry studio and sells mainly at weekend markets. Today is ' + new Date().toDateString() + '.',
    '',
    'All numbers below are already computed by the app. Use them as given — never re-derive',
    'or estimate a figure you were handed, and never invent a piece that is not listed.',
    'If the data cannot answer something, say so plainly.',
    '',
    'DEFINITIONS — read carefully, two of these are easy to confuse:',
    '- A "weekend" is one market weekend. There are ' + ((typeof _rpActiveKeys !== 'undefined' && _rpActiveKeys.length) || 0)
      + ' weekends of history where the market actually ran.',
    '- sells_per_wknd: units per market weekend, counting weekends where the market ran and this',
    '  piece sold nothing. This is the honest demand rate and it drives every retire decision.',
    '- cover: weekends of stock left at that rate. "never" means it does not sell at all.',
    '- last_sold: how many market weekends ago the last one sold. 0 = this past weekend.',
    '- tied_up: on-hand times material cost. Some are estimated from retail where a design has',
    '  no costed BOM, so treat totals as close, not exact.',
    '- par: the manually set target stock level, where one has been set. It is authoritative.',
    '- state: restock (needs building) / healthy / overstocked (selling, but far too many made) /',
    '  fading (sales trending down and gone quiet) / sunset (no sale in '
      + AS_STALE_WEEKENDS + '+ weekends) / never (in stock, never sold).',
    '',
    'CATEGORY TOTALS (already summed — use these for category questions rather than adding rows):',
    _acRollups(rows),
    '',
    'CURRENT VIEW: state filter "' + _rpFilter + '", category filter "' + _rpCatFilter + '", sorted by '
      + _rpSort.col + ' ' + _rpSort.dir + '. ' + visible.length + ' of ' + rows.length + ' pieces are on screen.',
    'If Kyle says "these" or "this list", he means the pieces on screen.',
    '',
  ].join('\n');

  var cols = 'name\tcategory\ton_hand\tsells_per_wknd\tcover\tlast_sold\tunits_lifetime\trevenue_lifetime\ttied_up\ttrend\tpar\tstate\tdesign_id';
  var all = rows.map(_acRowLine);
  var body, truncNote = '';
  if (all.join('\n').length <= AC_TSV_BUDGET) {
    body = all.join('\n');
  } else {
    // Too many pieces to send whole. Send everything on screen plus the
    // extremes overall, and SAY so — a silent truncation would produce
    // confident totals over a subset.
    var keep = {};
    visible.forEach(function(r){ keep[r.itemId] = true; });
    var byTied = rows.slice().sort(function(a, b){ return (b.tied || 0) - (a.tied || 0); });
    byTied.slice(0, 60).forEach(function(r){ keep[r.itemId] = true; });
    var byVel = rows.slice().sort(function(a, b){ return b.velTrue - a.velTrue; });
    byVel.slice(0, 60).forEach(function(r){ keep[r.itemId] = true; });
    var subset = rows.filter(function(r){ return keep[r.itemId]; });
    body = subset.map(_acRowLine).join('\n');
    truncNote = '\n\nNOTE: only ' + subset.length + ' of ' + rows.length + ' pieces are listed here '
      + '(everything on screen, plus the highest-value and fastest-selling overall). '
      + 'Say so if a question needs the full catalog, and rely on the category totals above for anything lineup-wide.';
  }

  var actions = [
    '',
    'PROPOSING ACTIONS:',
    'When a recommendation maps to something the app can do, end your reply with a fenced block',
    'labelled sts-actions containing a JSON array. Keep it to at most 4, and only for pieces that',
    'have a design_id. Do not mention the block itself — it renders as buttons.',
    'Shapes:',
    '  {"label":"Retire Moss Agate","op":"setField","designId":"...","field":"replenishmentActive","value":false}',
    '  {"label":"Set par to 6","op":"setField","designId":"...","field":"parLevel","value":6}',
    '  {"label":"Queue 4","op":"queue","designId":"...","batch":4}',
    '  {"label":"Show sunset pieces","op":"filter","state":"sunset"}',
    'Omit the block entirely when nothing needs doing.',
    '',
    'STYLE: answer in a few sentences or a short bullet list. Name pieces and figures exactly as',
    'given. Lead with the answer, not a preamble. No headings.',
  ].join('\n');

  return header + 'EVERY PIECE (tab-separated):\n' + cols + '\n' + body + truncNote + actions;
}

// ── Transport ──────────────────────────────────
async function _acClaude(messages) {
  var apiKey;
  try { apiKey = localStorage.getItem('sts-anthropic-key') || undefined; } catch (e) { apiKey = undefined; }
  var resp = await fetch('/api/claude-proxy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: apiKey, model: AC_MODEL, max_tokens: AC_MAX_TOKENS,
      system: _acBriefing(), messages: messages,
    }),
  });
  var data = await resp.json();
  if (data && data.error) throw new Error(data.error.message || 'API error');
  if (!resp.ok) throw new Error('API error ' + resp.status);
  return ((data.content && data.content[0] && data.content[0].text) || '').trim();
}

// ── Action chips ───────────────────────────────
// Splits the reply into prose and a validated action list. Anything that
// isn't a whitelisted op against a known design is dropped — the model
// cannot widen its own reach by naming a different field.
function _acParseActions(raw) {
  var m = String(raw).match(/```sts-actions\s*([\s\S]*?)```/);
  if (!m) return { text: raw, actions: [] };
  var text = raw.replace(m[0], '').trim();
  var list;
  try { list = JSON.parse(m[1].trim()); } catch (e) { return { text: text, actions: [] }; }
  if (!Array.isArray(list)) return { text: text, actions: [] };

  var designs = (typeof _rpDesigns !== 'undefined' && _rpDesigns) || [];
  var known = {};
  designs.forEach(function(d){ known[d.id] = true; });
  var FIELDS = { parLevel: 1, suggestedBatchSize: 1, replenishmentActive: 1 };
  var STATES = { all: 1 };
  (typeof AS_STATES !== 'undefined' ? AS_STATES : []).forEach(function(s){ STATES[s.key] = 1; });

  var ok = [];
  list.slice(0, 4).forEach(function(a) {
    if (!a || typeof a.label !== 'string' || !a.label.trim()) return;
    if (a.op === 'setField') {
      if (!known[a.designId] || !FIELDS[a.field]) return;
      if (a.field === 'replenishmentActive') { if (typeof a.value !== 'boolean') return; }
      else if (typeof a.value !== 'number' || a.value < 0) return;
      ok.push(a);
    } else if (a.op === 'queue') {
      if (!known[a.designId] || typeof a.batch !== 'number' || a.batch <= 0) return;
      ok.push(a);
    } else if (a.op === 'filter') {
      if (!STATES[a.state]) return;
      ok.push(a);
    }
  });
  return { text: text, actions: ok };
}

function acRunAction(chipId, btn) {
  var a = _acActions[chipId];
  if (!a) return;
  if (a.op === 'setField') rpSetField(a.designId, a.field, a.field === 'replenishmentActive' ? a.value : String(a.value));
  else if (a.op === 'queue') rpAddToQueue(a.designId, a.batch, null);
  else if (a.op === 'filter') rpSetFilter(a.state);
  if (btn && a.op !== 'filter') { btn.disabled = true; btn.textContent = '✓ ' + btn.textContent; }
}

// ── Render ─────────────────────────────────────
function _acRenderThread() {
  var el = document.getElementById('as-chat-body');
  if (!el) return;
  if (!_acHistory.length) {
    el.innerHTML = '<div class="as-chat-empty">Ask about any piece, category, or the lineup as a whole.'
      + ' Answers come from the same numbers as the table.</div>';
    return;
  }
  el.innerHTML = _acHistory.map(function(m, i) {
    if (m.role === 'user') {
      return '<div class="msg-bubble msg-bubble-self as-bub">' + _acEsc(m.content) + '</div>';
    }
    var parsed = m.parsed || { text: m.content, actions: [] };
    var html = '<div class="msg-bubble msg-bubble-other as-bub">' + _acMd(parsed.text);
    if (parsed.actions.length) {
      html += '<div class="as-acts">' + parsed.actions.map(function(a, j) {
        var id = i + '-' + j;
        _acActions[id] = a;
        var cls = (a.op === 'setField' && a.field === 'replenishmentActive' && a.value === false) ? ' as-act-warn' : '';
        return '<button class="as-act' + cls + '" onclick="acRunAction(\'' + id + '\',this)">' + _acEsc(a.label) + '</button>';
      }).join('') + '</div>';
    }
    return html + '</div>';
  }).join('');
  if (_acBusy) el.innerHTML += '<div class="msg-bubble msg-bubble-other as-bub as-thinking">Thinking…</div>';
  el.scrollTop = el.scrollHeight;
}

function acRenderPanel() {
  var sug = document.getElementById('as-chat-sugg');
  if (sug && !sug.innerHTML) {
    sug.innerHTML = AC_SUGGESTIONS.map(function(q) {
      return '<button class="as-sugg" onclick="acAsk(this.textContent)">' + _acEsc(q) + '</button>';
    }).join('');
  }
  _acRenderThread();
}

function acKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); acSend(); }
}

function acAsk(text) {
  var input = document.getElementById('as-chat-input');
  if (input) input.value = text;
  acSend();
}

async function acSend() {
  if (_acBusy) return;
  var input = document.getElementById('as-chat-input');
  var text = input ? input.value.trim() : '';
  if (!text) return;
  if (!(typeof _rpRows !== 'undefined' && _rpRows && _rpRows.length)) {
    toast('Still loading the lineup — try again in a moment', '⏳');
    return;
  }
  if (input) input.value = '';

  _acHistory.push({ role: 'user', content: text });
  _acBusy = true;
  _acRenderThread();

  try {
    var reply = await _acClaude(_acHistory.map(function(m){ return { role: m.role, content: m.content }; }));
    var parsed = _acParseActions(reply);
    _acHistory.push({ role: 'assistant', content: reply, parsed: parsed });
  } catch (e) {
    // Keep the failure in the thread rather than a toast that vanishes —
    // the question is still on screen and worth retrying.
    _acHistory.push({
      role: 'assistant',
      content: 'Could not reach the assistant — ' + (e.message || e)
        + '. Check the connection, or add an Anthropic key under ⚙ Integrations.',
      parsed: { text: 'Could not reach the assistant — ' + (e.message || e) + '.', actions: [] },
    });
  }
  _acBusy = false;
  _acRenderThread();
}

function acClear() {
  _acHistory = [];
  _acActions = {};
  _acRenderThread();
}
