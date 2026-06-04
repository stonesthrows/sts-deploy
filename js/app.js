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
const SUB_TABS = new Set(['dashboard','new-order','customers']);
// Sub-tabs that live under Supplies
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
  // If this is a Supplies sub-tab
  if (SUPPLIES_TABS.has(id)) {
    const parentEl = document.querySelector('[data-parent="supplies"]');
    switchParent('supplies', parentEl);
    const subEl = el || document.querySelector('[data-tab="' + id + '"].sub-nav-tab');
    switchSubTab(id, subEl);
    if (id === 'supplier')      ohInitSupplier();
    if (id === 'order-history') ohInitHistory();
    return;
  }
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-nav').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sub-nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  if (el) el.classList.add('active');
  if (id === 'sales') { setTimeout(renderSales, 0); setTimeout(salesAutoSync, 500); }
  if (id === 'production') setTimeout(renderProduction, 0);
  if (id === 'gmail') loadScheduledBrief();
}

// One-time inits for Supplies sub-tabs
function ohInitSupplier() {
  if (!window._sotDone) { window._sotDone = true; sotInit(); }
}
function ohInitHistory() {
  if (!window._ohDone) { window._ohDone = true; ohInit(); }
}

function switchParent(parentId, el) {
  // Activate this parent nav tab, hide all sub-navs, show the right one
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-nav').forEach(s => s.classList.remove('active'));
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
  if (parentId === 'supplies') ohInitSupplier();
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

// Maps internal stage IDs → Notion Stage select values
const STAGE_TO_NOTION = {
  'intake-custom':  'Inquiry',
  'intake-repair':  'Inquiry',
  'repair':         'Inquiry',
  'sketch-needs':   'Sketch',
  'sketch-wait':    'Sketch',
  'sketch':         'Sketch',
  'needs-est':      'Needs Estimate',
  'quote':          'Estimate Sent',
  'est-appr':       'Estimate Approved',
  'order-mat':      'Order Materials',
  'materials':      'Waiting on Materials',
  'build':          'At the Bench',
  'ready-pick':     'Ready for Pickup',
  'complete':       'Completed',
  'delivered':      'Delivered',
};

// Shows a small modal asking Local vs Notion.
// Falls back to onLocal() silently if not running inside Claude/Cowork.
function showSaveChoice(title, onLocal, onNotion) {
  const inClaude = typeof sendPrompt === 'function' || window !== window.parent;
  if (!inClaude) { onLocal(); return; }

  let bg = document.getElementById('saveChoiceBg');
  if (!bg) {
    bg = document.createElement('div');
    bg.id = 'saveChoiceBg';
    bg.style.cssText = [
      'position:fixed','inset:0','background:rgba(0,0,0,0.45)',
      'z-index:9999','display:flex','align-items:center','justify-content:center'
    ].join(';');
    document.body.appendChild(bg);
  }

  bg.innerHTML = `
    <div style="background:var(--card-bg,#fff);border-radius:14px;padding:24px 24px 20px;
                max-width:340px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.22);">
      <div style="font-size:15px;font-weight:600;color:var(--text,#1E1C19);margin-bottom:5px;">
        Save this change?
      </div>
      <div style="font-size:13px;color:var(--text2,#7A7268);margin-bottom:20px;line-height:1.4;">
        ${title}
      </div>
      <div style="display:flex;gap:10px;">
        <button id="sc-local"
          style="flex:1;padding:10px 0;border:1px solid var(--bdr,#ddd);border-radius:8px;
                 background:var(--card-bg,#fff);color:var(--text,#1E1C19);
                 font-size:13px;font-weight:600;cursor:pointer;">
          💾 Local only
        </button>
        <button id="sc-notion"
          style="flex:1;padding:10px 0;border:none;border-radius:8px;
                 background:var(--accent,#8B6F47);color:#fff;
                 font-size:13px;font-weight:600;cursor:pointer;">
          📓 Save to Notion
        </button>
      </div>
    </div>`;

  bg.style.display = 'flex';
  document.getElementById('sc-local').onclick  = () => { bg.style.display = 'none'; onLocal(); };
  document.getElementById('sc-notion').onclick = () => { bg.style.display = 'none'; onNotion(); };
}

// Sends a stage-only update to Notion via Claude/Cowork prompt relay
function notionSaveStage(order) {
  if (!order.notionId) {
    toast('No Notion ID on this order — saved locally only', '⚠');
    return;
  }
  safeSendPrompt('update notion stage: ' + JSON.stringify({
    notionId:  order.notionId,
    appId:     order.id,
    stage:     STAGE_TO_NOTION[order.stage] || order.stage,
    notion_db: 'edee1ecc-7d11-428a-9efc-d17b8cbf195d',
  }));
}

// Sends a full order update to Notion via Claude/Cowork prompt relay
function notionSaveOrder(order) {
  if (!order.notionId) {
    toast('No Notion ID on this order — saved locally only', '⚠');
    return;
  }
  safeSendPrompt('update notion order: ' + JSON.stringify({
    notionId:    order.notionId,
    appId:       order.id,
    stage:       STAGE_TO_NOTION[order.stage] || order.stage,
    name:        order.name,
    description: order.desc,
    price:       order.price,
    deadline:    order.deadline,
    email:       order.email,
    phone:       order.phone,
    materials:   order.materials || '',
    notes:       order.notes    || '',
    notion_db:   'edee1ecc-7d11-428a-9efc-d17b8cbf195d',
  }));
}

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
          notion_db: 'edee1ecc-7d11-428a-9efc-d17b8cbf195d',
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

  // Try Notion sync (no-op if not connected)
  syncWithNotion().then(() => {
    if (typeof loadCustomersFromNotion === 'function') loadCustomersFromNotion();
  });
})();

