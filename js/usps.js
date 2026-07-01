// ════════════════════════════════════════════
//  USPS LIVE TRACKING  —  js/usps.js
//  Client-side helper for pulling live scan status from the USPS Tracking
//  API (server-side call lives in functions/api/usps-tracking.js — keys
//  never touch the browser). Used by the Packages widget's 📡 button.
// ════════════════════════════════════════════

function uspsCheckStatus(rowId, btn) {
  const trackEl   = document.getElementById(rowId + '-tracking');
  const carrierEl = document.getElementById(rowId + '-carrier');
  const statusEl  = document.getElementById(rowId + '-status');
  const tracking  = (trackEl && trackEl.value || '').trim();

  if (!tracking) { toast('Enter a tracking number first', '⚠'); return; }
  if (carrierEl && carrierEl.value && carrierEl.value !== 'USPS') {
    toast('Live status lookup only supports USPS right now', '⚠');
    return;
  }

  const prevText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  fetch('/api/usps-tracking?trackingNumber=' + encodeURIComponent(tracking))
    .then(r => r.json())
    .then(data => {
      if (!data.found) {
        toast(data.error || 'No USPS tracking info found', '⚠');
        return;
      }
      if (carrierEl && !carrierEl.value) carrierEl.value = 'USPS';
      if (statusEl && data.mappedStatus) statusEl.value = data.mappedStatus;
      toast('USPS: ' + (data.status || data.statusCategory || 'status pulled'), '✓');
    })
    .catch(() => toast('USPS lookup failed', '⚠'))
    .finally(() => { if (btn) { btn.disabled = false; btn.textContent = prevText; } });
}
