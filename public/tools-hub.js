/* tools-hub.js — shared helpers for the 7 job-search tool pages (/tools/*).
   Auth (reuses the app's rt_token), a lightweight bilingual toggle driven by a
   per-page window.TH_I18N dict, the upgrade modal, and copy/download utilities.
   Kept framework-free to match the rest of the static site. */
(function () {
  'use strict';

  // ── auth (shares the SPA's localStorage session) ──────────────────────────
  window.thToken = function () { try { return localStorage.getItem('rt_token') || ''; } catch (e) { return ''; } };
  window.thLoggedIn = function () { return !!window.thToken(); };
  function authHeaders(json) {
    var h = {};
    var t = window.thToken(); if (t) h.Authorization = 'Bearer ' + t;
    if (json !== false) h['Content-Type'] = 'application/json';
    return h;
  }

  // ── API ───────────────────────────────────────────────────────────────────
  window.thApi = async function (method, path, body) {
    var opts = { method: method, headers: authHeaders(!!body) };
    if (body) opts.body = JSON.stringify(body);
    var res = await fetch(path, opts);
    var data = null; try { data = await res.json(); } catch (e) {}
    return { status: res.status, data: data || {} };
  };

  // ── i18n (per-page window.TH_I18N = { en:{...}, zh:{...} }) ────────────────
  function currentLang() { try { return localStorage.getItem('rt_lang') === 'zh' ? 'zh' : 'en'; } catch (e) { return 'en'; } }
  function applyLang(lang) {
    var dict = (window.TH_I18N && window.TH_I18N[lang]) || {};
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n'); if (dict[k] != null) el.textContent = dict[k];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-html'); if (dict[k] != null) el.innerHTML = dict[k];
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-ph'); if (dict[k] != null) el.setAttribute('placeholder', dict[k]);
    });
    var btn = document.getElementById('thLangBtn'); if (btn) btn.textContent = lang === 'zh' ? 'EN' : '中文';
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }
  window.toggleLang = function () {
    var next = currentLang() === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem('rt_lang', next); } catch (e) {}
    applyLang(next);
  };
  window.thT = function (key, fallback) {
    var dict = (window.TH_I18N && window.TH_I18N[currentLang()]) || {};
    return dict[key] != null ? dict[key] : fallback;
  };

  // ── upgrade modal ─────────────────────────────────────────────────────────
  window.thUpgrade = function (message) {
    var m = document.getElementById('thUpgradeModal');
    if (!m) return;
    var p = document.getElementById('thUpgradeMsg');
    if (p && message) p.textContent = message;
    m.classList.add('show');
  };
  window.thCloseUpgrade = function () { var m = document.getElementById('thUpgradeModal'); if (m) m.classList.remove('show'); };
  window.thStartPro = function () {
    // Signed-in users go through the app's checkout; guests are sent to sign in first.
    if (window.thLoggedIn()) location.href = '/dashboard?upgrade=1';
    else location.href = '/login?next=' + encodeURIComponent(location.pathname);
  };

  // ── copy / download ───────────────────────────────────────────────────────
  window.thCopy = function (text, btn) {
    var done = function () {
      if (!btn) return; var old = btn.textContent; btn.textContent = thT('copied', 'Copied ✓');
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(done);
    else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); done(); }
  };
  window.thDownload = function (text, filename) {
    var blob = new Blob([text], { type: 'text/plain' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename || 'export.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };

  // ── login gate helper for pages that need it up front ─────────────────────
  window.thRequireLogin = function () {
    if (window.thLoggedIn()) return true;
    location.href = '/login?next=' + encodeURIComponent(location.pathname);
    return false;
  };

  // ── standard error/quota handling for a tool response ─────────────────────
  // Returns true if the caller should stop (handled), false to continue.
  window.thHandleGate = function (res) {
    if (res.status === 401) { window.thRequireLogin(); return true; }
    if (res.status === 402) { window.thUpgrade(res.data && res.data.message); return true; }
    return false;
  };

  document.addEventListener('DOMContentLoaded', function () { applyLang(currentLang()); });
})();
