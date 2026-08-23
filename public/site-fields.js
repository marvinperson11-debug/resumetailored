/**
 * FIELDS — what the site takes from the resume, and what it stops taking.
 *
 * The site is generated from the resume, and keeps following it. But the moment
 * someone edits a field ON the site, that field is theirs: the site becomes the
 * source of truth for it, and later resume updates leave it alone.
 *
 *   edit  → detach   (this field is now mine)
 *   reset → re-sync  (go back to following my resume)
 *
 * Without the detach, "the site updates automatically from your resume" and
 * "click your name to change it" contradict each other — the next resume update
 * would silently throw away whatever the user typed.
 *
 * Fields are identified by `props.field`, not by position. Keying off "the first
 * heading in the first section" would re-point at a different element the moment
 * someone reorders anything.
 *
 * Loadable in the browser (window.SiteFields) and in Node (require), so the
 * editor and the generator run the same derivation rather than two copies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SiteFields = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FIELDS = ['name', 'subtitle', 'summary'];

  /**
   * Every hero template was drawn with a FIXED gap between one element and the
   * next — a resume's role, in particular, has no natural length limit ("Senior
   * Regional Director of Manufacturing Operations and Continuous Improvement
   * Strategy" is a real job title), and the summary section can run to whole
   * paragraphs. Handed to the templates unbounded, either one grows past the
   * space its box was given and lands on top of whatever comes next — the
   * button under the hero paragraph, or the paragraph under a long role/title.
   * Cut at a word boundary, not mid-word, and only when it would otherwise be
   * too long to say so.
   */
  function _truncateWords(s, max) {
    s = String(s || '').trim();
    if (s.length <= max) return s;
    var cut = s.slice(0, max);
    var lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > max * 0.4) cut = cut.slice(0, lastSpace);
    return cut.replace(/[\s.,;:–—-]+$/, '') + '…';
  }

  /**
   * Pull the handful of personal facts a site hero needs out of resume text.
   * Everything here is a convention rather than a guarantee, so each one can
   * come back empty and callers must cope with that.
   */
  function deriveFields(text) {
    var lines = String(text || '').split('\n').map(function (l) { return l.trim(); });

    // The name is the first non-empty line — the one convention every resume
    // follows, and the same one the resume renderer already relies on.
    var name = '';
    for (var i = 0; i < lines.length; i++) { if (lines[i]) { name = lines[i].slice(0, 80); break; } }

    // Location comes from the contact line under the name, conventionally
    // "email | City, ST | linkedin…". Take the part that is not an email, a URL
    // or a phone number.
    var contact = lines[1] || '';
    var location = '';
    contact.split(/[|·•]/).some(function (p) {
      p = p.trim();
      if (!p || p.length >= 40) return false;
      if (/@/.test(p)) return false;
      if (/https?:|\.com|linkedin/i.test(p)) return false;
      if (/\d{3}[-.\s]?\d{3,4}/.test(p)) return false;
      location = p; return true;
    });

    // Role: the first job title under EXPERIENCE, minus employer and dates.
    var role = '';
    var expAt = _indexOfHeading(lines, /^(experience|work experience|employment)\b/i);
    if (expAt >= 0) {
      for (var j = expAt + 1; j < Math.min(lines.length, expAt + 6); j++) {
        var l = lines[j];
        if (!l || /^[•\-*]/.test(l)) continue;
        role = _truncateWords(l.split(/[|,–—]/)[0], 60);
        break;
      }
    }

    // Summary: the body of the SUMMARY / PROFILE / OBJECTIVE section.
    var summary = '';
    var sumAt = _indexOfHeading(lines, /^(summary|profile|objective|about)\b/i);
    if (sumAt >= 0) {
      var body = [];
      for (var k = sumAt + 1; k < lines.length; k++) {
        var s = lines[k];
        if (!s) { if (body.length) break; continue; }
        if (/^[A-Z][A-Z\s&]{3,}$/.test(s)) break;   // next ALL-CAPS section heading
        body.push(s.replace(/^[•\-*]\s*/, ''));
      }
      summary = _truncateWords(body.join(' '), 220);
    }

    return {
      name: name,
      subtitle: [role, location].filter(Boolean).join(' · '),
      summary: summary,
      role: role,
      location: location,
    };
  }

  function _indexOfHeading(lines, re) {
    for (var i = 0; i < lines.length; i++) if (re.test(lines[i])) return i;
    return -1;
  }

  // Walk every element, newest-first is irrelevant — order is stable.
  function eachEl(doc, fn) {
    var pages = (doc && doc.pages) || [];
    for (var p = 0; p < pages.length; p++) {
      var secs = pages[p].sections || [];
      for (var s = 0; s < secs.length; s++) {
        var els = secs[s].els || [];
        for (var e = 0; e < els.length; e++) fn(els[e], secs[s], pages[p]);
      }
    }
  }

  function findField(doc, field) {
    var hit = null;
    eachEl(doc, function (el) {
      if (!hit && el && el.props && el.props.field === field) hit = el;
    });
    return hit;
  }

  function findById(doc, elId) {
    var hit = null;
    eachEl(doc, function (el) { if (el && el.id === elId) hit = el; });
    return hit;
  }

  /**
   * Tag the hero's elements with the field they represent, so everything after
   * this can work by meaning rather than by position.
   *
   * Two passes, deliberately. Some templates put a small decorative element —
   * a "$ whoami" kicker, an "● Available from October" badge — ahead of the
   * real intro paragraph in document order, and both share the `paragraph`
   * type. A single pass tags whichever comes first, which was the badge: the
   * full resume summary (up to 400 chars) landed in a 300×30 pill instead of
   * the actual body copy, and the real paragraph was left with its static
   * sample text forever. Explicit `props.field` on the template (authoring
   * intent) is honored FIRST, in pass one, so those templates can point at the
   * correct element; only the elements nothing has claimed are inferred by
   * first-of-type in pass two. Templates that never set `field` explicitly
   * behave exactly as before.
   */
  function tagFields(doc) {
    if (!doc || !doc.pages || !doc.pages[0]) return doc;
    var hero = (doc.pages[0].sections || [])[0];
    if (!hero) return doc;
    var want = ['heading', 'subheading', 'paragraph'];
    var map = { heading: 'name', subheading: 'subtitle', paragraph: 'summary' };
    var used = {};
    var els = hero.els || [];
    els.forEach(function (el) {
      if (el && el.props && el.props.field) used[el.props.field] = true;
    });
    els.forEach(function (el) {
      if (!el || !el.props || el.props.field) return;
      var f = map[el.type];
      if (f && want.indexOf(el.type) >= 0 && !used[f]) { el.props.field = f; used[f] = true; }
    });
    return doc;
  }

  /**
   * Write the derived values into the document, SKIPPING anything the user has
   * edited on the site. This is the promise: their edits are never overwritten
   * by a later resume update.
   *
   * Returns the list of fields it actually wrote, so callers can tell the
   * difference between "nothing to do" and "refused to touch it".
   */
  function syncFromResume(doc, text, opts) {
    var force = !!(opts && opts.force);
    var vals = deriveFields(text);
    var written = [];
    FIELDS.forEach(function (f) {
      var el = findField(doc, f);
      if (!el) return;
      if (el.props.detached && !force) return;   // theirs now — leave it alone
      var v = vals[f];
      if (typeof v !== 'string' || !v) return;   // nothing derivable; keep what's there
      if (el.props.text === v) return;
      el.props.text = v;
      written.push(f);
    });
    return written;
  }

  /**
   * Record that the user edited a field on the site. From here on the site owns
   * it. `detachedAt` is kept for the "reset" affordance to explain itself.
   */
  function applyEdit(doc, elId, value) {
    var el = findById(doc, elId);
    if (!el) return null;
    el.props = el.props || {};
    el.props.text = String(value == null ? '' : value).slice(0, 4000);
    if (el.props.field) { el.props.detached = true; el.props.detachedAt = Date.now(); }
    return el;
  }

  /** Put a single field back under the resume's control. */
  function resetField(doc, elId, text) {
    var el = findById(doc, elId);
    if (!el || !el.props || !el.props.field) return null;
    var v = deriveFields(text)[el.props.field];
    delete el.props.detached;
    delete el.props.detachedAt;
    if (typeof v === 'string' && v) el.props.text = v;
    return el;
  }

  function isDetached(doc, elId) {
    var el = findById(doc, elId);
    return !!(el && el.props && el.props.detached);
  }

  function detachedFields(doc) {
    var out = [];
    eachEl(doc, function (el) {
      if (el && el.props && el.props.field && el.props.detached) out.push(el.props.field);
    });
    return out;
  }

  /**
   * Replace a template's invented sample person with the real one.
   *
   * Templates ship with "Alex Morgan · VP of Operations" and a paragraph of
   * fabricated biography. Leaving any of it in place hands someone a page that
   * makes FALSE CLAIMS ABOUT THEM, on a URL they are about to send to
   * recruiters — so every visible line of sample prose is either replaced with
   * something true or removed outright.
   *
   * This lives here, next to the derivation, because there is more than one way
   * into a template: the server generates a starter site, and the editor swaps
   * templates on an existing one. When this logic lived only on the server, the
   * editor's swap adopted the raw template and published Alex Morgan under the
   * user's own address. One implementation, shared, is the only version of this
   * that cannot be skipped by whichever path someone happens to take.
   */
  function fillFromResume(doc, text) {
    if (!doc || !Array.isArray(doc.pages)) return doc;

    tagFields(doc);
    // force: the template's sample prose is not a user edit, so it is replaced
    // even though nothing is detached yet.
    syncFromResume(doc, text, { force: true });

    var vals = deriveFields(text);

    // Anything we could not derive would otherwise keep the template's invented
    // copy. Blank it, then drop the empty element rather than leave a hole.
    doc.pages.forEach(function (pg) {
      var hero = (pg.sections || [])[0];
      if (!hero) return;
      (hero.els || []).forEach(function (el) {
        var f = el.props && el.props.field;
        if (f && !vals[f]) el.props.text = '';
      });
    });
    doc.pages.forEach(function (pg) {
      (pg.sections || []).forEach(function (s) {
        s.els = (s.els || []).filter(function (el) {
          return !(['heading', 'subheading', 'paragraph'].indexOf(el.type) >= 0
            && el.props && el.props.text === '');
        });
      });
    });

    if (doc.pages[0] && doc.pages[0].seo && vals.name) {
      doc.pages[0].seo.title = vals.name;
      doc.pages[0].seo.description = vals.summary
        ? vals.summary.slice(0, 160)
        : vals.name + (vals.subtitle ? ' — ' + vals.subtitle : '');
    }
    return doc;
  }

  // ── Section ordering and removal ──────────────────────────────────────────
  // Removing a section takes it off the SITE. The resume is a separate store
  // and is never touched by any of this.

  function moveSection(doc, pageIdx, secId, delta) {
    var page = (doc && doc.pages || [])[pageIdx || 0];
    if (!page || !Array.isArray(page.sections)) return false;
    var i = page.sections.findIndex(function (s) { return s && s.id === secId; });
    if (i < 0) return false;
    var j = i + (delta < 0 ? -1 : 1);
    if (j < 0 || j >= page.sections.length) return false;
    var tmp = page.sections[i];
    page.sections[i] = page.sections[j];
    page.sections[j] = tmp;
    return true;
  }

  function deleteSection(doc, pageIdx, secId) {
    var page = (doc && doc.pages || [])[pageIdx || 0];
    if (!page || !Array.isArray(page.sections)) return false;
    // Never leave a page with nothing on it — a blank page is a dead end for
    // the visitor and looks like a bug to the owner.
    if (page.sections.length <= 1) return false;
    var i = page.sections.findIndex(function (s) { return s && s.id === secId; });
    if (i < 0) return false;
    page.sections.splice(i, 1);
    return true;
  }

  return {
    FIELDS: FIELDS,
    deriveFields: deriveFields,
    tagFields: tagFields,
    syncFromResume: syncFromResume,
    fillFromResume: fillFromResume,
    applyEdit: applyEdit,
    resetField: resetField,
    isDetached: isDetached,
    detachedFields: detachedFields,
    findField: findField,
    findById: findById,
    moveSection: moveSection,
    deleteSection: deleteSection,
  };
}));
