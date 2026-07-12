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

// ── E-commerce variant → bench spec parsing ──────────────────────────
// Marketplace variants arrive as loose text ("Size 7.5 / 4mm / Lined,
// High Polish" from Shopify, "Ring size: 7 US; Metal: Rose Gold-Fill"
// from Etsy). parseSpecPairs() turns them into the fields the bench
// actually reads off a bag: size / metal / width / finish.

const SPEC_METAL_RX = new RegExp('\\b(' + [
  'sterling silver', 'argentium(?: silver)?', 'fine silver',
  '(?:rose|yellow|white) gold[ -]?fill(?:ed)?', 'gold[ -]?fill(?:ed)?',
  '(?:10|14|18|24)\\s*k(?:t|arat)?(?:\\s+(?:rose|yellow|white))?(?:\\s+gold)?',
  '(?:rose|yellow|white) gold', 'gold vermeil', 'vermeil',
  'platinum', 'palladium', 'titanium', 'stainless(?: steel)?',
  'copper', 'brass', 'bronze', 'niobium', 'silver', 'gold',
].join('|') + ')\\b', 'i');

const SPEC_FINISH_RX = /\b(hammered|high[ -]?polish(?:ed)?|polished|matte|brushed|satin|oxidi[sz]ed|antiqued?|lined|unlined|smooth|textured|florentine|sandblasted|comfort[ -]?fit|half[ -]?round|domed)\b/i;

const SPEC_WIDTH_RX = /\b(\d+(?:[.,]\d+)?\s*mm)\b/i;

// Bare ring-size values: "7", "7.5", "7 1/2", "7½", "9 US", "US 6"
const SPEC_SIZE_VAL_RX = /^(?:us\s*)?(\d{1,2}(?:[.,]\d+)?(?:\s*(?:[½¼¾]|\d\/\d))?)\s*(?:us)?$/i;

// "Size 7.5" / "Ring size: 7 US" / "Sz 7" → "7.5" / "7" / "7"
function specSizeValue(v) {
  const cleaned = String(v || '').replace(/^\s*(?:ring\s*)?(?:si?ze|sz)\s*[:\-]?\s*/i, '').trim();
  const m = SPEC_SIZE_VAL_RX.exec(cleaned);
  return m ? m[1].replace(',', '.').trim() : cleaned;
}

// Split loose variant text into {name, value} pairs. Etsy labels come
// through as "Ring size: 7 US"; Shopify options carry no labels. The
// separator is auto-detected: proxy-built strings use ";", Shopify
// variantTitle uses " / ", spec summaries use "·", legacy imports ",".
function specPairsFromText(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const sep = t.indexOf(';') !== -1 ? ';'
            : t.indexOf(' / ') !== -1 ? ' / '
            : t.indexOf('·') !== -1 ? '·'
            : ',';
  return t.split(sep).map(s => s.trim()).filter(Boolean).map(seg => {
    const m = /^([A-Za-z][^:]{1,30}):\s*(.+)$/.exec(seg);
    return m ? { name: m[1].trim(), value: m[2].trim() } : { name: '', value: seg };
  });
}

function parseSpecPairs(pairs) {
  const spec = { size: '', metal: '', width: '', finish: '', other: [], pers: '' };
  const finishes = [];
  (pairs || []).forEach(pr => {
    const name  = String(pr.name  || '').trim();
    const value = String(pr.value || '').trim();
    if (!value) return;
    if (name) {
      if (/personali[sz]ation|engrav/i.test(name)) { spec.pers = spec.pers ? spec.pers + '; ' + value : value; return; }
      if (/width/i.test(name))                       { if (!spec.width) spec.width = value; return; }
      if (/\bsize\b|^sz$/i.test(name))               { if (!spec.size) spec.size = specSizeValue(value); return; }
      if (/metal|material/i.test(name))              { if (!spec.metal) spec.metal = value; return; }
      if (/finish|texture|lining|style/i.test(name)) { finishes.push(value); return; }
    }
    // Unlabeled — classify by what the value looks like
    if (/^(?:ring\s*)?(?:si?ze|sz)\b/i.test(value) || SPEC_SIZE_VAL_RX.test(value)) {
      if (!spec.size) spec.size = specSizeValue(value);
      return;
    }
    if (SPEC_WIDTH_RX.test(value) && !/stone|bead|gem|pearl/i.test(value)) {
      if (!spec.width) spec.width = (SPEC_WIDTH_RX.exec(value) || [])[1] || value;
      return;
    }
    if (SPEC_METAL_RX.test(value) && value.length <= 40) { if (!spec.metal) spec.metal = value; return; }
    if (SPEC_FINISH_RX.test(value)) { finishes.push(value); return; }
    spec.other.push(value);
  });
  spec.finish = finishes.join(', ');
  return spec;
}

// Titles often carry spec words the variant doesn't ("4mm Hammered
// Sterling Silver Band"). Pull them into the spec fields so they print
// as labeled lines instead of hiding in the name. Metal scans the whole
// title and keeps the most specific mention ("Sterling Silver" beats
// "Silver" even across |-segments); width/finish only trust the first
// segment — SEO tails list every option the shop offers.
function liftSpecFromTitle(title, spec) {
  const t = String(title || '');
  const first = t.split('|')[0];
  if (!spec.metal) {
    const g = new RegExp(SPEC_METAL_RX.source, 'gi');
    let m, best = '';
    while ((m = g.exec(t))) { if (m[1].length > best.length) best = m[1]; }
    if (best) spec.metal = best;
  }
  if (!spec.width) { const m = SPEC_WIDTH_RX.exec(first); if (m) spec.width = m[1]; }
  // Append first-segment finish words the variant didn't already mention.
  const g = new RegExp(SPEC_FINISH_RX.source, 'gi');
  const found = [];
  let m;
  while ((m = g.exec(first))) {
    const f = m[1];
    const dup = new RegExp('\\b' + f.replace(/[ -]/g, '[ -]?') + '\\b', 'i');
    if (!dup.test(spec.finish) && !found.some(x => dup.test(x))) found.push(f);
  }
  if (found.length) spec.finish = [spec.finish, found.join(', ')].filter(Boolean).join(', ');
  return spec;
}

const TITLE_FILLER_RX = new RegExp('\\b(?:' + [
  'eco[ -]?friendly', 'environmentally friendly', 'recycled', 'sustainable',
  'hypoallergenic', 'waterproof', 'tarnish[ -]?(?:free|resistant)', 'nickel[ -]?free',
  'handmade', 'hand[ -]?crafted', 'dainty', 'minimalist(?:ic)?', 'boho',
  "(?:perfect |great )?gifts? for (?:her|him|mom|dad|men|women|wife|husband|girlfriend|boyfriend|couples?)",
  "(?:anniversary|birthday|christmas|holiday|valentine'?s?(?: day)?|mothers?'? day|fathers?'? day) gifts?",
  'gift idea', 'unisex',
].join('|') + ')\\b', 'gi');

const TITLE_AUDIENCE_RX = /\s+for\s+(women|men|her|him|unisex|teens?|girls?|boys?|couples?)\b/gi;

// Strips SEO keyword-stuffed titles down to the product name. Keeps the
// first |-segment and drops audience/filler keywords. When a parsed spec
// is passed, metal/width/finish words are also removed from the name —
// they print as labeled spec lines, so the bag shouldn't say them twice:
//   "Silver Orbit Spinner Ring for Women | Eco Friendly … | Anxiety Ring"
//   + {metal:'Rose Gold-Fill'} → "Orbit Spinner Ring"
// Legacy callers can still pass {variant} to re-append a variant tail.
function cleanProductTitle(title, opts) {
  const spec    = (opts && opts.spec)    || null;
  const variant = (opts && opts.variant) || '';
  let t = String(title || '').trim();
  let tail = '';
  const segs = t.split('|').map(s => s.trim()).filter(Boolean);
  if (segs.length > 1) {
    const last = segs[segs.length - 1];
    const dashIdx = last.indexOf('—');
    if (dashIdx !== -1) tail = last.slice(dashIdx + 1).trim();
    t = segs[0];
  }
  const tidy = s => s.replace(/\s*[,·]\s*(?=[,·])/g, '').replace(/\s{2,}/g, ' ')
                     .replace(/^[\s,·—-]+|[\s,·—-]+$/g, '').trim();
  t = tidy(t.replace(TITLE_AUDIENCE_RX, ' ').replace(TITLE_FILLER_RX, ' '));
  if (spec) {
    let stripped = t;
    if (spec.metal)  stripped = stripped.replace(new RegExp(SPEC_METAL_RX.source, 'gi'), ' ');
    if (spec.width)  stripped = stripped.replace(new RegExp(SPEC_WIDTH_RX.source, 'gi'), ' ');
    if (spec.finish) stripped = stripped.replace(new RegExp(SPEC_FINISH_RX.source, 'gi'), ' ');
    stripped = tidy(stripped);
    // Don't strip the name into meaninglessness ("Sterling Silver Ring" → "Ring")
    if (stripped.split(/\s+/).filter(Boolean).length >= 2) t = stripped;
  }
  if (!t) t = segs[0] || String(title || '').trim();
  const extra = variant || (spec ? '' : tail);
  return extra ? t + ' — ' + extra : t;
}

// One-line spec summary for descriptions/cards:
// "Rose Gold-Fill · Sz 7.5 · 4mm · Hammered"
function specSummary(it) {
  return [
    it.metal,
    it.ringSize ? 'Sz ' + it.ringSize : '',
    it.width,
    it.finish,
    it.specOther,
  ].filter(Boolean).join(' · ');
}

// Build one normalized ecom line item from a raw marketplace title +
// spec pairs. Shared by shopifyToOrder / etsyToOrder / ecomPrintItems.
function buildEcomItem(rawTitle, pairs, base) {
  const spec = parseSpecPairs(pairs);
  liftSpecFromTitle(rawTitle, spec);
  const it = Object.assign({
    type:     'manual',
    rawTitle: String(rawTitle || ''),
    price:    0,
    quantity: 1,
    personalization: '',
  }, base || {});
  it.name         = cleanProductTitle(rawTitle, { spec });
  it.ringSize     = spec.size;
  it.metal        = spec.metal;
  it.width        = spec.width;
  it.finish       = spec.finish;
  it.specOther    = spec.other.join(', ');
  if (spec.pers && !it.personalization) it.personalization = spec.pers;
  it.isRing       = !!spec.size;
  it.noSquareSize = !!spec.size;
  return it;
}

// Shared desc builder — the in-app card / Notion description lines.
function ecomItemsDesc(items) {
  return (items || []).map(it => {
    const sum = specSummary(it);
    let line = `${it.quantity}× ${it.name}${sum ? ' — ' + sum : ''}`;
    if (it.personalization) line += `\n   ✎ ${it.personalization}`;
    return line;
  }).join('\n');
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
  const items = (so.lineItems || []).map(li => buildEcomItem(
    li.title,
    // New proxy sends the full variantTitle; older payloads only had the
    // pre-extracted size — feed whichever exists into the spec parser.
    specPairsFromText(li.variant !== undefined ? li.variant : (li.size ? 'Size ' + li.size : '')),
    { price: li.price || 0, quantity: li.quantity || 1, personalization: li.personalization || '' }
  ));
  const desc = ecomItemsDesc(items);
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
  const items = (eo.lineItems || []).map(li => buildEcomItem(
    li.title,
    // New proxy sends labeled {name,value} variations; older payloads only
    // had the comma-joined values string — the parser handles both.
    Array.isArray(li.variations) && li.variations.length ? li.variations : specPairsFromText(li.variant || ''),
    { price: li.price || 0, quantity: li.quantity || 1, personalization: li.personalization || '' }
  ));
  const desc = items.length ? ecomItemsDesc(items) : (eo.desc || '');
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

// Print-ready structured items for the ecom bag layout. Handles three
// vintages of order:
//   1. freshly synced — spec fields already on each item;
//   2. legacy items — name/variant text only, re-parse at print time;
//   3. Notion-only auto-sync orders — no items at all, reconstruct from
//      the "N× Title — variant" desc lines.
function ecomPrintItems(o) {
  let items = Array.isArray(o.items) ? o.items.filter(it => it && (it.name || it.rawTitle)) : [];
  if (!items.length && o.desc) {
    items = [];
    String(o.desc).split('\n').forEach(rawLine => {
      const line = rawLine.trim();
      if (!line) return;
      if (/^✎/.test(line)) {
        // Personalization continuation line — belongs to the item above.
        if (items.length) {
          const prev = items[items.length - 1];
          const text = line.replace(/^✎\s*/, '');
          prev.personalization = prev.personalization ? prev.personalization + '; ' + text : text;
        }
        return;
      }
      const qm = /^(\d+)\s*[×x]\s*(.+)$/.exec(line);
      const qty = qm ? parseInt(qm[1], 10) : 1;
      const rest = qm ? qm[2] : line;
      const di = rest.indexOf(' — ');
      items.push({
        rawTitle: di !== -1 ? rest.slice(0, di) : rest,
        name:     di !== -1 ? rest.slice(0, di) : rest,
        variant:  di !== -1 ? rest.slice(di + 3) : '',
        quantity: qty,
        personalization: '',
      });
    });
  }
  return items.map(it => {
    let src = it;
    if (it.metal === undefined && it.width === undefined && it.finish === undefined) {
      // Legacy: name may carry a "Name — variant" tail; prefer an explicit
      // variant field when one exists.
      const nameStr = String(it.name || '');
      const di = nameStr.indexOf(' — ');
      const variantText = it.variant || (di !== -1 ? nameStr.slice(di + 3) : '');
      const pairs = specPairsFromText(variantText);
      if (it.ringSize) pairs.push({ name: 'Size', value: String(it.ringSize) });
      src = buildEcomItem(
        it.rawTitle || (di !== -1 ? nameStr.slice(0, di) : nameStr),
        pairs,
        { price: it.price || 0, quantity: it.quantity || 1, personalization: it.personalization || '' }
      );
    }
    return {
      name:   src.name            || '',
      raw:    src.rawTitle        || src.name || '',
      qty:    parseInt(src.quantity, 10) || 1,
      price:  parseFloat(src.price)      || 0,
      size:   src.ringSize        || '',
      metal:  src.metal           || '',
      width:  src.width           || '',
      finish: src.finish          || '',
      other:  src.specOther       || '',
      pers:   src.personalization || '',
    };
  });
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
