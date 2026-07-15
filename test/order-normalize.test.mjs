// Tests for js/order-normalize.js — the unified order schema shared by
// manual intake, Shopify, and Etsy. Everything here is pure (no DOM), so it
// loads straight into a vm context via the helper.
import { describe, it, expect } from 'vitest';
import { loadGlobalScript } from './helpers/load-script.mjs';

const {
  inferOrderKind, specSizeValue, specPairsFromText, parseSpecPairs,
  liftSpecFromTitle, cleanProductTitle, specSummary, buildEcomItem,
  ecomItemsDesc, normalizeOrder, shopifyToOrder, etsyToOrder,
  printLayoutFor, backfillEcomOrder, ecomPrintItems, printParamsFor,
} = loadGlobalScript('js/order-normalize.js', [
  'inferOrderKind', 'specSizeValue', 'specPairsFromText', 'parseSpecPairs',
  'liftSpecFromTitle', 'cleanProductTitle', 'specSummary', 'buildEcomItem',
  'ecomItemsDesc', 'normalizeOrder', 'shopifyToOrder', 'etsyToOrder',
  'printLayoutFor', 'backfillEcomOrder', 'ecomPrintItems', 'printParamsFor',
]);

describe('inferOrderKind — legacy fallback chain', () => {
  it('trusts an explicit valid orderKind above everything', () => {
    expect(inferOrderKind({ orderKind: 'repair', id: 'shopify-1', stage: 'etsy-bench' })).toBe('repair');
  });
  it('ignores an invalid orderKind and falls through', () => {
    expect(inferOrderKind({ orderKind: 'bogus', id: 'etsy-99' })).toBe('etsy');
  });
  it('infers from id prefixes', () => {
    expect(inferOrderKind({ id: 'shopify-12345' })).toBe('shopify');
    expect(inferOrderKind({ id: 'etsy-67890' })).toBe('etsy');
  });
  it('infers from legacy orderType', () => {
    expect(inferOrderKind({ orderType: 'resize' })).toBe('resize');
    expect(inferOrderKind({ orderType: 'repair' })).toBe('repair');
    expect(inferOrderKind({ orderType: 'estimate' })).toBe('estimate');
    expect(inferOrderKind({ orderType: 'square-item' })).toBe('square-item');
  });
  it('infers from stage', () => {
    expect(inferOrderKind({ stage: 'etsy-bench' })).toBe('etsy');
    expect(inferOrderKind({ stage: 'intake-website' })).toBe('shopify');
    expect(inferOrderKind({ stage: 'intake-repair' })).toBe('repair');
    expect(inferOrderKind({ stage: 'needs-est' })).toBe('estimate');
    expect(inferOrderKind({ stage: 'quote' })).toBe('estimate');
  });
  it('infers from contactSource, then defaults to custom', () => {
    expect(inferOrderKind({ contactSource: 'Etsy Message' })).toBe('etsy');
    expect(inferOrderKind({ contactSource: 'Website Order' })).toBe('shopify');
    expect(inferOrderKind({})).toBe('custom');
  });
  it('respects priority: id prefix beats orderType beats stage', () => {
    expect(inferOrderKind({ id: 'shopify-1', orderType: 'repair', stage: 'etsy-bench' })).toBe('shopify');
    expect(inferOrderKind({ id: 'x-1', orderType: 'repair', stage: 'etsy-bench' })).toBe('repair');
  });
});

describe('specSizeValue — ring size extraction', () => {
  const cases = [
    ['Size 7.5', '7.5'],
    ['Ring size: 7 US', '7'],
    ['Sz 7', '7'],
    ['size 6', '6'],
    ['US 9', '9'],
    ['7,5', '7.5'],       // European decimal comma
    ['7 1/2', '7 1/2'],   // fraction sizes survive
    ['7½', '7½'],
  ];
  for (const [input, want] of cases) {
    it(`"${input}" → "${want}"`, () => expect(specSizeValue(input)).toBe(want));
  }
  it('passes through values it cannot parse', () => {
    expect(specSizeValue('adjustable')).toBe('adjustable');
  });
});

describe('specPairsFromText — separator auto-detection', () => {
  it('splits Etsy-style ";"-joined labeled pairs', () => {
    expect(specPairsFromText('Ring size: 7 US; Metal: Rose Gold-Fill')).toEqual([
      { name: 'Ring size', value: '7 US' },
      { name: 'Metal', value: 'Rose Gold-Fill' },
    ]);
  });
  it('splits Shopify variantTitle on " / " without labels', () => {
    expect(specPairsFromText('Size 7.5 / 4mm / Lined, High Polish')).toEqual([
      { name: '', value: 'Size 7.5' },
      { name: '', value: '4mm' },
      { name: '', value: 'Lined, High Polish' },
    ]);
  });
  it('splits spec summaries on "·"', () => {
    expect(specPairsFromText('Sterling Silver · Sz 7 · 4mm')).toHaveLength(3);
  });
  it('falls back to commas for legacy imports', () => {
    expect(specPairsFromText('Sterling Silver, Hammered')).toEqual([
      { name: '', value: 'Sterling Silver' },
      { name: '', value: 'Hammered' },
    ]);
  });
  it('returns [] for empty input', () => {
    expect(specPairsFromText('')).toEqual([]);
    expect(specPairsFromText(null)).toEqual([]);
  });
});

describe('parseSpecPairs — bench spec fields', () => {
  it('parses the documented Shopify example', () => {
    const spec = parseSpecPairs(specPairsFromText('Size 7.5 / 4mm / Lined, High Polish'));
    expect(spec.size).toBe('7.5');
    expect(spec.width).toBe('4mm');
    expect(spec.finish).toBe('Lined, High Polish');
  });
  it('parses the documented Etsy example', () => {
    const spec = parseSpecPairs(specPairsFromText('Ring size: 7 US; Metal: Rose Gold-Fill'));
    expect(spec.size).toBe('7');
    expect(spec.metal).toBe('Rose Gold-Fill');
  });
  it('classifies unlabeled values by shape', () => {
    const spec = parseSpecPairs([
      { name: '', value: '8' },
      { name: '', value: '6mm' },
      { name: '', value: 'Sterling Silver' },
      { name: '', value: 'Hammered' },
    ]);
    expect(spec).toMatchObject({ size: '8', width: '6mm', metal: 'Sterling Silver', finish: 'Hammered' });
  });
  it('routes labeled personalization/engraving into pers, never onto the bag spec', () => {
    const spec = parseSpecPairs([
      { name: 'Personalization', value: 'HANK + GEORGIE' },
      { name: 'Engraving', value: '05.20.26' },
    ]);
    expect(spec.pers).toBe('HANK + GEORGIE; 05.20.26');
  });
  it('does not mistake a stone/bead mm for band width', () => {
    const spec = parseSpecPairs([{ name: '', value: '6mm pearl bead' }]);
    expect(spec.width).toBe('');
    expect(spec.other).toContain('6mm pearl bead');
  });
  it('keeps the first value when a field repeats', () => {
    const spec = parseSpecPairs([
      { name: 'Size', value: '7' },
      { name: 'Ring size', value: '9' },
    ]);
    expect(spec.size).toBe('7');
  });
  it('collects unclassifiable values into other', () => {
    const spec = parseSpecPairs([{ name: '', value: 'Gift wrapped' }]);
    expect(spec.other).toEqual(['Gift wrapped']);
  });
});

describe('liftSpecFromTitle — pulling spec words out of SEO titles', () => {
  it('fills metal/width/finish the variant did not carry', () => {
    const spec = { size: '', metal: '', width: '', finish: '', other: [], pers: '' };
    liftSpecFromTitle('4mm Hammered Sterling Silver Band', spec);
    expect(spec.metal).toBe('Sterling Silver');
    expect(spec.width).toBe('4mm');
    expect(spec.finish).toBe('Hammered');
  });
  it('keeps the most specific metal across the whole title', () => {
    const spec = { size: '', metal: '', width: '', finish: '', other: [], pers: '' };
    liftSpecFromTitle('Silver Ring | Sterling Silver Band for Women', spec);
    expect(spec.metal).toBe('Sterling Silver');
  });
  it('only trusts the first |-segment for width/finish (SEO tails list every option)', () => {
    const spec = { size: '', metal: '', width: '', finish: '', other: [], pers: '' };
    liftSpecFromTitle('Classic Band | 4mm 6mm 8mm Hammered or Smooth', spec);
    expect(spec.width).toBe('');
    expect(spec.finish).toBe('');
  });
  it('does not duplicate a finish the variant already named', () => {
    const spec = { size: '', metal: '', width: '', finish: 'Hammered', other: [], pers: '' };
    liftSpecFromTitle('Hammered Gold Band', spec);
    expect(spec.finish).toBe('Hammered');
  });
});

describe('cleanProductTitle — SEO strip-down', () => {
  it('keeps only the first |-segment and drops filler/audience keywords', () => {
    const t = cleanProductTitle('Dainty Handmade Spinner Ring for Women | Eco Friendly Anxiety Ring | Gift Idea');
    expect(t).toBe('Spinner Ring');
  });
  it('removes spec words when a parsed spec is supplied (they print as labeled lines)', () => {
    const spec = { metal: 'Sterling Silver', width: '4mm', finish: 'Hammered' };
    expect(cleanProductTitle('4mm Hammered Sterling Silver Orbit Band', { spec })).toBe('Orbit Band');
  });
  it('refuses to strip a name into meaninglessness', () => {
    const spec = { metal: 'Sterling Silver', width: '', finish: '' };
    expect(cleanProductTitle('Sterling Silver Ring', { spec })).toBe('Sterling Silver Ring');
  });
  it('re-appends a legacy variant tail', () => {
    expect(cleanProductTitle('Orbit Band', { variant: 'Size 7' })).toBe('Orbit Band — Size 7');
  });
});

describe('buildEcomItem + specSummary + ecomItemsDesc', () => {
  it('builds a fully spec’d item from raw title + variant pairs', () => {
    const it_ = buildEcomItem(
      '4mm Sterling Silver Band for Men | Handmade Ring',
      specPairsFromText('Size 10 / Hammered'),
      { price: 85, quantity: 1 }
    );
    expect(it_.ringSize).toBe('10');
    expect(it_.metal).toBe('Sterling Silver');
    expect(it_.width).toBe('4mm');
    expect(it_.finish).toBe('Hammered');
    expect(it_.isRing).toBe(true);
    expect(it_.rawTitle).toContain('Sterling Silver Band');
  });
  it('renders the one-line card summary', () => {
    expect(specSummary({ metal: 'Rose Gold-Fill', ringSize: '7.5', width: '4mm', finish: 'Hammered' }))
      .toBe('Rose Gold-Fill · Sz 7.5 · 4mm · Hammered');
  });
  it('renders desc lines with quantity and personalization continuation', () => {
    const desc = ecomItemsDesc([
      { quantity: 2, name: 'Orbit Band', metal: 'Silver', personalization: 'HB 2026' },
    ]);
    expect(desc).toBe('2× Orbit Band — Silver\n   ✎ HB 2026');
  });
});

describe('normalizeOrder — idempotent migration', () => {
  it('migrates the legacy takeInDate field to takeIn', () => {
    const o = normalizeOrder({ takeInDate: '2026-05-01' });
    expect(o.takeIn).toBe('2026-05-01');
    expect('takeInDate' in o).toBe(false);
  });
  it('never overwrites an existing takeIn', () => {
    const o = normalizeOrder({ takeIn: '2026-04-01', takeInDate: '2026-05-01' });
    expect(o.takeIn).toBe('2026-04-01');
  });
  it('recovers sourceOrderNumber from machine headers in notes', () => {
    expect(normalizeOrder({ notes: 'Shopify Order #1001\nBuyer note: hi' }).sourceOrderNumber).toBe('#1001');
    expect(normalizeOrder({ notes: 'Etsy Order #333222111', stage: 'etsy-bench' }).sourceOrderNumber).toBe('333222111');
  });
  it('derives an Etsy order number from the id suffix', () => {
    expect(normalizeOrder({ id: 'etsy-987654' }).sourceOrderNumber).toBe('987654');
  });
  it('lifts a legacy "Ship to:" line into structured address fields, right-to-left', () => {
    const o = normalizeOrder({ notes: 'Ship to: 123 Main St, Apt 4, Austin, TX, 78704, United States' });
    expect(o.addrStreet).toBe('123 Main St, Apt 4');
    expect(o.addrCity).toBe('Austin');
    expect(o.addrState).toBe('TX');
    expect(o.addrZip).toBe('78704');
    expect(o.addrCountry).toBe('United States');
  });
  it('scrubs machine lines out of notes but keeps buyer content', () => {
    const o = normalizeOrder({
      notes: 'Shopify Order #1001\nShip to: 1 Main St, Austin, TX, 78704, US\nBuyer note: engrave inside please',
    });
    expect(o.notes).toBe('engrave inside please');
  });
  it('mirrors flat address fields into shippingAddress{} and back', () => {
    const flat = normalizeOrder({ addrStreet: '1 Main St', addrCity: 'Austin', addrState: 'TX', addrZip: '78704', addrCountry: 'US' });
    expect(flat.shippingAddress).toMatchObject({ street: '1 Main St', city: 'Austin' });

    const nested = normalizeOrder({ shippingAddress: { street: '2 Elm St', city: 'Waco', state: 'TX', zip: '76701', country: 'US' } });
    expect(nested.addrStreet).toBe('2 Elm St');
    expect(nested.addrCity).toBe('Waco');
  });
  it('is idempotent — a second pass changes nothing (migrateLegacyOrders relies on this)', () => {
    const raw = {
      id: 'etsy-42', takeInDate: '2026-05-01',
      notes: 'Etsy Order #42\nShip to: 1 Main St, Austin, TX, 78704, US\nNote: rush please',
    };
    const once = normalizeOrder(JSON.parse(JSON.stringify(raw)));
    const twice = normalizeOrder(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
  it('tolerates junk input', () => {
    expect(normalizeOrder(null)).toBe(null);
    expect(normalizeOrder('nope')).toBe('nope');
  });
});

describe('shopifyToOrder / etsyToOrder', () => {
  const shopifyRow = {
    shopifyOrderId: '555', shopifyOrderName: '#1042',
    name: 'Jo Buyer', email: 'jo@example.com', price: 120,
    createdAt: '2026-06-01T15:30:00Z',
    buyerNote: 'please gift wrap',
    lineItems: [{ title: '4mm Sterling Silver Band', variant: 'Size 7.5 / Hammered', price: 120, quantity: 1 }],
    addrStreet: '1 Main St', addrCity: 'Austin', addrState: 'TX', addrZip: '78704', addrCountry: 'US',
  };

  it('maps a Shopify proxy row to a normalized app order', () => {
    const o = shopifyToOrder(shopifyRow);
    expect(o.id).toBe('shopify-555');
    expect(o.orderKind).toBe('shopify');
    expect(o.orderSource).toBe('shopify');
    expect(o.sourceOrderNumber).toBe('#1042');
    expect(o.stage).toBe('intake-website');
    expect(o.takeIn).toBe('2026-06-01');
    expect(o.ringSize).toBe('7.5');
    expect(o.notes).toBe('please gift wrap');
    expect(o.fullyPaid).toBe(true);
    expect(o.shippingAddress.city).toBe('Austin');
  });

  it('maps an Etsy proxy row, including the ship-by deadline and labeled variations', () => {
    const o = etsyToOrder({
      etsyReceiptId: 987654, name: 'Sam Buyer', price: 95,
      createdAt: '2026-06-02T10:00:00Z', shipByDate: '2026-06-09T00:00:00Z',
      lineItems: [{
        title: 'Rose Gold Fill Stacking Ring',
        variations: [{ name: 'Ring size', value: '6 US' }, { name: 'Metal', value: 'Rose Gold-Fill' }],
        price: 95, quantity: 1,
      }],
    });
    expect(o.id).toBe('etsy-987654');
    expect(o.sourceOrderNumber).toBe('987654');
    expect(o.stage).toBe('etsy-bench');
    expect(o.takeIn).toBe('2026-06-02');
    expect(o.deadline).toBe('2026-06-09');
    expect(o.ringSize).toBe('6');
    expect(o.items[0].metal).toBe('Rose Gold-Fill');
  });

  it('feeds the legacy pre-extracted Shopify size through the spec parser', () => {
    const o = shopifyToOrder({
      shopifyOrderId: '1', lineItems: [{ title: 'Band', size: '8' }],
    });
    expect(o.items[0].ringSize).toBe('8');
  });
});

describe('print helpers', () => {
  it('maps every kind to its print layout, defaulting to custom', () => {
    expect(printLayoutFor('shopify')).toBe('ecom');
    expect(printLayoutFor('etsy')).toBe('ecom');
    expect(printLayoutFor('repair')).toBe('repair');
    expect(printLayoutFor('square-item')).toBe('custom');
    expect(printLayoutFor('unknown')).toBe('custom');
  });

  it('printParamsFor labels the source and the bench assignee stage', () => {
    const p = printParamsFor({ id: 'etsy-9', stage: 'kyle', sourceOrderNumber: '9' });
    expect(p).toMatchObject({ kind: 'etsy', layout: 'ecom', source: 'Etsy', orderNo: '9', workedBy: 'Kyle' });
  });

  it('ecomPrintItems reconstructs items from desc lines for Notion-only orders', () => {
    const items = ecomPrintItems({
      desc: '2× Orbit Band — Size 7 / 4mm\n   ✎ HANK + GEORGIE\n1× Stacking Ring — Sterling Silver',
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ qty: 2, size: '7', width: '4mm', pers: 'HANK + GEORGIE' });
    expect(items[1]).toMatchObject({ qty: 1, metal: 'Sterling Silver' });
  });

  it('ecomPrintItems re-parses legacy items that predate spec fields', () => {
    const items = ecomPrintItems({
      items: [{ name: 'Orbit Band — Size 7 / Hammered', quantity: 1, ringSize: '' }],
    });
    expect(items[0]).toMatchObject({ size: '7', finish: 'Hammered' });
  });

  it('ecomPrintItems passes through freshly synced spec’d items untouched', () => {
    const items = ecomPrintItems({
      items: [{ name: 'Band', metal: 'Silver', width: '4mm', finish: '', ringSize: '7', quantity: '2', price: '85.5' }],
    });
    expect(items[0]).toMatchObject({ name: 'Band', metal: 'Silver', qty: 2, price: 85.5, size: '7' });
  });
});

describe('backfillEcomOrder — re-sync without clobbering human edits', () => {
  it('fills a missing deadline', () => {
    const o = { items: [] };
    expect(backfillEcomOrder(o, { deadline: '2026-06-09' })).toBe(true);
    expect(o.deadline).toBe('2026-06-09');
  });
  it('never overwrites an existing deadline', () => {
    const o = { deadline: '2026-06-01' };
    expect(backfillEcomOrder(o, { deadline: '2026-06-09' })).toBe(false);
    expect(o.deadline).toBe('2026-06-01');
  });
  it('replaces spec-less machine-vintage items with fresh spec’d ones', () => {
    const o = { items: [{ name: 'Band — Size 7' }], desc: 'old desc' };
    const fresh = { items: [{ name: 'Band', metal: 'Silver', ringSize: '7' }], desc: 'new desc', ringSize: '7' };
    expect(backfillEcomOrder(o, fresh)).toBe(true);
    expect(o.items).toBe(fresh.items);
    expect(o.desc).toBe('new desc');
  });
  it('leaves already-spec’d items alone', () => {
    const kept = [{ name: 'Band', metal: 'Silver', ringSize: '7' }];
    const o = { items: kept };
    expect(backfillEcomOrder(o, { items: [{ name: 'Other', metal: 'Gold' }] })).toBe(false);
    expect(o.items).toBe(kept);
  });
});
