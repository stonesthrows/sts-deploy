// ════════════════════════════════════════════
//  API AUTH SHIM  —  js/api-auth.js  (must load FIRST)
//  Injects the shared key (X-STS-Key) into every same-origin /api/*
//  request so the server gate (functions/api/_middleware.js) accepts it.
//  Wrapping fetch once covers all ~30 call sites without touching them.
//
//  The key is stored in localStorage as sts-api-key (entered under
//  ⚙ Integrations). If it isn't set, requests go out without the header —
//  harmless while the server gate is inert (APP_SHARED_KEY unset), and a
//  clear 401 once it's enabled, prompting the user to fill it in.
// ════════════════════════════════════════════
(function () {
  const nativeFetch = window.fetch.bind(window);

  function isApiCall(url) {
    try {
      // Resolve relative URLs against the page; only touch our own origin.
      const u = new URL(url, location.href);
      return u.origin === location.origin && u.pathname.startsWith('/api/');
    } catch (e) {
      // Non-string/opaque inputs (e.g. a Request object) fall through below.
      return false;
    }
  }

  window.fetch = function (input, init) {
    const url = (typeof input === 'string') ? input
              : (input && input.url) ? input.url : '';
    const key = (function () { try { return localStorage.getItem('sts-api-key'); } catch (e) { return null; } })();

    if (key && isApiCall(url)) {
      init = Object.assign({}, init);
      // Preserve any caller-supplied headers regardless of form.
      const h = new Headers((init && init.headers) || (input && input.headers) || {});
      h.set('X-STS-Key', key);
      init.headers = h;
    }
    return nativeFetch(input, init);
  };
})();
