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

  return {
    createStore: createStore,
    findPage: findPage,
    findElement: findElement,
    eachElement: eachElement,
    newId: newId,
    HISTORY_LIMIT: LIMIT,
  };
}));
