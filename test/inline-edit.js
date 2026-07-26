#!/usr/bin/env node
/**
 * INLINE EDITING — edit detaches, reset re-syncs.
 *
 * The rule: the site follows the resume until the user edits a field on the
 * site. From that moment the site owns that field, and later resume updates
 * leave it alone. Clicking "reset to my resume" hands it back.
 *
 * The failure this guards against is silent and expensive: someone renames
 * themselves on their site, updates their resume a week later, and the site
 * quietly throws their edit away. They would have no reason to look.
 *
 * The second rule: editing the SITE never writes to the RESUME. The resume
 * store is not touched by anything here.
 *
 * Usage: node test/inline-edit.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-inline-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';

const SF = require('../public/site-fields.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const RESUME_V1 = [
  'Maya Chen',
  'maya@example.com | Seattle, WA | linkedin.com/in/mayachen',
  '',
  'SUMMARY',
  'Senior product manager with eight years shipping data products.',
  '',
  'EXPERIENCE',
  'Senior Product Manager, Northwind Data | 2021-Present',
  '• Cut infrastructure cost 30%',
  '',
  'SKILLS',
  'SQL, experimentation',
].join('\n');

// A later version of the same resume: new city, new title, new summary.
const RESUME_V2 = RESUME_V1
  .replace('Seattle, WA', 'Austin, TX')
  .replace('Senior Product Manager, Northwind Data', 'Director of Product, Northwind Data')
  .replace('Senior product manager with eight years shipping data products.',
           'Product leader with a decade building data platforms.');

const DOC = () => SF.tagFields({
  v: 2, lang: 'en', theme: { primary: '6366F1', accent: '8B5CF6' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true, seo: {},
    sections: [
      {
        id: 'hero', h: 500, bg: { type: 'color', value: '#ffffff' },
        els: [
          { id: 'nav1', type: 'nav', x: 80, y: 30, w: 900, h: 40, props: {} },
          { id: 'h1', type: 'heading', x: 80, y: 140, w: 700, h: 90, props: { text: 'Placeholder Name' } },
          { id: 's1', type: 'subheading', x: 80, y: 250, w: 600, h: 40, props: { text: 'Placeholder Role' } },
          { id: 'p1', type: 'paragraph', x: 80, y: 310, w: 560, h: 70, props: { text: 'Placeholder bio.' } },
          { id: 'img1', type: 'image', x: 820, y: 140, w: 280, h: 280, props: { ph: { from: '6366F1', to: '8B5CF6' } } },
        ],
      },
      { id: 'work', h: 400, bg: { type: 'color', value: '#f8fafc' },
        els: [{ id: 'r1', type: 'resume', x: 80, y: 60, w: 1040, h: 300, props: {} }] },
      { id: 'contact', h: 300, bg: { type: 'color', value: '#ffffff' },
        els: [{ id: 'f1', type: 'form', x: 80, y: 60, w: 500, h: 290, props: {} }] },
    ],
  }],
});

// ── Derivation ──────────────────────────────────────────────────────────────
const v1 = SF.deriveFields(RESUME_V1);
check('name comes off the first line', v1.name === 'Maya Chen', v1.name);
check('role comes off the first job title', v1.role === 'Senior Product Manager', v1.role);
check('location skips the email and the profile URL', v1.location === 'Seattle, WA', v1.location);
check('subtitle joins role and location', v1.subtitle === 'Senior Product Manager · Seattle, WA', v1.subtitle);
check('summary comes off the SUMMARY section',
  v1.summary === 'Senior product manager with eight years shipping data products.', v1.summary);

// Nothing derivable must not throw or invent.
const empty = SF.deriveFields('');
check('an empty resume derives empty fields, not junk',
  empty.name === '' && empty.subtitle === '' && empty.summary === '');

// ── Fields are found by meaning, not position ───────────────────────────────
const tagged = DOC();
check('the hero heading is tagged as the name', SF.findField(tagged, 'name').id === 'h1');
check('the hero subheading is tagged as the subtitle', SF.findField(tagged, 'subtitle').id === 's1');
check('the hero paragraph is tagged as the summary', SF.findField(tagged, 'summary').id === 'p1');

// Reordering sections must not re-point the fields at different elements.
const reordered = DOC();
SF.moveSection(reordered, 0, 'hero', 1);
check('reordering does not re-point the name field', SF.findField(reordered, 'name').id === 'h1');

// ── First sync fills everything ─────────────────────────────────────────────
const doc = DOC();
SF.syncFromResume(doc, RESUME_V1);
check('sync writes the name', SF.findById(doc, 'h1').props.text === 'Maya Chen');
check('sync writes the subtitle', SF.findById(doc, 's1').props.text === 'Senior Product Manager · Seattle, WA');
check('sync writes the summary', SF.findById(doc, 'p1').props.text.startsWith('Senior product manager'));
check('nothing is detached yet', SF.detachedFields(doc).length === 0);

// ── THE RULE: edit detaches ─────────────────────────────────────────────────
SF.applyEdit(doc, 'h1', 'Maya J. Chen');
check('an edit takes effect', SF.findById(doc, 'h1').props.text === 'Maya J. Chen');
check('an edit detaches that field', SF.isDetached(doc, 'h1'));
check('only the edited field is detached', JSON.stringify(SF.detachedFields(doc)) === '["name"]');

// A later resume update must not touch it — this is the whole promise.
const written = SF.syncFromResume(doc, RESUME_V2);
check('a resume update does NOT overwrite the edited name',
  SF.findById(doc, 'h1').props.text === 'Maya J. Chen', SF.findById(doc, 'h1').props.text);
check('a resume update DOES update untouched fields',
  SF.findById(doc, 's1').props.text === 'Director of Product · Austin, TX', SF.findById(doc, 's1').props.text);
check('the summary follows the resume too',
  SF.findById(doc, 'p1').props.text === 'Product leader with a decade building data platforms.');
check('sync reports what it wrote', JSON.stringify(written.sort()) === '["subtitle","summary"]', JSON.stringify(written));

// Repeated syncs stay a no-op on the detached field.
SF.syncFromResume(doc, RESUME_V2);
SF.syncFromResume(doc, RESUME_V1);
check('the edited field survives repeated resume updates', SF.findById(doc, 'h1').props.text === 'Maya J. Chen');

// ── Reset hands it back ─────────────────────────────────────────────────────
SF.resetField(doc, 'h1', RESUME_V2);
check('reset restores the resume value', SF.findById(doc, 'h1').props.text === 'Maya Chen');
check('reset re-attaches the field', !SF.isDetached(doc, 'h1'));
check('after reset, resume updates flow again', (() => {
  SF.applyEdit(doc, 'h1', 'temp'); SF.resetField(doc, 'h1', RESUME_V1);
  const before = SF.findById(doc, 'h1').props.text;
  SF.syncFromResume(doc, RESUME_V2.replace('Maya Chen', 'Maya Chen-Alvarez'));
  return before === 'Maya Chen' && SF.findById(doc, 'h1').props.text === 'Maya Chen-Alvarez';
})());

// Editing a non-field element (a heading further down the page) is a plain
// edit — there is nothing to detach from.
const plain = DOC();
plain.pages[0].sections[1].els.push({ id: 'x1', type: 'subheading', x: 80, y: 10, w: 300, h: 34, props: { text: 'Work' } });
SF.applyEdit(plain, 'x1', 'Selected work');
check('editing a non-resume element just edits it', SF.findById(plain, 'x1').props.text === 'Selected work');
check('a non-resume element is not marked detached', !SF.findById(plain, 'x1').props.detached);

// ── Sections: reorder and remove ────────────────────────────────────────────
const sd = DOC();
const order = () => sd.pages[0].sections.map(s => s.id).join(',');
check('sections start in document order', order() === 'hero,work,contact');
check('move down works', SF.moveSection(sd, 0, 'hero', 1) && order() === 'work,hero,contact');
check('move up works', SF.moveSection(sd, 0, 'hero', -1) && order() === 'hero,work,contact');
check('cannot move the first section up', !SF.moveSection(sd, 0, 'hero', -1) && order() === 'hero,work,contact');
check('cannot move the last section down', !SF.moveSection(sd, 0, 'contact', 1) && order() === 'hero,work,contact');
check('an unknown section is refused', !SF.moveSection(sd, 0, 'nope', 1));

check('delete removes the section', SF.deleteSection(sd, 0, 'work') && order() === 'hero,contact');
check('delete leaves the resume untouched', !!SF.findById(sd, 'h1'));
// A page emptied to nothing is a dead end for the visitor and reads as a bug.
SF.deleteSection(sd, 0, 'contact');
check('the last section cannot be deleted', sd.pages[0].sections.length === 1);

// ── Editing the site never touches the resume store ─────────────────────────
const { app } = require('../server.js');
const Database = require('better-sqlite3');
const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('i@x.com', 'ivy', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tok', 'i@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('i@x.com', 'c');
db.prepare('INSERT INTO saved_resumes (email,title,content,created_at) VALUES (?,?,?,?)')
  .run('i@x.com', 'r', RESUME_V1, Date.now());

const server = app.listen(0, async () => {
  const B = `http://127.0.0.1:${server.address().port}`;
  const AJ = { Authorization: 'Bearer tok', 'Content-Type': 'application/json' };
  try {
    const gen = await (await fetch(`${B}/api/personal-site/autogen`, { method: 'POST', headers: AJ })).json();
    check('a generated site tags its fields',
      SF.findField(gen.config, 'name') && SF.findField(gen.config, 'subtitle'));
    check('a generated site starts fully attached', SF.detachedFields(gen.config).length === 0);

    // Edit the name on the site and save.
    const edited = JSON.parse(JSON.stringify(gen.config));
    SF.applyEdit(edited, SF.findField(edited, 'name').id, 'M. Chen');
    await fetch(`${B}/api/personal-site`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: gen.subdomain, text: RESUME_V1, name: 'Maya Chen', config: edited, publish: true }),
    });

    const page = await (await fetch(`${B}/site/${gen.subdomain}`)).text();
    check('the edited name is what visitors see', page.includes('M. Chen'));

    // THE OTHER RULE: the resume store is untouched.
    const resumes = await (await fetch(`${B}/api/resumes`, { headers: AJ })).json();
    check('editing the site did not change the saved resume',
      resumes.resumes[0].content === RESUME_V1);
    check('the resume still says the original name', resumes.resumes[0].content.includes('Maya Chen'));

    // ── The editable render ─────────────────────────────────────────────
    // Edit hooks exist only when asked for. The published page must never
    // carry them — they would expose element ids and ship dead editor code to
    // every visitor.
    const prevBody = { subdomain: gen.subdomain, text: RESUME_V1, name: 'Maya Chen', config: edited };
    const plainPrev = await (await fetch(`${B}/api/personal-site/preview`, {
      method: 'POST', headers: AJ, body: JSON.stringify(prevBody),
    })).text();
    const editPrev = await (await fetch(`${B}/api/personal-site/preview`, {
      method: 'POST', headers: AJ, body: JSON.stringify(Object.assign({ editable: true }, prevBody)),
    })).text();

    check('an ordinary preview carries no edit hooks',
      !plainPrev.includes('data-el=') && !plainPrev.includes('sd-ed-bar'));
    check('the published page carries no edit hooks',
      !page.includes('data-el=') && !page.includes('sd-ed-bar'));
    check('an editable preview tags every element', /data-el="[^"]+"/.test(editPrev));
    check('an editable preview tags element types', /data-type="heading"/.test(editPrev));
    check('an editable preview tags sections', /data-sec="[^"]+" data-idx="0"/.test(editPrev));
    check('an editable preview marks which fields are which', /data-field="name"/.test(editPrev));
    check('an editable preview marks a detached field', /data-detached="1"/.test(editPrev));
    check('the edit layer ships only when editing',
      editPrev.includes('Reset to my resume') && !plainPrev.includes('Reset to my resume'));

    // The layer must not navigate away or leak the document — it posts out.
    check('the edit layer posts changes rather than mutating', editPrev.includes('parent.postMessage'));

    // THE EDIT LAYER IS GENERATED JAVASCRIPT, and a template literal that emits
    // JavaScript is one stray backslash away from shipping a syntax error that
    // only appears in a browser console. Parse every script it emits.
    let scriptErr = '';
    const scripts = [...editPrev.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    check('the editable page emits at least one script', scripts.length > 0);
    for (const src of scripts) {
      try { new Function(src); } catch (e) { scriptErr = e.message; break; }
    }
    check('every emitted script is valid JavaScript', !scriptErr, scriptErr);

    // And the two escapes that actually broke: a regex literal cannot contain a
    // real newline.
    check('emitted regexes are escaped, not literal newlines',
      /replace\(\/\\u00a0\/g/.test(editPrev) && !/replace\(\/\n/.test(editPrev));

    // ── Undo / redo chips ───────────────────────────────────────────────
    // The safety net for Delete, which is immediate.
    check('the editable page carries the chip layer',
      editPrev.includes('sd-ed-chips') && editPrev.includes('↩️ Undo') && editPrev.includes('↪️ Redo'));
    check('chips are not in the published page', !page.includes('sd-ed-chips'));
    check('chips fade rather than vanish', /\.sd-ed-chips\{[^}]*transition:opacity/.test(editPrev));
    check('the wrapper lets clicks through to the page beneath',
      /\.sd-ed-chips\{[^}]*pointer-events:none/.test(editPrev) && /\.sd-ed-chips button\{[^}]*pointer-events:auto/.test(editPrev));
    check('hovering pauses the countdown',
      editPrev.includes('onmouseenter') && editPrev.includes('onmouseleave'));
    check('chips are bigger on a phone', /@media\(max-width:820px\)\{\.sd-ed-chips/.test(editPrev));
    check('a deleted section falls back to its old position',
      editPrev.includes("typeof d.idx === 'number'"));
    check('chips can anchor to an element or a section',
      editPrev.includes('data-el="') && editPrev.includes('section[data-sec="'));
    check('the chip anchor is whitelisted, not escaped',
      editPrev.includes("replace(/[^A-Za-z0-9_-]/g, '')"));

    // ── "I want to move something" ──────────────────────────────────────
    check('the edit layer answers the help panel', editPrev.includes("m.__rtHelp === 1"));
    check('it shows every move control at once, pulsing', /sd-ed-bar--pulse/.test(editPrev)
      && /@keyframes sd-pulse/.test(editPrev));
    check('and brings the first one into view', editPrev.includes('scrollIntoView'));
    check('the hint bars clean themselves up', editPrev.includes('sd-ed-bar--hint'));
    check('none of the help wiring reaches visitors',
      !page.includes('__rtHelp') && !page.includes('sd-ed-bar--pulse'));

    // The detach survives a round trip through the database.
    const back = await (await fetch(`${B}/api/personal-site`, { headers: AJ })).json();
    const cfg = JSON.parse(back.site.config);
    check('the detach survives being saved and reloaded',
      SF.isDetached(cfg, SF.findField(cfg, 'name').id));
    check('and a later sync still respects it', (() => {
      SF.syncFromResume(cfg, RESUME_V2);
      return SF.findField(cfg, 'name').props.text === 'M. Chen';
    })());
  } catch (e) {
    failures++;
    console.error('FAIL  unexpected error —', e && e.stack);
  }

  console.log(`\n${failures ? 'FAILED' : 'ALL PASS'} (${failures} failure${failures === 1 ? '' : 's'})`);
  server.close();
  db.close();
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(failures ? 1 : 0);
});
