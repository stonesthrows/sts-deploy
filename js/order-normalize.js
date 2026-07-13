// ════════════════════════════════════════════
//  ORDER NORMALIZE  —  js/order-normalize.js
//  Unified order schema across all sources (manual intake, Shopify, Etsy):
//  every order carries orderKind / orderSource / sourceOrderNumber, a
//  canonical takeIn date, a structured address, and human-only notes.
//  Pure functions only — no DOM access. Loaded before orders.js.
// ════════════════════════════════════════════

const ORDER_KINDS = ['custom', 'estimate', 'repair', 'resize', 'square-item', 'shopify', 'etsy'];

const ORDER_KIND_TO_SOURCE = {
  custom:        'manual',
  estimate:      'manual',
  repair:        'manual',
  resize:        'manual',
  'square-item': 'manual',
  shopify:       'shopify',
  etsy:          'etsy',
};

// Print layout variant per kind — both e-commerce sources share one layout;
// a Square catalog item is just a custom order as far as the bag goes.
const ORDER_KIND_TO_LAYOUT = {
  custom:        'custom',
  estimate:      'estimate',
  repair:        'repair',
  resize:        'resize',
  'square-item': 'custom',
  shopify:       'ecom',
  etsy:          'ecom',
};

// Fallback inference for orders created before orderKind existed.
// Priority: explicit orderKind → id prefix → orderType → stage → contactSource.
function inferOrderKind(o) {
  if (o.orderKind && ORDER_KINDS.includes(o.orderKind)) return o.orderKind;
  const id = String(o.id || '');
  if (id.indexOf('shopify-') === 0) return 'shopify';
  if (id.indexOf('etsy-') === 0)    return 'etsy';
  const t = o.orderType;
  if (t === 'resize')      return 'resize';
  if (t === 'repair')      return 'repair';
  if (t === 'estimate')    return 'estimate';
  if (t === 'square-item') return 'square-item';
  const s = o.stage || '';
  if (s === 'etsy-bench')     return 'etsy';
  if (s === 'intake-website') return 'shopify';
  if (s === 'intake-repair')  return 'repair';
  if (s === 'needs-est' || s === 'est-sent' || s === 'quote') return 'estimate';
  if (o.contactSource === 'Etsy Message')  return 'etsy';
  if (o.contactSource === 'Website Order') return 'shopify';
  return 'custom';
}

// Strips SEO keyword-stuffed titles down to the product name:
// "Silver Orbit Spinner Ring for Women | Eco Friendly … | Anxiety Ring — 9 US, Rose Gold-Fill"
//   → "Silver Orbit Spinner Ring — 9 US, Rose Gold-Fill"
// Keeps the first |-segment; re-appends the variant tail (passed in, or the
// "— …" tail found on the last segment).
function cleanProductTitle(title, opts) {
  const variant = (opts && opts.variant) || '';
  let t = String(title || '').trim();
  let tail = '';
  const segs = t.split('|').map(s => s.trim()).filter(Boolean);
  if (segs.length > 1) {
    const last = segs[segs.length - 1];
    const dashIdx = last.indexOf('—');
    if (dashIdx !== -1) tail = last.slice(dashIdx + 1).trim();
    t = segs[0];
    // Drop trailing SEO audience filler ("… for Women") from the kept segment.
    t = t.replace(/\s+for\s+(women|men|her|him|unisex|teens?|girls?|boys?)$/i, '');
  }
  const extra = variant || tail;
  return extra ? t + ' — ' + extra : t;
}

// Best-effort parse of a legacy "Ship to: a, b, c…" line into flat address
// fields. Both import formats end "…, city, state, zip, country", so assign
// from the right; whatever is left is the street line(s).
function liftAddressFromNotes(o) {
  const m = /^Ship to:\s*(.+)$/m.exec(o.notes || '');
  if (!m) return;
  const parts = m[1].split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 4) {
    o.addrCountry = o.addrCountry || parts.pop();
    o.addrZip     = o.addrZip     || parts.pop();
    o.addrState   = o.addrState   || parts.pop();
    o.addrCity    = o.addrCity    || parts.pop();
    o.addrStreet  = parts.join(', ');
  } else {
    o.addrStreet = parts.join(', ');
  }
}

// Idempotent in-place normalization/migration. Safe to run on every order,
// every load, and on orders arriving from Notion sync.
function normalizeOrder(o) {
  if (!o || typeof o !== 'object') return o;

  // Legacy import bug wrote takeInDate; canonical field is takeIn.
  if (o.takeInDate && !o.takeIn) o.takeIn = o.takeInDate;
  delete o.takeInDate;

  o.orderKind   = inferOrderKind(o);
  o.orderSource = ORDER_KIND_TO_SOURCE[o.orderKind] || 'manual';

  // Source order number: explicit field, else the machine header the old
  // imports left in notes, else the Etsy id suffix.
  if (!o.sourceOrderNumber) {
    const notes = o.notes || '';
    const shopM = /^Shopify Order (#?\S+)/m.exec(notes);
    const etsyM = /^Etsy Order #(\d+)/m.exec(notes);
    if (shopM)      o.sourceOrderNumber = shopM[1];
    else if (etsyM) o.sourceOrderNumber = etsyM[1];
    else if (o.orderKind === 'etsy') o.sourceOrderNumber = String(o.id || '').replace(/^etsy-/, '');
    else o.sourceOrderNumber = o.sourceOrderNumber || '';
  }

  // Lift a legacy "Ship to:" line into the structured address of record.
  if (!o.addrStreet && !o.addrCity) liftAddressFromNotes(o);

  // Scrub machine junk out of notes — keep only the human/buyer content.
  if (o.notes) {
    const cleaned = o.notes.split('\n')
      .filter(line => !/^(Shopify Order |Etsy Order #|Ship to:)/.test(line))
      .map(line => line.replace(/^(Note|Buyer note):\s*/, ''))
      .join('\n').trim();
    if (cleaned !== o.notes) o.notes = cleaned;
  }

  // Mirror flat address ↔ shippingAddress{} so both consumers work.
  if (!o.shippingAddress && (o.addrStreet || o.addrCity)) {
    o.shippingAddress = {
      street:  o.addrStreet  || '',
      street2: o.addrStreet2 || '',
      city:    o.addrCity    || '',
      state:   o.addrState   || '',
      zip:     o.addrZip     || '',
      country: o.addrCountry || '',
    };
  } else if (o.shippingAddress && !o.addrStreet && !o.addrCity) {
    o.addrStreet  = o.shippingAddress.street  || '';
    o.addrStreet2 = o.shippingAddress.street2 || '';
    o.addrCity    = o.shippingAddress.city    || '';
    o.addrState   = o.shippingAddress.state   || '';
    o.addrZip     = o.shippingAddress.zip     || '';
    o.addrCountry = o.shippingAddress.country || '';
  }

  return o;
}

// Shopify proxy row → normalized app order.
function shopifyToOrder(so) {
  const items = (so.lineItems || []).map(li => ({
    type:         'manual',
    name:         cleanProductTitle(li.title),
    rawTitle:     li.title || '',
    price:        li.price || 0,
    quantity:     li.quantity || 1,
    ringSize:     li.size || '',
    isRing:       !!li.size,
    noSquareSize: !!li.size,
  }));
  const desc = items
    .map(it => `${it.quantity}× ${it.name}${it.ringSize ? ' — Size ' + it.ringSize : ''}`)
    .join('\n');
  const ringSize = items.filter(it => it.ringSize).map(it => it.ringSize).join(', ');

  return normalizeOrder({
    id:                'shopify-' + so.shopifyOrderId,
    orderKind:         'shopify',
    sourceOrderNumber: so.shopifyOrderName || '',
    name:              so.name || '',
    email:             so.email || '',
    price:             so.price || 0,
    desc:              desc || so.desc || '',
    items,
    ringSize,
    // buyerNote is the new proxy field; fall back to the legacy notes blob,
    // which normalizeOrder scrubs (and lifts the address out of).
    notes:             so.buyerNote !== undefined ? so.buyerNote : (so.notes || ''),
    addrStreet:        so.addrStreet  || '',
    addrStreet2:       so.addrStreet2 || '',
    addrCity:          so.addrCity    || '',
    addrState:         so.addrState   || '',
    addrZip:           so.addrZip     || '',
    addrCountry:       so.addrCountry || '',
    stage:             'intake-website',
    orderType:         'order',
    contactSource:     'Website Order',
    takeIn:            so.createdAt ? so.createdAt.slice(0, 10) : '',
    pickup:            'Ship',
    fullyPaid:         true,
  });
}

// Etsy proxy row → normalized app order.
function etsyToOrder(eo) {
  const items = (eo.lineItems || []).map(li => {
    // Prefer the structured variations the proxy now sends; fall back to
    // parsing the joined variant string for rows fetched before they existed.
    let material = '', personalization = '', ringSize = '';
    const structured = Array.isArray(li.variations) && li.variations.length > 0;
    if (structured) {
      const mats = [];
      li.variations.forEach(v => {
        const n   = String(v.name || '').toLowerCase();
        const val = String(v.value || '').trim();
        if (!val) return;
        if (/personali[sz]/.test(n))  personalization = val;
        else if (/size/.test(n))      ringSize = val.replace(/^size[:\s]*/i, '').trim();
        else                          mats.push(val);
      });
      material = mats.join(', ');
    }
    if (!ringSize) {
      const varParts = (li.variant || '').split(',').map(s => s.trim()).filter(Boolean);
      const sizeSeg = varParts.find(p => /size/i.test(p)) ||
                      varParts.find(p => /^\d+(\.\d+)?\s*US$/i.test(p));
      ringSize = sizeSeg ? sizeSeg.replace(/^size[:\s]*/i, '').trim() : '';
      if (!structured) material = varParts.filter(p => p !== sizeSeg).join(', ');
    }
    // Personalization stays out of the display name — it gets its own
    // verbatim callout on the printed bag.
    const tail = [material, ringSize].filter(Boolean).join(', ');
    return {
      type:            'manual',
      name:            cleanProductTitle(li.title, { variant: structured ? tail : li.variant }),
      rawTitle:        li.title || '',
      price:           li.price || 0,
      quantity:        li.quantity || 1,
      ringSize:        ringSize,
      material:        material,
      personalization: personalization,
      isRing:          !!ringSize,
      noSquareSize:    !!ringSize,
    };
  });
  const desc = items.length
    ? items.map(it => `${it.quantity}× ${it.name}`).join('\n')
    : (eo.desc || '');
  const ringSize = items.filter(it => it.ringSize).map(it => it.ringSize).join(', ');

  return normalizeOrder({
    id:                'etsy-' + eo.etsyReceiptId,
    orderKind:         'etsy',
    sourceOrderNumber: String(eo.etsyReceiptId),
    name:              eo.name || '',
    email:             eo.email || '',
    price:             eo.price || 0,
    desc:              desc,
    items,
    ringSize,
    notes:             eo.buyerNote !== undefined ? eo.buyerNote : (eo.notes || ''),
    addrStreet:        eo.addrStreet  || '',
    addrStreet2:       eo.addrStreet2 || '',
    addrCity:          eo.addrCity    || '',
    addrState:         eo.addrState   || '',
    addrZip:           eo.addrZip     || '',
    addrCountry:       eo.addrCountry || '',
    stage:             'etsy-bench',
    orderType:         'order',
    contactSource:     'Etsy Message',
    takeIn:            eo.createdAt ? eo.createdAt.slice(0, 10) : '',
    pickup:            'Ship',
    fullyPaid:         true,
  });
}

function printLayoutFor(kind) {
  return ORDER_KIND_TO_LAYOUT[kind] || 'custom';
}

// Structured per-item fields for the printed bag's item table (ecom layout):
// { qty, base, material, size, pers }. Prefers fields stored at import time;
// for orders imported before those existed, teases material out of the
// display name's "— variant" tail (everything that isn't the size).
function printItemStructured(it) {
  const qty  = parseInt(it.quantity, 10) || 1;
  const name = String(it.name || '');
  const dash = name.indexOf('—');
  const base = (dash === -1 ? name : name.slice(0, dash)).trim();
  const size = String(it.ringSize || '').trim();
  const pers = String(it.personalization || '').trim();
  let material = String(it.material || '').trim();
  if (!material && dash !== -1) {
    const sizeLc = size.toLowerCase();
    material = name.slice(dash + 1).split(',')
      .map(s => s.trim())
      .filter(s => s && !/^size\b/i.test(s) &&
                   (!sizeLc || s.toLowerCase().indexOf(sizeLc) === -1))
      .join(', ');
  }
  return { qty: qty, base: base, material: material, size: size, pers: pers };
}

// Extra query params printOrder() merges into the work-order-print.html URL.
function printParamsFor(o) {
  const kind = inferOrderKind(o);
  return {
    kind:     kind,
    layout:   printLayoutFor(kind),
    source:   { shopify: 'Shopify', etsy: 'Etsy' }[ORDER_KIND_TO_SOURCE[kind]] || '',
    orderNo:  o.sourceOrderNumber || '',
    country:  o.addrCountry || (o.shippingAddress && o.shippingAddress.country) || '',
    workedBy: o.assignee || ({ kyle: 'Kyle', stevie: 'Stevie', vanessa: 'Vanessa' }[o.stage] || ''),
  };
}

// One-time-per-load migration of everything already in ORDERS/localStorage.
// normalizeOrder is idempotent, so this converges and then no-ops.
function migrateLegacyOrders() {
  if (typeof ORDERS === 'undefined' || !Array.isArray(ORDERS)) return;
  let changed = false;
  ORDERS.forEach(o => {
    const before = JSON.stringify(o);
    normalizeOrder(o);
    if (JSON.stringify(o) !== before) changed = true;
  });
  if (changed && typeof saveToStorage === 'function') saveToStorage();
}
