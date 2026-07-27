(function() {
  const SB_TITLES = {
    'home':              'Dashboard',
    'dashboard':         'Custom Orders',
    'production':        'Ready to Ship',
    'customers':         'Customers',
    'print-bag':         'Print Order Bag',
    'inv-adjust':        'Adjust Inventory',
    'to-restock':        'To Restock',
    'prod-report':       'Production Report',
    'replenish':         'Replenishment',
    'supplier':          'Order Materials',
    'order-history':     'Order History',
    'materials':         'Materials Library',
    'triplog':           'Trips',
    'gmail':             'Gmail',
    'notes':             'Notes',
    'sales':             'Sales',
    'bestsellers':       'Best Sellers',
    'calendar':          'Calendar',
    'pj-calc':           'PJ Calc',
    'pj-ref':            'PJ Reference',
  };

  // Which bottom-bar tab a given sidebar/tab id belongs under. Anything not
  // listed here (home, and the standalone tabs the sidebar files under
  // "More" — triplog, notes, designs, sales, bestsellers, pj-calc, pj-ref,
  // calendar) falls back to 'more', so opening one from the drawer still
  // lights up the bottom bar's More tab instead of leaving it blank.
  const BOTNAV_MAP = {
    dashboard: 'custom-orders', production: 'custom-orders', customers: 'custom-orders',
    'to-restock': 'inventory', 'inv-adjust': 'inventory', 'prod-report': 'inventory', replenish: 'inventory',
    supplier: 'supplies', 'order-history': 'supplies', materials: 'supplies',
  };

  // ── Home dashboard init ──────────────────────────────
  window.homeTabInit = function() {
    // Greeting
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const greetEmoji = h < 12 ? '☀️' : h < 17 ? '🌤️' : '🌙';
    const greetEl = document.getElementById('homeGreeting');
    if (greetEl) greetEl.textContent = greet + ' ' + greetEmoji;
    const dateEl = document.getElementById('homeDate');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

    // KPIs from ORDERS
    if (typeof ORDERS !== 'undefined') {
      const active = ORDERS.filter(o => o.stage !== 'complete' && o.stage !== 'delivered' && o.stage !== 'cancelled');
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      set('hkpi-active', active.length);
      set('hkpi-bench',  active.filter(o => o.stage === 'build').length);
      set('hkpi-due',    active.filter(o => {
        if (!o.deadline) return false;
        const diff = Math.round((new Date(o.deadline) - new Date()) / 86400000);
        return diff >= 0 && diff <= 7;
      }).length);
      set('hkpi-ready',  active.filter(o => o.stage === 'ready-pick' || o.stage === 'ship-out').length);

      // Orders flat list — sorted by deadline, capped at 8. Ready-to-pick-up
      // orders are excluded — they're done and waiting on the customer, not
      // active studio work.
      const stageGrid = document.getElementById('hw-stage-grid');
      if (stageGrid && typeof STAGES !== 'undefined') {
        const stageLabelMap = {};
        STAGES.forEach(s => { stageLabelMap[s.id] = s.label; });
        const typeIcon = { repair: '🔧', estimate: '📋' };
        const sorted = active.filter(o => o.stage !== 'ready-pick').sort((a, b) => {
          if (!a.deadline && !b.deadline) return 0;
          if (!a.deadline) return 1;
          if (!b.deadline) return -1;
          return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0;
        });
        const shown = sorted.slice(0, 8);
        stageGrid.style.display = 'block';
        if (!shown.length) {
          stageGrid.innerHTML = '<div class="hw-order-empty">No active orders 🎉</div>';
        } else {
          const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          stageGrid.innerHTML = shown.map(o => {
            const dl      = deadlineInfo(o.deadline);
            const icon    = typeIcon[o.orderType] || '💍';
            const slbl    = stageLabelMap[o.stage] || o.stage || '—';
            const contact = o.phone || o.email || '';
            const jobDesc = o.jobDesc || o.desc || '';
            const needsContact = o.stage === 'contact-need';
            const contactBadge = needsContact
              ? `<span class="hw-call-badge">📞 Call</span>`
              : '';
            return `<div class="hw-order-row" onclick="openOrderCard('${esc(o.id)}')">
              <span class="hw-order-icon">${icon}</span>
              <span class="hw-order-main">
                <div class="hw-order-name">${esc(o.name||'—')}</div>
                ${jobDesc ? `<div class="hw-order-desc">${esc(jobDesc)}</div>` : ''}
                ${contact ? `<div class="hw-order-contact">${esc(contact)}</div>` : ''}
              </span>
              ${contactBadge}
              <span class="hw-order-stage">${esc(slbl)}</span>
              <span class="hw-order-dl ${dl.cls}">${dl.text}</span>
            </div>`;
          }).join('')
          + (active.length > 8 ? `<div class="hw-order-more">+${active.length - 8} more — <a onclick="sbNav('custom-orders','dashboard',null)">View all →</a></div>` : '');
        }
      }
    }

    // Calendar widget — pull from existing calendar if loaded
    _homeRefreshCalendar();

    // Packages widget — in-transit shipments (outgoing + incoming)
    _homeRefreshPackages();

    // Square weekend sales widget
    dashSquareLoad();
  };

  // Manually-logged packages — a lightweight, localStorage-only list for
  // tracking numbers that don't correspond to an ORDERS/ohOrders record
  // (e.g. a supplier order placed outside the normal intake flow). Not
  // synced to Notion or looked up via ShipStation — purely a sticky note.
  const PKG_MANUAL_KEY = 'sts-manual-packages';
  function _pkgLoadManual() {
    try { return JSON.parse(localStorage.getItem(PKG_MANUAL_KEY) || '[]'); } catch (e) { return []; }
  }
  function _pkgSaveManual(list) {
    try { localStorage.setItem(PKG_MANUAL_KEY, JSON.stringify(list)); } catch (e) {}
  }

  window._pkgToggleAddForm = function() {
    const el = document.getElementById('hw-pkg-add-form');
    if (!el) return;
    el.style.display = (el.style.display === 'none') ? 'flex' : 'none';
    if (el.style.display === 'flex') document.getElementById('hw-pkg-add-label').focus();
  };

  window._pkgAddManual = function() {
    const label   = (document.getElementById('hw-pkg-add-label').value    || '').trim();
    const dir     = document.getElementById('hw-pkg-add-dir').value       || 'in';
    const carrier = (document.getElementById('hw-pkg-add-carrier').value  || '').trim();
    const tracking= (document.getElementById('hw-pkg-add-tracking').value || '').trim();
    const status  = (document.getElementById('hw-pkg-add-status').value   || '').trim();
    const expected= (document.getElementById('hw-pkg-add-expected').value || '').trim();
    if (!label) { toast('Enter a supplier or description', '⚠'); return; }

    const now = new Date().toISOString();
    const list = _pkgLoadManual();
    list.push({ id: 'manual_' + Date.now().toString(36), label, dir, carrier, tracking, shipStatus: status || null, expectedDate: expected || null, date: now, trackingUpdatedAt: now });
    _pkgSaveManual(list);

    document.getElementById('hw-pkg-add-label').value = '';
    document.getElementById('hw-pkg-add-carrier').value = '';
    document.getElementById('hw-pkg-add-tracking').value = '';
    document.getElementById('hw-pkg-add-status').value = '';
    document.getElementById('hw-pkg-add-expected').value = '';
    document.getElementById('hw-pkg-add-form').style.display = 'none';

    toast('Package added ✓', '✓');
    _homeRefreshPackages();
  };

  window._pkgRemoveManual = function(id) {
    _pkgSaveManual(_pkgLoadManual().filter(p => p.id !== id));
    _homeRefreshPackages();
  };

  // Packages widget — gathers in-transit shipments from four sources:
  //   outgoing custom orders (ORDERS, pickup='To be Shipped'), outgoing
  //   Shopify orders (SHOPIFY_ORDERS), incoming supplier orders (ohOrders),
  //   and manually-logged packages (localStorage, see _pkgLoadManual above).
  // No live carrier API for delivery status — a shipped order is treated as
  // "delivered" once a Delivered date/status is recorded, or (for outgoing
  // orders where that's never set) after a 10-day rolling window.
  window._homeRefreshPackages = function() {
    const body = document.getElementById('hw-pkg-body');
    if (!body) return;
    const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const daysAgo = d => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null;
    const relTime = iso => {
      if (!iso) return '';
      const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      const days = Math.floor(hrs / 24);
      if (days < 7) return days + 'd ago';
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const pkgs = [];

    if (typeof ORDERS !== 'undefined') {
      ORDERS.forEach(o => {
        if (o.pickup !== 'To be Shipped') return;
        if (['complete', 'delivered', 'cancelled'].includes(o.stage)) return;
        pkgs.push({
          dir: 'out', type: 'order', id: o.id, label: o.name || 'Order',
          carrier: o.trackingCarrier || '', tracking: o.trackingNumber || '',
          status: o.shipStatus || null, expected: o.expectedDate || null,
          date: o.deadline || null, updated: o.trackingUpdatedAt || null,
          onclick: `openOrderCard('${esc(o.id)}')`,
          editable: true, orderNumGuess: o.id.replace(/^(shopify|etsy)-/, ''),
        });
      });
    }

    if (typeof SHOPIFY_ORDERS !== 'undefined') {
      SHOPIFY_ORDERS.forEach(o => {
        if (!o.tracking || !o.tracking.number) return;
        const age = daysAgo(o.tracking.shippedAt);
        if (age != null && age > 10) return; // assume delivered
        pkgs.push({
          dir: 'out', type: 'shopify', label: (o.customerName || o.name || 'Order'),
          carrier: o.tracking.company || '', tracking: o.tracking.number,
          date: o.tracking.shippedAt || null, updated: o.tracking.shippedAt || null,
          editable: false,
        });
      });
    }

    // ohOrders (Supplies → Order History) only loads once that tab has been
    // visited this session — pull the localStorage cache in if it hasn't,
    // so incoming packages still show up without requiring a tab visit.
    if (typeof ohOrders !== 'undefined' && !ohOrders.length && !window._ohDone && typeof ohLoadCache === 'function') {
      ohLoadCache();
    }
    if (typeof ohOrders !== 'undefined') {
      ohOrders.forEach(o => {
        if (!o.shipped || o.delivered || o.status === 'Delivered') return;
        pkgs.push({
          dir: 'in', type: 'supplier', id: o.id, label: o.sup || 'Supplier order',
          carrier: o.carrier || '', tracking: o.trackingNumber || '',
          status: o.shipStatus || null, expected: o.expectedDate || null,
          date: o.shipped, updated: o.trackingUpdatedAt || null,
          onclick: `switchParent('supplies', document.querySelector('.nav-tab[data-parent=supplies]'));switchTab('order-history', document.querySelector('.sub-nav-tab[data-tab=order-history]'))`,
          editable: true, orderNumGuess: o.orderNum || '',
        });
      });
    }

    _pkgLoadManual().forEach(o => {
      pkgs.push({
        dir: o.dir === 'out' ? 'out' : 'in', type: 'manual', id: o.id, label: o.label,
        carrier: o.carrier || '', tracking: o.tracking || '',
        status: o.shipStatus || null, expected: o.expectedDate || null,
        date: o.date || null, updated: o.trackingUpdatedAt || null,
        editable: true, removable: true,
      });
    });

    // Packages missing a tracking number float to the top so they're easy to fill in.
    pkgs.sort((a, b) => {
      if (!a.tracking !== !b.tracking) return a.tracking ? 1 : -1;
      return new Date(b.date || 0) - new Date(a.date || 0);
    });
    const shown = pkgs.slice(0, 8);

    if (!shown.length) {
      body.innerHTML = '<div class="hw-loading">No packages in transit.</div>';
      return;
    }

    const CARRIER_OPTS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Other'];
    const STATUS_OPTS  = ['Label Created', 'Picked Up', 'In Transit', 'Out for Delivery', 'Delivered', 'Received'];

    body.innerHTML = shown.map((p, i) => {
      const dirIcon  = p.dir === 'out' ? '📤' : '📥';
      const trackUrl = (typeof ssTrackingUrl === 'function') ? ssTrackingUrl(p.carrier, p.tracking) : null;
      const dateStr  = p.date ? new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const relStr   = p.updated ? relTime(p.updated) : '';
      // Prefer the manually-set shipment status (e.g. "In Transit"), falling
      // back to a plain "Updated Xh ago" when only the tracking # is known.
      const statusText = p.status
        ? (relStr ? `${p.status} · ${relStr}` : p.status)
        : (p.updated ? `Updated ${relStr}` : dateStr);
      // p.expected is a plain YYYY-MM-DD from a <input type=date> — parse as
      // local calendar date, not UTC midnight, to avoid an off-by-one day.
      const expDate = p.expected ? new Date(p.expected + 'T00:00:00') : null;
      const isOverdue = expDate && !['Delivered', 'Received'].includes(p.status)
        && expDate < new Date(new Date().toDateString());
      const expText = expDate
        ? `${isOverdue ? '⚠ ' : ''}Exp ${expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : '';
      const rowId    = `hw-pkg-edit-${i}`;
      let metaText;
      if (p.tracking) {
        metaText = [p.carrier, p.tracking, statusText, expText].filter(Boolean).join(' · ');
      } else {
        const noTrackBits = [p.status, expText].filter(Boolean);
        metaText = noTrackBits.length ? `${noTrackBits.join(' · ')} — no tracking number yet` : 'No tracking number yet';
      }

      const row = `<div class="hw-pkg-row${p.onclick ? ' hw-click' : ''}"${p.onclick ? ` onclick="${p.onclick}"` : ''}>
        <span class="hw-pkg-dir">${dirIcon}</span>
        <span class="hw-pkg-info">
          <div class="hw-pkg-label">${esc(p.label)}</div>
          <div class="hw-pkg-meta">${esc(metaText)}</div>
        </span>
        ${trackUrl ? `<a href="${trackUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="home-widget-link">Track →</a>` : ''}
        ${p.editable ? `<button type="button" class="hw-pkg-edit-toggle" title="${p.tracking ? 'Edit tracking' : 'Add tracking'}" onclick="event.stopPropagation();_pkgToggleEdit('${rowId}')">${p.tracking ? '✎' : '+ Add'}</button>` : ''}
        ${p.removable ? `<button type="button" class="hw-pkg-edit-toggle" title="Remove" onclick="event.stopPropagation();_pkgRemoveManual('${esc(p.id)}')">✕</button>` : ''}
      </div>`;

      if (!p.editable) return row;

      const editForm = `<div class="hw-pkg-edit-form" id="${rowId}" style="display:none;" onclick="event.stopPropagation()">
        <select id="${rowId}-carrier">
          <option value="">— Carrier —</option>
          ${CARRIER_OPTS.map(c => `<option value="${c}"${p.carrier === c ? ' selected' : ''}>${c}</option>`).join('')}
        </select>
        <input type="text" id="${rowId}-tracking" placeholder="Tracking number" value="${esc(p.tracking)}">
        <select id="${rowId}-status">
          <option value="">— Status —</option>
          ${STATUS_OPTS.map(s => `<option value="${s}"${p.status === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
        <label class="hw-pkg-exp-label">
          Expected by
          <input type="date" id="${rowId}-expected" value="${p.expected ? esc(String(p.expected).slice(0, 10)) : ''}">
        </label>
        ${p.type !== 'manual' ? `<button type="button" class="btn btn-outline btn-sm" title="Look up via ShipStation" onclick="ssLookupTracking({numberField:'${rowId}-tracking',carrierField:'${rowId}-carrier',orderNumberGuess:'${esc(p.orderNumGuess || '')}',button:this})">🔎</button>` : ''}
        <button type="button" class="btn btn-outline btn-sm" title="Pull live status from USPS" onclick="uspsCheckStatus('${rowId}', this)">📡</button>
        <button type="button" class="btn btn-gold btn-sm" onclick="_pkgSaveTracking('${p.type}','${esc(p.id)}','${rowId}')">Save</button>
      </div>`;

      return row + editForm;
    }).join('');
  };

  window._pkgToggleEdit = function(rowId) {
    const el = document.getElementById(rowId);
    if (!el) return;
    el.style.display = (el.style.display === 'none') ? 'flex' : 'none';
  };

  window._pkgSaveTracking = function(type, id, rowId) {
    const carrier  = (document.getElementById(rowId + '-carrier').value  || '').trim();
    const tracking = (document.getElementById(rowId + '-tracking').value || '').trim();
    const statusEl = document.getElementById(rowId + '-status');
    const status   = statusEl ? (statusEl.value || '').trim() : '';
    const expectedEl = document.getElementById(rowId + '-expected');
    const expected    = expectedEl ? (expectedEl.value || '').trim() : '';

    const now = new Date().toISOString();

    if (type === 'order') {
      const o = (typeof ORDERS !== 'undefined') ? ORDERS.find(x => x.id === id) : null;
      if (!o) return;
      o.trackingCarrier = carrier || null;
      o.trackingNumber  = tracking || null;
      o.shipStatus = status || null;
      o.expectedDate = expected || null;
      o.trackingUpdatedAt = now;
      if (typeof notionUpdateOrder === 'function') notionUpdateOrder(o);
      if (typeof saveToStorage === 'function') saveToStorage();
      if (typeof renderKanban === 'function') renderKanban();
    } else if (type === 'supplier') {
      const o = (typeof ohOrders !== 'undefined') ? ohOrders.find(x => x.id === id) : null;
      if (!o) return;
      o.carrier = carrier;
      o.trackingNumber = tracking;
      o.shipStatus = status || null;
      o.expectedDate = expected || null;
      o.trackingUpdatedAt = now;
      if (typeof ohCacheLocally === 'function') ohCacheLocally();
      if (typeof ohRender === 'function') ohRender();
      if (typeof ohSyncOrder === 'function') ohSyncOrder(o);
    } else if (type === 'manual') {
      const list = _pkgLoadManual();
      const o = list.find(x => x.id === id);
      if (!o) return;
      o.carrier = carrier;
      o.tracking = tracking;
      o.shipStatus = status || null;
      o.expectedDate = expected || null;
      o.trackingUpdatedAt = now;
      _pkgSaveManual(list);
    } else {
      return;
    }

    toast('Tracking saved ✓', '✓');
    _homeRefreshPackages();
  };

  function _homeRefreshCalendar() {
    const body = document.getElementById('hw-cal-body');
    if (!body) return;

    // _calUpcomingEvents is the global populated by calendar.js after calLoadUpcoming()
    // (a rolling 60-day window, independent of whichever month the grid is showing).
    if (typeof _calUpcomingEvents !== 'undefined' && _calUpcomingEvents.length > 0) {
      const upcoming = (typeof calFilterUpcoming === 'function' ? calFilterUpcoming(_calUpcomingEvents) : _calUpcomingEvents)
        .slice(0, 5);
      if (!upcoming.length) {
        body.innerHTML = '<div class="hw-loading">No upcoming events in the next 60 days.</div>';
        return;
      }
      body.innerHTML = upcoming.map(ev => {
        const dtStr   = ev.start.dateTime || ev.start.date;
        const dt      = new Date(dtStr);
        const isAllDay = !ev.start.dateTime;
        const dayNum  = dt.getDate();
        const month   = dt.toLocaleDateString('en-US', { month: 'short' });
        const timeStr = isAllDay ? 'All day' : dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const title   = (ev.summary || '(No title)').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return `<div class="hw-cal-event"><div class="hw-cal-date"><div class="hw-cal-day">${dayNum}</div><div class="hw-cal-month">${month}</div></div><div class="hw-cal-info"><div class="hw-cal-title">${title}</div><div class="hw-cal-time">${timeStr}</div></div></div>`;
      }).join('');
    } else if (typeof calEnsureToken === 'function') {
      // calendar.js is loaded — check for a token and trigger a fetch if we have one
      calEnsureToken().then(token => {
        if (token) {
          body.innerHTML = '<div class="hw-loading">Loading events…</div>';
          if (typeof calLoadEvents === 'function') calLoadEvents();
        } else {
          body.innerHTML = '<div class="hw-loading">Sign in to Google to see events.<br><br><button class="btn btn-gold btn-sm" onclick="sbNav(\'more\',\'calendar\',null)">Open Calendar →</button></div>';
        }
      });
    } else {
      body.innerHTML = '<div class="hw-loading">Sign in to Google to see events.<br><br><button class="btn btn-gold btn-sm" onclick="sbNav(\'more\',\'calendar\',null)">Open Calendar →</button></div>';
    }
  }

  // Whenever calRender() fires (calendar tab loads events), also refresh the dashboard widget
  const _origCalRender = window.calRender;
  window.calRender = function() {
    if (_origCalRender) _origCalRender.call(this);
    _homeRefreshCalendar();
  };


  window.dashSquareLoad = function() {
    const body = document.getElementById('hw-square-body');
    if (!body) return;

    // Merge hardcoded baseline with localStorage synced data (same logic as sales.js)
    let weekends = [];
    try {
      const synced = JSON.parse(localStorage.getItem('sts-square-weekends') || '[]');
      const base = (typeof SQUARE_WEEKENDS !== 'undefined') ? SQUARE_WEEKENDS : [];
      const syncedMap = {};
      synced.forEach(w => { syncedMap[w.weekend] = w; });
      weekends = base.map(w => syncedMap[w.weekend] || w);
      synced.forEach(w => { if (!base.find(b => b.weekend === w.weekend)) weekends.push(w); });
      weekends.sort((a, b) => a.weekend < b.weekend ? -1 : a.weekend > b.weekend ? 1 : 0);
    } catch(e) {}

    if (!weekends.length) {
      body.innerHTML = '<div class="hw-loading">No sales data yet. <button class="btn btn-gold btn-sm" style="margin-left:8px" onclick="sbNav(\'more\',\'sales\',null)">Open Sales →</button></div>';
      return;
    }

    const recent  = weekends.slice(-4);
    const last    = recent[recent.length - 1];
    const prev    = recent[recent.length - 2];
    const lastTotal = last.total || 0;
    const prevTotal = prev ? (prev.total || 0) : 0;
    const change    = prevTotal ? ((lastTotal - prevTotal) / prevTotal * 100).toFixed(0) : null;

    // Bar chart dimensions
    const maxVal  = Math.max(...recent.map(w => w.total || 0), 1);
    const BAR_H   = 80; // px total bar height area

    const bars = recent.map(w => {
      const satH = Math.round(((w.saturday || 0) / maxVal) * BAR_H);
      const sunH = Math.round(((w.sunday   || 0) / maxVal) * BAR_H);
      return `
        <div class="hw-sq-col">
          <div class="hw-sq-total">$${Math.round(w.total||0).toLocaleString()}</div>
          <div class="hw-sq-stack" style="height:${BAR_H}px;">
            <div class="hw-sq-sun" style="height:${sunH}px;"></div>
            <div class="hw-sq-sat" style="height:${satH}px;"></div>
          </div>
          <div class="hw-sq-lbl">${w.label}</div>
        </div>`;
    }).join('');

    const changeHtml = change !== null
      ? `<span class="hw-sq-delta ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${change}% vs prior</span>`
      : '';

    body.innerHTML = `
      <div class="hw-sq-bars">
        ${bars}
      </div>
      <div class="hw-sq-foot">
        <div class="hw-sq-legend">
          <span class="hw-sq-key"><span class="hw-sq-swatch hw-sq-sat"></span>Sat</span>
          <span class="hw-sq-key"><span class="hw-sq-swatch hw-sq-sun"></span>Sun</span>
        </div>
        <div class="hw-sq-meta">
          ${changeHtml}${changeHtml ? ' · ' : ''}${last.num_transactions || 0} transactions
        </div>
      </div>`;
  };

  window.sbNav = function(parentId, subId) {
    switchParent(parentId, _navTabEl(parentId), true, true);
    switchSubTab(subId, null, false);
    _sbSetActive(subId);
    sbClose();
  };

  window.sbNavDirect = function(tabId) {
    switchTab(tabId, _navTabEl(tabId));
    _sbSetActive(tabId);
    sbClose();
  };

  window._sbSetActive = function(tabId) {
    document.querySelectorAll('.sb-item').forEach(i => {
      i.classList.remove('sb-active');
      i.removeAttribute('aria-current');
    });
    const target = document.querySelector('.sb-item[data-sb="' + tabId + '"]');
    if (target) {
      target.classList.add('sb-active');
      // The highlight is colour-only; aria-current is what tells a screen
      // reader which of the 18 rows you are actually on.
      target.setAttribute('aria-current', 'page');
    }
    const titleEl = document.getElementById('sbPageTitle');
    if (titleEl) titleEl.textContent = SB_TITLES[tabId] || tabId;
    _botnavSetActive(tabId);
  };

  window._botnavSetActive = function(tabId) {
    const key = BOTNAV_MAP[tabId] || 'more';
    document.querySelectorAll('.botnav-item').forEach(b => {
      const active = b.getAttribute('data-target') === key;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  };

  window._sbSync = function() {
    const activeSub = document.querySelector('.sub-nav.active .sub-nav-tab.active');
    if (activeSub) { _sbSetActive(activeSub.getAttribute('data-tab')); return; }
    const activeDirect = document.querySelector('.nav-tab.active');
    if (activeDirect) {
      const id = activeDirect.getAttribute('data-tab') || activeDirect.getAttribute('data-parent');
      if (id) _sbSetActive(id);
    }
  };

  // ── Mobile drawer ────────────────────────────────────
  // Below 769px the sidebar is the *only* navigation in the app, so it gets
  // the full drawer treatment: scroll lock, swipe-to-close, Escape, and
  // focus handoff. Above it the sidebar is a static rail and every one of
  // these is a no-op.
  const _sbEl      = () => document.getElementById('appSidebar');
  const _sbOverlay = () => document.getElementById('sidebarOverlay');
  const _sbBtn     = () => document.getElementById('sbMenuBtn');
  const _sbDrawerMode = () => window.matchMedia('(max-width: 768px)').matches;
  const _sbIsOpen  = () => !!(_sbEl() && _sbEl().classList.contains('sb-open'));

  // Two triggers open the same drawer now (topbar hamburger, bottom-bar
  // More), so aria-expanded has to be kept in sync on both, and focus has
  // to return to *whichever one* was actually used, not always the
  // hamburger — a keyboard user tabbed to More expects Enter to send them
  // back to More, not jump them across the screen to the hamburger.
  const _sbAllBtns = () => [_sbBtn(), document.getElementById('botnavMoreBtn')].filter(Boolean);
  let _sbReturnFocusTo = null;

  window.sbOpen = function() {
    const sb = _sbEl(), ov = _sbOverlay();
    if (!sb || _sbIsOpen()) return;
    const active = document.activeElement;
    _sbReturnFocusTo = (active && active !== document.body && document.body.contains(active)) ? active : null;
    sb.classList.add('sb-open');
    if (ov) ov.classList.add('active');
    _sbAllBtns().forEach(b => b.setAttribute('aria-expanded', 'true'));
    document.body.classList.add('sb-scroll-lock');
    if (_sbDrawerMode()) {
      const first = sb.querySelector('.sb-item');
      if (first) first.focus();
    }
  };

  window.sbClose = function() {
    const sb = _sbEl(), ov = _sbOverlay();
    if (!sb) return;
    // If the drawer is closing out from under the keyboard, hand focus back
    // to whichever trigger opened it rather than dropping it on <body>.
    const focusWasInside = _sbDrawerMode() && sb.contains(document.activeElement);
    sb.classList.remove('sb-open');
    if (ov) ov.classList.remove('active');
    _sbAllBtns().forEach(b => b.setAttribute('aria-expanded', 'false'));
    document.body.classList.remove('sb-scroll-lock');
    if (focusWasInside) {
      const back = _sbReturnFocusTo || _sbBtn();
      if (back) back.focus();
    }
    _sbReturnFocusTo = null;
  };

  window.sbToggle = function() {
    if (_sbIsOpen()) sbClose(); else sbOpen();
  };

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && _sbIsOpen() && _sbDrawerMode()) { sbClose(); return; }

    // The open drawer covers the page like a modal, so keep Tab inside it —
    // otherwise focus walks off into content the user cannot see or scroll to.
    if (e.key === 'Tab' && _sbIsOpen() && _sbDrawerMode()) {
      const sb = _sbEl();
      const stops = sb ? sb.querySelectorAll('.sb-item, .sb-foot-btn') : [];
      if (!stops.length) return;
      const first = stops[0], last = stops[stops.length - 1];
      const inside = sb.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault(); first.focus();
      }
      return;
    }

    // The nav rows are <div role="button">, so Enter/Space have to be wired
    // up by hand to match what a real button would do.
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const item = e.target.closest && e.target.closest('.sb-item');
    if (!item) return;
    e.preventDefault();
    item.click();
  });

  // Rotating a phone to landscape (or resizing a desktop window down past
  // the breakpoint and back) must never leave a stuck overlay or a locked
  // body behind.
  window.addEventListener('resize', function() {
    if (!_sbDrawerMode() && _sbIsOpen()) sbClose();
  });

  // ── Swipe the drawer closed ──────────────────────────
  (function sbSwipeToClose() {
    let startX = 0, startY = 0, axis = null, tracking = false, width = 0;

    function reset(sb, ov) {
      sb.style.transition = '';
      sb.style.transform  = '';
      if (ov) ov.style.opacity = '';
      tracking = false; axis = null;
    }

    document.addEventListener('touchstart', function(e) {
      if (!_sbDrawerMode() || !_sbIsOpen() || e.touches.length !== 1) return;
      const sb = _sbEl();
      const ov = _sbOverlay();
      if (!sb || !(sb.contains(e.target) || (ov && ov.contains(e.target)))) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      width  = sb.offsetWidth || 1;
      axis = null; tracking = true;
      sb.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
      if (!tracking) return;
      const sb = _sbEl(), ov = _sbOverlay();
      if (!sb) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (axis === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        // Vertical: this is a scroll of the nav list, not a swipe. Let it go.
        if (axis === 'y') { reset(sb, ov); return; }
      }
      const off = Math.min(0, dx);          // drag left only
      sb.style.transform = 'translateX(' + off + 'px)';
      if (ov) ov.style.opacity = String(1 - Math.min(1, -off / width));
    }, { passive: true });

    function end(e) {
      if (!tracking) return;
      const sb = _sbEl(), ov = _sbOverlay();
      if (!sb) { tracking = false; return; }
      const dx = (e.changedTouches && e.changedTouches[0])
        ? e.changedTouches[0].clientX - startX : 0;
      const shouldClose = axis === 'x' && -dx > width * 0.3;
      reset(sb, ov);
      if (shouldClose) sbClose();
    }
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
  })();

  document.addEventListener('DOMContentLoaded', function() {
    // On a completely fresh session (no saved nav), default to the home dashboard
    try { if (!localStorage.getItem('sts-nav-parent')) localStorage.setItem('sts-nav-parent', 'home'); } catch(e) {}
    // Sync sidebar highlight after _navRestore fires (which runs at setTimeout 0)
    setTimeout(_sbSync, 60);

    // Mirror active-order badge count from hidden nav badge to sidebar badge
    const srcBadge = document.getElementById('badge-active');
    const dstBadge = document.getElementById('sb-badge-active');
    if (srcBadge && dstBadge) {
      dstBadge.textContent = srcBadge.textContent;
      new MutationObserver(function() {
        dstBadge.textContent = srcBadge.textContent;
      }).observe(srcBadge, { childList: true, characterData: true, subtree: true });
    }
  });
})();
