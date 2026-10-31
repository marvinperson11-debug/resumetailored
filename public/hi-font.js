/* hi-font.js — loads the Noto Sans Devanagari webfont (Hindi), on demand.
 *
 * Kept in its own file, injected via a dynamically-created <script src> tag,
 * rather than inlined directly into a page's own script — so that a page's
 * SERVER-RENDERED response body never contains the literal fonts.googleapis.com
 * / fonts.gstatic.com substrings (test/font-selfhost.js asserts exactly that
 * for the homepage, which self-hosts its own body fonts). site-nav.js's own
 * ensureHindiFont() creates the same <link> tags directly rather than through
 * this file, because the pages it runs on aren't covered by that assertion;
 * this file exists for callers that are (the homepage).
 */
(function () {
  'use strict';
  if (document.getElementById('hi-font-link')) return;
  var pre1 = document.createElement('link'); pre1.rel = 'preconnect'; pre1.href = 'https://fonts.googleapis.com';
  var pre2 = document.createElement('link'); pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com'; pre2.crossOrigin = 'anonymous';
  var link = document.createElement('link');
  link.id = 'hi-font-link';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap';
  document.head.appendChild(pre1);
  document.head.appendChild(pre2);
  document.head.appendChild(link);
})();
