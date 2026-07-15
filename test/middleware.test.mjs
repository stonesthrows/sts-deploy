// Tests for functions/api/_middleware.js — the shared-key auth gate and
// CORS policy in front of every /api/* proxy. This is the only layer
// between the internet and the privileged tokens the proxies hold, so it
// gets the most paranoid coverage in the suite.
import { describe, it, expect } from 'vitest';
import { onRequest } from '../functions/api/_middleware.js';

const PROD = 'https://sts-deploy.pages.dev';

function ctx({ path = '/api/notion-orders', method = 'GET', headers = {}, env = {}, handler } = {}) {
  const next = async () => handler ? handler() : new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
  let nextCalled = false;
  const context = {
    request: new Request(PROD + path, { method, headers }),
    env,
    next: async () => { nextCalled = true; return next(); },
  };
  return { context, wasHandlerCalled: () => nextCalled };
}

describe('CORS origin policy', () => {
  const allowed = [
    'https://sts-deploy.pages.dev',
    'https://a1b2c3d4.sts-deploy.pages.dev', // Pages preview deploy
    'http://localhost:8788',
    'http://localhost',
    'http://127.0.0.1:3000',
  ];
  const rejected = [
    'https://evil.com',
    'https://sts-deploy.pages.dev.evil.com',   // suffix spoof
    'https://evilsts-deploy.pages.dev',        // prefix spoof, no dot
    'http://sts-deploy.pages.dev',             // http downgrade
    'https://localhost:8788',                  // localhost must be http
    'https://sts-deploy.pages.dev:8443',       // unexpected port
  ];

  for (const origin of allowed) {
    it(`reflects allowed origin ${origin}`, async () => {
      const { context } = ctx({ headers: { Origin: origin } });
      const res = await onRequest(context);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    });
  }

  for (const origin of rejected) {
    it(`falls back to canonical origin for ${origin}`, async () => {
      const { context } = ctx({ headers: { Origin: origin } });
      const res = await onRequest(context);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PROD);
    });
  }

  it('never emits a wildcard, even when the handler set one', async () => {
    const { context } = ctx({ headers: { Origin: 'https://evil.com' } });
    const res = await onRequest(context);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('answers OPTIONS preflight centrally with 204 and X-STS-Key allowed', async () => {
    const { context, wasHandlerCalled } = ctx({
      method: 'OPTIONS',
      headers: { Origin: PROD },
    });
    const res = await onRequest(context);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-STS-Key');
    expect(wasHandlerCalled()).toBe(false);
  });
});

describe('auth gate', () => {
  const KEY = 'test-shared-key-123';

  it('fails open when APP_SHARED_KEY is not configured', async () => {
    const { context, wasHandlerCalled } = ctx({ env: {} });
    const res = await onRequest(context);
    expect(res.status).toBe(200);
    expect(wasHandlerCalled()).toBe(true);
  });

  it('rejects a request with no key once configured', async () => {
    const { context, wasHandlerCalled } = ctx({ env: { APP_SHARED_KEY: KEY } });
    const res = await onRequest(context);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(wasHandlerCalled()).toBe(false);
  });

  it('rejects a wrong key', async () => {
    const { context, wasHandlerCalled } = ctx({
      env: { APP_SHARED_KEY: KEY },
      headers: { 'X-STS-Key': 'wrong' },
    });
    const res = await onRequest(context);
    expect(res.status).toBe(401);
    expect(wasHandlerCalled()).toBe(false);
  });

  it('passes a correct key through to the handler', async () => {
    const { context, wasHandlerCalled } = ctx({
      env: { APP_SHARED_KEY: KEY },
      headers: { 'X-STS-Key': KEY },
    });
    const res = await onRequest(context);
    expect(res.status).toBe(200);
    expect(wasHandlerCalled()).toBe(true);
  });

  it('guards sub-path routes of a protected endpoint', async () => {
    const { context } = ctx({
      path: '/api/notion-orders/some/sub/path',
      env: { APP_SHARED_KEY: KEY },
    });
    const res = await onRequest(context);
    expect(res.status).toBe(401);
  });

  // Endpoints called by third parties can't send our header — they must
  // stay reachable (each carries its own verification inside the handler).
  const publicEndpoints = [
    '/api/square-webhook',
    '/api/sms-note',
    '/api/etsy-auth',
    '/api/etsy-auth/callback', // OAuth redirect lands on a sub-path
    '/api/square-sync',
    '/api/sync-orders',
    '/api/timer-ping',
  ];
  for (const path of publicEndpoints) {
    it(`exempts public endpoint ${path}`, async () => {
      const { context, wasHandlerCalled } = ctx({
        path,
        method: 'POST',
        env: { APP_SHARED_KEY: KEY },
      });
      const res = await onRequest(context);
      expect(res.status).toBe(200);
      expect(wasHandlerCalled()).toBe(true);
    });
  }

  it('does not exempt a protected endpoint whose name merely contains a public one', async () => {
    const { context } = ctx({
      path: '/api/square-webhook-admin',
      env: { APP_SHARED_KEY: KEY },
    });
    const res = await onRequest(context);
    expect(res.status).toBe(401);
  });
});

describe('response header rewriting', () => {
  it("replaces the handler's wildcard CORS with the tightened origin", async () => {
    const { context } = ctx({ headers: { Origin: PROD } });
    const res = await onRequest(context);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PROD);
  });

  it('leaves redirect responses untouched (immutable headers)', async () => {
    const { context } = ctx({
      headers: { Origin: PROD },
      handler: () => Response.redirect('https://www.etsy.com/oauth', 302),
    });
    const res = await onRequest(context);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://www.etsy.com/oauth');
  });
});
