// Cloudflare Pages Function — proxies the USPS Tracking API v3 (server-side keys)
// Requires env vars: USPS_CONSUMER_KEY, USPS_CONSUMER_SECRET
// GET /api/usps-tracking?trackingNumber=9400... → live scan status for a USPS tracking number

import { json as jsonResponse } from './_lib.js';

const USPS_OAUTH_URL   = 'https://apis.usps.com/oauth2/v3/token';
const USPS_TRACKING_URL = 'https://apis.usps.com/tracking/v3/tracking/';

// Maps USPS's statusCategory onto the widget's own status vocabulary
// (Label Created / Picked Up / In Transit / Out for Delivery / Delivered / Received).
const STATUS_MAP = {
  'pre-shipment':      'Label Created',
  'accepted':          'Picked Up',
  'in transit':        'In Transit',
  'arrived':            'In Transit',
  'departed':           'In Transit',
  'out for delivery':  'Out for Delivery',
  'delivered':         'Delivered',
  'alert':             null, // exceptions (delayed, returned, etc.) — surface raw text instead
};

function mapStatus(statusCategory, status) {
  const key = (statusCategory || '').toLowerCase();
  if (STATUS_MAP[key]) return STATUS_MAP[key];
  return null;
}

async function getToken(env) {
  const clientId = env.USPS_CONSUMER_KEY, clientSecret = env.USPS_CONSUMER_SECRET;
  if (!clientId || !clientSecret) return { token: null, error: 'USPS_CONSUMER_KEY / USPS_CONSUMER_SECRET not set' };

  const r = await fetch(USPS_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { token: null, error: data.error_description || data.error || `USPS OAuth failed (${r.status})` };
  return { token: data.access_token || null, error: data.access_token ? null : 'No access_token in USPS OAuth response' };
}

export async function onRequestGet(context) {
  const trackingNumber = new URL(context.request.url).searchParams.get('trackingNumber');
  if (!trackingNumber) return jsonResponse({ error: 'trackingNumber query param required' }, 400);

  const { token, error: tokenError } = await getToken(context.env);
  if (!token) return jsonResponse({ error: tokenError || 'USPS OAuth failed' }, 500);

  const r = await fetch(USPS_TRACKING_URL + encodeURIComponent(trackingNumber), {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return jsonResponse({ found: false, error: data.error?.message || data.message || 'USPS lookup failed' }, r.status === 404 ? 200 : r.status);
  }

  return jsonResponse({
    found:          true,
    status:         data.status || data.statusSummary || null,
    statusCategory: data.statusCategory || null,
    mappedStatus:   mapStatus(data.statusCategory, data.status),
    deliveredDate:  data.deliveryDate || data.expectedDeliveryDate || null,
  });
}

