// ════════════════════════════════════════════
//  INVENTORY TAB  —  js/inventory.js
//  Reads & writes Square catalog inventory counts
// ════════════════════════════════════════════

// Square category IDs → ring sub-tabs
const INV_RING_CAT_IDS = {
  'stackable':  ['77KNH35GU32XUN7P56SOMVG2', 'AQKGEIJODPWO2JW67B6P7L7W'],
  'spirit':     ['ZIICMTQVHNGD4RCNGMWYS3JB'],
  'adjustable': ['F3ANHOLJKPDCK3BVNRG55R4A'],
  'geometric':  ['R5VVEETOKEH4T2TORR4ST2DD', 'R47DX3MHU2CQ6MKWN5QLKG3T'],
  'symbolic':   ['PZBEBEWWCI3MS52THSF2E2DM'],
  'meditation': ['KCBQ7S6OOBEATCBNCH4IWSZ5', 'A6V47F3AH7YYNTSXD7NA67PZ', 'M3YFHGUF7HUS2IZMXTIUOC6W'],
};

// Item name substrings to exclude per ring sub-tab
const INV_RING_EXCLUDE = {
  'symbolic': ['horseshoe', 'rainbow'],
};

// Square category IDs → earring sub-tabs
// Ear Cuffs root + all sub-categories; others are single category
const INV_CAT_IDS = {
  'ear-cuffs': [
    'IY23XDWOZ3YEN2DLEPJNIT6C', // Ear Cuffs (root)
    'NUZMS5Y6DMZVJ4GWHPUXG3TI', // Symbolic Ear Cuffs
    '6YKTIGGXUSMLH37NVU2J2WKU', // Geometric Ear Cuffs
    'X2EL5SDUD3RVQVMODGNUSGML', // Spirit Animal Ear Cuffs
    'GBWB4BCJM4IOZMOXBTTRMXQD', // Simple Ear Cuffs
    'UIIPEDOSUWIFVTNIUWNH3ODD',  // Stackable Cuffs
    'LPAO5E2SYDWQ6MJGETZMKK3F',  // Wide Cuff
    'SYDCP7RTDIMRL4SNL256LXX5',  // Hoop Ear Cuffs
  ],
  'dangle': ['CYMRUZ6QVO25AASWTLRC62QX'],
  'studs':  ['WOM3GRWZQTRH5WQMRVPCVQ3X', 'RAPCPCALSDEYIGCSORTSSUXO'],
  'hoops':  ['HSZ7A43DRBZDAJB4WILZUCJF', 'ZX5AUTZTN2P2Y2RKUKDA5TFT'],
  'spirit': ['BX2WS3GH5MZ37XX7DRVDP3FV'],
};

const INV_LOCATION_ID = 'D7EZ98V48F79A';

let _invData       = {};  // { [sub]: { items, counts } }
let _invDirty      = {};  // { varId: newQty } — unsaved edits
let _invCurSub     = 'ear-cuffs';
let _invRingCurSub = 'stackable';
let _invRingLoaded = false;

// ── Square API helper (routes through /api/square proxy to avoid CORS) ──────

async function _sqFetch(path, opts = {}) {
  const token = localStorage.getItem('sts-square-token');
  if (!token) throw new Error('No Square token — add it in ⚙ Integrations');

  const method = opts.method || 'GET';
  const body   = opts.body ? JSON.parse(opts.body) : undefined;

  const res = await fetch('/api/square', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, method, body, token }),
  });

  const json = await res.json();
  if (!res.ok) {
    const msg = json.errors?.[0]?.detail || json.errors?.[0]?.code || JSON.stringify(json);
    throw new Error(msg);
  }
  return json;
}

// ── Load / fetch ─────────────────────────────

async function invLoad() {
  if (_invData[_invCurSub]) return; // already loaded
  await _invLoadSub(_invCurSub);
  window._invLoaded = true;
}

async function _invLoadSub(sub) {
  const catIds = INV_CAT_IDS[sub] || INV_RING_CAT_IDS[sub];
  if (!catIds) return;

  _invSetPanelHtml(sub, '<div style="padding:32px;text-align:center;color:var(--text-dim)">Loading…</div>');

  try {
    // Fetch catalog items belonging to these categories
    const searchRes = await _sqFetch('/v2/catalog/search', {
      method: 'POST',
      body: JSON.stringify({
        object_types: ['ITEM'],
        query: {
          set_query: {
            attribute_name:   'category_id',
            attribute_values: catIds,
          },
        },
      }),
    });

    const items = (searchRes.objects || []).filter(o => !o.is_deleted);

    // Collect all variation IDs
    const varIds = [];
    items.forEach(item =>
      (item.item_data?.variations || []).forEach(v => { if (!v.is_deleted) varIds.push(v.id); })
    );

    // Fetch inventory counts
    const counts = {};
    if (varIds.length) {
      const countRes = await _sqFetch('/v2/inventory/counts/batch-retrieve', {
        method: 'POST',
        body: JSON.stringify({
          catalog_object_ids: varIds,
          location_ids: [INV_LOCATION_ID],
        }),
      });
      (countRes.counts || []).forEach(c => {
        counts[c.catalog_object_id] = parseInt(c.quantity) || 0;
      });
    }

    _invData[sub] = { items, counts };
    _invRenderSub(sub);
    _invUpdateCountLabel();
  } catch (e) {
    _invSetPanelHtml(sub,
      '<div style="padding:32px;text-align:center;color:#dc2626;font-size:13px;">' +
      '⚠ ' + _esc(e.message) + '</div>'
    );
  }
}

// ── Render ───────────────────────────────────

function _invRenderSub(sub) {
  const data = _invData[sub];
  if (!data) return;

  const { items, counts } = data;
  const q = (document.getElementById('invSearch')?.value || '').toLowerCase();

  if (!items.length) {
    _invSetPanelHtml(sub, '<div style="padding:32px;text-align:center;color:var(--text-dim)">No items found in this category</div>');
    return;
  }

  const excludes = (INV_RING_EXCLUDE[sub] || []).map(s => s.toLowerCase());

  let html = '';
  items.forEach(item => {
    const name = item.item_data?.name || 'Unnamed';
    if (q && !name.toLowerCase().includes(q)) return;
    if (excludes.some(ex => name.toLowerCase().includes(ex))) return;

    const vars = (item.item_data?.variations || []).filter(v => !v.is_deleted);
    html += `<div class="inv-card" data-item-name="${_esc(name.toLowerCase())}">
      <div class="inv-card-head">${_esc(name)}</div>`;

    vars.forEach(v => {
      const varName = v.item_variation_data?.name || '';
      const varId   = v.id;
      const sqQty   = counts[varId] ?? null;
      const curQty  = _invDirty[varId] !== undefined ? _invDirty[varId] : (sqQty ?? 0);
      const badge   = sqQty === null ? 'unset' : sqQty === 0 ? 'no-stock' : sqQty <= 2 ? 'low-stock' : 'in-stock';
      const badgeTxt= sqQty === null ? 'not tracked' : sqQty === 0 ? 'out of stock' : sqQty + ' in stock';
      const dot     = sqQty === null ? '' : sqQty > 0 ? 'ok' : 'err';
      const dirty   = _invDirty[varId] !== undefined;

      html += `<div class="inv-row" data-var-id="${varId}">
        <div class="inv-var-name">${_esc(varName) || '(Default)'}</div>
        <span class="inv-badge ${badge}">${badgeTxt}</span>
        <div class="inv-dot ${dot}"></div>
        <div class="inv-stepper">
          <button class="inv-step-btn" onclick="invStep('${varId}',-1)">−</button>
          <input class="inv-step-input" type="number" id="inv-inp-${varId}"
            value="${curQty}" min="0"
            onchange="invMarkDirty('${varId}',this.value)"
            style="${dirty ? 'background:var(--accent-bg);' : ''}">
          <button class="inv-step-btn" onclick="invStep('${varId}',1)">＋</button>
        </div>
        <button class="inv-set-btn" onclick="invSaveOne('${varId}','${sub}')">Set</button>
      </div>`;
    });

    html += '</div>';
  });

  _invSetPanelHtml(sub, html || '<div style="padding:24px;text-align:center;color:var(--text-dim)">No matches</div>');
}

function _invSetPanelHtml(sub, html) {
  const panel = document.getElementById('inv-sub-' + sub);
  if (panel) panel.innerHTML = html;
}

// ── Quantity controls ────────────────────────

function invStep(varId, delta) {
  const input = document.getElementById('inv-inp-' + varId);
  if (!input) return;
  const newVal = Math.max(0, (parseInt(input.value) || 0) + delta);
  input.value = newVal;
  invMarkDirty(varId, newVal);
  input.style.background = 'var(--accent-bg)';
}

function invMarkDirty(varId, val) {
  _invDirty[varId] = Math.max(0, parseInt(val) || 0);
  const input = document.getElementById('inv-inp-' + varId);
  if (input) input.style.background = 'var(--accent-bg)';
}

async function invSaveOne(varId, sub) {
  const input = document.getElementById('inv-inp-' + varId);
  const qty   = parseInt(input?.value) || 0;
  await _invSaveCount({ [varId]: qty }, sub);
}

async function invUpdateAll() {
  const entries = Object.entries(_invDirty);
  if (!entries.length) { toast('No changes to save', 'ℹ'); return; }

  const btn = document.getElementById('invUpdateAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    await _invSaveCount(Object.fromEntries(entries));
    toast(entries.length + ' item' + (entries.length > 1 ? 's' : '') + ' updated ✓', '✓');
  } catch (e) {
    toast('Square error: ' + e.message, '⚠');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Update All'; }
  }
}

async function _invSaveCount(qtyMap, sub) {
  sub = sub || _invCurSub;
  const changes = Object.entries(qtyMap).map(([varId, qty]) => ({
    type: 'PHYSICAL_COUNT',
    physical_count: {
      catalog_object_id: varId,
      location_id:       INV_LOCATION_ID,
      quantity:          String(qty),
      occurred_at:       new Date().toISOString(),
      state:             'IN_STOCK',
    },
  }));

  await _sqFetch('/v2/inventory/changes/batch-create', {
    method: 'POST',
    body: JSON.stringify({
      changes,
      idempotency_key: 'inv-' + Date.now(),
    }),
  });

  // Update local cache and clear dirty flags
  Object.entries(qtyMap).forEach(([varId, qty]) => {
    if (_invData[sub]) _invData[sub].counts[varId] = qty;
    delete _invDirty[varId];
  });

  _invRenderSub(sub);
  if (INV_RING_CAT_IDS[sub]) _invUpdateRingCountLabel();
  else _invUpdateCountLabel();
}

// ── Filter ───────────────────────────────────

function invFilter(val) {
  _invRenderSub(_invCurSub);
}

// ── Sub-tab switching ────────────────────────

function invSwitchSub(sub, el) {
  _invCurSub = sub;
  document.querySelectorAll('.inv-ear-sub').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.inv-sub-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('inv-sub-' + sub);
  if (panel) panel.style.display = '';
  if (!_invData[sub]) _invLoadSub(sub);
  else _invRenderSub(sub);
  _invUpdateCountLabel();
}

// ── Main tab switching (Earrings / Rings / Pendants) ──

function invSwitchMain(type) {
  document.querySelectorAll('.inv-main-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('inv-main-' + type);
  if (panel) panel.style.display = '';
  document.querySelectorAll('[id^="inv-main-tab-"]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('inv-main-tab-' + type);
  if (btn) btn.classList.add('active');
}

// ── Refresh ──────────────────────────────────

async function invRefresh() {
  const btn = document.getElementById('invRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }
  _invData  = {};
  _invDirty = {};
  window._invLoaded = false;
  await invLoad();
  if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
}

// ── Count label ──────────────────────────────

function _invUpdateCountLabel() {
  const data  = _invData[_invCurSub];
  const label = document.getElementById('invCountLabel');
  if (!label) return;
  if (!data) { label.textContent = ''; return; }
  const total      = data.items.length;
  const outOfStock = Object.values(data.counts).filter(q => q === 0).length;
  label.textContent = total + ' item' + (total !== 1 ? 's' : '') +
    (outOfStock ? ' · ' + outOfStock + ' out of stock' : '');
}

// ── Rings tab ────────────────────────────────

async function invLoadRings() {
  if (_invData[_invRingCurSub]) return;
  await _invLoadSub(_invRingCurSub);
  _invRingLoaded = true;
}

function invSwitchRingSub(sub, el) {
  _invRingCurSub = sub;
  document.querySelectorAll('.inv-ring-sub-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.inv-ring-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('inv-rsub-' + sub);
  if (panel) panel.style.display = '';
  if (!_invData[sub]) _invLoadSub(sub);
  else _invRenderSub(sub);
  _invUpdateRingCountLabel();
}

function invRingFilter(val) {
  _invRenderSub(_invRingCurSub);
}

async function invUpdateAllRings() {
  const entries = Object.entries(_invDirty);
  if (!entries.length) { toast('No changes to save', 'ℹ'); return; }
  const btn = document.getElementById('invRingUpdateAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await _invSaveCount(Object.fromEntries(entries), _invRingCurSub);
    toast(entries.length + ' item' + (entries.length > 1 ? 's' : '') + ' updated ✓', '✓');
  } catch (e) {
    toast('Square error: ' + e.message, '⚠');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Update All'; }
  }
}

async function invRefreshRings() {
  const btn = document.getElementById('invRingRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }
  Object.keys(INV_RING_CAT_IDS).forEach(sub => { delete _invData[sub]; });
  _invDirty = {};
  _invRingLoaded = false;
  await invLoadRings();
  if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
}

function _invUpdateRingCountLabel() {
  const data  = _invData[_invRingCurSub];
  const label = document.getElementById('invRingCountLabel');
  if (!label) return;
  if (!data) { label.textContent = ''; return; }
  const excludes = (INV_RING_EXCLUDE[_invRingCurSub] || []).map(s => s.toLowerCase());
  const visible  = data.items.filter(i => {
    const n = (i.item_data?.name || '').toLowerCase();
    return !excludes.some(ex => n.includes(ex));
  });
  const total      = visible.length;
  const outOfStock = Object.values(data.counts).filter(q => q === 0).length;
  label.textContent = total + ' item' + (total !== 1 ? 's' : '') +
    (outOfStock ? ' · ' + outOfStock + ' out of stock' : '');
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
