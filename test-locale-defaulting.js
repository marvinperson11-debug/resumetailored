#!/usr/bin/env node
/*
 * test-locale-defaulting.js — Scope 2a test for the Oct 2026 marketing audit.
 *
 * Verifies the locale-resolution logic used by site-nav.js, site-i18n.js, and
 * the five pages with inline translators (index, app, pro-tools, score,
 * ats-score-checker):
 *
 *   1. A stored explicit choice ('zh' or 'en') is always honored.
 *   2. A true first visit (nothing stored) matches the browser language:
 *      zh-* → 'zh', anything else → 'en'.
 *   3. The browser guess is NOT persisted (localStorage untouched on first visit).
 *
 * Run: node test-locale-defaulting.js
 */
'use strict';

// The exact logic shipped in the pages (mirrors __rtLang / getLang).
function resolveLang(store, navLang) {
  var localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = v; },
  };
  var navigator = { language: navLang };
  // ---- begin shipped logic ----
  function __rtLang() {
    try {
      var s = localStorage.getItem('rt_lang');
      if (s === 'zh' || s === 'en') return s;
    } catch (e) {}
    try { if (/^zh/i.test(navigator.language || navigator.userLanguage || '')) return 'zh'; } catch (e) {}
    return 'en';
  }
  // ---- end shipped logic ----
  return __rtLang();
}

var failures = 0;
function check(name, store, navLang, expected) {
  var before = JSON.stringify(store);
  var got = resolveLang(store, navLang);
  var persisted = JSON.stringify(store) !== before;
  var ok = got === expected && !persisted;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name +
    ' | stored=' + JSON.stringify(store.rt_lang) +
    ' nav=' + navLang + ' → ' + got +
    ' (expected ' + expected + ')' +
    (persisted ? ' [PERSISTED — BAD]' : ''));
}

// 1. Stored explicit choices honored
check('stored zh + en browser', { rt_lang: 'zh' }, 'en-US', 'zh');
check('stored en + zh browser', { rt_lang: 'en' }, 'zh-CN', 'en');
check('stored zh + zh browser', { rt_lang: 'zh' }, 'zh-TW', 'zh');

// 2. First visit matches browser language
check('fresh + zh-CN', {}, 'zh-CN', 'zh');
check('fresh + zh-TW', {}, 'zh-TW', 'zh');
check('fresh + zh-HK', {}, 'zh-HK', 'zh');
check('fresh + en-US', {}, 'en-US', 'en');
check('fresh + fr-FR', {}, 'fr-FR', 'en');
check('fresh + no navigator lang', {}, undefined, 'en');

// 3. Garbage stored value falls back to browser detection, not crash
check('stored garbage + zh browser', { rt_lang: 'bogus' }, 'zh-CN', 'zh');
check('stored garbage + en browser', { rt_lang: 'bogus' }, 'en-US', 'en');

if (failures) {
  console.error('\n' + failures + ' FAILURES');
  process.exit(1);
}
console.log('\nAll locale-defaulting checks passed.');
