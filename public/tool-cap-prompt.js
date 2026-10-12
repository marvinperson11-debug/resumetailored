/* tool-cap-prompt.js — the "you've reached today's free runs" prompt shared by
   the standalone free tools (/tools/*).

   A tool answers 402 {error:'quota', guest, message} at its daily cap. A GUEST
   (no session) gets a soft invitation to create a free account; a signed-in free
   MEMBER gets the Pro upsell. The modal builds itself, so a page needs only this
   script and a call to RTToolCap.show(responseBody). Nothing here blocks the
   page: the visitor keeps their input and can close the prompt. */
(function () {
  'use strict';
  var SIGN_UP = 'https://app.resumetailored.com/sign-up';
  var SIGN_IN = 'https://app.resumetailored.com/sign-in';
  var PRO = 'https://app.resumetailored.com?upgrade=pro';
  var T = {
    en: {
      gHead: "You've used today's free runs",
      gBody: 'Create a free account to continue, or come back tomorrow when your runs reset.',
      gGo: 'Create a free account', gIn: 'Already have an account? Log in', gX: 'Maybe tomorrow',
      mHead: "You've used today's free runs",
      mBody: 'Upgrade to Pro for unlimited access.', mGo: 'Upgrade — $19.00/mo', mX: 'Maybe tomorrow'
    },
    zh: {
      gHead: '今天的免费次数已用完',
      gBody: '创建免费账户即可继续使用，或明天次数重置后再来。',
      gGo: '创建免费账户', gIn: '已有账户？登录', gX: '明天再说',
      mHead: '今天的免费次数已用完',
      mBody: '升级专业版，无限次使用。', mGo: '升级 — $19.00/月', mX: '明天再说'
    }
  };
  function lang() { try { return localStorage.getItem('rt_lang') === 'zh' ? 'zh' : 'en'; } catch (e) { return 'en'; } }

  var CSS = '.rtcap{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55)}' +
    '.rtcap.show{display:flex}' +
    '.rtcap-box{max-width:420px;width:100%;background:#fff;color:#191512;border-radius:16px;padding:28px 24px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:inherit}' +
    '.rtcap-box h3{margin:0 0 8px;font-size:20px;line-height:1.25}' +
    '.rtcap-box p{margin:0 0 18px;font-size:15px;line-height:1.5;color:#57514A}' +
    '.rtcap-go{display:block;width:100%;box-sizing:border-box;padding:13px 18px;border:0;border-radius:10px;background:#1F5C3D;color:#fff;font-weight:700;font-size:15px;text-decoration:none;cursor:pointer}' +
    '.rtcap-in{display:block;margin-top:12px;font-size:13px;color:#1F5C3D}' +
    '.rtcap-x{display:block;width:100%;margin-top:10px;padding:8px;border:0;background:none;color:#8A8378;font-size:14px;cursor:pointer}';

  var el;
  function build() {
    if (el) return el;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    el = document.createElement('div');
    el.className = 'rtcap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="rtcap-box"><h3></h3><p></p><a class="rtcap-go" rel="noopener"></a>' +
      '<a class="rtcap-in" rel="noopener" hidden></a><button type="button" class="rtcap-x"></button></div>';
    el.addEventListener('click', function (e) { if (e.target === el) hide(); });
    el.querySelector('.rtcap-x').addEventListener('click', hide);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    document.body.appendChild(el);
    return el;
  }
  function hide() { if (el) el.classList.remove('show'); }

  // body = the 402 JSON from the tool. Returns true (handled) for convenience.
  function show(body) {
    var guest = !!(body && body.guest), t = T[lang()], m = build();
    var go = m.querySelector('.rtcap-go'), inn = m.querySelector('.rtcap-in');
    m.querySelector('h3').textContent = guest ? t.gHead : t.mHead;
    m.querySelector('p').textContent = guest ? t.gBody : t.mBody;
    go.textContent = guest ? t.gGo : t.mGo;
    go.href = guest ? SIGN_UP : PRO;
    // Open in a new tab so the visitor's pasted input on this page is not lost.
    go.target = '_blank';
    inn.hidden = !guest; inn.textContent = t.gIn; inn.href = SIGN_IN; inn.target = '_blank';
    m.querySelector('.rtcap-x').textContent = guest ? t.gX : t.mX;
    m.classList.add('show');
    return true;
  }

  window.RTToolCap = { show: show, hide: hide };
})();
