/*
 * Back navigation has been removed from the product. Users rely on the
 * browser's native Back button instead of an in-page "Back" control, which
 * could get stuck (it went position:sticky inside immersive editors) and did
 * not always lead anywhere useful.
 *
 * This script now does two things only:
 *   1. Tears down any legacy explicit-back controls — injected or hardcoded —
 *      so none survive on any page: the floating `.rt-explicit-back` /
 *      `.rt-back-wrap` links, the employer `#nvExplicitBack` button, and the
 *      static tool-page `.th-back` link.
 *   2. Keeps a no-op `window.RTBackNav` so existing callers
 *      (RTBackNav.refreshApp / refreshEmployer) stay safe and inject nothing.
 */
(function () {
  'use strict';

  var SELECTOR = '.rt-back-wrap, .rt-explicit-back, #rtStaticBack, #nvExplicitBack, #rtBackNavStyles, .th-back';

  function removeBackControls() {
    try {
      document.querySelectorAll(SELECTOR).forEach(function (node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      });
    } catch (_) { /* never let cleanup throw */ }
  }

  var noop = function () {};
  window.RTBackNav = {
    staticParents: {},
    appParents: {},
    refresh: removeBackControls,
    refreshApp: removeBackControls,
    refreshEmployer: removeBackControls
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', removeBackControls);
  else removeBackControls();
})();
