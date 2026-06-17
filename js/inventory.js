// ════════════════════════════════════════════
//  INVENTORY TAB  —  js/inventory.js
//  Reads & writes Square catalog inventory counts
// ════════════════════════════════════════════

// Square category IDs → ring sub-tabs
const INV_RING_CAT_IDS = {
  'stackable':   ['77KNH35GU32XUN7P56SOMVG2', 'AQKGEIJODPWO2JW67B6P7L7W'],
  'ring-spirit': ['ZIICMTQVHNGD4RCNGMWYS3JB'],
  'geometric':   ['R5VVEETOKEH4T2TORR4ST2DD', 'R47DX3MHU2CQ6MKWN5QLKG3T'],
  'symbolic':    ['PZBEBEWWCI3MS52THSF2E2DM'],
  'meditation':  ['KCBQ7S6OOBEATCBNCH4IWSZ5', 'A6V47F3AH7YYNTSXD7NA67PZ'],
};

// Item name substrings to exclude per ring sub-tab
const INV_RING_EXCLUDE = {
  'geometric': ['wide'],
  'symbolic': ['horseshoe', 'rainbow', 'bodhi leaf'],
};

// If set, only items whose name contains one of these substrings are shown
const INV_RING_INCLUDE = {
  'meditation': ['bodhi meditation', 'tri-color', 'orbit meditation', 'slim meditation'],
};

// Square category IDs → pendant sub-tabs
const INV_PENDANT_CAT_IDS = {
  'p-spirit':    ['UFN5Q4ZAXVYD5WREFIYDPCWR'],
  'p-geometric': ['6TDNOUPQHLK6QONBHM4VGKWJ'],
  'p-symbolic':  ['H5AOPJIVMPBEJXPSJ22GHFYZ'],
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

// Category name substrings for fallback lookup when hardcoded IDs return 0 items
const INV_CAT_NAME_HINTS = {
  'hoops': 'seamless hoop',
};

let _invData       = {};  // { [sub]: { items, counts } }
let _invDirty      = {};  // { varId: newQty } — unsaved edits
let _invCurSub     = 'ear-cuffs';
let _invRingCurSub = 'stackable';
let _invRingLoaded    = false;

let _invPendantCurSub = 'p-spirit';
let _invPendantLoaded = false;

// ── Category name fallback search ────────────────────────────────────────────

async function _invFallbackCatSearch(sub) {
  const hint = INV_CAT_NAME_HINTS[sub];
  if (!hint) return [];
  try {
    const res = await _sqFetch('/v2/catalog/list?types=CATEGORY');
    const matches = (res.objects || [])
      .filter(o => !o.is_deleted && (o.category_data?.name || '').toLowerCase().includes(hint));
    if (!matches.length) {
      console.warn(`[inv] ${sub}: no Square category found matching "${hint}"`);
      return [];
    }
    const matchedIds = matches.map(o => o.id);
    console.log(`[inv] ${sub}: fallback matched ${matches.length} category(ies):`,
      matches.map(o => `"${o.category_data.name}" (${o.id})`).join(', '),
      '— update INV_CAT_IDS to fix permanently');
    const searchRes = await _sqFetch('/v2/catalog/search-catalog-items', {
      method: 'POST',
      body: JSON.stringify({ category_ids: matchedIds }),
    });
    return (searchRes.items || []).filter(o => !o.is_deleted);
  } catch (e) {
    console.warn(`[inv] fallback search failed for ${sub}:`, e.message);
    return [];
  }
}

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

// ── Hidden items (deprecated from webapp, not Square) ────

function _invGetHidden() {
  try { return new Set(JSON.parse(localStorage.getItem('sts-inv-hidden') || '[]')); } catch { return new Set(); }
}

function _invGetHiddenVars() {
  try { return JSON.parse(localStorage.getItem('sts-inv-hidden-vars') || '[]'); } catch { return []; }
}

function invHideVar(varId, varName, itemName, sub) {
  const label = varName ? `"${varName}" (${itemName})` : `"${itemName}"`;
  if (!confirm(`Remove variation ${label} from the webapp?\n\nThis won't affect Square — restore it anytime via ⚙ Manage Items.`)) return;

  const list = _invGetHiddenVars();
  if (!list.some(v => v.varId === varId)) {
    list.push({ varId, varName, itemName });
    localStorage.setItem('sts-inv-hidden-vars', JSON.stringify(list));
  }

  // Remove from cached data and re-render immediately
  if (_invData[sub]) {
    _invData[sub].items = _invData[sub].items.map(item => {
      const filtered = (item.item_data?.variations || []).filter(v => v.id !== varId);
      if (filtered.length !== (item.item_data?.variations || []).length) {
        return { ...item, item_data: { ...item.item_data, variations: filtered } };
      }
      return item;
    });
    _invRenderSub(sub);
    _invUpdateCountLabel();
  }
}

function invHideItem(itemId, itemName, sub) {
  if (!confirm(`Remove "${itemName}" from the webapp?\n\nThis won't affect Square — you can restore it anytime via ⚙ Manage Items.`)) return;

  const hidden = _invGetHidden();
  hidden.add(itemId);
  localStorage.setItem('sts-inv-hidden', JSON.stringify([...hidden]));

  // Remove from inv-manager extras if individually assigned there
  try {
    const extra = JSON.parse(localStorage.getItem('sts-inv-extra') || '{}');
    let changed = false;
    Object.keys(extra).forEach(key => {
      const before = extra[key].length;
      extra[key] = extra[key].filter(e => e.squareId !== itemId);
      if (extra[key].length !== before) changed = true;
    });
    if (changed) localStorage.setItem('sts-inv-extra', JSON.stringify(extra));
  } catch {}

  // Remove from cached data and re-render immediately
  if (_invData[sub]) {
    _invData[sub].items = _invData[sub].items.filter(i => i.id !== itemId);
    _invRenderSub(sub);
    _invUpdateCountLabel();
  }
}

// ── Extra items from Inventory Manager ───────

function _invGetExtraEntries(sub) {
  try {
    // localStorage (set by inv-manager) takes precedence; fall back to hardcoded INV_EXTRA
    const stored = localStorage.getItem('sts-inv-extra');
    if (stored) {
      const extra = JSON.parse(stored);
      return Array.isArray(extra[sub]) ? extra[sub] : [];
    }
  } catch {}
  return (typeof INV_EXTRA !== 'undefined' && Array.isArray(INV_EXTRA[sub])) ? INV_EXTRA[sub] : [];
}

// ── Load / fetch ─────────────────────────────

async function invLoad() {
  if (_invData[_invCurSub]) return; // already loaded
  await _invLoadSub(_invCurSub);
  window._invLoaded = true;
  if (!window._invLastAddedWarmed) {
    window._invLastAddedWarmed = true;
    _invWarmLastAdded();
  }
}

async function _invLoadSub(sub) {
  let catIds = INV_CAT_IDS[sub] || INV_RING_CAT_IDS[sub] || INV_PENDANT_CAT_IDS[sub];
  if (!catIds) return;

  // Merge any extra categories/items added via the Inventory Manager
  const extraEntries = _invGetExtraEntries(sub);
  const extraCatIds  = extraEntries.filter(e => e.type === 'category').map(e => e.squareId);
  const extraItemIds = extraEntries.filter(e => e.type === 'item').map(e => e.squareId);
  if (extraCatIds.length) catIds = [...catIds, ...extraCatIds];

  _invSetPanelHtml(sub, '<div style="padding:32px;text-align:center;color:var(--text-dim)">Loading…</div>');

  try {
    // Fetch catalog items belonging to these categories
    // Uses search-catalog-items which correctly handles Square's multi-category format
    const searchRes = await _sqFetch('/v2/catalog/search-catalog-items', {
      method: 'POST',
      body: JSON.stringify({
        category_ids: catIds,
      }),
    });

    let items = (searchRes.items || []).filter(o => !o.is_deleted);
    console.log(`[inv] ${sub}: searched ${catIds.length} category ID(s), got ${items.length} item(s)`, items.map(i => i.item_data?.name));

    // Merge items from any name-matched categories (e.g. "Earrings (Seamless Hoops)")
    // so items spread across multiple Square categories all appear together
    if (INV_CAT_NAME_HINTS[sub]) {
      const fallback = await _invFallbackCatSearch(sub);
      if (fallback.length) {
        const existingIds = new Set(items.map(i => i.id));
        fallback.filter(i => !existingIds.has(i.id)).forEach(i => items.push(i));
      }
    }

    // Fetch any individually-pinned items (type:'item' entries from the manager)
    if (extraItemIds.length) {
      try {
        const batchRes = await _sqFetch('/v2/catalog/batch-retrieve', {
          method: 'POST',
          body: JSON.stringify({ object_ids: extraItemIds }),
        });
        const existing = new Set(items.map(i => i.id));
        (batchRes.objects || [])
          .filter(o => !o.is_deleted && o.type === 'ITEM' && !existing.has(o.id))
          .forEach(o => items.push(o));
      } catch (e) {
        console.warn('inv-manager extra items fetch failed:', e.message);
      }
    }

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
  const searchId = INV_RING_CAT_IDS[sub] ? 'invRingSearch' : INV_PENDANT_CAT_IDS[sub] ? 'invPendantSearch' : 'invSearch';
  const q = (document.getElementById(searchId)?.value || '').toLowerCase();

  if (!items.length) {
    _invSetPanelHtml(sub, `<div style="padding:32px;text-align:center;color:var(--text-dim)">
      <div style="font-size:15px;margin-bottom:8px;">No items found in this category</div>
      <div style="font-size:12px;max-width:340px;margin:0 auto;line-height:1.6;">
        The Square categories mapped to this tab returned 0 items.<br>
        Check the browser console for details, or use
        <button onclick="invMgrOpen()" style="background:none;border:none;color:var(--accent,#C9983A);cursor:pointer;font-size:12px;padding:0;text-decoration:underline;">⚙ Manage Items</button>
        to assign the correct Square categories to this tab.
      </div>
    </div>`);
    return;
  }

  const excludes    = (INV_RING_EXCLUDE[sub] || []).map(s => s.toLowerCase());
  const includes    = (INV_RING_INCLUDE[sub] || []).map(s => s.toLowerCase());
  const hidden      = _invGetHidden();
  const hiddenVars  = new Set(_invGetHiddenVars().map(v => v.varId));

  const lastAddedCache = _invGetLastAdded();
  let html = '';
  items.forEach(item => {
    const name = item.item_data?.name || 'Unnamed';
    const nameLower = name.toLowerCase();
    if (hidden.has(item.id)) return;
    if (q && !nameLower.includes(q)) return;
    if (excludes.some(ex => nameLower.includes(ex))) return;
    if (includes.length && !includes.some(inc => nameLower.includes(inc))) return;

    const nameSafe   = _esc(name).replace(/'/g, '&#39;');
    const lastAdded  = lastAddedCache[item.id];
    const lastDateHtml = lastAdded
      ? `<span class="inv-last-date">${_esc(_invFmtDelta(lastAdded.delta))} · ${_esc(_invFmtDate(lastAdded.isoDate))}</span>`
      : '';
    const vars = (item.item_data?.variations || []).filter(v => !v.is_deleted && !hiddenVars.has(v.id));
    if (!vars.length) return; // all variations hidden — skip card entirely

    // Pre-pass: collect low-stock variations for this item
    const lowVarsForItem = [];
    vars.forEach(v => {
      const sqQty = counts[v.id] ?? null;
      const curQty = _invDirty[v.id] !== undefined ? _invDirty[v.id] : (sqQty ?? 0);
      const threshold = _invGetThreshold(v.id);
      if (sqQty !== null && sqQty < threshold) {
        lowVarsForItem.push({ varId: v.id, varName: v.item_variation_data?.name || '', curQty, threshold });
      }
    });
    if (lowVarsForItem.length >= 2) {
      _invQueueAllData[item.id] = { itemName: name, lowVars: lowVarsForItem };
    }

    html += `<div class="inv-card" data-item-name="${_esc(name.toLowerCase())}">
      <div class="inv-card-head" style="display:flex;align-items:center;justify-content:space-between;">
        <span>${_esc(name)}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          ${lowVarsForItem.length >= 2 ? `<button class="inv-qal-btn" onclick="invOpenQueueAllLowModal('${item.id}')" title="Queue all low sizes">⚑ Queue All Low</button>` : ''}
          <button onclick="invHideItem('${item.id}','${nameSafe}','${sub}')"
            title="Remove entire item from webapp (won't affect Square)"
            style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;line-height:1;opacity:0.45;transition:opacity 0.15s,color 0.15s;"
            onmouseenter="this.style.opacity='1';this.style.color='#dc2626'"
            onmouseleave="this.style.opacity='0.45';this.style.color='var(--text-dim)'">✕</button>
        </div>
      </div>`;

    vars.forEach(v => {
      const varName   = v.item_variation_data?.name || '';
      const varId     = v.id;
      const sqQty     = counts[varId] ?? null;
      const curQty    = _invDirty[varId] !== undefined ? _invDirty[varId] : (sqQty ?? 0);
      const badge     = sqQty === null ? 'unset' : sqQty === 0 ? 'no-stock' : sqQty <= 2 ? 'low-stock' : 'in-stock';
      const badgeTxt  = sqQty === null ? 'not tracked' : sqQty === 0 ? 'out of stock' : sqQty + ' in stock';
      const dot       = sqQty === null ? '' : sqQty > 0 ? 'ok' : 'err';
      const dirty     = _invDirty[varId] !== undefined;
      const varSafe   = _esc(varName).replace(/'/g, '&#39;');
      const threshold = _invGetThreshold(varId);
      const isLow     = sqQty !== null && sqQty < threshold;

      html += `<div class="inv-row" data-var-id="${varId}">
        <div class="inv-var-name">${_esc(varName) || '(Default)'}</div>
        ${lastDateHtml}
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
        ${isLow ? `<button class="inv-queue-btn" onclick="invOpenLowStockModal('${varId}','${nameSafe}','${varSafe}',${curQty},'${sub}')" title="Add to Restock Queue">⚑ Queue</button>` : ''}
        <button onclick="invHideVar('${varId}','${varSafe}','${nameSafe}','${sub}')"
          title="Remove this variation from webapp (won't affect Square)"
          style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px;padding:2px 5px;border-radius:4px;line-height:1;opacity:0.35;transition:opacity 0.15s,color 0.15s;margin-left:2px;"
          onmouseenter="this.style.opacity='1';this.style.color='#dc2626'"
          onmouseleave="this.style.opacity='0.35';this.style.color='var(--text-dim)'">✕</button>
      </div>`;
    });

    html += '</div>';
  });

  if (!html) {
    const hiddenVarCount = _invGetHiddenVars().length;
    const hiddenItemCount = _invGetHidden().size;
    console.log(`[inv] ${sub}: ${items.length} item(s) fetched but 0 cards rendered — hidden items: ${hiddenItemCount}, hidden vars: ${hiddenVarCount}`);
  }
  _invSetPanelHtml(sub, html || '<div style="padding:24px;text-align:center;color:var(--text-dim)">No matches</div>');
}

function _invSetPanelHtml(sub, html) {
  const prefix = INV_RING_CAT_IDS[sub] ? 'inv-rsub-' : INV_PENDANT_CAT_IDS[sub] ? 'inv-psub-' : 'inv-sub-';
  const panel = document.getElementById(prefix + sub);
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

  // Capture counts before the Square write so we can compute deltas afterward
  const prevCounts = {};
  Object.keys(qtyMap).forEach(varId => {
    prevCounts[varId] = _invData[sub]?.counts[varId] ?? 0;
  });

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

  _invLogChanges(qtyMap, prevCounts, sub);
  _invRenderSub(sub);
  if (INV_RING_CAT_IDS[sub]) _invUpdateRingCountLabel();
  else if (INV_PENDANT_CAT_IDS[sub]) _invUpdatePendantCountLabel();
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
  _navSave('inv-main', type);
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
  _navSave('inv-ring-sub', sub);
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
  const includes = (INV_RING_INCLUDE[_invRingCurSub] || []).map(s => s.toLowerCase());
  const visible  = data.items.filter(i => {
    const n = (i.item_data?.name || '').toLowerCase();
    if (excludes.some(ex => n.includes(ex))) return false;
    if (includes.length && !includes.some(inc => n.includes(inc))) return false;
    return true;
  });
  const total      = visible.length;
  const outOfStock = Object.values(data.counts).filter(q => q === 0).length;
  label.textContent = total + ' item' + (total !== 1 ? 's' : '') +
    (outOfStock ? ' · ' + outOfStock + ' out of stock' : '');
}

// ── Pendants tab ─────────────────────────────

async function invLoadPendants() {
  if (_invData[_invPendantCurSub]) return;
  await _invLoadSub(_invPendantCurSub);
  _invPendantLoaded = true;
}

function invSwitchPendantSub(sub, el) {
  _invPendantCurSub = sub;
  document.querySelectorAll('.inv-pendant-sub-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.inv-pendant-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('inv-psub-' + sub);
  if (panel) panel.style.display = '';
  if (!_invData[sub]) _invLoadSub(sub);
  else _invRenderSub(sub);
  _invUpdatePendantCountLabel();
  _navSave('inv-pendant-sub', sub);
}

function invPendantFilter(val) {
  _invRenderSub(_invPendantCurSub);
}

async function invUpdateAllPendants() {
  const entries = Object.entries(_invDirty);
  if (!entries.length) { toast('No changes to save', 'ℹ'); return; }
  const btn = document.getElementById('invPendantUpdateAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await _invSaveCount(Object.fromEntries(entries), _invPendantCurSub);
    toast(entries.length + ' item' + (entries.length > 1 ? 's' : '') + ' updated ✓', '✓');
  } catch (e) {
    toast('Square error: ' + e.message, '⚠');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Update All'; }
  }
}

async function invRefreshPendants() {
  const btn = document.getElementById('invPendantRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }
  Object.keys(INV_PENDANT_CAT_IDS).forEach(sub => { delete _invData[sub]; });
  _invDirty = {};
  _invPendantLoaded = false;
  await invLoadPendants();
  if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
}

function _invUpdatePendantCountLabel() {
  const data  = _invData[_invPendantCurSub];
  const label = document.getElementById('invPendantCountLabel');
  if (!label) return;
  if (!data) { label.textContent = ''; return; }
  const total      = data.items.length;
  const outOfStock = Object.values(data.counts).filter(q => q === 0).length;
  label.textContent = total + ' item' + (total !== 1 ? 's' : '') +
    (outOfStock ? ' · ' + outOfStock + ' out of stock' : '');
}

// ── Low-stock threshold (per variation, stored in localStorage) ──────────────

function _invGetThresholds() {
  try { return JSON.parse(localStorage.getItem('sts-inv-thresholds') || '{}'); } catch { return {}; }
}
function _invGetThreshold(varId) {
  return _invGetThresholds()[varId] ?? 6;
}
function _invSaveThreshold(varId, val) {
  const t = _invGetThresholds();
  t[varId] = val;
  localStorage.setItem('sts-inv-thresholds', JSON.stringify(t));
}

// ── Low-stock modal ───────────────────────────────────────────────────────────

let _invLowStockState = {};
let _invQueueAllData  = {};
let _invQueueAllState = {};

function invOpenLowStockModal(varId, itemName, varName, curQty, sub) {
  _invLowStockState = { varId, itemName, varName, curQty, sub };
  document.getElementById('inv-ls-item-name').textContent = itemName;
  document.getElementById('inv-ls-var-name').textContent  = varName || '';
  document.getElementById('inv-ls-qty').textContent       = curQty;
  document.getElementById('inv-ls-threshold').value       = _invGetThreshold(varId);
  document.getElementById('inv-ls-modal-bg').style.display = 'flex';
}

function invCloseLowStockModal() {
  document.getElementById('inv-ls-modal-bg').style.display = 'none';
  _invLowStockState = {};
}

function invConfirmLowStockAdd() {
  const { varId, itemName, varName } = _invLowStockState;
  const threshold = Math.max(1, parseInt(document.getElementById('inv-ls-threshold').value) || 6);
  _invSaveThreshold(varId, threshold);

  const text = varName ? `${itemName} – ${varName}` : itemName;

  fetch('/api/notion-notes', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text, block: 'Inventory Restock' }),
  }).then(r => {
    if (r.ok) {
      toast(`Added "${text}" to Restock Queue ✓`, '✓');
      if (typeof refreshNotes === 'function') refreshNotes();
    } else {
      toast('Failed to add to Restock Queue', '⚠');
    }
  }).catch(() => toast('Failed to add to Restock Queue', '⚠'));

  invCloseLowStockModal();
}

// ── Queue All Low modal ───────────────────────────────────────────────────────

function invOpenQueueAllLowModal(itemId) {
  const { itemName, lowVars } = _invQueueAllData[itemId] || {};
  if (!itemName || !lowVars?.length) return;
  _invQueueAllState = { itemName, lowVars };

  document.getElementById('inv-qal-item-name').textContent = itemName;

  const list = document.getElementById('inv-qal-list');
  list.innerHTML = lowVars.map((v, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:var(--card-head-bg);border:1px solid var(--bdr);">
      <input type="checkbox" class="inv-qal-check" data-idx="${i}" checked
        style="width:16px;height:16px;accent-color:var(--accent,#C9983A);flex-shrink:0;cursor:pointer;">
      <span style="min-width:72px;font-size:13px;font-weight:600;color:var(--text);">${_esc(v.varName || '(Default)')}</span>
      <span style="font-size:11px;color:var(--text-dim);min-width:64px;">stock: ${v.curQty}</span>
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-dim);">
        qty
        <input type="number" class="inv-qal-qty" data-idx="${i}" min="1" max="99" value="3"
          style="width:50px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;font-weight:600;text-align:center;background:var(--card-bg);color:var(--text);">
      </label>
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-dim);">
        threshold
        <input type="number" class="inv-qal-threshold" data-idx="${i}" min="1" max="99" value="${v.threshold}"
          style="width:50px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;font-weight:600;text-align:center;background:var(--card-bg);color:var(--text);">
      </label>
    </div>
  `).join('');

  document.getElementById('inv-qal-modal-bg').style.display = 'flex';
}

function invCloseQueueAllLowModal() {
  document.getElementById('inv-qal-modal-bg').style.display = 'none';
  _invQueueAllState = {};
}

function invConfirmQueueAllLow() {
  const { itemName, lowVars } = _invQueueAllState;
  if (!itemName) return;

  // Save thresholds for all rows (checked and unchecked)
  document.querySelectorAll('.inv-qal-threshold').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    _invSaveThreshold(lowVars[idx].varId, Math.max(1, parseInt(inp.value) || 6));
  });

  // Build entry text from checked sizes only
  const parts = [];
  document.querySelectorAll('.inv-qal-check').forEach(chk => {
    if (!chk.checked) return;
    const idx = parseInt(chk.dataset.idx);
    const qty = Math.max(1, parseInt(document.querySelector(`.inv-qal-qty[data-idx="${idx}"]`).value) || 3);
    parts.push(`${lowVars[idx].varName} (×${qty})`);
  });

  invCloseQueueAllLowModal();

  if (!parts.length) return;

  const text = `${itemName} – ${parts.join(', ')}`;
  fetch('/api/notion-notes', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text, block: 'Inventory Restock' }),
  }).then(r => {
    if (r.ok) {
      toast(`Added to Restock Queue ✓`, '✓');
      if (typeof refreshNotes === 'function') refreshNotes();
    } else {
      toast('Failed to add to Restock Queue', '⚠');
    }
  }).catch(() => toast('Failed to add to Restock Queue', '⚠'));
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Last-Added audit trail ────────────────────────────────────────────────────

function _invGetLastAdded() {
  try { return JSON.parse(localStorage.getItem('sts-inv-last-added') || '{}'); } catch { return {}; }
}

function _invFmtDelta(delta) {
  return (delta >= 0 ? '+' : '') + delta;
}

function _invFmtDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _invFindItemForVar(varId, sub) {
  const data = _invData[sub];
  if (!data) return null;
  for (const item of data.items) {
    if ((item.item_data?.variations || []).some(v => v.id === varId)) return item;
  }
  return null;
}

function _invLogChanges(qtyMap, prevCounts, sub) {
  const cache = _invGetLastAdded();
  let changed = false;
  Object.entries(qtyMap).forEach(([varId, newQty]) => {
    const prevQty  = prevCounts[varId] ?? 0;
    const delta    = parseInt(newQty) - prevQty;
    const item     = _invFindItemForVar(varId, sub);
    if (!item) return;
    const itemId   = item.id;
    const itemName = item.item_data?.name || '';
    const varObj   = (item.item_data?.variations || []).find(v => v.id === varId);
    const varName  = varObj?.item_variation_data?.name || '';
    const isoDate  = new Date().toISOString().split('T')[0];
    cache[itemId] = { delta, isoDate, varName };
    changed = true;
    fetch('/api/notion-inv-history', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ itemId, itemName, varName, prevQty, newQty: parseInt(newQty), delta, category: sub }),
    }).catch(() => {});
  });
  if (changed) localStorage.setItem('sts-inv-last-added', JSON.stringify(cache));
}

async function _invWarmLastAdded() {
  try {
    const r = await fetch('/api/notion-inv-history');
    if (!r.ok) return;
    const data = await r.json();
    const cache = _invGetLastAdded();
    let changed = false;
    Object.entries(data).forEach(([itemId, entry]) => {
      if (!cache[itemId] || entry.isoDate > cache[itemId].isoDate) {
        cache[itemId] = entry;
        changed = true;
      }
    });
    if (!changed) return;
    localStorage.setItem('sts-inv-last-added', JSON.stringify(cache));
    if (_invData[_invCurSub])     _invRenderSub(_invCurSub);
    if (_invData[_invRingCurSub]) _invRenderSub(_invRingCurSub);
    if (_invData[_invPendantCurSub]) _invRenderSub(_invPendantCurSub);
  } catch (e) {
    console.warn('[inv] could not warm last-added cache:', e.message);
  }
}
