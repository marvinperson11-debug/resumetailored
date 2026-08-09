/* site-nav.js — one canonical top nav for every logged-out marketing/SEO page.
 *
 * Each static page used to hardcode its own <nav> with a different set of links
 * (how-it-works had almost none, blog/score/resume-examples each differed), so
 * navigating between them made the tabs jump around. This script injects a
 * single consistent nav + its styles, overriding whatever nav the page shipped.
 *
 * It also carries the site-wide LANGUAGE TOGGLE (中文/EN). Because this nav is
 * injected on every marketing/SEO/blog/tool page, the toggle appears everywhere.
 * Clicking it persists `rt_lang`, translates the nav itself, and — for pages
 * that define their own in-place translator (window.applyLang, e.g. /score and
 * /pro-tools) — calls it so the page body switches too. Pages with no
 * translator (the English-only SEO/blog long-tail) still get the translated nav
 * and the stored preference, so the next translated page they open is Chinese.
 *
 * NOT loaded on the app dashboard (app.html) or the Employer Portal
 * (employer.html) — those have their own purpose-built navs, each with their own
 * copy of the toggle.
 */
(function () {
  'use strict';
  // [English label, href, 中文 label]
  // Job Tracker is intentionally NOT a top-level tab — it lives inside the Free
  // Tools hub (/score) so the nav stays compact. Keep it out of this list.
  var LINKS = [
    ['How It Works', '/how-it-works', '功能介绍'],
    ['Free Tools', '/score', '免费工具'],
    ['Pro Tools', '/pro-tools', '专业版工具'],
    ['Resume Examples', '/resume-examples', '简历范例'],
    ['Blog', '/blog', '博客'],
    ['For Employers', '/employer', '雇主专区'],
    ['Pricing', '/#pricing', '定价']
  ];
  var UI = {
    login:     { en: 'Log In', zh: '登录' },
    dashboard: { en: 'Dashboard', zh: '控制台' },
    cta:       { en: 'Tailor My Resume Free →', zh: '免费定制我的简历 →' }
  };

  function getLang() {
    var l = localStorage.getItem('rt_lang');
    return l === 'zh' ? 'zh' : 'en';
  }

  function run() {
    var path = (location.pathname || '/').replace(/\/+$/, '') || '/';
    // "Log In" sends the user to the dedicated login page and back to where they
    // are now after signing in.
    var here = (location.pathname || '/') + (location.search || '');
    var loginHref = '/login?redirect=' + encodeURIComponent(
      (here.indexOf('/login') === 0 || here.indexOf('/signup') === 0) ? '/dashboard' : here);
    function isActive(href) {
      if (href.charAt(0) === '/' && href.indexOf('#') === -1 && href !== '/') {
        return path === href || path.indexOf(href + '/') === 0 || path.indexOf(href) === 0;
      }
      return false;
    }
    var linksHtml = LINKS.map(function (l, i) {
      return '<a href="' + l[1] + '" data-snav-i="' + i + '"' + (isActive(l[1]) ? ' class="snav-active"' : '') + '>' + l[0] + '</a>';
    }).join('');

    // ── Styles (self-contained; !important beats each page's own nav CSS,
    //    including the dark tool-page navs) ──────────────────────────────────
    var css = '' +
      // Cross-document (MPA) view transitions: cross-fade between our static
      // pages instead of a hard white flash on every full navigation. Chromium
      // animates it; other browsers ignore it. This nav is injected on every
      // marketing/SEO/blog/tool page, so the rule is present on both ends of a
      // navigation (and the homepage carries it inline), which is what a
      // same-origin MPA transition requires. Off under reduced-motion.
      '@view-transition{navigation:auto;}' +
      '@media(prefers-reduced-motion:reduce){@view-transition{navigation:none;}}' +
      // Geometry mirrors the homepage's inline nav EXACTLY so the bar never
      // shifts when navigating between the homepage and an injected-nav page:
      // the 24px side padding lives on the full-width #snav (outside the 1280
      // box) — NOT inside .snav-in — so the inner content spans the full 1280px
      // just like the homepage's .nav (padding on .nav) + .nav-inner (max 1280).
      '#snav{position:sticky;top:0;z-index:1000;background:rgba(250,247,240,.85)!important;padding:0 24px;' +
        'border-bottom:1px solid #E7DFD1!important;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);font-family:\'Inter\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;}' +
      '#snav *{box-sizing:border-box;}' +
      '#snav .snav-in{max-width:1280px;margin:0 auto;display:flex;align-items:center;height:64px;}' +
      '#snav .snav-logo{font-family:\'Fraunces\',Georgia,serif;font-size:23px;font-weight:700;color:#191512!important;text-decoration:none;letter-spacing:-.02em;white-space:nowrap;}' +
      '#snav .snav-logo b{font-family:\'Inter\',sans-serif;background:#1F5C3D;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:5px;vertical-align:middle;margin-left:4px;}' +
      '#snav .snav-links{display:flex;gap:18px;align-items:center;margin-left:32px;}' +
      '#snav .snav-links a{font-size:14px;font-weight:500;color:#57514A!important;text-decoration:none;transition:color .15s;white-space:nowrap;}' +
      '#snav .snav-links a:hover,#snav .snav-links a.snav-active{color:#1F5C3D!important;}' +
      '#snav .snav-act{display:flex;gap:12px;align-items:center;margin-left:auto;}' +
      '#snav .snav-lang{background:#F1EADD;color:#57514A!important;border:1px solid #D9CFBC;border-radius:8px;font-size:13px;font-weight:700;padding:8px 12px;cursor:pointer;font-family:inherit;white-space:nowrap;}' +
      '#snav .snav-lang:hover{border-color:#1F5C3D;color:#1F5C3D!important;}' +
      '#snav .snav-btn{font-size:14px;font-weight:600;padding:10px 20px;border-radius:9px;text-decoration:none;white-space:nowrap;cursor:pointer;border:1px solid transparent;}' +
      '#snav .snav-ghost{background:transparent;color:#191512!important;border-color:#D9CFBC;}' +
      '#snav .snav-ghost:hover{border-color:#1F5C3D;}' +
      '#snav .snav-primary{background:#1F5C3D;color:#fff!important;box-shadow:0 6px 18px rgba(31,92,61,.22);}' +
      '#snav .snav-primary:hover{background:#153F2A;}' +
      '#snav .snav-ham{display:none;background:none;border:1px solid #D9CFBC;border-radius:8px;color:#191512;font-size:18px;line-height:1;padding:7px 11px;cursor:pointer;}' +
      '#snav .snav-hamwrap{display:none;align-items:center;gap:10px;margin-left:auto;}' +
      '#snavMenu{position:fixed;inset:0;z-index:1001;background:#FAF7F0;display:none;flex-direction:column;padding:80px 28px 28px;gap:6px;}' +
      '#snavMenu.open{display:flex;}' +
      '#snavMenu a{font-family:\'Fraunces\',Georgia,serif;font-size:24px;font-weight:600;color:#191512;text-decoration:none;padding:10px 0;border-bottom:1px solid #E7DFD1;}' +
      '#snavMenu .snav-mclose{position:absolute;top:20px;right:24px;background:none;border:none;font-size:30px;color:#57514A;cursor:pointer;line-height:1;}' +
      '#snavMenu .snav-mcta{margin-top:14px;background:#1F5C3D;color:#fff;border:none;border-radius:10px;text-align:center;border-bottom:none;}' +
      '@media(max-width:1180px){#snav .snav-links,#snav .snav-act{display:none!important;}#snav .snav-hamwrap{display:flex!important;}}';

    var style = document.createElement('style');
    style.id = 'snav-css';
    style.textContent = css;
    document.head.appendChild(style);

    // ── Nav markup ───────────────────────────────────────────────────────────
    var nav = document.createElement('nav');
    nav.id = 'snav';
    nav.innerHTML =
      '<div class="snav-in">' +
        '<a href="/" class="snav-logo">ResumeTailored <b>AI</b></a>' +
        '<div class="snav-links">' + linksHtml + '</div>' +
        '<div class="snav-act">' +
          '<button type="button" class="snav-lang" id="langToggleBtn" title="Switch language / 切换语言">中文</button>' +
          '<a href="' + loginHref + '" class="snav-btn snav-ghost" data-snav-login>Log In</a>' +
          '<a href="/dashboard" class="snav-btn snav-primary" data-snav-cta>Tailor My Resume Free →</a>' +
        '</div>' +
        '<div class="snav-hamwrap">' +
          '<button type="button" class="snav-lang" id="langToggleBtnMobile" title="Switch language / 切换语言">中文</button>' +
          '<button class="snav-ham" aria-label="Open menu">&#9776;</button>' +
        '</div>' +
      '</div>';

    // Replace the page's existing <nav> (first one) if present, else prepend.
    var existing = document.querySelector('nav');
    if (existing && existing.parentNode) existing.parentNode.replaceChild(nav, existing);
    else document.body.insertBefore(nav, document.body.firstChild);

    // Mobile menu
    var menu = document.createElement('div');
    menu.id = 'snavMenu';
    menu.innerHTML =
      '<button class="snav-mclose" aria-label="Close menu">&times;</button>' +
      LINKS.map(function (l, i) { return '<a href="' + l[1] + '" data-snav-mi="' + i + '">' + l[0] + '</a>'; }).join('') +
      '<a href="' + loginHref + '" data-snav-login>Log In</a>' +
      '<a href="/dashboard" class="snav-mcta" data-snav-cta>Tailor My Resume Free →</a>';
    document.body.appendChild(menu);

    nav.querySelector('.snav-ham').addEventListener('click', function () { menu.classList.add('open'); });
    menu.querySelector('.snav-mclose').addEventListener('click', function () { menu.classList.remove('open'); });

    // ── Language ─────────────────────────────────────────────────────────────
    // Translate only the nav's own chrome. The page body is translated by the
    // page's own translator (window.applyLang) when it has one.
    function setNavLang(lang) {
      var zh = lang === 'zh';
      nav.querySelectorAll('[data-snav-i]').forEach(function (a) {
        var l = LINKS[+a.getAttribute('data-snav-i')]; if (l) a.textContent = zh ? l[2] : l[0];
      });
      menu.querySelectorAll('[data-snav-mi]').forEach(function (a) {
        var l = LINKS[+a.getAttribute('data-snav-mi')]; if (l) a.textContent = zh ? l[2] : l[0];
      });
      [nav, menu].forEach(function (root) {
        var lg = root.querySelector('[data-snav-login]');
        // A signed-in visitor's login slot shows "Dashboard" — don't let a
        // language toggle overwrite it back to "Log In".
        if (lg) lg.textContent = lg.getAttribute('data-snav-authed')
          ? (zh ? UI.dashboard.zh : UI.dashboard.en)
          : (zh ? UI.login.zh : UI.login.en);
        var ct = root.querySelector('[data-snav-cta]'); if (ct) ct.textContent = zh ? UI.cta.zh : UI.cta.en;
      });
      var t1 = document.getElementById('langToggleBtn');
      var t2 = document.getElementById('langToggleBtnMobile');
      if (t1) t1.textContent = zh ? 'EN' : '中文';
      if (t2) t2.textContent = zh ? 'EN' : '中文';
      document.documentElement.lang = zh ? 'zh-CN' : 'en';
    }

    function toggle() {
      var next = getLang() === 'en' ? 'zh' : 'en';
      localStorage.setItem('rt_lang', next);
      setNavLang(next);
      // Ask the page to translate its own body, if it knows how. Guarded: some
      // pages have no translator, and a page-specific one shouldn't be able to
      // break the nav toggle.
      if (typeof window.applyLang === 'function') {
        try { window.applyLang(next); } catch (e) {}
      }
    }

    document.getElementById('langToggleBtn').addEventListener('click', toggle);
    document.getElementById('langToggleBtnMobile').addEventListener('click', toggle);

    // Reflect the stored preference on load (the page's own boot handles its body).
    setNavLang(getLang());

    // ── Auth-aware login slot ────────────────────────────────────────────────
    // The nav always shipped a "Log In" button. A visitor who was already
    // signed in and clicked it got bounced straight back by /login (which skips
    // the form for an active session) — the page appeared to "flash and do
    // nothing". Reflect the real state instead: a validated session turns the
    // slot into "Dashboard" (→ /dashboard), so a signed-in user never lands on
    // that confusing round-trip.
    function setAuthed(on) {
      var zh = getLang() === 'zh';
      [nav, menu].forEach(function (root) {
        var lg = root.querySelector('[data-snav-login]'); if (!lg) return;
        if (on) {
          lg.setAttribute('data-snav-authed', '1');
          lg.setAttribute('href', '/dashboard');
          lg.textContent = zh ? UI.dashboard.zh : UI.dashboard.en;
        } else {
          lg.removeAttribute('data-snav-authed');
          lg.setAttribute('href', loginHref);
          lg.textContent = zh ? UI.login.zh : UI.login.en;
        }
      });
    }
    var token = null;
    try { token = localStorage.getItem('rt_token'); } catch (e) {}
    if (token) {
      // Optimistic: a returning signed-in user is the common case, so show
      // "Dashboard" right away (no flash of "Log In"), then confirm — and only
      // revert if the stored token is stale/invalid.
      setAuthed(true);
      fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
        .then(function (r) { if (!r.ok) setAuthed(false); })
        .catch(function () {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
