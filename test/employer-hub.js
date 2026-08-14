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

// ── v2 tiers + lifetime job cap ──────────────────────────────────────────────
check('free tier is a lifetime cap of 2 posts', EH.EMPLOYER_TIERS.free.lifetimeJobs === 2);
check('pro tier is $49 with unlimited posts', EH.EMPLOYER_TIERS.pro.price === 49 && EH.EMPLOYER_TIERS.pro.lifetimeJobs === Infinity);
check('scale tier is $199 with API access', EH.EMPLOYER_TIERS.scale.price === 199 && EH.EMPLOYER_TIERS.scale.api === true);
check('tierConfig falls back to free on garbage', EH.tierConfig('bogus').lifetimeJobs === 2);

check('canPostJob allows a free employer with 0 posts', EH.canPostJob({ tier: 'free', lifetimeJobsPosted: 0 }).allowed === true);
check('canPostJob allows a free employer with 1 post', EH.canPostJob({ tier: 'free', lifetimeJobsPosted: 1 }).allowed === true);
check('canPostJob BLOCKS a free employer at 2 lifetime posts', EH.canPostJob({ tier: 'free', lifetimeJobsPosted: 2 }).allowed === false);
check('canPostJob still blocks at 2 even after archiving (count does not drop)', EH.canPostJob({ tier: 'free', lifetimeJobsPosted: 2 }).remaining === 0);
check('canPostJob is unlimited for pro', EH.canPostJob({ tier: 'pro', lifetimeJobsPosted: 999 }).allowed === true);
check('canPostJob reports remaining for free', EH.canPostJob({ tier: 'free', lifetimeJobsPosted: 1 }).remaining === 1);

check('resolveEmployerTier maps explicit plan name', EH.resolveEmployerTier({ plan: 'scale' }) === 'scale');
check('resolveEmployerTier maps a price id', EH.resolveEmployerTier({ priceId: 'price_X', proPriceId: 'price_X' }) === 'pro');
check('resolveEmployerTier defaults to free on unknown', EH.resolveEmployerTier({ priceId: 'price_unknown' }) === 'free');

// ── AI match gate: top 3 free, rest locked ───────────────────────────────────
const gRanked = [90, 85, 80, 70, 60].map((s, i) => ({ score: s, candidateId: 'c' + i, email: 'c' + i + '@x.com' }));
const freeGate = EH.applyMatchGate(gRanked, 'free');
check('free gate unlocks exactly 3 matches', freeGate.unlockedCount === 3);
check('free gate locks the remaining 2', freeGate.lockedCount === 2);
check('free gate keeps PII on unlocked entries', freeGate.matches[0].email === 'c0@x.com' && freeGate.matches[0].locked === false);
check('free gate strips PII from locked entries', freeGate.matches[3].locked === true && freeGate.matches[3].email === undefined);
check('free gate exposes only a score band on locked entries', freeGate.matches[3].scoreBand === 'medium');
const proGate = EH.applyMatchGate(gRanked, 'pro');
check('pro gate unlocks everything', proGate.unlockedCount === 5 && proGate.lockedCount === 0 && proGate.matches[4].email === 'c4@x.com');

// ── screener questions (Pro) ─────────────────────────────────────────────────
check('validateScreenerQuestions accepts empty as []', EH.validateScreenerQuestions('').clean.length === 0);
const sc = EH.validateScreenerQuestions([{ question: 'Years of experience?', type: 'text', required: true }, { question: 'Authorized to work?', type: 'yesno' }]);
check('validateScreenerQuestions accepts a valid set', sc.valid && sc.clean.length === 2 && sc.clean[0].id === 'q1');
check('validateScreenerQuestions requires >=2 options for choice', !EH.validateScreenerQuestions([{ question: 'Shift?', type: 'choice', options: ['Day'] }]).valid);
check('validateScreenerQuestions caps at 10', !EH.validateScreenerQuestions(Array.from({ length: 11 }, () => ({ question: 'ok?', type: 'yesno' }))).valid);

// ── AI applicant match: prompt + result validation ───────────────────────────
const mp = EH.buildApplicantMatchPrompt({ jobTitle: 'RN', jobDescription: 'ICU nurse', requirements: 'BLS', resumeText: 'RN, 5yrs ICU, BLS' });
check('buildApplicantMatchPrompt embeds the job + resume', /RN/.test(mp.user) && /ICU/.test(mp.user) && /BLS/.test(mp.user));
const mvGood = EH.validateMatchResult({ score: 87, reasoning: 'Strong ICU match', matchedKeywords: ['ICU', 'BLS'], missingKeywords: ['PALS'] });
check('validateMatchResult accepts a good object', mvGood.ok && mvGood.value.score === 87 && mvGood.value.matchedKeywords.length === 2);
check('validateMatchResult clamps score to 0-100', EH.validateMatchResult({ score: 250 }).value.score === 100 && EH.validateMatchResult({ score: -5 }).value.score === 0);
check('validateMatchResult rejects a non-numeric score', !EH.validateMatchResult({ score: 'high' }).ok);
check('validateMatchResult caps keyword lists at 10', EH.validateMatchResult({ score: 50, matchedKeywords: Array.from({ length: 20 }, (_, i) => 'k' + i) }).value.matchedKeywords.length === 10);

// ── nurture emails ───────────────────────────────────────────────────────────
check('nurture step 1 mentions the 2 free posts and $49', /2 free/.test(EH.buildEmployerNurtureEmail(1, { companyName: 'Acme' }).subject) || /49/.test(EH.buildEmployerNurtureEmail(1, {}).html));
check('nurture returns null past the last step', EH.buildEmployerNurtureEmail(4, {}) === null);
check('nurture personalizes the company name', /Acme/.test(EH.buildEmployerNurtureEmail(1, { companyName: 'Acme' }).subject));

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

// ── temp/gig postings: gigType ──────────────────────────────────────────────
const gigWithType = EH.validateJobPosting(Object.assign({}, good, { jobType: 'temp', gigRate: '30', gigType: 'same-day' }));
check('accepts a gig posting with an explicit gigType', gigWithType.valid && gigWithType.clean.gigType === 'same-day');
check('gigType defaults to short-term when unset on a gig posting', EH.validateJobPosting(Object.assign({}, good, { jobType: 'temp' })).clean.gigType === 'short-term');
check('rejects an unknown gigType', !EH.validateJobPosting(Object.assign({}, good, { jobType: 'temp', gigType: 'whenever' })).valid);
check('a non-gig posting carries no gigType', EH.validateJobPosting(good).clean.gigType === '');
check('GIG_TYPES covers same-day/short-term/event-based/seasonal', ['same-day', 'short-term', 'event-based', 'seasonal'].every(t => EH.GIG_TYPES.includes(t)));

// ── gig candidate matching ──────────────────────────────────────────────────
const gigCands = [
  { email: 'perfect@x.com', gigAvailable: true, professionId: 'server', location: 'Chicago, IL', hourlyRate: 20, updatedAt: 1 },
  { email: 'wrongprof@x.com', gigAvailable: true, professionId: 'chef', location: 'Chicago, IL', hourlyRate: 20, updatedAt: 1 },
  { email: 'toopricey@x.com', gigAvailable: true, professionId: 'server', location: 'Chicago, IL', hourlyRate: 100, updatedAt: 1 },
  { email: 'notavailable@x.com', gigAvailable: false, professionId: 'server', location: 'Chicago, IL', hourlyRate: 20, updatedAt: 1 },
  { email: 'noratelisted@x.com', gigAvailable: true, professionId: 'server', location: 'Chicago, IL', hourlyRate: null, updatedAt: 1 },
];
const gigJob = { professionId: 'server', location: 'Chicago', gigRate: 25 };
const matched = EH.matchGigCandidates(gigCands, gigJob);
check('matchGigCandidates excludes candidates not available for gig work', !matched.some(c => c.email === 'notavailable@x.com'));
check('the best profession+location+rate match ranks first', matched[0].email === 'perfect@x.com', matched.map(c => c.email).join(','));
check('an over-budget candidate scores below an on-budget one', matched.findIndex(c => c.email === 'toopricey@x.com') > matched.findIndex(c => c.email === 'perfect@x.com'));
check('a candidate with no listed rate is still included (rate match is a bonus, not a requirement)', matched.some(c => c.email === 'noratelisted@x.com'));
check('matchGigCandidates never throws on an empty job or candidate list', EH.matchGigCandidates([], {}).length === 0 && EH.matchGigCandidates(gigCands, {}).length === 4);

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
