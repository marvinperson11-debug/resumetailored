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
  // 5-way language picker. Every array below is [English label, href, 中文,
  // Español, Français, हिन्दी] — indices fixed by LANG_IDX so pickLabel() can
  // find the right one regardless of array order.
  var LANG_IDX = { en: 0, zh: 2, es: 3, fr: 4, hi: 5 };
  var LANG_OPTIONS = [
    ['en', 'English'],
    ['es', 'Español'],
    ['fr', 'Français'],
    ['hi', 'हिन्दी'],
    ['zh', '中文']
  ];
  function pickLabel(arr, lang) {
    var idx = LANG_IDX[lang];
    return (idx != null && arr[idx]) || arr[0];
  }

  // The desktop toolbar is deliberately restrained and identical everywhere.
  // The hamburger remains the complete job-seeker product directory.
  var LINKS = [
    ['Tailor My Resume', '/ai-resume-tailor', '定制我的简历', 'Personalizar mi currículum', 'Personnaliser mon CV', 'रिज़्यूमे अनुकूलित करें'],
    ['Cover Letter', '/ai-cover-letter-generator', '求职信', 'Carta de presentación', 'Lettre de motivation', 'कवर लेटर'],
    ['ATS Scanner', '/free-ats-resume-checker', 'ATS 扫描器', 'Escáner ATS', 'Scanner ATS', 'ATS स्कैनर'],
    ['LinkedIn Optimizer', '/linkedin-optimizer', 'LinkedIn 优化器', 'Optimizador de LinkedIn', 'Optimiseur LinkedIn', 'LinkedIn ऑप्टिमाइज़र'],
    ['Resume Video', '/resume-video', '简历视频', 'Video de currículum', 'Vidéo de CV', 'रिज़्यूमे वीडियो'],
    ['Web Studio', '/web-studio', '网站工作室', 'Estudio web', 'Studio web', 'वेब स्टूडियो'],
    ['Decoder Key', '/decoder-key', '解码密钥', 'Clave decodificadora', 'Clé de décodage', 'डिकोडर की'],
    ['Interview Coach', '/interview-coach', '面试教练', 'Entrenador de entrevistas', "Coach d'entretien", 'इंटरव्यू कोच'],
    ['Career Hub', '/career-hub', '职业中心', 'Centro de carrera', 'Espace carrière', 'करियर हब'],
    ['Job Finder', '/job-finder', '职位搜索', 'Buscador de empleo', "Chercheur d'emploi", 'जॉब फाइंडर'],
    ['AutoApply', '/tools/autoapply', '自动申请', 'Postulación automática', 'Candidature automatique', 'ऑटो-अप्लाई']
  ];
  var EMPLOYER_LINKS = [
    ['Employer Portal', '/for-employers', '雇主门户', 'Portal de empleadores', 'Portail employeur', 'एम्प्लॉयर पोर्टल'],
    ['Recruitment Decoder', 'https://app.resumetailored.com/employer', '招聘解码器', 'Decodificador de reclutamiento', 'Décodeur de recrutement', 'रिक्रूटमेंट डिकोडर'],
    ['Employer Dashboard', 'https://app.resumetailored.com/employer', '雇主控制台', 'Panel del empleador', 'Tableau de bord employeur', 'एम्प्लॉयर डैशबोर्ड'],
    ['Corporate Ecosystem', '/corporate', '企业生态系统', 'Ecosistema corporativo', 'Écosystème corporate', 'कॉर्पोरेट इकोसिस्टम']
  ];
  var PRIMARY_LINKS = [
    ['How it works', '/how-it-works', '使用方法', 'Cómo funciona', 'Comment ça marche', 'यह कैसे काम करता है'],
    ['Membership', '/pricing#pricing', '会员方案', 'Membresía', 'Abonnement', 'मेंबरशिप'],
    ['Tailor My Resume', '/ai-resume-tailor', '定制我的简历', 'Personalizar mi currículum', 'Personnaliser mon CV', 'रिज़्यूमे अनुकूलित करें'],
    ['For Employers', '/for-employers', '雇主入口', 'Para empleadores', 'Pour les employeurs', 'एम्प्लॉयर्स के लिए']
  ];
  var UI = {
    login:     { en: 'Log In', zh: '登录', es: 'Iniciar sesión', fr: 'Se connecter', hi: 'लॉग इन करें' },
    dashboard: { en: 'Dashboard', zh: '控制台', es: 'Panel', fr: 'Tableau de bord', hi: 'डैशबोर्ड' },
    cta:       { en: 'Tailor My Resume Free →', zh: '免费定制我的简历 →', es: 'Personaliza mi currículum gratis →', fr: 'Personnalisez mon CV gratuitement →', hi: 'मेरा रिज़्यूमे मुफ़्त में अनुकूलित करें →' }
  };

  // Language resolution (2026 5-locale widening): an explicit `?lang=` in the
  // URL wins outright — this is what makes the hreflang alternates (search-
  // engine pass) actually render localized content rather than only swapping
  // meta tags, and it's also how a shared `?lang=es` link behaves — and is
  // persisted like any other explicit choice. Otherwise a stored choice wins;
  // on a true first visit (nothing stored) we match the browser language,
  // including regional variants (es-MX→es, hi-IN→hi, fr-CA→fr, zh-*→zh) — but
  // we do NOT persist that guess, so picking a language later (or a
  // different browser) isn't shadowed.
  function getLang() {
    try {
      var urlLang = new URLSearchParams(location.search).get('lang');
      if (urlLang === 'en' || urlLang === 'es' || urlLang === 'fr' || urlLang === 'hi' || urlLang === 'zh') {
        localStorage.setItem('rt_lang', urlLang);
        return urlLang;
      }
    } catch (e) {}
    try {
      var stored = localStorage.getItem('rt_lang');
      if (stored === 'en' || stored === 'es' || stored === 'fr' || stored === 'hi' || stored === 'zh') return stored;
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

  function run() {
    if (document.getElementById('snav')) return;
    var path = (location.pathname || '/').replace(/\/+$/, '') || '/';
    var employerSide = /^\/(?:for-employers|corporate|company(?:\/|$)|features(?:\/|$))/.test(path);
    var menuLinks = employerSide ? EMPLOYER_LINKS : LINKS;
    // "Log In" goes straight to the platform's Clerk sign-in — no role chooser,
    // no legacy /login page. Clerk itself routes a signed-in user by role
    // (candidate/employer) once they land; there's no safe way to carry an
    // external resumetailored.com return URL across to Clerk, so this is a
    // plain, unconditional link.
    var loginHref = 'https://app.resumetailored.com/sign-in';
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
      // Anchored headings (FAQ, pricing, …) must clear the sticky nav when jumped to.
      'html{scroll-padding-top:88px!important}' +
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
      '#snav .snav-langwrap{position:relative;}' +
      '#snav .snav-lang{background:transparent;color:#191512!important;border:1px solid #e5e7eb;border-radius:9px;font-size:13px;font-weight:600;padding:7px 11px;cursor:pointer;font-family:inherit;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;}' +
      '#snav .snav-lang:hover{border-color:#1F5C3D;color:#1F5C3D!important;}' +
      '#snav .snav-lang .snav-caret{font-size:9px;opacity:.65;}' +
      '#snav .snav-langmenu{position:absolute;top:calc(100% + 8px);right:0;z-index:1002;background:#fff;border:1px solid #E7DFD1;border-radius:10px;box-shadow:0 18px 44px rgba(0,0,0,.18);min-width:150px;padding:6px;display:none;}' +
      '#snav .snav-langmenu.open{display:block;}' +
      '#snav .snav-langopt{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:0;border-radius:7px;padding:9px 10px;font-size:14px;font-weight:500;color:#191512;text-align:left;cursor:pointer;font-family:\'Inter\',sans-serif;}' +
      '#snav .snav-langopt:hover{background:#FAF7F0;}' +
      '#snav .snav-langopt.is-current{font-weight:700;color:#1F5C3D;}' +
      '#snav .snav-langopt .snav-check{opacity:0;font-size:12px;}' +
      '#snav .snav-langopt.is-current .snav-check{opacity:1;}' +
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
      '#snav .snav-langmenu{background:#071724!important;border-color:rgba(201,168,93,.38)!important;}' +
      '#snav .snav-langopt{color:#f7f1e6!important;}' +
      '#snav .snav-langopt:hover{background:rgba(201,168,93,.12)!important;}' +
      '#snav .snav-langopt.is-current{color:#e3cc91!important;}' +
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
      // Hindi (Devanagari) type. Scoped to html[lang="hi"] so it only ever
      // applies on a page that is actually showing Hindi right now — a
      // non-Hindi page never matches this selector, so (combined with the
      // webfont stylesheet below only being injected when hi is active) it
      // never pays for the font. font-display:swap (set on the stylesheet's
      // own &display=swap) means text is visible immediately in the inherited
      // fallback stack and swaps to Noto Sans Devanagari once it loads — the
      // fallback (system Devanagari font on Windows/Mac/Android, present by
      // default on all three) already has real Devanagari glyphs, so there is
      // no tofu even before the webfont arrives, just a plainer look.
      'html[lang="hi"] body,html[lang="hi"] body *{font-family:\'Noto Sans Devanagari\',\'Inter\',\'Fraunces\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Georgia,sans-serif;}';

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
          '<div class="snav-langwrap">' +
            '<button type="button" class="snav-lang" id="langToggleBtn" aria-haspopup="listbox" aria-expanded="false" title="Switch language / Cambiar idioma / Changer de langue / भाषा बदलें / 切换语言">EN<span class="snav-caret">▾</span></button>' +
            '<div class="snav-langmenu" id="snavLangMenu" role="listbox"></div>' +
          '</div>' +
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
    var MOBILE_UI = {
      account:          { en: 'Create Account', zh: '创建账户', es: 'Crear cuenta', fr: 'Créer un compte', hi: 'खाता बनाएं' },
      recruiterAccount: { en: 'Recruiter Account', zh: '招聘人员账户', es: 'Cuenta de reclutador', fr: 'Compte recruteur', hi: 'रिक्रूटर खाता' },
      download:         { en: 'Download the app', zh: '下载应用', es: 'Descargar la app', fr: "Télécharger l'application", hi: 'ऐप डाउनलोड करें' }
    };

    var menu = document.createElement('div');
    menu.id = 'snavMenu';
    menu.innerHTML =
      '<button class="snav-mclose" aria-label="Close menu">&times;</button>' +
      menuLinks.map(function (l, i) { return '<a href="' + l[1] + '" data-snav-mi="' + i + '">' + l[0] + '</a>'; }).join('') +
      '<a href="https://app.resumetailored.com" data-snav-download>Download the app</a>' +
      '<a href="' + (employerSide ? 'https://app.resumetailored.com/employer-checkout?plan=free' : 'https://app.resumetailored.com/sign-up') + '" class="snav-maccount" data-snav-account>' + (employerSide ? 'Recruiter Account' : 'Create Account') + '</a>';
    document.body.appendChild(menu);

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
    var HTML_LANG_TAG = { en: 'en', es: 'es', fr: 'fr', hi: 'hi', zh: 'zh-CN' };
    var BTN_LABEL = { en: 'EN', es: 'ES', fr: 'FR', hi: 'HI', zh: '中文' };

    // Lazily load the Devanagari webfont — only ever called when lang==='hi',
    // and only once per page (document.head is checked, not a module-level
    // flag, so it's correct even if two script instances raced).
    function ensureHindiFont() {
      if (document.getElementById('snav-hi-font')) return;
      var pre1 = document.createElement('link'); pre1.rel = 'preconnect'; pre1.href = 'https://fonts.googleapis.com';
      var pre2 = document.createElement('link'); pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com'; pre2.crossOrigin = 'anonymous';
      var link = document.createElement('link');
      link.id = 'snav-hi-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap';
      document.head.appendChild(pre1);
      document.head.appendChild(pre2);
      document.head.appendChild(link);
    }

    function setNavLang(lang) {
      if (lang === 'hi') ensureHindiFont();
      nav.querySelectorAll('[data-snav-primary]').forEach(function (a) {
        var l = PRIMARY_LINKS[+a.getAttribute('data-snav-primary')]; if (l) a.textContent = pickLabel(l, lang);
      });
      menu.querySelectorAll('[data-snav-mi]').forEach(function (a) {
        var l = menuLinks[+a.getAttribute('data-snav-mi')]; if (l) a.textContent = pickLabel(l, lang);
      });
      [nav, menu].forEach(function (root) {
        var lg = root.querySelector('[data-snav-login]');
        // A signed-in visitor's login slot shows "Dashboard" — don't let a
        // language pick overwrite it back to "Log In".
        if (lg) lg.textContent = lg.getAttribute('data-snav-authed')
          ? (UI.dashboard[lang] || UI.dashboard.en)
          : (UI.login[lang] || UI.login.en);
        var ct = root.querySelector('[data-snav-cta]'); if (ct) ct.textContent = UI.cta[lang] || UI.cta.en;
        var account = root.querySelector('[data-snav-account]');
        if (account) { var au = employerSide ? MOBILE_UI.recruiterAccount : MOBILE_UI.account; account.textContent = au[lang] || au.en; }
        var download = root.querySelector('[data-snav-download]'); if (download) download.textContent = MOBILE_UI.download[lang] || MOBILE_UI.download.en;
      });
      var t1 = document.getElementById('langToggleBtn');
      if (t1) {
        var caret = t1.querySelector('.snav-caret');
        t1.textContent = BTN_LABEL[lang] || 'EN';
        if (caret) t1.appendChild(caret); else t1.insertAdjacentHTML('beforeend', '<span class="snav-caret">▾</span>');
        t1.setAttribute('aria-expanded', langMenu.classList.contains('open') ? 'true' : 'false');
      }
      langMenu.querySelectorAll('[data-lang-opt]').forEach(function (opt) {
        var isCurrent = opt.getAttribute('data-lang-opt') === lang;
        opt.classList.toggle('is-current', isCurrent);
        opt.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      });
      document.documentElement.lang = HTML_LANG_TAG[lang] || 'en';
    }

    // ── 5-way language picker dropdown ──────────────────────────────────────
    var langBtn = document.getElementById('langToggleBtn');
    var langMenu = document.getElementById('snavLangMenu');
    langMenu.innerHTML = LANG_OPTIONS.map(function (o) {
      return '<button type="button" class="snav-langopt" role="option" data-lang-opt="' + o[0] + '">' +
        '<span>' + o[1] + '</span><span class="snav-check">✓</span></button>';
    }).join('');

    function setLangMenuOpen(open) {
      langMenu.classList.toggle('open', open);
      langBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function selectLang(next) {
      localStorage.setItem('rt_lang', next);
      setNavLang(next);
      setLangMenuOpen(false);
      // Ask the page to translate its own body, if it knows how. Guarded: some
      // pages have no translator, and a page-specific one shouldn't be able to
      // break the nav picker.
      if (typeof window.applyLang === 'function') {
        try { window.applyLang(next); } catch (e) {}
      }
    }

    langBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setLangMenuOpen(!langMenu.classList.contains('open'));
    });
    langMenu.querySelectorAll('[data-lang-opt]').forEach(function (opt) {
      opt.addEventListener('click', function (e) {
        e.stopPropagation();
        selectLang(opt.getAttribute('data-lang-opt'));
      });
    });
    document.addEventListener('click', function () { setLangMenuOpen(false); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') setLangMenuOpen(false); });

    // The top-nav Login button goes straight to the platform, signed-out
    // (Clerk sign-in) or signed-in (its own dashboard) alike — no role
    // chooser, no legacy /login or /dashboard round-trip.
    var loginBtn = document.getElementById('snavLoginBtn');
    if (loginBtn) loginBtn.addEventListener('click', function () {
      location.assign(loginBtn.getAttribute('data-snav-authed') ? 'https://app.resumetailored.com' : loginHref);
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
      var lang = getLang();
      [nav, menu].forEach(function (root) {
        var lg = root.querySelector('[data-snav-login]'); if (!lg) return;
        if (on) {
          lg.setAttribute('data-snav-authed', '1');
          lg.setAttribute('href', '/dashboard');
          lg.textContent = UI.dashboard[lang] || UI.dashboard.en;
        } else {
          lg.removeAttribute('data-snav-authed');
          lg.setAttribute('href', loginHref);
          lg.textContent = UI.login[lang] || UI.login.en;
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
