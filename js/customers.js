// ════════════════════════════════════════════
//  CUSTOMERS  —  pages/customers.js
//  Customer table and detail drawer
// ════════════════════════════════════════════

// ════════════════════════════════════════════
let filteredCust = [...CUSTOMERS];
let activeCustTab = 'current'; // current | all | repeat | new60 | followup

function switchCustTab(tab, el) {
  activeCustTab = tab;
  document.querySelectorAll('.cst-tab').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderCustomers();
}

function getCustTabList(baseList) {
  const today = new Date();
  const ms60  = 60 * 24 * 60 * 60 * 1000;
  const ms90  = 90 * 24 * 60 * 60 * 1000;

  switch (activeCustTab) {
    case 'current':
      return baseList.filter(c =>
        ORDERS.some(o => o.name === c.name && !['complete','delivered'].includes(o.stage))
      );
    case 'repeat':
      return baseList.filter(c => c.totalOrders >= 2);
    case 'new60':
      return baseList.filter(c => {
        // "new" = their first-ever order is within 60 days
        const orders = ORDERS.filter(o => o.name === c.name);
        if (!orders.length) return false;
        const earliest = orders.reduce((min, o) => {
          const d = new Date(o.takeIn || o.deadline || '');
          return (!isNaN(d) && d < min) ? d : min;
        }, new Date());
        return (today - earliest) <= ms60;
      });
    case 'followup':
      return baseList.filter(c => {
        const hasActive = ORDERS.some(o => o.name === c.name && !['complete','delivered'].includes(o.stage));
        if (hasActive) return false;
        const last = new Date(c.lastContact);
        return !isNaN(last) && (today - last) >= ms90;
      });
    case 'all':
    default:
      return baseList;
  }
}

function updateCustTabCounts() {
  const all = CUSTOMERS;
  const today = new Date();
  const ms60  = 60 * 24 * 60 * 60 * 1000;
  const ms90  = 90 * 24 * 60 * 60 * 1000;

  const counts = {
    current:  all.filter(c => ORDERS.some(o => o.name === c.name && !['complete','delivered'].includes(o.stage))).length,
    all:      all.length,
    repeat:   all.filter(c => c.totalOrders >= 2).length,
    new60:    all.filter(c => {
                const orders = ORDERS.filter(o => o.name === c.name);
                if (!orders.length) return false;
                const earliest = orders.reduce((min, o) => {
                  const d = new Date(o.takeIn || o.deadline || '');
                  return (!isNaN(d) && d < min) ? d : min;
                }, new Date());
                return (today - earliest) <= ms60;
              }).length,
    followup: all.filter(c => {
                const hasActive = ORDERS.some(o => o.name === c.name && !['complete','delivered'].includes(o.stage));
                if (hasActive) return false;
                const last = new Date(c.lastContact);
                return !isNaN(last) && (today - last) >= ms90;
              }).length,
  };
  Object.entries(counts).forEach(([key, val]) => {
    const el = document.getElementById(`cst-cnt-${key}`);
    if (el) el.textContent = val;
  });
}

// Rebuild CUSTOMERS from ORDERS, preserving Notion-sourced fields (notionPageId, notes)
function refreshCustomersFromOrders() {
  // Keep a snapshot of Notion-sourced extra fields keyed by lowercase name
  const extras = {};
  CUSTOMERS.forEach(c => {
    if (c.notionPageId || c.notes) {
      extras[c.name.toLowerCase()] = {
        notionPageId: c.notionPageId,
        notes:        c.notes,
      };
    }
  });

  const map = {};
  ORDERS.forEach(o => {
    if (!o.name) return;
    const key = o.name.toLowerCase();
    if (!map[key]) {
      map[key] = {
        name:         o.name,
        email:        o.email || '',
        phone:        o.phone || '',
        lastContact:  o.deadline || new Date().toISOString().slice(0,10),
        totalOrders:  0,
        totalValue:   0,
        activeOrders: 0,
      };
    }
    map[key].totalOrders++;
    map[key].totalValue   += (o.price || 0);
    if (o.email) map[key].email = o.email;
    if (o.phone) map[key].phone = o.phone;
    if (!['complete','delivered'].includes(o.stage)) map[key].activeOrders++;
    if (o.deadline && o.deadline > map[key].lastContact) map[key].lastContact = o.deadline;
  });

  // Re-attach Notion extras
  Object.keys(map).forEach(key => {
    if (extras[key]) Object.assign(map[key], extras[key]);
  });

  CUSTOMERS.length = 0;
  Object.values(map).forEach(c => CUSTOMERS.push(c));
}

// ── Notion sync ──────────────────────────────

async function loadCustomersFromNotion() {
  try {
    const r = await fetch('/api/notion-customers');
    if (!r.ok) return;
    const notionCustomers = await r.json();
    // Merge notionPageId and notes into matching CUSTOMERS entries; add any Notion-only records
    notionCustomers.forEach(nc => {
      const existing = CUSTOMERS.find(c => c.name.toLowerCase() === nc.name.toLowerCase());
      if (existing) {
        existing.notionPageId = nc.notionPageId;
        if (nc.notes) existing.notes = nc.notes;
        if (nc.phone && !existing.phone) existing.phone = nc.phone;
      } else {
        // Customer exists in Notion but has no orders yet — show them anyway
        CUSTOMERS.push({
          name:         nc.name,
          email:        nc.email || '',
          phone:        nc.phone || '',
          notes:        nc.notes || '',
          lastContact:  nc.lastContact || '',
          totalOrders:  nc.totalOrders || 0,
          totalValue:   nc.totalValue  || 0,
          activeOrders: 0,
          notionPageId: nc.notionPageId,
        });
      }
    });
    renderCustomers();
  } catch (e) {
    console.log('Notion customers load skipped:', e.message);
  }
}

async function syncCustomersFromNotion() {
  const btn = document.getElementById('syncCustomersBtn');
  if (btn) { btn.textContent = '⏳ Syncing…'; btn.disabled = true; }
  try {
    await loadCustomersFromNotion();
    if (btn) { btn.textContent = '✓ Synced'; }
  } catch (e) {
    if (btn) { btn.textContent = '✗ Failed'; }
  } finally {
    setTimeout(() => { if (btn) { btn.textContent = '↻ Sync Customers'; btn.disabled = false; } }, 2000);
  }
}

async function upsertCustomerToNotion(customer) {
  try {
    const payload = {
      name:         customer.name,
      email:        customer.email || '',
      phone:        customer.phone || '',
      notes:        customer.notes || '',
      lastContact:  customer.lastContact || new Date().toISOString().slice(0,10),
      totalOrders:  customer.totalOrders || 0,
      totalValue:   customer.totalValue  || 0,
      notionPageId: customer.notionPageId || null,
    };
    const r = await fetch('/api/notion-customers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!r.ok) return;
    const { notionPageId } = await r.json();
    if (notionPageId) customer.notionPageId = notionPageId;
  } catch (e) {
    console.log('Notion customer upsert skipped:', e.message);
  }
}

function renderCustomers() {
  // Update badge counts on all sub-tabs
  updateCustTabCounts();

  // Build base list (search filter applied first)
  const q = (document.getElementById('custSearch')?.value || '').trim().toLowerCase();
  const base = q
    ? CUSTOMERS.filter(c => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))
    : [...CUSTOMERS];

  // Apply active sub-tab filter
  filteredCust = getCustTabList(base);

  const body = document.getElementById('custTableBody');

  if (!filteredCust.length) {
    const emptyMsgs = {
      current:  { icon: '📋', text: 'No customers with active orders right now.' },
      repeat:   { icon: '⭐', text: 'No repeat customers yet — keep building those relationships!' },
      new60:    { icon: '🌱', text: 'No new customers in the last 60 days.' },
      followup: { icon: '💌', text: 'No customers need follow-up right now.' },
      all:      { icon: '👥', text: 'No customers found.' },
    };
    const { icon, text } = emptyMsgs[activeCustTab] || emptyMsgs.all;
    body.innerHTML = `<div class="cust-empty"><div class="cust-empty-icon">${icon}</div>${text}</div>`;
    return;
  }

  body.innerHTML = filteredCust.map((c, i) => {
    const active = ORDERS.filter(o => o.name === c.name && !['complete','delivered'].includes(o.stage)).length;
    return `
      <div class="ct-row" onclick="openCustomerDrawer(${CUSTOMERS.indexOf(c)})">
        <div class="c-avatar-wrap">
          <div class="c-avatar">${initials(c.name)}</div>
          <div>
            <div class="c-name">${c.name}</div>
            <div class="c-email">${c.email}</div>
          </div>
        </div>
        <div class="c-td">
          ${active > 0 ? `<span class="active-chip">${active} active</span>` : '<span class="c-muted">—</span>'}
        </div>
        <div class="c-td c-muted">${fmtDate(c.lastContact)}</div>
        <div class="c-td">${c.totalOrders}</div>
        <div class="c-td c-muted">$${c.totalValue.toLocaleString()}</div>
      </div>`;
  }).join('');
}

function filterCustomers(q) {
  renderCustomers(); // renderCustomers now reads the search input value itself
}

// ════════════════════════════════════════════

//  CUSTOMER DRAWER
// ════════════════════════════════════════════
function openCustomerDrawer(idx) {
  const c = CUSTOMERS[idx];
  if (!c) return;

  // Clear the search box and dropdown
  const searchEl = document.getElementById('drawerCustSearch');
  if (searchEl) searchEl.value = '';
  closeDrawerDropdown();

  // Header
  document.getElementById('dAvatar').textContent = initials(c.name);
  document.getElementById('dName').textContent   = c.name;
  document.getElementById('dEmail').textContent  = c.email || '—';

  // Stats strip
  const orders      = ORDERS.filter(o => o.name === c.name);
  const activeCount = orders.filter(o => !['complete','delivered'].includes(o.stage)).length;
  const lifetime    = orders.reduce((sum, o) => sum + (o.price || 0), 0);
  document.getElementById('dStatsRow').innerHTML = `
    <div class="d-stat">
      <div class="d-stat-val">${orders.length}</div>
      <div class="d-stat-lbl">Orders</div>
    </div>
    <div class="d-stat">
      <div class="d-stat-val">$${lifetime.toLocaleString()}</div>
      <div class="d-stat-lbl">Lifetime</div>
    </div>
    <div class="d-stat">
      <div class="d-stat-val">${activeCount}</div>
      <div class="d-stat-lbl">Active</div>
    </div>`;

  const stageLabel = id => { const s = STAGES.find(x => x.id === id); return s ? s.label : id; };
  // Escape single quotes so they're safe inside onclick attributes
  const safeName  = c.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const safeEmail = (c.email||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");

  // Body
  document.getElementById('dBody').innerHTML = `
    <!-- CTA: add back to Kanban -->
    <div class="d-cta-row">
      <button class="btn btn-gold"    onclick="prefillFromCustomer('${safeName}','${safeEmail}','order');  closeDrawer();">＋ New Order</button>
      <button class="btn btn-outline" onclick="prefillFromCustomer('${safeName}','${safeEmail}','repair'); closeDrawer();">🔧 New Repair</button>
    </div>

    <!-- Order history -->
    <div class="d-section" style="margin-top:4px;">
      <div class="d-section-title">Order History (${orders.length})</div>
      ${orders.length ? orders.map(o => {
        const dl       = deadlineInfo(o.deadline);
        const isActive = !['complete','delivered'].includes(o.stage);
        const stageBg  = isActive ? '#EAF0FB' : '#F2EDE6';
        const stageClr = isActive ? '#2A5A9A' : '#7A7268';
        return `
          <div class="d-order">
            <div class="d-order-name">${o.desc}</div>
            <div class="d-order-meta" style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              <span style="background:${stageBg};color:${stageClr};padding:2px 7px;border-radius:5px;font-size:10px;font-weight:700;">${stageLabel(o.stage)}</span>
              ${o.price ? `<span style="font-size:11.5px;">${fmtPrice(o.price)}</span>` : ''}
              <span class="o-tag ${dl.cls}" style="font-size:10px;">${dl.text}</span>
              ${o.pickup ? `<span style="font-size:10px;color:#6A6460;">📍 ${o.pickup}</span>` : ''}
            </div>
          </div>`;
      }).join('') : '<div style="color:var(--text3);font-size:13px;padding:4px 0;">No orders on record.</div>'}
    </div>

    <!-- Quick actions -->
    <div class="d-section">
      <div class="d-section-title">Quick Actions</div>
      <button class="btn btn-outline d-action-btn" onclick="safeSendPrompt('draft follow-up email for customer: ${safeName} (${safeEmail})')">✉ Draft Follow-up Email</button>
      <button class="btn btn-outline d-action-btn" onclick="safeSendPrompt('show full Notion record for customer: ${safeName}')">📓 Open in Notion</button>
      <button class="btn btn-outline d-action-btn" onclick="safeSendPrompt('show Asana tasks for customer: ${safeName}')">📋 View in Asana</button>
    </div>`;

  document.getElementById('overlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}

function closeDrawer() {
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
  closeDrawerDropdown();
}

// In-drawer customer search
function drawerSearchCustomer(q) {
  const dropdown = document.getElementById('drawerDropdown');
  if (!q.trim()) { closeDrawerDropdown(); return; }
  const matches = CUSTOMERS.filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(q.toLowerCase())
  ).slice(0, 7);

  if (!matches.length) {
    dropdown.innerHTML = '<div style="padding:12px 16px;color:var(--text3);font-size:13px;">No customers found</div>';
    dropdown.classList.add('open');
    return;
  }
  dropdown.innerHTML = matches.map(c => {
    const idx = CUSTOMERS.indexOf(c);
    return `
      <div class="d-dropdown-item" onclick="openCustomerDrawer(${idx});">
        <div class="d-dd-avatar">${initials(c.name)}</div>
        <div>
          <div class="d-dd-name">${c.name}</div>
          <div class="d-dd-email">${c.email || '—'}</div>
        </div>
      </div>`;
  }).join('');
  dropdown.classList.add('open');
}

function closeDrawerDropdown() {
  const d = document.getElementById('drawerDropdown');
  if (d) { d.innerHTML = ''; d.classList.remove('open'); }
}

// Pre-fill New Order form with a past customer's info
function prefillFromCustomer(name, email, type) {
  switchTab('new-order', document.querySelector('.sub-nav-tab[data-tab=new-order]'));
  document.getElementById('f-name').value  = name;
  document.getElementById('f-email').value = email;
  setOrderType(type);
  // Scroll form to top
  document.getElementById('tab-new-order').scrollTop = 0;
  toast(`Form pre-filled for ${name} — fill in the details and submit`, '✓');
}

// ════════════════════════════════════════════
