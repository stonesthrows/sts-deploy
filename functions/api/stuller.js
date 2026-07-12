// Cloudflare Pages Function — proxies Stuller API calls
// Keeps credentials server-side and solves CORS.
// Env vars required: STULLER_USER, STULLER_PASS

import { json as jsonResponse, CORS } from './_lib.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sku = url.searchParams.get('sku');
  if (!sku) return jsonResponse({ error: 'Missing ?sku= parameter' }, 400);
  // Use POST /v2/products with Skus filter — the GET single-SKU endpoint format is undocumented
  const body = JSON.stringify({ Include: ['All'], Skus: [sku], Filter: ['Orderable'] });
  return proxyToStuller('https://api.stuller.com/v2/products', 'POST', body, context.env);
}

export async function onRequestPost(context) {
  const body = await context.request.text();
  return proxyToStuller('https://api.stuller.com/v2/products', 'POST', body, context.env);
}

async function proxyToStuller(url, method, body, env) {
  try {
    const user = env.STULLER_USER;
    const pass = env.STULLER_PASS;

    if (!user || !pass) {
      return jsonResponse({
        error: 'Stuller credentials not configured — add STULLER_USER and STULLER_PASS in Cloudflare Pages → Settings → Environment Variables.'
      }, 500);
    }

    // Use TextEncoder-based base64 to handle any characters in credentials
    const credBytes = new TextEncoder().encode(`${user}:${pass}`);
    const credB64 = btoa(String.fromCharCode(...credBytes));

    const headers = {
      'Authorization': 'Basic ' + credB64,
      'Accept': 'application/json',
    };
    if (method === 'POST') headers['Content-Type'] = 'application/json';

    const resp = await fetch(url, { method, headers, body: body || undefined });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (err) {
    return jsonResponse({ error: 'Function error: ' + err.message }, 500);
  }
}

