// ════════════════════════════════════════════
//  INVENTORY TAB  —  crm/inventory.js
// ════════════════════════════════════════════

CRM.registerTab({
  id: 'inventory',
  label: 'Inventory',
  icon: '🪨',

  render(el) {
    el.innerHTML = `
      <div class="section-header">
        <span class="section-title">Inventory</span>
        <div class="section-actions">
          <button class="btn btn-gold btn-sm" onclick="Inventory.showAdd()">＋ Add Item</button>
        </div>
      </div>

      <!-- Add form (hidden by default) -->
      <div id="inv-add-form" style="display:none;margin-bottom:20px;">
        <div class="card">
          <div class="card-head"><span class="card-title-icon">＋</span> Add Inventory Item</div>
          <div class="card-body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Item Name *</label>
                <input class="form-input" id="inv-name" placeholder="14k Gold Wire, 3mm Amethyst…">
              </div>
              <div class="form-group">
                <label class="form-label">Category</label>
                <select class="form-select" id="inv-cat">
                  <option>Metal</option>
                  <option>Stone</option>
                  <option>Finding</option>
                  <option>Tool</option>
                  <option>Packaging</option>
                  <option>Other</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Quantity</label>
                <input class="form-input" id="inv-qty" type="number" min="0" placeholder="0">
              </div>
              <div class="form-group">
                <label class="form-label">Unit</label>
                <input class="form-input" id="inv-unit" placeholder="g, in, pcs…">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Cost per unit ($)</label>
                <input class="form-input" id="inv-cost" type="number" min="0" step="0.01" placeholder="0.00">
              </div>
              <div class="form-group">
                <label class="form-label">Low-stock alert at</label>
                <input class="form-input" id="inv-alert" type="number" min="0" placeholder="5">
              </div>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
              <button class="btn btn-outline" onclick="Inventory.hideAdd()">Cancel</button>
              <button class="btn btn-gold" onclick="Inventory.addItem()">Save Item</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Filter / search -->
      <div style="margin-bottom:14px;display:flex;gap:10px;">
        <input class="form-input" id="inv-search" placeholder="Search items…" oninput="Inventory.render()" style="max-width:260px;">
        <select class="form-select" id="inv-cat-filter" onchange="Inventory.render()" style="max-width:160px;">
          <option value="">All categories</option>
          <option>Metal</option><option>Stone</option><option>Finding</option>
          <option>Tool</option><option>Packaging</option><option>Other</option>
        </select>
      </div>

      <div class="card">
        <div class="card-head"><span class="card-title-icon">📦</span> Stock</div>
        <div class="card-body" id="inv-list">
          <div class="empty-state"><div class="empty-icon">🪨</div><p>No inventory items yet. Click "+ Add Item" to start.</p></div>
        </div>
      </div>`;

    Inventory.render();
  }
});

window.Inventory = (() => {

  function _items() { return CRM.load('inventory', []); }
  function _save(items) { CRM.save('inventory', items); }

  function showAdd() { document.getElementById('inv-add-form').style.display = 'block'; }
  function hideAdd() { document.getElementById('inv-add-form').style.display = 'none'; }

  function addItem() {
    const name = document.getElementById('inv-name').value.trim();
    if (!name) { CRM.toast('Item name is required', '⚠️'); return; }

    const item = {
      id:      Date.now(),
      name,
      cat:     document.getElementById('inv-cat').value,
      qty:     parseFloat(document.getElementById('inv-qty').value) || 0,
      unit:    document.getElementById('inv-unit').value.trim() || 'pcs',
      cost:    parseFloat(document.getElementById('inv-cost').value) || 0,
      alert:   parseFloat(document.getElementById('inv-alert').value) || 0,
      updated: new Date().toISOString()
    };

    const items = _items();
    items.unshift(item);
    _save(items);
    hideAdd();
    ['inv-name','inv-qty','inv-unit','inv-cost','inv-alert'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    CRM.toast(`${name} added`);
    render();
  }

  function adjust(id, delta) {
    const items = _items();
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.qty = Math.max(0, (item.qty || 0) + delta);
    item.updated = new Date().toISOString();
    _save(items);
    render();
  }

  function remove(id) {
    if (!confirm('Remove this item?')) return;
    _save(_items().filter(i => i.id !== id));
    render();
  }

  function render() {
    const el = document.getElementById('inv-list');
    if (!el) return;

    const q    = (document.getElementById('inv-search')?.value || '').toLowerCase();
    const cat  = document.getElementById('inv-cat-filter')?.value || '';
    let items  = _items();

    if (q)   items = items.filter(i => i.name.toLowerCase().includes(q));
    if (cat) items = items.filter(i => i.cat === cat);

    if (!items.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🪨</div><p>${q||cat ? 'No matches' : 'No items yet'}</p></div>`;
      return;
    }

    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="color:var(--text-dim);font-size:11px;border-bottom:1px solid var(--bdr);">
          <th style="text-align:left;padding:6px 8px;">Item</th>
          <th style="text-align:left;padding:6px 8px;">Category</th>
          <th style="text-align:center;padding:6px 8px;">Qty</th>
          <th style="text-align:left;padding:6px 8px;">Cost/unit</th>
          <th style="text-align:left;padding:6px 8px;">Updated</th>
          <th style="padding:6px 8px;"></th>
        </tr></thead>
        <tbody>${items.map(i => {
          const low = i.alert > 0 && i.qty <= i.alert;
          return `
          <tr style="border-bottom:1px solid var(--bdr-light);${low ? 'background:#FFF8EC;' : ''}">
            <td style="padding:8px;">
              ${esc(i.name)}
              ${low ? '<span class="badge badge-gold" style="margin-left:6px;">Low</span>' : ''}
            </td>
            <td style="padding:8px;"><span class="badge badge-gray">${esc(i.cat)}</span></td>
            <td style="padding:8px;text-align:center;">
              <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
                <button class="btn btn-outline btn-sm" style="padding:2px 8px;" onclick="Inventory.adjust(${i.id},-1)">−</button>
                <strong>${i.qty} ${esc(i.unit)}</strong>
                <button class="btn btn-outline btn-sm" style="padding:2px 8px;" onclick="Inventory.adjust(${i.id},1)">＋</button>
              </div>
            </td>
            <td style="padding:8px;">${i.cost ? CRM.fmtPrice(i.cost) : '—'}</td>
            <td style="padding:8px;">${CRM.fmtDate(i.updated)}</td>
            <td style="padding:8px;">
              <button class="btn btn-outline btn-sm" onclick="Inventory.remove(${i.id})" style="color:var(--text-dim);">✕</button>
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { showAdd, hideAdd, addItem, adjust, remove, render };
})();
