// ════════════════════════════════════════════
//  CUSTOMERS  —  pages/customers.js
//  Customer table and detail drawer
// ════════════════════════════════════════════

// ════════════════════════════════════════════
const CUSTOMERS_CACHE_KEY = 'sts-customers-cache';

function saveCustomersToCache() {
  try { localStorage.setItem(CUSTOMERS_CACHE_KEY, JSON.stringify(CUSTOMERS)); } catch(e) {}
}

function loadCustomersFromCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CUSTOMERS_CACHE_KEY) || '[]');
    if (cached.length) {
      CUSTOMERS.length = 0;
      cached.forEach(c => CUSTOMERS.push(c));
      renderCustomers();
    }
  } catch(e) {}
}

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
// and the locally-edited Style Profile (never stored on the Notion side — see
// saveCustomerEdit).
function refreshCustomersFromOrders() {
  // Keep a snapshot of Notion-sourced extra fields keyed by lowercase name
  const extras = {};
  CUSTOMERS.forEach(c => {
    if (c.notionPageId || c.notes || c.address || c.styleProfile) {
      extras[c.name.toLowerCase()] = {
        notionPageId: c.notionPageId,
        notes:        c.notes,
        address:      c.address,
        styleProfile: c.styleProfile,
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
        styleProfile: null,
        _styleDate:   '',
      };
    }
    map[key].totalOrders++;
    map[key].totalValue   += (o.price || 0);
    if (o.email) map[key].email = o.email;
    if (o.phone) map[key].phone = o.phone;
    if (!['complete','delivered'].includes(o.stage)) map[key].activeOrders++;
    if (o.deadline && o.deadline > map[key].lastContact) map[key].lastContact = o.deadline;
    // Fall back to the most recent order's Style Profile when the customer
    // has no local edit of their own (re-attached below).
    if (o.styleProfile && Object.keys(o.styleProfile).length) {
      const orderDate = o.takeIn || o.deadline || '';
      if (orderDate >= map[key]._styleDate) {
        map[key].styleProfile = o.styleProfile;
        map[key]._styleDate   = orderDate;
      }
    }
  });

  // Re-attach Notion extras (and any local-only Style Profile edit)
  Object.keys(map).forEach(key => {
    delete map[key]._styleDate;
    if (extras[key]) Object.assign(map[key], extras[key]);
  });

  CUSTOMERS.length = 0;
  Object.values(map).forEach(c => CUSTOMERS.push(c));
}

// ── Notion sync ──────────────────────────────

function loadCustomersFromNotion() {
  // Customers are derived from the Custom Orders pipeline — no separate Customers DB
  refreshCustomersFromOrders();
  renderCustomers();
  saveCustomersToCache();
}

async function syncCustomersFromNotion() {
  const btn = document.getElementById('syncCustomersBtn');
  if (btn) { btn.textContent = '⏳ Syncing…'; btn.disabled = true; }
  try {
    // Pull latest orders from the pipeline, then rebuild customers from them
    if (typeof notionSyncFromNotion === 'function') await notionSyncFromNotion();
    refreshCustomersFromOrders();
    renderCustomers();
    saveCustomersToCache();
    if (btn) { btn.textContent = '✓ Synced'; }
  } catch (e) {
    refreshCustomersFromOrders();
    renderCustomers();
    saveCustomersToCache();
    if (btn) { btn.textContent = '✓ Synced locally'; }
  } finally {
    setTimeout(() => { if (btn) { btn.textContent = '↻ Sync Customers'; btn.disabled = false; } }, 2000);
  }
}

// Patch all matching order records in the Custom Orders pipeline with updated contact info
async function patchCustomerOrdersInNotion(name, fields) {
  const orders = (typeof ORDERS !== 'undefined' ? ORDERS : [])
    .filter(o => o.name && o.name.toLowerCase() === name.toLowerCase() && o.notionId);
  for (const o of orders) {
    try {
      await fetch('/api/notion-pipeline', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(Object.assign({ notionId: o.notionId }, fields)),
      });
    } catch(e) { console.warn('Pipeline patch error:', e); }
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
    const idx    = CUSTOMERS.indexOf(c);
    const active = ORDERS.filter(o => o.name === c.name && !['complete','delivered'].includes(o.stage)).length;
    return `
      <div class="ct-row-wrap" id="ct-wrap-${idx}">
        <div class="ct-row" onclick="toggleCustomerRow(${idx})">
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
          <div class="c-td ct-chevron">›</div>
        </div>
        <div class="ct-expand" id="ct-expand-${idx}"></div>
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

// ── Style profile options (mirrors the New Order form's Style Profile block) ──
const CT_STYLE_AESTHETIC = ['Minimal', 'Vintage', 'Organic', 'Geometric', 'Statement', 'Delicate'];
const CT_STYLE_TONES     = ['Yellow', 'White', 'Rose', 'Mixed', 'Silver-only'];
const CT_STYLE_WEARS     = ['Everyday', 'Occasion'];
const CT_STYLE_BUDGETS   = ['<$250', '$250–750', '$750–1.5k', '$1.5k+'];

function styleProfileText(sp) {
  if (!sp) return null;
  const parts = [];
  if (Array.isArray(sp.aesthetic) && sp.aesthetic.length) parts.push(sp.aesthetic.join(', '));
  if (sp.tone)   parts.push(sp.tone);
  if (sp.wear)   parts.push(sp.wear);
  if (sp.budget) parts.push(sp.budget);
  return parts.length ? parts.join(' · ') : null;
}

function buildCustomerExpandHtml(idx) {
  const c = CUSTOMERS[idx];
  if (!c) return '';
  const esc       = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const q         = s => String(s||'').replace(/"/g,'&quot;');
  const safeName  = c.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const safeEmail = (c.email||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");

  // ── Info rows ────────────────────────────────
  const infoRow = (label, val, href) => {
    if (!val) return `<div class="ct-info-row"><span class="ct-info-label">${label}</span><span class="ct-info-val ct-info-empty">—</span></div>`;
    const valHtml = href
      ? `<a class="ct-info-val ct-info-link" href="${esc(href)}">${esc(val)}</a>`
      : `<span class="ct-info-val">${esc(val)}</span>`;
    return `<div class="ct-info-row"><span class="ct-info-label">${label}</span>${valHtml}</div>`;
  };

  // ── Orders ───────────────────────────────────
  const orders       = ORDERS.filter(o => o.name === c.name);
  const activeOrders = orders.filter(o => !['complete','delivered'].includes(o.stage));
  const prevOrders   = orders.filter(o =>  ['complete','delivered'].includes(o.stage));
  const stageLabel   = id => { const s = (typeof STAGES !== 'undefined' ? STAGES : []).find(x => x.id === id); return s ? s.label : id; };

  const renderOrderRow = (o, isCurrent) => {
    const isActive = !['complete','delivered'].includes(o.stage);
    const stageBg  = isActive ? '#EAF0FB' : '#F2EDE6';
    const stageClr = isActive ? '#2A5A9A' : '#7A7268';
    const dl       = typeof deadlineInfo === 'function' ? deadlineInfo(o.deadline) : { text: o.deadline||'', cls: '' };
    if (isCurrent) {
      return `<div class="ct-prev-order ct-current-order" onclick="prefillFromOrder('${o.id}');event.stopPropagation()" title="Click to open in New Order form">
        <div class="ct-prev-order-top">
          <div class="ct-prev-desc">${esc(o.desc||'(no description)')}</div>
          <span class="ct-open-order-hint">Open in New Order →</span>
        </div>
        <div class="ct-prev-meta">
          <span class="ct-prev-stage" style="background:${stageBg};color:${stageClr}">${stageLabel(o.stage)}</span>
          ${o.price ? `<span class="ct-prev-price">${typeof fmtPrice==='function'?fmtPrice(o.price):'$'+o.price}</span>` : ''}
          ${o.deadline ? `<span class="ct-prev-dl ${dl.cls}">${dl.text}</span>` : ''}
          ${o.takeIn ? `<span class="ct-prev-takein">Taken in ${typeof fmtDate==='function'?fmtDate(o.takeIn):o.takeIn}</span>` : ''}
        </div>
      </div>`;
    }
    return `<div class="ct-prev-order">
      <div class="ct-prev-order-top">
        <div class="ct-prev-desc">${esc(o.desc||'(no description)')}</div>
        <button class="ct-prev-edit-btn" onclick="openOrderCard('${o.id}');event.stopPropagation()">✏ Edit</button>
      </div>
      <div class="ct-prev-meta">
        <span class="ct-prev-stage" style="background:${stageBg};color:${stageClr}">${stageLabel(o.stage)}</span>
        ${o.price ? `<span class="ct-prev-price">${typeof fmtPrice==='function'?fmtPrice(o.price):'$'+o.price}</span>` : ''}
        ${o.deadline ? `<span class="ct-prev-dl ${dl.cls}">${dl.text}</span>` : ''}
        ${o.takeIn ? `<span class="ct-prev-takein">Taken in ${typeof fmtDate==='function'?fmtDate(o.takeIn):o.takeIn}</span>` : ''}
      </div>
    </div>`;
  };

  return `
    <div class="ct-exp-body">

      <!-- Contact info display -->
      <div class="ct-info-block" id="ct-info-display-${idx}">
        <div class="ct-info-header">
          <span class="ct-info-title">Contact Info</span>
          <button class="ct-edit-toggle-btn" onclick="showCustomerEditForm(${idx});event.stopPropagation()">✏ Edit</button>
        </div>
        ${infoRow('Name',    c.name)}
        ${infoRow('Phone',   c.phone,   c.phone   ? 'tel:'    + c.phone   : null)}
        ${infoRow('Email',   c.email,   c.email   ? 'mailto:' + c.email   : null)}
        ${infoRow('Address', c.address)}
        ${infoRow('Notes',   c.notes)}
        ${infoRow('Style Profile', styleProfileText(c.styleProfile))}
        ${infoRow('Last Contact', c.lastContact ? (typeof fmtDate==='function'?fmtDate(c.lastContact):c.lastContact) : null)}
        ${infoRow('Lifetime Value', c.totalValue ? '$' + c.totalValue.toLocaleString() : null)}
      </div>

      <!-- Edit form (hidden by default) -->
      <div class="ct-exp-edit-form" id="ct-edit-form-${idx}" style="display:none;">
        <div class="ct-info-header">
          <span class="ct-info-title">Edit Customer</span>
        </div>
        <div class="ct-edit-grid">
          <label class="ct-edit-label">Name
            <input class="ct-edit-input" id="ct-edit-name-${idx}"    type="text"  value="${q(c.name)}"    onclick="event.stopPropagation()">
          </label>
          <label class="ct-edit-label">Phone
            <input class="ct-edit-input" id="ct-edit-phone-${idx}"   type="tel"   value="${q(c.phone)}"   placeholder="555-000-0000" onclick="event.stopPropagation()">
          </label>
          <label class="ct-edit-label">Email
            <input class="ct-edit-input" id="ct-edit-email-${idx}"   type="email" value="${q(c.email)}"   placeholder="email@example.com" onclick="event.stopPropagation()">
          </label>
          <label class="ct-edit-label">Address
            <input class="ct-edit-input" id="ct-edit-address-${idx}" type="text"  value="${q(c.address)}" placeholder="Street, City, State ZIP" onclick="event.stopPropagation()">
          </label>
          <label class="ct-edit-label ct-edit-full">Notes
            <input class="ct-edit-input" id="ct-edit-notes-${idx}"   type="text"  value="${q(c.notes)}"   placeholder="Optional notes…" onclick="event.stopPropagation()">
          </label>
          <div class="ct-edit-label ct-edit-full">
            <span>Style Profile</span>
            <div class="finish-checks" id="ct-edit-style-aesthetic-${idx}" onclick="event.stopPropagation()">
              ${CT_STYLE_AESTHETIC.map(v => `<label><input type="checkbox" value="${v}"${(c.styleProfile?.aesthetic||[]).includes(v)?' checked':''}> ${v}</label>`).join('')}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
              <select class="ct-edit-input" id="ct-edit-style-tone-${idx}" style="width:auto;" onclick="event.stopPropagation()">
                <option value="">Tone —</option>
                ${CT_STYLE_TONES.map(v => `<option value="${v}"${c.styleProfile?.tone===v?' selected':''}>${v}</option>`).join('')}
              </select>
              <select class="ct-edit-input" id="ct-edit-style-wear-${idx}" style="width:auto;" onclick="event.stopPropagation()">
                <option value="">Wear —</option>
                ${CT_STYLE_WEARS.map(v => `<option value="${v}"${c.styleProfile?.wear===v?' selected':''}>${v}</option>`).join('')}
              </select>
              <select class="ct-edit-input" id="ct-edit-style-budget-${idx}" style="width:auto;" onclick="event.stopPropagation()">
                <option value="">Budget —</option>
                ${CT_STYLE_BUDGETS.map(v => `<option value="${esc(v)}"${c.styleProfile?.budget===v?' selected':''}>${esc(v)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        <div class="ct-edit-foot">
          <button class="btn btn-gold btn-sm"  onclick="saveCustomerEdit(${idx});event.stopPropagation()">✓ Save</button>
          <button class="btn btn-ghost btn-sm" onclick="cancelCustomerEdit(${idx});event.stopPropagation()">Cancel</button>
          <span class="ct-edit-status" id="ct-edit-status-${idx}"></span>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="ct-exp-actions">
        <button class="btn btn-gold btn-sm"    onclick="prefillFromCustomer('${safeName}','${safeEmail}','order');event.stopPropagation()">＋ New Order</button>
        <button class="btn btn-outline btn-sm" onclick="prefillFromCustomer('${safeName}','${safeEmail}','repair');event.stopPropagation()">🔧 New Repair</button>
      </div>

      <!-- Current orders -->
      ${activeOrders.length ? `
      <div class="ct-exp-section">
        <div class="ct-exp-section-title">Current Orders (${activeOrders.length})</div>
        ${activeOrders.map(o => renderOrderRow(o, true)).join('')}
      </div>` : ''}

      <!-- Previous orders -->
      <div class="ct-exp-section">
        <div class="ct-exp-section-title">Previous Orders (${prevOrders.length})</div>
        ${prevOrders.length ? prevOrders.map(o => renderOrderRow(o, false)).join('') : '<div class="ct-exp-gmail-msg">No previous orders on record.</div>'}
      </div>

      <!-- Gmail -->
      <div class="ct-exp-section">
        <div class="ct-exp-section-title">Gmail Correspondence</div>
        <div id="ct-gmail-${idx}"><div class="ct-exp-gmail-msg">⏳ Loading…</div></div>
      </div>

    </div>`;
}

function showCustomerEditForm(idx) {
  document.getElementById('ct-edit-form-' + idx).style.display = '';
}

function cancelCustomerEdit(idx) {
  document.getElementById('ct-edit-form-' + idx).style.display = 'none';
  document.getElementById('ct-edit-status-' + idx).textContent = '';
}

async function saveCustomerEdit(idx) {
  const c      = CUSTOMERS[idx];
  const status = document.getElementById('ct-edit-status-' + idx);
  if (!c || !status) return;

  const name    = document.getElementById('ct-edit-name-'    + idx).value.trim();
  const email   = document.getElementById('ct-edit-email-'   + idx).value.trim();
  const phone   = document.getElementById('ct-edit-phone-'   + idx).value.trim();
  const address = document.getElementById('ct-edit-address-' + idx).value.trim();
  const notes   = document.getElementById('ct-edit-notes-'   + idx).value.trim();

  const styleAesthetic = [...document.querySelectorAll('#ct-edit-style-aesthetic-' + idx + ' input:checked')].map(el => el.value);
  const styleTone      = document.getElementById('ct-edit-style-tone-'   + idx).value;
  const styleWear      = document.getElementById('ct-edit-style-wear-'   + idx).value;
  const styleBudget    = document.getElementById('ct-edit-style-budget-' + idx).value;
  const hasStyle     = styleAesthetic.length || styleTone || styleWear || styleBudget;
  const styleProfile = hasStyle ? { aesthetic: styleAesthetic, tone: styleTone, wear: styleWear, budget: styleBudget } : null;

  if (!name) { status.textContent = 'Name is required.'; return; }

  status.textContent = 'Saving…';

  c.name         = name;
  c.email        = email;
  c.phone        = phone;
  c.address      = address;
  c.notes        = notes;
  c.styleProfile = styleProfile;

  // Update all matching orders with new email/phone
  ORDERS.forEach(o => {
    if (o.name.toLowerCase() === name.toLowerCase()) {
      if (email) o.email = email;
      if (phone) o.phone = phone;
    }
  });

  // Style Profile has no standalone Notion property — it lives inside each
  // order's "App Data" JSON blob alongside sensitivities/ringSizes/gift/etc.
  // Patching it per-order here would overwrite that whole blob and silently
  // drop those sibling fields, so it stays a local-only customer field
  // (preserved across resyncs by refreshCustomersFromOrders' extras logic).
  try {
    await patchCustomerOrdersInNotion(name, { email, phone, notes });
    status.textContent = '✓ Saved';
  } catch(e) {
    status.textContent = '✓ Saved locally';
  }

  saveCustomersToCache();
  renderCustomers();

  // Re-open the row (renderCustomers rebuilds the DOM)
  setTimeout(() => {
    const wrap   = document.getElementById('ct-wrap-' + idx);
    const expand = document.getElementById('ct-expand-' + idx);
    if (!wrap || !expand) return;
    wrap.classList.add('ct-open');
    expand.dataset.loaded = '1';
    expand.innerHTML = buildCustomerExpandHtml(idx);
    loadCustomerGmail(c.email, idx);
  }, 50);
}

function refreshOpenCustomerExpands() {
  document.querySelectorAll('.ct-row-wrap.ct-open').forEach(wrap => {
    const idx    = wrap.id.replace('ct-wrap-', '');
    const expand = document.getElementById('ct-expand-' + idx);
    if (!expand) return;
    const c = CUSTOMERS[parseInt(idx)];
    expand.dataset.loaded = '1';
    expand.innerHTML = buildCustomerExpandHtml(parseInt(idx));
    if (c) loadCustomerGmail(c.email, parseInt(idx));
  });
}

function toggleCustomerRow(idx) {
  const wrap   = document.getElementById('ct-wrap-' + idx);
  const expand = document.getElementById('ct-expand-' + idx);
  if (!wrap || !expand) return;

  const isOpen = wrap.classList.toggle('ct-open');
  if (!isOpen) return;

  if (expand.dataset.loaded) return;
  expand.dataset.loaded = '1';

  const c = CUSTOMERS[idx];
  if (!c) return;

  const safeName  = c.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const safeEmail = (c.email||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");

  expand.innerHTML = buildCustomerExpandHtml(idx);
  loadCustomerGmail(c.email, idx);
}

function loadCustomerGmail(email, idx) {
  const container = document.getElementById('ct-gmail-' + idx);
  if (!container) return;

  if (!email) {
    container.innerHTML = '<div class="ct-exp-gmail-msg">No email address on file.</div>';
    return;
  }

  if (typeof _gmailTokenValid !== 'function' || !_gmailTokenValid()) {
    container.innerHTML = '<div class="ct-exp-gmail-msg"><button class="btn btn-outline btn-sm" onclick="gmailSignIn(true)">🔑 Connect Gmail to see correspondence</button></div>';
    return;
  }

  const hdrs  = { 'Authorization': 'Bearer ' + _gmailAccessToken };
  const query = encodeURIComponent('from:' + email + ' OR to:' + email);

  fetch('https://www.googleapis.com/gmail/v1/users/me/threads?q=' + query + '&maxResults=8', { headers: hdrs })
    .then(r => r.json())
    .then(listData => {
      const ids = (listData.threads || []).map(t => t.id);
      if (!ids.length) {
        container.innerHTML = '<div class="ct-exp-gmail-msg">No Gmail correspondence found.</div>';
        return null;
      }
      return Promise.all(ids.map(id =>
        fetch('https://www.googleapis.com/gmail/v1/users/me/threads/' + id +
          '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date',
          { headers: hdrs }
        ).then(r => r.ok ? r.json() : null)
      ));
    })
    .then(details => {
      if (!details) return;
      const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const html = details.filter(Boolean).map(thread => {
        const msgs = thread.messages || [];
        const last = msgs[msgs.length - 1];
        if (!last) return '';
        const h = {};
        ((last.payload && last.payload.headers) || []).forEach(hdr => h[hdr.name.toLowerCase()] = hdr.value);
        const subject  = h['subject'] || '(no subject)';
        const rawFrom  = h['from'] || '';
        const fromName = rawFrom.replace(/<[^>]+>/, '').trim().replace(/^"|"$/g,'').trim();
        const dateObj  = h['date'] ? new Date(h['date']) : new Date();
        const age      = typeof _formatAge === 'function' ? _formatAge(dateObj) : dateObj.toLocaleDateString();
        const snippet  = (last.snippet||'').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
        const isUnread = (last.labelIds||[]).includes('UNREAD');
        const gmailUrl = 'https://mail.google.com/mail/u/0/#inbox/' + thread.id;
        return `<a class="ct-gmail-thread" href="${esc(gmailUrl)}" target="_blank" onclick="event.stopPropagation()">
          <div class="ct-gmail-row1">
            ${isUnread ? '<span class="ct-gmail-unread-dot"></span>' : ''}
            <span class="ct-gmail-from">${esc(fromName || email)}</span>
            <span class="ct-gmail-date">${esc(age)}</span>
          </div>
          <div class="ct-gmail-subject">${esc(subject)}</div>
          <div class="ct-gmail-snippet">${esc(snippet)}</div>
        </a>`;
      }).join('');
      container.innerHTML = html || '<div class="ct-exp-gmail-msg">No correspondence found.</div>';
    })
    .catch(() => {
      container.innerHTML = '<div class="ct-exp-gmail-msg">Could not load Gmail threads.</div>';
    });
}

// New orders are created in the standalone Intake app (intake.html) —
// these open it pre-filled via query params (read by js/intake.js).
function _openIntakePrefilled(name, email, type) {
  const p = new URLSearchParams();
  if (name)  p.set('name', name);
  if (email) p.set('email', email);
  if (type)  p.set('type', type);
  window.open('intake.html' + (p.toString() ? '?' + p.toString() : ''), '_blank');
}

// Start a new order from an existing order (used by Current Orders click)
function prefillFromOrder(orderId) {
  const o = ORDERS.find(x => x.id === orderId);
  if (!o) return;
  _openIntakePrefilled(o.name, o.email, o.orderType || o.type || 'order');
}

// Start a new order for a past customer
function prefillFromCustomer(name, email, type) {
  _openIntakePrefilled(name, email, type);
}

// ════════════════════════════════════════════
