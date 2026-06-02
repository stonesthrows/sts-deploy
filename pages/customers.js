// ════════════════════════════════════════════
//  CUSTOMERS  —  pages/customers.js
//  Customer table and detail drawer
// ════════════════════════════════════════════

// ════════════════════════════════════════════
let filteredCust = [...CUSTOMERS];

// Rebuild CUSTOMERS from ORDERS so the two are always in sync
function refreshCustomersFromOrders() {
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
  CUSTOMERS.length = 0;
  Object.values(map).forEach(c => CUSTOMERS.push(c));
}

function renderCustomers() {
  // Re-derive filteredCust from CUSTOMERS on every render so new customers always appear
  const q = (document.getElementById('custSearch')?.value || '').trim().toLowerCase();
  filteredCust = q
    ? CUSTOMERS.filter(c => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))
    : [...CUSTOMERS];
  const body = document.getElementById('custTableBody');
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
//  GMAIL PANEL

