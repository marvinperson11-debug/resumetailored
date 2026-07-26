#!/usr/bin/env node
/**
 * RESUME SYNC (Feature C) — the offer to carry a website edit back into the
 * saved resume, over HTTP.
 *
 * resume-writeback.js proves the surgery. This proves the route around it:
 * that the site's "headline" is split back into the two resume facts it was
 * made from, that a refusal changes nothing, that one user cannot write into
 * another's documents, and that the Back Office's per-resume status only
 * claims something it can actually know.
 *
 * Usage: node test/resume-sync.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-sync-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
const mkUser = (email, token, username) => {
  db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run(email, username, 'x');
  db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run(token, email);
  db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run(email, 'c_' + username);
};
mkUser('a@x.com', 'tokA', 'alice');
mkUser('b@x.com', 'tokB', 'bob');

const RESUME = [
  'Alice Nakamura',
  'alice@example.com | Seattle, WA | linkedin.com/in/alicen',
  '',
  'SUMMARY',
  'Staff engineer with 10 years building payment systems.',
  '',
  'EXPERIENCE',
  'Staff Engineer, Northwind | 2020-Present',
  '• Cut p99 latency by 40%',
  '',
  'SKILLS',
  'Go, Postgres',
].join('\n');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const newResume = (email, text) => {
  db.prepare('DELETE FROM saved_resumes WHERE email = ?').run(email);
  db.prepare('INSERT INTO saved_resumes (email,title,content,created_at) VALUES (?,?,?,?)')
    .run(email, 'Application', text, Date.now());
  return db.prepare('SELECT id FROM saved_resumes WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email).id;
};
const resumeOf = (email) =>
  db.prepare('SELECT content FROM saved_resumes WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email).content;

const server = app.listen(0, async () => {
  const port = server.address().port;
  const B = `http://127.0.0.1:${port}`;
  const AJ = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
  const sync = (tok, body) => fetch(`${B}/api/resume-sync`, { method: 'POST', headers: AJ(tok), body: JSON.stringify(body) });

  try {
    check('signed out, nothing can be written',
      (await fetch(`${B}/api/resume-sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'name', previous: 'Alice Nakamura', next: 'A. Nakamura' }) })).status === 401);

    // ── name ────────────────────────────────────────────────────────────────
    newResume('a@x.com', RESUME);
    let d = await (await sync('tokA', { field: 'name', previous: 'Alice Nakamura', next: 'Alice M. Nakamura' })).json();
    check('a name edit reaches the resume', d.ok === true, JSON.stringify(d));
    check('and the first line is the only thing that changed',
      resumeOf('a@x.com') === RESUME.replace('Alice Nakamura', 'Alice M. Nakamura'));

    // ── the headline is two facts in one line ───────────────────────────────
    // The site shows "Staff Engineer · Seattle, WA". Those live in two
    // different places in the resume and must land in both.
    newResume('a@x.com', RESUME);
    d = await (await sync('tokA', {
      field: 'subtitle', previous: 'Staff Engineer · Seattle, WA', next: 'Principal Engineer · Portland, OR',
    })).json();
    let after = resumeOf('a@x.com');
    check('a headline edit writes both halves', d.ok === true, JSON.stringify(d));
    check('the job title changes in the experience section', after.includes('Principal Engineer, Northwind | 2020-Present'));
    check('the city changes in the contact line', after.includes('| Portland, OR |'));
    check('the employer and dates are untouched', after.includes('Northwind | 2020-Present'));
    check('the email and profile link are untouched',
      after.includes('alice@example.com') && after.includes('linkedin.com/in/alicen'));
    check('nothing else in the document moved', after.split('\n').length === RESUME.split('\n').length);

    // Only the half that changed is written. Rewriting the job title because
    // the city moved would put a title the user never touched into their
    // employment history.
    newResume('a@x.com', RESUME);
    d = await (await sync('tokA', {
      field: 'subtitle', previous: 'Staff Engineer · Seattle, WA', next: 'Staff Engineer · Portland, OR',
    })).json();
    check('changing only the city touches only the city',
      d.ok && d.written.length === 1 && d.written[0] === 'location', JSON.stringify(d));
    check('and the job title line is byte-identical',
      resumeOf('a@x.com').includes('Staff Engineer, Northwind | 2020-Present'));

    // A headline that no longer splits into the same two parts cannot be mapped
    // back — we would be guessing which half is the job and which is the city.
    newResume('a@x.com', RESUME);
    d = await (await sync('tokA', {
      field: 'subtitle', previous: 'Staff Engineer · Seattle, WA', next: 'Principal Engineer, Portland',
    })).json();
    check('a reshaped headline is refused rather than guessed', d.ok === false && d.reason === 'ambiguous', JSON.stringify(d));
    check('and the resume is untouched', resumeOf('a@x.com') === RESUME);

    // ── summary ─────────────────────────────────────────────────────────────
    newResume('a@x.com', RESUME);
    d = await (await sync('tokA', {
      field: 'summary', previous: 'Staff engineer with 10 years building payment systems.',
      next: 'Payments engineer who ships.',
    })).json();
    check('a summary edit reaches the resume', d.ok === true, JSON.stringify(d));
    check('the heading and the next section survive',
      resumeOf('a@x.com').includes('SUMMARY\nPayments engineer who ships.') &&
      resumeOf('a@x.com').includes('EXPERIENCE\nStaff Engineer, Northwind'));

    // ── REFUSING ────────────────────────────────────────────────────────────
    // The whole reason this feature is safe: a resume it cannot read is a
    // resume it does not write.
    const odd = 'Alice Nakamura\n\nI have worked in payments for ten years and would like to keep doing that.';
    newResume('a@x.com', odd);
    d = await (await sync('tokA', { field: 'summary', previous: 'Staff engineer with 10 years.', next: 'New summary.' })).json();
    check('a resume with no SUMMARY heading is refused', d.ok === false && d.reason === 'no_section', JSON.stringify(d));
    check('and it is left exactly as it was', resumeOf('a@x.com') === odd);

    d = await (await sync('tokA', { field: 'name', previous: 'Someone Else', next: 'X' })).json();
    check('a name the resume does not contain is refused', d.ok === false && d.reason === 'anchor_mismatch', JSON.stringify(d));
    check('and it is still left exactly as it was', resumeOf('a@x.com') === odd);

    d = await (await sync('tokA', { field: 'skills', previous: 'Go', next: 'Rust' })).json();
    check('a field the site cannot edit is refused', d.ok === false && d.reason === 'unknown_field');

    // Someone with no saved resume at all.
    db.prepare('DELETE FROM saved_resumes WHERE email = ?').run('b@x.com');
    d = await (await sync('tokB', { field: 'name', previous: 'Bob Reyes', next: 'B. Reyes' })).json();
    check('no saved resume means nothing to sync', d.ok === false && d.reason === 'no_resume', JSON.stringify(d));

    // ── one user cannot reach another's documents ───────────────────────────
    newResume('a@x.com', RESUME);
    newResume('b@x.com', RESUME.replace('Alice Nakamura', 'Bob Reyes'));
    await sync('tokB', { field: 'name', previous: 'Bob Reyes', next: 'Robert Reyes' });
    check("one user's sync does not touch another's resume", resumeOf('a@x.com') === RESUME);
    check('and it did change their own', resumeOf('b@x.com').startsWith('Robert Reyes'));

    // ── the cover letter, when the fact is in it ────────────────────────────
    newResume('a@x.com', RESUME);
    db.prepare('INSERT INTO saved_cover_letters (email,title,content,created_at) VALUES (?,?,?,?)')
      .run('a@x.com', 'CL', 'Alice Nakamura\nalice@example.com | Seattle, WA\n\nDear hiring manager,\nI would like to apply.', Date.now());
    d = await (await sync('tokA', { field: 'name', previous: 'Alice Nakamura', next: 'Alice M. Nakamura' })).json();
    const cl = db.prepare('SELECT content FROM saved_cover_letters WHERE email = ? ORDER BY created_at DESC LIMIT 1').get('a@x.com').content;
    check('the cover letter is updated when it carries the same fact', d.coverLetter === true, JSON.stringify(d));
    check('and its body is untouched', cl.startsWith('Alice M. Nakamura') && cl.includes('Dear hiring manager,'));

    // A cover letter that does not mention the fact is not a failure — it
    // simply does not contain it, and nothing is appended to make it.
    db.prepare('DELETE FROM saved_cover_letters WHERE email = ?').run('a@x.com');
    const plain = 'Dear hiring manager,\nI would like to apply for the role.';
    db.prepare('INSERT INTO saved_cover_letters (email,title,content,created_at) VALUES (?,?,?,?)')
      .run('a@x.com', 'CL', plain, Date.now());
    newResume('a@x.com', RESUME);
    d = await (await sync('tokA', { field: 'name', previous: 'Alice Nakamura', next: 'Alice M. Nakamura' })).json();
    check('a cover letter without the fact still lets the resume sync', d.ok === true, JSON.stringify(d));
    check('and nothing is appended to it',
      db.prepare('SELECT content FROM saved_cover_letters WHERE email = ?').get('a@x.com').content === plain);

    // ── Back Office status ──────────────────────────────────────────────────
    // Only the resume the site was built from can be out of step with it.
    const rid = newResume('a@x.com', RESUME);
    let list = await (await fetch(`${B}/api/resumes`, { headers: AJ('tokA') })).json();
    check('with no website, no resume claims a sync status',
      list.resumes.every(r => r.siteSync === null), JSON.stringify(list.resumes.map(r => r.siteSync)));

    const gen = await (await fetch(`${B}/api/personal-site/autogen`, { method: 'POST', headers: AJ('tokA') })).json();
    check('a site was generated to compare against', !!gen.subdomain, JSON.stringify(gen));
    list = await (await fetch(`${B}/api/resumes`, { headers: AJ('tokA') })).json();
    check('a freshly generated site is in sync',
      list.resumes.find(r => r.id === rid).siteSync === 'synced',
      JSON.stringify(list.resumes.map(r => [r.id, r.siteSync])));

    // Detach a field on the site and give it a value the resume does not have.
    const SF = require('../public/site-fields.js');
    const cfg = JSON.parse(db.prepare('SELECT config FROM personal_sites WHERE subdomain = ?').get(gen.subdomain).config);
    const nameEl = SF.findField(cfg, 'name');
    nameEl.props.text = 'Alice M. Nakamura';
    nameEl.props.detached = true;
    db.prepare('UPDATE personal_sites SET config = ? WHERE subdomain = ?').run(JSON.stringify(cfg), gen.subdomain);
    list = await (await fetch(`${B}/api/resumes`, { headers: AJ('tokA') })).json();
    check('an edited field the resume does not share reads as out of sync',
      list.resumes.find(r => r.id === rid).siteSync === 'out_of_sync',
      JSON.stringify(list.resumes.map(r => [r.id, r.siteSync])));

    // Syncing it should settle the status.
    d = await (await sync('tokA', { field: 'name', previous: 'Alice Nakamura', next: 'Alice M. Nakamura' })).json();
    check('the sync succeeded', d.ok === true, JSON.stringify(d));
    list = await (await fetch(`${B}/api/resumes`, { headers: AJ('tokA') })).json();
    check('and the resume now reads as synced',
      list.resumes.find(r => r.id === rid).siteSync === 'synced',
      JSON.stringify(list.resumes.map(r => [r.id, r.siteSync])));

    // A different resume — one the site was not built from — makes no claim.
    const other = newResume2('a@x.com', 'Someone Else\nsomeone@example.com | Denver, CO\n\nSUMMARY\nA different document entirely.');
    list = await (await fetch(`${B}/api/resumes`, { headers: AJ('tokA') })).json();
    check('a resume the site was not built from shows no status',
      list.resumes.find(r => r.id === other).siteSync === null,
      JSON.stringify(list.resumes.map(r => [r.id, r.siteSync])));

    // The site lookup is read ONCE and shared across every row rather than
    // re-queried per resume. Hoisting shared state has exactly one failure
    // mode — every row getting the same answer — so the status must still be
    // per-row with a realistic number of resumes in the list.
    for (let i = 0; i < 12; i++) {
      newResume2('a@x.com', `Person ${i}\np${i}@example.com | Austin, TX\n\nSUMMARY\nFiller resume ${i}.`);
    }
    list = await (await fetch(`${B}/api/resumes`, { headers: AJ('tokA') })).json();
    check('a long list still names exactly one resume as the site\'s',
      list.resumes.filter(r => r.siteSync !== null).length === 1,
      JSON.stringify(list.resumes.map(r => [r.id, r.siteSync])));
    check('and it is the one the site was built from',
      list.resumes.find(r => r.siteSync !== null).id === rid);
    check('every other row makes no claim at all',
      list.resumes.filter(r => r.id !== rid).every(r => r.siteSync === null));

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

// Add a resume without removing the others.
function newResume2(email, text) {
  db.prepare('INSERT INTO saved_resumes (email,title,content,created_at) VALUES (?,?,?,?)')
    .run(email, 'Other', text, Date.now() + 1000);
  return db.prepare('SELECT id FROM saved_resumes WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email).id;
}
