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

//  TAB SWITCHING
// ════════════════════════════════════════════
// Sub-tabs that live under Custom Orders
const SUB_TABS = new Set(['dashboard','customers','production']);
// Sub-tabs that live under Supplies (within Operations)
const SUPPLIES_TABS = new Set(['supplier','order-history']);

function switchTab(id, el) {
  // If this is a Custom Orders sub-tab
  if (SUB_TABS.has(id)) {
    const parentEl = document.querySelector('[data-parent="custom-orders"]');
    switchParent('custom-orders', parentEl);
    const subEl = el || document.querySelector('[data-tab="' + id + '"].sub-nav-tab');
    switchSubTab(id, subEl);
    return;
  }
  // If this is a Supplies sub-tab, route via Operations
  if (SUPPLIES_TABS.has(id)) {
    const parentEl = document.querySelector('[data-parent="operations"]');
    switchParent('operations', parentEl);
    const suppliesTab = document.querySelector('#sub-nav-operations .sub-nav-tab[data-tab="supplies"]');
    switchOpsTab('supplies', suppliesTab);
    const subEl = el || document.querySelector('#sub-sub-nav-supplies .sub-sub-nav-tab[data-tab="' + id + '"]');
    switchSuppliesTab(id, subEl);
    if (id === 'supplier')      ohInitSupplier();
    if (id === 'order-history') ohInitHistory();
    return;
  }
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-nav').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sub-nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-sub-nav').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  if (el) el.classList.add('active');
  if (id === 'sales') { setTimeout(renderSales, 0); setTimeout(salesAutoSync, 500); }
  if (id === 'production') setTimeout(renderProduction, 0);
  if (id === 'gmail') loadScheduledBrief();
}

// Switch between Sales / Supplies / Trips within Operations sub-nav
function switchOpsTab(id, el) {
  document.querySelectorAll('#sub-nav-operations .sub-nav-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.sub-sub-nav').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  if (id === 'supplies') {
    const ssn = document.getElementById('sub-sub-nav-supplies');
    if (ssn) ssn.classList.add('active');
    document.querySelectorAll('.sub-sub-nav-tab').forEach(t => t.classList.remove('active'));
    const firstSub = ssn && ssn.querySelector('.sub-sub-nav-tab');
    if (firstSub) firstSub.classList.add('active');
    const firstId = firstSub ? firstSub.getAttribute('data-tab') : 'supplier';
    const panel = document.getElementById('tab-' + firstId);
    if (panel) panel.classList.add('active');
    ohInitSupplier();
  } else {
    const panel = document.getElementById('tab-' + id);
    if (panel) panel.classList.add('active');
    if (id === 'sales') { setTimeout(renderSales, 0); setTimeout(salesAutoSync, 500); }
  }
}

// Switch between sub-tabs within the Supplies sub-sub-nav
function switchSuppliesTab(id, el) {
  document.querySelectorAll('#sub-sub-nav-supplies .sub-sub-nav-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + id);
  if (panel) panel.classList.add('active');
}

// Switch between Notes / Perm. Jewelry within Tools sub-nav
function switchToolsTab(id, el) {
  document.querySelectorAll('#sub-nav-tools .sub-nav-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.sub-sub-nav').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  if (id === 'perm-jewelry') {
    const ssn = document.getElementById('sub-sub-nav-perm-jewelry');
    if (ssn) ssn.classList.add('active');
    document.querySelectorAll('#sub-sub-nav-perm-jewelry .sub-sub-nav-tab').forEach(t => t.classList.remove('active'));
    const firstSub = ssn && ssn.querySelector('.sub-sub-nav-tab');
    if (firstSub) firstSub.classList.add('active');
    const firstId = firstSub ? firstSub.getAttribute('data-tab') : 'pj-calc';
    const panel = document.getElementById('tab-' + firstId);
    if (panel) panel.classList.add('active');
  } else {
    const panel = document.getElementById('tab-' + id);
    if (panel) panel.classList.add('active');
  }
}

// Switch between sub-tabs within the Perm Jewelry sub-sub-nav
function switchPermJewelryTab(id, el) {
  document.querySelectorAll('#sub-sub-nav-perm-jewelry .sub-sub-nav-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + id);
  if (panel) panel.classList.add('active');
}

// One-time inits for Supplies sub-tabs
function ohInitSupplier() {
  if (!window._sotDone) { window._sotDone = true; sotInit(); }
}
function ohInitHistory() {
  if (!window._ohDone) { window._ohDone = true; ohInit(); }
}

function switchParent(parentId, el) {
  // Activate this parent nav tab, hide all sub-navs and sub-sub-navs, show the right one
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-nav').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sub-sub-nav').forEach(s => s.classList.remove('active'));
  if (el) el.classList.add('active');
  const subNav = document.getElementById('sub-nav-' + parentId);
  if (subNav) subNav.classList.add('active');
  // Always show the first sub-tab when switching to a parent tab
  document.querySelectorAll('.sub-nav-tab').forEach(t => t.classList.remove('active'));
  const firstSub = subNav && subNav.querySelector('.sub-nav-tab');
  if (firstSub) firstSub.classList.add('active');
  const defaultId = firstSub ? firstSub.getAttribute('data-tab') : 'dashboard';
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + defaultId);
  if (panel) panel.classList.add('active');
  if (parentId === 'operations') { setTimeout(renderSales, 0); setTimeout(salesAutoSync, 500); }
}

function switchSubTab(id, el) {
  // Deactivate all tab panels and sub-nav tabs, activate the chosen one
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sub-nav-tab').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('tab-' + id);
  if (panel) panel.classList.add('active');
  if (el) el.classList.add('active');
  // When navigating to the kanban board, always reset to expanded view
  if (id === 'dashboard') {
    if (typeof collapsedCards !== 'undefined') collapsedCards.clear();
    if (typeof renderKanban === 'function') renderKanban();
    if (typeof syncCollapseBtn === 'function') syncCollapseBtn();
  }
  if (id === 'production') setTimeout(renderProduction, 0);
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


function saveToStorage() {
  try {
    localStorage.setItem('sts-orders', JSON.stringify(ORDERS));
    localStorage.setItem('sts-hidden', JSON.stringify([...completedHidden]));
  } catch(e) {}
}

// ════════════════════════════════════════════
//  SAVE CHOICE  —  Local vs Notion
// ════════════════════════════════════════════


function loadFromStorage() {
  try {
    const saved = localStorage.getItem('sts-orders');
    if (saved) {
      const loaded = JSON.parse(saved);
      if (Array.isArray(loaded) && loaded.length > 0) {
        ORDERS.length = 0;
        loaded.forEach(o => ORDERS.push(o));
      }
    }
    const hiddenSaved = localStorage.getItem('sts-hidden');
    if (hiddenSaved) { JSON.parse(hiddenSaved).forEach(id => completedHidden.add(id)); }
  } catch(e) {}
  // Migrate legacy stage IDs to new ones
  let migrated = false;
  ORDERS.forEach(o => {
    if (o.stage === 'inquiry')   { o.stage = 'intake-custom'; migrated = true; }
    if (o.stage === 'wait-cust') { o.stage = 'contact-need';  migrated = true; }
    if (o.stage === 'repair')    { o.stage = 'intake-repair'; migrated = true; }
  });
  if (migrated) saveToStorage();
  updateCompletedToggle();
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
//  STARTUP
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  // Restore theme
  const savedTheme = localStorage.getItem('sts-theme') || '';
  if (savedTheme) setTheme(savedTheme);

  // Load order data
  loadFromStorage();
  renderKanban();
  renderCustomers();
  loadNotes();

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
});


async function syncWithNotion() {
  try {
    const notionOrders = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { window.removeEventListener('message', handler); resolve([]); }, 5000);
      function handler(event) {
        if (event.data && event.data.type === 'notion-orders') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve(event.data.orders || []);
        }
      }
      window.addEventListener('message', handler);
      if (typeof sendPrompt === 'function') {
        sendPrompt('sync notion orders: ' + JSON.stringify({
          notion_db: '62de37d7-be83-48eb-a611-f494006d8085',
          orders: ORDERS.map(o => ({ id: o.id, name: o.name, stage: o.stage, price: o.price, deadline: o.deadline, notionId: o.notionId }))
        }));
      } else {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        resolve([]);
      }
    });

    if (notionOrders.length > 0) {
      const photoMap = {};
      const completedMap = {};
      // Preserve locally-set complete/delivered stages so sync never un-completes an order
      ORDERS.forEach(o => {
        if (o.photo) photoMap[o.id] = o.photo;
        if (o.stage === 'complete' || o.stage === 'delivered') {
          completedMap[o.id] = o.stage;
          if (o.notionId) completedMap['n:' + o.notionId] = o.stage;
        }
      });
      // Also load persistent completed registry (survives full ORDERS replacement)
      let completedRegistry = [];
      try { completedRegistry = JSON.parse(localStorage.getItem('sts-completed-registry') || '[]'); } catch(e) {}
      completedRegistry.forEach(r => {
        completedMap[r.id] = 'complete';
        if (r.notionId) completedMap['n:' + r.notionId] = 'complete';
      });

      ORDERS.length = 0;
      notionOrders.forEach(o => {
        const alreadyCompleted = completedMap[o.id] || completedMap['n:' + o.notionId];
        if (alreadyCompleted) { o.stage = 'complete'; }
        if (photoMap[o.id]) o.photo = photoMap[o.id];
        ORDERS.push(o);
      });
      ORDERS.filter(o => o.stage === 'complete' && !completedHidden.has(o.id))
            .forEach(o => completedHidden.add(o.id));
      refreshCustomersFromOrders();
      try {
        localStorage.setItem('sts-orders', JSON.stringify(ORDERS));
        localStorage.setItem('sts-hidden', JSON.stringify([...completedHidden]));
      } catch(e) {}
      renderKanban();
      renderCustomers();
    }
  } catch(e) {
    console.log('Notion sync skipped (no connection):', e.message);
  }
}



// ════════════════════════════════════════════
//  APP BOOTSTRAP  —  runs once DOM is ready
// ════════════════════════════════════════════
(function init() {
  // Restore orders + hidden set from localStorage
  loadFromStorage();

  // Kick off Kanban render (guarded — orders.js may not be loaded yet)
  if (typeof renderKanban === 'function') renderKanban();

  // Restore notes from localStorage
  if (typeof loadNotes === 'function') loadNotes();

  // Load Gmail brief (localStorage fallback first, then try scheduled JSON)
  if (typeof loadGmailOverview === 'function') loadGmailOverview();
  if (typeof loadScheduledBrief === 'function') loadScheduledBrief();

  // Load customers from cache instantly, then refresh from Notion in background
  if (typeof loadCustomersFromCache === 'function') loadCustomersFromCache();
  if (typeof loadCustomersFromNotion === 'function') loadCustomersFromNotion();

  // Try Notion sync (no-op if not connected)
  syncWithNotion().then(() => {
    if (typeof loadCustomersFromNotion === 'function') loadCustomersFromNotion();
  });
})();

