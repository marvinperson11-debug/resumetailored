/* ============================================================================
   mobile-native.js — touch-first interaction layer (native events, no libs).
   Makes phones feel designed, not shrunk: haptics, bottom-sheet modals,
   swipe-snap horizontal chapters with dot indicators, edge-swipe drawer,
   pull-to-refresh hook, and subtle scroll-velocity skew. All effects no-op on
   desktop / when reduced-motion is set. Exposes window.rtHaptic(ms).
   ============================================================================ */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  var isMobile = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;

  /* ---- Haptics ---------------------------------------------------------- */
  function haptic(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) {} }
  window.rtHaptic = haptic;
  if (isTouch) {
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('a,button,.btn,[role="button"],[data-haptic]');
      if (t) haptic(t.hasAttribute('data-haptic') ? (parseInt(t.getAttribute('data-haptic'), 10) || 12) : 12);
    }, { passive: true });
  }

  if (!isTouch && !isMobile) return; // the rest is phone-only

  /* ---- Bottom-sheet modals --------------------------------------------- */
  // Any element with [data-sheet] (or the existing .modal-overlay) becomes a
  // bottom sheet on mobile: it slides up, and swipe-down / backdrop dismisses.
  function enhanceSheets() {
    document.querySelectorAll('.modal-box, [data-sheet]').forEach(function (box) {
      box.classList.add('rt-sheet');
      if (box.querySelector('.rt-sheet-grip')) return;
      var grip = document.createElement('div'); grip.className = 'rt-sheet-grip'; grip.setAttribute('aria-hidden', 'true');
      box.insertBefore(grip, box.firstChild);
      var startY = 0, cur = 0, dragging = false;
      grip.addEventListener('touchstart', function (e) { dragging = true; startY = e.touches[0].clientY; box.style.transition = 'none'; }, { passive: true });
      box.addEventListener('touchmove', function (e) {
        if (!dragging) return; cur = Math.max(0, e.touches[0].clientY - startY);
        box.style.transform = 'translateY(' + cur + 'px)';
      }, { passive: true });
      box.addEventListener('touchend', function () {
        if (!dragging) return; dragging = false; box.style.transition = '';
        if (cur > 110) { haptic(14); var ov = box.closest('.modal-overlay'); if (ov) ov.classList.remove('open'); box.style.transform = ''; }
        else { box.style.transform = 'translateY(0)'; }
        cur = 0;
      });
    });
  }

  /* ---- Swipe-snap horizontal chapters + dot indicators ----------------- */
  function enhanceHScroll() {
    document.querySelectorAll('[data-hscroll]').forEach(function (sec) {
      var track = sec.querySelector('.hscroll-track'); if (!track) return;
      sec.classList.add('rt-hsnap'); // CSS gives scroll-snap-type + momentum
      var cards = track.children, dots = document.createElement('div');
      dots.className = 'rt-hdots';
      for (var i = 0; i < cards.length; i++) {
        var d = document.createElement('span'); if (i === 0) d.className = 'on'; dots.appendChild(d);
      }
      sec.appendChild(dots);
      var hint = document.createElement('div'); hint.className = 'rt-swipe-hint'; hint.textContent = 'Swipe →';
      sec.appendChild(hint);
      track.addEventListener('scroll', function () {
        var idx = Math.round(track.scrollLeft / (track.clientWidth * 0.86));
        for (var j = 0; j < dots.children.length; j++) dots.children[j].className = (j === idx ? 'on' : '');
        if (track.scrollLeft > 12) hint.style.opacity = '0';
      }, { passive: true });
    });
  }

  /* ---- Edge-swipe drawer (for app sidebar: [data-drawer]) -------------- */
  function enhanceDrawer() {
    var drawer = document.querySelector('[data-drawer]'); if (!drawer) return;
    var open = function () { drawer.classList.add('rt-drawer-open'); haptic(10); };
    var close = function () { drawer.classList.remove('rt-drawer-open'); };
    var sx = 0, tracking = false;
    document.addEventListener('touchstart', function (e) {
      var x = e.touches[0].clientX; sx = x;
      tracking = x < 22 || drawer.classList.contains('rt-drawer-open');
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!tracking) return; var dx = e.changedTouches[0].clientX - sx;
      if (dx > 60) open(); else if (dx < -60) close(); tracking = false;
    }, { passive: true });
  }

  /* ---- Pull-to-refresh (lists/logs: [data-pull-refresh]) --------------- */
  function enhancePullRefresh() {
    document.querySelectorAll('[data-pull-refresh]').forEach(function (el) {
      var sy = 0, pulling = false;
      el.addEventListener('touchstart', function (e) { if (el.scrollTop <= 0) { sy = e.touches[0].clientY; pulling = true; } }, { passive: true });
      el.addEventListener('touchend', function (e) {
        if (!pulling) return; var dy = e.changedTouches[0].clientY - sy; pulling = false;
        if (dy > 90) { haptic(16); el.dispatchEvent(new CustomEvent('rt:refresh', { bubbles: true })); }
      }, { passive: true });
    });
  }

  /* ---- Scroll-velocity skew (subtle, tactile) -------------------------- */
  function scrollVelocity() {
    if (reduce) return;
    var last = window.scrollY, vel = 0, ticking = false;
    var targets = document.querySelectorAll('[data-velocity]');
    if (!targets.length) return;
    function onScroll() {
      vel = window.scrollY - last; last = window.scrollY;
      if (!ticking) { requestAnimationFrame(apply); ticking = true; }
    }
    function apply() {
      var s = Math.max(-6, Math.min(6, vel * 0.25));
      targets.forEach(function (t) { t.style.transform = 'skewY(' + (s * 0.15) + 'deg) scaleY(' + (1 + Math.abs(s) * 0.004) + ')'; });
      vel *= 0.8; ticking = false;
      if (Math.abs(vel) > 0.4) { requestAnimationFrame(apply); ticking = true; }
      else targets.forEach(function (t) { t.style.transform = ''; });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function init() { enhanceSheets(); enhanceHScroll(); enhanceDrawer(); enhancePullRefresh(); scrollVelocity(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
