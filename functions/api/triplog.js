// Cloudflare Pages Function — /api/triplog
// Proxies requests to the TripLog API to work around CORS.

const TRIPLOG_API_KEY  = '8e7bd7cef6e7476584e561dc4a1eeaeb';
const TRIPLOG_API_BASE = 'https://app.triplog.net/web/api';

export async function onRequestGet(context) {
  const url        = new URL(context.request.url);
  const startDate  = url.searchParams.get('startDate') || '';
  const endDate    = url.searchParams.get('endDate')   || '';
  const tripId     = url.searchParams.get('tripId')    || '';

  let apiUrl;
  if (tripId) {
    apiUrl = `${TRIPLOG_API_BASE}/trips/${encodeURIComponent(tripId)}`;
  } else {
    apiUrl = `${TRIPLOG_API_BASE}/trips?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  }

  try {
    const resp = await fetch(apiUrl, {
      headers: {
        Authorization: `apikey ${TRIPLOG_API_KEY}`,
        Accept: 'application/json',
      },
    });

    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
