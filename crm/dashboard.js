// ════════════════════════════════════════════
//  DASHBOARD TAB  —  crm/dashboard.js
//  Quick stats + live data from Gmail/Notion/Asana
// ════════════════════════════════════════════

CRM.registerTab({
  id: 'dashboard',
  label: 'Dashboard',
  icon: '◈',

  render(el) {
    el.innerHTML = `
      <!-- Stats row -->
      <div class="grid-4" id="dash-stats" style="margin-bottom:20px;">
        <div class="stat-tile"><div class="stat-label">Open Orders</div><div class="stat-value" id="stat-orders">—</div><div class="stat-sub">active</div></div>
        <div class="stat-tile"><div class="stat-label">Unread Email</div><div class="stat-value" id="stat-email">—</div><div class="stat-sub">in inbox</div></div>
        <div class="stat-tile"><div class="stat-label">ClickUp Tasks</div><div class="stat-value" id="stat-tasks">—</div><div class="stat-sub">open</div></div>
        <div class="stat-tile"><div class="stat-label">Notion Orders</div><div class="stat-value" id="stat-notion">—</div><div class="stat-sub">in database</div></div>
      </div>

      <div class="grid-2" style="gap:16px;">

        <!-- Asana tasks -->
        <div class="card">
          <div class="card-head">
            <span class="card-title-icon">✅</span> ClickUp Tasks
            <div class="card-head-actions">
              <button class="btn btn-outline btn-sm" onclick="Dashboard.refreshClickUp()">Refresh</button>
            </div>
          </div>
          <div class="card-body" id="dash-asana">
            <div class="empty-state"><div class="spinner"></div><p style="margin-top:10px;">Loading…</p></div>
          </div>
        </div>

        <!-- Gmail threads -->
        <div class="card">
          <div class="card-head">
            <span class="card-title-icon">✉️</span> Recent Email
            <div class="card-head-actions">
              <button class="btn btn-outline btn-sm" onclick="Dashboard.refreshGmail()">Refresh</button>
            </div>
          </div>
          <div class="card-body" id="dash-gmail">
            <div class="empty-state"><div class="spinner"></div><p style="margin-top:10px;">Loading…</p></div>
          </div>
        </div>

        <!-- Notion orders -->
        <div class="card" style="grid-column:1/-1;">
          <div class="card-head">
            <span class="card-title-icon">📋</span> Notion Orders
            <div class="card-head-actions">
              <button class="btn btn-outline btn-sm" onclick="Dashboard.refreshNotion()">Refresh</button>
            </div>
          </div>
          <div class="card-body" id="dash-notion">
            <div class="empty-state"><div class="spinner"></div><p style="margin-top:10px;">Loading…</p></div>
          </div>
        </div>

      </div>`;

    Dashboard._loadAll();
  },

  onActivate() { Dashboard._loadAll(); }
});

// ── Dashboard module ─────────────────────────
window.Dashboard = (() => {

  const NOTION_DB    = 'edee1ecc-7d11-428a-9efc-d17b8cbf195d';
  const CLICKUP_LIST = '901416911135';

  function _loadAll() {
    refreshClickUp();
    refreshGmail();
    refreshNotion();
  }

  // ── ClickUp ────────────────────────────────
  function refreshClickUp() {
    const el = document.getElementById('dash-asana');
    if (!el) return;
    _spinner(el);

    _sendPrompt('crm-clickup-tasks: ' + JSON.stringify({ list: CLICKUP_LIST }));

    // Listen for response
    _once('crm-clickup-tasks', (data) => {
      const tasks = data.tasks || [];
      CRM.setBadge('dashboard', tasks.length);
      document.getElementById('stat-tasks').textContent = tasks.length;

      if (!tasks.length) { _empty(el, '✅', 'No open tasks'); return; }
      el.innerHTML = tasks.slice(0,8).map(t => `
        <div class="list-row">
          <div class="list-row-main">
            <div class="list-row-title">${esc(t.name)}</div>
            <div class="list-row-sub">${esc(t.assignee || '')}${t.due_on ? ' · Due ' + CRM.fmtDate(t.due_on) : ''}</div>
          </div>
          ${t.due_on ? `<span class="badge ${_dueBadge(t.due_on)}">${CRM.fmtDate(t.due_on)}</span>` : ''}
        </div>`).join('');
      CRM.save('dash-clickup', tasks);
    }, 6000, () => _loadCached(el, 'dash-clickup', _renderClickUpTasks));
  }

  function _renderClickUpTasks(el, tasks) {
    if (!tasks || !tasks.length) { _empty(el, '✅', 'No open tasks'); return; }
    el.innerHTML = tasks.slice(0,8).map(t => `
      <div class="list-row">
        <div class="list-row-main">
          <div class="list-row-title">${esc(t.name)}</div>
          <div class="list-row-sub">${esc(t.assignee || '')}${t.due_on ? ' · Due ' + CRM.fmtDate(t.due_on) : ''}</div>
        </div>
        ${t.due_on ? `<span class="badge ${_dueBadge(t.due_on)}">${CRM.fmtDate(t.due_on)}</span>` : ''}
      </div>`).join('');
  }

  // ── Gmail ──────────────────────────────────
  function refreshGmail() {
    const el = document.getElementById('dash-gmail');
    if (!el) return;
    _spinner(el);

    // Try loading from the scheduled brief JSON first
    fetch('./gmail-brief.json?_=' + Date.now())
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.threads) {
          _renderGmailThreads(el, data.threads);
          document.getElementById('stat-email').textContent = data.unread ?? data.threads.length;
          CRM.save('dash-gmail', data);
        } else {
          _loadCached(el, 'dash-gmail', (el, d) => {
            _renderGmailThreads(el, d.threads || []);
            document.getElementById('stat-email').textContent = d.unread ?? '—';
          });
        }
      })
      .catch(() => _loadCached(el, 'dash-gmail', (el, d) => {
        _renderGmailThreads(el, d.threads || []);
        document.getElementById('stat-email').textContent = d.unread ?? '—';
      }));
  }

  function _renderGmailThreads(el, threads) {
    if (!threads.length) { _empty(el, '✉️', 'No recent emails'); return; }
    el.innerHTML = threads.slice(0,8).map(t => `
      <div class="list-row">
        <div class="avatar">${CRM.initials(t.from || t.sender || '?')}</div>
        <div class="list-row-main">
          <div class="list-row-title">${esc(t.subject || '(no subject)')}</div>
          <div class="list-row-sub">${esc(t.from || t.sender || '')}${t.snippet ? ' — ' + esc(t.snippet.slice(0,60)) : ''}</div>
        </div>
        <div class="list-row-meta">${t.date ? CRM.fmtDate(t.date) : ''}</div>
      </div>`).join('');
  }

  // ── Notion ─────────────────────────────────
  function refreshNotion() {
    const el = document.getElementById('dash-notion');
    if (!el) return;
    _spinner(el);

    _sendPrompt('crm-notion-orders: ' + JSON.stringify({ database_id: NOTION_DB }));

    _once('crm-notion-orders', (data) => {
      const orders = data.orders || [];
      document.getElementById('stat-notion').textContent = orders.length;
      // Also update open-orders stat using localStorage orders as fallback
      const lsOrders = _getWorkflowOrders();
      document.getElementById('stat-orders').textContent =
        lsOrders.filter(o => o.stage !== 'complete').length || orders.filter(o => o.stage !== 'Completed').length;

      _renderNotionOrders(el, orders);
      CRM.save('dash-notion', orders);
    }, 6000, () => _loadCached(el, 'dash-notion', _renderNotionOrders));
  }

  function _renderNotionOrders(el, orders) {
    if (!orders || !orders.length) {
      _empty(el, '📋', 'No Notion orders found');
      // Fallback: show local orders
      const local = _getWorkflowOrders().filter(o => o.stage !== 'complete').slice(0,6);
      if (local.length) {
        el.innerHTML = `<p style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">Showing local orders (Notion not connected)</p>` +
          local.map(o => _orderRow(o)).join('');
      }
      return;
    }
    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="color:var(--text-dim);font-size:11px;border-bottom:1px solid var(--bdr);">
          <th style="text-align:left;padding:6px 8px;">Customer</th>
          <th style="text-align:left;padding:6px 8px;">Stage</th>
          <th style="text-align:left;padding:6px 8px;">Price</th>
          <th style="text-align:left;padding:6px 8px;">Deadline</th>
        </tr></thead>
        <tbody>${orders.slice(0,10).map(o => `
          <tr style="border-bottom:1px solid var(--bdr-light);">
            <td style="padding:8px;">${esc(o.name || o.customer || '—')}</td>
            <td style="padding:8px;"><span class="badge badge-gold">${esc(o.stage || '—')}</span></td>
            <td style="padding:8px;">${CRM.fmtPrice(o.price)}</td>
            <td style="padding:8px;">${CRM.fmtDate(o.deadline)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.getElementById('stat-notion').textContent = orders.length;
  }

  // ── Util ───────────────────────────────────
  function _getWorkflowOrders() {
    try { return JSON.parse(localStorage.getItem('sts-orders') || '[]'); } catch(e) { return []; }
  }

  function _orderRow(o) {
    return `<div class="list-row">
      <div class="list-row-main">
        <div class="list-row-title">${esc(o.name)}</div>
        <div class="list-row-sub">${esc(o.stage || '')}${o.price ? ' · ' + CRM.fmtPrice(o.price) : ''}</div>
      </div>
      ${o.deadline ? `<div class="list-row-meta">${CRM.fmtDate(o.deadline)}</div>` : ''}
    </div>`;
  }

  function _dueBadge(dateStr) {
    const diff = Math.round((new Date(dateStr) - CRM.TODAY) / 86400000);
    if (diff < 0) return 'badge-red';
    if (diff <= 3) return 'badge-gold';
    return 'badge-green';
  }

  function _spinner(el) {
    el.innerHTML = `<div class="empty-state"><div class="spinner"></div><p style="margin-top:10px;font-size:12px;">Loading…</p></div>`;
  }

  function _empty(el, icon, msg) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
  }

  function _loadCached(el, key, renderFn) {
    const cached = CRM.load(key, null);
    if (cached) { renderFn(el, cached); }
    else { _empty(el, '🔌', 'Connect your tools to see live data'); }
  }

  // Send a prompt to Cowork
  function _sendPrompt(msg) {
    if (typeof sendPrompt === 'function') sendPrompt(msg);
    else if (window !== window.parent) window.parent.postMessage({ type: 'sts-sendPrompt', msg }, '*');
  }

  // One-shot message listener with timeout fallback
  function _once(type, cb, timeoutMs, fallback) {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      if (typeof fallback === 'function') fallback();
    }, timeoutMs);

    function handler(e) {
      if (e.data && e.data.type === type) {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        cb(e.data);
      }
    }
    window.addEventListener('message', handler);
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { refreshClickUp, refreshGmail, refreshNotion, _loadAll };
})();
