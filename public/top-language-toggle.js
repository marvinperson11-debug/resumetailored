(function () {
  'use strict';

  function hasTopLanguageControl() {
    var selectors = [
      '#snav .snav-lang', '.club-nav [data-club-lang-top]', '.club-nav .club-nav__lang',
      'header #langToggleBtn', '.topbar #langToggleBtn', '.nav #langToggleBtn', '#emLangBtn'
    ];
    return selectors.some(function (selector) {
      var node = document.querySelector(selector);
      return node && getComputedStyle(node).display !== 'none';
    });
  }

  function switchLanguage() {
    var next = localStorage.getItem('rt_lang') === 'zh' ? 'en' : 'zh';
    localStorage.setItem('rt_lang', next);
    if (next === 'zh') {
      sessionStorage.setItem('rt_language_return', location.pathname + location.search + location.hash);
      location.assign('/zh/');
      return;
    }
    var back = sessionStorage.getItem('rt_language_return');
    sessionStorage.removeItem('rt_language_return');
    location.assign(back && back.charAt(0) === '/' && back.indexOf('//') !== 0 ? back : '/');
  }

  function mount() {
    if (hasTopLanguageControl() || document.querySelector('[data-global-language-toggle]')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-global-language-toggle', '');
    button.setAttribute('aria-label', 'Switch language / 切换语言');
    button.textContent = localStorage.getItem('rt_lang') === 'zh' ? 'EN' : '中文';
    button.addEventListener('click', switchLanguage);
    document.body.appendChild(button);

    var style = document.createElement('style');
    style.textContent = '[data-global-language-toggle]{position:fixed;top:12px;right:14px;z-index:2147483000;min-width:52px;padding:8px 12px;border:1px solid #c9a227;border-radius:2px;background:#fff;color:#0a1628;font:700 12px/1 Inter,system-ui,sans-serif;letter-spacing:.05em;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.22)}[data-global-language-toggle]:hover,[data-global-language-toggle]:focus-visible{background:#1a4d3a;color:#f7f3e8;outline:2px solid #c9a227;outline-offset:2px}';
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
