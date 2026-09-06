(function () {
  'use strict';
  var labels = { pro: 1, lifetime: 1, portal: 1, scale: 1, corporate: 1 };

  function showError(message) {
    var old = document.getElementById('rtCheckoutError');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'rtCheckoutError';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:50%;top:82px;transform:translateX(-50%);z-index:4000;width:min(620px,calc(100% - 32px));padding:14px 46px 14px 18px;background:#0a1628;color:#f7f2e8;border:1px solid #c9a227;border-radius:10px;box-shadow:0 20px 55px rgba(0,0,0,.3);font:600 14px/1.45 Inter,Arial,sans-serif';
    el.appendChild(document.createTextNode(message));
    var close = document.createElement('button');
    close.type = 'button'; close.setAttribute('aria-label', 'Dismiss'); close.textContent = '×';
    close.style.cssText = 'position:absolute;right:12px;top:7px;border:0;background:none;color:#c9a227;font-size:24px;cursor:pointer';
    close.onclick = function () { el.remove(); };
    el.appendChild(close); document.body.appendChild(el);
  }

  function checkoutHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    var match = document.cookie.match(/(?:^|;\s*)rt_csrf=([^;]+)/);
    if (match) {
      try { headers['X-CSRF-Token'] = decodeURIComponent(match[1]); }
      catch (_) { headers['X-CSRF-Token'] = match[1]; }
    }
    return headers;
  }

  // Consumer Pro upgrades are no longer initiated on the marketing site. The
  // new flow is sign-up-first: send the visitor to the dashboard app, which
  // makes them sign in (or sign up) and THEN starts Stripe checkout for their
  // known Clerk email. Employer plans (portal/scale/corporate) still check out
  // here — the app has no employer upgrade surface.
  var APP_UPGRADE_URL = 'https://app.resumetailored.com?upgrade=pro';

  async function start(plan, trigger) {
    plan = String(plan || '').toLowerCase();
    if (!labels[plan]) return showError('That plan is not available. Please refresh and try again.');
    if (plan === 'pro' || plan === 'lifetime') { window.location.assign(APP_UPGRADE_URL); return; }
    var endpoint = '/api/employer/subscribe';
    var body = { plan: plan };
    var original = trigger && trigger.textContent;
    if (trigger) { trigger.disabled = true; trigger.setAttribute('aria-busy', 'true'); trigger.textContent = 'Opening secure checkout…'; }
    try {
      var res = await fetch(endpoint, { method: 'POST', headers: checkoutHeaders(), body: JSON.stringify(body) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.url) throw new Error(data.message || data.error || 'Secure checkout could not be opened.');
      window.location.assign(data.url);
    } catch (err) {
      showError((err && err.message) || 'Checkout is temporarily unavailable. Please try again.');
      if (trigger) { trigger.disabled = false; trigger.removeAttribute('aria-busy'); trigger.textContent = original; }
    }
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest && event.target.closest('[data-checkout-plan]');
    if (!target) return;
    event.preventDefault(); start(target.getAttribute('data-checkout-plan'), target);
  });
  document.addEventListener('DOMContentLoaded', function () {
    if (new URLSearchParams(location.search).get('checkout') === 'cancelled') showError('Checkout was cancelled. You have not been charged, and your current plan is unchanged.');
  });
  window.RTCheckout = { start: start, showError: showError };
})();
