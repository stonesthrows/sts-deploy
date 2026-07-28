// ════════════════════════════════════════════
//  WEB PUSH  —  js/push-notify.js
//  Per-device opt-in for native notifications when a Team Message is
//  posted (see js/customer-messages.js). Controlled from the ⚙
//  Integrations modal — a global app setting, not tied to any one tab.
//
//  Server side: functions/api/push-subscribe.js (register/unsubscribe),
//  functions/api/notion-messages.js's notifyPush() (send), sw.js's
//  "push"/"notificationclick" handlers (receive + deep link).
// ════════════════════════════════════════════

// Not secret — the public half of the VAPID key pair. Must match
// VAPID_PUBLIC_KEY in functions/api/notion-messages.js.
const VAPID_PUBLIC_KEY = 'BPlW0roALoDK6gSXOmbPd6RA9ZSc6-NcTOgWlTpXM55SZOrAr2DhHwWc_xxnleeePq7EcQ0AUmOY-e60m-X-X_c';

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// PushManager wants the VAPID key as a Uint8Array, not the base64url string.
function urlBase64ToUint8Array(base64url) {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64  = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const out     = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Reflects current permission/subscription state in the Integrations modal.
async function renderPushStatus() {
  const statusEl = document.getElementById('pushNotifyStatus');
  const onBtn    = document.getElementById('pushNotifyEnableBtn');
  const offBtn   = document.getElementById('pushNotifyDisableBtn');
  if (!statusEl) return;

  if (!pushSupported()) {
    statusEl.textContent = 'Not supported in this browser.';
    if (onBtn)  onBtn.style.display  = 'none';
    if (offBtn) offBtn.style.display = 'none';
    return;
  }
  if (Notification.permission === 'denied') {
    statusEl.textContent = 'Blocked — re-enable notifications for this site in your browser/OS settings.';
    if (onBtn)  onBtn.style.display  = 'none';
    if (offBtn) offBtn.style.display = 'none';
    return;
  }

  const sub = await currentPushSubscription();
  if (sub) {
    statusEl.textContent = '✓ Enabled on this device.';
    if (onBtn)  onBtn.style.display  = 'none';
    if (offBtn) offBtn.style.display = '';
  } else {
    statusEl.textContent = 'Not enabled on this device.';
    if (onBtn)  onBtn.style.display  = '';
    if (offBtn) offBtn.style.display = 'none';
  }
}

async function enablePushNotifications() {
  if (!pushSupported()) { alert('Push notifications aren\'t supported in this browser.'); return; }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { renderPushStatus(); return; }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON();
    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint:  json.endpoint,
        keys:      json.keys,
        ownerName: localStorage.getItem('sts-staff-name') || '',
      }),
    });
    if (!res.ok) throw new Error('server rejected subscription: ' + res.status);
    if (typeof toast === 'function') toast('Notifications enabled on this device ✓', '🔔');
  } catch (err) {
    console.error('enablePushNotifications failed:', err);
    alert('Could not enable notifications: ' + err.message);
  }
  renderPushStatus();
}

async function disablePushNotifications() {
  try {
    const sub = await currentPushSubscription();
    if (sub) {
      await fetch('/api/push-subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {}); // best-effort — unsubscribe locally regardless
      await sub.unsubscribe();
    }
    if (typeof toast === 'function') toast('Notifications disabled on this device', '🔕');
  } catch (err) {
    console.error('disablePushNotifications failed:', err);
  }
  renderPushStatus();
}
