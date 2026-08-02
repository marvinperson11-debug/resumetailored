/* ============================================================================
   site-motion.js — editorial scroll-motion layer for marketing pages.
   Self-hosted GSAP + ScrollTrigger + Lenis (loaded separately, before this).
   Progressive enhancement only: if the libs are missing or the user prefers
   reduced motion, the page is fully usable with zero motion. Never included on
   the SEO role pages (Core Web Vitals) or the editor (canvas math).
   ============================================================================ */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGsap = typeof window.gsap !== 'undefined';
  var isTouch = window.matchMedia && window.matchMedia('(hover: none)').matches;

  /* ---- 1. Grain / texture overlay (pure CSS, cheap, always safe) -------- */
  function addGrain() {
    if (document.getElementById('rt-grain')) return;
    var g = document.createElement('div');
    g.id = 'rt-grain';
    g.setAttribute('aria-hidden', 'true');
    document.body.appendChild(g);
  }

  /* ---- 2. Custom cursor (desktop, non-touch only) ---------------------- */
  function customCursor() {
    if (isTouch || reduce) return;
    var dot = document.createElement('div'); dot.id = 'rt-cursor';
    var ring = document.createElement('div'); ring.id = 'rt-cursor-ring';
    document.body.appendChild(dot); document.body.appendChild(ring);
    var rx = 0, ry = 0, x = 0, y = 0;
    window.addEventListener('mousemove', function (e) {
      x = e.clientX; y = e.clientY;
      dot.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    }, { passive: true });
    (function loop() {
      rx += (x - rx) * 0.18; ry += (y - ry) * 0.18;
      ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px)';
      requestAnimationFrame(loop);
    })();
    var hot = 'a,button,.btn,[role="button"],input,textarea,select,summary,.template-card,.pricing-card,.tier-card';
    document.addEventListener('mouseover', function (e) {
      if (e.target.closest && e.target.closest(hot)) document.body.classList.add('rt-cursor-hot');
    });
    document.addEventListener('mouseout', function (e) {
      if (e.target.closest && e.target.closest(hot)) document.body.classList.remove('rt-cursor-hot');
    });
    document.body.classList.add('rt-has-cursor');
  }

  /* ---- 3. Lenis smooth scroll + ScrollTrigger reveals/parallax --------- */
  function motion() {
    if (reduce || !hasGsap) { staticReveal(); return; }
    var lenis = null;
    if (typeof window.Lenis !== 'undefined' && !isTouch) {
      lenis = new window.Lenis({ duration: 1.05, smoothWheel: true });
      function raf(t) { lenis.raf(t); requestAnimationFrame(raf); } requestAnimationFrame(raf);
      if (window.ScrollTrigger) { lenis.on('scroll', window.ScrollTrigger.update); }
    }
    if (!window.ScrollTrigger) { staticReveal(); return; }
    window.gsap.registerPlugin(window.ScrollTrigger);

    // Reveal: any [data-reveal] or common section blocks
    var targets = document.querySelectorAll('[data-reveal], .reveal, .section, .feature-row, .step, .pricing-card, .tier-card, .testimonial, .card');
    targets.forEach(function (el) {
      window.gsap.fromTo(el, { autoAlpha: 0, y: 34 }, {
        autoAlpha: 1, y: 0, duration: 0.7, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true }
      });
    });

    // Parallax: [data-parallax] moves against scroll
    document.querySelectorAll('[data-parallax]').forEach(function (el) {
      var amt = parseFloat(el.getAttribute('data-parallax')) || 40;
      window.gsap.to(el, { yPercent: amt, ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    // Pinned horizontal section: [data-hscroll] with .hscroll-track child
    document.querySelectorAll('[data-hscroll]').forEach(function (sec) {
      if (isTouch) return; // mobile uses native swipe/snap instead
      var track = sec.querySelector('.hscroll-track'); if (!track) return;
      var dist = track.scrollWidth - sec.clientWidth;
      if (dist <= 0) return;
      window.gsap.to(track, { x: -dist, ease: 'none',
        scrollTrigger: { trigger: sec, start: 'top top', end: '+=' + dist, scrub: 0.6, pin: true, invalidateOnRefresh: true } });
    });
  }

  // Fallback reveal without GSAP (IntersectionObserver)
  function staticReveal() {
    var els = document.querySelectorAll('[data-reveal], .reveal');
    if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('visible'); e.style.opacity = 1; }); return; }
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    els.forEach(function (e) { io.observe(e); });
  }

  function init() { addGrain(); customCursor(); motion(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
