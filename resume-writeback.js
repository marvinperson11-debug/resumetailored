/**
 * WRITE-BACK — pushing a website edit into the saved resume.
 *
 * This is the only code in the product that edits the document people apply to
 * jobs with, so it is built around one rule:
 *
 *   IF THE FIELD CANNOT BE LOCATED WITH CERTAINTY, WRITE NOTHING.
 *
 * Not "write it somewhere plausible", not "append it at the end". A resume that
 * quietly gains a stray line — discovered at the worst possible moment — is far
 * more damaging than a feature that sometimes says "couldn't do that
 * automatically". Every function here returns either an exact replacement or a
 * refusal with a reason, and never a best-effort guess.
 *
 * Certainty means: the text currently in that position must be exactly what the
 * site had before the user edited it. If the resume has been changed since, or
 * the field was never derivable from it in the first place, the anchor does not
 * match and the write is refused. That check is what makes this safe on resumes
 * whose shape we did not anticipate — an unrecognised layout simply fails to
 * match rather than getting mangled.
 *
 * The locating logic mirrors public/site-fields.js `deriveFields`, because a
 * write must undo exactly the read that produced the value. Two independent
 * notions of "where the summary is" would eventually disagree, and the disagreement
 * would show up as a corrupted document.
 */
'use strict';

var SUMMARY_RE = /^(summary|profile|objective|about)\b/i;
var EXP_RE = /^(experience|work experience|employment)\b/i;
// An ALL-CAPS line is a section heading — the same rule deriveFields stops on.
var HEADING_RE = /^[A-Z][A-Z\s&]{3,}$/;

var FIELDS = ['name', 'role', 'location', 'summary'];

function _split(text) {
  return String(text == null ? '' : text).split('\n');
}
function _indexOf(lines, re) {
  for (var i = 0; i < lines.length; i++) if (re.test(lines[i].trim())) return i;
  return -1;
}
function _clean(v) {
  // A value going into a resume must not be able to invent structure. Newlines
  // would split one field into two lines and change what every later read sees.
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function _fail(reason) { return { ok: false, reason: reason }; }

/**
 * The name is the first non-empty line — the one convention every resume
 * follows, and the same anchor the renderer and the generator already use.
 */
function _writeName(lines, previous, next) {
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (lines[i].trim() !== previous.trim()) return _fail('anchor_mismatch');
    lines[i] = lines[i].replace(lines[i].trim(), next);
    return { ok: true, line: i };
  }
  return _fail('not_found');
}

/**
 * The location is one segment of the contact line under the name. It is replaced
 * only when it appears EXACTLY once: "Seattle" occurring twice gives us no way to
 * know which one the user meant, and picking either would be a guess.
 */
function _writeLocation(lines, previous, next) {
  var at = -1;
  for (var i = 0; i < lines.length; i++) { if (lines[i].trim()) { at = i; break; } }
  if (at < 0 || at + 1 >= lines.length) return _fail('not_found');
  var contact = lines[at + 1];
  var parts = contact.split(/([|·•])/);              // keep separators
  var hits = [];
  for (var p = 0; p < parts.length; p++) {
    if (parts[p].trim() === previous.trim() && !/^[|·•]$/.test(parts[p])) hits.push(p);
  }
  if (hits.length !== 1) return _fail(hits.length ? 'ambiguous' : 'anchor_mismatch');
  parts[hits[0]] = parts[hits[0]].replace(previous.trim(), next);
  lines[at + 1] = parts.join('');
  return { ok: true, line: at + 1 };
}

/**
 * The role is the leading title of the first entry under EXPERIENCE. Only that
 * prefix is replaced — the employer and dates on the rest of the line are the
 * user's facts and are left exactly as they are.
 */
function _writeRole(lines, previous, next) {
  var expAt = _indexOf(lines, EXP_RE);
  if (expAt < 0) return _fail('no_section');
  for (var j = expAt + 1; j < Math.min(lines.length, expAt + 6); j++) {
    var l = lines[j].trim();
    if (!l || /^[•\-*]/.test(l)) continue;
    var head = l.split(/[|,–—]/)[0].trim();
    if (head !== previous.trim()) return _fail('anchor_mismatch');
    lines[j] = lines[j].replace(head, next);
    return { ok: true, line: j };
  }
  return _fail('not_found');
}

/**
 * The summary is the body under SUMMARY / PROFILE / OBJECTIVE / ABOUT — one or
 * more lines, ending at a blank line or the next ALL-CAPS heading. The whole
 * body is replaced by the new text as a single line, and only when the body
 * currently reads as exactly what the site had.
 *
 * deriveFields joins the body with spaces and truncates at 400 characters, so a
 * long summary reaches the site shortened. Comparing the truncated site value
 * against the full resume body would never match, and the user would be told
 * their resume "couldn't be updated" on every long summary — so the anchor is
 * compared the same way it was derived.
 */
function _writeSummary(lines, previous, next) {
  var at = _indexOf(lines, SUMMARY_RE);
  if (at < 0) return _fail('no_section');
  var body = [], from = -1, to = -1;
  for (var k = at + 1; k < lines.length; k++) {
    var s = lines[k].trim();
    if (!s) { if (body.length) break; continue; }
    if (HEADING_RE.test(s)) break;
    if (from < 0) from = k;
    to = k;
    body.push(s.replace(/^[•\-*]\s*/, ''));
  }
  if (from < 0) return _fail('not_found');
  // Compared exactly as it was derived, then trimmed on both sides: a cut at
  // 400 characters can land mid-word or on a space, and the value coming back
  // from the site has been through whitespace normalisation on the way.
  var joined = body.join(' ').slice(0, 400).trim();
  if (joined !== String(previous).slice(0, 400).trim()) return _fail('anchor_mismatch');
  lines.splice(from, to - from + 1, next);
  return { ok: true, line: from };
}

var WRITERS = { name: _writeName, location: _writeLocation, role: _writeRole, summary: _writeSummary };

/**
 * Replace one field in a resume.
 *
 * @param {string} text      the saved resume
 * @param {string} field     name | role | location | summary
 * @param {string} previous  what the site showed before the edit — the anchor
 * @param {string} next      what the user typed
 * @returns {{ok:true,text:string}|{ok:false,reason:string}}
 */
function writeField(text, field, previous, next) {
  if (FIELDS.indexOf(field) < 0) return _fail('unknown_field');
  var prev = _clean(previous);
  var val = _clean(next);
  if (!prev) return _fail('no_anchor');      // nothing to find; never guess
  if (!val) return _fail('empty_value');     // deleting a resume line is not a sync
  if (!String(text || '').trim()) return _fail('no_resume');
  if (prev === val) return { ok: true, text: String(text), unchanged: true };

  var lines = _split(text);
  var r = WRITERS[field](lines, prev, val);
  if (!r.ok) return r;
  return { ok: true, text: lines.join('\n'), line: r.line };
}

/**
 * Apply several fields at once, all or nothing.
 *
 * A site edit can carry two facts — the subtitle is "role · location" — and
 * writing one of them while refusing the other would leave the resume saying
 * something the user never approved. Either both land or neither does.
 */
function writeFields(text, edits) {
  var out = String(text || '');
  var written = [];
  for (var i = 0; i < edits.length; i++) {
    var e = edits[i];
    var r = writeField(out, e.field, e.previous, e.next);
    if (!r.ok) return { ok: false, reason: r.reason, field: e.field };
    if (!r.unchanged) written.push(e.field);
    out = r.text;
  }
  return { ok: true, text: out, written: written };
}

/**
 * Does this resume still say what the site says?
 *
 * Used for the Back Office's per-resume status. Only fields the user has taken
 * ownership of are compared: a field still following the resume cannot be out of
 * step with it by definition.
 */
function diffFields(text, siteValues) {
  var SF = require('./public/site-fields.js');
  var derived = SF.deriveFields(text);
  var out = [];
  Object.keys(siteValues || {}).forEach(function (f) {
    var want = _clean(siteValues[f]);
    if (!want) return;
    var have = _clean(derived[f]);
    if (have !== want) out.push(f);
  });
  return out;
}

module.exports = { writeField: writeField, writeFields: writeFields, diffFields: diffFields, FIELDS: FIELDS };
