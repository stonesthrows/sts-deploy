// ════════════════════════════════════════════
//  ORDERS  —  pages/orders.js
//  Kanban board, new order form, estimate builder, drag-drop, camera
// ════════════════════════════════════════════

// ════════════════════════════════════════════
function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = '';

  COLUMN_GROUPS.forEach(group => {
    const col = document.createElement('div');
    col.className = `k-col ${group.cls}`;

    const allStageIds = group.stages.map(s => s.id);
    const allCards    = ORDERS.filter(o =>
      allStageIds.includes(o.stage) &&
      (showCompleted || !completedHidden.has(o.id))
    );
    const totalCount = allCards.length;

    if (group.pickupSections) {
      // ── Ready for Pickup: sub-sections by pickup location ──
      const subsHTML = PICKUP_LOCATIONS.map(loc => {
        const locCards = allCards.filter(o => o.pickup === loc);
        const stageId  = group.stages[0].id;
        return `
          <div class="k-sub-wrap s-pickup-sub">
            <div class="k-sub-head">📍 ${loc}<span class="k-sub-count">${locCards.length}</span></div>
            <div class="k-body"
                 ondragover="dragOver(event)"
                 ondragleave="dragLeave(event)"
                 ondrop="dropWithPickup(event,'${stageId}','${loc.replace(/'/g,"\\'")}')">
              ${locCards.length ? locCards.map(cardHTML).join('') : '<div class="k-empty">Drop here</div>'}
            </div>
          </div>`;
      }).join('');

      // Cards with no / unrecognized pickup location
      const unassigned = allCards.filter(o => !PICKUP_LOCATIONS.includes(o.pickup));
      const unassignedHTML = unassigned.length ? `
          <div class="k-sub-wrap s-pickup-sub">
            <div class="k-sub-head">📍 Unassigned<span class="k-sub-count">${unassigned.length}</span></div>
            <div class="k-body"
                 ondragover="dragOver(event)"
                 ondragleave="dragLeave(event)"
                 ondrop="drop(event,'${group.stages[0].id}')">
              ${unassigned.map(cardHTML).join('')}
            </div>
          </div>` : '';

      col.innerHTML = `
        <div class="k-head">
          <span>${group.label}</span>
          <span class="k-count">${totalCount}</span>
        </div>
        ${subsHTML}${unassignedHTML}`;

    } else if (group.stages.length > 1) {
      // ── Multi-stage grouped column ──
      const subsHTML = group.stages.map(stage => {
        const stageCards = allCards.filter(o => o.stage === stage.id);
        return `
          <div class="k-sub-wrap ${stage.cls}">
            <div class="k-sub-head">${stage.label}<span class="k-sub-count">${stageCards.length}</span></div>
            <div class="k-body"
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
             ondragover="dragOver(event)"
             ondragleave="dragLeave(event)"
             ondrop="drop(event,'${stageId}')">
          ${allCards.length ? allCards.map(cardHTML).join('') : '<div class="k-empty">Drop here</div>'}
        </div>`;
    }

    board.appendChild(col);
  });

  // Only count orders that are NOT completed
  const activeOrders = ORDERS.filter(o => o.stage !== 'complete' && o.stage !== 'delivered');
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
  return `
    <div class="o-card"
         id="card-${o.id}"
         draggable="true"
         ondragstart="dragStart(event,'${o.id}')"
         ondragend="dragEnd(event)"
         onclick="openOrderCard('${o.id}')">
      <div class="o-card-header">
        <div class="o-name">${o.name}</div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
          <button class="card-camera-btn ${hasPhoto ? 'has-photo' : ''}"
                  title="${hasPhoto ? 'View / replace photo' : 'Attach work order photo'}"
                  onclick="event.stopPropagation(); openCamera('${o.id}')">📷</button>
          <button class="card-print-btn"
                  title="Print work order"
                  onclick="event.stopPropagation(); printOrder('${o.id}')">🖨</button>
          <span class="o-chevron"
                title="Expand / Collapse"
                onclick="event.stopPropagation(); toggleCard('${o.id}')">▾</span>
        </div>
      </div>
      <div class="o-body">
        ${hasPhoto ? `
          <div class="card-photo" onclick="event.stopPropagation(); viewPhoto('${o.id}')">
            <img src="${o.photo}" alt="Work order bag">
            <div class="card-photo-label">📷 Tap to view full size</div>
          </div>` : ''}
        <div class="o-desc">${o.desc}</div>
        ${(o.pickup || o.contactSource) ? `
        <div class="o-badges">
          ${o.pickup        ? `<span class="o-badge pickup">📍 ${o.pickup}</span>` : ''}
          ${o.contactSource ? `<span class="o-badge source">💬 ${o.contactSource}</span>` : ''}
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

  document.getElementById('eo-id').value        = o.id;
  document.getElementById('eo-name').value      = o.name       || '';
  document.getElementById('eo-desc').value      = o.desc       || '';
  document.getElementById('eo-stage').value     = o.stage      || 'intake-custom';
  document.getElementById('eo-price').value     = o.price      || '';
  document.getElementById('eo-deadline').value  = o.deadline   || '';
  document.getElementById('eo-pickup').value    = o.pickup     || '';
  document.getElementById('eo-email').value     = o.email      || '';
  document.getElementById('eo-phone').value     = o.phone      || '';
  document.getElementById('eo-source').value     = o.contactSource || '';
  document.getElementById('eo-materials').value  = o.materials     || '';
  document.getElementById('eo-ring-size').value  = o.ringSize      || '';
  document.getElementById('eo-paid-by').value    = o.paidBy        || '';
  document.getElementById('eo-notes').value      = o.notes         || '';
  document.getElementById('eo-sketch').value     = o.sketchDesc    || '';
  document.getElementById('eo-address').value    = o.address       || '';
  toggleShippingAddress();

  document.getElementById('editOrderModalBg').classList.add('open');
}

function toggleShippingAddress() {
  const pickup = document.getElementById('eo-pickup').value;
  const wrap   = document.getElementById('eo-shipping-wrap');
  if (wrap) wrap.style.display = pickup === 'To be Shipped' ? 'block' : 'none';
}

function closeEditOrderModal() {
  document.getElementById('editOrderModalBg').classList.remove('open');
}

function markOrderComplete() {
  const id = document.getElementById('eo-id').value;
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

  // Sync stage to Notion
  if (typeof notionUpdateStage === 'function') notionUpdateStage(o.notionId, 'complete');

  saveToStorage();
  toast(`${o.name} completed — $${finalPrice.toLocaleString()} ✓`, '✓');
}

function saveOrderEdit() {
  const id = document.getElementById('eo-id').value;
  const o  = ORDERS.find(x => x.id === id);
  if (!o) return;

  const newStage = document.getElementById('eo-stage').value;

  o.name          = document.getElementById('eo-name').value.trim();
  o.desc          = document.getElementById('eo-desc').value.trim();
  o.stage         = newStage;
  o.price         = parseFloat(document.getElementById('eo-price').value) || 0;
  o.deadline      = document.getElementById('eo-deadline').value || null;
  o.pickup        = document.getElementById('eo-pickup').value   || null;
  o.email         = document.getElementById('eo-email').value.trim();
  o.phone         = document.getElementById('eo-phone').value.trim();
  o.contactSource = document.getElementById('eo-source').value    || null;
  o.materials     = document.getElementById('eo-materials').value.trim() || '';
  o.ringSize      = document.getElementById('eo-ring-size').value.trim() || '';
  o.paidBy        = document.getElementById('eo-paid-by').value          || '';
  o.notes         = document.getElementById('eo-notes').value.trim()     || '';
  o.sketchDesc    = document.getElementById('eo-sketch').value.trim()    || '';
  o.address       = document.getElementById('eo-address').value.trim()   || '';

  updateCompletedToggle();
  renderKanban();
  closeEditOrderModal();

  // Sync full order to Notion
  if (typeof notionUpdateOrder === 'function') notionUpdateOrder(o);

  saveToStorage();
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
  if (t.name) document.getElementById('f-name').value  = t.name;
  if (t.email) document.getElementById('f-email').value = t.email;
  closeGmailPanel();
  switchTab('new-order', document.querySelector('.sub-nav-tab[data-tab=new-order]'));
  toast('Customer info filled from Gmail thread');
}

// ════════════════════════════════════════════

//  ORDER TYPE TOGGLE
// ════════════════════════════════════════════
let orderType = 'order'; // 'order' | 'estimate' | 'repair'

function setOrderType(type) {
  orderType = type;
  const btnOrder    = document.getElementById('ot-order');
  const btnEstimate = document.getElementById('ot-estimate');
  const btnRepair   = document.getElementById('ot-repair');
  const hint        = document.getElementById('ot-hint');

  // Clear all selections
  btnOrder.classList.remove('selected');
  btnEstimate.classList.remove('selected');
  btnRepair.classList.remove('selected');

  if (type === 'estimate') {
    btnEstimate.classList.add('selected');
    hint.innerHTML = 'Will be placed in <strong>Estimate Intake</strong>.';
    hint.className = 'ot-hint estimate';
  } else if (type === 'repair') {
    btnRepair.classList.add('selected');
    hint.innerHTML = 'Will be placed in <strong>Repair Intake</strong>.';
    hint.className = 'ot-hint repair';
  } else {
    btnOrder.classList.add('selected');
    hint.innerHTML = 'Will be placed in <strong>Custom Intake</strong>.';
    hint.className = 'ot-hint';
  }
}

// ════════════════════════════════════════════

//  NEW ORDER FORM
// ════════════════════════════════════════════
function submitOrder() {
  const name  = document.getElementById('f-name').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const desc  = document.getElementById('f-description').value.trim();
  if (!name || !desc) {
    toast('Please fill in Name and Description', '⚠');
    // Highlight missing fields
    ['f-name','f-description'].forEach(id => {
      const el = document.getElementById(id);
      if (!el.value.trim()) {
        el.style.borderColor = '#E05050';
        el.addEventListener('input', () => el.style.borderColor = '', { once: true });
      }
    });
    return;
  }

  const price      = parseFloat(document.getElementById('f-price').value) || 0;
  const deadline   = document.getElementById('f-deadline').value || null;
  const takeIn        = document.getElementById('f-takein').value || null;
  const pickup        = document.getElementById('f-pickup').value || null;
  const contactSource = document.getElementById('f-source').value || null;
  const newId      = 'u' + Date.now();
  const stage      = orderType === 'estimate' ? 'needs-est' : orderType === 'repair' ? 'intake-repair' : 'intake-custom';
  const stageLabel = orderType === 'estimate' ? 'Estimate Intake' : orderType === 'repair' ? 'Repair Intake' : 'Custom Intake';

  // ── Add to local ORDERS ──────────────────
  ORDERS.push({
    id:        newId,
    name:      name,
    desc:      desc,
    stage:     stage,
    deadline:  deadline,
    price:     price,
    notionId:  null,
    email:     email,
    phone:     document.getElementById('f-phone').value.trim(),
    takeIn:        takeIn,
    pickup:        pickup,
    contactSource: contactSource,
    orderType:     orderType,
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
      }
    });
  }
}


function clearForm() {
  ['f-name','f-email','f-phone','f-takein','f-deadline','f-description','f-materials','f-price','f-notes']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.style.borderColor = ''; }
    });
  const pickup = document.getElementById('f-pickup');
  if (pickup) pickup.value = '';
  const source = document.getElementById('f-source');
  if (source) source.value = '';
  setOrderType('order');
}

// ════════════════════════════════════════════

// ════════════════════════════════════════════
function syncGmail() {
  toast('Scanning Gmail for new order inquiries…', '⟳');
  safeSendPrompt('sync gmail orders');
}

// ════════════════════════════════════════════

// ════════════════════════════════════════════
const collapsedCards  = new Set();
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
  collapsedCards.has(id) ? collapsedCards.delete(id) : collapsedCards.add(id);
  const card = document.getElementById('card-' + id);
  if (card) card.classList.toggle('collapsed', collapsedCards.has(id));
  syncCollapseBtn();
}

function syncCollapseBtn() {
  const btn = document.getElementById('collapseAllBtn');
  if (!btn) return;
  const allCollapsed = ORDERS.length > 0 && ORDERS.every(o => collapsedCards.has(o.id));
  btn.textContent = allCollapsed ? '⊞ Expand All' : '⊟ Collapse All';
}

function toggleCollapseAll() {
  const allCollapsed = ORDERS.every(o => collapsedCards.has(o.id));
  if (allCollapsed) { ORDERS.forEach(o => collapsedCards.delete(o.id)); }
  else              { ORDERS.forEach(o => collapsedCards.add(o.id));    }
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

function drop(ev, stageId) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  if (!draggedId) return;
  const order = ORDERS.find(o => o.id === draggedId);
  if (order) {
    order.stage = stageId;
    if (stageId === 'complete') completedHidden.add(order.id);
    updateCompletedToggle();
    renderKanban();
    // Sync stage to Notion immediately (fire-and-forget)
    if (typeof notionUpdateStage === 'function') notionUpdateStage(order.notionId, stageId);
    const stageLabel = (STAGES.find(s => s.id === stageId) || {}).label || stageId;
    saveToStorage();
  }
  draggedId = null;
}

function dropWithPickup(ev, stageId, location) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  if (!draggedId) return;
  const order = ORDERS.find(o => o.id === draggedId);
  if (order) {
    order.stage  = stageId;
    order.pickup = location;
    renderKanban();
    // Sync stage to Notion immediately (fire-and-forget)
    if (typeof notionUpdateStage === 'function') notionUpdateStage(order.notionId, stageId);
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

//  ESTIMATE BUILDER
// ════════════════════════════════════════════
let estMultiplier = 2.5;
let estRowCount   = 0;

function addMaterialRow() {
  const container = document.getElementById('est-materials');
  if (!container) return;
  const rowId = 'est-row-' + (++estRowCount);
  const div = document.createElement('div');
  div.id        = rowId;
  div.className = 'est-row';
  div.innerHTML =
    '<div class="fg" style="flex:1"><input type="text" placeholder="e.g. 14k Yellow Gold Sheet" oninput="calcEstimate()"></div>' +
    '<div class="fg" style="width:110px"><input type="number" placeholder="0.00" step="0.01" min="0" oninput="calcEstimate()"></div>' +
    '<button class="btn btn-ghost btn-sm" style="align-self:flex-end;margin-bottom:1px;" onclick="removeMaterialRow(\'' + rowId + '\')">&#215;</button>';
  container.appendChild(div);
  calcEstimate();
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
  const subtotal = matTotal + labor;
  const final    = subtotal * estMultiplier;
  const fmt = n => '$' + n.toFixed(2);
  const g = id => document.getElementById(id);
  if (g('est-mat-total'))     g('est-mat-total').textContent     = fmt(matTotal);
  if (g('est-labor-display')) g('est-labor-display').textContent = fmt(labor);
  if (g('est-subtotal'))      g('est-subtotal').textContent      = fmt(subtotal);
  if (g('est-final'))         g('est-final').textContent         = fmt(final);
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
  const name  = document.getElementById('f-name')?.value.trim() || 'Customer';
  const final = document.getElementById('est-final')?.textContent || '$0.00';
  safeSendPrompt('create Square estimate draft for ' + name + ': ' + final + ' — send for review');
  toast('Sending estimate to Square…', '💰');
}

function clearEstimate() {
  const container = document.getElementById('est-materials');
  if (container) container.innerHTML = '';
  estRowCount = 0;
  const laborEl = document.getElementById('est-labor');
  if (laborEl) laborEl.value = '';
  calcEstimate();
  addMaterialRow();
}

function printOrder(id) {
  const o = ORDERS.find(x => x.id === id);
  if (!o) return;
  const p = new URLSearchParams({
    name:      o.name        || '',
    email:     o.email       || '',
    phone:     o.phone       || '',
    address:   o.address     || '',
    desc:      o.desc        || '',
    notes:     o.notes       || '',
    materials: o.materials   || '',
    takeIn:    o.takeIn      || '',
    deadline:  o.deadline    || '',
    price:     o.price       || '',
    deposit:   o.deposit     || '',
    pickup:    o.pickup      || '',
    source:    o.contactSource || '',
    stage:     o.stage       || ''
  });
  window.open('work-order-print.html?' + p.toString(), '_blank');
}

// Always start with cards fully expanded.
collapsedCards.clear();
renderKanban();
syncCollapseBtn();
