// ════════════════════════════════════════════
//  SALES HISTORY TAB  —  crm/sales.js
// ════════════════════════════════════════════

CRM.registerTab({
  id: 'sales',
  label: 'Sales History',
  icon: '📊',

  render(el) {
    el.innerHTML = `
      <div class="section-header">
        <span class="section-title">Sales History</span>
        <div class="section-actions">
          <select class="form-select btn-sm" id="sales-period" onchange="SalesTab.render()" style="width:140px;">
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">All time</option>
          </select>
        </div>
      </div>

      <!-- Summary stats -->
      <div class="grid-3" style="margin-bottom:20px;" id="sales-stats">
        <div class="stat-tile"><div class="stat-label">Total Revenue</div><div class="stat-value" id="sales-revenue">—</div></div>
        <div class="stat-tile"><div class="stat-label">Orders Completed</div><div class="stat-value" id="sales-count">—</div></div>
        <div class="stat-tile"><div class="stat-label">Avg Order Value</div><div class="stat-value" id="sales-avg">—</div></div>
      </div>

      <div class="card">
        <div class="card-head"><span class="card-title-icon">🧾</span> Completed Orders</div>
        <div class="card-body" id="sales-table">
          <div class="empty-state"><div class="empty-icon">📊</div><p>No completed orders yet</p></div>
        </div>
      </div>`;

    SalesTab.render();
  },

  onActivate() { SalesTab.render(); }
});

window.SalesTab = (() => {

  function _getCompleted() {
    // Pull from CRM orders + workflow orders, deduplicate by id
    const crmOrders = CRM.load('orders', []);
    let wfOrders = [];
    try { wfOrders = JSON.parse(localStorage.getItem('sts-orders') || '[]'); } catch(e) {}
    const all = [...crmOrders, ...wfOrders];
    const seen = new Set();
    return all.filter(o => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return (o.stage || '').toLowerCase().includes('complet');
    });
  }

  function render() {
    const days = parseInt(document.getElementById('sales-period')?.value || '90');
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);

    const orders = _getCompleted().filter(o => {
      const d = new Date(o.created || o.deadline || '2000-01-01');
      return d >= cutoff;
    });

    const revenue = orders.reduce((s, o) => s + (o.price || 0), 0);
    const avg = orders.length ? revenue / orders.length : 0;

    const rv = document.getElementById('sales-revenue');
    const ct = document.getElementById('sales-count');
    const av = document.getElementById('sales-avg');
    if (rv) rv.textContent = CRM.fmtPrice(revenue);
    if (ct) ct.textContent = orders.length;
    if (av) av.textContent = CRM.fmtPrice(Math.round(avg));

    const el = document.getElementById('sales-table');
    if (!el) return;

    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>No completed orders in this period</p></div>`;
      return;
    }

    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="color:var(--text-dim);font-size:11px;border-bottom:1px solid var(--bdr);">
          <th style="text-align:left;padding:6px 8px;">Customer</th>
          <th style="text-align:left;padding:6px 8px;">Type</th>
          <th style="text-align:left;padding:6px 8px;">Price</th>
          <th style="text-align:left;padding:6px 8px;">Completed</th>
          <th style="text-align:left;padding:6px 8px;">Pickup</th>
        </tr></thead>
        <tbody>${orders.map(o => `
          <tr style="border-bottom:1px solid var(--bdr-light);">
            <td style="padding:8px;">${esc(o.name)}</td>
            <td style="padding:8px;"><span class="badge badge-gray">${esc(o.type || 'custom')}</span></td>
            <td style="padding:8px;font-weight:600;">${CRM.fmtPrice(o.price)}</td>
            <td style="padding:8px;">${CRM.fmtDate(o.created || o.deadline)}</td>
            <td style="padding:8px;">${esc(o.pickup || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { render };
})();
