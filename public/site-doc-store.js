/**
 * Website Builder v2 — site-document store (V3a foundation).
 *
 * The editor never mutates the document in place. Every change goes through
 * `apply(mutator)`, which clones the current document, lets the mutator edit the
 * clone, then commits it as a new immutable revision and pushes the previous one
 * onto an undo stack. That makes undo/redo a property of the store rather than
 * something bolted onto the canvas later.
 *
 * Guarantees:
 *  - `getDoc()` returns a frozen document; callers cannot corrupt state.
 *  - Any mutator that throws leaves the store untouched.
 *  - A mutator that changes nothing does not create an undo step.
 *  - Continuous gestures (drag/resize) coalesce into ONE undo step via
 *    `apply(fn, { coalesce: 'move:<id>' })`.
 *  - History is capped so long sessions can't grow without bound.
 *
 * Loads in the browser as `window.SiteDocStore` and in Node via require(),
 * so the foundation is unit-tested (test/doc-store.js) independently of the UI.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SiteDocStore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMIT = 60; // undo depth

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    }
    return o;
  }

  function createStore(initialDoc) {
    var doc = deepFreeze(clone(initialDoc || { v: 2, pages: [] }));
    var undoStack = [];   // previous revisions, oldest → newest
    var redoStack = [];
    var listeners = [];
    var lastTag = null;   // coalescing tag of the most recent commit

    function emit(meta) {
      listeners.slice().forEach(function (fn) {
        try { fn(doc, meta || {}); } catch (e) { /* a bad listener must not break the store */ }
      });
    }

    function commit(next, opts) {
      var o = opts || {};
      var same = JSON.stringify(next) === JSON.stringify(doc);
      if (same) return false;                       // no-op → no history entry

      var coalesce = o.coalesce || null;
      // Continuous gestures fold into the previous step instead of stacking.
      if (!(coalesce && coalesce === lastTag)) {
        undoStack.push(doc);
        if (undoStack.length > LIMIT) undoStack.shift();
      }
      redoStack.length = 0;
      lastTag = coalesce;
      doc = deepFreeze(next);
      emit({ reason: o.reason || 'apply', coalesce: coalesce });
      return true;
    }

    return {
      getDoc: function () { return doc; },

      /** Run `mutator(draft)` on a mutable clone and commit the result. */
      apply: function (mutator, opts) {
        var draft = clone(doc);
        var out = mutator(draft);
        var next = (out === undefined || out === null) ? draft : out;
        return commit(next, opts);
      },

      /** Replace the whole document (e.g. adopting a template). Ends coalescing. */
      replace: function (nextDoc, opts) {
        lastTag = null;
        return commit(clone(nextDoc), Object.assign({ reason: 'replace' }, opts || {}));
      },

      /** Close the current gesture so the next change starts a fresh undo step. */
      endGesture: function () { lastTag = null; },

      canUndo: function () { return undoStack.length > 0; },
      canRedo: function () { return redoStack.length > 0; },

      undo: function () {
        if (!undoStack.length) return false;
        redoStack.push(doc);
        doc = undoStack.pop();
        lastTag = null;
        emit({ reason: 'undo' });
        return true;
      },

      redo: function () {
        if (!redoStack.length) return false;
        undoStack.push(doc);
        doc = redoStack.pop();
        lastTag = null;
        emit({ reason: 'redo' });
        return true;
      },

      subscribe: function (fn) {
        listeners.push(fn);
        return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
      },

      /** Debug/telemetry only. */
      depth: function () { return { undo: undoStack.length, redo: redoStack.length }; },
    };
  }

  // ── Document helpers (pure) ───────────────────────────────────────────────
  // Shared by the editor so element lookup/mutation logic lives in one place.

  function findPage(doc, pageId) {
    var pages = (doc && doc.pages) || [];
    return pages.filter(function (p) { return p.id === pageId; })[0] || pages[0] || null;
  }

  function eachElement(doc, fn) {
    ((doc && doc.pages) || []).forEach(function (p) {
      (p.sections || []).forEach(function (s) {
        (s.els || []).forEach(function (e) { fn(e, s, p); });
      });
    });
  }

  function findElement(doc, elId) {
    var hit = null;
    eachElement(doc, function (e, s, p) { if (e.id === elId) hit = { el: e, section: s, page: p }; });
    return hit;
  }

  function newId(prefix) {
    return (prefix || 'e') + Math.random().toString(36).slice(2, 9);
  }

  // ── Page operations (V5) ──────────────────────────────────────────────────
  // Pure mutators over a DRAFT document (the clone `apply` hands out). Kept here
  // rather than in the UI so page management is unit-tested independently.

  var RESERVED_SLUGS = ['api', 'media', 'site', 'admin', 'assets', 'static'];

  /** URL-safe, unique-within-the-document slug. */
  function slugify(name, taken) {
    var base = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'page';
    if (RESERVED_SLUGS.indexOf(base) !== -1) base = base + '-page';
    var used = taken || [];
    if (used.indexOf(base) === -1) return base;
    for (var i = 2; i < 500; i++) {
      if (used.indexOf(base + '-' + i) === -1) return base + '-' + i;
    }
    return base + '-' + Date.now();
  }

  function pageSlugs(draft, exceptId) {
    return ((draft && draft.pages) || [])
      .filter(function (p) { return p.id !== exceptId; })
      .map(function (p) { return p.slug; });
  }

  function addPage(draft, name) {
    draft.pages = draft.pages || [];
    var id = newId('p');
    var title = String(name || 'New page').slice(0, 60);
    // Seed a nav + heading. A blank page would be a navigational dead end for
    // visitors (no way back to the rest of the site), so every new page starts
    // with the page menu and a title the user can edit or delete.
    var page = {
      id: id,
      name: title,
      slug: slugify(name || 'New page', pageSlugs(draft)),
      isHome: draft.pages.length === 0,
      seo: { title: '', description: '' },
      sections: [{
        id: newId('s'), h: 400, bg: { type: 'color', value: '#ffffff' },
        els: [
          { id: newId('e'), type: 'nav', x: 80, y: 30, w: 900, h: 40, props: {} },
          { id: newId('e'), type: 'heading', x: 80, y: 120, w: 700, h: 90, props: { text: title } },
        ],
      }],
    };
    draft.pages.push(page);
    return id;
  }

  function renamePage(draft, pageId, name) {
    var p = (draft.pages || []).filter(function (x) { return x.id === pageId; })[0];
    if (!p) return false;
    p.name = String(name || '').slice(0, 60) || p.name;
    return true;
  }

  /** Rename the URL segment. Slug stays unique and URL-safe. */
  function setPageSlug(draft, pageId, slug) {
    var p = (draft.pages || []).filter(function (x) { return x.id === pageId; })[0];
    if (!p) return false;
    p.slug = slugify(slug, pageSlugs(draft, pageId));
    return true;
  }

  function duplicatePage(draft, pageId) {
    var idx = (draft.pages || []).map(function (p) { return p.id; }).indexOf(pageId);
    if (idx === -1) return null;
    var copy = JSON.parse(JSON.stringify(draft.pages[idx]));
    copy.id = newId('p');
    copy.isHome = false;                       // a copy is never the home page
    copy.name = (copy.name || 'Page') + ' copy';
    copy.slug = slugify(copy.name, pageSlugs(draft));
    // Fresh ids for every section and element, so nothing aliases the original.
    (copy.sections || []).forEach(function (s) {
      s.id = newId('s');
      (s.els || []).forEach(function (e) { e.id = newId('e'); });
    });
    draft.pages.splice(idx + 1, 0, copy);
    return copy.id;
  }

  /** Delete a page. Refuses to remove the last one; reassigns home if needed. */
  function deletePage(draft, pageId) {
    var pages = draft.pages || [];
    if (pages.length <= 1) return false;
    var idx = pages.map(function (p) { return p.id; }).indexOf(pageId);
    if (idx === -1) return false;
    var wasHome = pages[idx].isHome;
    pages.splice(idx, 1);
    if (wasHome && pages.length) pages[0].isHome = true;
    return true;
  }

  /** Move a page by `delta` positions, clamped to the ends. */
  function movePage(draft, pageId, delta) {
    var pages = draft.pages || [];
    var idx = pages.map(function (p) { return p.id; }).indexOf(pageId);
    if (idx === -1) return false;
    var to = Math.max(0, Math.min(pages.length - 1, idx + (Number(delta) || 0)));
    if (to === idx) return false;
    pages.splice(to, 0, pages.splice(idx, 1)[0]);
    return true;
  }

  /** Exactly one page is home at any time. */
  function setHome(draft, pageId) {
    var pages = draft.pages || [];
    if (!pages.some(function (p) { return p.id === pageId; })) return false;
    pages.forEach(function (p) { p.isHome = (p.id === pageId); });
    return true;
  }

  function setPageSeo(draft, pageId, seo) {
    var p = (draft.pages || []).filter(function (x) { return x.id === pageId; })[0];
    if (!p) return false;
    p.seo = p.seo || {};
    if (seo && typeof seo.title === 'string') p.seo.title = seo.title.slice(0, 120);
    if (seo && typeof seo.description === 'string') p.seo.description = seo.description.slice(0, 300);
    return true;
  }

  /* ── Splitting a multi-item element ───────────────────────────────────
     A gallery is ONE element holding many pictures, which is right for a
     photo grid and wrong for the three showcase boxes every template uses it
     to draw: you cannot select one, cannot put a video in the middle one, and
     cannot give the first its own background. The user sees three boxes and
     the document has one.

     `splitElement` turns those items into independent elements laid out on the
     same grid the gallery drew them on, so what the document holds matches
     what the screen shows. It is deliberately arithmetic and not a renderer —
     the geometry here has to agree with `sd-gal--grid` in server.js, which
     lays cells out as `repeat(cols,1fr)` separated by `gap`.

     Returns the new element ids, or null if this element cannot be split. */
  var SPLITTABLE = { gallery: 1, casestudies: 1 };

  function splitElement(doc, elId) {
    var hit = findElement(doc, elId);
    if (!hit || !SPLITTABLE[hit.el.type]) return null;
    var el = hit.el;
    var items = (el.props && el.props.items) || [];
    if (items.length < 1) return null;

    var isGal = el.type === 'gallery';
    var cols = isGal
      ? Math.max(1, Math.min(6, Number(el.props.cols) || 3))
      : Math.max(1, Math.min(4, items.length));
    // A slider draws everything in one row whatever `cols` says.
    if (isGal && el.props.layout === 'slider') cols = items.length;
    cols = Math.max(1, Math.min(6, cols));
    var gap = Math.max(0, Math.min(48, Number(el.props.gap) || 14));

    var w = Number(el.w) || 0, h = Number(el.h) || 0;
    var cw = Math.max(40, Math.floor((w - gap * (cols - 1)) / cols));
    var rows = Math.ceil(items.length / cols);
    var ch = Math.max(40, Math.floor((h - gap * (rows - 1)) / rows));

    var made = [];
    var z = (Number(el.z) || 0);
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var r = Math.floor(i / cols), c = i % cols;
      var id = newId('e');
      // Title and caption are two lines in a gallery cell and one field on a
      // box, so they are joined rather than one of them being dropped.
      var cap = [it.title, it.caption].filter(function (x) { return x; }).join(' — ');
      var props = {
        // Keeps the decorative gradient visible after the split. Without it a
        // template's three coloured boxes would become three invisible empty
        // photo slots the moment they were made editable.
        phShow: true,
        radius: isGal ? 12 : 14,
      };
      if (it.src) props.src = it.src;
      if (it.ph) props.ph = { from: it.ph.from, to: it.ph.to, label: it.title || it.ph.label || '' };
      else if (!it.src) props.ph = { from: '6366F1', to: '8B5CF6', label: it.title || '' };
      if (cap) props.caption = cap;
      if (it.metric) props.caption = (cap ? cap + ' · ' : '') + it.metric;
      made.push({
        id: id, type: 'imagebox',
        x: (Number(el.x) || 0) + c * (cw + gap),
        y: (Number(el.y) || 0) + r * (ch + gap),
        w: cw, h: ch, z: z, props: props,
      });
    }

    var els = hit.section.els || [];
    var at = els.indexOf(el);
    if (at < 0) at = els.length;
    els.splice.apply(els, [at, 1].concat(made));
    hit.section.els = els;
    return made.map(function (m) { return m.id; });
  }

  /* Split every splittable element in a document. Used when a template is
     turned into somebody's site, so a new site never contains a row of boxes
     that cannot be edited one at a time. */
  function splitAll(doc) {
    var ids = [];
    var again = true;
    while (again) {
      again = false;
      var target = null;
      eachElement(doc, function (e) { if (!target && SPLITTABLE[e.type] && ((e.props && e.props.items) || []).length) target = e.id; });
      if (target) {
        var out = splitElement(doc, target);
        if (out && out.length) { ids = ids.concat(out); again = true; }
      }
    }
    return ids;
  }

  return {
    createStore: createStore,
    splitElement: splitElement,
    splitAll: splitAll,
    SPLITTABLE: SPLITTABLE,
    findPage: findPage,
    findElement: findElement,
    eachElement: eachElement,
    newId: newId,
    HISTORY_LIMIT: LIMIT,
    // page ops
    slugify: slugify,
    addPage: addPage,
    renamePage: renamePage,
    setPageSlug: setPageSlug,
    duplicatePage: duplicatePage,
    deletePage: deletePage,
    movePage: movePage,
    setHome: setHome,
    setPageSeo: setPageSeo,
    RESERVED_SLUGS: RESERVED_SLUGS,
  };
}));
