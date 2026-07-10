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

// Order-type-driven module state (this modal only — intake.html has its
// own equivalent layout switch, intakeApplyTypeLayout, with a different
// container-id scheme, so this stays here rather than in order-widgets.js).
let _eoOrderTypeModule = 'design'; // 'design' | 'repair' | 'resize' | 'square'

function eoApplyOrderTypeModule(type) {
  _eoOrderTypeModule = type === 'repair' ? 'repair' : type === 'resize' ? 'resize'
                     : type === 'square-item' ? 'square' : 'design';
  ['eo-design-module', 'eo-repair-module', 'eo-resize-module', 'eo-square-module'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === 'eo-' + _eoOrderTypeModule + '-module') ? '' : 'none';
  });
  const isDesign = _eoOrderTypeModule === 'design';
  const isSquare = _eoOrderTypeModule === 'square';
  // The Design module bucket also covers Etsy/Website orders, but the
  // Estimate Builder is Custom Order only — everything else (Repair,
  // Resize, Square Item, Etsy, Website) prices via manual Order Items.
  const isCustomOrder = type === 'order';
  const oiGrid = document.getElementById('oi-section') && document.getElementById('oi-section').closest('.form-grid');
  if (oiGrid) oiGrid.style.display = (isCustomOrder || isSquare) ? 'none' : '';
  const estModule = document.getElementById('eo-estimate-module');
  if (estModule) estModule.style.display = isCustomOrder ? '' : 'none';
  if (isSquare) {
    _jdMode = 'square';
    if (!_oiItems.length) _oiItems = [{ type: 'square', name: '', sku: '', price: 0, squareItemId: null, squareVariationId: null }];
  } else if (!isDesign) {
    _jdMode = 'custom';
  }
  // jdApplyVisibility toggles #oi-section's own inline display based on
  // _jdMode, independent of the parent .form-grid toggle above — re-run it
  // so a leftover Job-Description-Square hide from Design mode doesn't
  // stick around after switching to Repair/Resize (whose parent grid we
  // just re-showed).
  jdApplyVisibility(_jdMode);
  oiRender();
  // oiRender()/oiRecalcTotal() just set Total ($) from _oiItems, which is
  // stale if the Estimate module is the one now active (or just became
  // inactive) — recompute so Total ($) is correct immediately after a live
  // order-type switch, not just after the user next edits an Estimate field.
  if (typeof calcEstimate === 'function') calcEstimate();
}

// View mode hides fields with no data for a cleaner, invoice-like read.
// Only touches simple single-input .fg's (matched by direct field count) —
// composite widgets (Job Description, Order Items, Square pickers) have
// more than one input/select inside and are left to manage their own
// empty state (e.g. oiRender's "No items yet" message).
function eoUpdateEmptyFields() {
  document.querySelectorAll('#editOrderModalBg .eo-body .fg').forEach(fg => {
    const finish = fg.querySelector('.finish-checks');
    if (finish) {
      fg.classList.toggle('eo-empty', !finish.querySelector('input:checked'));
      return;
    }
    const fields = fg.querySelectorAll('input, select, textarea');
    if (fields.length !== 1) return;
    fg.classList.toggle('eo-empty', !(fields[0].value || '').trim());
  });
  // Composite Client Details widgets judge their own emptiness (and can
  // refine the finish-checks result above for #sens-fg / #style-fg).
  if (typeof eoIntakeUpdateEmpty === 'function') eoIntakeUpdateEmpty();
}

// Populates every modal field from an order object — used both when the
// modal is first opened and to silently discard unsaved edits when leaving
// Edit mode without saving (see eoSetMode below).
function eoPopulateFields(o) {
  // Discard any staged-but-unsaved sketch draft — matches every other
  // field's "re-populate from last-saved data" behavior on open/discard.
  _eoSketchDraft = null;
  // Populating must never reprice the order: eoApplyOrderTypeModule and
  // populateEstimateFromOrder both trigger calcEstimate(), which would
  // otherwise overwrite Total ($) and arm the estimate auto-save with
  // whatever estimate state this device has (see _estPopulating in
  // js/order-widgets.js).
  _estPopulating = true;
  try {
  _eoPopulateFieldsInner(o);
  } finally {
  _estPopulating = false;
  }
}

function _eoPopulateFieldsInner(o) {
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
  eoRenderViewIdentity(o);
  eoLoadSketch(o);
  eoLoadRefPhotos(o);
  const sa = o.shippingAddress || {};
  document.getElementById('f-addr-street').value   = sa.street  || o.addrStreet  || o.address || '';
  document.getElementById('f-addr-street2').value  = sa.street2 || o.addrStreet2 || '';
  document.getElementById('f-addr-city').value     = sa.city    || o.addrCity    || '';
  document.getElementById('f-addr-state').value    = sa.state   || o.addrState   || '';
  document.getElementById('f-addr-zip').value      = sa.zip     || o.addrZip     || '';
  document.getElementById('f-addr-country').value  = sa.country || o.addrCountry || 'United States';
  toggleShippingAddress();

  // Repair Notes — falls back to displaying legacy Internal Notes (pre-split
  // orders folded repair instructions into `notes`) without touching notes.
  document.getElementById('f-repair-notes').value = o.repairNotes || '';
  const legacyHint = document.getElementById('repair-legacy-hint');
  if (legacyHint) {
    const showLegacy = !(o.repairNotes || '').trim() && !!(o.notes || '').trim();
    legacyHint.style.display = showLegacy ? '' : 'none';
    legacyHint.textContent = showLegacy ? 'No repair notes on file — Internal Notes: ' + o.notes : '';
  }

  // Resize From/To — auto-split from the legacy combined `sizing` string
  // ("Resize X → Y") for orders created before these were separate fields.
  // The next Save persists the split fields going forward.
  let rFrom = o.resizeFrom || '', rTo = o.resizeTo || '';
  if (!rFrom && !rTo && o.sizing) {
    const m = o.sizing.match(/^Resize\s+(.*?)\s*→\s*(.*)$/);
    if (m) { rFrom = m[1] === '?' ? '' : m[1]; rTo = m[2] === '?' ? '' : m[2]; }
  }
  document.getElementById('f-resize-from').value = rFrom;
  document.getElementById('f-resize-to').value   = rTo;

  // Client Details — structured intake data (sensitivities, registry,
  // gift, style, stones, declined tiers, signature)
  eoIntakePopulate(o);

  // Auto-select Etsy/Shopify in the Order Type dropdown for synced orders —
  // only when orderType is still the generic default, so a manual
  // recategorization (e.g. to Repair) sticks on future edits.
  const platformType = o.id.startsWith('etsy-') ? 'etsy-order' : o.id.startsWith('shopify-') ? 'website-order' : null;
  const resolvedType = platformType && (!o.orderType || o.orderType === 'order') ? platformType : (o.orderType || 'order');
  setOrderType(resolvedType);
  eoApplyOrderTypeModule(resolvedType);

  populateEstimateFromOrder(o);
  eoUpdateEmptyFields();
}

// View/Edit mode — the modal opens read-only by default; every field
// (Stage included) requires Edit mode to change. Toggling back to View
// without saving silently discards unsaved edits by re-populating from the
// last-saved order.
let _eoMode = 'view';

function eoSetMode(mode) {
  if (_eoMode === 'edit' && mode === 'view') {
    const o = ORDERS.find(x => x.id === document.getElementById('f-editing-id').value);
    if (o) eoPopulateFields(o);
  }
  _eoMode = mode;
  const modal = document.querySelector('#editOrderModalBg .eo-modal');
  if (modal) modal.classList.toggle('eo-view-mode', mode === 'view');
  const btn = document.getElementById('eo-mode-toggle');
  if (btn) btn.textContent = mode === 'view' ? '✎ Edit' : '👁 View';
  oiRender();
  eoAutoGrowTextareas();
}

function eoToggleMode() { eoSetMode(_eoMode === 'view' ? 'edit' : 'view'); }

// Textareas (Materials/Metal, Gemstones, Sketch Notes) hold multi-line
// intake text but had a small fixed min-height — in view mode the textarea
// is pointer-events:none (read-only "document" look), so overflow content
// couldn't even be scrolled into view. Growing to scrollHeight removes the
// clipped tail in both modes; view/edit use different font sizes so this
// re-runs on every mode toggle, not just on populate.
function eoAutoGrowTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
function eoAutoGrowTextareas() {
  document.querySelectorAll('#editOrderModalBg .eo-body textarea').forEach(eoAutoGrowTextarea);
}
document.getElementById('editOrderModalBg')?.addEventListener('input', e => {
  if (e.target.tagName === 'TEXTAREA') eoAutoGrowTextarea(e.target);
});

// Mirrors the #f-order-type <option> labels — used for the modal title,
// which shows the order type in place of the generic "Edit Order".
const EO_ORDER_TYPE_LABELS = {
  'order':         '💍 Custom Order',
  'repair':        '🔧 Repair',
  'resize':        '💎 Resize',
  'square-item':   '🟦 Square Item',
  'etsy-order':    '🛍 Etsy Order',
  'website-order': '🌐 Website Order',
};
function eoOrderTypeLabel(type) { return EO_ORDER_TYPE_LABELS[type] || EO_ORDER_TYPE_LABELS.order; }

function openOrderCard(id) {
  const o = ORDERS.find(x => x.id === id);
  if (!o) return;

  eoPopulateFields(o);

  const title = document.getElementById('eo-title');
  // Read back the resolved type (platform auto-select already applied by
  // eoPopulateFields) rather than re-deriving it here.
  const resolvedType = (document.getElementById('f-order-type') || {}).value || 'order';
  if (title) title.textContent = eoOrderTypeLabel(resolvedType) + ' — ' + o.name;
  // Open before setting the mode — eoSetMode auto-grows the textareas to
  // scrollHeight, which reads back 0 while the modal is still display:none.
  document.getElementById('editOrderModalBg').classList.add('open');
  eoSetMode('view');
  const body = document.querySelector('#editOrderModalBg .eo-body');
  if (body) body.scrollTop = 0;
}

// Combined Name/Phone/Email/dates shown only in view mode (see .eo-view-identity
// in jewelry-workflow.html) — replaces the separate First/Last Name, Email,
// Phone, Deadline and Take In fields, which stay in the DOM for editing.
function eoRenderViewIdentity(o) {
  const nameEl = document.getElementById('eo-view-name');
  if (nameEl) nameEl.textContent = o.name || '';

  const phoneEl = document.getElementById('eo-view-phone');
  if (phoneEl) {
    const phone = fmtPhone(o.phone);
    phoneEl.textContent = phone;
    phoneEl.style.display = phone ? '' : 'none';
  }

  const emailEl = document.getElementById('eo-view-email');
  if (emailEl) {
    emailEl.textContent = o.email || '';
    emailEl.style.display = (o.email || '').trim() ? '' : 'none';
  }

  const takeinItem = document.getElementById('eo-view-takein-item');
  const takeinEl   = document.getElementById('eo-view-takein');
  if (takeinEl) takeinEl.textContent = fmtDate(o.takeIn);
  if (takeinItem) takeinItem.style.display = o.takeIn ? '' : 'none';

  const deadlineItem = document.getElementById('eo-view-deadline-item');
  const deadlineEl   = document.getElementById('eo-view-deadline');
  if (deadlineEl) deadlineEl.textContent = fmtDate(o.deadline);
  if (deadlineItem) deadlineItem.style.display = o.deadline ? '' : 'none';

  const sourceItem = document.getElementById('eo-view-source-item');
  const sourceEl   = document.getElementById('eo-view-source');
  if (sourceEl) sourceEl.textContent = o.contactSource || '';
  if (sourceItem) sourceItem.style.display = (o.contactSource || '').trim() ? '' : 'none';

  const pickupItem = document.getElementById('eo-view-pickup-item');
  const pickupEl   = document.getElementById('eo-view-pickup');
  if (pickupEl) pickupEl.textContent = o.pickup || '';
  if (pickupItem) pickupItem.style.display = (o.pickup || '').trim() ? '' : 'none';
}

// Sketch viewer for the modal. Sketches are drawn in the intake app
// (intake.html); locally-drawn ones live on o.sketchImg, iPad-drawn ones
// only exist in Notion, whose S3 file URLs expire hourly — so those are
// streamed fresh through the pipeline proxy on every view.
// Newly drawn/uploaded sketch, staged from the Edit Order modal but not yet
// saved — takes priority over o.sketchImg in the viewer until Save Changes
// commits it (see saveOrderEdit) or the edit is discarded (see eoSetMode).
let _eoSketchDraft = null;

// View mode drops the whole Design Sketch section when there's nothing to
// show (see .eo-no-sketch in jewelry-workflow.html) — edit mode always
// keeps it, since that's where a sketch gets added.
function _eoSetSketchSectionVisible(visible) {
  const sec = document.getElementById('eo-sketch-sec');
  const box = document.getElementById('eo-sketch-view');
  if (sec) sec.classList.toggle('eo-no-sketch', !visible);
  if (box) box.classList.toggle('eo-no-sketch', !visible);
}

function eoLoadSketch(o) {
  const box = document.getElementById('eo-sketch-view');
  if (!box) return;
  box.innerHTML = '';
  eoUpdateSketchBtnLabel(o);
  if (_eoSketchDraft) {
    const img = document.createElement('img');
    img.alt = 'Design sketch (unsaved)';
    img.src = _eoSketchDraft;
    box.appendChild(img);
    const note = document.createElement('div');
    note.className = 'eo-sketch-draft-note';
    note.textContent = '● Unsaved — click Save Changes to keep this sketch';
    box.appendChild(note);
    _eoSetSketchSectionVisible(true);
    return;
  }
  if (o.sketchImg) {
    const img = document.createElement('img');
    img.alt = 'Design sketch';
    img.src = o.sketchImg;
    img.onclick = () => viewSketch(o.id);
    box.appendChild(img);
    _eoSetSketchSectionVisible(true);
    return;
  }
  if (o.notionId) {
    box.innerHTML = '<div class="eo-sketch-spinner" title="Loading sketch from Notion…"></div>';
    _eoSetSketchSectionVisible(true); // assume yes until the fetch below proves otherwise
    const src = '/api/notion-pipeline?sketch=' + encodeURIComponent(o.notionId);
    const img = new Image();
    img.alt = 'Design sketch';
    img.onload = () => {
      box.innerHTML = '';
      img.onclick = () => window.open(src, '_blank');
      box.appendChild(img);
      _eoSetSketchSectionVisible(true);
    };
    img.onerror = () => {
      box.innerHTML = '<div class="eo-sketch-empty">No sketch on this order</div>';
      _eoSetSketchSectionVisible(false);
    };
    img.src = src;
    return;
  }
  box.innerHTML = '<div class="eo-sketch-empty">No sketch on this order</div>';
  _eoSetSketchSectionVisible(false);
}

// Shared read-only lightbox opener — hides the sketch/photo Replace/Remove
// actions (viewPhoto/viewSketch's job when they own the image) since a
// design sketch or reference photo has nothing to replace from here.
function _eoOpenViewLightbox(src, title) {
  const actions = document.querySelector('#photoLightbox .lb-actions');
  if (actions) actions.style.display = 'none';
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lbTitle').textContent = title;
  document.getElementById('photoLightbox').classList.add('open');
}

// Reference-photos viewer for the modal — client-shown inspiration/existing-
// piece photos captured in the intake app's Photos tab (js/intake-sheet.js).
// View-only: the iPad is the only capture point, so unlike the sketch there's
// no draw/upload fallback here. Same local-first / Notion-proxy-fallback
// pattern as eoLoadSketch — o.refPhotos only has data on the device that ran
// intake; every other device streams thumbnails through the pipeline proxy.
function _eoSetRefPhotosSectionVisible(visible) {
  const sec = document.getElementById('eo-refphotos-sec');
  const box = document.getElementById('eo-refphotos-view');
  if (sec) sec.classList.toggle('eo-no-refphotos', !visible);
  if (box) box.classList.toggle('eo-no-refphotos', !visible);
}

function eoLoadRefPhotos(o) {
  const box = document.getElementById('eo-refphotos-view');
  if (!box) return;
  box.innerHTML = '';
  if (o.refPhotos && o.refPhotos.length) {
    o.refPhotos.forEach(src => {
      const thumb = document.createElement('div');
      thumb.className = 'eo-refphoto-thumb';
      const img = document.createElement('img');
      img.alt = 'Reference photo';
      img.src = src;
      img.onclick = () => _eoOpenViewLightbox(src, o.name + ' — reference photo');
      thumb.appendChild(img);
      box.appendChild(thumb);
    });
    _eoSetRefPhotosSectionVisible(true);
    return;
  }
  if (o.notionId) {
    box.innerHTML = '<div class="eo-sketch-spinner" title="Loading reference photos from Notion…"></div>';
    _eoSetRefPhotosSectionVisible(true); // assume yes until the count fetch proves otherwise
    const base = '/api/notion-pipeline?sketch=' + encodeURIComponent(o.notionId) + '&prop=' + encodeURIComponent('Reference Photos');
    fetch(base + '&list=1')
      .then(r => r.json())
      .then(d => {
        box.innerHTML = '';
        const count = (d && d.count) || 0;
        if (!count) {
          box.innerHTML = '<div class="eo-refphotos-empty">No reference photos on this order</div>';
          _eoSetRefPhotosSectionVisible(false);
          return;
        }
        for (let i = 0; i < count; i++) {
          const src = base + '&idx=' + i;
          const thumb = document.createElement('div');
          thumb.className = 'eo-refphoto-thumb';
          const img = document.createElement('img');
          img.alt = 'Reference photo';
          img.src = src;
          img.onclick = () => window.open(src, '_blank');
          thumb.appendChild(img);
          box.appendChild(thumb);
        }
      })
      .catch(() => {
        box.innerHTML = '<div class="eo-refphotos-empty">No reference photos on this order</div>';
        _eoSetRefPhotosSectionVisible(false);
      });
    return;
  }
  box.innerHTML = '<div class="eo-refphotos-empty">No reference photos on this order</div>';
  _eoSetRefPhotosSectionVisible(false);
}

function eoUpdateSketchBtnLabel(o) {
  const btn = document.getElementById('eo-sketch-draw-btn');
  if (!btn) return;
  const hasSketch = !!(_eoSketchDraft || (o && o.sketchImg));
  btn.textContent = hasSketch ? '✎ Replace Sketch' : '✎ Draw Sketch';
}

// ── Draw Sketch modal — Add/Replace a sketch on an already-taken-in order ──
function openSketchDrawModal() {
  const o = ORDERS.find(x => x.id === document.getElementById('f-editing-id').value);
  if (!o) return;
  if (typeof sketchReset === 'function') sketchReset();
  ulReset(); // don't leak the previous order's reference photo
  // Seed the canvas from whichever sketch is currently "current" — a draft
  // staged earlier this session takes priority, else the order's saved one.
  const seed = _eoSketchDraft || o.sketchImg || null;
  if (seed && typeof sketchLoad === 'function') sketchLoad(seed);
  const bg = document.getElementById('sketchDrawModalBg');
  if (bg) bg.classList.add('open');
}

function closeSketchDrawModal() {
  const bg = document.getElementById('sketchDrawModalBg');
  if (bg) bg.classList.remove('open');
}

// ── Reference-photo underlay for the Draw Sketch modal ─────────
// Desktop port of intake.js's underlay: same element ids and function
// names so the dock markup stays copy-identical between the two pages
// (orders.js and intake.js are never loaded together). Simplified for
// desktop: the photo is fit-contain centered with an opacity slider —
// no pinch/drag repositioning, since the mouse is the drawing device.
const _ul = { img: null, x: 0, y: 0, s: 1, opacity: 0.3, visible: true };

function _ulApply() {
  const el = document.getElementById('sketch-underlay');
  if (!el) return;
  const on = _ul.img && _ul.visible;
  el.style.display = on ? 'block' : 'none';
  if (on) {
    el.style.transform = 'translate(' + _ul.x + 'px,' + _ul.y + 'px) scale(' + _ul.s + ')';
    el.style.opacity = _ul.opacity;
  }
  const controls = document.getElementById('ul-controls');
  if (controls) controls.style.display = _ul.img ? '' : 'none';
  const opRow = document.getElementById('ul-opacity-row');
  if (opRow) opRow.style.display = (_ul.img && _ul.visible) ? '' : 'none';
  const toggle = document.getElementById('ul-toggle-btn');
  if (toggle) toggle.classList.toggle('on', _ul.visible);
}

function ulPick() { document.getElementById('ul-file')?.click(); }

function ulFileChosen(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      _ul.img = img;
      _ul.visible = true;
      const el = document.getElementById('sketch-underlay');
      if (el) el.src = img.src;
      // Fit-contain into the stage, centered
      const stage = document.getElementById('sketch-stage');
      const sw = stage?.clientWidth || 800, sh = stage?.clientHeight || 600;
      _ul.s = Math.min(sw / img.naturalWidth, sh / img.naturalHeight) * 0.92;
      _ul.x = (sw - img.naturalWidth * _ul.s) / 2;
      _ul.y = (sh - img.naturalHeight * _ul.s) / 2;
      _ulApply();
      toast('Photo under the ink — trace away', '🖼');
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function ulToggle() {
  if (!_ul.img) return;
  _ul.visible = !_ul.visible;
  _ulApply();
}

function ulRemove() {
  _ul.img = null;
  const el = document.getElementById('sketch-underlay');
  if (el) el.removeAttribute('src');
  _ulApply();
}

function ulSetOpacity(v) {
  _ul.opacity = (parseFloat(v) || 30) / 100;
  const val = document.getElementById('ul-opacity-val');
  if (val) val.textContent = Math.round(_ul.opacity * 100) + '%';
  _ulApply();
}

function ulReset() {
  ulRemove();
  _ul.x = 0; _ul.y = 0; _ul.s = 1; _ul.opacity = 0.3; _ul.visible = true;
  const slider = document.getElementById('ul-opacity');
  if (slider) slider.value = 30;
  const val = document.getElementById('ul-opacity-val');
  if (val) val.textContent = '30%';
}

// Composite (white + photo underlay + ink) for Use Sketch — mirrors
// intake.js's sketchExport override. One wrinkle intake doesn't have:
// intake resizes the canvas backing store to match the stage, but this
// modal keeps the fixed 1000x620 backing CSS-stretched over the stage, so
// the underlay's stage-CSS-px placement must be scaled per-axis into
// backing px (the same non-uniform mapping _padPoint applies to strokes).
function _dsSketchComposite() {
  if (typeof SK === 'undefined' || !SK) return null;
  const hasPhoto = !!(_ul.img && _ul.visible);
  if (!hasPhoto) return (typeof sketchExport === 'function') ? sketchExport() : null;
  if (!SK.hasInk && !hasPhoto) return null;
  const c = document.createElement('canvas');
  c.width = SK.canvas.width; c.height = SK.canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  const stage = document.getElementById('sketch-stage');
  const fx = c.width  / (stage?.clientWidth  || c.width);
  const fy = c.height / (stage?.clientHeight || c.height);
  ctx.globalAlpha = _ul.opacity;
  ctx.setTransform(_ul.s * fx, 0, 0, _ul.s * fy, _ul.x * fx, _ul.y * fy);
  ctx.drawImage(_ul.img, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(SK.canvas, 0, 0);
  return c.toDataURL('image/png');
}

function eoUseDrawnSketch(btn) {
  const dataUrl = _dsSketchComposite();
  if (!dataUrl) { toast('Draw something (or add a photo) first', '⚠'); return; }
  _eoSketchDraft = dataUrl;
  const o = ORDERS.find(x => x.id === document.getElementById('f-editing-id').value);
  eoLoadSketch(o || {});
  // Brief "Saved" state on the button before the modal closes, so the tap
  // visibly landed; the draft only commits to the order on Save Changes.
  if (btn) {
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = '✓ Saved';
    setTimeout(() => {
      btn.textContent = prev;
      btn.disabled = false;
      closeSketchDrawModal();
    }, 650);
  } else {
    closeSketchDrawModal();
  }
  toast('Sketch attached — Save Changes to keep it', '✓');
}

function eoUploadSketchFile(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    _eoSketchDraft = e.target.result;
    const o = ORDERS.find(x => x.id === document.getElementById('f-editing-id').value);
    eoLoadSketch(o || {});
  };
  reader.readAsDataURL(input.files[0]);
  input.value = ''; // allow re-selecting the same file later
}

function closeEditOrderModal() {
  const bg = document.getElementById('editOrderModalBg');
  if (bg) bg.classList.remove('open');
  // Clearing the editing id stops the estimate autosave path while closed
  const editingId = document.getElementById('f-editing-id');
  if (editingId) editingId.value = '';
  const compose = document.getElementById('eo-invoice-compose');
  if (compose) { compose.style.display = 'none'; compose.innerHTML = ''; }
  eoSetMode('view');
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
  // The modal otherwise only VIEWS the sketch drawn in intake.html — it
  // never touches o.sketchImg unless the user explicitly drew/uploaded a
  // new one this session (staged in _eoSketchDraft via the Draw/Replace
  // Sketch actions), so a desktop edit can't accidentally clobber an
  // iPad-drawn sketch just by opening and saving the order.
  if (_eoSketchDraft) { o.sketchImg = _eoSketchDraft; _eoSketchDraft = null; }
  o.orderType     = (document.getElementById('f-order-type') || {}).value || o.orderType || 'order';
  o.repairNotes   = document.getElementById('f-repair-notes').value.trim() || '';
  o.resizeFrom    = document.getElementById('f-resize-from').value.trim()  || '';
  o.resizeTo      = document.getElementById('f-resize-to').value.trim()    || '';
  // Resize orders mirror Current/Desired Size into `sizing` (Notion's
  // "Sizing / Dimensions" property) — sizing becomes a derived display copy
  // for resize orders going forward, regenerated on every save.
  if (o.orderType === 'resize') o.sizing = formatResizeSizing(o.resizeFrom, o.resizeTo);
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

  // Client Details — structured intake data round-trips through this modal
  o.sensitivities = eoSensCollect();
  o.wrist         = document.getElementById('f-wrist').value.trim();
  o.neck          = document.getElementById('f-neck').value.trim();
  o.ringSizes     = eoRegCollect('client');
  o.gift          = eoGiftCollect();
  o.styleProfile  = eoStyleCollect();
  o.stones        = eoStonesCollect();
  o.estimateAlternatives = _eoAlts.map(a => ({ ...a }));
  // Estimate state — same shape saveEstimateToNotion writes, captured here
  // too so a plain Save Changes carries the current builder state along.
  const eoEstModule = document.getElementById('eo-estimate-module');
  if (eoEstModule && eoEstModule.style.display !== 'none') {
    o.estimate = {
      labor:      parseFloat(document.getElementById('est-labor')?.value) || 0,
      shipping:   parseFloat(document.getElementById('est-shipping')?.value) || 0,
      taxOn:      document.getElementById('est-tax-toggle')?.checked || false,
      multiplier: estMultiplier,
      adjustment: parseFloat(document.getElementById('est-adjustment')?.value) || 0,
    };
  }

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
//  CLIENT DETAILS — 1:1 editors for the structured data the intake app
//  captures (sensitivities, ring registry, gift context, style profile,
//  structured stones, declined estimate tiers, signature). Vocabulary
//  mirrors intake.html / js/intake-sheet.js / js/intake-profiles.js.
// ════════════════════════════════════════════

const _eoEsc = t => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ── Sensitivities — checkboxes for the intake's fixed set; anything else
//    in the list (the intake's free-text note) lands in the note input ──
const EO_SENS_VALUES = ['Nickel', 'Sterling/copper alloys', 'Gold-fill', 'Brass/bronze', 'Plated finishes'];

function eoSensPopulate(list) {
  list = list || [];
  document.querySelectorAll('#f-sensitivities input').forEach(c => {
    c.checked = list.includes(c.value);
  });
  const note = document.getElementById('f-sensitivity-note');
  if (note) note.value = list.filter(s => !EO_SENS_VALUES.includes(s)).join('; ');
}

function eoSensCollect() {
  const checks = [...document.querySelectorAll('#f-sensitivities input:checked')].map(c => c.value);
  const note = (document.getElementById('f-sensitivity-note')?.value || '').trim();
  return note ? checks.concat([note]) : checks;
}

// ── Ring size registry — flat rows standing in for the intake's tap-a-hand
//    picker; entry shape matches: {hand:'L'|'R', finger, size, conf?, date} ──
const EO_REG_LIST_IDS = { client: 'eo-reg-list', recipient: 'eo-reg-list-recipient' };
const EO_REG_FINGERS  = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function _eoRegRowHtml(e) {
  const handOpts = ['L', 'R'].map(h =>
    '<option value="' + h + '"' + (e.hand === h ? ' selected' : '') + '>' + (h === 'L' ? 'Left' : 'Right') + '</option>').join('');
  const fingerOpts = EO_REG_FINGERS.map(f =>
    '<option value="' + f + '"' + (e.finger === f ? ' selected' : '') + '>' + f.charAt(0).toUpperCase() + f.slice(1) + '</option>').join('');
  return '<div class="eo-row-editor eo-reg-row" data-date="' + _eoEsc(e.date || '') + '" data-conf="' + _eoEsc(e.conf || '') + '">'
    + '<select class="reg-hand">' + handOpts + '</select>'
    + '<select class="reg-finger">' + fingerOpts + '</select>'
    + '<input class="eo-row-size reg-size" type="number" step="0.25" min="1" max="16" placeholder="Size" value="' + _eoEsc(e.size != null ? e.size : '') + '">'
    + (e.date ? '<span style="font-size:11px;color:var(--text3);">' + _eoEsc(e.date) + '</span>' : '')
    + '<button type="button" class="est-remove-btn eo-edit-only" onclick="this.closest(\'.eo-reg-row\').remove();eoIntakeUpdateEmpty()">&#215;</button>'
    + '</div>';
}

function eoRegRender(person, entries) {
  const box = document.getElementById(EO_REG_LIST_IDS[person]);
  if (!box) return;
  box.innerHTML = (entries && entries.length)
    ? entries.map(_eoRegRowHtml).join('')
    : '<div class="eo-rows-empty">No sizes on file</div>';
}

function eoRegAdd(person) {
  const box = document.getElementById(EO_REG_LIST_IDS[person]);
  if (!box) return;
  box.querySelector('.eo-rows-empty')?.remove();
  box.insertAdjacentHTML('beforeend',
    _eoRegRowHtml({ hand: 'L', finger: 'ring', size: '', date: new Date().toISOString().slice(0, 10) }));
  eoIntakeUpdateEmpty();
}

function eoRegCollect(person) {
  const box = document.getElementById(EO_REG_LIST_IDS[person]);
  if (!box) return [];
  return [...box.querySelectorAll('.eo-reg-row')].map(row => {
    const size = parseFloat(row.querySelector('.reg-size')?.value);
    if (isNaN(size)) return null;
    const e = {
      hand:   row.querySelector('.reg-hand')?.value || 'L',
      finger: row.querySelector('.reg-finger')?.value || 'ring',
      size:   size,
      date:   row.dataset.date || new Date().toISOString().slice(0, 10),
    };
    if (row.dataset.conf) e.conf = row.dataset.conf;
    return e;
  }).filter(Boolean);
}

// ── Occasion / gift block ─────────────────────────────────────
function eoGiftToggle() {
  const on = document.getElementById('f-gift-toggle')?.checked;
  const block = document.getElementById('eo-gift-block');
  if (block) block.style.display = on ? '' : 'none';
  eoIntakeUpdateEmpty();
}

function eoGiftSurpriseHint() {
  const on = document.getElementById('f-gift-surprise')?.checked;
  document.getElementById('eo-gift-surprise-label')?.classList.toggle('eo-gift-surprise-on', !!on);
}

// Selects a value in a fixed-option dropdown, appending it first if it's a
// value the vocabulary doesn't know (older orders, hand-typed intake data).
function _eoSetSelect(id, value) {
  const sel = document.getElementById(id);
  if (!sel) return;
  value = value || '';
  if (value && ![...sel.options].some(op => op.value === value)) {
    const op = document.createElement('option');
    op.value = op.textContent = value;
    sel.appendChild(op);
  }
  sel.value = value;
}

function eoGiftPopulate(g) {
  const toggle = document.getElementById('f-gift-toggle');
  if (toggle) toggle.checked = !!g;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('f-gift-recipient', g && g.recipient);
  _eoSetSelect('f-gift-relationship', g && g.relationship);
  _eoSetSelect('f-gift-occasion', g && g.occasion);
  set('f-gift-date', g && g.occasionDate);
  const sup = document.getElementById('f-gift-surprise');
  if (sup) sup.checked = !!(g && g.surprise);
  eoGiftSurpriseHint();
  eoRegRender('recipient', (g && g.ringSizes) || []);
  eoGiftToggle();
}

function eoGiftCollect() {
  if (!document.getElementById('f-gift-toggle')?.checked) return null;
  return {
    recipient:    document.getElementById('f-gift-recipient')?.value.trim() || '',
    relationship: document.getElementById('f-gift-relationship')?.value || '',
    occasion:     document.getElementById('f-gift-occasion')?.value || '',
    occasionDate: document.getElementById('f-gift-date')?.value || '',
    surprise:     !!document.getElementById('f-gift-surprise')?.checked,
    ringSizes:    eoRegCollect('recipient'),
  };
}

// ── Style profile ─────────────────────────────────────────────
function eoStylePopulate(s) {
  document.querySelectorAll('#f-style-aesthetic input').forEach(c => {
    c.checked = !!(s && (s.aesthetic || []).includes(c.value));
  });
  _eoSetSelect('f-style-tone',   s && s.tone);
  _eoSetSelect('f-style-wear',   s && s.wear);
  _eoSetSelect('f-style-budget', s && s.budget);
}

function eoStyleCollect() {
  const aesthetic = [...document.querySelectorAll('#f-style-aesthetic input:checked')].map(c => c.value);
  const tone   = document.getElementById('f-style-tone')?.value || '';
  const wear   = document.getElementById('f-style-wear')?.value || '';
  const budget = document.getElementById('f-style-budget')?.value || '';
  return (aesthetic.length || tone || wear || budget) ? { aesthetic, tone, wear, budget } : null;
}

// ── Structured stones — same shape + text rendering as the intake's
//    parameter sheet, so the Gemstones text regenerates identically ──
const EO_STONE_OPTS = {
  origin:  ['Natural', 'Lab', 'Client-supplied'],
  cut:     ['Round', 'Oval', 'Pear', 'Emerald', 'Marquise', 'Cab'],
  setting: ['Bezel', 'Prong ×4', 'Prong ×6', 'Flush', 'Channel', 'Pavé'],
  role:    ['Center', 'Accent'],
};

function _eoStoneSel(cls, opts, value, label) {
  value = value || '';
  return '<select class="' + cls + '">'
    + '<option value="">' + label + ' —</option>'
    + opts.map(o => '<option value="' + _eoEsc(o) + '"' + (o === value ? ' selected' : '') + '>' + _eoEsc(o) + '</option>').join('')
    + (value && !opts.includes(value) ? '<option value="' + _eoEsc(value) + '" selected>' + _eoEsc(value) + '</option>' : '')
    + '</select>';
}

function _eoStoneRowHtml(s) {
  return '<div class="eo-row-editor eo-stone-row">'
    + '<input class="st-type eo-row-wide" type="text" placeholder="Stone type" value="' + _eoEsc(s.type || '') + '">'
    + _eoStoneSel('st-origin', EO_STONE_OPTS.origin, s.origin, 'Origin')
    + _eoStoneSel('st-cut', EO_STONE_OPTS.cut, s.cut, 'Cut')
    + '<input class="st-size eo-row-size" type="text" placeholder="1ct / 6mm" value="' + _eoEsc(s.size || '') + '">'
    + _eoStoneSel('st-setting', EO_STONE_OPTS.setting, s.setting, 'Setting')
    + _eoStoneSel('st-role', EO_STONE_OPTS.role, s.role, 'Role')
    + '<button type="button" class="est-remove-btn eo-edit-only" onclick="this.closest(\'.eo-stone-row\').remove();eoStonesChanged()">&#215;</button>'
    + '</div>';
}

function eoStonesRender(stones) {
  const box = document.getElementById('eo-stone-list');
  if (!box) return;
  box.innerHTML = (stones && stones.length)
    ? stones.map(_eoStoneRowHtml).join('')
    : '<div class="eo-rows-empty">No structured stones on file</div>';
}

function eoStoneAdd() {
  const box = document.getElementById('eo-stone-list');
  if (!box) return;
  box.querySelector('.eo-rows-empty')?.remove();
  const role = box.querySelector('.eo-stone-row') ? 'Accent' : 'Center';
  box.insertAdjacentHTML('beforeend', _eoStoneRowHtml({ role }));
  eoIntakeUpdateEmpty();
}

function eoStonesCollect() {
  const box = document.getElementById('eo-stone-list');
  if (!box) return [];
  return [...box.querySelectorAll('.eo-stone-row')].map(row => {
    const v = cls => row.querySelector('.' + cls)?.value.trim() || '';
    const s = { type: v('st-type'), origin: v('st-origin'), cut: v('st-cut'),
                size: v('st-size'), setting: v('st-setting'), role: v('st-role') };
    return s.type ? s : null;
  }).filter(Boolean);
}

// Mirror of the intake's _psStoneLine (js/intake-sheet.js) — one place per
// app, same output, so a stone edited here reads identically on the bag.
function eoStoneLine(s) {
  const bits = [s.size, s.cut ? s.cut.toLowerCase() : '', s.type].filter(Boolean).join(' ');
  let line = (s.role || 'Stone') + ': ' + bits;
  if (s.origin === 'Client-supplied') line += ' (CLIENT-SUPPLIED — heirloom: photograph at intake)';
  else if (s.origin) line += ' (' + s.origin.toLowerCase() + ')';
  if (s.setting) line += ', ' + s.setting.toLowerCase() + ' set';
  return line;
}

// Structured stones drive the Gemstones text one-way, exactly like intake:
// only rewrites when there ARE stones — an empty editor never blanks a
// hand-written Gemstones field.
function eoStonesChanged() {
  const stones = eoStonesCollect();
  if (stones.length) {
    const gem = document.getElementById('f-gemstones');
    if (gem) gem.value = stones.map(eoStoneLine).join('\n');
  }
  eoIntakeUpdateEmpty();
}

// ── Declined estimate alternatives (read-only chips, removable) ──
let _eoAlts = [];

function eoAltsRender() {
  const box = document.getElementById('eo-alt-list');
  if (!box) return;
  box.innerHTML = _eoAlts.length
    ? _eoAlts.map((a, i) =>
        '<span class="eo-alt-chip">' + _eoEsc(a.label || 'Option')
        + ' <span class="eo-alt-total">$' + Math.round(a.total || 0).toLocaleString('en-US') + '</span>'
        + '<button type="button" class="est-remove-btn eo-edit-only" onclick="eoAltRemove(' + i + ')">&#215;</button></span>').join('')
    : '<div class="eo-rows-empty">None recorded</div>';
}

function eoAltRemove(i) {
  _eoAlts.splice(i, 1);
  eoAltsRender();
  eoIntakeUpdateEmpty();
}

// ── Signature viewer — local image if the order has one (same device as
//    intake), else streamed from Notion's Signature file property via the
//    pipeline proxy, exactly like the sketch. View-only by design. ──
function eoLoadSignature(o) {
  const box = document.getElementById('eo-signature-view');
  if (!box) return;
  box.innerHTML = '<div class="eo-rows-empty">No signature on file</div>';
  const show = src => {
    box.innerHTML = '<img src="' + src + '" alt="Customer signature">';
    eoIntakeUpdateEmpty();
  };
  if (o.signatureImg) { show(o.signatureImg); return; }
  if (!o.notionId || typeof PIPELINE_PROXY === 'undefined') return;
  const forId = o.id;
  fetch(PIPELINE_PROXY + '?sketch=' + encodeURIComponent(o.notionId) + '&prop=Signature')
    .then(r => (r.ok ? r.blob() : null))
    .then(b => {
      if (!b) return;
      // The modal may have moved to a different order while this streamed
      if (document.getElementById('f-editing-id')?.value !== forId) return;
      show(URL.createObjectURL(b));
    })
    .catch(() => {});
}

// ── Empty-state upkeep — composite .fg's that eoUpdateEmptyFields can't
//    judge (it only handles single-input fields + finish-check groups),
//    plus whole-module hiding in view mode when intake captured nothing ──
function eoIntakeUpdateEmpty() {
  const set = (id, empty) => document.getElementById(id)?.classList.toggle('eo-empty', !!empty);
  const sensAny = document.querySelector('#f-sensitivities input:checked')
    || (document.getElementById('f-sensitivity-note')?.value || '').trim();
  set('sens-fg', !sensAny);
  set('reg-fg', !document.querySelector('#eo-reg-list .eo-reg-row'));
  set('gift-fg', !document.getElementById('f-gift-toggle')?.checked);
  const styleAny = document.querySelector('#f-style-aesthetic input:checked')
    || document.getElementById('f-style-tone')?.value
    || document.getElementById('f-style-wear')?.value
    || document.getElementById('f-style-budget')?.value;
  set('style-fg', !styleAny);
  set('stones-fg', !document.querySelector('#eo-stone-list .eo-stone-row'));
  set('alts-fg', !_eoAlts.length);
  set('signature-fg', !document.querySelector('#eo-signature-view img'));
  const mod = document.getElementById('eo-intake-module');
  if (mod) {
    const anyFilled = [...mod.querySelectorAll('.fg')].some(fg => !fg.classList.contains('eo-empty'));
    mod.classList.toggle('eo-empty-mod', !anyFilled);
  }
}

// Populate all Client Details widgets from an order — called from
// eoPopulateFields so open/discard behave like every other field.
function eoIntakePopulate(o) {
  eoSensPopulate(o.sensitivities || []);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('f-wrist', o.wrist);
  set('f-neck',  o.neck);
  eoRegRender('client', o.ringSizes || []);
  eoGiftPopulate(o.gift || null);
  eoStylePopulate(o.styleProfile || null);
  eoStonesRender(o.stones || []);
  _eoAlts = (o.estimateAlternatives || []).map(a => ({ ...a }));
  eoAltsRender();
  eoLoadSignature(o);
}

// Live edits in the stone editor keep the Gemstones text in sync
(function () {
  const list = document.getElementById('eo-stone-list');
  if (list) {
    list.addEventListener('input',  eoStonesChanged);
    list.addEventListener('change', eoStonesChanged);
  }
})();


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
  // Flat addr* fields are the address of record; shippingAddress{} is the
  // mirror kept for older orders (see order-normalize.js).
  const sa = o.shippingAddress || {};
  const addrLine = [o.addrStreet || sa.street || o.address || '',
                    o.addrStreet2 || sa.street2 || ''].filter(Boolean).join('\n');
  const p = new URLSearchParams({
    name:      o.name        || '',
    email:     o.email       || '',
    phone:     o.phone       || '',
    address:   addrLine,
    city:      o.addrCity  || sa.city  || '',
    state:     o.addrState || sa.state || '',
    zip:       o.addrZip   || sa.zip   || '',
    desc:      oiPrintJobDescShort(o),
    // Repair instructions live in o.repairNotes now (not folded into
    // o.notes) — prepend them so the printed bag still shows them.
    notes:     [o.repairNotes, o.notes].filter(Boolean).join('\n\n'),
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
    workedBy:  o.assignee || ({ kyle: 'Kyle', stevie: 'Stevie', vanessa: 'Vanessa' })[o.stage] || '',
    items:     JSON.stringify((o.items || []).filter(it => it.name).map(it => ({ desc: oiPrintLabel(it), amount: (parseFloat(it.price) || 0) * (parseInt(it.quantity, 10) || 1) }))),
  });
  // Per-kind layout params (order-normalize.js): drive which print variant
  // the template renders — ecom orders get Source row + Ship To block.
  if (typeof printParamsFor === 'function') {
    const pp = printParamsFor(o);
    p.set('kind',    pp.kind);
    p.set('layout',  pp.layout);
    p.set('orderNo', pp.orderNo);
    p.set('country', pp.country);
    if (pp.source) p.set('srcName', pp.source);
  }
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
