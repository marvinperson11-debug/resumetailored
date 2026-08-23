/*
 * Explicit parent navigation for tools and multi-panel application areas.
 *
 * These links deliberately never traverse browser history: a direct bookmark, page
 * refresh, or externally shared URL must lead to the same useful parent page.
 * A local `returnTo` query parameter may override the default when a caller
 * knows the exact in-app origin (for example /tools?returnTo=/dashboard).
 */
(function () {
  'use strict';

  var STATIC_PARENTS = {
    '/ai-resume-tailor':             ['/score', 'Back to Free Tools'],
    '/ai-cover-letter-generator':    ['/score', 'Back to Free Tools'],
    '/ats-score-checker':            ['/score', 'Back to Free Tools'],
    '/free-ats-resume-checker':      ['/score', 'Back to Free Tools'],
    '/resume-analyzer':              ['/score', 'Back to Free Tools'],
    '/job-tracker':                  ['/score', 'Back to Free Tools'],
    '/score':                        ['/tools', 'Back to New Tools'],
    '/tools/offer-comparison':       ['/tools', 'Back to New Tools'],
    '/tools/job-description-decoder':['/tools', 'Back to New Tools'],
    '/tools/follow-up-generator':    ['/tools', 'Back to New Tools'],
    '/tools/mock-interview':         ['/tools', 'Back to New Tools'],
    '/tools/ats-keyword-extractor':  ['/tools', 'Back to New Tools'],
    '/tools/resume-ab-tracker':      ['/tools', 'Back to New Tools'],
    '/tools/salary-negotiation':     ['/tools', 'Back to New Tools'],
    '/resume-examples':              ['/score', 'Back to Free Tools'],
    '/cover-letter-examples':        ['/score', 'Back to Free Tools'],
    '/tools/resume-video':           ['/tools', 'Back to New Tools'],
    '/decoder-key':                  ['/', 'Back to Home'],
    '/corporate':                    ['/', 'Back to Home'],
    '/resume-video':                 ['/', 'Back to Home'],
    '/portal':                       ['/corporate', 'Back to Corporate'],
    '/pricing':                      ['/', 'Back to Home'],
    '/checkout':                     ['/pricing', 'Back to Pricing'],
    '/for-employers':                ['/', 'Back to Home']
  };

  var APP_PARENTS = {
    tailor:      ['/score', 'Back to Free Tools'],
    linkedin:    ['/score', 'Back to Free Tools'],
    ats:         ['/score', 'Back to Free Tools'],
    jobtracker:  ['/score', 'Back to Free Tools'],
    video:       ['/tools', 'Back to New Tools'],
    website:     ['/tools', 'Back to New Tools'],
    backoffice:  ['/tools', 'Back to New Tools'],
    career:      ['/dashboard', 'Back to Dashboard'],
    skillslab:   ['/dashboard', 'Back to Dashboard'],
    interview:   ['/dashboard', 'Back to Dashboard'],
    gap:         ['/dashboard', 'Back to Dashboard'],
    jobfinder:   ['/dashboard', 'Back to Dashboard'],
    scenariolab: ['/dashboard', 'Back to Dashboard'],
    forum:       ['/dashboard', 'Back to Dashboard'],
    salary:      ['/dashboard', 'Back to Dashboard'],
    checkin:     ['/dashboard', 'Back to Dashboard'],
    help:        ['/dashboard', 'Back to Dashboard'],
    samples:     ['/dashboard', 'Back to Dashboard']
  };

  function cleanPath(value) {
    if (!value || value.charAt(0) !== '/' || value.indexOf('//') === 0) return '';
    if (/[\u0000-\u001f\\]/.test(value)) return '';
    try {
      var parsed = new URL(value, location.origin);
      return parsed.origin === location.origin ? parsed.pathname + parsed.search + parsed.hash : '';
    } catch (_) { return ''; }
  }

  function requestedParent(fallback) {
    try {
      var q = new URLSearchParams(location.search);
      return cleanPath(q.get('returnTo') || q.get('return_to')) || fallback;
    } catch (_) { return fallback; }
  }

  function addStyles() {
    if (document.getElementById('rtBackNavStyles')) return;
    var style = document.createElement('style');
    style.id = 'rtBackNavStyles';
    style.textContent =
      '.rt-back-wrap{width:min(1180px,calc(100% - 32px));margin:18px auto 0;position:relative;z-index:45}'+
      '.rt-explicit-back{display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:9px 13px;border:1px solid #d9cfbc;border-radius:10px;background:#fff;color:#1f5c3d!important;font:700 13px/1.2 Inter,system-ui,sans-serif;text-decoration:none!important;box-shadow:0 2px 8px rgba(25,21,18,.07);cursor:pointer}'+
      '.rt-explicit-back:hover{background:#f4f0e7;border-color:#1f5c3d}.rt-explicit-back:focus-visible{outline:3px solid rgba(31,92,61,.28);outline-offset:2px}'+
      '.tab-content>.rt-back-wrap{width:100%;margin:0 0 18px}.wb-immersive .tab-content>.rt-back-wrap,.video-immersive .tab-content>.rt-back-wrap{position:sticky;top:10px;width:max-content;max-width:calc(100% - 24px);margin:10px 12px;z-index:10020}'+
      '.nv-explicit-back{white-space:nowrap}@media(max-width:640px){.rt-back-wrap{width:calc(100% - 24px);margin-top:12px}.rt-explicit-back{min-height:44px}.nv-topbar .nv-explicit-back{order:5}}';
    document.head.appendChild(style);
  }

  function makeLink(parent, label) {
    var a = document.createElement('a');
    a.className = 'rt-explicit-back';
    a.href = requestedParent(parent);
    a.setAttribute('aria-label', label);
    a.innerHTML = '<span aria-hidden="true">\u2190</span><span>' + label + '</span>';
    return a;
  }

  function refreshStatic() {
    // The public server prefers clean URLs but direct `.html` bookmarks remain
    // valid, so both forms intentionally resolve through the same map.
    var path = (location.pathname.replace(/\/$/, '') || '/').replace(/\.html$/, '');
    var entry = STATIC_PARENTS[path];
    if (!entry) return;
    addStyles();
    var existing = document.querySelector('.th-back');
    if (existing) {
      existing.href = requestedParent(entry[0]);
      existing.classList.add('rt-explicit-back');
      existing.setAttribute('aria-label', entry[1]);
      existing.textContent = '\u2190 ' + entry[1];
      return;
    }
    if (document.getElementById('rtStaticBack')) return;
    var wrap = document.createElement('div');
    wrap.id = 'rtStaticBack'; wrap.className = 'rt-back-wrap';
    wrap.appendChild(makeLink(entry[0], entry[1]));
    var main = document.querySelector('main');
    if (main) main.insertBefore(wrap, main.firstChild);
    else {
      var nav = document.getElementById('snav') || document.querySelector('nav');
      if (nav && nav.parentNode) nav.parentNode.insertBefore(wrap, nav.nextSibling);
      else document.body.insertBefore(wrap, document.body.firstChild);
    }
  }

  function refreshApp(tab) {
    var panel = document.getElementById('panel-' + tab);
    var entry = APP_PARENTS[tab];
    if (!panel || !entry) return;
    addStyles();
    document.querySelectorAll('.tab-content>.rt-back-wrap').forEach(function (n) { n.remove(); });
    var wrap = document.createElement('div');
    wrap.className = 'rt-back-wrap'; wrap.setAttribute('data-back-for', tab);
    // Cover Letter shares the tailor panel, but direct /cover-letter links still
    // receive their own explicit parent through the same stable free-tools route.
    var label = location.pathname === '/cover-letter' ? 'Back to Free Tools' : entry[1];
    wrap.appendChild(makeLink(entry[0], label));
    panel.insertBefore(wrap, panel.firstChild);
  }

  function refreshEmployer(view) {
    addStyles();
    var top = document.querySelector('.nv-topbar');
    if (!top) return;
    var old = document.getElementById('nvExplicitBack'); if (old) old.remove();
    var control;
    if (!view || view === 'dashboard') {
      control = makeLink('/for-employers', 'Back to Employer Home');
    } else {
      control = document.createElement('button');
      control.type = 'button'; control.className = 'rt-explicit-back';
      control.innerHTML = '<span aria-hidden="true">\u2190</span><span>Back to Employer Dashboard</span>';
      control.setAttribute('aria-label', 'Back to Employer Dashboard');
      control.addEventListener('click', function () { window.nvGo('dashboard'); });
    }
    control.id = 'nvExplicitBack'; control.classList.add('nv-explicit-back');
    top.insertBefore(control, top.firstChild.nextSibling);
  }

  window.RTBackNav = {
    staticParents: STATIC_PARENTS,
    appParents: APP_PARENTS,
    refresh: refreshStatic,
    refreshApp: refreshApp,
    refreshEmployer: refreshEmployer
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshStatic);
  else refreshStatic();
})();
