/*
 * site-i18n.js — site-wide full-DOM translator (English / Español / Français /
 * हिन्दी / 中文).
 *
 * The homepage and the app dashboard carry their own exhaustive, hand-authored
 * translators. Every OTHER page (the SEO/role pages, marketing/tool pages, blog,
 * alternatives) had no body translator, so switching language only translated the
 * nav chrome and left the whole page in English. This fixes that generically:
 *
 *   • On switch to a non-English locale it walks the ENTIRE DOM — every visible
 *     text node plus placeholder / title / aria-label / alt / button-value
 *     attributes — collects the unique English strings, sends them to
 *     /api/i18n/translate (cross-user cached on the server per hash+lang, so cost
 *     is one-time per unique phrase per language) and swaps in the translation.
 *     Originals are remembered, so switching back to English is instant and exact,
 *     and switching between two non-English locales reuses each locale's own cache.
 *   • It CHAINS after a page's own window.applyLang when one exists (e.g. /score,
 *     /pro-tools, the 5 hand-translated funnel pages), so their curated, instant
 *     translations still run first and this only fills in everything they don't
 *     cover.
 *   • The shared nav (#snav / hamburger / role modal) translates itself, so its
 *     subtree is skipped here to avoid double-work.
 *   • Known limitation: the "already translated, don't re-send" guard in wants()
 *     below only recognizes already-Chinese text (CJK has a distinct script to
 *     detect). It does not detect already-Spanish/French/Hindi text from a page's
 *     own curated dictionary, so a curated es/fr/hi string can be re-sent to the MT
 *     endpoint once per page load; worst case is a wasted translate call on text
 *     that's already correct, not a broken render. Gating is on the active locale
 *     (getLang()), not script detection, by design — see CLAUDE.md.
 *
 * Fails open at every step: no API key, a network error, an unsupported
 * language, or an untranslatable string simply leaves that text in English
 * rather than breaking the page.
 */
(function () {
  'use strict';
  if (window.__siteI18nLoaded) return;
  window.__siteI18nLoaded = true;

  var LANG_KEY = 'rt_lang';
  var LANGS = ['en', 'es', 'fr', 'hi', 'zh'];
  // Language resolution (2026 5-locale widening): an explicit `?lang=` in the
  // URL wins outright — this is what makes the hreflang alternates (search-
  // engine pass) actually render localized content, not just swap meta tags —
  // and is persisted like any other explicit choice. Otherwise a stored
  // choice wins. On a true first visit (nothing stored) match the browser
  // language (incl. regional variants: es-MX→es, hi-IN→hi, fr-CA→fr,
  // zh-*→zh) so a non-English-locale visitor lands in their language — but do
  // NOT persist that guess, so an explicit toggle later (or a different
  // browser) isn't shadowed.
  function getLang() {
    try {
      var urlLang = new URLSearchParams(location.search).get('lang');
      if (LANGS.indexOf(urlLang) !== -1) { localStorage.setItem(LANG_KEY, urlLang); return urlLang; }
    } catch (e) {}
    try {
      var stored = localStorage.getItem(LANG_KEY);
      if (LANGS.indexOf(stored) !== -1) return stored;
    } catch (e) {}
    try {
      var n = (navigator.language || navigator.userLanguage || '').toLowerCase();
      if (n.indexOf('zh') === 0) return 'zh';
      if (n.indexOf('es') === 0) return 'es';
      if (n.indexOf('fr') === 0) return 'fr';
      if (n.indexOf('hi') === 0) return 'hi';
    } catch (e) {}
    return 'en';
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
  // Every unique EN string ever discovered on this page load, regardless of
  // whether a translate call for it ever succeeded. A DOM node/attr is only
  // ever *collected* once (seenTextNodes / the __i18nAttr_* flags dedupe
  // that), but its STRING must stay eligible for (re)fetching under any
  // language whose cache doesn't have it yet — otherwise a failed fetch (or
  // a later switch to a second non-English language) can never be retried
  // within the same page load, because collect() would no longer surface
  // that node as "fresh". See toLang() below.
  var allStrings = {};

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
      allStrings[key] = 1;
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
        allStrings[vt] = 1;
        records.push({ kind: 'attr', el: el, attr: attr });
      }
    }

    return { strings: Object.keys(strings), texts: texts, attrs: attrs };
  }

  // One cache per non-English target language, so switching between e.g. es
  // and fr (both already fetched once) never re-hits the network, and a
  // phrase translated into es is never mistaken for its fr translation.
  var cache = { es: {}, fr: {}, hi: {}, zh: {} };   // en → target, per language
  var busy = false;

  function applyLangMap(lang, map) {
    var byEn = cache[lang]; if (!byEn) return;
    for (var k in map) if (map.hasOwnProperty(k)) byEn[k] = map[k];
    records.forEach(function (r) {
      if (r.kind === 'text') {
        var en = r.node.__i18nEn; if (en == null) return;
        var t = byEn[en.trim()];
        if (t) r.node.nodeValue = en.replace(en.trim(), t);
      } else {
        var cur = r.el['__i18nAttr_' + r.attr]; if (cur == null) return;
        var t2 = byEn[cur.trim()];
        if (t2) r.el.setAttribute(r.attr, cur.replace(cur.trim(), t2));
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

  // Translate the current DOM into the target language, fetching anything
  // not already cached for THAT language.
  //
  // `need` is derived from `allStrings` (every string ever seen on this page
  // load) rather than from this call's own `collect()` result: collect() only
  // returns NEWLY-discovered nodes (seenTextNodes/the __i18nAttr_* flags make
  // every node collectible exactly once, ever), so deriving `need` from it
  // would mean a string whose fetch failed earlier — or that was only ever
  // fetched for a DIFFERENT language — could never be retried for `lang`
  // within this page load. Sourcing `need` from `allStrings` fixes both: a
  // transient failure is retried the next time this language is applied, and
  // switching between two non-English languages fetches each one properly
  // instead of silently reusing whatever the first language's fetch cached.
  var FETCH_TIMEOUT_MS = 30000;
  function toLang(lang) {
    var byEn = cache[lang]; if (!byEn) return;
    collect(); // side effect: folds any newly-added DOM nodes/attrs into allStrings/records
    var need = Object.keys(allStrings).filter(function (s) { return !byEn[s]; });
    // Apply whatever is already cached immediately (instant on repeat toggles).
    applyLangMap(lang, {});
    if (!need.length || busy) return;
    busy = true;
    document.documentElement.setAttribute('data-i18n-busy', '1');
    // Chunk so no single request is huge.
    var CH = 200, chunks = [];
    for (var i = 0; i < need.length; i += CH) chunks.push(need.slice(i, i + CH));
    var done = 0;
    chunks.forEach(function (chunk) {
      // A hung upstream (no response, no network error) must not leave
      // `busy` stuck forever — that would silently block every future
      // translate attempt for the rest of this page's life. Force the
      // fetch to fail after FETCH_TIMEOUT_MS so the finally-style `.then`
      // below always runs.
      var signal, timer;
      if (typeof AbortController !== 'undefined') {
        var ac = new AbortController();
        signal = ac.signal;
        timer = setTimeout(function () { ac.abort(); }, FETCH_TIMEOUT_MS);
      }
      fetch('/api/i18n/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: lang, strings: chunk }),
        signal: signal
      }).then(function (r) { return r.ok ? r.json() : { translations: {} }; })
        .then(function (d) { if (d && d.translations) applyLangMap(lang, d.translations); })
        .catch(function () {})
        .then(function () {
          if (timer) clearTimeout(timer);
          if (++done === chunks.length) { busy = false; document.documentElement.removeAttribute('data-i18n-busy'); }
        });
    });
  }

  var HTML_LANG = { en: 'en', es: 'es', fr: 'fr', hi: 'hi', zh: 'zh-CN' };

  // The generic pass. Called by the chained window.applyLang and on load.
  function genericApply(lang) {
    if (lang === 'en') restoreEn();
    else toLang(lang);
    try { document.documentElement.lang = HTML_LANG[lang] || 'en'; } catch (e) {}
  }

  // Chain after any existing page translator so curated strings win, then we fill
  // in the rest. site-nav's toggle calls window.applyLang(next).
  var pageApply = (typeof window.applyLang === 'function') ? window.applyLang : null;
  window.applyLang = function (lang) {
    if (pageApply) { try { pageApply(lang); } catch (e) {} }
    genericApply(lang);
  };

  // On load, if the stored preference is non-English, translate the body too.
  // (Pages with their own translator already self-boot their curated pass;
  // this adds the generic coverage on top. Run after paint so it never blocks
  // first render.)
  function boot() {
    var lang = getLang();
    if (lang === 'en') return;
    // Give a page's own boot + the nav a tick to settle, then translate.
    setTimeout(function () { genericApply(lang); }, 60);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
