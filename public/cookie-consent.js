// Google Consent Mode v2 — must load BEFORE gtag
(function() {
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }

  // Set Consent Mode v2 defaults (all denied until user chooses)
  gtag('consent', 'default', {
    ad_storage:              'denied',
    ad_user_data:            'denied',
    ad_personalization:      'denied',
    analytics_storage:       'denied',
    functionality_storage:   'denied',
    personalization_storage: 'denied',
    security_storage:        'granted',
    wait_for_update:         500
  });

  var STORAGE_KEY = 'rta_cookie_consent';

  function applyConsent(choice) {
    var granted = choice === 'accepted';
    gtag('consent', 'update', {
      ad_storage:              granted ? 'granted' : 'denied',
      ad_user_data:            granted ? 'granted' : 'denied',
      ad_personalization:      granted ? 'granted' : 'denied',
      analytics_storage:       granted ? 'granted' : 'denied',
      functionality_storage:   'granted',
      personalization_storage: granted ? 'granted' : 'denied'
    });
  }

  var stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    applyConsent(stored);
    return; // Banner already handled
  }

  // Inject banner CSS + HTML.
  // Slim, non-blocking bottom bar (~52px) — spans the full width along the very
  // bottom edge so it never overlaps the hero / before-after demo on first load.
  var css = [
    '#rta-consent{position:fixed;bottom:0;left:0;right:0;z-index:99999;',
    'background:rgba(250,247,240,0.97);border-top:1px solid #E7DFD1;',
    'box-shadow:0 -2px 20px rgba(25,21,18,0.10);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
    'display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;',
    'padding:10px 20px;min-height:52px;box-sizing:border-box;',
    'font-family:system-ui,-apple-system,sans-serif;}',
    '#rta-consent p{font-size:13px;color:#57514A;line-height:1.4;margin:0;flex:1 1 auto;min-width:200px;max-width:760px;}',
    '#rta-consent a{color:#1F5C3D;font-weight:600;text-decoration:underline;}',
    '#rta-consent .rta-btns{display:flex;gap:10px;flex-shrink:0;}',
    '#rta-consent button{padding:8px 18px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:none;}',
    '#rta-accept{background:#1F5C3D;color:#fff;}',
    '#rta-accept:hover{background:#153F2A;}',
    '#rta-reject{background:#FFFFFF;color:#57514A;border:1px solid #D9CFBC!important;}',
    '#rta-reject:hover{background:#F1EADD;color:#191512;}',
    '@media(max-width:560px){#rta-consent{flex-direction:column;gap:8px;padding:10px 16px;}',
    '#rta-consent p{text-align:center;}#rta-consent .rta-btns{width:100%;justify-content:center;}}'
  ].join('');

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function dismiss(choice) {
    localStorage.setItem(STORAGE_KEY, choice);
    applyConsent(choice);
    var el = document.getElementById('rta-consent');
    if (el) el.remove();
  }

  function buildBanner() {
    // Decide language here (not at script-parse time) so <html lang> is fully
    // available — Chinese on /zh/, English everywhere else.
    var isZh = (document.documentElement.lang || '').toLowerCase().indexOf('zh') === 0;
    var T = isZh ? {
      body: '我们使用 Cookie 来改善您的体验并评估网站性能。请参阅我们的<a href="/privacy">隐私政策</a>和<a href="/terms">服务条款</a>。',
      reject: '拒绝', accept: '全部接受'
    } : {
      body: 'We use cookies to improve your experience and measure site performance. See our <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms of Service</a>.',
      reject: 'Reject', accept: 'Accept All'
    };
    var banner = document.createElement('div');
    banner.id = 'rta-consent';
    banner.innerHTML = [
      '<p>', T.body, '</p>',
      '<div class="rta-btns">',
      '<button id="rta-reject">', T.reject, '</button>',
      '<button id="rta-accept">', T.accept, '</button>',
      '</div>'
    ].join('');
    document.body.appendChild(banner);
    document.getElementById('rta-accept').addEventListener('click', function() { dismiss('accepted'); });
    document.getElementById('rta-reject').addEventListener('click', function() { dismiss('rejected'); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildBanner);
  } else {
    buildBanner();
  }
})();
