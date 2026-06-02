// ════════════════════════════════════════════
//  CLICKUP  —  js/clickup.js
//  Direct ClickUp API integration
//  API token + list ID stored in localStorage via ⚙ Integrations
// ════════════════════════════════════════════

const CU_API = 'https://api.clickup.com/api/v2';

function cuToken()  { return localStorage.getItem('sts-clickup-token')   || ''; }
function cuListId() { return localStorage.getItem('sts-clickup-list-id') || '901416911135'; }

function cuHeaders() {
  return { 'Authorization': cuToken(), 'Content-Type': 'application/json' };
}

// ── Stage ↔ ClickUp status mapping ──────────────────────────
const STAGE_TO_CU = {
  'intake-custom':  'Custom Intake',
  'intake-repair':  'Repair Intake',
  'needs-est':      'Estimate Intake',
  'sketch-needs':   'Needs Sketch',
  'sketch-wait':    'Waiting on Sketch Approval',
  'sketch':         'Sketch Approved',
  'quote':          'Estimate Sent',
  'est-appr':       'Estimate Approved',
  'order-mat':      'Order Materials',
  'materials':      'Waiting on Materials',
  'build':          'At the Bench',
  'contact-need':   'Need to Contact Customer',
  'contact-done':   'Contacted Customer',
  'ready-pick':     'Ready for Pickup',
  'complete':       'Completed',
  'delivered':      'Completed',
};

// Build reverse map: lowercase status name → stage ID
const CU_TO_STAGE = {};
Object.entries(STAGE_TO_CU).forEach(([stageId, statusName]) => {
  const key = statusName.toLowerCase();
  if (!CU_TO_STAGE[key]) CU_TO_STAGE[key] = stageId;
});

// ── Description builder/parser ───────────────────────────────
// All order fields are stored in the ClickUp task description
// so we don't need custom fields.

function cuBuildDescription(order) {
  const typeLabels = { order: 'Custom Order', estimate: 'Estimate Request', repair: 'Repair' };
  const lines = [
    order.email         && 'Email: '        + order.email,
    order.phone         && 'Phone: '        + order.phone,
    order.contactSource && 'Via: '          + order.contactSource,
    order.pickup        && 'Pickup: '       + order.pickup,
    order.takeIn        && 'Take-In: '      + order.takeIn,
    order.price         && 'Price: $'       + order.price,
    order.orderType     && 'Order Type: '   + (typeLabels[order.orderType] || order.orderType),
    order.paidBy        && 'Paid By: '      + order.paidBy,
    '',
    order.desc          && 'Description: '  + order.desc,
    order.materials     && 'Materials: '    + order.materials,
    order.ringSize      && 'Ring Size: '    + order.ringSize,
    order.notes         && 'Notes: '        + order.notes,
    order.sketchDesc    && 'Sketch Notes: ' + order.sketchDesc,
    order.address       && 'Ship To: '      + order.address,
  ].filter(v => v !== false && v !== undefined && v !== null);
  return lines.join('\n');
}

function cuParseDescription(desc) {
  const lines  = (desc || '').split('\n');
  const get = prefix => {
    const l = lines.find(l => l.toLowerCase().startsWith(prefix.toLowerCase()));
    return l ? l.slice(prefix.length).trim() : '';
  };
  const priceStr = get('Price: $').replace(/[^0-9.]/g, '');
  const typeRaw  = get('Order Type: ').toLowerCase();
  const typeMap  = { 'custom order': 'order', 'estimate request': 'estimate', 'repair': 'repair' };
  return {
    email:         get('Email: '),
    phone:         get('Phone: '),
    contactSource: get('Via: '),
    pickup:        get('Pickup: '),
    takeIn:        get('Take-In: '),
    price:         parseFloat(priceStr) || 0,
    orderType:     typeMap[typeRaw] || 'order',
    paidBy:        get('Paid By: '),
    desc:          get('Description: '),
    materials:     get('Materials: '),
    ringSize:      get('Ring Size: '),
    notes:         get('Notes: '),
    sketchDesc:    get('Sketch Notes: '),
    address:       get('Ship To: '),
  };
}

// ── Create a new ClickUp task from an order ──────────────────
// Returns the ClickUp task ID string, or null on failure.
async function cuCreateTask(order) {
  if (!cuToken()) return null;

  const typeLabels = { order: 'Custom Order', estimate: 'Estimate Request', repair: 'Repair' };
  const suffix     = typeLabels[order.orderType] || 'Custom Order';
  const body       = {
    name:        order.name + ' — ' + suffix,
    description: cuBuildDescription(order),
    status:      STAGE_TO_CU[order.stage] || 'Custom Intake',
  };
  if (order.deadline) {
    body.due_date      = new Date(order.deadline).getTime();
    body.due_date_time = false;
  }

  try {
    const r = await fetch(CU_API + '/list/' + cuListId() + '/task', {
      method:  'POST',
      headers: cuHeaders(),
      body:    JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.warn('ClickUp create failed', r.status, err);
      return null;
    }
    const data = await r.json();
    return data.id || null;
  } catch(e) {
    console.warn('ClickUp create error', e);
    return null;
  }
}

// ── Update a task's full details ─────────────────────────────
async function cuUpdateTask(order) {
  if (!cuToken() || !order.clickup || order.clickup === 'pending') return;

  const typeLabels = { order: 'Custom Order', estimate: 'Estimate Request', repair: 'Repair' };
  const suffix     = typeLabels[order.orderType] || 'Custom Order';
  const body       = {
    name:        order.name + ' — ' + suffix,
    description: cuBuildDescription(order),
    status:      STAGE_TO_CU[order.stage],
  };
  if (order.deadline) {
    body.due_date      = new Date(order.deadline).getTime();
    body.due_date_time = false;
  }
  // Remove undefined status (ClickUp rejects null status values)
  if (!body.status) delete body.status;

  try {
    await fetch(CU_API + '/task/' + order.clickup, {
      method:  'PUT',
      headers: cuHeaders(),
      body:    JSON.stringify(body),
    });
  } catch(e) {
    console.warn('ClickUp update error', e);
  }
}

// ── Update only a task's status ───────────────────────────────
async function cuUpdateStatus(taskId, stageId) {
  if (!cuToken() || !taskId || taskId === 'pending') return;
  const status = STAGE_TO_CU[stageId];
  if (!status) return;

  try {
    await fetch(CU_API + '/task/' + taskId, {
      method:  'PUT',
      headers: cuHeaders(),
      body:    JSON.stringify({ status }),
    });
  } catch(e) {
    console.warn('ClickUp status update error', e);
  }
}

// ── Pull all tasks from ClickUp → merge into ORDERS ──────────
async function cuSyncFromClickUp() {
  if (!cuToken()) {
    toast('Add your ClickUp API token in ⚙ Integrations first', '⚠');
    openIntegrationsModal();
    return;
  }

  const syncBtn = document.getElementById('cuSyncBtn');
  if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = '⟳ Syncing…'; }
  toast('Syncing from ClickUp…', '⟳');

  try {
    const r = await fetch(
      CU_API + '/list/' + cuListId() + '/task?include_closed=true&subtasks=false&page=0',
      { headers: { 'Authorization': cuToken() } }
    );

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      toast('ClickUp sync failed: ' + (err.err || r.status), '✗');
      return;
    }

    const data  = await r.json();
    const tasks = data.tasks || [];

    // Build lookup maps
    const byClickupId = {};
    ORDERS.forEach(o => { if (o.clickup && o.clickup !== 'pending') byClickupId[o.clickup] = o; });

    let added = 0, updated = 0;

    for (const task of tasks) {
      const statusRaw = (task.status?.status || '').toLowerCase();
      const stageId   = CU_TO_STAGE[statusRaw] || 'intake-custom';
      const parsed    = cuParseDescription(task.description || '');

      // Customer name is everything before ' — ' in the task name
      const nameParts    = (task.name || '').split(' — ');
      const customerName = nameParts[0].trim() || task.name;

      const deadline = task.due_date
        ? new Date(parseInt(task.due_date)).toISOString().slice(0, 10)
        : null;

      const patch = {
        name:          customerName,
        desc:          parsed.desc      || task.name,
        stage:         stageId,
        deadline:      deadline,
        price:         parsed.price     || 0,
        email:         parsed.email     || '',
        phone:         parsed.phone     || '',
        pickup:        parsed.pickup    || '',
        contactSource: parsed.contactSource || '',
        materials:     parsed.materials || '',
        ringSize:      parsed.ringSize  || '',
        notes:         parsed.notes     || '',
        sketchDesc:    parsed.sketchDesc || '',
        address:       parsed.address   || '',
        paidBy:        parsed.paidBy    || '',
        orderType:     parsed.orderType || 'order',
        clickup:       task.id,
      };

      if (byClickupId[task.id]) {
        // Update existing — preserve local-only fields like photo
        const existing = byClickupId[task.id];
        Object.assign(existing, patch);
        updated++;
        if (stageId === 'complete') completedHidden.add(existing.id);
      } else {
        // Add new order from ClickUp
        const newId = 'cu' + task.id;
        ORDERS.push({ id: newId, ...patch });
        if (stageId === 'complete') completedHidden.add(newId);
        added++;
      }
    }

    saveToStorage();
    renderKanban();
    renderCustomers();
    updateCompletedToggle();
    toast('ClickUp sync: +' + added + ' new, ' + updated + ' updated', '✓');

  } catch(e) {
    console.error('ClickUp sync error', e);
    toast('ClickUp sync error — see console', '✗');
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = '↻ Sync ClickUp'; }
  }
}
