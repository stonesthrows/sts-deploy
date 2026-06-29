// ════════════════════════════════════════════
//  ORDERS  —  pages/orders.js
//  Kanban board, new order form, estimate builder, drag-drop, camera
// ════════════════════════════════════════════

function fmtPhone(val) {
  const digits = (val || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length > 6) return '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
  if (digits.length > 3) return '(' + digits.slice(0,3) + ') ' + digits.slice(3);
  if (digits.length)     return '(' + digits;
  return '';
}
function fmtPhoneInput(el) { el.value = fmtPhone(el.value); }

function getFullName() {
  const first = document.getElementById('f-firstname')?.value.trim() || '';
  const last  = document.getElementById('f-lastname')?.value.trim()  || '';
  return [first, last].filter(Boolean).join(' ');
}

function setNameFields(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  const first = document.getElementById('f-firstname');
  const last  = document.getElementById('f-lastname');
  if (first) first.value = parts[0] || '';
  if (last)  last.value  = parts.slice(1).join(' ') || '';
}

// ════════════════════════════════════════════
function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = '';

  // ── Active stat-card filter banner ────────────
  const filterBar = document.getElementById('kanbanFilterBar');
  const activeFilterKey = window.kanbanStatFilterKey || null;
  if (filterBar) {
    if (activeFilterKey && activeFilterKey !== 'active') {
      const labels = { due: 'Due ≤ 7 Days', materials: 'Awaiting Materials', bench: 'At the Bench' };
      filterBar.innerHTML = `<span>Filtered: <strong>${labels[activeFilterKey] || activeFilterKey}</strong></span><button class="kanban-filter-clear" onclick="applyStatFilter('${activeFilterKey}')">✕ Clear</button>`;
      filterBar.style.display = 'flex';
    } else {
      filterBar.style.display = 'none';
    }
  }

  COLUMN_GROUPS.forEach(group => {
    const col = document.createElement('div');
    col.className = `k-col ${group.cls}`;

    const allStageIds = group.stages.map(s => s.id);
    const allCards    = ORDERS.filter(o =>
      allStageIds.includes(o.stage) &&
      (showCompleted || !completedHidden.has(o.id)) &&
      (!window.kanbanStatFilter || window.kanbanStatFilter(o))
    );
    const totalCount = allCards.length;

    if (group.pickupSections) {
      // ── Ready to Pickup/Ship: sub-sections by pickup location (stage[0] only) ──
      const pickupCards = allCards.filter(o => o.stage === group.stages[0].id);
      const subsHTML = PICKUP_LOCATIONS.map(loc => {
        const locCards = pickupCards.filter(o => o.pickup === loc);
        const stageId  = group.stages[0].id;
        return `
          <div class="k-sub-wrap s-pickup-sub${locCards.length ? '' : ' k-sub-empty'}">
            <div class="k-sub-head">📍 ${loc}<span class="k-sub-count">${locCards.length}</span></div>
            <div class="k-body"
                 data-stage-id="${stageId}"
                 data-pickup="${loc.replace(/"/g,'&quot;')}"
                 ondragover="dragOver(event)"
                 ondragleave="dragLeave(event)"
                 ondrop="dropWithPickup(event,'${stageId}','${loc.replace(/'/g,"\\'")}')">
              ${locCards.length ? locCards.map(cardHTML).join('') : '<div class="k-empty">Drop here</div>'}
            </div>
          </div>`;
      }).join('');

      // Cards with no / unrecognized pickup location (stage[0] only)
      const unassigned = pickupCards.filter(o => !PICKUP_LOCATIONS.includes(o.pickup));
      const unassignedHTML = unassigned.length ? `
          <div class="k-sub-wrap s-pickup-sub">
            <div class="k-sub-head">📍 Unassigned<span class="k-sub-count">${unassigned.length}</span></div>
            <div class="k-body"
                 data-stage-id="${group.stages[0].id}"
                 ondragover="dragOver(event)"
                 ondragleave="dragLeave(event)"
                 ondrop="drop(event,'${group.stages[0].id}')">
              ${unassigned.map(cardHTML).join('')}
            </div>
          </div>` : '';

      // Extra stages (e.g. Ship Out) rendered as sub-sections below pickup locations
      const extraStagesHTML = group.stages.slice(1).map(stage => {
        const stageCards = ORDERS.filter(o =>
          o.stage === stage.id &&
          (showCompleted || !completedHidden.has(o.id))
        );
        return `
          <div class="k-sub-wrap ${stage.cls}${stageCards.length ? '' : ' k-sub-empty'}">
            <div class="k-sub-head">${stage.label}<span class="k-sub-count">${stageCards.length}</span></div>
            <div class="k-body"
                 data-stage-id="${stage.id}"
                 ondragover="dragOver(event)"
                 ondragleave="dragLeave(event)"
                 ondrop="drop(event,'${stage.id}')">
              ${stageCards.length ? stageCards.map(cardHTML).join('') : '<div class="k-empty">Drop here</div>'}
            </div>
          </div>`;
      }).join('');

      col.innerHTML = `
        <div class="k-head">
          <span>${group.label}</span>
          <span class="k-count">${totalCount}</span>
        </div>
        ${subsHTML}${unassignedHTML}${extraStagesHTML}`;

    } else if (group.stages.length > 1) {
      // ── Multi-stage grouped column ──
      const subsHTML = group.stages.map(stage => {
        const stageCards = allCards.filter(o => o.stage === stage.id);
        return `
          <div class="k-sub-wrap ${stage.cls}${stageCards.length ? '' : ' k-sub-empty'}">
            <div class="k-sub-head">${stage.label}<span class="k-sub-count">${stageCards.length}</span></div>
            <div class="k-body"
                 data-stage-id="${stage.id}"
                 ondragover="dragOver(event)"
                 ondragleave="dragLeave(event)"
                 ondrop="drop(event,'${stage.id}')">
              ${stageCards.length ? stageCards.map(cardHTML).join('') : '<div class="k-empty">Drop here</div>'}
            </div>
          </div>`;
      }).join('');

      const needCount = ORDERS.filter(o => o.stage === 'contact-need').length;
      const alertDot  = (group.cls === 's-contact-group' && needCount > 0)
        ? `<span class="k-alert-dot">${needCount}</span>` : '';

      col.innerHTML = `
        <div class="k-head">
          <span>${group.label}${alertDot}</span>
          <span class="k-count">${totalCount}</span>
        </div>
        ${subsHTML}`;

    } else {
      // ── Single-stage column — original layout ──
      const stageId = group.stages[0].id;
      col.innerHTML = `
        <div class="k-head">
          <span>${group.label}</span>
          <span class="k-count">${totalCount}</span>
        </div>
        <div class="k-body"
             data-stage-id="${stageId}"
             ondragover="dragOver(event)"
             ondragleave="dragLeave(event)"
             ondrop="drop(event,'${stageId}')">
          ${allCards.length ? allCards.map(cardHTML).join('') : '<div class="k-empty">Drop here</div>'}
        </div>`;
    }

    board.appendChild(col);
  });

  // Only count orders that are genuinely in-progress (not completed, delivered, cancelled, or hidden)
  const activeOrders = ORDERS.filter(o =>
    o.stage !== 'complete' && o.stage !== 'delivered' && o.stage !== 'cancelled' &&
    !completedHidden.has(o.id)
  );
  const activeCount  = activeOrders.length;

  // Nav badges
  ['badge-active','badge-active-sub'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = activeCount;
  });

  // Dashboard stat cards — all exclude completed orders
  const setS = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setS('stat-active',    activeCount);
  setS('stat-materials', activeOrders.filter(o => o.stage === 'order-mat' || o.stage === 'materials').length);
  setS('stat-bench',     activeOrders.filter(o => o.stage === 'build').length);
  setS('stat-due',       activeOrders.filter(o => {
    if (!o.deadline) return false;
    const diff = Math.round((new Date(o.deadline) - TODAY) / 86400000);
    return diff >= 0 && diff <= 7;
  }).length);
}

function cardHTML(o) {
  const dl       = deadlineInfo(o.deadline);
  const hasPhoto = !!o.photo;
  const isCollapsed = !expandedCards.has(o.id);
  const platformCls = o.id.startsWith('etsy-') ? ' o-card-etsy'
                     : o.id.startsWith('shopify-') ? ' o-card-shopify' : '';
  return `
    <div class="o-card${platformCls}${o.stage === 'contact-need' ? ' contact-pulse' : ''}${isCollapsed ? ' collapsed' : ''}"
         id="card-${o.id}"
         draggable="true"
         ondragstart="dragStart(event,'${o.id}')"
         ondragend="dragEnd(event)"
         onpointerdown="cardPointerDown(event,'${o.id}','kanban')"
         onclick="openOrderCard('${o.id}')">
      ${o.stage === 'contact-need' ? `<div class="contact-banner"><span class="contact-banner-icon">📞</span> Contact Customer</div>` : ''}
      <div class="o-card-header">
        <div class="o-name">${o.name}${!o.notionId ? ` <span class="o-unsynced" title="Not yet synced to Notion — tap to retry now" onclick="event.stopPropagation(); retrySyncOrder('${o.id}')">⚠ unsynced</span>` : ''}</div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
          <button class="card-camera-btn ${hasPhoto ? 'has-photo' : ''}"
                  title="${hasPhoto ? 'View / replace photo' : 'Attach work order photo'}"
                  onclick="event.stopPropagation(); openCamera('${o.id}')">📷</button>
          <button class="card-print-btn"
                  title="Print work order"
                  onclick="event.stopPropagation(); printOrder('${o.id}')">🖨</button>
          <button class="card-move-btn"
                  title="Move to another stage"
                  onclick="event.stopPropagation(); openStageSheet('${o.id}')">↪</button>
          <span class="o-chevron"
                title="Expand / Collapse"
                onclick="event.stopPropagation(); toggleCard('${o.id}')">▾</span>
        </div>
      </div>
      <div class="o-collapsed-summary">
        ${o.id.startsWith('etsy-') ? `<span class="o-badge platform-etsy">🛍️ Etsy Order</span>`
          : o.id.startsWith('shopify-') ? `<span class="o-badge platform-shopify">🛒 Shopify Order</span>`
          : o.pickup ? `<span class="o-badge pickup">📍 ${o.pickup}</span>` : ''}
        ${o.assignee ? `<span class="o-badge assignee">👤 ${o.assignee}</span>` : ''}
        <span class="o-tag ${dl.cls}">${dl.text}</span>
      </div>
      <div class="o-body">
        ${hasPhoto ? `
          <div class="card-photo" onclick="event.stopPropagation(); viewPhoto('${o.id}')">
            <img src="${o.photo}" alt="Work order bag">
            <div class="card-photo-label">📷 Tap to view full size</div>
          </div>` : ''}
        <div class="o-desc">${o.desc}</div>
        ${(o.pickup || o.contactSource || o.contactedAt || o.assignee) ? `
        <div class="o-badges">
          ${o.pickup        ? `<span class="o-badge pickup">📍 ${o.pickup}</span>` : ''}
          ${o.contactSource ? `<span class="o-badge source">💬 ${o.contactSource}</span>` : ''}
          ${o.contactedAt   ? `<span class="o-badge contacted">✓ Contacted ${fmtDate(o.contactedAt)}</span>` : ''}
          ${o.assignee      ? `<span class="o-badge assignee">👤 ${o.assignee}</span>` : ''}
        </div>` : ''}
        <div class="o-foot">
          <span class="o-tag ${dl.cls}">${dl.text}</span>
          <span class="o-price">${fmtPrice(o.price)}</span>
        </div>
      </div>
    </div>`;
}

function openOrderCard(id) {
  const o = ORDERS.find(x => x.id === id);
  if (!o) return;

  document.getElementById('f-editing-id').value  = o.id;
  setNameFields(o.name);
  document.getElementById('f-job-desc').value      = o.jobDesc        || '';
  document.getElementById('f-description').value  = o.desc          || '';
  document.getElementById('f-stage').value         = o.stage         || 'intake-custom';
  _jdMode = o.jobDescMode === 'square' ? 'square' : 'custom';
  const jdType = document.getElementById('f-jobdesc-type');
  if (jdType) jdType.value = _jdMode;
  jdApplyVisibility(_jdMode);
  oiLoadFromOrder(o);
  document.getElementById('f-deposit').value       = o.deposit       || '';
  dpUpdatePaidByLabel();
  document.getElementById('f-shipping').value      = o.shipping      || '';
  document.getElementById('f-deadline').value      = o.deadline      || '';
  document.getElementById('f-takein').value        = o.takeIn        || '';
  document.getElementById('f-pickup').value        = o.pickup        || '';
  document.getElementById('f-email').value         = o.email         || '';
  document.getElementById('f-phone').value         = fmtPhone(o.phone);
  document.getElementById('f-source').value        = o.contactSource || '';
  document.getElementById('f-assignee').value      = o.assignee      || '';
  document.getElementById('f-materials').value     = o.materials     || '';
  document.getElementById('f-paid-by').value       = o.paidBy        || '';
  document.getElementById('f-notes').value         = o.notes         || '';
  document.getElementById('f-customer-notes').value = o.customerNotes || '';
  document.getElementById('f-sketch').value        = o.sketchDesc    || '';
  const sa = o.shippingAddress || {};
  document.getElementById('f-addr-street').value   = sa.street  || o.addrStreet  || o.address || '';
  document.getElementById('f-addr-street2').value  = sa.street2 || o.addrStreet2 || '';
  document.getElementById('f-addr-city').value     = sa.city    || o.addrCity    || '';
  document.getElementById('f-addr-state').value    = sa.state   || o.addrState   || '';
  document.getElementById('f-addr-zip').value      = sa.zip     || o.addrZip     || '';
  document.getElementById('f-addr-country').value  = sa.country || o.addrCountry || 'United States';
  toggleShippingAddress();

  // Auto-select Etsy/Shopify in the Order Type dropdown for synced orders —
  // only when orderType is still the generic default, so a manual
  // recategorization (e.g. to Repair) sticks on future edits.
  const platformType = o.id.startsWith('etsy-') ? 'etsy-order' : o.id.startsWith('shopify-') ? 'website-order' : null;
  setOrderType(platformType && (!o.orderType || o.orderType === 'order') ? platformType : (o.orderType || 'order'));

  _setOrderFormEditMode(true, o.name);
  populateEstimateFromOrder(o);
  switchTab('new-order', document.querySelector('.sub-nav-tab[data-tab=new-order]'));
}

function _setOrderFormEditMode(editing, name) {
  document.getElementById('order-form-title').textContent     = editing ? ('Edit Order' + (name ? ' — ' + name : '')) : 'Order Intake';
  document.getElementById('order-form-sub').textContent       = editing ? 'Changes are saved to Notion automatically.' : 'Submitting creates a ClickUp task + Notion record automatically.';
  document.getElementById('order-form-submit').textContent    = editing ? '✓ Save Changes' : '✓ Create Order';
  document.getElementById('order-form-gmail-btn').style.display = editing ? 'none' : '';
  document.getElementById('order-form-back-btn').style.display  = editing ? '' : 'none';
  document.getElementById('order-form-foot-note').style.display = editing ? 'none' : '';
  document.getElementById('f-stage-row').style.display          = editing ? '' : 'none';
  document.getElementById('f-paid-by-row').style.display        = editing ? '' : 'none';
  document.getElementById('order-edit-actions').style.display   = editing ? 'flex' : 'none';
  const hint = document.getElementById('ot-hint');
  if (hint) hint.style.display = editing ? 'none' : '';
}

function closeEditOrderModal() {
  clearForm();
  switchTab('dashboard', document.querySelector('[data-tab=dashboard]'));
}

function markOrderComplete() {
  const id = document.getElementById('f-editing-id').value;
  const o  = ORDERS.find(x => x.id === id);
  if (!o) return;

  // Confirm final price (pre-filled with quoted price)
  const priceInput = prompt(
    `Final price for ${o.name}:\n(quoted: $${o.price || 0})`,
    o.price || ''
  );
  if (priceInput === null) return; // cancelled

  const finalPrice = parseFloat(priceInput) || o.price || 0;

  o.stage       = 'complete';
  o.finalPrice  = finalPrice;
  o.completedAt = new Date().toISOString();
  completedHidden.add(o.id);

  // Always persist to completed registry — prevents sync from ever un-completing
  try {
    const reg = JSON.parse(localStorage.getItem('sts-completed-registry') || '[]');
    const entry = { id: o.id, notionId: o.notionId || null };
    if (!reg.some(r => r.id === entry.id)) reg.push(entry);
    localStorage.setItem('sts-completed-registry', JSON.stringify(reg));
  } catch(e) {}

  updateCompletedToggle();
  renderKanban();
  closeEditOrderModal();

  // Push the full order (not just a stage-only patch) so the completion
  // date lands in Notion's "Completed At" property in the same request —
  // matches prodMarkDelivered's approach for the 'delivered' stage.
  if (typeof notionUpdateOrder === 'function') notionUpdateOrder(o);

  saveToStorage();
  toast(`${o.name} completed — $${finalPrice.toLocaleString()} ✓`, '✓');
}

function markOrderCancelled() {
  const id = document.getElementById('f-editing-id').value;
  const o  = ORDERS.find(x => x.id === id);
  if (!o) return;
  if (!confirm('Mark "' + o.name + '" as Cancelled?')) return;
  o.stage       = 'cancelled';
  o.cancelledAt = new Date().toISOString().slice(0, 10);
  delete o.deliveredAt;
  saveToStorage();
  if (typeof notionUpdateStage === 'function') notionUpdateStage(o.notionId, 'cancelled');
  renderKanban();
  if (typeof renderProduction === 'function') renderProduction();
  closeEditOrderModal();
  toast(o.name + ' marked as cancelled', '🚫');
}

function deleteOrder() {
  const id = document.getElementById('f-editing-id').value;
  const o  = ORDERS.find(x => x.id === id);
  if (!o) return;
  if (!confirm('Permanently delete "' + o.name + '"? This cannot be undone.')) return;
  ORDERS.splice(ORDERS.indexOf(o), 1);
  saveToStorage();
  // Archive the Notion page if it exists
  if (o.notionId && typeof notionUpdateStage === 'function') {
    fetch('/api/notion-pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notionId: o.notionId, _archive: true }),
    }).catch(() => {});
  }
  renderKanban();
  if (typeof renderProduction === 'function') renderProduction();
  closeEditOrderModal();
  toast(o.name + ' deleted', '🗑');
}

function saveOrderEdit() {
  const id = document.getElementById('f-editing-id').value;
  const o  = ORDERS.find(x => x.id === id);
  if (!o) return;

  o.name          = getFullName();
  o.jobDescMode   = _jdMode;
  o.jobDesc       = jdGetJobDescValue();
  o.desc          = jdGetDescValue();
  o.stage         = document.getElementById('f-stage').value;
  o.items         = _oiItems.map(it => ({ ...it }));
  o.price         = parseFloat(document.getElementById('f-price').value) || 0;
  o.deposit       = parseFloat(document.getElementById('f-deposit').value) || 0;
  o.shipping      = parseFloat(document.getElementById('f-shipping').value) || 0;
  o.deadline      = document.getElementById('f-deadline').value || null;
  o.takeIn        = document.getElementById('f-takein').value   || null;
  o.pickup        = document.getElementById('f-pickup').value   || null;
  o.email         = document.getElementById('f-email').value.trim();
  o.phone         = document.getElementById('f-phone').value.trim();
  o.contactSource = document.getElementById('f-source').value    || null;
  o.assignee      = document.getElementById('f-assignee').value  || null;
  o.materials     = document.getElementById('f-materials').value.trim() || '';
  o.ringSize      = oiDeriveRingSizesText(o.items);
  o.paidBy        = document.getElementById('f-paid-by').value          || '';
  o.notes         = document.getElementById('f-notes').value.trim()         || '';
  o.customerNotes = document.getElementById('f-customer-notes').value.trim() || '';
  o.sketchDesc    = document.getElementById('f-sketch').value.trim()    || '';
  o.orderType     = (document.getElementById('f-order-type') || {}).value || o.orderType || 'order';
  o.addrStreet  = document.getElementById('f-addr-street').value.trim();
  o.addrStreet2 = document.getElementById('f-addr-street2').value.trim();
  o.addrCity    = document.getElementById('f-addr-city').value.trim();
  o.addrState   = document.getElementById('f-addr-state').value.trim();
  o.addrZip     = document.getElementById('f-addr-zip').value.trim();
  o.addrCountry = document.getElementById('f-addr-country').value.trim() || 'United States';
  o.shippingAddress = {
    street:  o.addrStreet,
    street2: o.addrStreet2,
    city:    o.addrCity,
    state:   o.addrState,
    zip:     o.addrZip,
    country: o.addrCountry,
  };

  updateCompletedToggle();
  renderKanban();
  closeEditOrderModal();

  // Sync full order to Notion
  if (typeof notionUpdateOrder === 'function') notionUpdateOrder(o);

  saveToStorage();

  // Refresh any open customer expand panels so order changes show immediately
  if (typeof refreshOpenCustomerExpands === 'function') refreshOpenCustomerExpands();

  toast('Order updated ✓', '✓');
}

// ════════════════════════════════════════════

//  GMAIL PANEL
// ════════════════════════════════════════════
function openGmailPanel() {
  const list = document.getElementById('gpList');
  list.innerHTML = GMAIL_THREADS.map((t,i) => `
    <div class="gp-thread" onclick="fillFromThread(${i})">
      <div class="gp-subj">${t.subject}</div>
      <div class="gp-from">${t.from}</div>
      <div class="gp-snip">${t.snippet}</div>
    </div>`).join('');
  document.getElementById('gmailPanel').classList.add('open');
}

function closeGmailPanel() {
  document.getElementById('gmailPanel').classList.remove('open');
}

function fillFromThread(i) {
  const t = GMAIL_THREADS[i];
  if (t.name) setNameFields(t.name);
  if (t.email) document.getElementById('f-email').value = t.email;
  closeGmailPanel();
  switchTab('new-order', document.querySelector('.sub-nav-tab[data-tab=new-order]'));
  toast('Customer info filled from Gmail thread');
}

// ════════════════════════════════════════════

//  ORDER TYPE DROPDOWN
// ════════════════════════════════════════════
const ORDER_TYPE_STAGES = {
  order:           { stage: 'intake-custom',  label: 'Custom Intake'        },
  repair:          { stage: 'intake-repair',  label: 'Repair Intake'        },
  resize:          { stage: 'intake-repair',  label: 'Repair Intake'        },
  'etsy-order':    { stage: 'intake-custom',  label: 'Custom Intake'        },
  'website-order': { stage: 'intake-website', label: 'Website Order Intake' },
  estimate:        { stage: 'needs-est',      label: 'Estimate Intake'      },
};

function onOrderTypeChange() {
  const sel  = document.getElementById('f-order-type');
  const hint = document.getElementById('ot-hint');
  if (!sel || !hint) return;
  const map = ORDER_TYPE_STAGES[sel.value] || ORDER_TYPE_STAGES.order;
  hint.innerHTML = `Will be placed in <strong>${map.label}</strong>.`;
}

function setOrderType(type) {
  const sel = document.getElementById('f-order-type');
  if (sel) { sel.value = type; onOrderTypeChange(); }
}

// ════════════════════════════════════════════

//  NEW ORDER FORM
// ════════════════════════════════════════════
function submitOrder() {
  if (document.getElementById('f-editing-id').value) { saveOrderEdit(); return; }
  const submitBtn = document.getElementById('order-form-submit');
  if (submitBtn && submitBtn.disabled) return; // guard against double-click double-submit
  if (submitBtn) submitBtn.disabled = true;
  const name  = getFullName();
  const email = document.getElementById('f-email').value.trim();
  const desc  = jdGetDescValue();
  if (!name || !desc) {
    toast(_jdMode === 'square' ? 'Please fill in Name and select a Square Item' : 'Please fill in Name and Description', '⚠');
    const highlightIds = _jdMode === 'square' ? ['f-firstname'] : ['f-firstname', 'f-description'];
    highlightIds.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value.trim()) {
        el.style.borderColor = '#E05050';
        el.addEventListener('input', () => el.style.borderColor = '', { once: true });
      }
    });
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  const jobDesc    = jdGetJobDescValue();
  const items      = _oiItems.map(it => ({ ...it }));
  const price      = parseFloat(document.getElementById('f-price').value)   || 0;
  const deposit    = parseFloat(document.getElementById('f-deposit').value) || 0;
  const shipping   = parseFloat(document.getElementById('f-shipping').value) || 0;
  const ringSize   = oiDeriveRingSizesText(items);
  const deadline   = document.getElementById('f-deadline').value || null;
  const takeIn        = document.getElementById('f-takein').value || null;
  const pickup        = document.getElementById('f-pickup').value || null;
  const addrStreet  = document.getElementById('f-addr-street').value.trim();
  const addrStreet2 = document.getElementById('f-addr-street2').value.trim();
  const addrCity    = document.getElementById('f-addr-city').value.trim();
  const addrState   = document.getElementById('f-addr-state').value.trim();
  const addrZip     = document.getElementById('f-addr-zip').value.trim();
  const addrCountry = document.getElementById('f-addr-country').value.trim() || 'United States';
  const shippingAddress = { street: addrStreet, street2: addrStreet2, city: addrCity, state: addrState, zip: addrZip, country: addrCountry };
  const contactSource = document.getElementById('f-source').value || null;
  const assignee      = document.getElementById('f-assignee').value || null;
  const newId      = 'u' + Date.now();
  const typeVal    = (document.getElementById('f-order-type') || {}).value || 'order';
  const typeMap    = ORDER_TYPE_STAGES[typeVal] || ORDER_TYPE_STAGES.order;
  const stage      = typeMap.stage;
  const stageLabel = typeMap.label;

  // ── Add to local ORDERS ──────────────────
  ORDERS.push({
    id:        newId,
    name:      name,
    jobDesc:   jobDesc,
    jobDescMode: _jdMode,
    desc:      desc,
    stage:     stage,
    deadline:  deadline,
    items:     items,
    price:     price,
    deposit:   deposit,
    shipping:  shipping,
    ringSize:  ringSize,
    notionId:  null,
    email:     email,
    phone:     document.getElementById('f-phone').value.trim(),
    takeIn:        takeIn,
    pickup:        pickup,
    shippingAddress: shippingAddress,
    addrStreet, addrStreet2, addrCity, addrState, addrZip, addrCountry,
    contactSource: contactSource,
    assignee:      assignee,
    orderType:     typeVal,
  });

  // ── Add or update CUSTOMERS ──────────────
  const phone    = document.getElementById('f-phone').value.trim();
  const existing = CUSTOMERS.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.totalOrders += 1;
    existing.totalValue  += price;
    existing.lastContact  = new Date().toISOString().slice(0,10);
    existing.activeOrders = (existing.activeOrders || 0) + 1;
    if (phone) existing.phone = phone;
    if (email) existing.email = email;
  } else {
    CUSTOMERS.unshift({
      name,
      email,
      phone,
      lastContact:  new Date().toISOString().slice(0,10),
      totalOrders:  1,
      totalValue:   price,
      activeOrders: 1,
    });
  }

  // ── Refresh UI ───────────────────────────
  renderKanban();
  renderCustomers();
  saveToStorage();
  clearForm();
  switchTab('dashboard', document.querySelector('[data-tab=dashboard]'));
  toast(`${name} added to ${stageLabel}!`, '✓');

  // ── Sync customer to Notion ───────────────
  const updatedCustomer = CUSTOMERS.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (updatedCustomer && typeof upsertCustomerToNotion === 'function') {
    upsertCustomerToNotion(updatedCustomer);
  }

  // ── Sync new order to Notion ─────────────
  const newOrder = ORDERS[ORDERS.length - 1]; // just pushed above
  if (typeof notionCreateOrder === 'function') {
    notionCreateOrder(newOrder).then(notionId => {
      if (notionId) {
        newOrder.notionId = notionId;
        saveToStorage();
        if (typeof setConnStatus === 'function') setConnStatus(true);
      } else {
        if (typeof setConnStatus === 'function') setConnStatus(false);
        toast('⚠ Saved locally — Notion sync failed, will retry on next app open', '⚠');
        renderKanban();
      }
    });
  }
}


function dpUpdatePaidByLabel() {
  const label   = document.getElementById('f-paid-by-label');
  const deposit = document.getElementById('f-deposit');
  if (!label || !deposit) return;
  const hasDeposit = (parseFloat(deposit.value) || 0) > 0;
  label.textContent = hasDeposit ? 'Deposit Paid By' : 'Paid By';
}

function toggleShippingAddress() {
  const pickup    = document.getElementById('f-pickup');
  const isShipped = pickup && pickup.value === 'To be Shipped';
  ['addr-street-fg', 'addr-street2-fg', 'addr-city-fg', 'addr-state-fg', 'addr-zip-fg', 'addr-country-fg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isShipped ? '' : 'none';
  });
}

function clearForm() {
  ['f-firstname','f-lastname','f-email','f-phone','f-takein','f-deadline','f-job-desc','f-description','f-materials','f-deposit','f-shipping','f-notes','f-customer-notes','f-sketch',
   'f-addr-street','f-addr-street2','f-addr-city','f-addr-state','f-addr-zip','f-addr-country']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.style.borderColor = ''; }
    });
  const countryEl = document.getElementById('f-addr-country');
  if (countryEl) countryEl.value = 'United States';
  const pickup = document.getElementById('f-pickup');
  if (pickup) pickup.value = '';
  const source = document.getElementById('f-source');
  if (source) source.value = '';
  const assignee = document.getElementById('f-assignee');
  if (assignee) assignee.value = '';
  const editingId = document.getElementById('f-editing-id');
  if (editingId) editingId.value = '';
  const submitBtn = document.getElementById('order-form-submit');
  if (submitBtn) submitBtn.disabled = false;
  const compose = document.getElementById('eo-invoice-compose');
  if (compose) { compose.style.display = 'none'; compose.innerHTML = ''; }
  const estCard = document.getElementById('estimateBuilderCard');
  if (estCard) estCard.style.display = 'none';
  const estBtn = document.getElementById('add-estimate-btn');
  if (estBtn) estBtn.textContent = '💰 Add Estimate';
  dpUpdatePaidByLabel();
  toggleShippingAddress();
  setOrderType('order');
  _setOrderFormEditMode(false);
  const jdType = document.getElementById('f-jobdesc-type');
  if (jdType) jdType.value = 'custom';
  _jdMode = 'custom';
  jdApplyVisibility('custom');
  oiInit();
}

// ════════════════════════════════════════════
//  ORDER ITEMS — multi-item picker (manual entry or Square catalog item)
//  Each item: { type:'manual'|'square', name, sku, price, squareItemId, squareVariationId }
// ════════════════════════════════════════════
let _oiItems = [];
let _oiDebounce = {};
let _oiLastResults = {};

function oiInit() {
  _oiItems = [];
  oiRender();
}

// ════════════════════════════════════════════
//  JOB DESCRIPTION — Custom Item (free text) vs Square Item (the job IS a single
//  catalog item, picked the same way as an Order Item). Square Item mode hides Order
//  Description / Materials / Sketch Notes / the multi-item Order Items section, and
//  uses the chosen item's name as the saved description/title — without touching
//  whatever text was already typed in those hidden fields, so toggling back restores it.
// ════════════════════════════════════════════
let _jdMode = 'custom';

function jdApplyVisibility(mode) {
  const show = id => { const el = document.getElementById(id); if (el) el.style.display = ''; };
  const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  if (mode === 'square') {
    hide('jobdesc-custom-wrap'); show('jobdesc-square-wrap');
    hide('orderdesc-fg'); hide('materials-fg'); hide('sketch-fg'); hide('oi-section');
  } else {
    show('jobdesc-custom-wrap'); hide('jobdesc-square-wrap');
    show('orderdesc-fg'); show('materials-fg'); show('sketch-fg'); show('oi-section');
  }
}

function jdSetType(mode) {
  _jdMode = mode;
  if (mode === 'square') {
    const allSquare = _oiItems.length > 0 && _oiItems.every(it => it.type === 'square');
    if (!allSquare) {
      _oiItems = [{ type: 'square', name: '', sku: '', price: 0, squareItemId: null, squareVariationId: null }];
    }
  }
  jdApplyVisibility(mode);
  oiRender();
}

function jdAddSquareItem() {
  _oiItems.push({ type: 'square', name: '', sku: '', price: 0, squareItemId: null, squareVariationId: null });
  oiRender();
}

function _jdSquareItemNames() {
  return _oiItems.filter(it => it.name).map(it => it.name).join(', ');
}

function jdGetDescValue() {
  if (_jdMode === 'square') return _jdSquareItemNames();
  return document.getElementById('f-description').value.trim();
}

function jdGetJobDescValue() {
  if (_jdMode === 'square') return _jdSquareItemNames();
  return document.getElementById('f-job-desc').value.trim();
}

function oiLoadFromOrder(o) {
  if (Array.isArray(o.items) && o.items.length) {
    _oiItems = o.items.map(it => ({ ...it }));
  } else if (o.price) {
    // Legacy order created before line items existed — preserve its total as a single item.
    _oiItems = [{ type: 'manual', name: 'Order Total', price: o.price }];
  } else {
    _oiItems = [];
  }
  oiRender();
}

function oiAddItem() {
  _oiItems.push({ type: 'manual', name: '', sku: '', price: 0 });
  oiRender();
}

function oiRemoveItem(idx) {
  _oiItems.splice(idx, 1);
  oiRender();
}

function oiSetType(idx, type) {
  if (!_oiItems[idx]) return;
  _oiItems[idx] = type === 'square'
    ? { type: 'square', name: '', sku: '', price: 0, squareItemId: null, squareVariationId: null }
    : { type: 'manual', name: '', sku: '', price: 0 };
  oiRender();
}

function oiUpdateField(idx, field, value) {
  if (!_oiItems[idx]) return;
  _oiItems[idx][field] = value;
  if (field === 'price') oiRecalcTotal();
}

function oiClearSquareSelection(idx) {
  if (!_oiItems[idx]) return;
  _oiItems[idx] = { type: 'square', name: '', sku: '', price: 0, squareItemId: null, squareVariationId: null };
  oiRender();
}

function oiRecalcTotal() {
  const total = _oiItems.reduce((sum, it) => sum + (parseFloat(it.price) || 0) * (parseInt(it.quantity, 10) || 1), 0);
  const priceEl = document.getElementById('f-price');
  if (priceEl) priceEl.value = total ? total.toFixed(2) : '';
}

// Square ring category IDs (from inventory.js INV_RING_CAT_IDS) flattened into a lookup set,
// used to detect which Square items are rings so we can offer a manual size field for the
// ones that have no size variation set up in Square.
function _oiRingCategoryIdSet() {
  if (typeof INV_RING_CAT_IDS === 'undefined') return new Set();
  return new Set(Object.values(INV_RING_CAT_IDS).flat());
}

// Stackable rings are the one ring sub-category staying on Square variation-less SKUs for
// now (sizing is being rolled out everywhere else) — exclude them from the manual size field.
function _oiStackableCategoryIdSet() {
  if (typeof INV_RING_CAT_IDS === 'undefined' || !INV_RING_CAT_IDS.stackable) return new Set();
  return new Set(INV_RING_CAT_IDS.stackable);
}

// Combines per-item ring sizes (manual entries for Square rings with no Square size
// variation, plus sizes already embedded in a selected size variation's name) into the
// single string sent to Notion / printed on the work order bag.
function oiDeriveRingSizesText(items) {
  if (!Array.isArray(items)) return '';
  const sizes = [];
  items.forEach(it => {
    if (it.ringSize) { sizes.push(String(it.ringSize).trim()); return; }
    if (it.type === 'square' && it.name && it.name.indexOf(' — ') !== -1) {
      const suffix = it.name.split(' — ').pop().trim();
      if (/size/i.test(suffix)) sizes.push(suffix);
    }
  });
  return sizes.filter(Boolean).join(', ');
}

function oiSerialize() {
  return JSON.stringify(_oiItems);
}

// Builds a printable label for one item that spells out its selected Square modifiers
// and manual ring size — e.g. "Narrow Regular Gold Fill Chevron Stacker - Size 4" —
// instead of just the bare catalog item name. Used only for the printed work order bag.
function oiPrintLabel(it) {
  if (!it) return '';
  let label;
  if (it.type !== 'square') {
    label = it.name || '';
  } else {
    const modParts = (it.modifierLists || []).map(list => {
      const optId = it.selectedModifierIds && it.selectedModifierIds[list.id];
      const opt = (list.options || []).find(o => o.id === optId);
      return opt ? opt.name : null;
    }).filter(Boolean);
    label = modParts.length ? modParts.join(' ') + ' ' + (it.name || '') : (it.name || '');
  }
  const qty = parseInt(it.quantity, 10) || 1;
  if (qty > 1) label = qty + '× ' + label;
  if (it.ringSize) label += ' - Size ' + it.ringSize;
  return label;
}

// Job Description (estimate title) and Order Description keep showing the plain item
// name in-app and in Notion — this richer version is only for the printed work order.
function oiPrintDescription(o) {
  if (o.jobDescMode === 'square' && Array.isArray(o.items) && o.items.length) {
    const labels = o.items.map(oiPrintLabel).filter(Boolean);
    if (labels.length <= 1) return labels.join('');
    return labels.map((label, i) => 'Item ' + (i + 1) + ' - ' + label).join('\n');
  }
  return o.desc || '';
}

function oiRender() {
  if (_jdMode === 'square') {
    const box = document.getElementById('jobdesc-square-picker');
    if (box) {
      box.innerHTML = !_oiItems.length
        ? '<div style="font-size:12px;color:var(--text3);padding:4px 0;">No items yet — search and select a Square item.</div>'
        : _oiItems.map((it, idx) => oiRowHtml(it, idx, true)).join('');
    }
  } else {
    const box = document.getElementById('oi-items-container');
    if (box) {
      box.innerHTML = !_oiItems.length
        ? '<div style="font-size:12px;color:var(--text3);padding:4px 0;">No items yet — add a manual item or a Square item.</div>'
        : _oiItems.map((it, idx) => oiRowHtml(it, idx, false)).join('');
    }
  }
  oiRecalcTotal();
  const itemsJson = document.getElementById('f-items-json');
  if (itemsJson) itemsJson.value = oiSerialize();
}

function oiRowHtml(it, idx, hideTypeSelect) {
  const isSquareSelected = it.type === 'square' && (it.squareVariationId || it.squareItemId);
  const typeSel = (isSquareSelected || hideTypeSelect) ? '' : `<select onchange="oiSetType(${idx}, this.value)" style="font-size:11px;padding:5px 6px;border:1px solid var(--bdr);border-radius:5px;background:#fff;flex-shrink:0;">
    <option value="manual" ${it.type === 'manual' ? 'selected' : ''}>Manual Item</option>
    <option value="square" ${it.type === 'square' ? 'selected' : ''}>Square Item</option>
  </select>`;

  let body;
  if (it.type === 'square') {
    if (it.squareVariationId || it.squareItemId) {
      const needsRingSize = it.isRing && it.noSquareSize;
      body = `<div style="flex:1;display:flex;flex-direction:column;gap:6px;">
        <div class="rq-selected-item">
          <div style="flex:1;">
            <div class="rq-result-name">${(it.name || '').replace(/</g, '&lt;')}</div>
            <div class="rq-result-meta">${it.sku ? 'SKU ' + it.sku.replace(/</g, '&lt;') : ''}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--text3);">${it.hasFixedPrice ? 'Square Price' : 'Enter Price'}</span>
            <input type="number" step="0.01" min="0" placeholder="0.00" value="${it.price || ''}" oninput="oiUpdateField(${idx},'price',parseFloat(this.value)||0)" style="width:90px;padding:4px 6px;border:1px solid ${it.hasFixedPrice ? 'var(--bdr)' : '#C98A2A'};border-radius:6px;font-size:12px;">
          </div>
          <button type="button" class="rq-item-remove" title="Change item" onclick="oiClearSquareSelection(${idx})">↺</button>
        </div>
        ${!it.hasFixedPrice ? `<div style="font-size:11px;color:#A0702A;">No fixed price in Square (variable pricing) — enter the price manually</div>` : ''}
        ${(it.modifierLists || []).map(list => `
        <div style="display:flex;align-items:center;gap:6px;">
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#7A7268;flex-shrink:0;">${(list.name || '').replace(/</g, '&lt;')}</label>
          <select onchange="oiSetModifier(${idx},'${list.id}', this.value)" style="font-size:12px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;background:#fff;flex:1;max-width:220px;">
            ${list.options.map(o => `<option value="${o.id}" ${it.selectedModifierIds && it.selectedModifierIds[list.id] === o.id ? 'selected' : ''}>${(o.name || '').replace(/</g, '&lt;')} — $${((parseFloat(it.basePrice) || 0) + o.price).toFixed(2)}</option>`).join('')}
          </select>
        </div>`).join('')}
        ${needsRingSize ? `<div style="display:flex;align-items:center;gap:6px;">
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#7A7268;flex-shrink:0;">Ring Size</label>
          <input type="text" placeholder="e.g. 6.5" value="${(it.ringSize || '').replace(/"/g, '&quot;')}" oninput="oiUpdateField(${idx},'ringSize',this.value)" style="width:90px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;font-size:12px;">
          <span style="font-size:11px;color:var(--text3);">No size variation in Square — enter the size manually</span>
        </div>` : ''}
      </div>`;
    } else {
      body = `<div style="flex:1;position:relative;">
        <div class="rq-setup-search-wrap">
          <span class="rq-setup-search-icon">🔍</span>
          <input type="text" class="rq-setup-search-input" placeholder="Search Square catalog…" oninput="oiSearchInput(${idx}, this.value)">
          <div class="rq-setup-spinner" id="oi-spinner-${idx}"></div>
        </div>
        <div class="rq-setup-results" id="oi-results-${idx}"></div>
      </div>`;
    }
  } else {
    const needsRingSize = it.isRing && it.noSquareSize;
    body = `<div style="flex:1;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;gap:8px;">
        <input type="text" placeholder="Item name" value="${(it.name || '').replace(/"/g, '&quot;')}" oninput="oiUpdateField(${idx},'name',this.value)" style="flex:1;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;">
        <input type="number" step="1" min="1" placeholder="Qty" value="${it.quantity || 1}" oninput="oiUpdateField(${idx},'quantity',parseInt(this.value,10)||1)" style="width:60px;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;">
        <input type="number" step="0.01" min="0" placeholder="0.00" value="${it.price || ''}" oninput="oiUpdateField(${idx},'price',parseFloat(this.value)||0)" style="width:100px;padding:6px 8px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;">
      </div>
      ${needsRingSize ? `<div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#7A7268;flex-shrink:0;">Ring Size</label>
        <input type="text" placeholder="e.g. 6.5" value="${(it.ringSize || '').replace(/"/g, '&quot;')}" oninput="oiUpdateField(${idx},'ringSize',this.value)" style="width:90px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;font-size:12px;">
      </div>` : ''}
    </div>`;
  }

  return `<div style="display:flex;align-items:center;gap:8px;border:1px solid var(--bdr-light);border-radius:8px;padding:8px;background:var(--card-bg);">
    ${typeSel}
    ${body}
    <button type="button" class="rq-item-remove" title="Remove item" onclick="oiRemoveItem(${idx})" style="font-size:16px;">✕</button>
  </div>`;
}

function oiSearchInput(idx, value) {
  if (_oiDebounce[idx]) clearTimeout(_oiDebounce[idx]);
  const box = document.getElementById('oi-results-' + idx);
  if (!value || value.length < 2) {
    if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    return;
  }
  _oiDebounce[idx] = setTimeout(() => oiSearchSquare(idx, value), 350);
}

function _oiSqCall(path, opts = {}) {
  const token = localStorage.getItem('sts-square-token') || '';
  const payload = { path: '/v2' + path, method: opts.method || 'GET' };
  if (opts.body) payload.body = opts.body;
  if (token) payload.token = token;
  return fetch('/api/square', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
}

function oiSearchSquare(idx, query) {
  const spinner = document.getElementById('oi-spinner-' + idx);
  if (spinner) spinner.style.display = 'block';
  _oiSqCall('/catalog/search', {
    method: 'POST',
    body: { object_types: ['ITEM'], query: { text_query: { keywords: [query] } }, limit: 20, include_related_objects: true },
  }).then(data => {
    const found = data.objects || [];
    if (!found.length) { oiRenderResults(idx, [], query); return null; }
    return _oiSqCall('/catalog/batch-retrieve', {
      method: 'POST',
      body: { object_ids: found.map(o => o.id), include_related_objects: true },
    }).then(fullData => {
      // Metal/style choices (e.g. Silver vs Gold Fill, Single vs Double) are set up in
      // Square as MODIFIER_LIST objects attached to the item, not separate variations —
      // those come back in related_objects, not inline on the item.
      const modifierListsById = {};
      (fullData.related_objects || []).forEach(o => {
        if (o.type === 'MODIFIER_LIST') modifierListsById[o.id] = o;
      });

      const ringCatIds      = _oiRingCategoryIdSet();
      const stackableCatIds = _oiStackableCategoryIdSet();
      const rows = [];
      (fullData.objects || []).forEach(obj => {
        if (obj.type !== 'ITEM') return;
        const itemName = obj.item_data ? obj.item_data.name : 'Unnamed';
        const variations = obj.item_data ? (obj.item_data.variations || []) : [];
        const catIds = [];
        if (obj.item_data && obj.item_data.category_id) catIds.push(obj.item_data.category_id);
        (obj.item_data && obj.item_data.categories || []).forEach(c => { if (c.id) catIds.push(c.id); });
        const isRing      = catIds.some(id => ringCatIds.has(id));
        const isStackable = catIds.some(id => stackableCatIds.has(id));
        const noSquareSize = variations.length <= 1;

        const modifierListInfo = (obj.item_data && obj.item_data.modifier_list_info) || [];
        const modifierLists = modifierListInfo
          .filter(info => info.enabled !== false)
          .map(info => {
            const list = modifierListsById[info.modifier_list_id];
            if (!list || !list.modifier_list_data) return null;
            const overridesById = {};
            (info.modifier_overrides || []).forEach(ov => { overridesById[ov.modifier_id] = ov; });
            const options = (list.modifier_list_data.modifiers || []).map(m => {
              const md = m.modifier_data || {};
              const pm = md.price_money;
              const override = overridesById[m.id];
              return {
                id: m.id,
                name: md.name || 'Option',
                price: pm && pm.amount ? pm.amount / 100 : 0,
                onByDefault: override ? !!override.on_by_default : !!md.on_by_default,
              };
            });
            if (!options.length) return null;
            return { id: list.id, name: list.modifier_list_data.name || 'Options', options };
          })
          .filter(Boolean);

        variations.forEach(v => {
          const vd = v.item_variation_data || {};
          const priceMoney = vd.price_money;
          // Items set to "variable pricing" in Square (priced at the register, e.g. by
          // metal/stone combo) have no price_money at all — don't show that as a real $0.
          const hasFixedPrice = vd.pricing_type !== 'VARIABLE_PRICING' && !!(priceMoney && priceMoney.amount);
          const basePrice = hasFixedPrice ? priceMoney.amount / 100 : 0;
          // Only show the variation name when there's more than one variation to tell
          // apart — a lone variation's name is often a stray default (e.g. "Size 2")
          // with nothing to disambiguate, not a real size/option worth surfacing.
          const varName = (variations.length > 1 && vd.name && vd.name !== 'Regular') ? vd.name : '';
          rows.push({
            squareItemId: obj.id,
            squareVariationId: v.id,
            name: varName ? itemName + ' — ' + varName : itemName,
            sku: vd.sku || '',
            basePrice,
            price: basePrice,
            hasFixedPrice,
            modifierLists,
            isRing,
            isStackable,
            noSquareSize,
          });
        });
      });
      oiRenderResults(idx, rows, query);
    });
  }).catch(() => oiRenderResults(idx, [], query))
    .then(() => { if (spinner) spinner.style.display = 'none'; });
}

function oiRenderResults(idx, items, query) {
  _oiLastResults[idx] = items;
  const box = document.getElementById('oi-results-' + idx);
  if (!box) return;
  if (!items.length) {
    const safeQ = (query || '').replace(/</g, '&lt;');
    box.innerHTML = `<div class="rq-result-none">No Square match for "${safeQ}" — use Manual Item instead</div>`;
    box.style.display = 'flex';
    return;
  }
  box.innerHTML = items.map((it, i) => {
    const hasOptions = it.modifierLists && it.modifierLists.length;
    const metaParts = [];
    if (it.sku) metaParts.push('SKU ' + it.sku.replace(/</g, '&lt;'));
    if (hasOptions) metaParts.push((it.modifierLists.length === 1 ? it.modifierLists[0].options.length + ' options' : it.modifierLists.length + ' option groups'));
    return `
    <div class="rq-result-item" onclick="oiSelectSquareResult(${idx}, ${i})">
      <div><div class="rq-result-name">${(it.name || '').replace(/</g, '&lt;')}</div>
      <div class="rq-result-meta">${metaParts.join(' · ')}</div></div>
      <div class="rq-result-price">${it.hasFixedPrice ? '$' + it.price.toFixed(2) + (hasOptions ? '+' : '') : 'Variable price'}</div>
    </div>`;
  }).join('');
  box.style.display = 'flex';
}

function oiSelectSquareResult(idx, i) {
  const item = (_oiLastResults[idx] || [])[i];
  if (!item || !_oiItems[idx]) return;
  const modifierLists = item.modifierLists || [];
  const selectedModifierIds = {};
  modifierLists.forEach(list => {
    const def = list.options.find(o => o.onByDefault) || list.options[0];
    if (def) selectedModifierIds[list.id] = def.id;
  });
  const newItem = {
    type: 'square',
    name: item.name,
    sku: item.sku,
    basePrice: item.hasFixedPrice ? item.basePrice : 0,
    hasFixedPrice: !!item.hasFixedPrice,
    modifierLists,
    selectedModifierIds,
    squareItemId: item.squareItemId,
    squareVariationId: item.squareVariationId,
    isRing: !!item.isRing,
    isStackable: !!item.isStackable,
    noSquareSize: !!item.noSquareSize,
    ringSize: '',
  };
  newItem.price = item.hasFixedPrice ? _oiComputeSquarePrice(newItem) : '';
  _oiItems[idx] = newItem;
  oiRender();
}

// Sums the base variation price plus whichever modifier (metal, single/double, etc.)
// is currently selected in each modifier list attached to the item.
function _oiComputeSquarePrice(it) {
  const base = parseFloat(it.basePrice) || 0;
  const lists = it.modifierLists || [];
  const selected = it.selectedModifierIds || {};
  const modifierTotal = lists.reduce((sum, list) => {
    const optId = selected[list.id];
    const opt = list.options.find(o => o.id === optId);
    return sum + (opt ? opt.price : 0);
  }, 0);
  return base + modifierTotal;
}

function oiSetModifier(idx, listId, modifierId) {
  const it = _oiItems[idx];
  if (!it) return;
  it.selectedModifierIds = it.selectedModifierIds || {};
  it.selectedModifierIds[listId] = modifierId;
  it.price = _oiComputeSquarePrice(it);
  oiRender();
}

// ════════════════════════════════════════════

// ════════════════════════════════════════════
function syncGmail() {
  toast('Scanning Gmail for new order inquiries…', '⟳');
  safeSendPrompt('sync gmail orders');
}

// ════════════════════════════════════════════

// ════════════════════════════════════════════
// Cards are collapsed by default — this tracks which ones the user expanded.
const expandedCards   = new Set();
const completedHidden = new Set();
let   showCompleted   = false;

function markHidden(id) {
  completedHidden.add(id);
  saveToStorage();
  updateCompletedToggle();
}

function updateCompletedToggle() {
  const btn = document.getElementById('completedToggle');
  const cnt = document.getElementById('completedCount');
  if (!btn || !cnt) return;
  const n = completedHidden.size;
  cnt.textContent = n;
  btn.classList.toggle('has-items', n > 0);
  btn.innerHTML = showCompleted
    ? '<span>' + n + ' completed — Hide</span>'
    : '<span>' + n + ' completed — Show</span>';
  btn.classList.toggle('showing', showCompleted);
}

function toggleShowCompleted() {
  showCompleted = !showCompleted;
  updateCompletedToggle();
  renderKanban();
}

function toggleCard(id) {
  expandedCards.has(id) ? expandedCards.delete(id) : expandedCards.add(id);
  const card = document.getElementById('card-' + id);
  if (card) card.classList.toggle('collapsed', !expandedCards.has(id));
  syncCollapseBtn();
}

function syncCollapseBtn() {
  const btn = document.getElementById('collapseAllBtn');
  if (!btn) return;
  const allCollapsed = expandedCards.size === 0;
  btn.textContent = allCollapsed ? '⊞ Expand All' : '⊟ Collapse All';
}

function toggleCollapseAll() {
  const allCollapsed = expandedCards.size === 0;
  if (allCollapsed) { ORDERS.forEach(o => expandedCards.add(o.id)); }
  else              { expandedCards.clear();                       }
  renderKanban();
  syncCollapseBtn();
}

// ════════════════════════════════════════════

//  DRAG AND DROP
// ════════════════════════════════════════════
let draggedId = null;

function dragStart(ev, id) {
  draggedId = id;
  ev.dataTransfer.effectAllowed = 'move';
  setTimeout(() => {
    const card = document.getElementById('card-' + id);
    if (card) card.style.opacity = '0.4';
  }, 0);
}

function dragEnd(ev) {
  if (draggedId) {
    const card = document.getElementById('card-' + draggedId);
    if (card) card.style.opacity = '';
  }
  draggedId = null;
  document.querySelectorAll('.k-body').forEach(b => b.classList.remove('drag-over'));
}

function dragOver(ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  ev.currentTarget.classList.add('drag-over');
}

function dragLeave(ev) {
  ev.currentTarget.classList.remove('drag-over');
}

function applyStageChange(order, stageId) {
  order.stage = stageId;
  if (stageId === 'complete') completedHidden.add(order.id);
  if (stageId === 'contact-done' && !order.contactedAt) {
    order.contactedAt = new Date().toISOString().slice(0, 10);
  }
  updateCompletedToggle();
  renderKanban();
  // Sync stage to Notion immediately (fire-and-forget)
  if (typeof notionUpdateStage === 'function') notionUpdateStage(order.notionId, stageId);
  saveToStorage();
}

function drop(ev, stageId) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  if (!draggedId) return;
  const order = ORDERS.find(o => o.id === draggedId);
  if (order) applyStageChange(order, stageId);
  draggedId = null;
}

// ════════════════════════════════════════════

//  STAGE SHEET  (mobile tap-to-move, replaces drag-drop on touch)
// ════════════════════════════════════════════
let stageSheetOrderId = null;

function openStageSheet(id) {
  const order = ORDERS.find(o => o.id === id);
  if (!order) return;
  stageSheetOrderId = id;

  document.getElementById('stageSheetTitle').textContent = `Move "${order.name}"`;
  const body = document.getElementById('stageSheetBody');
  body.innerHTML = COLUMN_GROUPS.map(group => `
    <div class="ss-group-label">${group.label}</div>
    ${group.stages.map(stage => `
      <button class="ss-option ${order.stage === stage.id ? 'ss-current' : ''}"
              onclick="pickStageFromSheet('${stage.id}')">
        <span>${stage.label}</span>
        <span class="ss-check">✓</span>
      </button>`).join('')}
  `).join('');

  document.getElementById('stageSheetOverlay').classList.add('active');
  document.getElementById('stageSheet').classList.add('active');
}

function closeStageSheet() {
  document.getElementById('stageSheetOverlay').classList.remove('active');
  document.getElementById('stageSheet').classList.remove('active');
  stageSheetOrderId = null;
  if (typeof prodStageSheetOrderId !== 'undefined') prodStageSheetOrderId = null;
}

function pickStageFromSheet(stageId) {
  const order = ORDERS.find(o => o.id === stageSheetOrderId);
  if (order) applyStageChange(order, stageId);
  closeStageSheet();
}

function dropWithPickup(ev, stageId, location) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  if (!draggedId) return;
  const order = ORDERS.find(o => o.id === draggedId);
  if (order) {
    order.stage  = stageId;
    order.pickup = location;
    if (stageId === 'contact-done' && !order.contactedAt) {
      order.contactedAt = new Date().toISOString().slice(0, 10);
    }
    renderKanban();
    // Sync full order so pickup location is persisted in Notion
    if (typeof notionUpdateOrder === 'function') notionUpdateOrder(order);
    else if (typeof notionUpdateStage === 'function') notionUpdateStage(order.notionId, stageId);
    saveToStorage();
  }
  draggedId = null;
}

// ════════════════════════════════════════════

//  CAMERA / PHOTO
// ════════════════════════════════════════════
let currentPhotoOrderId = null;

function openCamera(orderId) {
  currentPhotoOrderId = orderId;
  const input = document.getElementById('cameraInput');
  input.value = '';
  input.click();
}

function handlePhoto(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    const order = ORDERS.find(o => o.id === currentPhotoOrderId);
    if (order) {
      order.photo = e.target.result;
      saveToStorage();
      renderKanban();
      toast('Photo saved', '📷');
    }
  };
  reader.readAsDataURL(input.files[0]);
}

function viewPhoto(orderId) {
  const order = ORDERS.find(o => o.id === orderId);
  if (!order || !order.photo) return;
  currentPhotoOrderId = orderId;
  document.getElementById('lightboxImg').src = order.photo;
  document.getElementById('lbTitle').textContent = order.name + ' — ' + order.desc;
  document.getElementById('photoLightbox').classList.add('open');
}

function closeLightbox() {
  document.getElementById('photoLightbox').classList.remove('open');
}

function retakePhoto() {
  closeLightbox();
  openCamera(currentPhotoOrderId);
}

function removePhoto() {
  const order = ORDERS.find(o => o.id === currentPhotoOrderId);
  if (order) { delete order.photo; saveToStorage(); renderKanban(); toast('Photo removed', '✓'); }
  closeLightbox();
}

// ════════════════════════════════════════════

//  MANUAL NOTION RETRY  —  tap the "⚠ unsynced" badge on a card
// ════════════════════════════════════════════
async function retrySyncOrder(id) {
  const order = ORDERS.find(o => o.id === id);
  if (!order || order.notionId) return;
  toast('Retrying Notion sync…', '⟳');

  let notionId = null, errMsg = '';
  try {
    const r = await fetch('/api/notion-pipeline', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(order),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      notionId = d.notionId || null;
      if (!notionId) errMsg = 'No notionId in response (status ' + r.status + ')';
    } else {
      errMsg = 'HTTP ' + r.status + ': ' + (d.error || JSON.stringify(d) || 'unknown error');
    }
  } catch(e) {
    errMsg = 'Network error: ' + (e && e.message ? e.message : String(e));
  }

  if (notionId) {
    order.notionId = notionId;
    saveToStorage();
    renderKanban();
    if (typeof setConnStatus === 'function') setConnStatus(true);
    toast('✓ Synced to Notion', '✓');
  } else {
    if (typeof setConnStatus === 'function') setConnStatus(false);
    console.error('retrySyncOrder failed:', errMsg);
    alert('Notion sync failed:\n\n' + errMsg);
  }
}

// ════════════════════════════════════════════

function toggleEstimateBuilder() {
  const card = document.getElementById('estimateBuilderCard');
  const btn  = document.getElementById('add-estimate-btn');
  if (!card) return;
  const visible = card.style.display !== 'none';
  card.style.display = visible ? 'none' : '';
  if (btn) btn.textContent = visible ? '💰 Add Estimate' : '✕ Hide Estimate';

  // Persist open state so re-opening the order restores it
  const editingId = document.getElementById('f-editing-id')?.value;
  if (editingId) {
    try {
      const estState = JSON.parse(localStorage.getItem('sts-est-state') || '{}');
      estState[editingId] = Object.assign(estState[editingId] || {}, { open: !visible });
      localStorage.setItem('sts-est-state', JSON.stringify(estState));
    } catch(e) {}
  }
}

//  ESTIMATE BUILDER
// ════════════════════════════════════════════
let estMultiplier = 2.5;
let estRowCount   = 0;
let estSaveTimer  = null;

function addMaterialRow(desc = '', cost = '') {
  const container = document.getElementById('est-materials');
  if (!container) return;
  const rowId = 'est-row-' + (++estRowCount);
  const div = document.createElement('div');
  div.id        = rowId;
  div.className = 'est-row';
  div.innerHTML =
    '<input class="est-input" type="text" placeholder="e.g. 14k Yellow Gold Sheet" oninput="calcEstimate()">' +
    '<button class="est-stuller-btn" title="Search Stuller catalog" onclick="StullerSearch.open(\'' + rowId + '\')">🔍</button>' +
    '<input class="est-input est-cost-input" type="number" placeholder="0.00" step="0.01" min="0" oninput="calcEstimate()">' +
    '<button class="est-remove-btn" onclick="removeMaterialRow(\'' + rowId + '\')">&#215;</button>';
  container.appendChild(div);
  const inputs = div.querySelectorAll('input');
  if (desc) inputs[0].value = desc;
  if (cost) inputs[1].value = cost;
  calcEstimate();
}

function populateEstimateFromOrder(o) {
  const container = document.getElementById('est-materials');
  if (!container) return;
  container.innerHTML = '';
  estRowCount = 0;

  const lines = (o.materials || '').split('\n').filter(l => l.trim());
  if (lines.length) {
    lines.forEach(line => {
      const match = line.match(/^(.*?) — \$(\d+\.?\d*)$/);
      if (match) addMaterialRow(match[1].trim(), match[2]);
      else        addMaterialRow(line.trim(), '');
    });
  } else {
    addMaterialRow();
  }

  // Restore labor, shipping, tax + multiplier from localStorage (not synced to Notion)
  let estState = {};
  try { estState = JSON.parse(localStorage.getItem('sts-est-state') || '{}'); } catch(e) {}
  const saved = estState[o.id] || {};
  const laborEl = document.getElementById('est-labor');
  if (laborEl) laborEl.value = saved.labor != null ? saved.labor : '';
  const shippingEl = document.getElementById('est-shipping');
  if (shippingEl) shippingEl.value = saved.shipping != null ? saved.shipping : '';
  const taxToggle = document.getElementById('est-tax-toggle');
  if (taxToggle) taxToggle.checked = saved.taxOn || false;
  setMultiplier(saved.multiplier || 2.5);

  // Auto-show/hide the builder based on whether it was open when last editing this order
  const card = document.getElementById('estimateBuilderCard');
  const btn  = document.getElementById('add-estimate-btn');
  if (card) {
    const shouldOpen = !!saved.open;
    card.style.display = shouldOpen ? '' : 'none';
    if (btn) btn.textContent = shouldOpen ? '✕ Hide Estimate' : '💰 Add Estimate';
  }
}

function removeMaterialRow(id) {
  const el = document.getElementById(id);
  if (el) { el.remove(); calcEstimate(); }
}

function calcEstimate() {
  const rows = document.querySelectorAll('#est-materials .est-row');
  let matTotal = 0;
  rows.forEach(row => { matTotal += parseFloat(row.querySelectorAll('input')[1]?.value) || 0; });
  const labor    = parseFloat(document.getElementById('est-labor')?.value) || 0;
  const shipping = parseFloat(document.getElementById('est-shipping')?.value) || 0;
  const subtotal = matTotal + labor;
  const marked   = subtotal * estMultiplier;
  const taxOn    = document.getElementById('est-tax-toggle')?.checked || false;
  const tax      = taxOn ? marked * 0.0825 : 0;
  const final    = marked + shipping + tax;
  const fmt = n => '$' + n.toFixed(2);
  const g = id => document.getElementById(id);
  if (g('est-mat-total'))     g('est-mat-total').textContent     = fmt(matTotal);
  if (g('est-labor-display')) g('est-labor-display').textContent = fmt(labor);
  if (g('est-subtotal'))      g('est-subtotal').textContent      = fmt(subtotal);
  if (g('est-final'))         g('est-final').textContent         = fmt(final);
  const shippingRow = g('est-shipping-row');
  if (shippingRow) shippingRow.style.display = shipping > 0 ? '' : 'none';
  if (g('est-shipping-display')) g('est-shipping-display').textContent = fmt(shipping);
  const taxRow = g('est-tax-row');
  if (taxRow) taxRow.style.display = taxOn ? '' : 'none';
  if (g('est-tax-display')) g('est-tax-display').textContent = fmt(tax);

  // Auto-save to Notion when editing an existing order
  const editingId = document.getElementById('f-editing-id')?.value;
  if (editingId) {
    clearTimeout(estSaveTimer);
    estSaveTimer = setTimeout(saveEstimateToNotion, 1400);
  }
}

async function saveEstimateToNotion() {
  const editingId = document.getElementById('f-editing-id')?.value;
  if (!editingId) return;
  const o = ORDERS.find(x => x.id === editingId);
  if (!o || !o.notionId) return;

  // Build materials text from rows
  const rows = document.querySelectorAll('#est-materials .est-row');
  const lines = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc = inputs[0]?.value.trim();
    const cost = parseFloat(inputs[1]?.value) || 0;
    if (desc || cost) lines.push(desc + (cost ? ' — $' + cost.toFixed(2) : ''));
  });
  const materialsText = lines.join('\n');
  const finalEl = document.getElementById('est-final');
  const finalPrice = parseFloat(finalEl?.textContent?.replace('$', '')) || 0;

  o.materials = materialsText;
  if (finalPrice > 0) o.price = finalPrice;
  saveToStorage();

  // Persist labor, shipping, tax + multiplier locally so they survive a page refresh
  try {
    const estState = JSON.parse(localStorage.getItem('sts-est-state') || '{}');
    estState[editingId] = {
      labor:      parseFloat(document.getElementById('est-labor')?.value) || 0,
      shipping:   parseFloat(document.getElementById('est-shipping')?.value) || 0,
      taxOn:      document.getElementById('est-tax-toggle')?.checked || false,
      multiplier: estMultiplier,
    };
    localStorage.setItem('sts-est-state', JSON.stringify(estState));
  } catch(e) {}

  const statusEl = document.getElementById('est-save-status');
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.opacity = '1'; }
  try {
    await notionUpdateOrder(o);
    if (statusEl) {
      statusEl.textContent = '✓ Saved to Notion';
      setTimeout(() => { statusEl.style.opacity = '0'; }, 2000);
    }
  } catch(e) {
    console.warn('estimate auto-save failed', e);
    if (statusEl) { statusEl.textContent = '⚠ Save failed'; }
  }
}

function setMultiplier(val) {
  estMultiplier = val;
  document.querySelectorAll('.mult-btn').forEach(b => b.classList.remove('selected'));
  const btn = document.getElementById('mult-' + String(val).replace('.', '-'));
  if (btn) btn.classList.add('selected');
  const hint = document.getElementById('est-formula-hint');
  if (hint) hint.textContent = '(Materials + Labor) × ' + val;
  calcEstimate();
}

function approveEstimate() {
  const customerEmail = document.getElementById('f-email')?.value.trim() || '';
  const customerName  = getFullName() || 'Customer';
  const jobDesc = jdGetJobDescValue();
  const notes   = document.getElementById('f-customer-notes')?.value.trim() || '';

  if (!customerEmail) { toast('Add a customer email first.', '⚠️'); return; }
  if (!_gtSqLocation()) { toast('No Square Location ID — add it in ⚙ Integrations.', '⚠️'); return; }

  // Collect line items from the estimate builder
  const items = [];
  document.querySelectorAll('#est-materials .est-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const desc   = inputs[0]?.value.trim() || '';
    const cost   = parseFloat(inputs[1]?.value) || 0;
    if (desc && cost > 0) items.push({ name: desc, price: cost });
  });

  const labor    = parseFloat(document.getElementById('est-labor')?.value)    || 0;
  const shipping = parseFloat(document.getElementById('est-shipping')?.value) || 0;
  if (labor    > 0) items.push({ name: 'Labor',    price: labor });
  if (shipping > 0) items.push({ name: 'Shipping', price: shipping });

  if (!items.length) { toast('Add at least one material or labor cost.', '⚠️'); return; }

  const btn = document.querySelector('#estimateBuilderCard .btn-green');
  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }

  const reset = () => { if (btn) { btn.textContent = '✓ Approve & Send to Square'; btn.disabled = false; } };

  _gtSqCall('/v2/customers/search', 'POST', {
    query: { filter: { email_address: { exact: customerEmail } } }
  })
  .then(d => {
    if (d.customers && d.customers.length) return d.customers[0].id;
    const parts = customerName.split(' ');
    return _gtSqCall('/v2/customers', 'POST', {
      idempotency_key: 'sts-cust-' + customerEmail.replace(/\W/g, '') + Date.now(),
      given_name:    parts[0] || customerName,
      family_name:   parts.slice(1).join(' ') || '',
      email_address: customerEmail
    }).then(d2 => {
      if (d2.customer) return d2.customer.id;
      throw new Error(((d2.errors || [])[0] || {}).detail || 'Could not create customer');
    });
  })
  .then(customerId => {
    return _gtSqCall('/v2/orders', 'POST', {
      idempotency_key: 'sts-ord-est-' + Date.now(),
      order: {
        location_id: _gtSqLocation(),
        customer_id: customerId,
        line_items:  items.map(item => ({
          name: item.name,
          quantity: '1',
          base_price_money: { amount: Math.round(item.price * 100), currency: 'USD' }
        }))
      }
    }).then(d3 => {
      if (d3.order) return { customerId, orderId: d3.order.id };
      throw new Error(((d3.errors || [])[0] || {}).detail || 'Could not create order');
    });
  })
  .then(ids => {
    const title   = jobDesc ? jobDesc : 'Custom Order Estimate — ' + customerName;
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const invoice = {
      location_id:       _gtSqLocation(),
      order_id:          ids.orderId,
      primary_recipient: { customer_id: ids.customerId },
      delivery_method:   'SHARE_MANUALLY',
      title:             title,
      payment_requests:  [{ request_type: 'BALANCE', due_date: dueDate, automatic_payment_source: 'NONE' }],
      accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false },
    };
    if (notes) invoice.description = notes;
    return _gtSqCall('/v2/invoices', 'POST', {
      idempotency_key: 'sts-inv-est-' + Date.now(),
      invoice
    });
  })
  .then(d4 => {
    reset();
    if (d4.invoice) {
      const url = 'https://squareup.com/dashboard/invoices/' + d4.invoice.id;
      toast('Estimate draft created! <a href="' + url + '" target="_blank" style="color:inherit;text-decoration:underline;">Review in Square →</a>', '✅', 8000);
    } else {
      throw new Error(((d4.errors || [])[0] || {}).detail || 'Estimate creation failed');
    }
  })
  .catch(e => {
    reset();
    toast('Square error: ' + (e.message || 'Unknown error'), '⚠️', 6000);
  });
}

function clearEstimate() {
  const container = document.getElementById('est-materials');
  if (container) container.innerHTML = '';
  estRowCount = 0;
  const laborEl = document.getElementById('est-labor');
  if (laborEl) laborEl.value = '';
  const shippingEl = document.getElementById('est-shipping');
  if (shippingEl) shippingEl.value = '';
  const taxToggle = document.getElementById('est-tax-toggle');
  if (taxToggle) taxToggle.checked = false;
  calcEstimate();
  addMaterialRow();
}

function printOrder(id) {
  const o = ORDERS.find(x => x.id === id);
  if (!o) return;
  const sa = o.shippingAddress;
  const addrLine = sa
    ? [sa.street, sa.street2].filter(Boolean).join('\n')
    : (o.address || '');
  const p = new URLSearchParams({
    name:      o.name        || '',
    email:     o.email       || '',
    phone:     o.phone       || '',
    address:   addrLine,
    city:      sa ? (sa.city    || '') : '',
    state:     sa ? (sa.state   || '') : '',
    zip:       sa ? (sa.zip     || '') : '',
    desc:      oiPrintDescription(o),
    notes:     o.notes       || '',
    materials: o.materials   || '',
    takeIn:    o.takeIn      || '',
    deadline:  o.deadline    || '',
    price:     o.price       || '',
    deposit:   o.deposit     || '',
    shipping:  o.shipping    || '',
    ringSize:  o.ringSize    || '',
    pickup:    o.pickup      || '',
    source:    o.contactSource || '',
    stage:     o.stage       || '',
    items:     JSON.stringify((o.items || []).filter(it => it.name).map(it => ({ desc: oiPrintLabel(it), amount: (parseFloat(it.price) || 0) * (parseInt(it.quantity, 10) || 1) }))),
  });
  // Append print layout settings from localStorage
  try {
    const ps = Object.assign(
      { jobDescSize:'small', notesSize:'medium', liRows:4, fontSize:'medium', showSizeRow:true },
      JSON.parse(localStorage.getItem('workOrderPrintSettings') || '{}')
    );
    p.set('jd',      ps.jobDescSize);
    p.set('ns',      ps.notesSize);
    p.set('liRows',  ps.liRows);
    p.set('font',    ps.fontSize);
    p.set('sizeRow', ps.showSizeRow ? '1' : '0');
  } catch(e) {}
  window.open('work-order-print.html?' + p.toString(), '_blank');
}

// ════════════════════════════════════════════

//  INVOICE FROM ORDER CARD
// ════════════════════════════════════════════
function eoShowInvoice() {
  const id = document.getElementById('f-editing-id').value;
  const o  = ORDERS.find(x => x.id === id);
  const compose = document.getElementById('eo-invoice-compose');

  const defaultDue = (typeof _gtInvDefaultDue === 'function') ? _gtInvDefaultDue() : (() => {
    const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0];
  })();

  compose.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:10px;">📋 Square Invoice / Estimate</div>
    <div class="gt-inv-type-row">
      <button class="gt-inv-type-btn active" data-type="invoice"  onclick="eoInvSetType(this)">📋 Invoice</button>
      <button class="gt-inv-type-btn"        data-type="estimate" onclick="eoInvSetType(this)">📄 Estimate</button>
    </div>
    <div id="eo-inv-items" class="gt-inv-items">
      <div class="gt-inv-item-row">
        <input class="gt-inv-desc"  type="text"   placeholder="Item description">
        <input class="gt-inv-price" type="number" placeholder="0.00" min="0" step="0.01">
        <button class="gt-inv-rm" onclick="eoInvRemoveItem(this)">−</button>
      </div>
    </div>
    <button class="gt-inv-add-btn" onclick="eoInvAddItem()">+ Add item</button>
    <div class="gt-inv-fields">
      <label>Title <input class="gt-inv-title" id="eo-inv-title" type="text" placeholder="e.g. Custom Ring — Balance Due"></label>
      <label><span id="eo-inv-due-label">Due date</span> <input class="gt-inv-due" id="eo-inv-due" type="date" value="${defaultDue}"></label>
      <label>Note <input class="gt-inv-note" id="eo-inv-note" type="text" placeholder="Optional note…"></label>
    </div>
    <div class="gt-inv-foot">
      <button class="btn btn-gold btn-sm" id="eo-inv-submit-btn" onclick="eoSubmitInvoice()">Create Draft</button>
      <button class="btn btn-ghost btn-sm" onclick="eoCancelInvoice()">Cancel</button>
      <span id="eo-inv-status" class="gt-inv-status"></span>
    </div>`;

  const firstRow = compose.querySelector('.gt-inv-item-row');
  if (firstRow && o) {
    firstRow.querySelector('.gt-inv-desc').value  = o.desc  ? o.desc.slice(0, 80) : '';
    firstRow.querySelector('.gt-inv-price').value = o.price ? o.price : '';
  }

  compose.style.display = '';
}

function eoCancelInvoice() {
  const compose = document.getElementById('eo-invoice-compose');
  compose.style.display = 'none';
  compose.innerHTML = '';
}

function eoInvSetType(btn) {
  btn.closest('.gt-inv-type-row').querySelectorAll('.gt-inv-type-btn')
    .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const lbl = document.getElementById('eo-inv-due-label');
  if (lbl) lbl.textContent = btn.dataset.type === 'estimate' ? 'Valid until' : 'Due date';
}

function eoInvAddItem() {
  const items = document.getElementById('eo-inv-items');
  const row = document.createElement('div');
  row.className = 'gt-inv-item-row';
  row.innerHTML = '<input class="gt-inv-desc" type="text" placeholder="Item description">' +
    '<input class="gt-inv-price" type="number" placeholder="0.00" min="0" step="0.01">' +
    '<button class="gt-inv-rm" onclick="eoInvRemoveItem(this)">−</button>';
  items.appendChild(row);
  row.querySelector('.gt-inv-desc').focus();
}

function eoInvRemoveItem(btn) {
  const row  = btn.closest('.gt-inv-item-row');
  const list = row.parentNode;
  if (list.querySelectorAll('.gt-inv-item-row').length > 1) row.remove();
}

function eoSubmitInvoice() {
  const compose = document.getElementById('eo-invoice-compose');
  const status  = document.getElementById('eo-inv-status');
  const btn     = document.getElementById('eo-inv-submit-btn');

  const customerEmail = document.getElementById('f-email').value.trim();
  const customerName  = getFullName();

  if (!customerEmail) { status.textContent = 'No email — add one in the Email field above.'; return; }
  if (!_gtSqLocation()) { status.textContent = 'No Square Location ID — add it in ⚙ Integrations.'; return; }

  const items = [];
  compose.querySelectorAll('.gt-inv-item-row').forEach(row => {
    const desc  = row.querySelector('.gt-inv-desc').value.trim();
    const price = parseFloat(row.querySelector('.gt-inv-price').value) || 0;
    if (desc && price > 0) items.push({ name: desc, price });
  });
  if (!items.length) { status.textContent = 'Add at least one item with a price.'; return; }

  const activeTypeBtn = compose.querySelector('.gt-inv-type-btn.active');
  const invType  = (activeTypeBtn && activeTypeBtn.dataset.type === 'estimate') ? 'ESTIMATE' : 'INVOICE';
  const dueDate  = document.getElementById('eo-inv-due').value || _gtInvDefaultDue();
  const title    = document.getElementById('eo-inv-title').value.trim();
  const note     = document.getElementById('eo-inv-note').value.trim();

  btn.textContent = 'Creating…';
  btn.disabled    = true;
  status.textContent = '';

  _gtSqCall('/v2/customers/search', 'POST', {
    query: { filter: { email_address: { exact: customerEmail } } }
  })
  .then(d => {
    if (d.customers && d.customers.length) return d.customers[0].id;
    const parts = customerName.split(' ');
    return _gtSqCall('/v2/customers', 'POST', {
      idempotency_key: 'sts-cust-' + customerEmail.replace(/\W/g, '') + Date.now(),
      given_name:    parts[0] || customerName,
      family_name:   parts.slice(1).join(' ') || '',
      email_address: customerEmail
    }).then(d2 => {
      if (d2.customer) return d2.customer.id;
      throw new Error(((d2.errors || [])[0] || {}).detail || 'Could not create customer');
    });
  })
  .then(customerId => {
    return _gtSqCall('/v2/orders', 'POST', {
      idempotency_key: 'sts-ord-' + Date.now(),
      order: {
        location_id: _gtSqLocation(),
        customer_id: customerId,
        line_items:  items.map(item => ({
          name: item.name,
          quantity: '1',
          base_price_money: { amount: Math.round(item.price * 100), currency: 'USD' }
        }))
      }
    }).then(d3 => {
      if (d3.order) return { customerId, orderId: d3.order.id };
      throw new Error(((d3.errors || [])[0] || {}).detail || 'Could not create order');
    });
  })
  .then(ids => {
    return _gtSqCall('/v2/invoices', 'POST', {
      idempotency_key: 'sts-inv-' + Date.now(),
      invoice: Object.assign({
        location_id:       _gtSqLocation(),
        order_id:          ids.orderId,
        primary_recipient: { customer_id: ids.customerId },
        delivery_method:   'EMAIL',
        ...(title ? { title: title } : {}),
        ...(note  ? { description: note } : {}),
        accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false }
      }, invType === 'INVOICE' ? {
        payment_requests: [{ request_type: 'BALANCE', due_date: dueDate, automatic_payment_source: 'NONE' }]
      } : {})
    });
  })
  .then(d4 => {
    if (d4.invoice) {
      const inv      = d4.invoice;
      const url      = 'https://squareup.com/dashboard/invoices/' + inv.id;
      const typeWord = invType === 'ESTIMATE' ? 'estimate' : 'invoice';
      compose.innerHTML = '<div class="gt-inv-success" style="padding:10px 0;">✓ Draft ' + typeWord + ' created — ' +
        '<a href="' + url + '" target="_blank" class="gt-inv-link">Review in Square →</a>' +
        ' <button class="btn btn-gold btn-sm" id="eo-inv-send-btn" style="margin-left:8px;" onclick="this.disabled=true;_gtSqPublishInvoice(\'' + inv.id + '\',' + inv.version + ',document.getElementById(\'eo-inv-send-status\'))">▶ Send Now</button>' +
        ' <span id="eo-inv-send-status" style="font-size:12px;margin-left:6px;"></span>' +
        '</div>';
    } else {
      throw new Error(((d4.errors || [])[0] || {}).detail || 'Invoice creation failed');
    }
  })
  .catch(e => {
    btn.textContent    = 'Create Draft';
    btn.disabled       = false;
    status.textContent = '⚠ ' + (e.message || 'Unknown error');
  });
}

// Always start with cards fully collapsed.
expandedCards.clear();
renderKanban();
syncCollapseBtn();
