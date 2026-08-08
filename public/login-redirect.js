/* login-redirect.js — shared, testable helper for the post-login redirect.
 *
 * Used by public/login.html (to pick where to send the user after login) and by
 * app.html (to consume a stored redirect after an OAuth round-trip). Written as
 * a tiny UMD so test/login-redirect.js can require() the same logic that runs in
 * the browser.
 */
(function (root) {
  'use strict';

  // A safe post-login target is a SAME-ORIGIN ABSOLUTE PATH only. Reject:
  //  - empty / non-strings
  //  - anything not starting with a single "/" (external URLs, "//evil.com",
  //    "/\evil", "javascript:", "https://…")
  //  - the auth pages themselves ("/login", "/signup") — those would loop
  //  - control characters
  // Returns the cleaned path, or null when unsafe.
  function sanitizeRedirect(r) {
    if (!r || typeof r !== 'string') return null;
    r = r.trim();
    if (r.charAt(0) !== '/') return null;
    if (r.charAt(1) === '/' || r.charAt(1) === '\\') return null;
    if (/[\u0000-\u001f\u007f\s]/.test(r)) return null;
    if (/^\/(login|signup)(\/|\?|#|$)/.test(r)) return null;
    return r;
  }

  // Best target from an explicit param, then a same-origin referrer, then a
  // default. `origin` lets callers pass location.origin (or a test value).
  function resolveTarget(param, referrer, origin, fallback) {
    var t = sanitizeRedirect(param);
    if (t) return t;
    if (referrer && origin) {
      try {
        var ru = new URL(referrer);
        if (ru.origin === origin) {
          t = sanitizeRedirect(ru.pathname + ru.search);
          if (t) return t;
        }
      } catch (e) { /* ignore */ }
    }
    return fallback || '/dashboard';
  }

  var API = { sanitizeRedirect: sanitizeRedirect, resolveTarget: resolveTarget };
  root.LoginRedirect = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : this);
