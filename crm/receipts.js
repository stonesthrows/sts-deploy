// ════════════════════════════════════════════
//  RECEIPTS TAB  —  crm/receipts.js
// ════════════════════════════════════════════

CRM.registerTab({
  id: 'receipts',
  label: 'Receipts',
  icon: '🧾',

  render(el) {
    el.innerHTML = `
      <div class="section-header">
        <span class="section-title">Receipts & Expenses</span>
        <div class="section-actions">
          <button class="btn btn-gold btn-sm" onclick="Receipts.showAdd()">＋ Add Receipt</button>
        </div>
      </div>

      <!-- Add form -->
      <div id="rec-add-form" style="display:none;margin-bottom:20px;">
        <div class="card">
          <div class="card-head"><span class="card-title-icon">＋</span> Log Receipt</div>
          <div class="card-body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Vendor / Supplier *</label>
                <input class="form-input" id="rec-vendor" placeholder="Rio Grande, Amazon…">
              </div>
              <div class="form-group">
                <label class="form-label">Category</label>
                <select class="form-select" id="rec-cat">
                  <option>Supplies</option>
                  <option>Tools</option>
                  <option>Shipping</option>
                  <option>Marketing</option>
                  <option>Fees</option>
                  <option>Other</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Amount ($) *</label>
                <input class="form-input" id="rec-amount" type="number" min="0" step="0.01" placeholder="0.00">
              </div>
              <div class="form-group">
                <label class="form-label">Date</label>
                <input class="form-input" id="rec-date" type="date">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Notes</label>
              <input class="form-input" id="rec-notes" placeholder="Order #, items purchased…">
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
              <button class="btn btn-outline" onclick="Receipts.hideAdd()">Cancel</button>
              <button class="btn btn-gold" onclick="Receipts.addReceipt()">Save</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Summary -->
      <div class="grid-3" style="margin-bottom:16px;">
        <div class="stat-tile"><div class="stat-label">This Month</div><div class="stat-value" id="rec-month">—</div></div>
        <div class="stat-tile"><div class="stat-label">This Quarter</div><div class="stat-value" id="rec-quarter">—</div></div>
        <div class="stat-tile"><div class="stat-label">All Time</div><div class="stat-value" id="rec-total">—</div></div>
      </div>

      <!-- Filter -->
      <div style="margin-bottom:14px;display:flex;gap:10px;">
        <select class="form-select" id="rec-cat-filter" onchange="Receipts.render()" style="max-width:160px;">
          <option value="">All categories</option>
          <option>Supplies</option><option>Tools</option><option>Shipping</option>
          <option>Marketing</option><option>Fees</option><option>Other</option>
        </select>
      </div>

      <div class="card">
        <div class="card-head"><span class="card-title-icon">🧾</span> Expenses</div>
        <div class="card-body" id="rec-list">
          <div class="empty-state"><div class="empty-icon">🧾</div><p>No receipts yet</p></div>
        </div>
      </div>`;

    Receipts.render();
  }
});

window.Receipts = (() => {

  function _receipts() { return CRM.load('receipts', []); }
  function _save(r) { CRM.save('receipts', r); }

  function showAdd() {
    document.getElementById('rec-add-form').style.display = 'block';
    // Default date to today
    const d = document.getElementById('rec-date');
    if (d && !d.value) d.value = new Date().toISOString().split('T')[0];
  }
  function hideAdd() { document.getElementById('rec-add-form').style.display = 'none'; }

  function addReceipt() {
    const vendor = document.getElementById('rec-vendor').value.trim();
    const amount = parseFloat(document.getElementById('rec-amount').value);
    if (!vendor || !amount) { CRM.toast('Vendor and amount are required', '⚠️'); return; }

    const rec = {
      id:     Date.now(),
      vendor,
      cat:    document.getElementById('rec-cat').value,
      amount,
      date:   document.getElementById('rec-date').value || new Date().toISOString().split('T')[0],
      notes:  document.getElementById('rec-notes').value.trim()
    };

    const recs = _receipts();
    recs.unshift(rec);
    _save(recs);
    hideAdd();
    ['rec-vendor','rec-amount','rec-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    CRM.toast(`Receipt saved — ${vendor}`);
    render();
  }

  function remove(id) {
    if (!confirm('Remove this receipt?')) return;
    _save(_receipts().filter(r => r.id !== id));
    render();
  }

  function render() {
    const cat   = document.getElementById('rec-cat-filter')?.value || '';
    let recs    = _receipts();
    if (cat) recs = recs.filter(r => r.cat === cat);

    // Stats (always on full list)
    const all = _receipts();
    const now = new Date();
    const thisMonth  = all.filter(r => { const d=new Date(r.date); return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear(); });
    const thisQ = all.filter(r => { const d=new Date(r.date); return Math.floor(d.getMonth()/3)===Math.floor(now.getMonth()/3) && d.getFullYear()===now.getFullYear(); });

    const sum = arr => arr.reduce((s,r) => s+(r.amount||0), 0);
    const setVal = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=CRM.fmtPrice(v); };
    setVal('rec-month',   sum(thisMonth));
    setVal('rec-quarter', sum(thisQ));
    setVal('rec-total',   sum(all));

    const el = document.getElementById('rec-list');
    if (!el) return;

    if (!recs.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🧾</div><p>${cat ? 'No matches' : 'No receipts yet'}</p></div>`;
      return;
    }

    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="color:var(--text-dim);font-size:11px;border-bottom:1px solid var(--bdr);">
          <th style="text-align:left;padding:6px 8px;">Date</th>
          <th style="text-align:left;padding:6px 8px;">Vendor</th>
          <th style="text-align:left;padding:6px 8px;">Category</th>
          <th style="text-align:right;padding:6px 8px;">Amount</th>
          <th style="text-align:left;padding:6px 8px;">Notes</th>
          <th style="padding:6px 8px;"></th>
        </tr></thead>
        <tbody>${recs.map(r => `
          <tr style="border-bottom:1px solid var(--bdr-light);">
            <td style="padding:8px;">${CRM.fmtDate(r.date)}</td>
            <td style="padding:8px;">${esc(r.vendor)}</td>
            <td style="padding:8px;"><span class="badge badge-blue">${esc(r.cat)}</span></td>
            <td style="padding:8px;text-align:right;font-weight:600;">${CRM.fmtPrice(r.amount)}</td>
            <td style="padding:8px;color:var(--text-dim);">${esc(r.notes)}</td>
            <td style="padding:8px;">
              <button class="btn btn-outline btn-sm" onclick="Receipts.remove(${r.id})" style="color:var(--text-dim);">✕</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { showAdd, hideAdd, addReceipt, remove, render };
})();
