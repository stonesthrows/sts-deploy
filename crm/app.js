// ════════════════════════════════════════════
//  CRM CORE  —  crm/app.js
//  Tab registry, switching, helpers, bootstrap
// ════════════════════════════════════════════

window.CRM = (() => {

  // ── Tab registry ────────────────────────────
  const _tabs = [];   // [{ id, label, icon, render, onActivate }]

  function registerTab({ id, label, icon = '', render, onActivate }) {
    _tabs.push({ id, label, icon, render, onActivate });

    // Create nav tab
    const nav = document.getElementById('main-nav');
    const addBtn = document.getElementById('add-tab-btn');
    const tab = document.createElement('div');
    tab.className = 'nav-tab';
    tab.dataset.tab = id;
    tab.innerHTML = `${icon ? icon + ' ' : ''}${label}`;
    tab.onclick = () => switchTab(id);
    nav.insertBefore(tab, addBtn);

    // Create panel
    const panels = document.getElementById('tab-panels');
    const panel = document.createElement('div');
    panel.id = 'tab-' + id;
    panel.className = 'tab-panel';
    panel.innerHTML = `<div class="tab-content" id="content-${id}"></div>`;
    panels.appendChild(panel);

    // Render initial content
    if (typeof render === 'function') {
      render(document.getElementById('content-' + id));
    }
  }

  function switchTab(id) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    const panel = document.getElementById('tab-' + id);
    const navTab = document.querySelector(`.nav-tab[data-tab="${id}"]`);
    if (panel) panel.classList.add('active');
    if (navTab) navTab.classList.add('active');

    const tabDef = _tabs.find(t => t.id === id);
    if (tabDef && typeof tabDef.onActivate === 'function') {
      tabDef.onActivate(document.getElementById('content-' + id));
    }
  }

  function activateFirst() {
    if (_tabs.length > 0) switchTab(_tabs[0].id);
  }

  function setBadge(tabId, count) {
    const navTab = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
    if (!navTab) return;
    let badge = navTab.querySelector('.tab-badge');
    if (count > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'tab-badge'; navTab.appendChild(badge); }
      badge.textContent = count;
    } else if (badge) {
      badge.remove();
    }
  }

  function promptAddModule() {
    const name = prompt('Module name (e.g. "Analytics", "Suppliers"):');
    if (!name || !name.trim()) return;
    const id = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (_tabs.find(t => t.id === id)) { toast('Tab already exists'); return; }
    registerTab({
      id, label: name.trim(), icon: '🧩',
      render(el) {
        el.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🧩</div>
            <p style="font-weight:600;margin-bottom:6px;">${name.trim()}</p>
            <p>This module is a placeholder. Drop a <code>crm/${id}.js</code> file and call <code>CRM.registerTab()</code> to wire it up.</p>
          </div>`;
      }
    });
    switchTab(id);
    toast(`"${name.trim()}" module added`);
  }

  // ── Helpers ──────────────────────────────────
  const TODAY = new Date(); TODAY.setHours(0,0,0,0);

  function fmtDate(ds) {
    if (!ds || ds === '—') return '—';
    return new Date(ds).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  }

  function fmtPrice(p) { return p ? '$' + Number(p).toLocaleString() : '—'; }

  function initials(name) {
    return (name || '?').replace(/[()0-9\-]/g,'').trim()
      .split(' ').filter(Boolean).map(w => w[0]).join('').slice(0,2).toUpperCase() || '??';
  }

  function toast(msg, icon = '✓') {
    const el = document.getElementById('toast');
    el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function save(key, val) {
    try { localStorage.setItem('crm-' + key, JSON.stringify(val)); } catch(e) {}
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem('crm-' + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch(e) { return fallback; }
  }

  // ── Bootstrap ────────────────────────────────
  // Tabs register themselves when their scripts load.
  // After all scripts run, activate the first tab.
  window.addEventListener('load', activateFirst);

  return { registerTab, switchTab, setBadge, promptAddModule,
           fmtDate, fmtPrice, initials, toast, save, load, TODAY };
})();
