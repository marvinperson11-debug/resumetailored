/* site-nav.js — one canonical top nav for every logged-out marketing/SEO page.
 *
 * Each static page used to hardcode its own <nav> with a different set of links
 * (how-it-works had almost none, blog/score/resume-examples each differed), so
 * navigating between them made the tabs jump around. This script injects a
 * single consistent nav + its styles, overriding whatever nav the page shipped.
 *
 * NOT loaded on the app dashboard (app.html) or the Employer Portal
 * (employer.html) — those have their own purpose-built navs.
 */
(function () {
  'use strict';
  var LINKS = [
    ['How It Works', '/how-it-works'],
    ['Free Tools', '/score'],
    ['Resume Examples', '/resume-examples'],
    ['Blog', '/blog'],
    ['For Employers', '/employer'],
    ['Pricing', '/#pricing']
  ];

  function run() {
    var path = (location.pathname || '/').replace(/\/+$/, '') || '/';
    function isActive(href) {
      if (href.charAt(0) === '/' && href.indexOf('#') === -1 && href !== '/') {
        return path === href || path.indexOf(href + '/') === 0 || path.indexOf(href) === 0;
      }
      return false;
    }
    var linksHtml = LINKS.map(function (l) {
      return '<a href="' + l[1] + '"' + (isActive(l[1]) ? ' class="snav-active"' : '') + '>' + l[0] + '</a>';
    }).join('');

    // ── Styles (self-contained; !important beats each page's own nav CSS,
    //    including the dark tool-page navs) ──────────────────────────────────
    var css = '' +
      '#snav{position:sticky;top:0;z-index:1000;background:rgba(250,247,240,.9)!important;' +
        'border-bottom:1px solid #E7DFD1!important;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);font-family:\'Inter\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;}' +
      '#snav *{box-sizing:border-box;}' +
      '#snav .snav-in{max-width:1280px;margin:0 auto;display:flex;align-items:center;height:64px;padding:0 24px;}' +
      '#snav .snav-logo{font-family:\'Fraunces\',Georgia,serif;font-size:22px;font-weight:800;color:#191512!important;text-decoration:none;letter-spacing:-.02em;white-space:nowrap;}' +
      '#snav .snav-logo b{font-family:\'Inter\',sans-serif;background:#1F5C3D;color:#fff;font-size:11px;font-weight:800;padding:2px 7px;border-radius:5px;vertical-align:middle;margin-left:4px;}' +
      '#snav .snav-links{display:flex;gap:18px;align-items:center;margin-left:32px;}' +
      '#snav .snav-links a{font-size:14px;font-weight:500;color:#57514A!important;text-decoration:none;transition:color .15s;white-space:nowrap;}' +
      '#snav .snav-links a:hover,#snav .snav-links a.snav-active{color:#1F5C3D!important;}' +
      '#snav .snav-act{display:flex;gap:12px;align-items:center;margin-left:auto;}' +
      '#snav .snav-btn{font-size:14px;font-weight:700;padding:9px 16px;border-radius:9px;text-decoration:none;white-space:nowrap;cursor:pointer;border:1px solid transparent;}' +
      '#snav .snav-ghost{background:transparent;color:#191512!important;border-color:#D9CFBC;}' +
      '#snav .snav-ghost:hover{border-color:#1F5C3D;}' +
      '#snav .snav-primary{background:#1F5C3D;color:#fff!important;box-shadow:0 6px 18px rgba(31,92,61,.22);}' +
      '#snav .snav-primary:hover{background:#153F2A;}' +
      '#snav .snav-ham{display:none;background:none;border:1px solid #D9CFBC;border-radius:8px;color:#191512;font-size:18px;line-height:1;padding:7px 11px;cursor:pointer;margin-left:auto;}' +
      '#snavMenu{position:fixed;inset:0;z-index:1001;background:#FAF7F0;display:none;flex-direction:column;padding:80px 28px 28px;gap:6px;}' +
      '#snavMenu.open{display:flex;}' +
      '#snavMenu a{font-family:\'Fraunces\',Georgia,serif;font-size:24px;font-weight:600;color:#191512;text-decoration:none;padding:10px 0;border-bottom:1px solid #E7DFD1;}' +
      '#snavMenu .snav-mclose{position:absolute;top:20px;right:24px;background:none;border:none;font-size:30px;color:#57514A;cursor:pointer;line-height:1;}' +
      '#snavMenu .snav-mcta{margin-top:14px;background:#1F5C3D;color:#fff;border:none;border-radius:10px;text-align:center;border-bottom:none;}' +
      '@media(max-width:1180px){#snav .snav-links,#snav .snav-act{display:none!important;}#snav .snav-ham{display:inline-flex!important;}}';

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
          '<a href="/dashboard" class="snav-btn snav-ghost">Log In</a>' +
          '<a href="/dashboard" class="snav-btn snav-primary">Tailor My Resume Free →</a>' +
        '</div>' +
        '<button class="snav-ham" aria-label="Open menu">&#9776;</button>' +
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
      LINKS.map(function (l) { return '<a href="' + l[1] + '">' + l[0] + '</a>'; }).join('') +
      '<a href="/dashboard">Log In</a>' +
      '<a href="/dashboard" class="snav-mcta">Tailor My Resume Free →</a>';
    document.body.appendChild(menu);

    nav.querySelector('.snav-ham').addEventListener('click', function () { menu.classList.add('open'); });
    menu.querySelector('.snav-mclose').addEventListener('click', function () { menu.classList.remove('open'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
