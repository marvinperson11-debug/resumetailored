#!/usr/bin/env node
/**
 * Employer Portal — pure core (employer-hub.js).
 *
 * Validation, limits, ranking and the rejection email body — all deterministic
 * and offline, no database, no network. Mirrors test/career-hub.js.
 *
 * Usage: node test/employer-hub.js
 */
const EH = require('../employer-hub.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── validateJobPosting ──────────────────────────────────────────────────────
const good = { title: 'Registered Nurse', description: 'Full-time RN role in a busy ICU with great benefits.', requirements: 'BLS, 2yrs ICU', location: 'Chicago, IL', workMode: 'onsite', jobType: 'full-time', salaryMin: '70000', salaryMax: '90000' };
const r1 = EH.validateJobPosting(good);
check('accepts a well-formed posting', r1.valid, JSON.stringify(r1.errors));
check('normalizes salary to numbers', r1.clean.salaryMin === 70000 && r1.clean.salaryMax === 90000);
check('lowercases work mode / job type', r1.clean.workMode === 'onsite' && r1.clean.jobType === 'full-time');

check('rejects a missing title', !EH.validateJobPosting(Object.assign({}, good, { title: '' })).valid);
check('rejects a too-short description', !EH.validateJobPosting(Object.assign({}, good, { description: 'short' })).valid);
check('rejects an invalid work mode', !EH.validateJobPosting(Object.assign({}, good, { workMode: 'space' })).valid);
check('rejects an invalid job type', !EH.validateJobPosting(Object.assign({}, good, { jobType: 'volunteer' })).valid);
check('rejects salaryMin > salaryMax', !EH.validateJobPosting(Object.assign({}, good, { salaryMin: '100000', salaryMax: '50000' })).valid);
check('rejects a negative salary', !EH.validateJobPosting(Object.assign({}, good, { salaryMin: '-5' })).valid);
check('accepts missing/blank salary as unset', EH.validateJobPosting(Object.assign({}, good, { salaryMin: '', salaryMax: '' })).clean.salaryMin === null);

const gig = EH.validateJobPosting(Object.assign({}, good, { jobType: 'temp', gigRate: '35', gigSchedule: 'Sat 9-5' }));
check('temp job type marks isGig true', gig.valid && gig.clean.isGig === true);
check('temp job type carries gig rate/schedule', gig.clean.gigRate === 35 && gig.clean.gigSchedule === 'Sat 9-5');
check('non-temp job type does not carry gig fields', EH.validateJobPosting(good).clean.isGig === false);
check('rejects a negative gig rate', !EH.validateJobPosting(Object.assign({}, good, { jobType: 'temp', gigRate: '-1' })).valid);

check('trims and caps title length', EH.validateJobPosting(Object.assign({}, good, { title: '  ' + 'x'.repeat(200) + '  ' })).clean.title.length === 140);

// ── EMPLOYER_LIMITS ─────────────────────────────────────────────────────────
check('free plan caps active posts at 3', EH.EMPLOYER_LIMITS.freeActiveJobs === 3);

// ── application status / rating ─────────────────────────────────────────────
check('validateApplicationStatus accepts a real stage', EH.validateApplicationStatus('interview'));
check('validateApplicationStatus is case-insensitive', EH.validateApplicationStatus('Hired'));
check('validateApplicationStatus rejects an unknown stage', !EH.validateApplicationStatus('ghosted'));
check('validateRating accepts 1-5', [1, 2, 3, 4, 5].every(EH.validateRating));
check('validateRating rejects 0 and 6', !EH.validateRating(0) && !EH.validateRating(6));
check('validateRating rejects non-integers', !EH.validateRating(3.5));

// ── rejection email ─────────────────────────────────────────────────────────
const rej = EH.buildRejectionEmail({ candidateName: 'Sam', jobTitle: 'RN', companyName: 'Acme Health' });
check('rejection email is polite and mentions the role + company', /Sam/.test(rej.html) && /RN/.test(rej.html) && /Acme Health/.test(rej.html));
check('rejection email subject names the role', /RN/.test(rej.subject));
check('rejection email defaults gracefully with no name', /Hi there/.test(EH.buildRejectionEmail({ jobTitle: 'RN', companyName: 'Acme' }).html));

// ── candidate ranking ───────────────────────────────────────────────────────
const cands = [
  { email: 'a@x.com', openToWorkPro: false, updatedAt: 100 },
  { email: 'b@x.com', openToWorkPro: true, updatedAt: 50 },
  { email: 'c@x.com', openToWorkPro: false, updatedAt: 200 },
];
const ranked = EH.rankCandidates(cands, { employerIsPro: true });
check('Pro-visible candidates sort first', ranked[0].email === 'b@x.com');
check('ties within a tier sort by most recent', ranked[1].email === 'c@x.com' && ranked[2].email === 'a@x.com');
const many = Array.from({ length: 15 }, (_, i) => ({ email: 'u' + i, openToWorkPro: false, updatedAt: i }));
check('free employer search is capped at 10', EH.rankCandidates(many, { employerIsPro: false }).length === 10);
check('Pro employer search is not capped', EH.rankCandidates(many, { employerIsPro: true }).length === 15);

// ── candidate profile (opt-in visibility) ───────────────────────────────────
const cp1 = EH.validateCandidateProfile({ searchable: true, openToWork: true, remotePref: 'remote', location: 'Chicago, IL' });
check('accepts a well-formed candidate profile', cp1.valid);
check('visibility defaults reflect exactly what was sent', cp1.clean.searchable === true && cp1.clean.openToWork === true);
check('remotePref defaults to "any" when unset', EH.validateCandidateProfile({}).clean.remotePref === 'any');
check('booleans default to false (visibility is opt-in, never implied)', EH.validateCandidateProfile({}).clean.searchable === false && EH.validateCandidateProfile({}).clean.openToWork === false);
check('rejects an invalid remote preference', !EH.validateCandidateProfile({ remotePref: 'moon-base' }).valid);
check('rejects a negative hourly rate', !EH.validateCandidateProfile({ hourlyRate: '-10' }).valid);
const cpGig = EH.validateCandidateProfile({ gigAvailable: true, gigSchedule: 'weekends', hourlyRate: '40' });
check('gig fields carry through when gigAvailable', cpGig.clean.gigSchedule === 'weekends' && cpGig.clean.hourlyRate === 40);
check('gig schedule is dropped when not gig-available', EH.validateCandidateProfile({ gigAvailable: false, gigSchedule: 'weekends' }).clean.gigSchedule === '');

check('validateContactRequestStatus accepts pending/approved/declined', ['pending', 'approved', 'declined'].every(EH.validateContactRequestStatus));
check('validateContactRequestStatus rejects an unknown status', !EH.validateContactRequestStatus('ghosted'));

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
