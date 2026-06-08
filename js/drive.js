// ════════════════════════════════════════════
//  DRIVE INTEGRATION  —  js/drive.js  [v1]
//  Google Drive → Claude Vision → Kanban + ClickUp + Google Contacts
// ════════════════════════════════════════════

// Handle Google OAuth popup return — must run before app init
(function () {
  if (window.opener && location.hash && location.hash.includes('access_token')) {
    var p = new URLSearchParams(location.hash.slice(1));
    var t = p.get('access_token');
    if (t) {
      window.opener.postMessage(
        { type: 'sts-google-oauth', token: t, expiresIn: p.get('expires_in') || '3600' },
        location.origin
      );
      window.close();
    }
  }
})();

// ── Constants ───────────────────────────────
const DRIVE_FOLDER_NAME = 'STS Order Bag Visual Reads';
const DRIVE_SEEN_KEY    = 'sts-drive-imported';
const GOOGLE_TOKEN_KEY  = 'sts-google-token';
const GOOGLE_EXPIRY_KEY = 'sts-google-token-expiry';

let _oauthCallback     = null;
let _driveReviewOrders = [];

// ── Token helpers ────────────────────────────

function getGoogleToken() {
  const token  = localStorage.getItem(GOOGLE_TOKEN_KEY);
  const expiry = parseInt(localStorage.getItem(GOOGLE_EXPIRY_KEY) || '0');
  if (token && Date.now() < expiry - 60000) return token; // 1-min safety buffer
  return null;
}

function clearGoogleToken() {
  localStorage.removeItem(GOOGLE_TOKEN_KEY);
  localStorage.removeItem(GOOGLE_EXPIRY_KEY);
}

// Listen for OAuth popup result
window.addEventListener('message', function (e) {
  if (e.origin !== window.location.origin) return;
  if (!e.data || e.data.type !== 'sts-google-oauth') return;
  localStorage.setItem(GOOGLE_TOKEN_KEY, e.data.token);
  localStorage.setItem(GOOGLE_EXPIRY_KEY, String(Date.now() + parseInt(e.data.expiresIn) * 1000));
  toast('Connected to Google ✓', '✓');
  if (_oauthCallback) { const cb = _oauthCallback; _oauthCallback = null; cb(); }
});

// ── OAuth flow ───────────────────────────────

function triggerGoogleOAuth(clientId, callback) {
  _oauthCallback = callback;
  const redirectUri = window.location.origin + window.location.pathname;
  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/contacts'
  ].join(' ');
  const url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id='     + encodeURIComponent(clientId)
    + '&redirect_uri='  + encodeURIComponent(redirectUri)
    + '&response_type=token'
    + '&scope='         + encodeURIComponent(scopes)
    + '&prompt=select_account';

  const popup = window.open(url, 'google-oauth', 'width=520,height=620,scrollbars=yes,resizable=yes');
  if (!popup) {
    toast('Popup blocked — allow popups for this site and try again', '⚠');
    _oauthCallback = null;
  }
}

// ── Check Drive button handler ───────────────

function checkDriveScans(btn) {
  const clientId = localStorage.getItem('sts-google-client-id');
  if (!clientId) {
    openIntegrationsModal();
    toast('Set up your Google Client ID in Integrations first', 'ℹ');
    return;
  }
  const token = getGoogleToken();
  if (!token) {
    triggerGoogleOAuth(clientId, function () { checkDriveScans(btn); });
    return;
  }
  runDriveCheck(btn, token);
}

// ── Main Drive check ─────────────────────────

async function runDriveCheck(btn, token) {
  if (btn) { btn.disabled = true; btn.textContent = '☁ Checking…'; }

  try {
    // 1. Find the folder
    const folderQ = `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const folderResp = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(folderQ) + '&fields=files(id,name)',
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    if (folderResp.status === 401) {
      clearGoogleToken();
      toast('Google session expired — click Check Drive to reconnect', '⚠');
      return;
    }
    const folderData = await folderResp.json();
    if (!folderData.files?.length) {
      toast('Folder "' + DRIVE_FOLDER_NAME + '" not found in your Drive', '⚠');
      return;
    }
    const folderId = folderData.files[0].id;

    // 2. List image files in folder
    const filesQ = `'${folderId}' in parents and trashed=false and (mimeType contains 'image/')`;
    const filesResp = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(filesQ)
      + '&fields=files(id,name,mimeType,createdTime)&orderBy=createdTime+desc&pageSize=50',
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    const filesData = await filesResp.json();
    const allFiles  = filesData.files || [];

    // 3. Filter already-processed
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(DRIVE_SEEN_KEY) || '[]'); } catch {}
    const newFiles = allFiles.filter(function (f) { return !seen.includes(f.id); });

    if (!newFiles.length) {
      toast('No new scans — already up to date.', 'ℹ');
      return;
    }

    // 4. Check Anthropic key before downloading
    const anthropicKey = localStorage.getItem('sts-anthropic-key') || '';
    if (!anthropicKey) {
      openIntegrationsModal();
      toast('Enter your Anthropic API key in Integrations to read scan images', 'ℹ');
      return;
    }

    showDriveOverlay('Reading ' + newFiles.length + ' image' + (newFiles.length > 1 ? 's' : '') + ' with Claude Vision…');

    // 5. Download + Vision each file
    const results = [];
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      updateDriveOverlay('Reading image ' + (i + 1) + ' of ' + newFiles.length + '…');
      try {
        const imgResp = await fetch(
          'https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media',
          { headers: { 'Authorization': 'Bearer ' + token } }
        );
        const blob   = await imgResp.blob();
        const base64 = await blobToBase64(blob);
        const data   = await runClaudeVisionOnImage(base64, file.mimeType, anthropicKey);
        if (data) results.push(Object.assign({}, data, { drive_file_id: file.id, drive_file_name: file.name }));
      } catch (err) {
        console.warn('Error processing file ' + file.name + ':', err);
      }
    }

    hideDriveOverlay();

    if (!results.length) {
      toast('Couldn\'t extract order data from the scans — try clearer photos', '⚠');
      return;
    }

    showDriveReviewModal(results);

  } catch (err) {
    hideDriveOverlay();
    console.error('Drive check error:', err);
    toast('Error checking Drive — see console for details', '⚠');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '☁ Check Drive'; }
  }
}

// ── Helpers ──────────────────────────────────

function blobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function (e) { resolve(e.target.result.slice(e.target.result.indexOf(',') + 1)); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function runClaudeVisionOnImage(base64, mimeType, key) {
  const systemPrompt = `You are an order intake assistant for Stones Throw Studio, a custom jewelry shop.
The user will show you a photo of a handwritten work order bag or intake sheet.

CRITICAL ACCURACY RULES:
- Read quantities and product names VERY carefully. Do NOT guess or substitute similar-sounding words.
  For example: "1 Orbit Earring" must NOT become "2 Opal rings". Copy the exact words you see.
- If a word is unclear, write it as-is with a [?] after it rather than substituting a guess.
- For quantities, look closely at the numeral — 1 and 2 can look similar in handwriting.

ORDER TYPE: At the top of the bag, one of four categories will be circled: Custom, Etsy, Resize, Repair.
- "Custom" circled → order_type: "order"
- "Etsy" circled → order_type: "order", and set contacted_via to "Etsy Message"
- "Resize" circled → order_type: "repair"
- "Repair" circled → order_type: "repair"
- If none is clearly circled, default to "order".

PICKUP LOCATION: Next to the customer info section, one location abbreviation will be circled:
- "SVFM" → "Sunset Valley Farmer's Market"
- "Bell" → "Bell Market"
- "TXFM" → "Mueller Market"
- "CCFM" → "Chaparral Crossing Market"
- "Flea" → "Austin Flea"
- "Studio" → "Studio"
- "DTFM" → null (we do not use Downtown Farmer's Market)
- If a shipping address is written on the bag, set pickup_location to "To be Shipped" and put the full address in the "address" field — regardless of whether a location is circled.
- If none is circled and no address is present, use null.

RING SIZE: If there is a ring size field, extract it as a plain number (e.g. "7" or "7.5"). The bag may write it as "Size 7", "Sz 7", or just "7" — always normalize to just the number.

PAID BY: Under "Paid in Full" there are three checkboxes: Cash, Credit, Check. If one is checked or marked with an X, set paid_by to that value. Otherwise null.

SKETCH: The bag may have a hand-drawn sketch of the piece, usually below the Notes section or in the margins. If you see a sketch or drawing, describe it in detail in sketch_description — shape, style, any written annotations on or near it. If no sketch is present, use null.

ITEM & PRICE: The bag has a line where the item is written with its price next to it (e.g. "Ring $95"). Put the item name/description in the "description" field and the numeric price in the "price" field.

NOTES: The bag has a dedicated Notes section. If it contains ANY text, you MUST capture all of it in the notes field. This is critical information — do not skip or summarize it.

Extract all visible information and return ONLY a valid JSON object with these exact keys (use null for anything not visible):
{
  "customer_name": string|null,
  "email": string|null,
  "phone": string|null,
  "take_in_date": "YYYY-MM-DD"|null,
  "deadline": "YYYY-MM-DD"|null,
  "pickup_location": "Bell Market"|"Mueller Market"|"Chaparral Crossing Market"|"Sunset Valley Farmer's Market"|"Austin Flea"|"Studio"|"To be Shipped"|null,
  "address": string|null,
  "contacted_via": "Email"|"Farmer's Market"|"Shopify Email"|"Etsy Message"|"Instagram Message"|"Text Message"|"Facebook Message"|null,
  "order_type": "order"|"estimate"|"repair",
  "description": string|null,
  "materials": string|null,
  "ring_size": string|null,
  "price": number|null,
  "paid_by": "Cash"|"Credit"|"Check"|null,
  "notes": string|null,
  "sketch_description": string|null
}
For dates, infer the year as the current year (${new Date().getFullYear()}) if only month/day is shown.
Return ONLY the JSON object, no other text.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':                                  key,
      'anthropic-version':                          '2023-06-01',
      'anthropic-dangerous-direct-browser-access':  'true',
      'content-type':                               'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text',  text:  'Extract the order information from this work order bag photo.' }
      ]}]
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(function () { return {}; });
    if (resp.status === 401) {
      localStorage.removeItem('sts-anthropic-key');
      toast('Invalid Anthropic API key — update it in Integrations ⚙', '⚠');
    }
    throw new Error((err.error && err.error.message) || 'Anthropic API error ' + resp.status);
  }

  const body = await resp.json();
  const raw  = (body.content && body.content[0] && body.content[0].text) || '';
  try {
    return JSON.parse(raw.replace(/```json\n?/g, '').replace(/```/g, '').trim());
  } catch {
    console.warn('Could not parse Claude Vision response:', raw);
    return null;
  }
}

// ── Drive overlay spinner ────────────────────

function showDriveOverlay(msg) {
  const el = document.getElementById('driveOverlay');
  if (!el) return;
  document.getElementById('driveOverlayLabel').textContent = msg || 'Checking Drive…';
  el.classList.add('open');
}

function updateDriveOverlay(msg) {
  const el = document.getElementById('driveOverlayLabel');
  if (el) el.textContent = msg;
}

function hideDriveOverlay() {
  const el = document.getElementById('driveOverlay');
  if (el) el.classList.remove('open');
}

// ── Drive review modal ───────────────────────

function showDriveReviewModal(orders) {
  _driveReviewOrders = orders;
  const sub = document.getElementById('driveReviewSub');
  if (sub) sub.textContent = orders.length + ' new order' + (orders.length > 1 ? 's' : '') + ' found';

  const list = document.getElementById('driveReviewList');
  if (!list) return;

  function typeLabel(t) {
    return t === 'repair' ? '🔧 Repair' : t === 'estimate' ? '📋 Estimate Request' : '💍 Custom Order';
  }
  function field(label, val) {
    return val != null && val !== '' && val !== false
      ? '<div class="drf-row"><span class="drf-label">' + label + '</span><span class="drf-val">' + val + '</span></div>'
      : '';
  }

  list.innerHTML = orders.map(function (d, i) {
    return '<div class="drf-card">'
      + '<div class="drf-card-head">'
      +   '<div>'
      +     '<div class="drf-type-tag">' + typeLabel(d.order_type) + '</div>'
      +     '<div class="drf-customer">' + (d.customer_name || 'Unknown Customer') + '</div>'
      +     '<div class="drf-filename">' + (d.drive_file_name || '') + '</div>'
      +   '</div>'
      +   '<label class="drf-check-wrap" title="Include in import">'
      +     '<input type="checkbox" id="drf-check-' + i + '" checked> Include'
      +   '</label>'
      + '</div>'
      + '<div class="drf-fields">'
      +   field('Email',       d.email)
      +   field('Phone',       d.phone)
      +   field('Take-in',     d.take_in_date)
      +   field('Deadline',    d.deadline)
      +   field('Pickup',      d.pickup_location)
      +   field('Ship To',     d.address)
      +   field('Via',         d.contacted_via)
      +   field('Item',        d.description)
      +   field('Materials',   d.materials)
      +   field('Ring Size',   d.ring_size)
      +   field('Price',       d.price != null ? '$' + d.price : null)
      +   field('Paid By',     d.paid_by)
      +   field('Notes',       d.notes)
      +   field('Sketch',      d.sketch_description)
      + '</div>'
      + '</div>';
  }).join('');

  document.getElementById('driveReviewModalBg').classList.add('open');
}

function closeDriveReview() {
  document.getElementById('driveReviewModalBg').classList.remove('open');
  _driveReviewOrders = [];
}

function importAllDriveOrders() {
  const toImport = _driveReviewOrders.filter(function (_, i) {
    const cb = document.getElementById('drf-check-' + i);
    return cb ? cb.checked : true;
  });
  if (!toImport.length) { toast('No orders selected', 'ℹ'); return; }

  const googleToken  = getGoogleToken();
  const clickupToken = localStorage.getItem('sts-clickup-token');
  const clickupList  = localStorage.getItem('sts-clickup-list-id');

  const stageMap = { order: 'intake-custom', estimate: 'needs-est', repair: 'intake-repair' };
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(DRIVE_SEEN_KEY) || '[]'); } catch {}

  toImport.forEach(function (d) {
    const newId     = 'drive-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const orderType = d.order_type || 'order';

    ORDERS.push({
      id:            newId,
      name:          d.customer_name   || 'Unknown Customer',
      desc:          d.description     || '',
      stage:         stageMap[orderType] || 'intake-custom',
      deadline:      d.deadline        || null,
      price:         d.price           || 0,
      clickup:       'pending',
      email:         d.email           || '',
      phone:         d.phone           || '',
      takeIn:        d.take_in_date    || null,
      pickup:        d.pickup_location || null,
      contactSource: d.contacted_via   || null,
      orderType:     orderType,
      notes:         d.notes              || '',
      materials:     d.materials          || '',
      ringSize:      d.ring_size          || '',
      paidBy:        d.paid_by            || '',
      sketchDesc:    d.sketch_description || '',
      address:       d.address            || '',
    });

    // Add / update customer
    const name     = d.customer_name || 'Unknown Customer';
    const existing = CUSTOMERS.find(function (c) { return c.name.toLowerCase() === name.toLowerCase(); });
    if (existing) {
      existing.totalOrders  += 1;
      existing.lastContact   = new Date().toISOString().slice(0, 10);
      existing.activeOrders  = (existing.activeOrders || 0) + 1;
    } else {
      CUSTOMERS.unshift({
        name:         name,
        email:        d.email || '',
        lastContact:  new Date().toISOString().slice(0, 10),
        totalOrders:  1,
        totalValue:   0,
        activeOrders: 1,
      });
    }

    seen.push(d.drive_file_id);

    // Fire-and-forget integrations
    if (clickupToken && clickupList) createClickUpTask(d, clickupToken, clickupList);
    if (googleToken) createGoogleContact(d, googleToken);
  });

  localStorage.setItem(DRIVE_SEEN_KEY, JSON.stringify(seen));
  saveToStorage();
  renderKanban();
  if (typeof renderCustomers === 'function') renderCustomers();
  closeDriveReview();

  const n = toImport.length;
  toast(
    n === 1
      ? (toImport[0].customer_name || 'Order') + ' imported to board ✓'
      : n + ' orders imported to board ✓',
    '✓'
  );
}

// ── ClickUp integration ──────────────────────
// Tasks created in the "Custom Orders" list with full contact + order details

async function createClickUpTask(d, token, listId) {
  const typeMap = { order: 'Custom Order', estimate: 'Estimate Request', repair: 'Repair' };
  const name    = (d.customer_name || 'Unknown Customer') + ' — ' + (typeMap[d.order_type] || 'Custom Order');

  const lines = [
    d.email           && 'Email: '       + d.email,
    d.phone           && 'Phone: '       + d.phone,
    d.pickup_location && 'Pickup: '      + d.pickup_location,
    d.contacted_via   && 'Via: '         + d.contacted_via,
    d.take_in_date    && 'Take-In: '     + d.take_in_date,
    d.deadline        && 'Deadline: '    + d.deadline,
    d.price != null   && 'Price: $'      + d.price,
    '',
    d.description     && 'Description: ' + d.description,
    d.materials       && 'Materials: '   + d.materials,
    d.notes           && 'Notes: '       + d.notes,
  ].filter(Boolean);

  try {
    const resp = await fetch('https://api.clickup.com/api/v2/list/' + listId + '/task', {
      method:  'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: name, description: lines.join('\n') }),
    });
    if (!resp.ok) console.warn('ClickUp task creation failed:', resp.status, await resp.text());
  } catch (err) {
    console.warn('ClickUp error:', err);
  }
}

// ── Google Contacts integration ──────────────
// Contact created with email, phone, and STS source note — synergizes with Gmail

async function createGoogleContact(d, token) {
  if (!d.customer_name && !d.email) return;
  const parts = (d.customer_name || '').trim().split(/\s+/);
  const body  = {
    names:          [{ givenName: parts[0] || '', familyName: parts.slice(1).join(' ') }],
    emailAddresses: d.email ? [{ value: d.email, type: 'work' }]   : [],
    phoneNumbers:   d.phone ? [{ value: d.phone, type: 'mobile' }] : [],
    biographies:    [{
      value:       'Stones Throw Studio customer. Source: ' + (d.contacted_via || 'Unknown'),
      contentType: 'TEXT_PLAIN',
    }],
  };
  try {
    const resp = await fetch('https://people.googleapis.com/v1/people:createContact', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!resp.ok) console.warn('Google Contacts failed:', resp.status, await resp.text());
  } catch (err) {
    console.warn('Google Contacts error:', err);
  }
}

// ── Integrations modal ───────────────────────

function setField(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function getField(id)      { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

function openIntegrationsModal() {
  setField('int-google-client-id',     localStorage.getItem('sts-google-client-id')     || '');
  setField('int-google-client-secret', localStorage.getItem('sts-google-client-secret') || '');
  setField('int-anthropic-key',        localStorage.getItem('sts-anthropic-key')        || '');
  setField('int-square-token',    localStorage.getItem('sts-square-token')    || '');
  setField('int-square-location', localStorage.getItem('sts-square-location') || '');
  document.getElementById('integrationsModalBg').classList.add('open');
}

function closeIntegrationsModal() {
  document.getElementById('integrationsModalBg').classList.remove('open');
}

function saveIntegrations() {
  const prev            = localStorage.getItem('sts-google-client-id');
  const googleClientId  = getField('int-google-client-id');
  const googleClientSec = getField('int-google-client-secret');
  const anthropicKey    = getField('int-anthropic-key');
  const squareToken    = getField('int-square-token');
  const squareLocation = getField('int-square-location');

  googleClientId  ? localStorage.setItem('sts-google-client-id',     googleClientId)  : localStorage.removeItem('sts-google-client-id');
  googleClientSec ? localStorage.setItem('sts-google-client-secret', googleClientSec) : localStorage.removeItem('sts-google-client-secret');
  anthropicKey    ? localStorage.setItem('sts-anthropic-key',        anthropicKey)    : localStorage.removeItem('sts-anthropic-key');
  squareToken     ? localStorage.setItem('sts-square-token',         squareToken)     : localStorage.removeItem('sts-square-token');
  squareLocation  ? localStorage.setItem('sts-square-location',      squareLocation)  : localStorage.removeItem('sts-square-location');

  // Invalidate token if client ID changed
  if (googleClientId !== prev) clearGoogleToken();

  // Auto-detect Square location ID if token set but no location saved
  if (squareToken && !squareLocation) {
    fetch('/api/square', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/v2/locations', method: 'GET', token: squareToken })
    }).then(r => r.json()).then(d => {
      const loc = (d.locations || []).find(l => l.status === 'ACTIVE') || (d.locations || [])[0];
      if (loc) {
        localStorage.setItem('sts-square-location', loc.id);
        setField('int-square-location', loc.id);
        toast('Square location auto-detected: ' + (loc.name || loc.id), '📍');
      }
    }).catch(() => {});
  }

  closeIntegrationsModal();
  toast('Integrations saved ✓', '✓');
}

// Searches ClickUp workspace for the "Custom Orders" list and fills in the ID automatically
async function findClickUpListId() {
  const btn   = document.querySelector('[onclick="findClickUpListId()"]');
  const token = document.getElementById('int-clickup-token').value.trim() || localStorage.getItem('sts-clickup-token');
  if (!token) { toast('Enter your ClickUp API token first', '⚠'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '🔍 Searching…'; }

  async function cuFetch(url) {
    const r = await fetch(url, { headers: { 'Authorization': token } });
    const j = await r.json();
    if (!r.ok) throw new Error('ClickUp ' + r.status + ': ' + (j.err || j.error || JSON.stringify(j)));
    return j;
  }

  try {
    const teamsData = await cuFetch('https://api.clickup.com/api/v2/team');
    if (!teamsData.teams?.length) { toast('No ClickUp workspaces found — check your token', '⚠'); return; }

    const teamId     = teamsData.teams[0].id;
    const spacesData = await cuFetch('https://api.clickup.com/api/v2/team/' + teamId + '/space?archived=false');

    for (const space of (spacesData.spaces || [])) {
      // Check space-level lists (lists not in a folder)
      const spListsData = await cuFetch('https://api.clickup.com/api/v2/space/' + space.id + '/list?archived=false');
      for (const list of (spListsData.lists || [])) {
        if (list.name.toLowerCase().includes('custom order')) {
          document.getElementById('int-clickup-list-id').value = list.id;
          toast('Found "' + list.name + '" — ID filled in ✓', '✓');
          return;
        }
      }
      // Check folder lists
      const foldersData = await cuFetch('https://api.clickup.com/api/v2/space/' + space.id + '/folder?archived=false');
      for (const folder of (foldersData.folders || [])) {
        const fListsData = await cuFetch('https://api.clickup.com/api/v2/folder/' + folder.id + '/list?archived=false');
        for (const list of (fListsData.lists || [])) {
          if (list.name.toLowerCase().includes('custom order')) {
            document.getElementById('int-clickup-list-id').value = list.id;
            toast('Found "' + list.name + '" — ID filled in ✓', '✓');
            return;
          }
        }
      }
    }
    toast('Couldn\'t find "Custom Orders" — paste the List ID manually from the ClickUp URL', 'ℹ');
  } catch (err) {
    toast('ClickUp error: ' + err.message, '⚠');
    console.error('ClickUp search error:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Find my List ID automatically'; }
  }
}
