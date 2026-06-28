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

// Square category IDs → Permanent Jewelry sub-tabs
// No hardcoded categories yet — use ⚙ Manage Items to assign the matching
// Square items/categories for each charm line.
const INV_PERM_CAT_IDS = {
  'pj-birthstone': [],
  'pj-giftfill':   [],
};

// Square category IDs → Faux Nose Rings tab
// No hardcoded categories yet — use ⚙ Manage Items to assign the matching Square items/categories.
const INV_NOSERING_CAT_IDS = {
  'nose-rings': [],
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

let _invSplitCache     = {};  // { varId: { you, georgina, pageId } }
let _invSplitActiveVar = null;

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

// ── Reset a single item back to live Square state ────
// Clears any local overrides (hidden variations, thresholds, unsaved edits,
// split-stock) tied to this item's *old* variation IDs, then re-fetches the
// item fresh from Square. Use this when an item was restructured in Square
// (e.g. a single variation split into several) and the card looks stale.

async function invResetItem(itemId, itemName, sub) {
  if (!confirm(`Reset "${itemName}" to match Square?\n\nThis clears any locally hidden variations, thresholds, and unsaved edits for this item, then re-fetches it fresh from Square.`)) return;

  const data = _invData[sub];
  const oldItem = data?.items.find(i => i.id === itemId);
  const oldVarIds = (oldItem?.item_data?.variations || []).map(v => v.id);

  // Clear hidden-variation entries recorded under this item's name
  try {
    const list = _invGetHiddenVars().filter(v => v.itemName !== itemName);
    localStorage.setItem('sts-inv-hidden-vars', JSON.stringify(list));
  } catch {}

  // Clear thresholds / dirty edits tied to the old variation IDs
  try {
    const thresholds = _invGetThresholds();
    oldVarIds.forEach(id => delete thresholds[id]);
    localStorage.setItem('sts-inv-thresholds', JSON.stringify(thresholds));
  } catch {}
  oldVarIds.forEach(id => {
    delete _invDirty[id];
    delete _invSplitCache[id];
    if (data) delete data.counts[id];
  });

  try {
    const batchRes = await _sqFetch('/v2/catalog/batch-retrieve', {
      method: 'POST',
      body: JSON.stringify({ object_ids: [itemId] }),
    });
    const fresh = (batchRes.objects || []).find(o => o.id === itemId && o.type === 'ITEM' && !o.is_deleted);
    if (!fresh) {
      toast('Item not found in Square (may have been deleted)', '⚠');
      return;
    }

    if (data) {
      const idx = data.items.findIndex(i => i.id === itemId);
      if (idx >= 0) data.items[idx] = fresh; else data.items.push(fresh);

      const newVarIds = (fresh.item_data?.variations || []).filter(v => !v.is_deleted).map(v => v.id);
      if (newVarIds.length) {
        const countRes = await _sqFetch('/v2/inventory/counts/batch-retrieve', {
          method: 'POST',
          body: JSON.stringify({ catalog_object_ids: newVarIds, location_ids: [INV_LOCATION_ID] }),
        });
        (countRes.counts || []).forEach(c => {
          data.counts[c.catalog_object_id] = parseInt(c.quantity) || 0;
        });
      }
      _invRenderSub(sub);
      _invApplySplitCache(sub);
      _invUpdateCountLabel();
    }

    toast(`"${itemName}" reset to match Square ✓`, '✓');
  } catch (e) {
    toast('Square error: ' + e.message, '⚠');
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
  let catIds = INV_CAT_IDS[sub] || INV_RING_CAT_IDS[sub] || INV_PENDANT_CAT_IDS[sub] || INV_PERM_CAT_IDS[sub] || INV_NOSERING_CAT_IDS[sub];
  if (!catIds) return;

  // Merge any extra categories/items added via the Inventory Manager
  const extraEntries = _invGetExtraEntries(sub);
  const extraCatIds  = extraEntries.filter(e => e.type === 'category').map(e => e.squareId);
  const extraItemIds = extraEntries.filter(e => e.type === 'item').map(e => e.squareId);
  if (extraCatIds.length) catIds = [...catIds, ...extraCatIds];

  _invSetPanelHtml(sub, '<div style="padding:32px;text-align:center;color:var(--text-dim)">Loading…</div>');

  try {
    // Fetch catalog items belonging to these categories
    // Uses search-catalog-items which correctly handles Square's multi-category format.
    // Square treats an empty category_ids array as "no filter" (returns everything), so
    // skip the search entirely when there are no category IDs to filter on.
    let items = [];
    if (catIds.length) {
      const searchRes = await _sqFetch('/v2/catalog/search-catalog-items', {
        method: 'POST',
        body: JSON.stringify({
          category_ids: catIds,
        }),
      });
      items = (searchRes.items || []).filter(o => !o.is_deleted);
      console.log(`[inv] ${sub}: searched ${catIds.length} category ID(s), got ${items.length} item(s)`, items.map(i => i.item_data?.name));
    }

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
    _invLoadSplit(sub);
  } catch (e) {
    _invSetPanelHtml(sub,
      '<div style="padding:32px;text-align:center;color:#dc2626;font-size:13px;">' +
      '⚠ ' + _esc(e.message) + '</div>'
    );
  }
}

// ── Variant row tint (by material/style keywords) ────────────────────────────

function _invVarTint(varName) {
  const n = varName.toLowerCase();
  const orbMatch = n.match(/(\d+)\s+orbs?/);
  if (orbMatch) {
    const orbs = parseInt(orbMatch[1]);
    if (orbs === 1) return '#EEF4FD';
    if (orbs === 2) return '#EEF7F1';
    if (orbs === 3) return '#FDF5EE';
  }
  const isSingle = n.includes('single');
  const isDouble = n.includes('double');
  const isGF     = n.includes(' gf') || n.includes('gold fill');
  const isSilver = n.includes('silver');
  if (isSingle && isSilver) return '#EFF4FB';
  if (isSingle && isGF)     return '#FDF8EC';
  if (isDouble && isSilver) return '#E6EDF7';
  if (isDouble && isGF)     return '#FBF0DC';
  return '';
}

// ── Render ───────────────────────────────────

const _INV_SIZE_RANK = { 'xs':0,'x-small':0,'xsmall':0,'extra small':0,'s':1,'sm':1,'small':1,'m':2,'md':2,'med':2,'medium':2,'l':3,'lg':3,'large':3,'xl':4,'x-large':4,'xlarge':4,'extra large':4,'xxl':5,'2xl':5 };

function _invSortVars(vars) {
  // Orb-count sort: "1 orb, Small" / "2 orbs, Large" etc.
  if (vars.some(v => /\d+\s+orbs?/i.test(v.item_variation_data?.name || ''))) {
    return [...vars].sort((a, b) => {
      const na = (a.item_variation_data?.name || '').toLowerCase();
      const nb = (b.item_variation_data?.name || '').toLowerCase();
      const orbA = parseInt(na.match(/(\d+)\s+orbs?/)?.[1] ?? '99');
      const orbB = parseInt(nb.match(/(\d+)\s+orbs?/)?.[1] ?? '99');
      const sizeA = na.includes('small') ? 0 : na.includes('large') ? 1 : 2;
      const sizeB = nb.includes('small') ? 0 : nb.includes('large') ? 1 : 2;
      return orbA - orbB || sizeA - sizeB || na.localeCompare(nb);
    });
  }

  function score(v) {
    const name = (v.item_variation_data?.name || '').toLowerCase();
    const gauge = parseFloat(name.match(/(\d+(?:\.\d+)?)g/)?.[1] ?? '999');
    const words = name.split(/[\s,/]+/);
    const sizeRank = words.reduce((best, w) => {
      const r = _INV_SIZE_RANK[w.trim()];
      return r !== undefined && r < best ? r : best;
    }, 99);
    return [gauge, sizeRank, name];
  }
  const scored = vars.map(v => ({ v, s: score(v) }));
  const hasSize = scored.some(x => x.s[1] < 99);
  const hasGauge = scored.some(x => x.s[0] < 999);
  if (!hasSize && !hasGauge) return vars;
  return scored.sort((a, b) =>
    a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.s[2].localeCompare(b.s[2])
  ).map(x => x.v);
}

function _invRenderSub(sub) {
  const data = _invData[sub];
  if (!data) return;

  const { items, counts } = data;
  const searchId = INV_RING_CAT_IDS[sub] ? 'invRingSearch' : INV_PENDANT_CAT_IDS[sub] ? 'invPendantSearch' : INV_PERM_CAT_IDS[sub] ? 'invPermJewelrySearch' : INV_NOSERING_CAT_IDS[sub] ? 'invNoseRingSearch' : 'invSearch';
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
    const vars = _invSortVars((item.item_data?.variations || []).filter(v => !v.is_deleted && !hiddenVars.has(v.id)));
    if (!vars.length) return; // all variations hidden — skip card entirely

    // Pre-pass: collect low-stock variations for this item
    const lowVarsForItem = [];
    vars.forEach(v => {
      const sqQty = counts[v.id] ?? null;
      const curQty = sqQty ?? 0;
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
          <button onclick="invResetItem('${item.id}','${nameSafe}','${sub}')"
            title="Reset this item to match Square (clears local overrides for it)"
            style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;line-height:1;opacity:0.45;transition:opacity 0.15s,color 0.15s;"
            onmouseenter="this.style.opacity='1';this.style.color='var(--accent,#C9983A)'"
            onmouseleave="this.style.opacity='0.45';this.style.color='var(--text-dim)'">↻</button>
          <button onclick="invHideItem('${item.id}','${nameSafe}','${sub}')"
            title="Remove entire item from webapp (won't affect Square)"
            style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;line-height:1;opacity:0.45;transition:opacity 0.15s,color 0.15s;"
            onmouseenter="this.style.opacity='1';this.style.color='#dc2626'"
            onmouseleave="this.style.opacity='0.45';this.style.color='var(--text-dim)'">✕</button>
        </div>
      </div>`;

    vars.forEach((v, rowIdx) => {
      const varName   = v.item_variation_data?.name || '';
      const varId     = v.id;
      const lastAdded = lastAddedCache[varId];
      const lastDateHtml = lastAdded
        ? `<span class="inv-last-date">${_esc(_invFmtDelta(lastAdded.delta))} · ${_esc(_invFmtDate(lastAdded.isoDate))}</span>`
        : '';
      const sqQty     = counts[varId] ?? null;
      const curQty    = sqQty ?? 0;
      const pendingAdd = _invDirty[varId] !== undefined ? _invDirty[varId] : 0;
      const badge     = sqQty === null ? 'unset' : sqQty === 0 ? 'no-stock' : sqQty <= 2 ? 'low-stock' : 'in-stock';
      const badgeTxt  = sqQty === null ? 'not tracked' : sqQty === 0 ? 'out of stock' : sqQty + ' in stock';
      const dot       = sqQty === null ? '' : sqQty > 0 ? 'ok' : 'err';
      const dirty     = _invDirty[varId] !== undefined;
      const varSafe   = _esc(varName).replace(/'/g, '&#39;');
      const threshold = _invGetThreshold(varId);
      const isLow     = sqQty !== null && sqQty < threshold;
      const rowTint   = _invVarTint(varName) || (rowIdx % 2 === 1 ? 'var(--card-head-bg)' : '');

      html += `<div class="inv-row" data-var-id="${varId}"${rowTint ? ` style="background:${rowTint}"` : ''}>
        <div class="inv-var-name">${_esc(varName) || '(Default)'}</div>
        ${lastDateHtml}
        <span class="inv-badge ${badge}">${badgeTxt}</span>
        <span class="inv-split-you" id="inv-sy-${varId}" onclick="invEditSplit('${varId}',event)" title="Click to set split stock">You –</span>
        <span class="inv-split-georgina" id="inv-sg-${varId}" onclick="invEditSplit('${varId}',event)" title="Click to set split stock">G –</span>
        <div class="inv-dot ${dot}"></div>
        <div class="inv-stepper">
          <button class="inv-step-btn" onclick="invStep('${varId}',-1)">−</button>
          <input class="inv-step-input" type="number" id="inv-inp-${varId}"
            value="${pendingAdd}" min="0"
            onchange="invMarkDirty('${varId}',this.value)"
            style="${dirty ? 'background:var(--accent-bg);' : ''}">
          <button class="inv-step-btn" onclick="invStep('${varId}',1)">＋</button>
        </div>
        <button class="inv-set-btn" onclick="invSaveOne('${varId}','${sub}')">Set</button>
        <button class="inv-queue-btn" onclick="invOpenLowStockModal('${varId}','${nameSafe}','${varSafe}',${curQty},'${sub}')" title="Add to Restock Queue" style="${isLow ? '' : 'visibility:hidden'}">⚑ Queue</button>
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
  const prefix = INV_RING_CAT_IDS[sub] ? 'inv-rsub-' : INV_PENDANT_CAT_IDS[sub] ? 'inv-psub-' : INV_PERM_CAT_IDS[sub] ? 'inv-pjsub-' : INV_NOSERING_CAT_IDS[sub] ? 'inv-nrsub-' : 'inv-sub-';
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

  // qtyMap values are amounts to ADD to current stock, not absolute totals
  const absQtyMap = {};
  Object.entries(qtyMap).forEach(([varId, addQty]) => {
    absQtyMap[varId] = Math.max(0, prevCounts[varId] + (parseInt(addQty) || 0));
  });

  const changes = Object.entries(absQtyMap).map(([varId, qty]) => ({
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
  Object.entries(absQtyMap).forEach(([varId, qty]) => {
    if (_invData[sub]) _invData[sub].counts[varId] = qty;
    delete _invDirty[varId];
  });

  _invLogChanges(absQtyMap, prevCounts, sub);
  _invRenderSub(sub);
  _invApplySplitCache(sub);
  if (INV_RING_CAT_IDS[sub]) _invUpdateRingCountLabel();
  else if (INV_PENDANT_CAT_IDS[sub]) _invUpdatePendantCountLabel();
  else if (INV_PERM_CAT_IDS[sub]) _invUpdatePermJewelryCountLabel();
  else if (INV_NOSERING_CAT_IDS[sub]) _invUpdateNoseRingCountLabel();
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

// ── Permanent Jewelry tab ────────────────────

let _invPermJewelryCurSub = 'pj-birthstone';
let _invPermJewelryLoaded = false;

async function invLoadPermJewelry() {
  if (_invData[_invPermJewelryCurSub]) return;
  await _invLoadSub(_invPermJewelryCurSub);
  _invPermJewelryLoaded = true;
}

function invSwitchPermJewelrySub(sub, el) {
  _invPermJewelryCurSub = sub;
  document.querySelectorAll('.inv-pj-sub-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.inv-pj-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('inv-pjsub-' + sub);
  if (panel) panel.style.display = '';
  if (!_invData[sub]) _invLoadSub(sub);
  else _invRenderSub(sub);
  _invUpdatePermJewelryCountLabel();
  _navSave('inv-pj-sub', sub);
}

function invPermJewelryFilter(val) {
  _invRenderSub(_invPermJewelryCurSub);
}

async function invUpdateAllPermJewelry() {
  const entries = Object.entries(_invDirty);
  if (!entries.length) { toast('No changes to save', 'ℹ'); return; }
  const btn = document.getElementById('invPermJewelryUpdateAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await _invSaveCount(Object.fromEntries(entries), _invPermJewelryCurSub);
    toast(entries.length + ' item' + (entries.length > 1 ? 's' : '') + ' updated ✓', '✓');
  } catch (e) {
    toast('Square error: ' + e.message, '⚠');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Update All'; }
  }
}

async function invRefreshPermJewelry() {
  const btn = document.getElementById('invPermJewelryRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }
  Object.keys(INV_PERM_CAT_IDS).forEach(sub => { delete _invData[sub]; });
  _invDirty = {};
  _invPermJewelryLoaded = false;
  await invLoadPermJewelry();
  if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
}

function _invUpdatePermJewelryCountLabel() {
  const data  = _invData[_invPermJewelryCurSub];
  const label = document.getElementById('invPermJewelryCountLabel');
  if (!label) return;
  if (!data) { label.textContent = ''; return; }
  const total      = data.items.length;
  const outOfStock = Object.values(data.counts).filter(q => q === 0).length;
  label.textContent = total + ' item' + (total !== 1 ? 's' : '') +
    (outOfStock ? ' · ' + outOfStock + ' out of stock' : '');
}

// ── Faux Nose Rings tab ───────────────────────

let _invNoseRingCurSub = 'nose-rings';
let _invNoseRingLoaded = false;

async function invLoadNoseRings() {
  if (_invData[_invNoseRingCurSub]) return;
  await _invLoadSub(_invNoseRingCurSub);
  _invNoseRingLoaded = true;
}

async function invUpdateAllNoseRings() {
  const entries = Object.entries(_invDirty);
  if (!entries.length) { toast('No changes to save', 'ℹ'); return; }
  const btn = document.getElementById('invNoseRingUpdateAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await _invSaveCount(Object.fromEntries(entries), _invNoseRingCurSub);
    toast(entries.length + ' item' + (entries.length > 1 ? 's' : '') + ' updated ✓', '✓');
  } catch (e) {
    toast('Square error: ' + e.message, '⚠');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Update All'; }
  }
}

async function invRefreshNoseRings() {
  const btn = document.getElementById('invNoseRingRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }
  Object.keys(INV_NOSERING_CAT_IDS).forEach(sub => { delete _invData[sub]; });
  _invDirty = {};
  _invNoseRingLoaded = false;
  await invLoadNoseRings();
  if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
}

function invNoseRingFilter(val) {
  _invRenderSub(_invNoseRingCurSub);
}

function _invUpdateNoseRingCountLabel() {
  const data  = _invData[_invNoseRingCurSub];
  const label = document.getElementById('invNoseRingCountLabel');
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

  // Merges into the existing Restock Queue bar for this item (if any) instead
  // of always spawning a new bar per variant — see rqQueueLowStockVariants.
  rqQueueLowStockVariants(itemName, [{ id: varId, name: varName, qty: 3 }], (err) => {
    if (err) toast('Failed to add to Restock Queue', '⚠');
    else toast(`Added "${text}" to Restock Queue ✓`, '✓');
  });

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

  // Build the checked variant list (with qtys) for the shared sizes-merge
  // helper — collects all checked sizes into one bar instead of one per size.
  const variants = [];
  document.querySelectorAll('.inv-qal-check').forEach(chk => {
    if (!chk.checked) return;
    const idx = parseInt(chk.dataset.idx);
    const qty = Math.max(1, parseInt(document.querySelector(`.inv-qal-qty[data-idx="${idx}"]`).value) || 3);
    variants.push({ id: lowVars[idx].varId, name: lowVars[idx].varName, qty });
  });

  invCloseQueueAllLowModal();

  if (!variants.length) return;

  rqQueueLowStockVariants(itemName, variants, (err) => {
    if (err) toast('Failed to add to Restock Queue', '⚠');
    else toast(`Added to Restock Queue ✓`, '✓');
  });
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
  const isoDate = new Date().toISOString().split('T')[0];
  Object.entries(qtyMap).forEach(([varId, newQty]) => {
    const prevQty  = prevCounts[varId] ?? 0;
    const delta    = parseInt(newQty) - prevQty;
    if (delta === 0) return;
    const item     = _invFindItemForVar(varId, sub);
    if (!item) return;
    const itemId   = item.id;
    const itemName = item.item_data?.name || '';
    const varObj   = (item.item_data?.variations || []).find(v => v.id === varId);
    const varName  = varObj?.item_variation_data?.name || '';
    const existing = cache[varId];
    const accDelta = (existing && existing.isoDate === isoDate) ? existing.delta + delta : delta;
    cache[varId]   = { delta: accDelta, isoDate, varName, itemId, itemName };
    changed = true;
    fetch('/api/notion-inv-history', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ itemId, itemName, varName, prevQty, newQty: parseInt(newQty), delta, category: sub }),
    }).catch(() => {});
  });
  if (changed) localStorage.setItem('sts-inv-last-added', JSON.stringify(cache));
}

function _invFindVarIdByItemAndName(itemId, varName) {
  for (const sub of Object.keys(_invData)) {
    const data = _invData[sub];
    const item = data?.items.find(i => i.id === itemId);
    if (!item) continue;
    const v = (item.item_data?.variations || []).find(vr => (vr.item_variation_data?.name || '') === varName);
    if (v) return v.id;
  }
  return null;
}

async function _invWarmLastAdded() {
  try {
    const r = await fetch('/api/notion-inv-history');
    if (!r.ok) return;
    const data = await r.json();
    const cache = _invGetLastAdded();
    let changed = false;
    Object.values(data).forEach(entry => {
      const varId = _invFindVarIdByItemAndName(entry.itemId, entry.varName);
      if (!varId) return;
      if (!cache[varId] || entry.isoDate > cache[varId].isoDate) {
        cache[varId] = { delta: entry.delta, isoDate: entry.isoDate, varName: entry.varName, itemId: entry.itemId };
        changed = true;
      }
    });
    if (!changed) return;
    localStorage.setItem('sts-inv-last-added', JSON.stringify(cache));
    if (_invData[_invCurSub])     _invRenderSub(_invCurSub);
    if (_invData[_invRingCurSub]) _invRenderSub(_invRingCurSub);
    if (_invData[_invPendantCurSub]) _invRenderSub(_invPendantCurSub);
    if (_invData[_invPermJewelryCurSub]) _invRenderSub(_invPermJewelryCurSub);
  } catch (e) {
    console.warn('[inv] could not warm last-added cache:', e.message);
  }
}

// ── Split inventory (Notion per-device stock) ─────────────────────────────────

function _invApplySplitCache(sub) {
  const data = _invData[sub];
  if (!data) return;
  for (const item of data.items) {
    for (const v of (item.item_data?.variations || [])) {
      const s = _invSplitCache[v.id];
      if (!s) continue;
      const youEl = document.getElementById('inv-sy-' + v.id);
      const gEl   = document.getElementById('inv-sg-' + v.id);
      if (youEl) youEl.textContent = 'You ' + s.you;
      if (gEl)   gEl.textContent   = 'G '   + s.georgina;
    }
  }
}

async function _invLoadSplit(sub) {
  const data = _invData[sub];
  if (!data) return;
  try {
    const res = await fetch('/api/notion-split-inv');
    if (!res.ok) return;
    const split = await res.json();
    Object.assign(_invSplitCache, split);
    _invApplySplitCache(sub);
  } catch (e) {
    console.warn('[inv] split stock fetch failed:', e.message);
  }
}

function invEditSplit(varId, e) {
  e.stopPropagation();
  _invSplitActiveVar = varId;
  const cached = _invSplitCache[varId] || { you: 0, georgina: 0, pageId: null };

  let pop = document.getElementById('inv-split-popover');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'inv-split-popover';
    pop.innerHTML = `
      <div class="inv-sp-title">Set Split Stock</div>
      <div class="inv-sp-row">
        <span class="inv-split-you inv-sp-label">You</span>
        <div class="inv-stepper">
          <button class="inv-step-btn" onclick="invSplitStep('you',-1)">−</button>
          <input id="inv-sp-you" type="number" min="0" class="inv-step-input"
            onkeydown="if(event.key==='Enter')invSaveSplit();if(event.key==='Escape')invCloseSplitPopover()">
          <button class="inv-step-btn" onclick="invSplitStep('you',1)">＋</button>
        </div>
      </div>
      <div class="inv-sp-row">
        <span class="inv-split-georgina inv-sp-label">G</span>
        <div class="inv-stepper">
          <button class="inv-step-btn" onclick="invSplitStep('g',-1)">−</button>
          <input id="inv-sp-g" type="number" min="0" class="inv-step-input"
            onkeydown="if(event.key==='Enter')invSaveSplit();if(event.key==='Escape')invCloseSplitPopover()">
          <button class="inv-step-btn" onclick="invSplitStep('g',1)">＋</button>
        </div>
      </div>
      <div class="inv-sp-btns">
        <button class="inv-set-btn" id="inv-sp-save" onclick="invSaveSplit()">Save</button>
        <button class="inv-sp-cancel" onclick="invSplitEven()">Split evenly</button>
        <button class="inv-sp-cancel" onclick="invCloseSplitPopover()">Cancel</button>
      </div>`;
    document.body.appendChild(pop);
    document.addEventListener('click', e => {
      if (!pop.contains(e.target)) invCloseSplitPopover();
    });
  }

  document.getElementById('inv-sp-you').value = cached.you;
  document.getElementById('inv-sp-g').value   = cached.georgina;
  const saveBtn = document.getElementById('inv-sp-save');
  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }

  pop.style.display = 'block';
  const rect = e.target.getBoundingClientRect();
  pop.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
  pop.style.left = (rect.left  + window.scrollX) + 'px';

  requestAnimationFrame(() => {
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8)
      pop.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
  });

  document.getElementById('inv-sp-you').focus();
  document.getElementById('inv-sp-you').select();
}

function invSplitStep(field, delta) {
  const id = field === 'you' ? 'inv-sp-you' : 'inv-sp-g';
  const input = document.getElementById(id);
  if (!input) return;
  input.value = Math.max(0, (parseInt(input.value) || 0) + delta);
}

function invSplitEven() {
  const varId  = _invSplitActiveVar;
  const youInp = document.getElementById('inv-sp-you');
  const gInp   = document.getElementById('inv-sp-g');
  if (!youInp || !gInp) return;
  const invInput = document.getElementById('inv-inp-' + varId);
  const total = invInput
    ? (parseInt(invInput.value) || 0)
    : (_invData[_invCurSub]?.counts?.[varId] || 0);
  youInp.value = Math.ceil(total / 2);
  gInp.value   = Math.floor(total / 2);
}

function _invGetVarName(varId) {
  for (const sub of Object.keys(_invData)) {
    for (const item of (_invData[sub]?.items || [])) {
      for (const v of (item.item_data?.variations || [])) {
        if (v.id === varId) {
          const itemName = item.item_data?.name || '';
          const varName  = v.item_variation_data?.name || '';
          return (varName && varName !== 'Regular') ? itemName + ' – ' + varName : itemName;
        }
      }
    }
  }
  return varId;
}

async function invSaveSplit() {
  const varId  = _invSplitActiveVar;
  if (!varId) return;

  const you      = Math.max(0, parseInt(document.getElementById('inv-sp-you').value) || 0);
  const georgina = Math.max(0, parseInt(document.getElementById('inv-sp-g').value)   || 0);

  const btn = document.getElementById('inv-sp-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const cached = _invSplitCache[varId];
    let pageId = cached?.pageId;

    if (!pageId) {
      const name = _invGetVarName(varId);
      const res  = await fetch('/api/notion-split-inv', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ varId, name, you, georgina }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'create failed');
      pageId = data.pageId;
      _invSplitCache[varId] = { you, georgina, pageId };
    } else {
      const res  = await fetch('/api/notion-split-inv', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pageId, you, georgina }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'update failed');
      _invSplitCache[varId] = { ...cached, you, georgina };
    }

    const youEl = document.getElementById('inv-sy-' + varId);
    const gEl   = document.getElementById('inv-sg-' + varId);
    if (youEl) youEl.textContent = 'You ' + you;
    if (gEl)   gEl.textContent   = 'G '   + georgina;

    invCloseSplitPopover();
    toast('Split stock updated ✓', '✓');
  } catch (err) {
    console.error('[inv] split save failed:', err.message);
    toast('Failed to save: ' + err.message, '⚠');
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

function invCloseSplitPopover() {
  const pop = document.getElementById('inv-split-popover');
  if (pop) pop.style.display = 'none';
  _invSplitActiveVar = null;
}
