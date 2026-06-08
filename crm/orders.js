// ════════════════════════════════════════════
//  NEW ORDERS TAB  —  crm/orders.js
// ════════════════════════════════════════════

CRM.registerTab({
  id: 'orders',
  label: 'New Orders',
  icon: '＋',

  render(el) {
    el.innerHTML = `
      <div class="section-header">
        <span class="section-title">New Order</span>
      </div>

      <div class="grid-2" style="gap:20px;align-items:start;">

        <!-- Form -->
        <div class="card">
          <div class="card-head"><span class="card-title-icon">📝</span> Order Details</div>
          <div class="card-body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Customer Name *</label>
                <input class="form-input" id="ord-name" placeholder="Jane Smith">
              </div>
              <div class="form-group">
                <label class="form-label">Contact Source</label>
                <select class="form-select" id="ord-source">
                  <option>Email</option>
                  <option>Farmer's Market</option>
                  <option>Shopify Email</option>
                  <option>Etsy Message</option>
                  <option>Instagram Message</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Order Type</label>
                <select class="form-select" id="ord-type" onchange="Orders.onTypeChange()">
                  <option value="custom">Custom Order</option>
                  <option value="estimate">Estimate Request</option>
                  <option value="repair">Repair</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Pickup Location</label>
                <select class="form-select" id="ord-pickup">
                  <option>Bell Market</option>
                  <option>Mueller Market</option>
                  <option>Chaparral Crossing Market</option>
                  <option>Studio</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Price ($)</label>
                <input class="form-input" id="ord-price" type="number" placeholder="0.00" min="0">
              </div>
              <div class="form-group">
                <label class="form-label">Deadline</label>
                <input class="form-input" id="ord-deadline" type="date">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Description / Notes</label>
              <textarea class="form-textarea" id="ord-notes" placeholder="Ring size, metal, stone preferences…"></textarea>
            </div>

            <div style="display:flex;gap:10px;justify-content:flex-end;">
              <button class="btn btn-outline" onclick="Orders.clearForm()">Clear</button>
              <button class="btn btn-gold" onclick="Orders.submit()">Save Order →</button>
            </div>
          </div>
        </div>

        <!-- Recent orders -->
        <div class="card">
          <div class="card-head"><span class="card-title-icon">🕐</span> Recent Orders</div>
          <div class="card-body" id="orders-recent">
            <div class="empty-state"><div class="empty-icon">📭</div><p>No orders yet</p></div>
          </div>
        </div>

      </div>`;
  },

  onActivate() { Orders._renderRecent(); }
});

window.Orders = (() => {

  const STAGES = {
    custom:   'Inquiry',
    estimate: 'Needs Estimate',
    repair:   'Inquiry'
  };

  function onTypeChange() {
    // no visual change needed currently
  }

  function submit() {
    const name = document.getElementById('ord-name').value.trim();
    if (!name) { CRM.toast('Customer name is required', '⚠️'); return; }

    const type    = document.getElementById('ord-type').value;
    const source  = document.getElementById('ord-source').value;
    const pickup  = document.getElementById('ord-pickup').value;
    const price   = parseFloat(document.getElementById('ord-price').value) || 0;
    const deadline= document.getElementById('ord-deadline').value || null;
    const notes   = document.getElementById('ord-notes').value.trim();

    const order = {
      id:       'crm-' + Date.now(),
      name,
      type,
      source,
      pickup,
      price,
      deadline,
      notes,
      stage:    STAGES[type] || 'Inquiry',
      created:  new Date().toISOString()
    };

    const orders = CRM.load('orders', []);
    orders.unshift(order);
    CRM.save('orders', orders);

    CRM.toast(`Order saved — ${name}`);
    clearForm();
    _renderRecent();
  }

  function clearForm() {
    ['ord-name','ord-price','ord-deadline','ord-notes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  function markComplete(id) {
    const orders = CRM.load('orders', []);
    const order = orders.find(o => o.id === id);
    if (!order) return;
    const input = prompt(`Final price for ${order.name}:`, order.price || '');
    if (input === null) return;
    const price = parseFloat(input) || order.price || 0;
    order.price = price;
    order.stage = 'Completed';
    order.completedAt = new Date().toISOString();
    CRM.save('orders', orders);
    CRM.toast(`${order.name} marked complete`);
    _renderRecent();
  }

  function _renderRecent() {
    const el = document.getElementById('orders-recent');
    if (!el) return;
    const orders = CRM.load('orders', []);
    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No orders yet</p></div>`;
      return;
    }
    el.innerHTML = orders.slice(0,10).map(o => {
      const done = (o.stage || '').toLowerCase().includes('complet');
      return `
      <div class="list-row">
        <div class="avatar">${CRM.initials(o.name)}</div>
        <div class="list-row-main">
          <div class="list-row-title">${esc(o.name)}</div>
          <div class="list-row-sub">${esc(o.stage)} · ${esc(o.source)}${o.price ? ' · ' + CRM.fmtPrice(o.price) : ''}</div>
        </div>
        <div class="list-row-meta" style="display:flex;align-items:center;gap:8px;">
          <span>${CRM.fmtDate(o.created)}</span>
          ${done ? '' : `<button class="btn btn-outline btn-sm" onclick="Orders.markComplete('${o.id}')">✓ Complete</button>`}
        </div>
      </div>`;
    }).join('');
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { onTypeChange, submit, clearForm, _renderRecent, markComplete };
})();
