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

function _invMgrBuildShell() {
  return `
<div id="invMgrOverlay"
  style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:12px;"
  onclick="if(event.target.id==='invMgrOverlay')invMgrClose()">

  <div style="background:var(--card-bg);border-radius:12px;width:100%;max-width:940px;height:min(88vh,720px);display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.3);overflow:hidden;">

    <!-- Header -->
    <div style="padding:14px 20px;border-bottom:1px solid var(--bdr);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:15px;font-weight:600;color:var(--text);">⚙ Manage Inventory Items</div>
        <div style="font-size:11.5px;color:var(--text-dim);margin-top:2px;">Drag items or whole Square categories into your app sub-tabs · changes save to localStorage and take effect immediately</div>
      </div>
      <button onclick="invMgrClose()" style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;padding:4px 8px;line-height:1;border-radius:5px;" title="Close">✕</button>
    </div>

    <!-- Two-panel body -->
    <div style="display:flex;flex:1;min-height:0;">

      <!-- LEFT: Square catalog -->
      <div style="width:268px;flex-shrink:0;border-right:1px solid var(--bdr);display:flex;flex-direction:column;">
        <div style="padding:10px 12px;border-bottom:1px solid var(--bdr);flex-shrink:0;">
          <div style="font-size:10px;font-weight:700;color:var(--text-dim);letter-spacing:0.6px;margin-bottom:7px;">SQUARE CATALOG — NOT YET IN APP</div>
          <input id="invMgrSearch" placeholder="Search items…" oninput="invMgrFilter(this.value)"
            style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid var(--bdr);border-radius:7px;font-size:13px;background:var(--card-bg);color:var(--text);outline:none;">
        </div>
        <div id="invMgrCatalog" style="flex:1;overflow-y:auto;padding:6px 8px;">
          <div style="padding:28px 12px;text-align:center;color:var(--text-dim);font-size:13px;">⏳ Loading Square catalog…</div>
        </div>
      </div>

      <!-- RIGHT: App sub-tab drop zones -->
      <div style="flex:1;display:flex;flex-direction:column;min-width:0;">

        <!-- Main tab switcher -->
        <div style="display:flex;align-items:center;gap:4px;padding:8px 14px;border-bottom:1px solid var(--bdr);flex-shrink:0;background:var(--card-head-bg);">
          <button id="invMgrMainBtn-earrings" class="inv-ear-sub active" onclick="invMgrSwitchMain('earrings')">🪬 Earrings</button>
          <button id="invMgrMainBtn-rings"    class="inv-ear-sub"        onclick="invMgrSwitchMain('rings')">💍 Rings</button>
          <button id="invMgrMainBtn-pendants" class="inv-ear-sub"        onclick="invMgrSwitchMain('pendants')">📿 Pendants</button>
          <span style="margin-left:8px;font-size:11px;color:var(--text-dim);">← drop into a sub-tab below</span>
        </div>

        <!-- Drop zones grid -->
        <div id="invMgrZones" style="flex:1;overflow-y:auto;padding:12px 14px;display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start;">
        </div>

      </div>
    </div>

    <!-- Footer -->
    <div style="padding:10px 18px;border-top:1px solid var(--bdr);flex-shrink:0;background:var(--card-head-bg);display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:10px;">
        <button onclick="invMgrExportJS()" class="btn btn-outline btn-sm" style="font-size:12px;">📋 Copy JS Config</button>
        <span style="font-size:11px;color:var(--text-dim);">copies constant to paste into inventory.js for permanent deploy</span>
      </div>
      <div style="display:flex;gap:8px;">
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
      catalogEl.innerHTML = `<div style="padding:28px 12px;text-align:center;color:#dc2626;font-size:13px;">⚠ ${_invMgrEsc(e.message)}</div>`;
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
    el.innerHTML = '<div style="padding:28px 12px;text-align:center;color:var(--text-dim);font-size:13px;">✓ All Square items are already assigned.</div>';
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
<div style="margin-bottom:10px;">
  <div draggable="true"
    ondragstart="invMgrDragStart(event,'category','${catSafe}','${_invMgrEscAttr(group.name)}')"
    ondragend="this.style.opacity=''"
    style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;cursor:grab;background:var(--card-head-bg);border:1px solid var(--bdr);font-size:12px;font-weight:600;color:var(--text);user-select:none;"
    title="Drag to assign entire category (${items.length} items)">
    <span style="color:var(--text-dim);font-size:10px;">⠿⠿</span>
    <span style="flex:1;">${nameSafe}</span>
    <span style="font-size:10.5px;color:var(--text-dim);font-weight:400;">${group.items.length} items</span>
    <span style="font-size:10px;background:var(--accent-bg,#F5EDDF);color:var(--accent,#8B6914);border-radius:4px;padding:1px 5px;">CAT</span>
  </div>`;

    items.forEach(item => {
      const name    = item.item_data?.name || 'Unnamed';
      const itemSafe = _invMgrEsc(item.id);
      html += `
  <div draggable="true"
    ondragstart="invMgrDragStart(event,'item','${itemSafe}','${_invMgrEscAttr(name)}')"
    ondragend="this.style.opacity=''"
    style="display:flex;align-items:center;gap:6px;padding:4px 8px 4px 16px;cursor:grab;font-size:12.5px;color:var(--text);border-radius:5px;user-select:none;transition:background 0.1s;"
    onmouseenter="this.style.background='var(--bdr-light,#F0EBE3)'"
    onmouseleave="this.style.background=''">
    <span style="color:var(--text-dim);font-size:9px;opacity:0.5;">⠿</span>
    <span style="flex:1;">${_invMgrEsc(name)}</span>
  </div>`;
    });

    html += '</div>';
  });

  // ── Hidden / deprecated section ──────────────
  const hiddenIds  = _invMgrGetHidden();
  const hiddenVars = !q ? _invMgrGetHiddenVars() : [];

  if ((hiddenIds.size || hiddenVars.length) && !q) {
    html += `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--bdr);">
  <div style="font-size:10px;font-weight:700;color:var(--text-dim);letter-spacing:0.5px;margin-bottom:6px;">DEPRECATED (HIDDEN FROM APP)</div>`;

    // Hidden whole items
    hiddenIds.forEach(id => {
      // Try to find name from catalog groups
      let name = id;
      Object.values(_invMgrCatalogData.groups || {}).forEach(g => {
        const match = g.items.find(i => i.id === id);
        if (match) name = match.item_data?.name || id;
      });
      html += `
  <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px;font-size:12px;color:var(--text-dim);">
    <span style="flex:1;"><span style="text-decoration:line-through;opacity:0.7;">${_invMgrEsc(name)}</span> <span style="font-size:10px;opacity:0.5;">(item)</span></span>
    <button onclick="invMgrRestoreItem('${_invMgrEsc(id)}')"
      style="font-size:11px;padding:2px 7px;border-radius:4px;border:1px solid var(--bdr);background:var(--card-bg);color:var(--text);cursor:pointer;">Restore</button>
  </div>`;
    });

    // Hidden variations
    hiddenVars.forEach(({ varId, varName, itemName }) => {
      const label = varName ? `${_invMgrEsc(itemName)} — ${_invMgrEsc(varName)}` : _invMgrEsc(itemName);
      html += `
  <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px;font-size:12px;color:var(--text-dim);">
    <span style="flex:1;"><span style="text-decoration:line-through;opacity:0.7;">${label}</span> <span style="font-size:10px;opacity:0.5;">(variation)</span></span>
    <button onclick="invMgrRestoreVar('${_invMgrEsc(varId)}')"
      style="font-size:11px;padding:2px 7px;border-radius:4px;border:1px solid var(--bdr);background:var(--card-bg);color:var(--text);cursor:pointer;">Restore</button>
  </div>`;
    });

    html += '</div>';
  }

  el.innerHTML = html || '<div style="padding:28px 12px;text-align:center;color:var(--text-dim);font-size:13px;">No matches</div>';
}

function _invMgrGetHidden() {
  try { return new Set(JSON.parse(localStorage.getItem('sts-inv-hidden') || '[]')); } catch { return new Set(); }
}

function _invMgrGetHiddenVars() {
  try { return JSON.parse(localStorage.getItem('sts-inv-hidden-vars') || '[]'); } catch { return []; }
}

function _invMgrClearInvCache() {
  if (typeof _invData !== 'undefined') Object.keys(_invData).forEach(k => delete _invData[k]);
  if (typeof window._invLoaded        !== 'undefined') window._invLoaded        = false;
  if (typeof window._invRingLoaded    !== 'undefined') window._invRingLoaded    = false;
  if (typeof window._invPendantLoaded !== 'undefined') window._invPendantLoaded = false;
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
  ['earrings', 'rings', 'pendants'].forEach(m => {
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
      return `<div style="display:inline-flex;align-items:center;gap:3px;background:var(--accent-bg,#F5EDDF);border:1px solid var(--accent,#C9A96E);border-radius:20px;padding:2px 6px 2px 9px;font-size:11.5px;color:var(--text);margin:2px;max-width:100%;">
        <span title="${nSafe}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;">${icon}${nSafe}</span>
        <button onclick="invMgrRemove('${key}',${idx})" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:14px;padding:0 0 0 3px;line-height:1;flex-shrink:0;" title="Remove">✕</button>
      </div>`;
    }).join('');

    const placeholder = !entries.length
      ? '<div style="font-size:11.5px;color:var(--text-dim);opacity:0.55;margin-top:4px;">drop here</div>'
      : '';

    return `<div
      ondragover="event.preventDefault();this.querySelector('.invMgrZoneInner').style.borderColor='var(--accent,#C9A96E)'"
      ondragleave="this.querySelector('.invMgrZoneInner').style.borderColor=''"
      ondrop="invMgrDrop(event,'${key}');this.querySelector('.invMgrZoneInner').style.borderColor=''">
      <div class="invMgrZoneInner" style="border:2px dashed var(--bdr);border-radius:8px;padding:8px 10px;min-height:76px;transition:border-color 0.15s;background:var(--card-bg);">
        <div style="font-size:11px;font-weight:700;color:var(--text-dim);letter-spacing:0.3px;margin-bottom:5px;text-transform:uppercase;">${_invMgrEsc(label)}</div>
        <div style="display:flex;flex-wrap:wrap;">${chips}</div>
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
