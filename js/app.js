// ════════════════════════════════════════════
//  APP CORE  —  pages/app.js  [v50]
//  Shared helpers, tab switching, storage, bootstrap
// ════════════════════════════════════════════

function initials(name) {
  return name.replace(/[()0-9\-]/g,'').trim().split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase() || '??';
}

function deadlineInfo(ds) {
  if (!ds) return { cls:'dl-none', text:'No deadline' };
  const d   = new Date(ds);
  const diff = Math.round((d - TODAY) / 86400000);
  if (diff < 0)  return { cls:'dl-past', text:`${Math.abs(diff)}d overdue` };
  if (diff <= 7) return { cls:'dl-soon', text:`Due in ${diff}d` };
  return { cls:'dl-ok', text: d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) };
}

function fmtDate(ds) {
  if (!ds || ds === '—') return '—';
  return new Date(ds).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

function fmtPrice(p) { return p ? '$' + p.toLocaleString() : ''; }

function toast(msg, icon='✓') {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

// ════════════════════════════════════════════

//  TOUCH DRAG  —  Trello-for-iPad style long-press finger drag
//  Native HTML5 drag-and-drop (ondragstart/ondragover) never fires for
//  touch pointers, so the kanban + Ready-to-Ship boards get this separate
//  pointer-events implementation. It only engages for touch/pen pointers
//  while the viewport is in the iPad band (769–1024px, see CSS) — outside
//  that band it's a no-op: phone keeps the tap-to-move sheet, desktop
//  keeps native mouse drag-and-drop.
// ════════════════════════════════════════════
const TOUCH_DRAG_DROP_SEL = '.k-body, .prod-col-body';
const TOUCH_DRAG_LONGPRESS_MS = 300;
const TOUCH_DRAG_MOVE_TOLERANCE = 10;

function isIpadDragWidth() {
  // Touch-capability check, not a width range — a 12.9" iPad Pro is 1366px
  // wide in landscape, so any fixed upper bound keeps missing some iPad
  // size/orientation. A real desktop window has a mouse (hover:hover) even
  // at that same width, so this stays false there regardless of width.
  return window.innerWidth > 768 &&
    window.matchMedia('(pointer: coarse) and (hover: none)').matches;
}

function _touchDragHighlight(bodyEl, on) {
  const cls = bodyEl.classList.contains('prod-col-body') ? 'prod-drag-over' : 'drag-over';
  bodyEl.classList.toggle(cls, on);
}

function cardPointerDown(ev, orderId, kind) {
  if (ev.pointerType === 'mouse' || !isIpadDragWidth()) return;
  const card = ev.currentTarget;
  const startX = ev.clientX, startY = ev.clientY;
  let dragging = false, ghost = null, longPressTimer, lastBody = null;

  function onMove(mv) {
    if (!dragging) {
      if (Math.abs(mv.clientX - startX) > TOUCH_DRAG_MOVE_TOLERANCE ||
          Math.abs(mv.clientY - startY) > TOUCH_DRAG_MOVE_TOLERANCE) clearTimeout(longPressTimer);
      return;
    }
    mv.preventDefault();
    ghost.style.left = (mv.clientX - ghost._w / 2) + 'px';
    ghost.style.top  = (mv.clientY - ghost._h / 2) + 'px';
    const under = document.elementFromPoint(mv.clientX, mv.clientY);
    const body  = under && under.closest(TOUCH_DRAG_DROP_SEL);
    if (body !== lastBody) {
      if (lastBody) _touchDragHighlight(lastBody, false);
      if (body) _touchDragHighlight(body, true);
      lastBody = body;
    }
  }

  function endDrag(up) {
    clearTimeout(longPressTimer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    if (!dragging) return;
    card.style.opacity = '';
    if (lastBody) _touchDragHighlight(lastBody, false);
    if (ghost) { ghost.remove(); ghost = null; }
    const under = up && document.elementFromPoint(up.clientX, up.clientY);
    const body  = under && under.closest(TOUCH_DRAG_DROP_SEL);
    if (body) touchDragResolveMove(kind, orderId, body);
    // A real drag shouldn't also open the order card behind it — swallow the
    // synthetic click that follows pointerup.
    card.addEventListener('click', ce => { ce.stopPropagation(); ce.preventDefault(); }, { capture: true, once: true });
  }

  function startDrag() {
    dragging = true;
    card.style.opacity = '0.4';
    const rect = card.getBoundingClientRect();
    ghost = card.cloneNode(true);
    ghost.className = 'drag-ghost';
    ghost.style.width  = rect.width + 'px';
    ghost._w = rect.width;
    ghost._h = rect.height;
    ghost.style.left = (startX - rect.width / 2) + 'px';
    ghost.style.top  = (startY - rect.height / 2) + 'px';
    document.body.appendChild(ghost);
    if (navigator.vibrate) navigator.vibrate(8);
  }

  longPressTimer = setTimeout(startDrag, TOUCH_DRAG_LONGPRESS_MS);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
}

function touchDragResolveMove(kind, orderId, bodyEl) {
  const order = ORDERS.find(o => o.id === orderId);
  if (!order) return;
  if (kind === 'kanban') {
    const stageId = bodyEl.dataset.stageId;
    if (!stageId) return;
    if (bodyEl.dataset.pickup) order.pickup = bodyEl.dataset.pickup;
    applyStageChange(order, stageId);
  } else if (kind === 'prod' && typeof prodApplyMove === 'function') {
    const colKey = bodyEl.dataset.colKey;
    if (colKey) prodApplyMove(order, colKey);
  }
}

// ════════════════════════════════════════════

//  TAB SWITCHING
// ════════════════════════════════════════════
// Top-level tabs that have NO sub-nav (direct panels)
const DIRECT_TABS = new Set(['gmail','triplog','notes','home','designs','bgab']);

// Each parent group and the ordered sub-tabs it contains
const NAV_GROUPS = {
  'custom-orders': ['dashboard','production','new-order','customers','print-bag'],
  'inventory':     ['to-restock','inv-adjust','prod-report'],
  'supplies':      ['supplier','order-history'],
  'more':          ['sales','calendar','pj-calc','pj-ref'],
};

// Reverse lookup: sub-tab id -> parent group id
const PARENT_OF = {};
Object.keys(NAV_GROUPS).forEach(p => NAV_GROUPS[p].forEach(s => { PARENT_OF[s] = p; }));

// Per-panel "on show" hooks — fired every time a panel becomes active, from
// clicks AND from nav restore, so behaviour is identical through every path.
const TAB_HOOKS = {
  home: function() {
    if (typeof homeTabInit === 'function') homeTabInit();
    if (typeof dashTriplogLoad === 'function') dashTriplogLoad();
  },
  dashboard: function() {
    if (typeof expandedCards !== 'undefined') expandedCards.clear();
    if (typeof renderKanban === 'function') renderKanban();
    if (typeof syncCollapseBtn === 'function') syncCollapseBtn();
  },
  production: function() { if (typeof renderProduction === 'function') setTimeout(renderProduction, 0); },
  sales:      function() { if (typeof renderSales === 'function') setTimeout(renderSales, 0); if (typeof salesAutoSync === 'function') setTimeout(salesAutoSync, 500); },
  gmail:      function() { if (typeof loadScheduledBrief === 'function') loadScheduledBrief(); },
  supplier:   function() { ohInitSupplier(); },
  'order-history': function() { ohInitHistory(); },
  triplog:    function() { if (typeof tlInit === 'function') tlInit(); },
  designs:    function() { if (typeof designsInit === 'function') designsInit(); },
  calendar:   function() { if (typeof calInit === 'function') calInit(); },
  'to-restock': function() { if (typeof restockQueueRender === 'function') restockQueueRender(); if (typeof timerTabInit === 'function') timerTabInit(); },
  'prod-report': function() { if (typeof rqRenderProductionReport === 'function') rqRenderProductionReport(); },
  'pj-ref':   function() { if (typeof pjBuildRef === 'function') pjBuildRef(); },
  bgab:       function() { if (typeof bgabInit === 'function') bgabInit(); },
};
function runTabHook(id) { const h = TAB_HOOKS[id]; if (h) { try { h(); } catch(e) {} } }

// Keep aria-selected in sync with the visual .active state (a11y)
function _syncAria() {
  document.querySelectorAll('.nav-tab, .sub-nav-tab').forEach(t => {
    t.setAttribute('aria-selected', t.classList.contains('active') ? 'true' : 'false');
  });
}

// Center the active tab within its (horizontally scrollable) bar so you can
// always see where you are — matters on mobile where the bar scrolls and a
// page reload resets scrollLeft to 0 (active tab could be off-screen).
function _scrollTabIntoView(el) {
  if (!el) return;
  const c = el.parentElement;
  if (!c || c.scrollWidth <= c.clientWidth) return; // not scrollable (desktop)
  const er = el.getBoundingClientRect(), cr = c.getBoundingClientRect();
  c.scrollLeft += (er.left - cr.left) - (c.clientWidth - el.offsetWidth) / 2;
}
function _scrollActiveIntoView() {
  _scrollTabIntoView(document.querySelector('.nav-tab.active'));
  _scrollTabIntoView(document.querySelector('.sub-nav.active .sub-nav-tab.active'));
  // Mirror active state onto the mobile bottom quick-bar
  document.querySelectorAll('.botnav-item').forEach(b => {
    const t = b.getAttribute('data-target');
    b.classList.toggle('active', t === (document.querySelector('.nav-tab.active')?.getAttribute('data-parent')
      || document.querySelector('.nav-tab.active')?.getAttribute('data-tab')));
  });
}

// Connection-health pill in the header. Reflects whether the last Notion
// call (the source of truth) actually succeeded, so a silent backend
// failure is visible at a glance instead of looking "connected".
function setConnStatus(ok) {
  const pill = document.getElementById('connPill');
  if (!pill) return;
  pill.classList.toggle('conn-bad', !ok);
  const label = pill.querySelector('.conn-label');
  if (label) label.textContent = ok ? 'Notion connected' : 'Notion unreachable';
}

// Find the top-nav element for a parent group or a direct tab
function _navTabEl(id) {
  return document.querySelector('.nav-tab[data-parent="' + id + '"]')
      || document.querySelector('.nav-tab[data-tab="' + id + '"]');
}

// Show exactly one tab panel, fire its hook, refresh aria
function _showPanel(id) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + id);
  if (panel) panel.classList.add('active');
  runTabHook(id);
  _syncAria();
  _scrollActiveIntoView();
}

// Universal entry point — jump to ANY tab by id, whether it's a direct
// top-level tab or a sub-tab inside a group. Safe for all cross-module callers.
function switchTab(id, el) {
  const parent = PARENT_OF[id];
  if (parent) {
    switchParent(parent, _navTabEl(parent), true, true); // skipSave, skipFirstSub
    switchSubTab(id, el);
    return;
  }
  // Direct top-level tab (gmail / triplog / notes)
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-nav').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sub-nav-tab').forEach(t => t.classList.remove('active'));
  const navEl = el || _navTabEl(id);
  if (navEl) navEl.classList.add('active');
  _showPanel(id);
  _navSave('parent', id);
}

// One-time inits for Supplies sub-tabs
function ohInitSupplier() {
  if (!window._sotDone) { window._sotDone = true; sotInit(); }
}
function ohInitHistory() {
  if (!window._ohDone) { window._ohDone = true; ohInit(); }
}

// ── Nav state persistence ────────────────────
// Saves/restores the active parent + active sub across hard refreshes
function _navSave(key, val) {
  try { localStorage.setItem('sts-nav-' + key, val); } catch(e) {}
}
function _navGet(key) {
  try { return localStorage.getItem('sts-nav-' + key); } catch(e) { return null; }
}

function _navRestore() {
  let parent = _navGet('parent') || 'custom-orders';

  // Direct top-level tab
  if (DIRECT_TABS.has(parent)) { switchTab(parent, _navTabEl(parent)); return; }

  // Unknown/legacy parent (e.g. old 'operations'/'tools') -> safe default
  if (!NAV_GROUPS[parent]) parent = 'custom-orders';

  switchParent(parent, _navTabEl(parent), true, true); // skipSave, skipFirstSub

  // Restore the active sub-tab (also accepts the legacy '<parent>-sub' key)
  const sub = _navGet('sub-' + parent) || _navGet(parent + '-sub') || NAV_GROUPS[parent][0];
  switchSubTab(sub, null, true);

  // Inventory keeps an internal category structure inside the Adjust panel
  if (parent === 'inventory' && sub === 'inv-adjust') {
    const invMain = _navGet('inv-main') || 'earrings';
    if (typeof invSwitchMain === 'function') invSwitchMain(invMain);
    if (invMain === 'rings') {
      if (!window._invRingLoaded && typeof invLoadRings === 'function') invLoadRings();
      const ringSub = _navGet('inv-ring-sub');
      if (ringSub) {
        const ringEl = document.querySelector('.inv-ring-sub-btn[id="inv-ring-subtab-' + ringSub + '"]');
        if (typeof invSwitchRingSub === 'function') invSwitchRingSub(ringSub, ringEl);
      }
    } else if (invMain === 'pendants') {
      if (!window._invPendantLoaded && typeof invLoadPendants === 'function') invLoadPendants();
      const pendSub = _navGet('inv-pendant-sub') || 'p-spirit';
      const pendEl = document.querySelector('.inv-pendant-sub-btn[id="inv-pendant-subtab-' + pendSub + '"]');
      if (typeof invSwitchPendantSub === 'function') invSwitchPendantSub(pendSub, pendEl);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => setTimeout(_navRestore, 0));

// Keyboard support: Enter/Space activates a focused tab; Arrows move focus
document.addEventListener('keydown', function(e) {
  const t = e.target;
  if (!t || !t.classList) return;
  if (!t.classList.contains('nav-tab') && !t.classList.contains('sub-nav-tab')) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    t.click();
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const sibs = Array.from(t.parentElement.children).filter(n => n.matches('.nav-tab, .sub-nav-tab'));
    const next = sibs[sibs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) next.focus();
  }
});

// Activate a parent group: highlight its nav tab, reveal its sub-nav, and
// (unless skipped) open its first sub-tab.
function switchParent(parentId, el, _skipSave, _skipFirstSub) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-nav').forEach(s => s.classList.remove('active'));
  const navEl = el || _navTabEl(parentId);
  if (navEl) navEl.classList.add('active');
  const subNav = document.getElementById('sub-nav-' + parentId);
  if (subNav) subNav.classList.add('active');
  // Lazy-load inventory data the first time its group is opened
  if (parentId === 'inventory' && !window._invLoaded && typeof window.invLoad === 'function') window.invLoad();
  if (!_skipFirstSub) {
    document.querySelectorAll('.sub-nav-tab').forEach(t => t.classList.remove('active'));
    const firstSub = subNav && subNav.querySelector('.sub-nav-tab');
    if (firstSub) {
      firstSub.classList.add('active');
      const firstId = firstSub.getAttribute('data-tab');
      _showPanel(firstId);
      if (!_skipSave) _navSave('sub-' + parentId, firstId);
    }
  }
  if (!_skipSave) _navSave('parent', parentId);
  _syncAria();
}

// Activate a sub-tab within its parent group's sub-nav
function switchSubTab(id, el, _skipSave) {
  const parent = PARENT_OF[id];
  document.querySelectorAll('.sub-nav-tab').forEach(t => t.classList.remove('active'));
  const subEl = el || (parent && document.querySelector('#sub-nav-' + parent + ' .sub-nav-tab[data-tab="' + id + '"]'));
  if (subEl) subEl.classList.add('active');
  _showPanel(id);
  if (!_skipSave && parent) { _navSave('parent', parent); _navSave('sub-' + parent, id); }
}

// ════════════════════════════════════════════

function safeSendPrompt(msg) {
  if (typeof sendPrompt === 'function') {
    sendPrompt(msg);
  } else if (window !== window.parent) {
    // Running inside a Cowork artifact iframe — relay to parent
    window.parent.postMessage({ type: 'sts-sendPrompt', msg: msg }, '*');
  }
}


// Persistence: IndexedDB (via js/store.js) is authoritative; localStorage
// keeps a photo-less mirror as a synchronous fallback + rollback path.
// Both sides carry a savedAt stamp so load can pick whichever is newer
// (e.g. the tab closed after the mirror wrote but before IndexedDB did).
async function saveToStorage() {
  const stamp = Date.now();

  // Mirror first — synchronous, so even an immediate tab close keeps it.
  let mirrorOk = false;
  try {
    const mirror = ORDERS.map(o => {
      if (!o.photo) return o;
      const copy = Object.assign({}, o);   // strip legacy base64 photos —
      delete copy.photo;                   // they're what used to blow the
      copy.hasPhoto = true;                // 5 MB localStorage quota
      return copy;
    });
    localStorage.setItem('sts-orders', JSON.stringify(mirror));
    localStorage.setItem('sts-hidden', JSON.stringify([...completedHidden]));
    localStorage.setItem('sts-orders-savedat', String(stamp));
    mirrorOk = true;
  } catch(e) {
    console.error('saveToStorage: localStorage mirror failed', e);
  }

  try {
    await DB.set('kv', 'orders', ORDERS);
    await DB.set('kv', 'hidden', [...completedHidden]);
    await DB.set('kv', 'savedAt', stamp);
  } catch(e) {
    console.error('saveToStorage: IndexedDB write failed', e);
    if (!mirrorOk && typeof toast === 'function') {
      toast('⚠ Local save failed — recent changes may not survive a reload', '⚠');
    }
  }
}

// ── One-time migration: localStorage → IndexedDB ─────────────
// All-or-nothing: the flag is only set after everything is written, so a
// failure midway just retries on the next boot (photo puts are idempotent).
// The original localStorage data is never modified here — if migration
// throws, loadFromStorage falls back to it exactly as before.
async function migrateFromLocalStorage() {
  if (await DB.get('kv', 'migrated-v1')) return;
  const raw = localStorage.getItem('sts-orders');
  if (raw) {
    const orders = JSON.parse(raw);
    if (Array.isArray(orders)) {
      for (const o of orders) {
        if (o && o.photo && String(o.photo).slice(0, 5) === 'data:') {
          const blob = await (await fetch(o.photo)).blob();
          await DB.set('photos', o.id, blob);
          delete o.photo;
          o.hasPhoto = true;
        }
      }
      await DB.set('kv', 'orders', orders);
      const hiddenRaw = localStorage.getItem('sts-hidden');
      if (hiddenRaw) await DB.set('kv', 'hidden', JSON.parse(hiddenRaw));
      await DB.set('kv', 'savedAt', Date.now());
    }
  }
  await DB.set('kv', 'migrated-v1', true);
  console.log('Storage migrated to IndexedDB');
}

async function loadFromStorage() {
  try { await migrateFromLocalStorage(); }
  catch(e) { console.error('Storage migration failed — will retry next load', e); }

  let loaded = null;

  // Preferred source: IndexedDB — unless the localStorage mirror is newer
  // (IndexedDB write was interrupted on the previous save).
  try {
    const idbStamp = (await DB.get('kv', 'savedAt')) || 0;
    let lsStamp = 0;
    try { lsStamp = parseInt(localStorage.getItem('sts-orders-savedat') || '0', 10) || 0; } catch(e) {}
    if (idbStamp >= lsStamp) {
      const idbOrders = await DB.get('kv', 'orders');
      if (Array.isArray(idbOrders) && idbOrders.length > 0) {
        loaded = idbOrders;
        const hidden = await DB.get('kv', 'hidden');
        (hidden || []).forEach(id => completedHidden.add(id));
      }
    }
  } catch(e) {
    console.error('IndexedDB load failed — falling back to localStorage', e);
  }

  // Fallback: localStorage (the mirror, or pre-migration original data)
  if (!loaded) {
    try {
      const saved = localStorage.getItem('sts-orders');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) loaded = parsed;
      }
      const hiddenSaved = localStorage.getItem('sts-hidden');
      if (hiddenSaved) { JSON.parse(hiddenSaved).forEach(id => completedHidden.add(id)); }
    } catch(e) {}
  }

  if (loaded) {
    ORDERS.length = 0;
    loaded.forEach(o => ORDERS.push(o));
  }

  // Migrate legacy stage IDs to new ones
  let migrated = false;
  ORDERS.forEach(o => {
    if (o.stage === 'inquiry')   { o.stage = 'intake-custom'; migrated = true; }
    if (o.stage === 'wait-cust') { o.stage = 'contact-need';  migrated = true; }
    if (o.stage === 'repair')    { o.stage = 'intake-repair'; migrated = true; }
  });
  if (migrated) saveToStorage();
  if (typeof updateCompletedToggle === 'function') updateCompletedToggle();
}

// ════════════════════════════════════════════
//  THEME
// ════════════════════════════════════════════
function setTheme(theme) {
  document.body.className = theme ? 'theme-' + theme : '';
  try { localStorage.setItem('sts-theme', theme); } catch(e) {}
  // Update active swatch
  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.classList.toggle('active', (s.dataset.theme || '') === theme);
  });
  // Close picker
  const picker = document.getElementById('themePicker');
  if (picker) picker.classList.remove('open');
}

function toggleThemePicker() {
  const picker = document.getElementById('themePicker');
  if (picker) picker.classList.toggle('open');
}

// ════════════════════════════════════════════
//  APP BOOTSTRAP  —  runs once, on DOMContentLoaded
//  (Previously split across a DOMContentLoaded handler and a parse-time
//  IIFE that each ran loadFromStorage — now one async sequence that
//  waits for storage before the first render.)
// ════════════════════════════════════════════
let _booted = false;
async function bootstrapApp() {
  if (_booted) return;
  _booted = true;

  // Restore theme (synchronous, before content renders)
  const savedTheme = localStorage.getItem('sts-theme') || '';
  if (savedTheme) setTheme(savedTheme);

  // Restore orders + hidden set (IndexedDB, migrating from localStorage on
  // first run), then warm the photo object-URL cache so cardHTML can
  // render photos synchronously.
  await loadFromStorage();
  if (typeof photoPreloadAll === 'function') await photoPreloadAll();

  if (typeof renderKanban === 'function') renderKanban();
  if (typeof renderCustomers === 'function') renderCustomers();
  if (typeof loadNotes === 'function') loadNotes();

  // Load Gmail brief (localStorage fallback first, then try scheduled JSON)
  if (typeof loadGmailOverview === 'function') loadGmailOverview();
  if (typeof loadScheduledBrief === 'function') loadScheduledBrief();

  // Load customers from cache instantly, then refresh from Notion in background
  if (typeof loadCustomersFromCache === 'function') loadCustomersFromCache();
  if (typeof loadCustomersFromNotion === 'function') loadCustomersFromNotion();

  // Push any local orders missing a notionId, then pull everything from Notion
  if (typeof notionPushUnsynced === 'function') {
    notionPushUnsynced().then(() => {
      if (typeof notionStartupSync === 'function') notionStartupSync();
    });
  }

  // Unregister any old service workers
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    });
  }

  // Close theme picker on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.theme-wrap')) {
      const picker = document.getElementById('themePicker');
      if (picker) picker.classList.remove('open');
    }
  });
}
document.addEventListener('DOMContentLoaded', bootstrapApp);

