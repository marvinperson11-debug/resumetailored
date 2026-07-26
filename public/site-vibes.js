/**
 * VIBES — the only look-and-feel control a beginner ever sees.
 *
 * A *template* is structure: which sections exist and in what order. A *vibe* is
 * how it looks. They used to be welded together — each template hard-coded its
 * own palette — so changing the look meant throwing away the content.
 *
 * Applying a vibe RE-SKINS whatever the user already has. Their sections, their
 * words and their photos are untouched; only colour, background and text
 * contrast change. That is what makes "one click = done" safe to offer: there is
 * nothing to lose by trying one.
 *
 * Loadable in the browser (window.SiteVibes) and in Node (require), because the
 * editor preview and the published page must produce byte-identical output. One
 * implementation, no second copy to drift.
 *
 * No colour pickers and no hex codes anywhere in the UI — ten choices, plus a
 * single lighten/darken step.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SiteVibes = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // `hero` is what the first section of every page gets. `alt` is the tint used
  // for alternating sections further down. `onDark` says whether hero text needs
  // to be light — the readability rule, decided once per vibe rather than left
  // to whoever writes the copy.
  var VIBES = [
    // ── Five clean vibes: colour, gradient and geometry, no photography ──────
    {
      id: 'calm', name: 'Clean & Calm', kind: 'clean',
      theme: { primary: '4f46e5', accent: '6366F1', ink: '0f172a', paper: 'ffffff', muted: '64748b' },
      hero: { type: 'gradient', value: 'linear-gradient(135deg,#eef2ff,#f8fafc)' },
      alt: '#f8fafc', onDark: false,
      swatch: ['eef2ff', '4f46e5'],
    },
    {
      id: 'bright', name: 'Bold & Bright', kind: 'clean',
      theme: { primary: 'db2777', accent: 'f59e0b', ink: '111827', paper: 'ffffff', muted: '6b7280' },
      hero: { type: 'gradient', value: 'linear-gradient(135deg,#fdf2f8,#fff7ed 60%,#fef9c3)' },
      alt: '#fff7ed', onDark: false,
      swatch: ['fdf2f8', 'db2777'],
    },
    {
      id: 'polished', name: 'Professional & Polished', kind: 'clean',
      theme: { primary: '1e3a8a', accent: '0ea5e9', ink: '0f172a', paper: 'ffffff', muted: '475569' },
      hero: { type: 'gradient', value: 'linear-gradient(135deg,#0f172a,#1e3a8a)' },
      alt: '#f1f5f9', onDark: true,
      swatch: ['1e3a8a', '0ea5e9'],
    },
    {
      id: 'dark', name: 'Dark & Modern', kind: 'clean',
      theme: { primary: '22d3ee', accent: '8B5CF6', ink: 'e5e7eb', paper: '0b1020', muted: '94a3b8' },
      hero: { type: 'gradient', value: 'linear-gradient(135deg,#0b1020,#1e1b4b 70%,#312e81)' },
      alt: '#0f172a', onDark: true,
      swatch: ['0b1020', '22d3ee'],
    },
    {
      id: 'colorful', name: 'Creative & Colorful', kind: 'clean',
      theme: { primary: '8B5CF6', accent: 'ec4899', ink: '18181b', paper: 'ffffff', muted: '52525b' },
      hero: { type: 'gradient', value: 'linear-gradient(135deg,#8B5CF6,#ec4899 55%,#f59e0b)' },
      alt: '#faf5ff', onDark: true,
      swatch: ['8B5CF6', 'ec4899'],
    },

    // ── Five photographic vibes: full-bleed CC0 photography ──────────────────
    // Every one is light text on a darkened photo, so the readability rule is
    // structural rather than something the user has to notice.
    {
      id: 'sunset', name: 'Sunset Glow', kind: 'photo',
      theme: { primary: 'f59e0b', accent: 'f43f5e', ink: '1c1917', paper: 'fffbf5', muted: '78716c' },
      hero: { type: 'image', value: '/vibes/sunset.jpg' },
      alt: '#fff7ed', onDark: true,
      swatch: ['f59e0b', 'f43f5e'],
    },
    {
      id: 'forest', name: 'Forest Canopy', kind: 'photo',
      theme: { primary: '15803d', accent: '65a30d', ink: '14532d', paper: 'f7fee7', muted: '4d7c0f' },
      hero: { type: 'image', value: '/vibes/forest.jpg' },
      alt: '#f7fee7', onDark: true,
      swatch: ['15803d', '65a30d'],
    },
    {
      id: 'city', name: 'City Lights', kind: 'photo',
      theme: { primary: '6366F1', accent: '22d3ee', ink: 'e5e7eb', paper: '0f172a', muted: '94a3b8' },
      hero: { type: 'image', value: '/vibes/city.jpg' },
      alt: '#111827', onDark: true,
      swatch: ['0f172a', '6366F1'],
    },
    {
      id: 'ocean', name: 'Ocean Breeze', kind: 'photo',
      theme: { primary: '0284c7', accent: '06b6d4', ink: '0c4a6e', paper: 'f0f9ff', muted: '0369a1' },
      hero: { type: 'image', value: '/vibes/ocean.jpg' },
      alt: '#f0f9ff', onDark: true,
      swatch: ['0284c7', '06b6d4'],
    },
    {
      id: 'mountain', name: 'Mountain Peak', kind: 'photo',
      theme: { primary: '334155', accent: '0ea5e9', ink: '1e293b', paper: 'f8fafc', muted: '64748b' },
      hero: { type: 'image', value: '/vibes/mountain.jpg' },
      alt: '#f1f5f9', onDark: true,
      swatch: ['334155', '0ea5e9'],
    },
  ];

  var BY_ID = {};
  VIBES.forEach(function (v) { BY_ID[v.id] = v; });

  function list() {
    return VIBES.map(function (v) {
      return { id: v.id, name: v.name, kind: v.kind, swatch: v.swatch.slice(),
               preview: v.kind === 'photo' ? v.hero.value : null };
    });
  }

  // ── Lighten / darken ──────────────────────────────────────────────────────
  // The single tweak on offer. Photo vibes move the overlay strength; clean
  // vibes move the hero itself. Either way it is one slider with no numbers.
  function clampTone(t) {
    var n = Math.round(Number(t) || 0);
    return n < -2 ? -2 : (n > 2 ? 2 : n);
  }

  // Overlay opacity for photo heroes. Text is always light, so darker = more
  // readable; the range never goes light enough to lose contrast.
  function overlayFor(tone) {
    var base = 0.52;
    return Math.max(0.28, Math.min(0.82, base + clampTone(tone) * 0.12));
  }

  function heroBg(vibe, tone) {
    if (vibe.hero.type !== 'image') {
      // Clean vibes: a translucent white or black wash over the gradient.
      var t = clampTone(tone);
      if (!t) return { type: 'gradient', value: vibe.hero.value };
      var a = Math.abs(t) * 0.13;
      var wash = t < 0
        ? 'rgba(255,255,255,' + a.toFixed(2) + ')'   // negative = lighter
        : 'rgba(0,0,0,' + a.toFixed(2) + ')';
      return { type: 'gradient', value: 'linear-gradient(' + wash + ',' + wash + '),' + vibe.hero.value };
    }
    return { type: 'image', value: vibe.hero.value, overlay: overlayFor(tone), onDark: true };
  }

  /**
   * Re-skin a document in place on a DRAFT copy.
   *
   * Structure, copy and uploaded media are never touched. What changes:
   *  - the document theme (drives every accent, button and link)
   *  - each page's FIRST section background (the hero)
   *  - later section backgrounds, alternating paper / tint
   *  - explicit per-element text colours, which would otherwise fight the new
   *    background — a #ffffff heading left over from a dark vibe is invisible
   *    on a light one, which is the single most likely way this breaks
   */
  function applyVibe(doc, vibeId, tone) {
    var v = BY_ID[vibeId];
    if (!doc || !v || !Array.isArray(doc.pages)) return doc;
    var t = clampTone(tone);

    doc.theme = { primary: v.theme.primary, accent: v.theme.accent, ink: v.theme.ink,
                  paper: v.theme.paper, muted: v.theme.muted };
    doc.vibe = v.id;
    doc.vibeTone = t;

    var hero = heroBg(v, t);

    doc.pages.forEach(function (pg) {
      var secs = pg.sections || [];
      secs.forEach(function (s, i) {
        var isHero = i === 0;
        var onDark;
        if (isHero) {
          s.bg = { type: hero.type, value: hero.value };
          if (hero.overlay != null) s.bg.overlay = hero.overlay;
          onDark = v.onDark;
        } else {
          // Alternate plain paper and the vibe's tint so sections stay legible
          // and the page keeps a rhythm.
          var useAlt = i % 2 === 1;
          s.bg = { type: 'color', value: useAlt ? v.alt : '#' + v.theme.paper };
          onDark = _isDark(useAlt ? v.alt : v.theme.paper);
        }
        (s.els || []).forEach(function (el) {
          if (!el || !el.props) return;
          if (!_isTextType(el.type)) return;
          // Only override colours the template set. An element the user
          // deliberately coloured is left alone (marked with props.lockColor).
          if (el.props.lockColor) return;
          if (onDark) el.props.color = '#ffffff';
          else delete el.props.color;   // inherit the vibe's ink / muted
        });
      });
    });
    return doc;
  }

  function _isTextType(t) {
    return t === 'heading' || t === 'subheading' || t === 'paragraph';
  }

  // Relative luminance, so "is light text needed here" is measured rather than
  // guessed per vibe.
  function _isDark(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-f]{6}$/i.test(h)) return false;
    var r = parseInt(h.slice(0, 2), 16) / 255;
    var g = parseInt(h.slice(2, 4), 16) / 255;
    var b = parseInt(h.slice(4, 6), 16) / 255;
    var f = function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return (0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)) < 0.42;
  }

  return {
    VIBES: VIBES,
    list: list,
    get: function (id) { return BY_ID[id] || null; },
    applyVibe: applyVibe,
    clampTone: clampTone,
    overlayFor: overlayFor,
    isDark: _isDark,
  };
}));
