// ════════════════════════════════════════════
//  COMMAND PALETTE  —  js/palette.js
//  Global Ctrl/Cmd+K search across orders, customers, notes and
//  app navigation. Fully self-contained: injects its own styles
//  and markup, and only *reads* the other modules' globals
//  (ORDERS / CUSTOMERS / NOTES_DATA / STAGES) — it never mutates
//  another tab's state except through their public open/switch
//  functions (openOrderCard, openCustomerDrawer, switchTab).
// ════════════════════════════════════════════
(function () {
  'use strict';

  // ── Navigation targets (labels mirror the nav/sub-nav tabs) ──
  const NAV_ITEMS = [
    { icon: '🏠', label: 'Home Dashboard',          go: 'home' },
    { icon: '📋', label: 'Custom Orders Board',     go: 'dashboard' },
    { icon: '✚',  label: 'New Order (Intake)',      run: () => window.open('intake.html', '_blank') },
    { icon: '📬', label: 'Ready to Pick Up / Ship', go: 'production' },
    { icon: '👥', label: 'Customers',               go: 'customers' },
    { icon: '🖨', label: 'Print Order Bag',         go: 'print-bag' },
    { icon: '📦', label: 'To Restock',              go: 'to-restock' },
    { icon: '💎', label: 'Adjust Inventory',        go: 'inv-adjust' },
    { icon: '📊', label: 'Production Report',       go: 'prod-report' },
    { icon: '🔄', label: 'Replenishment',           go: 'replenish' },
    { icon: '🛒', label: 'Order Materials (Supplier)', go: 'supplier' },
    { icon: '📜', label: 'Supplier Order History',  go: 'order-history' },
    { icon: '📚', label: 'Materials Library',       go: 'materials' },
    { icon: '🚗', label: 'Trips',                   go: 'triplog' },
    { icon: '📧', label: 'Gmail',                   go: 'gmail' },
    { icon: '📝', label: 'Notes',                   go: 'notes' },
    { icon: '🎨', label: 'Designs',                 go: 'designs' },
    { icon: '📊', label: 'Sales',                   go: 'sales' },
    { icon: '📅', label: 'Calendar',                go: 'calendar' },
    { icon: '🔗', label: 'PJ Calculator',           go: 'pj-calc' },
    { icon: '📖', label: 'PJ Reference',            go: 'pj-ref' },
  ];

  const CSS = `
  .cp-bg { position: fixed; inset: 0; z-index: 4000; background: rgba(15,30,40,0.45);
    -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
    display: none; align-items: flex-start; justify-content: center; padding: 10vh 16px 16px; }
  .cp-bg.open { display: flex; }
  .cp-panel { width: 100%; max-width: 620px; background: var(--card-bg, #fff);
    border: 1px solid var(--bdr, #B0CDE0); border-radius: var(--rad-lg, 14px);
    box-shadow: var(--shadow-lg, 0 12px 28px rgba(0,0,0,0.25));
    display: flex; flex-direction: column; overflow: hidden; max-height: 72vh; }
  .cp-input-row { display: flex; align-items: center; gap: 10px; padding: 13px 16px;
    border-bottom: 1px solid var(--bdr-light, #C8DFEE); }
  .cp-input-row svg { flex-shrink: 0; color: var(--text3, #6A8898); }
  .cp-input { flex: 1; border: none; outline: none; background: transparent;
    font-size: 15.5px; color: var(--text, #1A2E38); font-family: inherit; min-width: 0; }
  .cp-input::placeholder { color: var(--text-dim, #7A9AAA); }
  .cp-list { overflow-y: auto; padding: 6px 0 8px; flex: 1; }
  .cp-group { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px;
    color: var(--text3, #6A8898); padding: 10px 16px 4px; }
  .cp-item { display: flex; align-items: center; gap: 11px; padding: 8px 16px; cursor: pointer; }
  .cp-item.sel { background: var(--accent-bg, #FDF6E8); box-shadow: inset 3px 0 0 var(--accent, #C9983A); }
  .cp-ico { width: 22px; text-align: center; font-size: 16px; flex-shrink: 0; }
  .cp-txt { min-width: 0; flex: 1; }
  .cp-title { font-size: 13.5px; font-weight: 600; color: var(--text, #1A2E38);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cp-sub { font-size: 11.5px; color: var(--text3, #6A8898);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
  .cp-badge { font-size: 10.5px; font-weight: 700; color: var(--text3, #6A8898);
    background: var(--surface, #EBF5FB); border: 1px solid var(--bdr-light, #C8DFEE);
    border-radius: 6px; padding: 2px 7px; flex-shrink: 0; }
  .cp-empty { text-align: center; color: var(--text3, #6A8898); font-size: 13px; padding: 26px 16px; }
  .cp-foot { display: flex; gap: 14px; padding: 8px 16px; border-top: 1px solid var(--bdr-light, #C8DFEE);
    font-size: 11px; color: var(--text-dim, #7A9AAA); }
  .cp-foot b { font-weight: 600; color: var(--text3, #6A8898); }
  @media (max-width: 600px) {
    .cp-bg { padding: 8px; align-items: stretch; }
    .cp-panel { max-height: 88vh; max-width: none; }
    .cp-foot { display: none; }
  }`;

  // Styles go in at load (the header search button needs them immediately);
  // the palette DOM itself is built lazily on first open.
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let _built = false, _sel = 0, _results = [];

  function build() {
    if (_built) return;
    _built = true;
    const bg = document.createElement('div');
    bg.className = 'cp-bg';
    bg.id = 'cpBg';
    bg.innerHTML = `
      <div class="cp-panel" role="dialog" aria-label="Search">
        <div class="cp-input-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input class="cp-input" id="cpInput" type="text" autocomplete="off" spellcheck="false"
            placeholder="Search orders, customers, notes… or jump to a tab">
        </div>
        <div class="cp-list" id="cpList"></div>
        <div class="cp-foot"><span><b>↑↓</b> navigate</span><span><b>↵</b> open</span><span><b>esc</b> close</span></div>
      </div>`;
    document.body.appendChild(bg);

    bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
    document.getElementById('cpInput').addEventListener('input', e => query(e.target.value));
    document.getElementById('cpList').addEventListener('mousemove', e => {
      const item = e.target.closest('.cp-item');
      if (!item) return;
      const i = parseInt(item.dataset.i, 10);
      if (i !== _sel) { _sel = i; paintSel(); }
    });
    document.getElementById('cpList').addEventListener('click', e => {
      const item = e.target.closest('.cp-item');
      if (item) activate(parseInt(item.dataset.i, 10));
    });
  }

  function open() {
    build();
    document.getElementById('cpBg').classList.add('open');
    const input = document.getElementById('cpInput');
    input.value = '';
    query('');
    // rAF so the focus lands after the panel is displayed (iOS keyboard)
    requestAnimationFrame(() => input.focus());
  }
  function close() {
    const bg = document.getElementById('cpBg');
    if (bg) bg.classList.remove('open');
  }
  function isOpen() {
    const bg = document.getElementById('cpBg');
    return !!bg && bg.classList.contains('open');
  }

  // ── Search ──────────────────────────────────
  function stageLabel(id) {
    if (typeof STAGES === 'undefined') return id || '';
    const s = STAGES.find(x => x.id === id);
    return s ? s.label : (id || '');
  }

  // Lower score = better. null = no match.
  function matchScore(hay, tokens) {
    let total = 0;
    for (const t of tokens) {
      let best = null;
      for (let f = 0; f < hay.length; f++) {
        const h = hay[f];
        if (!h) continue;
        const idx = h.indexOf(t);
        if (idx === -1) continue;
        const s = (idx === 0 ? 0 : (h[idx - 1] === ' ' || h[idx - 1] === '-' ? 1 : 2)) + f * 0.1;
        if (best === null || s < best) best = s;
      }
      if (best === null) return null; // every token must match
      total += best;
    }
    return total;
  }

  function query(raw) {
    const q = raw.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/) : [];
    const groups = [];

    if (!q) {
      // Empty query: active orders due soonest, then all navigation
      if (typeof ORDERS !== 'undefined') {
        const active = ORDERS.filter(o => o.stage !== 'complete' && o.stage !== 'cancelled')
          .sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1)
          .slice(0, 5);
        if (active.length) groups.push({ label: 'Active Orders', items: active.map(orderItem) });
      }
      groups.push({ label: 'Go to', items: NAV_ITEMS.map(navItem) });
      render(groups);
      return;
    }

    // Orders — search name, email, phone, id, order #, notes, materials, items, stage
    if (typeof ORDERS !== 'undefined') {
      const hits = [];
      for (const o of ORDERS) {
        const hay = [
          (o.name || '').toLowerCase(),
          (o.email || '').toLowerCase(),
          String(o.phone || '').toLowerCase(),
          String(o.id || '').toLowerCase(),
          String(o.sourceOrderNumber || '').toLowerCase(),
          ((o.items || []).map(it => it.name).join(' ') || '').toLowerCase(),
          (o.notes || '').toLowerCase(),
          (o.materials || '').toLowerCase(),
          stageLabel(o.stage).toLowerCase(),
        ];
        let s = matchScore(hay, tokens);
        if (s === null) continue;
        if (o.stage === 'complete' || o.stage === 'cancelled') s += 5; // done orders rank last
        hits.push([s, o]);
      }
      hits.sort((a, b) => a[0] - b[0]);
      if (hits.length) groups.push({ label: 'Orders', items: hits.slice(0, 8).map(h => orderItem(h[1])) });
    }

    // Customers
    if (typeof CUSTOMERS !== 'undefined') {
      const hits = [];
      for (const c of CUSTOMERS) {
        const s = matchScore([(c.name || '').toLowerCase(), (c.email || '').toLowerCase()], tokens);
        if (s !== null) hits.push([s, c]);
      }
      hits.sort((a, b) => a[0] - b[0]);
      if (hits.length) groups.push({ label: 'Customers', items: hits.slice(0, 6).map(h => customerItem(h[1])) });
    }

    // Notes
    if (typeof NOTES_DATA !== 'undefined') {
      const hits = [];
      for (const n of NOTES_DATA) {
        const s = matchScore([(n.text || '').toLowerCase()], tokens);
        if (s !== null) hits.push([s, n]);
      }
      hits.sort((a, b) => a[0] - b[0]);
      if (hits.length) groups.push({ label: 'Notes', items: hits.slice(0, 5).map(h => noteItem(h[1])) });
    }

    // Navigation
    {
      const hits = [];
      for (const nv of NAV_ITEMS) {
        const s = matchScore([nv.label.toLowerCase()], tokens);
        if (s !== null) hits.push([s, nv]);
      }
      hits.sort((a, b) => a[0] - b[0]);
      if (hits.length) groups.push({ label: 'Go to', items: hits.slice(0, 6).map(h => navItem(h[1])) });
    }

    render(groups);
  }

  // ── Result item builders ────────────────────
  const TYPE_ICONS = { repair: '🔧', resize: '💎', 'etsy-order': '🛍', 'website-order': '🌐', 'square-item': '🟦' };

  function orderItem(o) {
    const bits = [stageLabel(o.stage)];
    if (o.deadline && typeof fmtDate === 'function') bits.push('Due ' + fmtDate(o.deadline));
    if (o.price && typeof fmtPrice === 'function') bits.push(fmtPrice(o.price));
    return {
      icon: TYPE_ICONS[o.orderType] || '💍',
      title: o.name || '(no name)',
      sub: bits.filter(Boolean).join(' · '),
      badge: 'order',
      run: () => { if (typeof openOrderCard === 'function') openOrderCard(o.id); },
    };
  }
  function customerItem(c) {
    const bits = [];
    if (c.totalOrders) bits.push(c.totalOrders + ' order' + (c.totalOrders === 1 ? '' : 's'));
    if (c.email) bits.push(c.email);
    return {
      icon: '👤',
      title: c.name || '(no name)',
      sub: bits.join(' · '),
      badge: 'customer',
      run: () => {
        if (typeof switchTab === 'function') switchTab('customers');
        const idx = CUSTOMERS.indexOf(c);
        if (idx >= 0 && typeof openCustomerDrawer === 'function') openCustomerDrawer(idx);
      },
    };
  }
  function noteItem(n) {
    return {
      icon: n.done ? '✅' : '📝',
      title: n.text || '',
      sub: n.block || '',
      badge: 'note',
      run: () => { if (typeof switchTab === 'function') switchTab('notes'); },
    };
  }
  function navItem(nv) {
    return {
      icon: nv.icon,
      title: nv.label,
      sub: '',
      badge: 'tab',
      run: nv.run || (() => { if (typeof switchTab === 'function') switchTab(nv.go); }),
    };
  }

  // ── Render ──────────────────────────────────
  function render(groups) {
    const list = document.getElementById('cpList');
    _results = [];
    _sel = 0;
    if (!groups.length) {
      list.innerHTML = '<div class="cp-empty">No matches — try a customer name, order #, or tab name</div>';
      return;
    }
    let html = '';
    for (const g of groups) {
      html += '<div class="cp-group">' + esc(g.label) + '</div>';
      for (const it of g.items) {
        const i = _results.length;
        _results.push(it);
        html += '<div class="cp-item' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '">' +
          '<span class="cp-ico">' + it.icon + '</span>' +
          '<span class="cp-txt"><span class="cp-title">' + esc(it.title) + '</span>' +
          (it.sub ? '<span class="cp-sub" style="display:block">' + esc(it.sub) + '</span>' : '') +
          '</span><span class="cp-badge">' + it.badge + '</span></div>';
      }
    }
    list.innerHTML = html;
    list.scrollTop = 0;
  }

  function paintSel() {
    document.querySelectorAll('#cpList .cp-item').forEach(el => {
      el.classList.toggle('sel', parseInt(el.dataset.i, 10) === _sel);
    });
    const el = document.querySelector('#cpList .cp-item.sel');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function activate(i) {
    const it = _results[i];
    if (!it) return;
    close();
    try { it.run(); } catch (e) { console.warn('palette action failed:', e); }
    // switchTab() alone doesn't refresh the sidebar highlight/topbar title
    if (typeof _sbSync === 'function') _sbSync();
  }

  // ── Keyboard ────────────────────────────────
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      isOpen() ? close() : open();
      return;
    }
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (_sel < _results.length - 1) { _sel++; paintSel(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (_sel > 0) { _sel--; paintSel(); } }
    else if (e.key === 'Enter') { e.preventDefault(); activate(_sel); }
  });

  window.paletteOpen = open;
})();
