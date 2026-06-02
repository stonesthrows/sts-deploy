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
  if (id === 'sales') setTimeout(renderSales, 0);
  if (id === 'production') setTimeout(renderProduction, 0);
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
  // Show the currently active sub-tab panel (default to first)
  const activeSub = subNav && subNav.querySelector('.sub-nav-tab.active');
  const defaultId = activeSub ? activeSub.getAttribute('data-tab') : 'dashboard';
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + defaultId);
  if (panel) panel.classList.add('active');
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
    if (o.stage === 'wait-cust') { o.stage = 'quote';         migrated = true; }
  });
  if (migrated) try { localStorage.setItem('sts-orders', JSON.stringify(ORDERS)); } catch(e) {}
}


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
      const completedNames = new Set(completedRegistry.map(r => r.name));
      completedRegistry.forEach(r => {
        completedMap[r.id] = 'complete';
        if (r.notionId) completedMap['n:' + r.notionId] = 'complete';
      });

      ORDERS.length = 0;
      notionOrders.forEach(o => {
        // Skip if this order name matches a completed registry entry and it's not already ours
        const incomingName = (o.name || '').toLowerCase().trim();
        const alreadyCompleted = completedMap[o.id] || completedMap['n:' + o.notionId] || completedNames.has(incomingName);
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
  syncWithNotion();

  // Check for orders scanned via scan.html
  checkPendingScans();

  // Auto-import orders scanned from Google Drive (daily 6pm task)
  loadScannedOrders();
})();

// ════════════════════════════════════════════
//  GOOGLE DRIVE SCAN AUTO-IMPORT
// ════════════════════════════════════════════
function loadScannedOrders() {
  const seenKey = 'sts-drive-imported';
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch {}

  fetch('./scanned-orders.json?t=' + Date.now())
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(orders) {
      if (!orders || !orders.length) return;
      let completedReg = [];
      try { completedReg = JSON.parse(localStorage.getItem('sts-completed-registry') || '[]'); } catch {}
      const completedNameSet = new Set(completedReg.map(function(r) { return r.name; }));
      const newOrders = orders.filter(function(o) {
        if (seen.includes(o.drive_file_id)) return false;
        if (completedNameSet.has((o.customer_name || '').toLowerCase().trim())) return false;
        return true;
      });
      if (!newOrders.length) return;

      const stageMap = { order: 'intake-custom', estimate: 'needs-est', repair: 'intake-repair' };
      newOrders.forEach(function(d) {
        const newId = 'drive-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
        const orderType = d.order_type || 'order';
        ORDERS.push({
          id:            newId,
          name:          d.customer_name    || 'Unknown Customer',
          desc:          d.description      || '',
          stage:         stageMap[orderType] || 'intake-custom',
          deadline:      d.deadline         || null,
          price:         d.price            || 0,
          asana:         'pending',
          email:         d.email            || '',
          phone:         d.phone            || '',
          takeIn:        d.take_in_date     || null,
          pickup:        d.pickup_location  || null,
          contactSource: d.contacted_via    || null,
          orderType:     orderType,
          notes:         d.notes            || '',
          materials:     d.materials        || '',
        });
        // Track customer
        const name     = d.customer_name || 'Unknown Customer';
        const existing = CUSTOMERS.find(function(c) { return c.name.toLowerCase() === name.toLowerCase(); });
        if (existing) {
          existing.totalOrders += 1;
          existing.lastContact  = new Date().toISOString().slice(0,10);
          existing.activeOrders = (existing.activeOrders || 0) + 1;
        } else {
          CUSTOMERS.unshift({ name: name, email: d.email || '', lastContact: new Date().toISOString().slice(0,10), totalOrders: 1, totalValue: 0, activeOrders: 1 });
        }
        seen.push(d.drive_file_id);
      });

      localStorage.setItem(seenKey, JSON.stringify(seen));
      saveToStorage();
      renderKanban();
      if (typeof renderCustomers === 'function') renderCustomers();

      const label = newOrders.length === 1
        ? '📷 ' + (newOrders[0].customer_name || 'Order') + ' imported from Drive scan!'
        : '📷 ' + newOrders.length + ' orders imported from Drive scan!';
      toast(label, '✓');
    })
    .catch(function() {});
}

// ════════════════════════════════════════════
//  MANUAL DRIVE CHECK (☁ Check Drive button)
// ════════════════════════════════════════════
function checkDriveScans(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '☁ Checking…'; }

  const seenKey = 'sts-drive-imported';
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch {}

  fetch('./scanned-orders.json?t=' + Date.now())
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(orders) {
      if (btn) { btn.disabled = false; btn.textContent = '☁ Check Drive'; }
      if (!orders || !orders.length) { toast('No scanned orders found in Drive.', 'ℹ'); return; }

      let completedReg2 = [];
      try { completedReg2 = JSON.parse(localStorage.getItem('sts-completed-registry') || '[]'); } catch {}
      const completedNameSet2 = new Set(completedReg2.map(function(r) { return r.name; }));
      const newOrders = orders.filter(function(o) {
        if (seen.includes(o.drive_file_id)) return false;
        if (completedNameSet2.has((o.customer_name || '').toLowerCase().trim())) return false;
        return true;
      });
      if (!newOrders.length) { toast('Already up to date — no new Drive scans.', 'ℹ'); return; }

      const stageMap = { order: 'intake-custom', estimate: 'needs-est', repair: 'intake-repair' };
      newOrders.forEach(function(d) {
        const newId = 'drive-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
        const orderType = d.order_type || 'order';
        ORDERS.push({
          id: newId, name: d.customer_name || 'Unknown Customer',
          desc: d.description || '', stage: stageMap[orderType] || 'intake-custom',
          deadline: d.deadline || null, price: d.price || 0, asana: 'pending',
          email: d.email || '', phone: d.phone || '',
          takeIn: d.take_in_date || null, pickup: d.pickup_location || null,
          contactSource: d.contacted_via || null, orderType: orderType,
          notes: d.notes || '', materials: d.materials || '',
        });
        const name = d.customer_name || 'Unknown Customer';
        const existing = CUSTOMERS.find(function(c) { return c.name.toLowerCase() === name.toLowerCase(); });
        if (existing) {
          existing.totalOrders += 1;
          existing.lastContact = new Date().toISOString().slice(0,10);
          existing.activeOrders = (existing.activeOrders || 0) + 1;
        } else {
          CUSTOMERS.unshift({ name: name, email: d.email || '', lastContact: new Date().toISOString().slice(0,10), totalOrders: 1, totalValue: 0, activeOrders: 1 });
        }
        seen.push(d.drive_file_id);
      });

      localStorage.setItem(seenKey, JSON.stringify(seen));
      saveToStorage();
      renderKanban();
      if (typeof renderCustomers === 'function') renderCustomers();

      const label = newOrders.length === 1
        ? '✓ ' + (newOrders[0].customer_name || 'Order') + ' imported from Drive!'
        : '✓ ' + newOrders.length + ' orders imported from Drive!';
      toast(label, '✓');
    })
    .catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = '☁ Check Drive'; }
      toast('Could not reach Drive scan file.', '⚠');
    });
}

// ════════════════════════════════════════════
//  PENDING SCAN IMPORT
// ════════════════════════════════════════════
function checkPendingScans() {
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem('sts-pending-scans') || '[]'); } catch {}
  if (!queue.length) return;
  showScanImportBanner(queue);
}

function showScanImportBanner(queue) {
  const banner = document.getElementById('scanImportBanner');
  if (!banner) return;
  const count = queue.length;
  banner.querySelector('#scanImportCount').textContent = count;
  banner.querySelector('#scanImportLabel').textContent = count === 1 ? 'scanned order waiting' : 'scanned orders waiting';
  banner.classList.add('open');
}

function importPendingScans() {
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem('sts-pending-scans') || '[]'); } catch {}
  if (!queue.length) return;

  const stageMap = { order: 'intake-custom', estimate: 'needs-est', repair: 'intake-repair' };
  const labelMap = { order: 'Custom Intake', estimate: 'Needs Estimate', repair: 'Repair Intake' };

  queue.forEach(d => {
    const newId = 'scan-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    const orderType = d.order_type || 'order';
    ORDERS.push({
      id:            newId,
      name:          d.customer_name || 'Unknown Customer',
      desc:          d.description   || '',
      stage:         stageMap[orderType] || 'intake-custom',
      deadline:      d.deadline      || null,
      price:         d.price         || 0,
      asana:         'pending',
      email:         d.email         || '',
      phone:         d.phone         || '',
      takeIn:        d.take_in_date  || null,
      pickup:        d.pickup_location || null,
      contactSource: d.contacted_via  || null,
      orderType:     orderType,
      notes:         d.notes         || '',
      materials:     d.materials     || '',
    });

    // Add/update customer
    const name  = d.customer_name || 'Unknown Customer';
    const email = d.email || '';
    const existing = CUSTOMERS.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.totalOrders += 1;
      existing.lastContact  = new Date().toISOString().slice(0,10);
      existing.activeOrders = (existing.activeOrders || 0) + 1;
    } else {
      CUSTOMERS.unshift({ name, email, lastContact: new Date().toISOString().slice(0,10), totalOrders: 1, totalValue: 0, activeOrders: 1 });
    }
  });

  localStorage.removeItem('sts-pending-scans');
  saveToStorage();
  renderKanban();
  if (typeof renderCustomers === 'function') renderCustomers();
  dismissScanBanner();
  toast(queue.length === 1
    ? `${queue[0].customer_name || 'Order'} imported to ${labelMap[queue[0].order_type || 'order']}!`
    : `${queue.length} orders imported to the board!`, '✓');
}

function dismissScanBanner() {
  const banner = document.getElementById('scanImportBanner');
  if (banner) banner.classList.remove('open');
}
