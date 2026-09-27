/* site-nav.js — one canonical top nav for every logged-out marketing/SEO page.
 *
 * Each static page used to hardcode its own <nav> with a different set of links
 * (how-it-works had almost none, blog/score/resume-examples each differed), so
 * navigating between them made the tabs jump around. This script injects a
 * single consistent nav + its styles, overriding whatever nav the page shipped.
 *
 * It also carries the site-wide LANGUAGE SWITCHER (English / 中文 / Español /
 * हिन्दी / Français). Because this nav is injected on every marketing/SEO/blog/
 * tool page, the switcher appears everywhere. Picking a language persists
 * `rt_lang`, translates the nav itself, and — for pages that define their own
 * in-place translator (window.applyLang, e.g. /score and /pro-tools) — calls it
 * so the page body switches too. site-i18n.js then chains after that call and
 * covers whatever the page's own translator doesn't (which, for es/hi/fr, is
 * the whole page, since those curated translators only ever branch on Chinese).
 * Pages with no page-specific translator (the English-only SEO/blog long-tail)
 * still get the translated nav and the stored preference, so the next page they
 * open translates too.
 *
 * NOT loaded on the app dashboard (app.html) or the Employer Portal
 * (employer.html) — those have their own purpose-built navs, each with their own
 * copy of the switcher.
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

  // The 5 supported languages, in switcher order. `short` is what the trigger
  // button shows; `name` is the label inside the dropdown (always shown in that
  // language's own script, so a visitor recognizes their language regardless of
  // the page's current language).
  var LANGS = [
    { code: 'en', short: 'EN', name: 'English' },
    { code: 'zh', short: '中文', name: '中文' },
    { code: 'es', short: 'ES', name: 'Español' },
    { code: 'hi', short: 'HI', name: 'हिन्दी' },
    { code: 'fr', short: 'FR', name: 'Français' }
  ];
  var LOCALE_TAG = { en: 'en', zh: 'zh-CN', es: 'es', hi: 'hi', fr: 'fr' };

  // [English, href, 中文, Español, हिन्दी, Français]
  // The desktop toolbar is deliberately restrained and identical everywhere.
  // The hamburger remains the complete job-seeker product directory.
  var LINKS = [
    ['Tailor My Resume', '/ai-resume-tailor', '定制我的简历', 'Adaptar mi currículum', 'मेरा रिज़्यूमे अनुकूलित करें', 'Adapter mon CV'],
    ['Cover Letter', '/ai-cover-letter-generator', '求职信', 'Carta de presentación', 'कवर लेटर', 'Lettre de motivation'],
    ['ATS Scanner', '/free-ats-resume-checker', 'ATS 扫描器', 'Escáner ATS', 'ATS स्कैनर', 'Scanner ATS'],
    ['LinkedIn Optimizer', '/linkedin-optimizer', 'LinkedIn 优化器', 'Optimizador de LinkedIn', 'LinkedIn ऑप्टिमाइज़र', 'Optimiseur LinkedIn'],
    ['Resume Video', '/resume-video', '简历视频', 'Video de currículum', 'रिज़्यूमे वीडियो', 'Vidéo de CV'],
    ['Web Studio', '/web-studio', '网站工作室', 'Estudio web', 'वेब स्टूडियो', 'Studio web'],
    ['Decoder Key', '/decoder-key', '解码密钥', 'Clave decodificadora', 'डिकोडर कुंजी', 'Clé de décodage'],
    ['Interview Coach', '/interview-coach', '面试教练', 'Entrenador de entrevistas', 'इंटरव्यू कोच', 'Coach d\'entretien'],
    ['Career Hub', '/career-hub', '职业中心', 'Centro de carrera', 'करियर हब', 'Espace carrière'],
    ['Job Finder', '/job-finder', '职位搜索', 'Buscador de empleo', 'जॉब फ़ाइंडर', 'Recherche d\'emploi'],
    ['AutoApply', '/tools/autoapply', '自动申请', 'Postulación automática', 'ऑटो-अप्लाई', 'Candidature automatique']
  ];
  var EMPLOYER_LINKS = [
    ['Employer Portal', '/for-employers', '雇主门户', 'Portal del empleador', 'नियोक्ता पोर्टल', 'Portail employeur'],
    ['Recruitment Decoder', '/employer?view=decoder', '招聘解码器', 'Decodificador de reclutamiento', 'भर्ती डिकोडर', 'Décodeur de recrutement'],
    ['Employer Dashboard', '/employer', '雇主控制台', 'Panel del empleador', 'नियोक्ता डैशबोर्ड', 'Tableau de bord employeur'],
    ['Corporate Ecosystem', '/corporate', '企业生态系统', 'Ecosistema corporativo', 'कॉर्पोरेट इकोसिस्टम', 'Écosystème d\'entreprise']
  ];
  var PRIMARY_LINKS = [
    ['Membership', '/pricing#ecosystem-pricing', '会员方案', 'Membresía', 'सदस्यता', 'Adhésion'],
    ['Tailor My Resume', '/ai-resume-tailor', '定制我的简历', 'Adaptar mi currículum', 'मेरा रिज़्यूमे अनुकूलित करें', 'Adapter mon CV'],
    ['For Employer', '/for-employers', '雇主入口', 'Para empleadores', 'नियोक्ताओं के लिए', 'Pour les employeurs']
  ];
  var UI = {
    login:     { en: 'Log In', zh: '登录', es: 'Iniciar sesión', hi: 'लॉगिन', fr: 'Connexion' },
    dashboard: { en: 'Dashboard', zh: '控制台', es: 'Panel', hi: 'डैशबोर्ड', fr: 'Tableau de bord' },
    cta:       { en: 'Tailor My Resume Free →', zh: '免费定制我的简历 →', es: 'Adapta mi currículum gratis →', hi: 'मेरा रिज़्यूमे मुफ़्त में अनुकूलित करें →', fr: 'Adapter mon CV gratuitement →' },
    account:   { en: 'Create Account', zh: '创建账户', es: 'Crear cuenta', hi: 'खाता बनाएं', fr: 'Créer un compte' },
    recruiter: { en: 'Recruiter Account', zh: '招聘人员账户', es: 'Cuenta de reclutador', hi: 'रिक्रूटर खाता', fr: 'Compte recruteur' },
    download:  { en: 'Download the app', zh: '下载应用', es: 'Descargar la app', hi: 'ऐप डाउनलोड करें', fr: 'Télécharger l\'application' },
    openMenu:  { en: 'Open menu', zh: '打开菜单', es: 'Abrir menú', hi: 'मेनू खोलें', fr: 'Ouvrir le menu' },
    switchLang:{ en: 'Switch language', zh: '切换语言', es: 'Cambiar idioma', hi: 'भाषा बदलें', fr: 'Changer de langue' }
  };
  var ROLE_MODAL = {
    heading:     { en: 'Log in to ResumeTailored', zh: '登录 ResumeTailored', es: 'Inicia sesión en ResumeTailored', hi: 'ResumeTailored में लॉगिन करें', fr: 'Connectez-vous à ResumeTailored' },
    question:    { en: 'Are you logging in as a Job Seeker or an Employer?', zh: '您是以求职者还是雇主身份登录？', es: '¿Inicias sesión como candidato o como empleador?', hi: 'आप जॉब सीकर या नियोक्ता के रूप में लॉगिन कर रहे हैं?', fr: 'Vous connectez-vous en tant que candidat ou employeur ?' },
    seeker:      { en: '👤 Job Seeker', zh: '👤 求职者', es: '👤 Candidato', hi: '👤 जॉब सीकर', fr: '👤 Candidat' },
    seekerSub:   { en: 'Tailor resumes, cover letters & more', zh: '定制简历、求职信等', es: 'Adapta currículums, cartas de presentación y más', hi: 'रिज़्यूमे, कवर लेटर और अधिक को अनुकूलित करें', fr: 'Adaptez CV, lettres de motivation et plus' },
    employer:    { en: '🏢 Employer', zh: '🏢 雇主', es: '🏢 Empleador', hi: '🏢 नियोक्ता', fr: '🏢 Employeur' },
    employerSub: { en: 'Post jobs & find candidates', zh: '发布职位并寻找候选人', es: 'Publica empleos y encuentra candidatos', hi: 'नौकरियां पोस्ट करें और उम्मीदवार खोजें', fr: 'Publiez des offres et trouvez des candidats' },
    cancel:      { en: 'Cancel', zh: '取消', es: 'Cancelar', hi: 'रद्द करें', fr: 'Annuler' }
  };

  function getLang() {
    var l = localStorage.getItem('rt_lang');
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === l) return l;
    return 'en';
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
      '#snav .snav-act{display:flex;gap:12px;align-items:center;margin-left:auto;position:relative;}' +
      // Language switcher trigger is a ghost/outline button (transparent, light
      // border) exactly like the homepage's — NOT a filled beige chip, which read
      // as a different nav when navigating between the homepage and an
      // injected-nav page.
      '#snav .snav-lang{background:transparent;color:#191512!important;border:1px solid #e5e7eb;border-radius:9px;font-size:13px;font-weight:600;padding:7px 13px;cursor:pointer;font-family:inherit;white-space:nowrap;}' +
      '#snav .snav-lang:hover{border-color:#1F5C3D;color:#1F5C3D!important;}' +
      '#snav .snav-btn{font-size:14px;font-weight:600;padding:10px 20px;border-radius:9px;text-decoration:none;white-space:nowrap;cursor:pointer;border:1px solid transparent;}' +
      '#snav .snav-ghost{background:transparent;color:#191512!important;border-color:#D9CFBC;}' +
      '#snav .snav-ghost:hover{border-color:#1F5C3D;}' +
      '#snav .snav-primary{background:#1F5C3D;color:#fff!important;box-shadow:0 6px 18px rgba(31,92,61,.22);}' +
      '#snav .snav-primary:hover{background:#153F2A;}' +
      '#snav .snav-ham{display:none;background:none;border:1px solid #D9CFBC;border-radius:8px;color:#191512;font-size:18px;line-height:1;padding:7px 11px;cursor:pointer;}' +
      '#snav .snav-hamwrap{display:none;align-items:center;gap:10px;margin-left:auto;}' +
      // Language dropdown panel — anchored under whichever trigger opened it
      // (desktop #langToggleBtn or the mobile menu's own trigger).
      '.snav-langmenu{position:fixed;z-index:2147483002;min-width:168px;background:#fff;border:1px solid #E7DFD1;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.25);padding:6px;display:none;}' +
      '.snav-langmenu.open{display:block;}' +
      '.snav-langmenu button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;background:none;border:0;border-radius:8px;padding:9px 10px;font:600 14px/1.2 \'Inter\',sans-serif;color:#191512;cursor:pointer;}' +
      '.snav-langmenu button:hover,.snav-langmenu button:focus-visible{background:#F1EADD;}' +
      '.snav-langmenu button[aria-current="true"]{color:#1F5C3D;}' +
      '.snav-langmenu button .snav-langcheck{opacity:0;color:#1F5C3D;}' +
      '.snav-langmenu button[aria-current="true"] .snav-langcheck{opacity:1;}' +
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
      /* Top-nav language switcher + Login: always visible beside the hamburger
         at every width. The language trigger is WHITE for contrast on the navy
         bar; Login is a gold-outline luxury button. */
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
          '<button type="button" class="snav-lang" id="langToggleBtn" aria-haspopup="true" aria-expanded="false">EN</button>' +
          '<button type="button" class="snav-btn snav-login" id="snavLoginBtn" data-snav-login>Log In</button>' +
          '<button class="snav-ham" aria-controls="snavMenu" aria-expanded="false">&#9776;</button>' +
        '</div>' +
      '</div>';

    // Remove page-specific marketing chrome so the shared toolbar is the only
    // desktop header. Dashboard shells do not load this script.
    document.querySelectorAll('body > .club-mobile-menu, body > .mobile-menu').forEach(function (node) { node.remove(); });
    var existing = document.querySelector('body > nav, body > header.club-nav, body > header.cp-header');
    if (!existing) existing = document.querySelector('nav');
    if (existing && existing.parentNode) existing.parentNode.replaceChild(nav, existing);
    else document.body.insertBefore(nav, document.body.firstChild);

    // Mobile menu. No separate language row here — #langToggleBtn (the top-bar
    // trigger) stays visible at every width by design (#snav .snav-act is
    // display:flex!important with no hide-on-mobile rule), so the hamburger
    // drawer doesn't need its own copy of the switcher.
    var menu = document.createElement('div');
    menu.id = 'snavMenu';
    menu.innerHTML =
      '<button class="snav-mclose">&times;</button>' +
      menuLinks.map(function (l, i) { return '<a href="' + l[1] + '" data-snav-mi="' + i + '">' + l[0] + '</a>'; }).join('') +
      '<a href="https://app.resumetailored.com" data-snav-download>Download the app</a>' +
      '<a href="' + (employerSide ? '/employer' : '/signup') + '" class="snav-maccount" data-snav-account>' + (employerSide ? UI.recruiter.en : UI.account.en) + '</a>';
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
    function setRoleLang(lang) {
      roleModal.querySelector('[data-snr-h]').textContent = ROLE_MODAL.heading[lang];
      roleModal.querySelector('[data-snr-p]').textContent = ROLE_MODAL.question[lang];
      roleModal.querySelector('[data-snr-seeker]').childNodes[0].nodeValue = ROLE_MODAL.seeker[lang];
      roleModal.querySelector('[data-snr-seeker-sub]').textContent = ROLE_MODAL.seekerSub[lang];
      roleModal.querySelector('[data-snr-employer]').childNodes[0].nodeValue = ROLE_MODAL.employer[lang];
      roleModal.querySelector('[data-snr-employer-sub]').textContent = ROLE_MODAL.employerSub[lang];
      roleModal.querySelector('[data-snr-close]').textContent = ROLE_MODAL.cancel[lang];
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
    // page's own translator (window.applyLang) when it has one, then generically
    // by site-i18n.js.
    function linkLabel(tuple, lang) {
      var pos = { en: 0, zh: 2, es: 3, hi: 4, fr: 5 }[lang];
      return tuple[pos];
    }
    function setNavLang(lang) {
      nav.querySelectorAll('[data-snav-primary]').forEach(function (a) {
        var l = PRIMARY_LINKS[+a.getAttribute('data-snav-primary')]; if (l) a.textContent = linkLabel(l, lang);
      });
      menu.querySelectorAll('[data-snav-mi]').forEach(function (a) {
        var l = menuLinks[+a.getAttribute('data-snav-mi')]; if (l) a.textContent = linkLabel(l, lang);
      });
      [nav, menu].forEach(function (root) {
        var lg = root.querySelector('[data-snav-login]');
        // A signed-in visitor's login slot shows "Dashboard" — don't let a
        // language switch overwrite it back to "Log In".
        if (lg) lg.textContent = lg.getAttribute('data-snav-authed') ? UI.dashboard[lang] : UI.login[lang];
        var ct = root.querySelector('[data-snav-cta]'); if (ct) ct.textContent = UI.cta[lang];
        var account = root.querySelector('[data-snav-account]'); if (account) account.textContent = employerSide ? UI.recruiter[lang] : UI.account[lang];
        var download = root.querySelector('[data-snav-download]'); if (download) download.textContent = UI.download[lang];
      });
      var langMeta = LANGS.filter(function (l) { return l.code === lang; })[0] || LANGS[0];
      var t1 = document.getElementById('langToggleBtn');
      if (t1) { t1.textContent = langMeta.short; t1.setAttribute('aria-label', UI.switchLang[lang] + ': ' + langMeta.name); }
      var ham = nav.querySelector('.snav-ham'); if (ham) ham.setAttribute('aria-label', UI.openMenu[lang]);
      document.documentElement.lang = LOCALE_TAG[lang] || 'en';
    }

    // ── Shared language-picker dropdown, opened from the top-bar trigger ────
    var langMenuEl = null;
    function closeLangMenu() {
      if (langMenuEl) { langMenuEl.classList.remove('open'); langMenuEl.parentNode.removeChild(langMenuEl); langMenuEl = null; }
      document.getElementById('langToggleBtn') && document.getElementById('langToggleBtn').setAttribute('aria-expanded', 'false');
    }
    function selectLang(lang) {
      closeLangMenu();
      localStorage.setItem('rt_lang', lang);
      setNavLang(lang);
      setRoleLang(lang);
      // Ask the page to translate its own body, if it knows how. Guarded: some
      // pages have no translator, and a page-specific one shouldn't be able to
      // break the nav switcher.
      if (typeof window.applyLang === 'function') {
        try { window.applyLang(lang); } catch (e) {}
      }
    }
    function openLangMenu(anchor) {
      if (langMenuEl) { closeLangMenu(); return; }
      var current = getLang();
      var panel = document.createElement('div');
      panel.className = 'snav-langmenu';
      panel.setAttribute('role', 'menu');
      panel.innerHTML = LANGS.map(function (l) {
        return '<button type="button" role="menuitem" data-lang="' + l.code + '"' + (l.code === current ? ' aria-current="true"' : '') + '>' +
          '<span>' + l.name + '</span><span class="snav-langcheck" aria-hidden="true">&#10003;</span></button>';
      }).join('');
      document.body.appendChild(panel);
      var r = anchor.getBoundingClientRect();
      // Clamp both axes to the viewport — on a short window the trigger's
      // bottom+6 position could otherwise push the panel off-screen.
      var estH = LANGS.length * 41 + 12;
      var top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - estH - 8));
      var left = Math.max(8, Math.min(r.left, window.innerWidth - 184));
      panel.style.top = top + 'px';
      panel.style.left = left + 'px';
      panel.classList.add('open');
      langMenuEl = panel;
      anchor.setAttribute('aria-expanded', 'true');
      panel.querySelectorAll('button[data-lang]').forEach(function (btn) {
        btn.addEventListener('click', function () { selectLang(btn.getAttribute('data-lang')); });
      });
      setTimeout(function () {
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
      }, 0);
    }
    function onOutsideClick(e) {
      if (langMenuEl && !langMenuEl.contains(e.target) && e.target.id !== 'langToggleBtn') {
        closeLangMenu();
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
      }
    }
    function onEscape(e) {
      if (e.key === 'Escape') { closeLangMenu(); document.removeEventListener('click', onOutsideClick); document.removeEventListener('keydown', onEscape); }
    }

    document.getElementById('langToggleBtn').addEventListener('click', function (e) { e.stopPropagation(); openLangMenu(e.currentTarget); });

    // The top-nav Login button opens the role-selection modal (signed-out); when
    // a session is present it becomes a direct "Dashboard" link instead.
    var loginBtn = document.getElementById('snavLoginBtn');
    if (loginBtn) loginBtn.addEventListener('click', function () {
      if (loginBtn.getAttribute('data-snav-authed')) { location.assign('/dashboard'); return; }
      setRoleLang(getLang());
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
      var lang = getLang();
      [nav, menu].forEach(function (root) {
        var lg = root.querySelector('[data-snav-login]'); if (!lg) return;
        if (on) {
          lg.setAttribute('data-snav-authed', '1');
          lg.setAttribute('href', '/dashboard');
          lg.textContent = UI.dashboard[lang];
        } else {
          lg.removeAttribute('data-snav-authed');
          lg.setAttribute('href', loginHref);
          lg.textContent = UI.login[lang];
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
