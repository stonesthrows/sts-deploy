// ════════════════════════════════════════════
//  SHIPSTATION LOOKUP  —  js/shipstation.js
//  Client-side helpers for the ShipStation tracking-number lookup
//  (server-side call lives in functions/api/shipstation.js — keys never
//  touch the browser) plus the carrier tracking-URL builder shared by
//  the order form, the supplier-order modal, and the Packages widget.
// ════════════════════════════════════════════

function ssTrackingUrl(carrier, number) {
  if (!number) return null;
  const c = (carrier || '').toLowerCase();
  const n = encodeURIComponent(number);
  if (c === 'usps') return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  if (c === 'ups')  return `https://www.ups.com/track?tracknum=${n}`;
  if (c === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (c === 'dhl')  return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${n}`;
  return `https://www.google.com/search?q=${n}+tracking`;
}

// Fills a tracking-number + carrier input pair from ShipStation, looked up by
// order number. Used by both the custom-order edit form and the Supplier
// Order History modal — pass in the element ids to fill and a guess at the
// order number to search for (the caller may adjust the guess via prompt()).
function ssLookupTracking(opts) {
  const numberFieldId  = opts.numberField;
  const carrierFieldId = opts.carrierField;
  let orderNumber = opts.orderNumberGuess || '';

  orderNumber = prompt('ShipStation order # to look up:', orderNumber);
  if (!orderNumber) return;

  const btn = opts.button;
  const prevText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  fetch('/api/shipstation?orderNumber=' + encodeURIComponent(orderNumber))
    .then(r => r.json())
    .then(data => {
      if (!data.found) {
        toast('No ShipStation shipment found for order ' + orderNumber, '⚠');
        return;
      }
      if (data.trackingNumber) {
        const numEl = document.getElementById(numberFieldId);
        if (numEl) numEl.value = data.trackingNumber;
      }
      if (data.carrier) {
        const carEl = document.getElementById(carrierFieldId);
        if (carEl) carEl.value = data.carrier;
      }
      toast('Tracking pulled from ShipStation ✓', '✓');
    })
    .catch(() => toast('ShipStation lookup failed', '⚠'))
    .finally(() => { if (btn) { btn.disabled = false; btn.textContent = prevText; } });
}
