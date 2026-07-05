// ════════════════════════════════════════════
//  INVENTORY MANAGER MODAL  —  js/inv-manager.js
//  Drag-and-drop interface for pulling Square catalog
//  items into inventory sub-tabs.
//
//  Storage: localStorage key 'sts-inv-extra'
//  Format: { [subTabKey]: [ {type:'item'|'category', squareId, name} ] }
//
//  Runtime: localStorage is source of truth.
//  Hardcoded: use "Copy JS Config" to bake into inventory.js as INV_EXTRA.
// ════════════════════════════════════════════

const _INVMGR_KEY = 'sts-inv-extra';

const _INVMGR_TABS = {
  earrings: {
    icon: '🪬',
    subs: [
      { key: 'ear-cuffs', label: 'Ear Cuffs' },
      { key: 'dangle',    label: 'Dangle' },
      { key: 'studs',     label: 'Studs' },
      { key: 'hoops',     label: 'Seamless Hoops' },
      { key: 'spirit',    label: 'Spirit Animal' },
    ],
  },
  rings: {
    icon: '💍',
    subs: [
      { key: 'stackable',  label: 'Stackable' },
      { key: 'spirit',     label: 'Spirit Animal' },
      { key: 'geometric',  label: 'Geometric' },
      { key: 'symbolic',   label: 'Symbolic' },
      { key: 'meditation', label: 'Meditation' },
    ],
  },
  pendants: {
    icon: '📿',
    subs: [
      { key: 'p-spirit',    label: 'Spirit Animal' },
      { key: 'p-geometric', label: 'Geometric' },
      { key: 'p-symbolic',  label: 'Symbolic' },
    ],
  },
  permjewelry: {
    icon: '🔗',
    subs: [
      { key: 'pj-birthstone', label: 'Silver Birthstone Charms' },
      { key: 'pj-giftfill',   label: 'Silver and Gold Fill Charms' },
    ],
  },
  noserings: {
    icon: '👃',
    subs: [
      { key: 'nose-rings', label: 'Faux Nose Rings' },
    ],
  },
};

let _invMgrState        = {};
let _invMgrCatalogData  = null;
let _invMgrCurMain      = 'earrings';
let _invMgrSearchQ      = '';
let _invMgrFetching     = false;

// ── State helpers ─────────────────────────────

function _invMgrLoadState() {
  try { return JSON.parse(localStorage.getItem(_INVMGR_KEY) || '{}'); } catch { return {}; }
}

function _invMgrAllKeys() {
  const seen = new Set();
  return Object.values(_INVMGR_TABS).flatMap(t => t.subs.map(s => s.key)).filter(k => {
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── Open / Close ──────────────────────────────

async function invMgrOpen() {
  _invMgrState = _invMgrLoadState();
  _invMgrAllKeys().forEach(k => { if (!Array.isArray(_invMgrState[k])) _invMgrState[k] = []; });
  _invMgrCurMain = 'earrings';
  _invMgrSearchQ = '';

  let root = document.getElementById('inv-manager-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'inv-manager-root';
    document.body.appendChild(root);
  }
  root.innerHTML = _invMgrBuildShell();

  _invMgrRenderRight();

  if (!_invMgrCatalogData) {
    await _invMgrFetchCatalog();
  } else {
    _invMgrRenderLeft();
  }
}

function invMgrClose() {
  const root = document.getElementById('inv-manager-root');
  if (root) root.innerHTML = '';
}

// ── Modal shell HTML ──────────────────────────
// All styling lives in jewelry-workflow.html's .invmgr-* rules (light +
// midnight); this file only emits semantic classes.

function _invMgrBuildShell() {
  return `
<div id="invMgrOverlay" class="invmgr-overlay"
  onclick="if(event.target.id==='invMgrOverlay')invMgrClose()">

  <div class="invmgr-modal">

    <!-- Header -->
    <div class="invmgr-head">
      <div>
        <div class="invmgr-title">⚙ Manage Inventory Items</div>
        <div class="invmgr-sub">Drag items or whole Square categories into your app sub-tabs · changes save to localStorage and take effect immediately</div>
      </div>
      <button class="invmgr-close" onclick="invMgrClose()" title="Close">✕</button>
    </div>

    <!-- Two-panel body -->
    <div class="invmgr-body">

      <!-- LEFT: Square catalog -->
      <div class="invmgr-left">
        <div class="invmgr-left-head">
          <div class="invmgr-panel-label">SQUARE CATALOG — NOT YET IN APP</div>
          <input id="invMgrSearch" class="invmgr-search" placeholder="Search items…" oninput="invMgrFilter(this.value)">
        </div>
        <div id="invMgrCatalog" class="invmgr-catalog">
          <div class="invmgr-note">⏳ Loading Square catalog…</div>
        </div>
      </div>

      <!-- RIGHT: App sub-tab drop zones -->
      <div class="invmgr-right">

        <!-- Main tab switcher -->
        <div class="invmgr-tabbar">
          <button id="invMgrMainBtn-earrings"    class="inv-ear-sub active" onclick="invMgrSwitchMain('earrings')">🪬 Earrings</button>
          <button id="invMgrMainBtn-rings"       class="inv-ear-sub"        onclick="invMgrSwitchMain('rings')">💍 Rings</button>
          <button id="invMgrMainBtn-pendants"    class="inv-ear-sub"        onclick="invMgrSwitchMain('pendants')">📿 Pendants</button>
          <button id="invMgrMainBtn-permjewelry" class="inv-ear-sub"        onclick="invMgrSwitchMain('permjewelry')">🔗 Perm. Jewelry</button>
          <button id="invMgrMainBtn-noserings"   class="inv-ear-sub"        onclick="invMgrSwitchMain('noserings')">👃 Nose Rings</button>
          <span class="invmgr-hint">← drop into a sub-tab below</span>
        </div>

        <!-- Drop zones grid -->
        <div id="invMgrZones" class="invmgr-zones">
        </div>

      </div>
    </div>

    <!-- Footer -->
    <div class="invmgr-foot">
      <div class="invmgr-foot-info">
        <button onclick="invMgrExportJS()" class="btn btn-outline btn-sm invmgr-export-btn">📋 Copy JS Config</button>
        <span class="invmgr-foot-note">copies constant to paste into inventory.js for permanent deploy</span>
      </div>
      <div class="invmgr-foot-btns">
        <button onclick="invMgrClose()" class="btn btn-outline btn-sm">Cancel</button>
        <button onclick="invMgrSave()" class="btn btn-gold btn-sm">Save &amp; Close</button>
      </div>
    </div>

  </div>
</div>`;
}

// ── Square catalog fetch ──────────────────────

async function _invMgrFetchCatalog() {
  if (_invMgrFetching) return;
  _invMgrFetching = true;

  const catalogEl = document.getElementById('invMgrCatalog');

  try {
    // All known category IDs already mapped in the app
    const knownCatIds = new Set([
      ...Object.values(INV_CAT_IDS).flat(),
      ...Object.values(INV_RING_CAT_IDS).flat(),
      ...Object.values(INV_PENDANT_CAT_IDS).flat(),
      ...Object.values(INV_PERM_CAT_IDS).flat(),
      ...Object.values(INV_NOSERING_CAT_IDS).flat(),
    ]);

    // Items/categories already assigned via this manager
    const assignedItemIds = new Set();
    const assignedCatIds  = new Set();
    Object.values(_invMgrState).forEach(arr => arr.forEach(e => {
      if (e.type === 'item')     assignedItemIds.add(e.squareId);
      if (e.type === 'category') assignedCatIds.add(e.squareId);
    }));

    // 1. Fetch all Square categories for name lookup
    const catNames = {};
    let cursor = null;
    do {
      const url = '/v2/catalog/list?types=CATEGORY' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const res  = await _sqFetch(url);
      (res.objects || []).forEach(o => {
        if (!o.is_deleted) catNames[o.id] = o.category_data?.name || '(unnamed)';
      });
      cursor = res.cursor || null;
    } while (cursor);

    // 2. Fetch all items (paginated)
    const allItems = [];
    cursor = null;
    do {
      const url = '/v2/catalog/list?types=ITEM' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const res  = await _sqFetch(url);
      (res.objects || []).forEach(o => { if (!o.is_deleted) allItems.push(o); });
      cursor = res.cursor || null;
    } while (cursor);

    // 3. Filter: keep only items NOT covered by any known category
    const unassigned = allItems.filter(item => {
      if (assignedItemIds.has(item.id)) return false;
      const cats = _invMgrItemCatIds(item);
      if (!cats.length) return true; // uncategorized items always appear
      return !cats.some(cid => knownCatIds.has(cid));
    });

    // 4. Group by Square category
    const groups = {};
    unassigned.forEach(item => {
      const cats       = _invMgrItemCatIds(item);
      const rawKey     = cats.find(c => !knownCatIds.has(c)) || 'uncategorized';
      const groupKey   = rawKey;
      if (assignedCatIds.has(groupKey)) return; // already assigned as whole category
      if (!groups[groupKey]) {
        groups[groupKey] = {
          catId:  groupKey,
          name:   groupKey === 'uncategorized' ? '(Uncategorized)' : (catNames[groupKey] || groupKey),
          items:  [],
        };
      }
      groups[groupKey].items.push(item);
    });

    _invMgrCatalogData = { groups, catNames };
    _invMgrRenderLeft();

  } catch (e) {
    if (catalogEl) {
      catalogEl.innerHTML = `<div class="invmgr-note invmgr-err">⚠ ${_invMgrEsc(e.message)}</div>`;
    }
  } finally {
    _invMgrFetching = false;
  }
}

function _invMgrItemCatIds(item) {
  const cats = [];
  if (item.item_data?.category_id) cats.push(item.item_data.category_id);
  (item.item_data?.categories || []).forEach(c => { if (c.id) cats.push(c.id); });
  return [...new Set(cats)];
}

// ── Left panel render ─────────────────────────

function _invMgrRenderLeft() {
  const el = document.getElementById('invMgrCatalog');
  if (!el || !_invMgrCatalogData) return;

  const { groups } = _invMgrCatalogData;
  const q = _invMgrSearchQ.toLowerCase();

  const groupList = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));

  if (!groupList.length) {
    el.innerHTML = '<div class="invmgr-note">✓ All Square items are already assigned.</div>';
    return;
  }

  let html = '';
  groupList.forEach(group => {
    const items = q
      ? group.items.filter(i => (i.item_data?.name || '').toLowerCase().includes(q) || group.name.toLowerCase().includes(q))
      : group.items;

    if (!items.length && q && !group.name.toLowerCase().includes(q)) return;

    // Category header — draggable (assigns whole category)
    const catSafe = _invMgrEsc(group.catId);
    const nameSafe = _invMgrEsc(group.name);
    html += `
<div class="invmgr-group">
  <div class="invmgr-cat" draggable="true"
    ondragstart="invMgrDragStart(event,'category','${catSafe}','${_invMgrEscAttr(group.name)}')"
    ondragend="this.style.opacity=''"
    title="Drag to assign entire category (${items.length} items)">
    <span class="invmgr-grip">⠿⠿</span>
    <span class="invmgr-grow">${nameSafe}</span>
    <span class="invmgr-count">${group.items.length} items</span>
    <span class="invmgr-catpill">CAT</span>
  </div>`;

    items.forEach(item => {
      const name    = item.item_data?.name || 'Unnamed';
      const itemSafe = _invMgrEsc(item.id);
      html += `
  <div class="invmgr-item" draggable="true"
    ondragstart="invMgrDragStart(event,'item','${itemSafe}','${_invMgrEscAttr(name)}')"
    ondragend="this.style.opacity=''">
    <span class="invmgr-grip-sm">⠿</span>
    <span class="invmgr-grow">${_invMgrEsc(name)}</span>
  </div>`;
    });

    html += '</div>';
  });

  // ── Hidden / deprecated section ──────────────
  const hiddenIds  = _invMgrGetHidden();
  const hiddenVars = !q ? _invMgrGetHiddenVars() : [];

  if ((hiddenIds.size || hiddenVars.length) && !q) {
    html += `<div class="invmgr-depr">
  <div class="invmgr-depr-label">DEPRECATED (HIDDEN FROM APP)</div>`;

    // Hidden whole items
    hiddenIds.forEach(id => {
      // Try to find name from catalog groups
      let name = id;
      Object.values(_invMgrCatalogData.groups || {}).forEach(g => {
        const match = g.items.find(i => i.id === id);
        if (match) name = match.item_data?.name || id;
      });
      html += `
  <div class="invmgr-depr-row">
    <span class="invmgr-grow"><span class="invmgr-strike">${_invMgrEsc(name)}</span> <span class="invmgr-depr-type">(item)</span></span>
    <button class="invmgr-restore" onclick="invMgrRestoreItem('${_invMgrEsc(id)}')">Restore</button>
  </div>`;
    });

    // Hidden variations
    hiddenVars.forEach(({ varId, varName, itemName }) => {
      const label = varName ? `${_invMgrEsc(itemName)} — ${_invMgrEsc(varName)}` : _invMgrEsc(itemName);
      html += `
  <div class="invmgr-depr-row">
    <span class="invmgr-grow"><span class="invmgr-strike">${label}</span> <span class="invmgr-depr-type">(variation)</span></span>
    <button class="invmgr-restore" onclick="invMgrRestoreVar('${_invMgrEsc(varId)}')">Restore</button>
  </div>`;
    });

    html += '</div>';
  }

  el.innerHTML = html || '<div class="invmgr-note">No matches</div>';
}

function _invMgrGetHidden() {
  try { return new Set(JSON.parse(localStorage.getItem('sts-inv-hidden') || '[]')); } catch { return new Set(); }
}

function _invMgrGetHiddenVars() {
  try { return JSON.parse(localStorage.getItem('sts-inv-hidden-vars') || '[]'); } catch { return []; }
}

function _invMgrClearInvCache() {
  if (typeof _invData !== 'undefined') Object.keys(_invData).forEach(k => delete _invData[k]);
  if (typeof window._invLoaded           !== 'undefined') window._invLoaded           = false;
  if (typeof window._invRingLoaded       !== 'undefined') window._invRingLoaded       = false;
  if (typeof window._invPendantLoaded    !== 'undefined') window._invPendantLoaded    = false;
  if (typeof window._invPermJewelryLoaded !== 'undefined') window._invPermJewelryLoaded = false;
  if (typeof window._invNoseRingLoaded    !== 'undefined') window._invNoseRingLoaded    = false;
}

function invMgrRestoreItem(itemId) {
  const hidden = _invMgrGetHidden();
  hidden.delete(itemId);
  localStorage.setItem('sts-inv-hidden', JSON.stringify([...hidden]));
  _invMgrClearInvCache();
  toast('Item restored — switch sub-tabs to reload', '↩');
  _invMgrRenderLeft();
}

function invMgrRestoreVar(varId) {
  const list = _invMgrGetHiddenVars().filter(v => v.varId !== varId);
  localStorage.setItem('sts-inv-hidden-vars', JSON.stringify(list));
  _invMgrClearInvCache();
  toast('Variation restored — switch sub-tabs to reload', '↩');
  _invMgrRenderLeft();
}

function invMgrFilter(q) {
  _invMgrSearchQ = q;
  _invMgrRenderLeft();
}

// ── Right panel render ────────────────────────

function invMgrSwitchMain(main) {
  _invMgrCurMain = main;
  ['earrings', 'rings', 'pendants', 'permjewelry', 'noserings'].forEach(m => {
    const btn = document.getElementById('invMgrMainBtn-' + m);
    if (btn) btn.classList.toggle('active', m === main);
  });
  _invMgrRenderRight();
}

function _invMgrRenderRight() {
  const el = document.getElementById('invMgrZones');
  if (!el) return;

  const subs = _INVMGR_TABS[_invMgrCurMain]?.subs || [];

  el.innerHTML = subs.map(({ key, label }) => {
    const entries = _invMgrState[key] || [];

    const chips = entries.map((e, idx) => {
      const icon  = e.type === 'category' ? '📁 ' : '';
      const nSafe = _invMgrEsc(e.name);
      return `<div class="invmgr-chip">
        <span class="invmgr-chip-name" title="${nSafe}">${icon}${nSafe}</span>
        <button class="invmgr-chip-x" onclick="invMgrRemove('${key}',${idx})" title="Remove">✕</button>
      </div>`;
    }).join('');

    const placeholder = !entries.length
      ? '<div class="invmgr-drop-hint">drop here</div>'
      : '';

    return `<div
      ondragover="event.preventDefault();this.querySelector('.invMgrZoneInner').style.borderColor='var(--accent,#C9A96E)'"
      ondragleave="this.querySelector('.invMgrZoneInner').style.borderColor=''"
      ondrop="invMgrDrop(event,'${key}');this.querySelector('.invMgrZoneInner').style.borderColor=''">
      <div class="invMgrZoneInner">
        <div class="invmgr-zone-label">${_invMgrEsc(label)}</div>
        <div class="invmgr-chip-wrap">${chips}</div>
        ${placeholder}
      </div>
    </div>`;
  }).join('');
}

// ── Drag & drop handlers ──────────────────────

function invMgrDragStart(e, type, squareId, name) {
  e.dataTransfer.setData('text/plain', JSON.stringify({ type, squareId, name }));
  e.dataTransfer.effectAllowed = 'copy';
  e.currentTarget.style.opacity = '0.5';
}

function invMgrDrop(e, subKey) {
  e.preventDefault();
  let data;
  try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
  if (!data?.type || !data?.squareId) return;

  if (!_invMgrState[subKey]) _invMgrState[subKey] = [];

  // No duplicates
  if (_invMgrState[subKey].some(x => x.squareId === data.squareId)) {
    toast('Already assigned to this sub-tab', 'ℹ');
    return;
  }

  _invMgrState[subKey].push({ type: data.type, squareId: data.squareId, name: data.name });
  _invMgrRenderRight();
}

function invMgrRemove(subKey, idx) {
  if (Array.isArray(_invMgrState[subKey])) {
    _invMgrState[subKey].splice(idx, 1);
    _invMgrRenderRight();
  }
}

// ── Save ──────────────────────────────────────

function invMgrSave() {
  localStorage.setItem(_INVMGR_KEY, JSON.stringify(_invMgrState));

  // Clear cached inventory data so sub-tabs reload with extras merged in
  if (typeof _invData !== 'undefined') {
    Object.keys(_invData).forEach(k => delete _invData[k]);
  }
  if (typeof window._invLoaded     !== 'undefined') window._invLoaded     = false;
  if (typeof window._invRingLoaded !== 'undefined') window._invRingLoaded = false;
  if (typeof window._invPendantLoaded !== 'undefined') window._invPendantLoaded = false;
  if (typeof window._invPermJewelryLoaded !== 'undefined') window._invPermJewelryLoaded = false;
  if (typeof window._invNoseRingLoaded    !== 'undefined') window._invNoseRingLoaded    = false;

  invMgrClose();
  toast('Saved. Switch sub-tabs to reload with new items.', '✓');
}

// ── Export JS config ──────────────────────────

function invMgrExportJS() {
  const allKeys = _invMgrAllKeys();
  const lines   = [
    '// ── Paste into js/inventory.js (top of file, after the existing ID constants) ──',
    '// Generated by Inventory Manager. localStorage overrides this when set.',
    'const INV_EXTRA = {',
  ];

  allKeys.forEach(key => {
    const entries = _invMgrState[key] || [];
    if (!entries.length) {
      lines.push(`  '${key}': [],`);
    } else {
      lines.push(`  '${key}': [`);
      entries.forEach(e => {
        const nameSafe = e.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        lines.push(`    { type: '${e.type}', squareId: '${e.squareId}', name: '${nameSafe}' },`);
      });
      lines.push(`  ],`);
    }
  });

  lines.push('};');

  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    toast('JS config copied to clipboard — paste into inventory.js and deploy', '📋');
  }).catch(() => {
    prompt('Copy this and paste into inventory.js:', text);
  });
}

// ── Utilities ─────────────────────────────────

function _invMgrEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _invMgrEscAttr(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
