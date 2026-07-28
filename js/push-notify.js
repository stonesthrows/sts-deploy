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

// ── Self-check ───────────────────────────────
// Both notify paths are silent no-ops when unconfigured, so a broken setup
// looks identical to a working one until a message fails to arrive. This
// asks the server what is actually live. See functions/api/notify-status.js.
function _nsRow(ok, label, detail) {
  return '<div class="ns-row ' + (ok ? 'ok' : 'bad') + '">'
    + '<span class="ns-mark" aria-hidden="true">' + (ok ? '✓' : '✕') + '</span>'
    + '<span class="ns-label">' + esc(label) + '</span>'
    + (detail ? '<span class="ns-detail">' + esc(detail) + '</span>' : '')
    + '</div>';
}

async function runNotifyDiagnostic() {
  var box = document.getElementById('notifyStatusOut');
  var btn = document.getElementById('notifyStatusBtn');
  if (!box) return;
  box.innerHTML = '<div class="ns-row">⏳ Checking…</div>';
  if (btn) btn.disabled = true;

  try {
    var res = await fetch('/api/notify-status');
    if (!res.ok) throw new Error('server returned ' + res.status);
    var d = await res.json();

    var rows = '';
    rows += _nsRow(d.notionToken.ok, 'Notion token', d.notionToken.hint || 'Set');

    if (d.messagesDb) {
      rows += _nsRow(d.messagesDb.ok, 'Messages database',
        d.messagesDb.ok ? d.messagesDb.rows + (d.messagesDb.more ? '+' : '') + ' message' + (d.messagesDb.rows === 1 ? '' : 's') + ' stored'
                        : d.messagesDb.hint);
    }
    if (d.pushDb) {
      rows += _nsRow(d.pushDb.ok, 'Push-subscriptions database',
        d.pushDb.ok ? d.subscribedDevices + ' device' + (d.subscribedDevices === 1 ? '' : 's') + ' subscribed'
                    : d.pushDb.hint);
    }
    rows += _nsRow(d.webPush.ok, 'Web Push',
      d.webPush.ok ? 'Key pair valid — notifications will send' : d.webPush.hint);
    rows += _nsRow(d.sms.ok, 'Text messages',
      d.sms.ok ? 'Texting ' + d.sms.to + (d.sms.skipAuthor ? ' (skips ' + d.sms.skipAuthor + ')' : '') : d.sms.hint);

    // This device's own subscription is a client-side fact the server
    // can't see — and "0 devices subscribed" is otherwise puzzling.
    var sub = await currentPushSubscription();
    rows += _nsRow(!!sub, 'This device',
      sub ? 'Subscribed to push'
          : (pushSupported() ? 'Not subscribed — use "Enable on This Device" above' : 'Push not supported in this browser'));

    box.innerHTML = rows + '<div class="ns-note">' + esc(d.note) + '</div>'
      + (sub && d.webPush.ok ? '<button class="btn btn-outline btn-sm" id="notifyTestPushBtn" onclick="sendTestPush()" style="margin-top:9px;">📨 Send Test Push to This Device</button>' : '')
      + '<div id="notifyTestPushOut"></div>';
  } catch (err) {
    console.error('notify-status failed:', err);
    box.innerHTML = '<div class="ns-row bad"><span class="ns-mark">✕</span>'
      + '<span class="ns-label">Could not reach the server</span>'
      + '<span class="ns-detail">' + esc(String(err.message || err))
      + ' — if this says 401, set the App API Key above.</span></div>';
  }
  if (btn) btn.disabled = false;
}

// Isolates delivery from everything else in the notify pipeline — no
// Notion write, no "skip the sender" rule, no message content. If a real
// message never arrives but this does, the problem is somewhere upstream of
// the push service (most likely the sender-skip rule doing exactly what it
// should); if this ALSO never arrives, the problem is the push service, the
// browser, or the OS, and the server-side reply says which.
async function sendTestPush() {
  var out = document.getElementById('notifyTestPushOut');
  var btn = document.getElementById('notifyTestPushBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    var sub = await currentPushSubscription();
    if (!sub) throw new Error('Not subscribed on this device');
    var res = await fetch('/api/notify-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    var d = await res.json();
    var t = d.test || {};
    if (out) out.innerHTML = _nsRow(!!t.ok, 'Test push', (t.status ? '[' + t.status + '] ' : '') + (t.hint || (t.ok ? 'Sent' : 'Failed')));
  } catch (err) {
    if (out) out.innerHTML = _nsRow(false, 'Test push', String(err.message || err));
  }
  if (btn) { btn.disabled = false; btn.textContent = '📨 Send Test Push to This Device'; }
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
