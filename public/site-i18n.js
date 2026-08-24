/*
 * site-i18n.js — site-wide full-DOM translator (中文 / English).
 *
 * The homepage and the app dashboard carry their own exhaustive, hand-authored
 * translators. Every OTHER page (the SEO/role pages, marketing/tool pages, blog,
 * alternatives) had no body translator, so clicking 中文 only translated the nav
 * chrome and left the whole page in English. This fixes that generically:
 *
 *   • On switch to 中文 it walks the ENTIRE DOM — every visible text node plus
 *     placeholder / title / aria-label / alt / button-value attributes — collects
 *     the unique English strings, sends them to /api/i18n/translate (cross-user
 *     cached on the server, so cost is one-time per unique phrase) and swaps in
 *     the Chinese. Originals are remembered, so switching back to English is
 *     instant and exact.
 *   • It CHAINS after a page's own window.applyLang when one exists (e.g. /score,
 *     /pro-tools), so their curated, instant translations still run first and this
 *     only fills in everything they don't cover.
 *   • The shared nav (#snav / hamburger / role modal) translates itself, so its
 *     subtree is skipped here to avoid double-work.
 *
 * Fails open at every step: no API key, a network error, or an untranslatable
 * string simply leaves that text in English rather than breaking the page.
 */
(function () {
  'use strict';
  if (window.__siteI18nLoaded) return;
  window.__siteI18nLoaded = true;

  var LANG_KEY = 'rt_lang';
  function getLang() {
    try { var l = localStorage.getItem(LANG_KEY); return l === 'zh' ? 'zh' : 'en'; } catch (e) { return 'en'; }
  }

  // Elements whose subtree must never be touched: scripts/styles, code samples,
  // editable fields' own text, the self-translating nav, and the language toggles
  // themselves (they show 中文/EN and must not be translated).
  var SKIP_SEL = 'script,style,noscript,template,code,pre,textarea,svg,' +
    '#snav,#snavMenu,#snavRole,.snav-lang,#langToggleBtn,#langToggleBtnMobile,#langToggleBtnFooter,' +
    '[data-club-lang],[data-club-lang-top],[data-global-language-toggle],[data-no-i18n],[translate="no"],.notranslate,.js-today';

  var CJK = /[㐀-鿿豈-﫿぀-ヿ]/;
  var HAS_LETTER = /[A-Za-z]/;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var URLISH = /^(https?:\/\/|www\.|\/)[^\s]*$/;

  // Should this trimmed string be translated at all?
  function wants(t) {
    if (!t) return false;
    if (t.length < 2 || t.length > 600) return false;
    if (!HAS_LETTER.test(t)) return false;      // pure numbers / symbols / emoji
    if (EMAIL.test(t) || URLISH.test(t)) return false;
    // Already substantially Chinese → assume a curated translator handled it.
    var cjk = (t.match(/[㐀-鿿぀-ヿ]/g) || []).length;
    if (cjk / t.length > 0.2) return false;
    return true;
  }

  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  // A record of everything we changed, so EN can restore exactly.
  // { kind:'text', node } with node.__en / node.__zh, or { kind:'attr', el, attr }.
  var records = [];
  var seenTextNodes = 'undefined' !== typeof WeakSet ? new WeakSet() : null;

  function skipAncestor(node) {
    var el = node.nodeType === 3 ? node.parentElement : node;
    if (!el) return true;
    if (el.closest && el.closest(SKIP_SEL)) return true;
    return false;
  }

  // Collect fresh (not-yet-seen) translatable text nodes + attributes.
  // Returns { strings:[unique], texts:[nodes], attrs:[{el,attr}] }.
  function collect() {
    var strings = {};
    var texts = [];
    var attrs = [];

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (seenTextNodes && seenTextNodes.has(n)) return NodeFilter.FILTER_REJECT;
        var t = n.nodeValue;
        if (!t) return NodeFilter.FILTER_REJECT;
        var trimmed = t.trim();
        if (!wants(trimmed)) return NodeFilter.FILTER_REJECT;
        if (skipAncestor(n)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      if (seenTextNodes) seenTextNodes.add(node);
      node.__i18nEn = node.nodeValue;                 // exact original (with whitespace)
      var key = node.nodeValue.trim();
      texts.push(node);
      strings[key] = 1;
      records.push({ kind: 'text', node: node });
    }

    // Attributes on elements (skip inside excluded subtrees).
    var all = document.body.querySelectorAll('[placeholder],[title],[aria-label],[alt]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest && el.closest(SKIP_SEL)) continue;
      for (var a = 0; a < ATTRS.length; a++) {
        var attr = ATTRS[a];
        if (!el.hasAttribute(attr)) continue;
        var flag = '__i18nAttr_' + attr;
        if (el[flag] !== undefined) continue;         // already captured
        var val = el.getAttribute(attr);
        var vt = (val || '').trim();
        if (!wants(vt)) continue;
        el[flag] = val;                               // remember original
        attrs.push({ el: el, attr: attr });
        strings[vt] = 1;
        records.push({ kind: 'attr', el: el, attr: attr });
      }
    }

    return { strings: Object.keys(strings), texts: texts, attrs: attrs };
  }

  var cache = {};   // en → zh, filled from the server (persists for the page)
  var busy = false;

  function applyZh(map) {
    for (var k in map) if (map.hasOwnProperty(k)) cache[k] = map[k];
    records.forEach(function (r) {
      if (r.kind === 'text') {
        var en = r.node.__i18nEn; if (en == null) return;
        var zh = cache[en.trim()];
        if (zh) r.node.nodeValue = en.replace(en.trim(), zh);
      } else {
        var cur = r.el['__i18nAttr_' + r.attr]; if (cur == null) return;
        var z = cache[cur.trim()];
        if (z) r.el.setAttribute(r.attr, cur.replace(cur.trim(), z));
      }
    });
  }

  function restoreEn() {
    records.forEach(function (r) {
      if (r.kind === 'text') {
        if (r.node.__i18nEn != null) r.node.nodeValue = r.node.__i18nEn;
      } else {
        var v = r.el['__i18nAttr_' + r.attr];
        if (v != null) r.el.setAttribute(r.attr, v);
      }
    });
  }

  // Translate the current DOM into Chinese, fetching anything not already cached.
  function toZh() {
    var found = collect();
    var need = found.strings.filter(function (s) { return !cache[s]; });
    // Apply whatever is already cached immediately (instant on repeat toggles).
    applyZh({});
    if (!need.length || busy) { applyZh({}); return; }
    busy = true;
    document.documentElement.setAttribute('data-i18n-busy', '1');
    // Chunk so no single request is huge.
    var CH = 200, chunks = [];
    for (var i = 0; i < need.length; i += CH) chunks.push(need.slice(i, i + CH));
    var done = 0;
    chunks.forEach(function (chunk) {
      fetch('/api/i18n/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: 'zh', strings: chunk })
      }).then(function (r) { return r.ok ? r.json() : { translations: {} }; })
        .then(function (d) { if (d && d.translations) applyZh(d.translations); })
        .catch(function () {})
        .then(function () {
          if (++done === chunks.length) { busy = false; document.documentElement.removeAttribute('data-i18n-busy'); }
        });
    });
  }

  // The generic pass. Called by the chained window.applyLang and on load.
  function genericApply(lang) {
    if (lang === 'zh') toZh();
    else restoreEn();
    try { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; } catch (e) {}
  }

  // Chain after any existing page translator so curated strings win, then we fill
  // in the rest. site-nav's toggle calls window.applyLang(next).
  var pageApply = (typeof window.applyLang === 'function') ? window.applyLang : null;
  window.applyLang = function (lang) {
    if (pageApply) { try { pageApply(lang); } catch (e) {} }
    genericApply(lang);
  };

  // On load, if the stored preference is Chinese, translate the body too. (Pages
  // with their own translator already self-boot their curated pass; this adds the
  // generic coverage on top. Run after paint so it never blocks first render.)
  function boot() {
    if (getLang() !== 'zh') return;
    // Give a page's own boot + the nav a tick to settle, then translate.
    setTimeout(function () { genericApply('zh'); }, 60);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
