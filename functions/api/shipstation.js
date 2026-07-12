// Cloudflare Pages Function — proxies ShipStation API v1 calls (server-side keys)
// Requires env vars: SHIPSTATION_API_KEY, SHIPSTATION_API_SECRET
// GET /api/shipstation?orderNumber=1147        → looks up a ShipStation order by order #
// GET /api/shipstation?trackingNumber=94001... → looks up a shipment by tracking #

import { json as jsonResponse } from './_lib.js';

const SS_API = 'https://ssapi.shipstation.com';

const CARRIER_NAMES = {
  stamps_com: 'USPS', usps: 'USPS', endicia: 'USPS',
  ups: 'UPS', ups_walleted: 'UPS',
  fedex: 'FedEx', fedex_walleted: 'FedEx',
  dhl_express: 'DHL', dhl_ecommerce: 'DHL', dhl_global_mail: 'DHL',
};

function carrierName(code) {
  return CARRIER_NAMES[(code || '').toLowerCase()] || (code || '');
}

function authHeader(env) {
  const key = env.SHIPSTATION_API_KEY, secret = env.SHIPSTATION_API_SECRET;
  if (!key || !secret) return null;
  return 'Basic ' + btoa(key + ':' + secret);
}

export async function onRequestGet(context) {
  const auth = authHeader(context.env);
  if (!auth) return jsonResponse({ error: 'SHIPSTATION_API_KEY / SHIPSTATION_API_SECRET not set' }, 500);

  const url            = new URL(context.request.url);
  const orderNumber    = url.searchParams.get('orderNumber');
  const trackingNumber = url.searchParams.get('trackingNumber');
  if (!orderNumber && !trackingNumber) {
    return jsonResponse({ error: 'orderNumber or trackingNumber query param required' }, 400);
  }

  const ssUrl = trackingNumber
    ? `${SS_API}/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`
    : `${SS_API}/orders?orderNumber=${encodeURIComponent(orderNumber)}`;

  const r = await fetch(ssUrl, { headers: { 'Authorization': auth } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return jsonResponse({ error: data.Message || data.message || 'ShipStation request failed' }, r.status);

  const list = data.shipments || data.orders || [];
  if (!list.length) return jsonResponse({ found: false });

  // Most recent match by ship/create date
  const match = list.slice().sort((a, b) =>
    new Date(b.shipDate || b.createDate || 0) - new Date(a.shipDate || a.createDate || 0)
  )[0];

  return jsonResponse({
    found:          true,
    orderNumber:    match.orderNumber    || orderNumber || '',
    trackingNumber: match.trackingNumber || '',
    carrier:        carrierName(match.carrierCode),
    shipDate:       match.shipDate       || null,
    voided:         !!match.voided,
    orderStatus:    match.orderStatus    || null,
  });
}

