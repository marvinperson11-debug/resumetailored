/* Sticky conversion CTA bar for ResumeTailored example pages.
   Self-contained: infers resume vs cover-letter copy from the URL, is
   dismissible (remembered in localStorage), and fires a GA event on click.
   Loaded via <script src="/cta-bar.js"></script> before </body>. */
(function () {
  if (document.getElementById('rt-cta-bar')) return;
  try { if (localStorage.getItem('rt_cta_hidden') === '1') return; } catch (e) {}

  var isCL = /cover-letter/.test(location.pathname);
  var msg = isCL
    ? 'Write a job-specific cover letter in 30 seconds — free, no credit card.'
    : 'Tailor your resume to any job in 30 seconds — free, no credit card.';
  var label = isCL ? 'Write My Cover Letter Free →' : 'Tailor My Resume Free →';

  var css = document.createElement('style');
  css.textContent =
    '#rt-cta-bar{position:fixed;left:0;right:0;bottom:0;z-index:9999;background:rgba(3,7,18,0.94);' +
    'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,0.12);' +
    'padding:11px 46px 11px 16px;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;' +
    "font-family:'Inter',Arial,sans-serif;box-shadow:0 -8px 30px rgba(0,0,0,0.35);}" +
    '#rt-cta-bar p{margin:0;color:#e2e8f0;font-size:14px;font-weight:600;}' +
    '#rt-cta-bar a{background:linear-gradient(135deg,#6366F1,#8B5CF6);color:#fff;padding:10px 22px;border-radius:9px;' +
    'font-size:14px;font-weight:800;text-decoration:none;white-space:nowrap;transition:opacity .15s;}' +
    '#rt-cta-bar a:hover{opacity:.9;}' +
    '#rt-cta-bar .rt-x{position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#64748b;font-size:20px;' +
    'line-height:1;cursor:pointer;background:none;border:none;padding:4px;}' +
    '#rt-cta-bar .rt-x:hover{color:#e2e8f0;}' +
    '@media(max-width:560px){#rt-cta-bar p{font-size:12.5px;}#rt-cta-bar{padding:9px 40px 9px 12px;gap:10px;}#rt-cta-bar a{padding:9px 16px;font-size:13px;}}';
  document.head.appendChild(css);

  var bar = document.createElement('div');
  bar.id = 'rt-cta-bar';
  bar.setAttribute('role', 'complementary');
  bar.setAttribute('aria-label', 'Get started');

  var p = document.createElement('p');
  p.textContent = msg;

  var a = document.createElement('a');
  a.href = '/dashboard';
  a.textContent = label;
  a.addEventListener('click', function () {
    try { if (typeof gtag === 'function') gtag('event', 'cta_bar_click', { page_type: isCL ? 'cover-letter' : 'resume' }); } catch (e) {}
  });

  var x = document.createElement('button');
  x.className = 'rt-x';
  x.setAttribute('aria-label', 'Dismiss');
  x.innerHTML = '&times;';
  x.addEventListener('click', function () {
    bar.remove();
    document.body.style.paddingBottom = '';
    try { localStorage.setItem('rt_cta_hidden', '1'); } catch (e) {}
  });

  bar.appendChild(p);
  bar.appendChild(a);
  bar.appendChild(x);

  function mount() {
    document.body.appendChild(bar);
    // reserve space so the bar never hides the footer's last line
    document.body.style.paddingBottom = (bar.offsetHeight + 8) + 'px';
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
