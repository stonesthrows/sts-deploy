// ════════════════════════════════════════════
//  ORDERS  —  pages/orders.js
//  Kanban board, new order form, estimate builder, drag-drop, camera
// ════════════════════════════════════════════


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
      // Cards at ready-pick are hidden here — they appear in the Ready to Ship tab instead
      const pickupCards = [];
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
      // Cards hidden here — they appear in the Ready to Ship tab instead
      const extraStagesHTML = group.stages.slice(1).map(stage => {
        return `
          <div class="k-sub-wrap ${stage.cls} k-sub-empty">
            <div class="k-sub-head">${stage.label}<span class="k-sub-count">0</span></div>
            <div class="k-body"
                 data-stage-id="${stage.id}"
                 ondragover="dragOver(event)"
                 ondragleave="dragLeave(event)"
                 ondrop="drop(event,'${stage.id}')">
              <div class="k-empty">Drop here</div>
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

// Shortens long pickup location names for the kanban card badge, which has
// limited width. Stored value / dropdown / Notion property are unaffected.
const PICKUP_BADGE_LABELS = {
  "Sunset Valley Farmer's Market": "SV Farmer's Market",
};
function pickupBadgeLabel(pickup) {
  return PICKUP_BADGE_LABELS[pickup] || pickup;
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
          : o.pickup ? `<span class="o-badge pickup">📍 ${pickupBadgeLabel(o.pickup)}</span>` : ''}
        ${o.assignee ? `<span class="o-badge assignee">👤 ${o.assignee}</span>` : ''}
        <span class="o-tag ${dl.cls}">${dl.text}</span>
      </div>
      <div class="o-body">
        ${hasPhoto ? `
          <div class="card-photo" onclick="event.stopPropagation(); viewPhoto('${o.id}')">
            <img src="${o.photo}" alt="Work order bag">
            <div class="card-photo-label">📷 Tap to view full size</div>
          </div>` : ''}
        ${o.sketchImg ? `
          <div class="card-photo card-sketch" onclick="event.stopPropagation(); viewSketch('${o.id}')">
            <img src="${o.sketchImg}" alt="Design sketch">
            <div class="card-photo-label">✏️ Tap to view sketch</div>
          </div>` : ''}
        <div class="o-desc">${o.desc}</div>
        ${(o.pickup || o.contactSource || o.contactedAt || o.assignee) ? `
        <div class="o-badges">
          ${o.pickup        ? `<span class="o-badge pickup">📍 ${pickupBadgeLabel(o.pickup)}</span>` : ''}
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
  document.getElementById('f-tracking-number').value  = o.trackingNumber  || '';
  document.getElementById('f-tracking-carrier').value = o.trackingCarrier || '';
  document.getElementById('f-email').value         = o.email         || '';
  document.getElementById('f-phone').value         = fmtPhone(o.phone);
  document.getElementById('f-source').value        = o.contactSource || '';
  document.getElementById('f-assignee').value      = o.assignee      || '';
  document.getElementById('f-materials').value     = o.materials     || '';
  document.getElementById('f-paid-by').value       = o.paidBy        || '';
  document.getElementById('f-fully-paid').value    = o.fullyPaid     || '';
  eoUpdateBalanceDue();
  document.getElementById('f-notes').value         = o.notes         || '';
  document.getElementById('f-customer-notes').value = o.customerNotes || '';
  document.getElementById('f-sketch').value        = o.sketchDesc    || '';
  document.getElementById('f-contact-method').value = o.contactMethod || '';
  document.getElementById('f-piece-type').value    = o.pieceType     || '';
  document.getElementById('f-sizing').value        = o.sizing        || '';
  document.getElementById('f-gemstones').value     = o.gemstones     || '';
  document.querySelectorAll('#f-finish input').forEach(c => c.checked = (o.finish || []).includes(c.value));
  _orderFormLegacyFields(o);
  eoLoadSketch(o);
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

  const title = document.getElementById('eo-title');
  if (title) title.textContent = 'Edit Order — ' + o.name;
  populateEstimateFromOrder(o);
  document.getElementById('editOrderModalBg').classList.add('open');
  const body = document.querySelector('#editOrderModalBg .eo-body');
  if (body) body.scrollTop = 0;
}

// Sketch viewer for the modal. Sketches are drawn in the intake app
// (intake.html); locally-drawn ones live on o.sketchImg, iPad-drawn ones
// only exist in Notion, whose S3 file URLs expire hourly — so those are
// streamed fresh through the pipeline proxy on every view.
function eoLoadSketch(o) {
  const box = document.getElementById('eo-sketch-view');
  if (!box) return;
  box.innerHTML = '';
  if (o.sketchImg) {
    const img = document.createElement('img');
    img.alt = 'Design sketch';
    img.src = o.sketchImg;
    img.onclick = () => viewSketch(o.id);
    box.appendChild(img);
    return;
  }
  if (o.notionId) {
    box.innerHTML = '<div class="eo-sketch-spinner" title="Loading sketch from Notion…"></div>';
    const src = '/api/notion-pipeline?sketch=' + encodeURIComponent(o.notionId);
    const img = new Image();
    img.alt = 'Design sketch';
    img.onload = () => {
      box.innerHTML = '';
      img.onclick = () => window.open(src, '_blank');
      box.appendChild(img);
    };
    img.onerror = () => { box.innerHTML = '<div class="eo-sketch-empty">No sketch on this order</div>'; };
    img.src = src;
    return;
  }
  box.innerHTML = '<div class="eo-sketch-empty">No sketch on this order</div>';
}

function closeEditOrderModal() {
  const bg = document.getElementById('editOrderModalBg');
  if (bg) bg.classList.remove('open');
  // Clearing the editing id stops the estimate autosave path while closed
  const editingId = document.getElementById('f-editing-id');
  if (editingId) editingId.value = '';
  const compose = document.getElementById('eo-invoice-compose');
  if (compose) { compose.style.display = 'none'; compose.innerHTML = ''; }
  const estCard = document.getElementById('estimateBuilderCard');
  if (estCard) estCard.style.display = 'none';
  const estBtn = document.getElementById('add-estimate-btn');
  if (estBtn) estBtn.textContent = '💰 Add Estimate';
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
  // Guard against the dropdown silently resetting to "" when an order's
  // stage has no matching <option> — losing the stage breaks Notion's
  // required Stage select and makes the order vanish from every kanban column.
  const stageVal = document.getElementById('f-stage').value;
  if (stageVal) o.stage = stageVal;
  o.items         = _oiItems.map(it => ({ ...it }));
  o.price         = parseFloat(document.getElementById('f-price').value) || 0;
  o.deposit       = parseFloat(document.getElementById('f-deposit').value) || 0;
  o.shipping      = parseFloat(document.getElementById('f-shipping').value) || 0;
  o.deadline      = document.getElementById('f-deadline').value || null;
  o.takeIn        = document.getElementById('f-takein').value   || null;
  o.pickup        = document.getElementById('f-pickup').value   || null;
  o.trackingNumber  = document.getElementById('f-tracking-number').value.trim()  || null;
  o.trackingCarrier = document.getElementById('f-tracking-carrier').value       || null;
  o.email         = document.getElementById('f-email').value.trim();
  o.phone         = document.getElementById('f-phone').value.trim();
  o.contactSource = document.getElementById('f-source').value    || null;
  o.assignee      = document.getElementById('f-assignee').value  || null;
  o.materials     = document.getElementById('f-materials').value.trim() || '';
  o.ringSize      = oiDeriveRingSizesText(o.items);
  o.paidBy        = document.getElementById('f-paid-by').value          || '';
  o.fullyPaid     = document.getElementById('f-fully-paid').value       || '';
  o.notes         = document.getElementById('f-notes').value.trim()         || '';
  o.customerNotes = document.getElementById('f-customer-notes').value.trim() || '';
  o.sketchDesc    = document.getElementById('f-sketch').value.trim()    || '';
  o.contactMethod = document.getElementById('f-contact-method').value  || '';
  o.pieceType     = document.getElementById('f-piece-type').value      || '';
  o.sizing        = document.getElementById('f-sizing').value.trim()   || '';
  o.gemstones     = document.getElementById('f-gemstones').value.trim() || '';
  o.finish        = [...document.querySelectorAll('#f-finish input:checked')].map(c => c.value);
  // The modal only VIEWS the sketch (drawn in intake.html) — never touch
  // o.sketchImg here, so a desktop edit can't clobber an iPad sketch.
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


function orderLookupTracking(btn) {
  const id = document.getElementById('f-editing-id').value;
  const o  = ORDERS.find(x => x.id === id);
  ssLookupTracking({
    numberField:  'f-tracking-number',
    carrierField: 'f-tracking-carrier',
    orderNumberGuess: o ? (o.id.replace(/^(shopify|etsy)-/, '')) : '',
    button: btn,
  });
}


// Legacy fields (Sketch Notes, Preferred Contact) are hidden at intake and
// only shown in edit mode when the order already carries a value.
function _orderFormLegacyFields(o) {
  const sk = document.getElementById('sketch-fg');
  if (sk) sk.classList.toggle('legacy-hide', !(o && (o.sketchDesc || '').trim()));
  const cm = document.getElementById('contact-method-fg');
  if (cm) cm.classList.toggle('legacy-hide', !(o && (o.contactMethod || '').trim()));
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
  // Restore the Replace/Remove buttons in case viewSketch hid them
  const lbActions = document.querySelector('#photoLightbox .lb-actions');
  if (lbActions) lbActions.style.display = '';
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
    if (typeof _markSketchChanged === 'function') _markSketchChanged(order);
    const r = await fetch('/api/notion-pipeline', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(order),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      if (typeof _recordSketchSync === 'function') _recordSketchSync(order, d);
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
    desc:      oiPrintJobDescShort(o),
    notes:     o.notes       || '',
    materials: o.materials   || '',
    takeIn:    o.takeIn      || '',
    deadline:  o.deadline    || '',
    price:     o.price       || '',
    deposit:   o.deposit     || '',
    shipping:  o.shipping    || '',
    ringSize:  oiPrintRingSizeShort(o),
    pickup:    o.pickup      || '',
    source:    o.contactSource || '',
    stage:     o.stage       || '',
    fullyPaid: o.fullyPaid   || '',
    workedBy:  ({ kyle: 'Kyle', stevie: 'Stevie', vanessa: 'Vanessa' })[o.stage] || '',
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
