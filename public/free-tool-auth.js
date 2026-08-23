/* Shared login-at-action gate for standalone free tools.
 *
 * A tool page stays fully browsable while signed out. Only the Generate-style
 * action calls requireForAction(). Form values survive the login redirect and
 * the pending action is replayed as soon as the returning session is verified.
 */
(function () {
  'use strict';
  var KEY = 'rt_free_tool_pending_v1';
  var authPromise = null;

  function token() {
    try { return localStorage.getItem('rt_token') || ''; } catch (_) { return ''; }
  }

  async function authenticated() {
    if (authPromise) return authPromise;
    authPromise = (async function () {
      try {
        var headers = {}, legacy = token();
        if (legacy) headers.Authorization = 'Bearer ' + legacy;
        var res = await fetch('/api/auth/me', { headers: headers, credentials: 'same-origin' });
        if (!res.ok) return false;
        var data = await res.json().catch(function () { return {}; });
        try {
          if (data.email) localStorage.setItem('rt_email', data.email);
          if (data.username) localStorage.setItem('rt_username', data.username);
          if (legacy) localStorage.removeItem('rt_token');
        } catch (_) {}
        return true;
      } catch (_) { return false; }
    })();
    return authPromise;
  }

  function snapshot(action) {
    var fields = {};
    document.querySelectorAll('input[id],textarea[id],select[id]').forEach(function (el) {
      if (el.type === 'file' || el.type === 'password') return;
      fields[el.id] = el.type === 'checkbox' || el.type === 'radio'
        ? { checked: !!el.checked } : { value: el.value };
    });
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        path: location.pathname + location.search,
        action: action,
        fields: fields,
        at: Date.now()
      }));
    } catch (_) {}
  }

  function restore(pending) {
    Object.keys(pending.fields || {}).forEach(function (id) {
      var el = document.getElementById(id), state = pending.fields[id];
      if (!el || !state) return;
      if (Object.prototype.hasOwnProperty.call(state, 'checked')) el.checked = !!state.checked;
      else if (Object.prototype.hasOwnProperty.call(state, 'value')) el.value = state.value;
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    });
  }

  async function requireForAction() {
    // Public tools never require an account. Keep this compatibility helper so
    // older standalone pages can call it without being rewritten as a group.
    return true;
  }

  async function resume() {
    var pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) {}
    if (!pending || pending.path !== location.pathname + location.search) return;
    if (!pending.at || Date.now() - pending.at > 30 * 60 * 1000) {
      try { sessionStorage.removeItem(KEY); } catch (_) {}
      return;
    }
    restore(pending);
    if (!(await authenticated())) return;
    try { sessionStorage.removeItem(KEY); } catch (_) {}
    if (/^[A-Za-z_$][\w$]*$/.test(pending.action) && typeof window[pending.action] === 'function') {
      setTimeout(function () { window[pending.action](); }, 100);
    }
  }

  window.RTFreeToolAuth = { authenticated: authenticated, requireForAction: requireForAction };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resume);
  else resume();
})();
