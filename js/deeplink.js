// ════════════════════════════════════════════
//  DEEP LINK  —  js/deeplink.js
//  Opens an order card from a #order=<id> URL hash.
//  The hash comes from the QR code printed on work-order bags
//  (work-order-print.html) — scan the bag with a phone and the
//  app opens straight to that order.
//
//  drive.js also uses the hash for its OAuth token callback
//  (#access_token=…) — that shape never matches #order=, so the
//  two can't collide.
// ════════════════════════════════════════════
(function () {
  'use strict';

  var DEEPLINK_RETRY_MS  = 300;
  var DEEPLINK_MAX_TRIES = 50; // ~15s — first load on a fresh phone waits on Notion sync

  var _attempting = false;

  function clearHash() {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }

  function tryOpenFromHash() {
    var m = location.hash.match(/^#order=(.+)$/);
    if (!m || _attempting) return;
    var id = decodeURIComponent(m[1]);
    _attempting = true;
    var tries = 0;

    (function attempt() {
      // ORDERS fills from the localStorage cache synchronously at boot, but a
      // phone that has never opened the app only gets data after the Notion
      // startup sync — so poll instead of checking once.
      var found = (typeof ORDERS !== 'undefined') &&
        ORDERS.find(function (o) { return String(o.id) === id; });
      if (found && typeof openOrderCard === 'function') {
        _attempting = false;
        clearHash();
        openOrderCard(found.id);
        return;
      }
      if (++tries >= DEEPLINK_MAX_TRIES) {
        _attempting = false;
        clearHash();
        if (typeof toast === 'function') toast('Scanned order not found — it may have been deleted', '⚠');
        return;
      }
      setTimeout(attempt, DEEPLINK_RETRY_MS);
    })();
  }

  window.addEventListener('hashchange', tryOpenFromHash);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryOpenFromHash);
  } else {
    tryOpenFromHash();
  }
})();
