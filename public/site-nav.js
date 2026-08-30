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

  // Tool and landing pages share one deterministic parent-route map. Loading
  // it here keeps those pages consistent without duplicating inline handlers.
  if (!window.RTBackNav && !document.querySelector('script[data-rt-back-nav]')) {
    // Cache-bust back-nav.js on every deploy by reusing site-nav.js's own
    // asset version (the ?v= the server stamps onto this script's src). A frozen
    // ?v=1 meant browsers kept running a stale back-nav.js after it changed.
    var snavTag = document.querySelector('script[src*="site-nav.js"]');
    var ver = (snavTag && (snavTag.getAttribute('src').match(/[?&]v=([^&]+)/) || [])[1]) || '2';
    var backScript = document.createElement('script');
    backScript.src = '/back-nav.js?v=' + ver;
    backScript.defer = true;
    backScript.setAttribute('data-rt-back-nav', '1');
    document.head.appendChild(backScript);
  }
  // [English label, href, 中文 label]
  // The desktop toolbar is deliberately restrained and identical everywhere.
  // The hamburger remains the complete job-seeker product directory.
  var LINKS = [
    ['Tailor My Resume', '/ai-resume-tailor', '定制我的简历'],
    ['Cover Letter', '/ai-cover-letter-generator', '求职信'],
    ['ATS Scanner', '/free-ats-resume-checker', 'ATS 扫描器'],
    ['LinkedIn Optimizer', '/linkedin-optimizer', 'LinkedIn 优化器'],
    ['Resume Video', '/resume-video', '简历视频'],
    ['Web Studio', '/web-studio', '网站工作室'],
    ['Decoder Key', '/decoder-key', '解码密钥'],
    ['Interview Coach', '/interview-coach', '面试教练'],
    ['Career Hub', '/career-hub', '职业中心'],
    ['Job Finder', '/job-finder', '职位搜索'],
    ['AutoApply', '/tools/autoapply', '自动申请']
  ];
  var EMPLOYER_LINKS = [
    ['Employer Portal', '/for-employers', '雇主门户'],
    ['Recruitment Decoder', '/employer?view=decoder', '招聘解码器'],
    ['Employer Dashboard', '/employer', '雇主控制台'],
    ['Corporate Ecosystem', '/corporate', '企业生态系统']
  ];
  var PRIMARY_LINKS = [
    ['Membership', '/pricing#ecosystem-pricing', '会员方案'],
    ['Tailor My Resume', '/ai-resume-tailor', '定制我的简历'],
    ['For Employer', '/for-employers', '雇主入口']
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
    if (document.getElementById('snav')) return;
    var path = (location.pathname || '/').replace(/\/+$/, '') || '/';
    var employerSide = /^\/(?:for-employers|corporate|company(?:\/|$))/.test(path);
    var menuLinks = employerSide ? EMPLOYER_LINKS : LINKS;
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
    // Per-link emphasis mirrors the homepage's inline nav EXACTLY so the bar
    // reads identically on every route: Free Tools shimmers, Pro Tools is
    // green-bold, For Employers is dark-bold. Keyed by href.
    var EMPH = {};
    var linksHtml = PRIMARY_LINKS.map(function (l, i) {
      var cls = (isActive(l[1]) ? 'snav-active' : '') + (EMPH[l[1]] || '');
      cls = cls.trim();
      return '<a href="' + l[1] + '" data-snav-primary="' + i + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + l[0] + '</a>';
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
      // Per-link emphasis matching the homepage's inline nav.
      '#snav .snav-links a.snav-pro{color:#1F5C3D!important;font-weight:700;}' +
      '#snav .snav-links a.snav-emp{color:#0f172a!important;font-weight:700;}' +
      // "Free Tools" gold shimmer — self-contained copy of the homepage .nav-shine.
      '@property --snav-x{syntax:\'<percentage>\';inherits:false;initial-value:100%;}' +
      '#snav .snav-links a.snav-shine{font-weight:600;' +
        'background:linear-gradient(-75deg,#1F5C3D calc(var(--snav-x) + 18%),#B4832A calc(var(--snav-x) + 25%),#1F5C3D calc(var(--snav-x) + 32%));' +
        '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent!important;' +
        'animation:snavShine 3.2s linear infinite;}' +
      '@keyframes snavShine{0%{--snav-x:130%;}55%,100%{--snav-x:-30%;}}' +
      '@media(prefers-reduced-motion:reduce){#snav .snav-links a.snav-shine{animation:none;}}' +
      '#snav .snav-act{display:flex;gap:12px;align-items:center;margin-left:auto;}' +
      // 中文 toggle is a ghost/outline button (transparent, light border) exactly
      // like the homepage's — NOT a filled beige chip, which read as a different
      // nav when navigating between the homepage and an injected-nav page.
      '#snav .snav-lang{background:transparent;color:#191512!important;border:1px solid #e5e7eb;border-radius:9px;font-size:13px;font-weight:600;padding:7px 13px;cursor:pointer;font-family:inherit;white-space:nowrap;}' +
      '#snav .snav-lang:hover{border-color:#1F5C3D;color:#1F5C3D!important;}' +
      '#snav .snav-btn{font-size:14px;font-weight:600;padding:10px 20px;border-radius:9px;text-decoration:none;white-space:nowrap;cursor:pointer;border:1px solid transparent;}' +
      '#snav .snav-ghost{background:transparent;color:#191512!important;border-color:#D9CFBC;}' +
      '#snav .snav-ghost:hover{border-color:#1F5C3D;}' +
      '#snav .snav-primary{background:#1F5C3D;color:#fff!important;box-shadow:0 6px 18px rgba(31,92,61,.22);}' +
      '#snav .snav-primary:hover{background:#153F2A;}' +
      '#snav .snav-ham{display:none;background:none;border:1px solid #D9CFBC;border-radius:8px;color:#191512;font-size:18px;line-height:1;padding:7px 11px;cursor:pointer;}' +
      '#snav .snav-hamwrap{display:none;align-items:center;gap:10px;margin-left:auto;}' +
      '#snavMenu{position:fixed;top:68px;right:24px;z-index:1001;background:#FAF7F0;display:none;grid-template-columns:1fr 1fr;width:min(390px,calc(100vw - 36px));max-height:calc(100vh - 86px);overflow:auto;padding:52px 18px 18px;gap:0 14px;border:1px solid #E7DFD1;box-shadow:0 28px 70px rgba(0,0,0,.35);}' +
      '#snavMenu.open{display:grid;}' +
      '#snavMenu a,#snavMenu .snav-mlang{font-family:\'Inter\',sans-serif;font-size:14px;font-weight:600;color:#191512;text-decoration:none;padding:12px 4px;border:0;border-bottom:1px solid #E7DFD1;background:none;text-align:left;cursor:pointer;}' +
      '#snavMenu .snav-mclose{position:absolute;top:20px;right:24px;background:none;border:none;font-size:30px;color:#57514A;cursor:pointer;line-height:1;}' +
      '#snavMenu .snav-maccount{grid-column:1/-1;margin-top:12px;background:#c9a85d;color:#071724!important;border:1px solid #c9a85d;text-align:center;text-transform:uppercase;letter-spacing:.08em;font-size:11px;}' +
      '#snavMenu .snav-mlang{grid-column:1/-1;color:#e3cc91!important;}' +
      '@media(max-width:520px){#snavMenu{top:64px;right:0;width:100vw;max-height:calc(100vh - 64px);grid-template-columns:1fr;border-left:0;border-right:0;}#snavMenu .snav-maccount,#snavMenu .snav-mlang{grid-column:1;}}' +
      '@media(max-width:1180px){#snav .snav-links{display:none!important;}#snav .snav-ham{display:block!important;}}' +
      /* Luxury ecosystem override. Appended so it wins over the legacy
         editorial-light declarations above without changing nav behavior. */
      '#snav{background:rgba(7,23,36,.97)!important;border-bottom-color:rgba(201,168,93,.25)!important;}' +
      '#snav .snav-logo{color:#fff!important;font-weight:600;}' +
      '#snav .snav-logo b{background:#c9a85d!important;color:#071724!important;border-radius:2px;}' +
      '#snav .snav-links a{color:#d4dede!important;font-size:13px;letter-spacing:.03em;}' +
      '#snav .snav-links a:hover,#snav .snav-links a.snav-active{color:#e3cc91!important;}' +
      '#snav .snav-lang,#snav .snav-ham{color:#f7f1e6!important;border-color:rgba(201,168,93,.38)!important;border-radius:2px;}' +
      '#snav .snav-ghost{color:#f7f1e6!important;border-color:rgba(201,168,93,.38)!important;border-radius:2px;}' +
      '#snav .snav-primary{background:#c9a85d!important;color:#071724!important;box-shadow:none;border-radius:2px;text-transform:uppercase;letter-spacing:.07em;font-size:11px;}' +
      '#snavMenu{background:#071724!important;}#snavMenu a{color:#f7f1e6!important;border-bottom-color:rgba(201,168,93,.2)!important;}' +
      /* Top-nav 中文 toggle + Login: always visible beside the hamburger at
         every width. 中文 is WHITE for contrast on the navy bar; Login is a
         gold-outline luxury button. */
      '#snav .snav-act{display:flex!important;gap:10px;align-items:center;margin-left:auto;}' +
      '#snav .snav-lang{background:#fff!important;color:#0a1628!important;border:1px solid #c9a227!important;border-radius:8px;font-weight:700;}' +
      '#snav .snav-lang:hover{background:#1a4d3a!important;color:#fff!important;border-color:#c9a227!important;}' +
      '#snav .snav-login{background:transparent!important;color:#f7f1e6!important;border:1px solid #c9a227!important;border-radius:8px;padding:8px 16px!important;font-weight:700;box-shadow:none!important;text-transform:none;letter-spacing:normal;font-size:13px!important;}' +
      '#snav .snav-login:hover{background:#1a4d3a!important;color:#fff!important;border-color:#c9a227!important;}' +
      '#snav .snav-ham{color:#f7f1e6!important;border-color:rgba(201,162,39,.5)!important;}' +
      '@media(max-width:520px){#snav{padding:0 12px;}#snav .snav-act{gap:7px;}#snav .snav-login{padding:8px 12px!important;}#snav .snav-lang{padding:7px 10px;}}' +
      /* Role-selection modal (Job Seeker vs Employer) */
      '#snavRole{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(3,10,20,.72);}' +
      '#snavRole.open{display:flex;}' +
      '#snavRole .snr-box{width:100%;max-width:420px;background:#0d1e30;border:1px solid rgba(201,162,39,.28);border-radius:18px;padding:28px 24px;box-shadow:0 30px 80px rgba(0,0,0,.5);text-align:center;font-family:\'Inter\',sans-serif;}' +
      '#snavRole h3{margin:0 0 6px;font:700 20px/1.25 \'Fraunces\',Georgia,serif;color:#f5f1e8;}' +
      '#snavRole p{margin:0 0 20px;font-size:14px;color:#9eb2aa;}' +
      '#snavRole .snr-opts{display:grid;gap:12px;}' +
      '#snavRole .snr-opt{display:block;width:100%;padding:16px;border-radius:12px;border:1px solid rgba(201,162,39,.3);background:#0a1628;color:#f5f1e8;font:700 15px/1.2 \'Inter\',sans-serif;cursor:pointer;transition:all .15s;}' +
      '#snavRole .snr-opt:hover{border-color:#c9a227;background:#123a2b;}' +
      '#snavRole .snr-opt small{display:block;margin-top:4px;font-weight:500;font-size:12px;color:#9eb2aa;}' +
      '#snavRole .snr-opt--emp:hover{background:#12233a;}' +
      '#snavRole .snr-close{margin-top:16px;background:none;border:none;color:#9eb2aa;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}';

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
          '<button type="button" class="snav-btn snav-login" id="snavLoginBtn" data-snav-login>Log In</button>' +
          '<button class="snav-ham" aria-label="Open menu" aria-controls="snavMenu" aria-expanded="false">&#9776;</button>' +
        '</div>' +
      '</div>';

    // Remove page-specific marketing chrome so the shared toolbar is the only
    // desktop header. Dashboard shells do not load this script.
    document.querySelectorAll('body > .club-mobile-menu, body > .mobile-menu').forEach(function (node) { node.remove(); });
    var existing = document.querySelector('body > nav, body > header.club-nav, body > header.cp-header');
    if (!existing) existing = document.querySelector('nav');
    if (existing && existing.parentNode) existing.parentNode.replaceChild(nav, existing);
    else document.body.insertBefore(nav, document.body.firstChild);

    // Mobile menu
    var menu = document.createElement('div');
    menu.id = 'snavMenu';
    menu.innerHTML =
      '<button class="snav-mclose" aria-label="Close menu">&times;</button>' +
      menuLinks.map(function (l, i) { return '<a href="' + l[1] + '" data-snav-mi="' + i + '">' + l[0] + '</a>'; }).join('') +
      '<a href="' + (employerSide ? '/employer' : '/signup') + '" class="snav-maccount" data-snav-account>' + (employerSide ? 'Recruiter Account' : 'Create Account') + '</a>';
    document.body.appendChild(menu);

    // ── Role-selection modal (opened by the top-nav Login button) ────────────
    var roleModal = document.createElement('div');
    roleModal.id = 'snavRole';
    roleModal.setAttribute('role', 'dialog');
    roleModal.setAttribute('aria-modal', 'true');
    roleModal.innerHTML =
      '<div class="snr-box">' +
        '<h3 data-snr-h>Log in to ResumeTailored</h3>' +
        '<p data-snr-p>Are you logging in as a Job Seeker or an Employer?</p>' +
        '<div class="snr-opts">' +
          '<button type="button" class="snr-opt" data-snr-seeker>👤 Job Seeker<small data-snr-seeker-sub>Tailor resumes, cover letters &amp; more</small></button>' +
          '<button type="button" class="snr-opt snr-opt--emp" data-snr-employer>🏢 Employer<small data-snr-employer-sub>Post jobs &amp; find candidates</small></button>' +
        '</div>' +
        '<button type="button" class="snr-close" data-snr-close>Cancel</button>' +
      '</div>';
    document.body.appendChild(roleModal);
    function setRoleOpen(open) { roleModal.classList.toggle('open', open); }
    roleModal.addEventListener('click', function (e) { if (e.target === roleModal) setRoleOpen(false); });
    roleModal.querySelector('[data-snr-close]').addEventListener('click', function () { setRoleOpen(false); });
    roleModal.querySelector('[data-snr-seeker]').addEventListener('click', function () { location.assign(loginHref); });
    roleModal.querySelector('[data-snr-employer]').addEventListener('click', function () { location.assign('/login?redirect=%2Femployer'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setRoleOpen(false); });
    function setRoleLang(zh) {
      roleModal.querySelector('[data-snr-h]').textContent = zh ? '登录 ResumeTailored' : 'Log in to ResumeTailored';
      roleModal.querySelector('[data-snr-p]').textContent = zh ? '您是以求职者还是雇主身份登录？' : 'Are you logging in as a Job Seeker or an Employer?';
      roleModal.querySelector('[data-snr-seeker]').childNodes[0].nodeValue = zh ? '👤 求职者' : '👤 Job Seeker';
      roleModal.querySelector('[data-snr-seeker-sub]').textContent = zh ? '定制简历、求职信等' : 'Tailor resumes, cover letters & more';
      roleModal.querySelector('[data-snr-employer]').childNodes[0].nodeValue = zh ? '🏢 雇主' : '🏢 Employer';
      roleModal.querySelector('[data-snr-employer-sub]').textContent = zh ? '发布职位并寻找候选人' : 'Post jobs & find candidates';
      roleModal.querySelector('[data-snr-close]').textContent = zh ? '取消' : 'Cancel';
    }

    var menuTrigger = nav.querySelector('.snav-ham');
    function setMenuOpen(open) {
      menu.classList.toggle('open', open);
      menuTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    menuTrigger.addEventListener('click', function () { setMenuOpen(!menu.classList.contains('open')); });
    menu.querySelector('.snav-mclose').addEventListener('click', function () { setMenuOpen(false); });
    menu.querySelectorAll('a').forEach(function (link) { link.addEventListener('click', function () { setMenuOpen(false); }); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') setMenuOpen(false); });

    // ── Language ─────────────────────────────────────────────────────────────
    // Translate only the nav's own chrome. The page body is translated by the
    // page's own translator (window.applyLang) when it has one.
    function setNavLang(lang) {
      var zh = lang === 'zh';
      nav.querySelectorAll('[data-snav-primary]').forEach(function (a) {
        var l = PRIMARY_LINKS[+a.getAttribute('data-snav-primary')]; if (l) a.textContent = zh ? l[2] : l[0];
      });
      menu.querySelectorAll('[data-snav-mi]').forEach(function (a) {
        var l = menuLinks[+a.getAttribute('data-snav-mi')]; if (l) a.textContent = zh ? l[2] : l[0];
      });
      [nav, menu].forEach(function (root) {
        var lg = root.querySelector('[data-snav-login]');
        // A signed-in visitor's login slot shows "Dashboard" — don't let a
        // language toggle overwrite it back to "Log In".
        if (lg) lg.textContent = lg.getAttribute('data-snav-authed')
          ? (zh ? UI.dashboard.zh : UI.dashboard.en)
          : (zh ? UI.login.zh : UI.login.en);
        var ct = root.querySelector('[data-snav-cta]'); if (ct) ct.textContent = zh ? UI.cta.zh : UI.cta.en;
        var account = root.querySelector('[data-snav-account]'); if (account) account.textContent = employerSide ? (zh ? '招聘人员账户' : 'Recruiter Account') : (zh ? '创建账户' : 'Create Account');
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
    var t2el = document.getElementById('langToggleBtnMobile');
    if (t2el) t2el.addEventListener('click', toggle);

    // The top-nav Login button opens the role-selection modal (signed-out); when
    // a session is present it becomes a direct "Dashboard" link instead.
    var loginBtn = document.getElementById('snavLoginBtn');
    if (loginBtn) loginBtn.addEventListener('click', function () {
      if (loginBtn.getAttribute('data-snav-authed')) { location.assign('/dashboard'); return; }
      setRoleLang(getLang() === 'zh');
      setRoleOpen(true);
    });

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
