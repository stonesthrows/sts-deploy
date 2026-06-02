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
  document.getElementById('eo-source').value    = o.contactSource || '';

  document.getElementById('editOrderModalBg').classList.add('open');
}

function closeEditOrderModal() {
  document.getElementById('editOrderModalBg').classList.remove('open');
}

function markOrderComplete() {
  const id = document.getElementById('eo-id').value;
  const o  = ORDERS.find(x => x.id === id);
  if (!o) return;
  o.stage = 'complete';
  completedHidden.add(o.id);

  // Persist to completed registry so no sync can ever re-add this order
  try {
    const reg = JSON.parse(localStorage.getItem('sts-completed-registry') || '[]');
    const entry = { id: o.id, notionId: o.notionId || null, name: (o.name || '').toLowerCase().trim() };
    if (!reg.some(r => r.id === entry.id)) reg.push(entry);
    localStorage.setItem('sts-completed-registry', JSON.stringify(reg));
  } catch(e) {}

  saveToStorage();
  updateCompletedToggle();
  renderKanban();
  closeEditOrderModal();
  toast('Order marked completed ✓', '✓');
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
  o.contactSource = document.getElementById('eo-source').value  || null;

  saveToStorage();
  updateCompletedToggle();
  renderKanban();
  closeEditOrderModal();
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
    hint.innerHTML = 'Will be placed in <strong>Needs Estimate</strong>.';
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
  const stageLabel = orderType === 'estimate' ? 'Needs Estimate' : orderType === 'repair' ? 'Repair Intake' : 'Custom Intake';

  // ── Add to local ORDERS ──────────────────
  ORDERS.push({
    id:        newId,
    name:      name,
    desc:      desc,
    stage:     stage,
    deadline:  deadline,
    price:     price,
    clickup:   'pending',
    email:     email,
    phone:     document.getElementById('f-phone').value.trim(),
    takeIn:        takeIn,
    pickup:        pickup,
    contactSource: contactSource,
    orderType:     orderType,
  });

  // ── Add or update CUSTOMERS ──────────────
  const existing = CUSTOMERS.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.totalOrders += 1;
    existing.totalValue  += price;
    existing.lastContact  = new Date().toISOString().slice(0,10);
    existing.activeOrders = (existing.activeOrders || 0) + 1;
  } else {
    CUSTOMERS.unshift({
      name,
      email,
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

  // ── Sync to ClickUp + Notion if in Claude ──
  safeSendPrompt('create order: ' + JSON.stringify({
    name, email,
    phone:       document.getElementById('f-phone')?.value?.trim(),
    description: desc,
    materials:   document.getElementById('f-materials').value.trim(),
    price,
    deadline,
    takeIn,
    pickup,
    contactSource,
    orderType,
    notes:       document.getElementById('f-notes').value.trim(),
    clickup_list:  '901416911135',
    notion_db:     'edee1ecc-7d11-428a-9efc-d17b8cbf195d',
  }));
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
    saveToStorage();
    updateCompletedToggle();
    renderKanban();
  }
  draggedId = null;
}

function dropWithPickup(ev, stageId, location) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  if (!draggedId) return;
  const order = ORDERS.find(o => o.id === draggedId);
  if (order) { order.stage = stageId; order.pickup = location; saveToStorage(); renderKanban(); }
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

// ════════════════════════════════════════════

// ════════════════════════════════════════════

//  SCAN WORK ORDER BAG  (Claude Vision)
// ════════════════════════════════════════════

let _pendingScanData = null; // holds parsed result until user confirms

function scanWorkOrderBag() {
  const key = localStorage.getItem('sts-anthropic-key') || '';
  if (!key) {
    document.getElementById('apiKeyModalBg').classList.add('open');
    return;
  }
  document.getElementById('scanBagInput').value = '';
  document.getElementById('scanBagInput').click();
}

function closeApiKeyModal() {
  document.getElementById('apiKeyModalBg').classList.remove('open');
  document.getElementById('apiKeyInput').value = '';
}

function saveApiKeyAndScan() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key.startsWith('sk-ant-')) {
    toast('That doesn\'t look like a valid Anthropic key (should start with sk-ant-)', '⚠');
    return;
  }
  localStorage.setItem('sts-anthropic-key', key);
  closeApiKeyModal();
  document.getElementById('scanBagInput').value = '';
  document.getElementById('scanBagInput').click();
}

function handleScanPhoto(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = async e => {
    const dataUrl  = e.target.result;
    const comma    = dataUrl.indexOf(',');
    const base64   = dataUrl.slice(comma + 1);
    const mimeType = dataUrl.slice(5, comma).split(';')[0];
    await runClaudeVisionScan(base64, mimeType);
  };
  reader.readAsDataURL(file);
}

async function runClaudeVisionScan(base64, mediaType) {
  const key = localStorage.getItem('sts-anthropic-key') || '';
  if (!key) { toast('No API key saved', '⚠'); return; }

  // Show spinner
  document.getElementById('scanOverlay').classList.add('open');

  const systemPrompt = `You are an order intake assistant for Stones Throw Studio, a custom jewelry shop.
The user will show you a photo of a handwritten work order bag or intake sheet.
Extract all visible information and return ONLY a valid JSON object with these exact keys (use null for anything not visible):
{
  "customer_name": string|null,
  "email": string|null,
  "phone": string|null,
  "take_in_date": "YYYY-MM-DD"|null,
  "deadline": "YYYY-MM-DD"|null,
  "pickup_location": "Bell Market"|"Mueller Market"|"Chaparral Crossing Market"|"Studio"|"Sunset Valley"|null,
  "contacted_via": "Email"|"Farmer's Market"|"Shopify Email"|"Etsy Message"|"Instagram Message"|"Text Message"|"Facebook Message"|null,
  "order_type": "order"|"estimate"|"repair",
  "description": string|null,
  "materials": string|null,
  "price": number|null,
  "notes": string|null
}
For order_type: use "repair" for repairs/resizing, "estimate" for estimate requests, "order" for custom orders (default to "order" if unclear).
For dates, infer the year as the current year (${new Date().getFullYear()}) if only month/day is shown.
Return ONLY the JSON object, no other text.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':                              key,
        'anthropic-version':                      '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type':                           'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text',  text: 'Extract the order information from this work order bag photo.' }
          ]
        }]
      })
    });

    document.getElementById('scanOverlay').classList.remove('open');

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      if (resp.status === 401) {
        localStorage.removeItem('sts-anthropic-key');
        toast('Invalid API key — please re-enter it', '⚠');
        document.getElementById('apiKeyModalBg').classList.add('open');
      } else {
        toast('API error: ' + (errBody.error?.message || resp.statusText), '⚠');
      }
      return;
    }

    const data = await resp.json();
    const raw  = data.content?.[0]?.text || '';

    let parsed;
    try {
      // strip any accidental markdown fences
      const cleaned = raw.replace(/```json\n?/g,'').replace(/```/g,'').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      toast('Couldn\'t read the scan result — try a clearer photo', '⚠');
      console.error('Scan raw response:', raw);
      return;
    }

    _pendingScanData = parsed;
    showScanResultModal(parsed);

  } catch (err) {
    document.getElementById('scanOverlay').classList.remove('open');
    toast('Network error during scan — check your connection', '⚠');
    console.error('Scan error:', err);
  }
}

function showScanResultModal(d) {
  const fmt = (label, val) => {
    const empty = val === null || val === undefined || val === '';
    return `<div class="scan-field-row">
      <div class="scan-field-label">${label}</div>
      <div class="scan-field-val${empty ? ' empty' : ''}">${empty ? 'Not found' : val}</div>
    </div>`;
  };
  const typeLabel = d.order_type === 'repair' ? '🔧 Repair' : d.order_type === 'estimate' ? '📋 Estimate Request' : '💍 Custom Order';

  document.getElementById('scanResultFields').innerHTML =
    fmt('Order Type',       typeLabel) +
    fmt('Customer Name',    d.customer_name) +
    fmt('Email',            d.email) +
    fmt('Phone',            d.phone) +
    fmt('Take-In Date',     d.take_in_date) +
    fmt('Deadline',         d.deadline) +
    fmt('Pickup Location',  d.pickup_location) +
    fmt('Contacted Via',    d.contacted_via) +
    fmt('Description',      d.description) +
    fmt('Materials',        d.materials) +
    fmt('Quoted Price',     d.price != null ? '$' + d.price : null) +
    fmt('Notes',            d.notes);

  document.getElementById('scanResultModalBg').classList.add('open');
}

function closeScanResultModal() {
  document.getElementById('scanResultModalBg').classList.remove('open');
  _pendingScanData = null;
}

function confirmScanFill() {
  if (!_pendingScanData) return;
  fillFromScan(_pendingScanData);
  closeScanResultModal();
}

function fillFromScan(d) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== null && val !== undefined) el.value = val;
  };

  set('f-name',        d.customer_name);
  set('f-email',       d.email);
  set('f-phone',       d.phone);
  set('f-takein',      d.take_in_date);
  set('f-deadline',    d.deadline);
  set('f-description', d.description);
  set('f-materials',   d.materials);
  set('f-notes',       d.notes);
  if (d.price != null) set('f-price', d.price);

  // Pickup location dropdown
  if (d.pickup_location) {
    const pk = document.getElementById('f-pickup');
    if (pk) {
      [...pk.options].forEach(o => { if (o.value === d.pickup_location) pk.value = d.pickup_location; });
    }
  }

  // Contacted via dropdown
  if (d.contacted_via) {
    const src = document.getElementById('f-source');
    if (src) {
      [...src.options].forEach(o => { if (o.value === d.contacted_via) src.value = d.contacted_via; });
    }
  }

  // Order type toggle
  if (d.order_type) setOrderType(d.order_type);

  // Switch to the new-order tab so they can review
  switchSubTab('new-order', document.querySelector('.sub-nav-tab[data-tab=new-order]'));
  toast('Form filled from scan ✓ — review and submit when ready', '📷');
}

// ════════════════════════════════════════════

// ── Initial render ──────────────────────────
// orders.js loads after app.js, so renderKanban is now defined here.
// Always start with cards fully expanded.
collapsedCards.clear();
renderKanban();
syncCollapseBtn();
