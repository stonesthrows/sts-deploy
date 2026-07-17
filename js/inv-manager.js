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

const _INVMGR_KEY        = 'sts-inv-extra';
const _INVMGR_CUSTOM_KEY = 'sts-inv-custom-tabs';

const _INVMGR_TABS = {
  earrings: {
    icon: '🪬',
    label: 'Earrings',
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
    label: 'Rings',
    subs: [
      { key: 'stackable',  label: 'Stackable' },
      { key: 'spirit',     label: 'Spirit Animal' },
      { key: 'geometric',  label: 'Geometric' },
      { key: 'symbolic',   label: 'Symbolic' },
    ],
  },
  pendants: {
    icon: '📿',
    label: 'Pendants',
    subs: [
      { key: 'p-spirit',    label: 'Spirit Animal' },
      { key: 'p-geometric', label: 'Geometric' },
      { key: 'p-symbolic',  label: 'Symbolic' },
    ],
  },
  permjewelry: {
    icon: '🔗',
    label: 'Perm. Jewelry',
    subs: [
      { key: 'pj-birthstone', label: 'Silver Birthstone Charms' },
      { key: 'pj-giftfill',   label: 'Silver and Gold Fill Charms' },
    ],
  },
  noserings: {
    icon: '👃',
    label: 'Nose Rings',
    subs: [
      { key: 'nose-rings', label: 'Faux Nose Rings' },
    ],
  },
  meditation: {
    icon: '🧘',
    label: 'Meditation Rings',
    subs: [
      { key: 'meditation', label: 'Meditation Rings' },
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

// Custom tabs created by the user in this modal.
// Format: { mains: [ {key,label,icon} ], subs: { [mainKey]: [ {key,label} ] } }
function _invMgrCustomGet() {
  try {
    const c = JSON.parse(localStorage.getItem(_INVMGR_CUSTOM_KEY) || 'null');
    if (c) return { mains: c.mains || [], subs: c.subs || {} };
  } catch {}
  return { mains: [], subs: {} };
}

function _invMgrCustomSave(c) {
  localStorage.setItem(_INVMGR_CUSTOM_KEY, JSON.stringify(c));
  // Re-inject the custom tabs into the live Inventory tab immediately
  if (typeof _invCustomRender === 'function') _invCustomRender();
}

// Built-in tabs merged with user-created ones
function _invMgrTabs() {
  const merged = {};
  Object.entries(_INVMGR_TABS).forEach(([k, t]) => {
    merged[k] = { icon: t.icon, label: t.label, subs: t.subs.map(s => ({ ...s })), custom: false };
  });
  const c = _invMgrCustomGet();
  c.mains.forEach(m => {
    merged[m.key] = { icon: m.icon || '💎', label: m.label, subs: [], custom: true };
  });
  Object.entries(c.subs).forEach(([main, subs]) => {
    if (merged[main]) subs.forEach(s => merged[main].subs.push({ key: s.key, label: s.label, custom: true }));
  });
  return merged;
}

function _invMgrAllKeys() {
  const seen = new Set();
  return Object.values(_invMgrTabs()).flatMap(t => t.subs.map(s => s.key)).filter(k => {
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

  _invMgrRenderMainTabs();
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

        <!-- Main tab switcher (rendered by _invMgrRenderMainTabs) -->
        <div style="display:flex;align-items:center;gap:4px;padding:8px 14px;border-bottom:1px solid var(--bdr);flex-shrink:0;background:var(--card-head-bg);flex-wrap:wrap;">
          <div id="invMgrMainTabs" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;"></div>
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
  Object.keys(_invMgrTabs()).forEach(m => {
    const btn = document.getElementById('invMgrMainBtn-' + m);
    if (btn) btn.classList.toggle('active', m === main);
  });
  _invMgrRenderRight();
}

function _invMgrRenderMainTabs() {
  const el = document.getElementById('invMgrMainTabs');
  if (!el) return;
  const tabs = _invMgrTabs();
  el.innerHTML = Object.entries(tabs).map(([k, t]) =>
    `<button id="invMgrMainBtn-${k}" class="inv-ear-sub${k === _invMgrCurMain ? ' active' : ''}" onclick="invMgrSwitchMain('${k}')">${t.icon} ${_invMgrEsc(t.label)}</button>`
  ).join('') +
  `<button onclick="invMgrAddMain()" class="inv-ear-sub" title="Add a new main tab" style="border-style:dashed;">＋ Tab</button>`;
}

function _invMgrRenderRight() {
  const el = document.getElementById('invMgrZones');
  if (!el) return;

  const tabs = _invMgrTabs();
  const tab  = tabs[_invMgrCurMain];
  const subs = tab?.subs || [];

  let html = subs.map(({ key, label, custom }) => {
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
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
          <div style="flex:1;font-size:11px;font-weight:700;color:var(--text-dim);letter-spacing:0.3px;text-transform:uppercase;">${_invMgrEsc(label)}</div>
          ${custom ? `<button onclick="invMgrDeleteSub('${key}')" title="Delete this sub-tab" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px;padding:0 2px;line-height:1;opacity:0.5;">🗑</button>` : ''}
        </div>
        <div style="display:flex;flex-wrap:wrap;">${chips}</div>
        ${placeholder}
      </div>
    </div>`;
  }).join('');

  // "＋ Add Sub-tab" tile (always) + "Delete Tab" tile (custom main tabs only)
  html += `<div>
    <div onclick="invMgrAddSub()"
      style="border:2px dashed var(--bdr);border-radius:8px;min-height:76px;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;color:var(--text-dim);font-size:12.5px;font-weight:600;transition:border-color 0.15s,color 0.15s;"
      onmouseenter="this.style.borderColor='var(--accent,#C9A96E)';this.style.color='var(--accent,#C9A96E)'"
      onmouseleave="this.style.borderColor='';this.style.color=''">＋ Add Sub-tab</div>
  </div>`;

  if (tab?.custom) {
    html += `<div>
      <div onclick="invMgrDeleteMain()"
        style="border:2px dashed var(--bdr);border-radius:8px;min-height:76px;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;color:var(--text-dim);font-size:12.5px;transition:border-color 0.15s,color 0.15s;"
        onmouseenter="this.style.borderColor='#dc2626';this.style.color='#dc2626'"
        onmouseleave="this.style.borderColor='';this.style.color=''">🗑 Delete "${_invMgrEsc(tab.label)}" Tab</div>
    </div>`;
  }

  el.innerHTML = html;
}

// ── Add / delete tabs & sub-tabs ──────────────

function _invMgrSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tab';
}

function _invMgrUniqueKey(base, taken) {
  let k = base, i = 2;
  while (taken.has(k)) k = base + '-' + i++;
  return k;
}

function invMgrAddMain() {
  const name = (prompt('Name for the new main tab (e.g. "Bracelets"):') || '').trim();
  if (!name) return;
  const icon = (prompt('Emoji icon for the tab:', '💎') || '').trim() || '💎';
  const c = _invMgrCustomGet();
  const taken = new Set(Object.keys(_invMgrTabs()));
  const key = _invMgrUniqueKey(_invMgrSlug(name), taken);
  c.mains.push({ key, label: name, icon });
  if (!c.subs[key]) c.subs[key] = [];
  _invMgrCustomSave(c);
  _invMgrCurMain = key;
  _invMgrRenderMainTabs();
  _invMgrRenderRight();
  toast(`Tab "${name}" added — now add a sub-tab to it`, '✓');
}

function invMgrAddSub() {
  const tabs = _invMgrTabs();
  const tab  = tabs[_invMgrCurMain];
  if (!tab) return;
  const name = (prompt(`Name for the new sub-tab under "${tab.label}":`) || '').trim();
  if (!name) return;
  const c = _invMgrCustomGet();
  const taken = new Set(Object.values(tabs).flatMap(t => t.subs.map(s => s.key)));
  const key = _invMgrUniqueKey(_invMgrSlug(name), taken);
  if (!c.subs[_invMgrCurMain]) c.subs[_invMgrCurMain] = [];
  c.subs[_invMgrCurMain].push({ key, label: name });
  _invMgrCustomSave(c);
  if (!Array.isArray(_invMgrState[key])) _invMgrState[key] = [];
  _invMgrRenderRight();
  toast(`Sub-tab "${name}" added — drag items into it`, '✓');
}

function invMgrDeleteSub(key) {
  const c = _invMgrCustomGet();
  let label = key, mainKey = null;
  Object.entries(c.subs).forEach(([m, arr]) => arr.forEach(s => {
    if (s.key === key) { label = s.label; mainKey = m; }
  }));
  if (!mainKey) return;
  const n = (_invMgrState[key] || []).length;
  if (!confirm(`Delete sub-tab "${label}"${n ? ` and its ${n} assigned item(s)` : ''}? Items stay in Square — they just leave this app.`)) return;

  c.subs[mainKey] = c.subs[mainKey].filter(s => s.key !== key);
  delete _invMgrState[key];
  // Scrub persisted assignments so nothing orphans
  try {
    const extra = JSON.parse(localStorage.getItem(_INVMGR_KEY) || '{}');
    delete extra[key];
    localStorage.setItem(_INVMGR_KEY, JSON.stringify(extra));
  } catch {}
  _invMgrCustomSave(c);
  _invMgrClearInvCache();
  _invMgrRenderRight();
  toast('Sub-tab deleted', '🗑');
}

function invMgrDeleteMain() {
  const c = _invMgrCustomGet();
  const main = c.mains.find(m => m.key === _invMgrCurMain);
  if (!main) return;
  const subs = c.subs[main.key] || [];
  if (!confirm(`Delete tab "${main.label}"${subs.length ? ` and its ${subs.length} sub-tab(s)` : ''}? Items stay in Square — they just leave this app.`)) return;

  try {
    const extra = JSON.parse(localStorage.getItem(_INVMGR_KEY) || '{}');
    subs.forEach(s => { delete extra[s.key]; delete _invMgrState[s.key]; });
    localStorage.setItem(_INVMGR_KEY, JSON.stringify(extra));
  } catch {}
  c.mains = c.mains.filter(m => m.key !== main.key);
  delete c.subs[main.key];
  _invMgrCustomSave(c);
  _invMgrClearInvCache();
  _invMgrCurMain = 'earrings';
  _invMgrRenderMainTabs();
  _invMgrRenderRight();
  toast('Tab deleted', '🗑');
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

  const custom = _invMgrCustomGet();
  if (custom.mains.length || Object.values(custom.subs).some(a => a.length)) {
    lines.push('');
    lines.push('// Custom tabs created in the Inventory Manager (fallback when localStorage is empty)');
    lines.push('const INV_CUSTOM_TABS = ' + JSON.stringify(custom, null, 2) + ';');
  }

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
