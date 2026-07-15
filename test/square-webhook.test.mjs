// Tests for functions/api/square-webhook.js — HMAC signature verification
// and the payment.updated → Notion split-inventory decrement, including the
// KV dedupe that stops split-tender orders from decrementing twice.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { onRequestPost } from '../functions/api/square-webhook.js';

const HOOK_URL = 'https://sts-deploy.pages.dev/api/square-webhook';
const SIG_KEY  = 'sq-signature-key';

function sign(body, url = HOOK_URL, key = SIG_KEY) {
  return createHmac('sha256', key).update(url + body).digest('base64');
}

function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async k => store.get(k) ?? null),
    put: vi.fn(async (k, v) => { store.set(k, v); }),
  };
}

function paymentEvent({ status = 'COMPLETED', teamMemberId = 'tm-you', orderId = 'ORDER1', type = 'payment.updated' } = {}) {
  return JSON.stringify({
    type,
    data: { object: { payment: { status, team_member_id: teamMemberId, order_id: orderId } } },
  });
}

function makeRequest(body, { sig } = {}) {
  return new Request(HOOK_URL, {
    method: 'POST',
    headers: sig !== undefined ? { 'x-square-hmacsha256-signature': sig } : {},
    body,
  });
}

// Routes the handler's outbound fetches: Square order lookup, Notion query,
// Notion page patch. Captures the PATCH bodies so tests can assert on the
// exact stock values written.
function stubFetch({ lineItems = [], notionRows = [] } = {}) {
  const patches = [];
  const fetchMock = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/v2/orders/')) {
      return new Response(JSON.stringify({ order: { line_items: lineItems } }), { status: 200 });
    }
    if (u.includes('/databases/') && u.endsWith('/query')) {
      return new Response(JSON.stringify({ results: notionRows }), { status: 200 });
    }
    if (u.includes('/pages/')) {
      patches.push({ url: u, body: JSON.parse(opts.body) });
      return new Response('{}', { status: 200 });
    }
    throw new Error('unexpected fetch: ' + u);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, patches };
}

function baseEnv(kv) {
  return {
    SQUARE_WEBHOOK_SIGNATURE_KEY: SIG_KEY,
    SQUARE_TOKEN: 'sq-token',
    NOTION_TOKEN: 'notion-token',
    NOTION_INVENTORY_DB_ID: 'inv-db',
    TEAM_MEMBER_ID_YOU: 'tm-you',
    TEAM_MEMBER_ID_GEORGINA: 'tm-geo',
    STS_KV: kv,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('signature verification', () => {
  it('rejects a bad signature with 401', async () => {
    const { fetchMock } = stubFetch();
    const body = paymentEvent();
    const res = await onRequestPost({
      request: makeRequest(body, { sig: 'not-the-right-sig' }),
      env: baseEnv(fakeKv()),
    });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a signature computed with the wrong key', async () => {
    stubFetch();
    const body = paymentEvent();
    const res = await onRequestPost({
      request: makeRequest(body, { sig: sign(body, HOOK_URL, 'wrong-key') }),
      env: baseEnv(fakeKv()),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a valid signature over a different body (replay/tamper)', async () => {
    stubFetch();
    const res = await onRequestPost({
      request: makeRequest(paymentEvent({ orderId: 'TAMPERED' }), { sig: sign(paymentEvent()) }),
      env: baseEnv(fakeKv()),
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid signature', async () => {
    stubFetch({ lineItems: [] });
    const body = paymentEvent();
    const res = await onRequestPost({
      request: makeRequest(body, { sig: sign(body) }),
      env: baseEnv(fakeKv()),
    });
    expect(res.status).toBe(200);
  });

  it('skips verification when no signature key is configured', async () => {
    stubFetch({ lineItems: [] });
    const env = baseEnv(fakeKv());
    delete env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    const res = await onRequestPost({ request: makeRequest(paymentEvent()), env });
    expect(res.status).toBe(200);
  });
});

describe('event filtering', () => {
  it('ACKs malformed JSON with 200 (Square requires it)', async () => {
    const { fetchMock } = stubFetch();
    const body = 'not json';
    const res = await onRequestPost({
      request: makeRequest(body, { sig: sign(body) }),
      env: baseEnv(fakeKv()),
    });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const [label, body] of [
    ['non-payment events', paymentEvent({ type: 'inventory.count.updated' })],
    ['non-COMPLETED payments (authorize/cancel)', paymentEvent({ status: 'APPROVED' })],
    ['payments from an unrecognized team member', paymentEvent({ teamMemberId: 'tm-stranger' })],
  ]) {
    it(`ACKs but ignores ${label}`, async () => {
      const { fetchMock } = stubFetch();
      const res = await onRequestPost({
        request: makeRequest(body, { sig: sign(body) }),
        env: baseEnv(fakeKv()),
      });
      expect(res.status).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});

describe('inventory decrement', () => {
  const notionRow = stock => ({
    id: 'page-1',
    properties: {
      'Current Stock: You':      { number: stock },
      'Current Stock: Georgina': { number: stock },
    },
  });

  it('decrements the seller-specific stock column by the line-item quantity', async () => {
    const { patches } = stubFetch({
      lineItems: [{ catalog_object_id: 'VAR1', quantity: '2', name: 'Hammered Ring' }],
      notionRows: [notionRow(5)],
    });
    const body = paymentEvent({ teamMemberId: 'tm-you' });
    const res = await onRequestPost({
      request: makeRequest(body, { sig: sign(body) }),
      env: baseEnv(fakeKv()),
    });
    expect(res.status).toBe(200);
    expect(patches).toHaveLength(1);
    expect(patches[0].body.properties['Current Stock: You']).toEqual({ number: 3 });
  });

  it("attributes Georgina's sales to her column", async () => {
    const { patches } = stubFetch({
      lineItems: [{ catalog_object_id: 'VAR1', quantity: '1' }],
      notionRows: [notionRow(4)],
    });
    const body = paymentEvent({ teamMemberId: 'tm-geo' });
    await onRequestPost({ request: makeRequest(body, { sig: sign(body) }), env: baseEnv(fakeKv()) });
    expect(patches[0].body.properties['Current Stock: Georgina']).toEqual({ number: 3 });
  });

  it('clamps stock at zero instead of going negative', async () => {
    const { patches } = stubFetch({
      lineItems: [{ catalog_object_id: 'VAR1', quantity: '5' }],
      notionRows: [notionRow(1)],
    });
    const body = paymentEvent();
    await onRequestPost({ request: makeRequest(body, { sig: sign(body) }), env: baseEnv(fakeKv()) });
    expect(patches[0].body.properties['Current Stock: You']).toEqual({ number: 0 });
  });

  it('skips line items with no Notion row for the SKU', async () => {
    const { patches } = stubFetch({
      lineItems: [{ catalog_object_id: 'UNKNOWN-SKU', quantity: '1' }],
      notionRows: [],
    });
    const body = paymentEvent();
    const res = await onRequestPost({ request: makeRequest(body, { sig: sign(body) }), env: baseEnv(fakeKv()) });
    expect(res.status).toBe(200);
    expect(patches).toHaveLength(0);
  });
});

describe('split-tender dedupe', () => {
  it('processes an order only once across repeated payment.updated events', async () => {
    const kv = fakeKv();
    const { patches, fetchMock } = stubFetch({
      lineItems: [{ catalog_object_id: 'VAR1', quantity: '1' }],
      notionRows: [{ id: 'page-1', properties: { 'Current Stock: You': { number: 5 } } }],
    });
    const body = paymentEvent({ orderId: 'ORDER-SPLIT' });
    const req = () => makeRequest(body, { sig: sign(body) });

    await onRequestPost({ request: req(), env: baseEnv(kv) });
    expect(patches).toHaveLength(1);

    // Second leg of the same order (e.g. cash after a failed card)
    const fetchCallsAfterFirst = fetchMock.mock.calls.length;
    const res2 = await onRequestPost({ request: req(), env: baseEnv(kv) });
    expect(res2.status).toBe(200);
    expect(patches).toHaveLength(1); // no second decrement
    expect(fetchMock.mock.calls.length).toBe(fetchCallsAfterFirst); // no Square/Notion traffic at all
  });

  it('sets the dedupe key with a TTL so KV does not grow forever', async () => {
    const kv = fakeKv();
    stubFetch({ lineItems: [], notionRows: [] });
    const body = paymentEvent({ orderId: 'ORDER-TTL' });
    await onRequestPost({ request: makeRequest(body, { sig: sign(body) }), env: baseEnv(kv) });
    expect(kv.put).toHaveBeenCalledWith('sq-webhook:order:ORDER-TTL', '1', { expirationTtl: 86400 });
  });

  it('still processes (with a warning) when KV is not bound', async () => {
    const { patches } = stubFetch({
      lineItems: [{ catalog_object_id: 'VAR1', quantity: '1' }],
      notionRows: [{ id: 'page-1', properties: { 'Current Stock: You': { number: 2 } } }],
    });
    const env = baseEnv(undefined);
    const body = paymentEvent();
    const res = await onRequestPost({ request: makeRequest(body, { sig: sign(body) }), env });
    expect(res.status).toBe(200);
    expect(patches).toHaveLength(1);
  });
});
