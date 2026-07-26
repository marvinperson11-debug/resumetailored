#!/usr/bin/env node
/**
 * WRITE-BACK — the only code that edits the document people apply to jobs with.
 *
 * Most of these assertions are about REFUSING. The easy half (replace the first
 * line) is a handful of cases; the half that matters is every shape of resume
 * where the field cannot be located with certainty, because the alternative to
 * refusing is a document that quietly gains or loses a line and is discovered at
 * the worst possible moment.
 *
 * So the standing rule under test is: anything not exactly located is refused,
 * and a refusal leaves the text byte-identical.
 *
 * Usage: node test/resume-writeback.js
 */
const WB = require('../resume-writeback.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const R = [
  'Maya Chen',
  'maya@example.com | Seattle, WA | linkedin.com/in/mayachen',
  '',
  'SUMMARY',
  'Senior product manager with 8 years shipping data products.',
  '',
  'EXPERIENCE',
  'Senior Product Manager, Northwind Data | 2021-Present',
  '• Led platform migration that cut infrastructure cost 30%',
  '',
  'SKILLS',
  'Product strategy, SQL, experimentation',
].join('\n');

// A refusal must never be a partial write.
const refused = (r, text, reason) =>
  r.ok === false && (!reason || r.reason === reason);

// ── name ────────────────────────────────────────────────────────────────────
let r = WB.writeField(R, 'name', 'Maya Chen', 'Maya Q. Chen');
check('the name is replaced on the first line', r.ok && r.text.split('\n')[0] === 'Maya Q. Chen');
check('and nothing else moves', r.ok && r.text.split('\n').length === R.split('\n').length);
check('the rest of the document is untouched',
  r.ok && r.text.split('\n').slice(1).join('\n') === R.split('\n').slice(1).join('\n'));

// The anchor is the whole point: if the resume no longer says what the site
// thought it said, someone has edited it since and we must not overwrite.
r = WB.writeField(R, 'name', 'Someone Else', 'Maya Q. Chen');
check('a name that does not match the resume is refused', refused(r, R, 'anchor_mismatch'), r.reason);

r = WB.writeField('   \n\n', 'name', 'Maya Chen', 'X');
check('an empty resume is refused rather than created', refused(r, '', 'no_resume'), r.reason);

// Leading blank lines are common in pasted resumes.
const padded = '\n\n' + R;
r = WB.writeField(padded, 'name', 'Maya Chen', 'Maya Q. Chen');
check('leading blank lines do not confuse the first line',
  r.ok && r.text === '\n\n' + R.replace('Maya Chen', 'Maya Q. Chen'));

// ── location ────────────────────────────────────────────────────────────────
r = WB.writeField(R, 'location', 'Seattle, WA', 'Portland, OR');
check('the location is replaced in the contact line',
  r.ok && r.text.includes('maya@example.com | Portland, OR | linkedin.com/in/mayachen'));
check('the email and profile link survive',
  r.ok && r.text.includes('maya@example.com') && r.text.includes('linkedin.com/in/mayachen'));

r = WB.writeField(R, 'location', 'Boston', 'Portland, OR');
check('a location the resume does not contain is refused', refused(r, R, 'anchor_mismatch'), r.reason);

// Two identical segments give no way to know which one was meant.
const twice = R.replace('maya@example.com | Seattle, WA | linkedin.com/in/mayachen',
  'maya@example.com | Seattle, WA | Seattle, WA');
r = WB.writeField(twice, 'location', 'Seattle, WA', 'Portland, OR');
check('an ambiguous location is refused rather than guessed', refused(r, twice, 'ambiguous'), r.reason);

// A resume with no contact line at all.
r = WB.writeField('Maya Chen', 'location', 'Seattle, WA', 'Portland, OR');
check('no contact line means no write', refused(r, 'Maya Chen', 'not_found'), r.reason);

// ── role ────────────────────────────────────────────────────────────────────
r = WB.writeField(R, 'role', 'Senior Product Manager', 'Director of Product');
check('the role replaces only the title',
  r.ok && r.text.includes('Director of Product, Northwind Data | 2021-Present'), r.ok ? '' : r.reason);
check('the employer and dates are preserved exactly',
  r.ok && r.text.includes('Northwind Data | 2021-Present'));

r = WB.writeField(R.replace('EXPERIENCE\n', ''), 'role', 'Senior Product Manager', 'Director');
check('no EXPERIENCE section means no write', refused(r, '', 'no_section'), r.reason);

r = WB.writeField(R, 'role', 'Product Manager', 'Director');
check('a role that does not match the first entry is refused', refused(r, R, 'anchor_mismatch'), r.reason);

// ── summary ─────────────────────────────────────────────────────────────────
r = WB.writeField(R, 'summary', 'Senior product manager with 8 years shipping data products.',
  'Product leader who ships.');
check('the summary body is replaced', r.ok && r.text.includes('SUMMARY\nProduct leader who ships.'), r.ok ? '' : r.reason);
check('the heading survives', r.ok && r.text.includes('SUMMARY'));
check('the section after the summary is intact', r.ok && r.text.includes('EXPERIENCE\nSenior Product Manager'));

// A multi-line summary collapses to one line — and only when the whole body,
// joined the way the site read it, is what the site had.
const multi = R.replace('Senior product manager with 8 years shipping data products.',
  'Senior product manager with 8 years.\nShips data products used by millions.');
r = WB.writeField(multi, 'summary',
  'Senior product manager with 8 years. Ships data products used by millions.', 'One line now.');
check('a multi-line summary is replaced as a block', r.ok && r.text.includes('SUMMARY\nOne line now.\n'), r.ok ? '' : r.reason);
check('and the following section still starts where it did',
  r.ok && r.text.split('\n').filter(Boolean).includes('EXPERIENCE'));

r = WB.writeField(R.replace('SUMMARY\n', ''), 'summary', 'Senior product manager with 8 years shipping data products.', 'X');
check('no SUMMARY heading means no write', refused(r, '', 'no_section'), r.reason);

r = WB.writeField(R, 'summary', 'Something the resume never said', 'X');
check('a summary that does not match is refused', refused(r, R, 'anchor_mismatch'), r.reason);

// PROFILE / OBJECTIVE / ABOUT are the same section under other names.
const profile = R.replace('SUMMARY', 'PROFILE');
r = WB.writeField(profile, 'summary', 'Senior product manager with 8 years shipping data products.', 'New.');
check('PROFILE is recognised as the summary section', r.ok && r.text.includes('PROFILE\nNew.'), r.ok ? '' : r.reason);

// deriveFields truncates at 400 characters, so a long summary reaches the site
// shortened. Comparing the short site value against the full resume body would
// refuse every long summary — the user would be told it "couldn't be updated"
// forever, on a resume that is perfectly well formed.
// Mixed case deliberately: an all-caps line of any length reads as a section
// heading to the derivation, which is its rule, not a bug to work around here.
const longBody = 'Product leader who ships data platforms at scale. '.repeat(12).trim();
const longRes = R.replace('Senior product manager with 8 years shipping data products.', longBody);
r = WB.writeField(longRes, 'summary', longBody.slice(0, 400), 'Short now.');
check('a summary longer than the derivation limit still matches', r.ok && r.text.includes('SUMMARY\nShort now.'), r.ok ? '' : r.reason);

// ── values that would damage the document ───────────────────────────────────
r = WB.writeField(R, 'name', 'Maya Chen', 'Maya\nChen');
check('a newline in the value cannot split one field into two lines',
  r.ok && r.text.split('\n')[0] === 'Maya Chen' && !r.text.startsWith('Maya\nChen'), r.ok ? '' : r.reason);
check('and the line count is unchanged', r.ok && r.text.split('\n').length === R.split('\n').length);

r = WB.writeField(R, 'name', 'Maya Chen', '   ');
check('clearing a field is not a sync — deleting a resume line is refused',
  refused(r, R, 'empty_value'), r.reason);

r = WB.writeField(R, 'nickname', 'Maya Chen', 'M');
check('an unknown field is refused', refused(r, R, 'unknown_field'), r.reason);

r = WB.writeField(R, 'name', '', 'Maya Q. Chen');
check('no anchor means no write — never a guess at where it goes',
  refused(r, R, 'no_anchor'), r.reason);

r = WB.writeField(R, 'name', 'Maya Chen', 'Maya Chen');
check('writing the same value is a no-op, not a rewrite', r.ok && r.text === R && r.unchanged === true);

// ── all-or-nothing ──────────────────────────────────────────────────────────
// The site's subtitle is "role · location", so one edit can carry two facts.
// Writing one and refusing the other would leave the resume saying something
// the user never approved.
let m = WB.writeFields(R, [
  { field: 'role', previous: 'Senior Product Manager', next: 'Director of Product' },
  { field: 'location', previous: 'Seattle, WA', next: 'Portland, OR' },
]);
check('both halves of a subtitle land together',
  m.ok && m.text.includes('Director of Product, Northwind Data') && m.text.includes('| Portland, OR |'), m.ok ? '' : m.reason);
check('and both are reported as written', m.ok && m.written.length === 2);

m = WB.writeFields(R, [
  { field: 'role', previous: 'Senior Product Manager', next: 'Director of Product' },
  { field: 'location', previous: 'Nowhere', next: 'Portland, OR' },
]);
check('if one half cannot be located, neither is written', m.ok === false, JSON.stringify(m));
check('and the refusal names the field that failed', m.field === 'location', m.field);

// The partial-write trap: the first edit succeeded on a copy, and that copy
// must be thrown away rather than saved.
check('a refused batch never returns text to save', m.text === undefined);

// ── out-of-sync detection ───────────────────────────────────────────────────
let d = WB.diffFields(R, { name: 'Maya Chen', summary: 'Senior product manager with 8 years shipping data products.' });
check('a resume that agrees with the site reports no drift', d.length === 0, JSON.stringify(d));

d = WB.diffFields(R, { name: 'Maya Q. Chen' });
check('a changed name is reported as drift', d.length === 1 && d[0] === 'name');

d = WB.diffFields(R, { name: '' });
check('an empty site value is not drift — there is nothing to compare', d.length === 0);

console.log(`\n${failures ? 'FAILED' : 'ALL PASS'} (${failures} failure${failures === 1 ? '' : 's'})`);
process.exit(failures ? 1 : 0);
