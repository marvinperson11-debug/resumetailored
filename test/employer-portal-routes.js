#!/usr/bin/env node
/**
 * Employer Portal — HTTP route integration (Phase A: foundation).
 *
 * Boots the real Express app against a throwaway SQLite DB and drives the
 * /api/employer routes end to end: Hire Mode profile setup, job posting CRUD,
 * free-tier active-post cap, Pro Employer gating, and cross-account isolation
 * (one employer can never see/edit another's postings). No Stripe/network
 * calls — /api/employer/subscribe is checked only for its "not configured"
 * fallback, matching how the lifetime-plan route is tested elsewhere.
 *
 * Usage: node test/employer-portal-routes.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ep-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('boss@acme.com', 'Boss', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokBoss', 'boss@acme.com');
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('rival@other.com', 'Rival', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokRival', 'rival@other.com');
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('startup@x.com', 'Startup Boss', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokStartup', 'startup@x.com');
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('jane@candidate.com', 'Jane Candidate', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokJane', 'jane@candidate.com');
db.prepare('INSERT INTO check_ins (email, profession_id, seniority) VALUES (?,?,?)').run('jane@candidate.com', 'registered-nurse', '');

function req(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, json: j, body: b }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const goodJob = { title: 'Registered Nurse', description: 'Full-time RN role in a busy ICU with great benefits.', requirements: 'BLS', location: 'Chicago, IL', workMode: 'onsite', jobType: 'full-time', salaryMin: '70000', salaryMax: '90000' };

let PORT;
const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    // ── auth gate ────────────────────────────────────────────────────────────
    check('status requires auth', (await req('GET', '/api/employer/status')).status === 401);
    check('posting a job requires auth', (await req('POST', '/api/employer/jobs', null, goodJob)).status === 401);

    // ── not an employer yet ──────────────────────────────────────────────────
    const s0 = await req('GET', '/api/employer/status', 'tokBoss');
    check('status before setup: not an employer', s0.status === 200 && s0.json.isEmployer === false, s0.body);
    const preJob = await req('POST', '/api/employer/jobs', 'tokBoss', goodJob);
    check('cannot post a job before a company profile exists', preJob.status === 400 && preJob.json.error === 'no_employer_profile', preJob.body);

    // ── Hire Mode / profile setup ────────────────────────────────────────────
    const badProfile = await req('POST', '/api/employer/profile', 'tokBoss', { companyName: 'A' });
    check('rejects a too-short company name', badProfile.status === 400);
    const setProfile = await req('POST', '/api/employer/profile', 'tokBoss', { companyName: 'Acme Health', website: 'https://acme.health' });
    check('creates the employer profile', setProfile.status === 200 && setProfile.json.companyName === 'Acme Health', setProfile.body);
    const s1 = await req('GET', '/api/employer/status', 'tokBoss');
    check('status after setup: is an employer, not Pro, 0 active jobs', s1.json.isEmployer === true && s1.json.pro === false && s1.json.activeJobs === 0);
    check('free active-post limit surfaced', s1.json.freeActiveJobLimit === 3);

    // ── posting jobs + validation ────────────────────────────────────────────
    const badPost = await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: '' }));
    check('rejects an invalid job posting', badPost.status === 400 && Array.isArray(badPost.json.errors));
    const p1 = await req('POST', '/api/employer/jobs', 'tokBoss', goodJob);
    check('posts a valid job', p1.status === 200 && Number.isInteger(p1.json.id), p1.body);
    const list1 = await req('GET', '/api/employer/jobs', 'tokBoss');
    check('job list returns the posted job with 0 applicants', list1.json.jobs.length === 1 && list1.json.jobs[0].applicantCount === 0);
    check('job list carries gig fields as null for a non-gig posting', list1.json.jobs[0].isGig === false && list1.json.jobs[0].gigRate === null);

    // ── temp/gig posting ──────────────────────────────────────────────────────
    const gigPost = await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Event Staff', jobType: 'temp', gigRate: '25', gigSchedule: 'Sat 9am-5pm' }));
    check('posts a temp/gig job', gigPost.status === 200);
    const list2 = await req('GET', '/api/employer/jobs', 'tokBoss');
    const gigJob = list2.json.jobs.find(j => j.title === 'Event Staff');
    check('gig job carries isGig + rate + schedule', gigJob && gigJob.isGig === true && gigJob.gigRate === 25 && gigJob.gigSchedule === 'Sat 9am-5pm');

    // ── free tier active-post cap (3) ────────────────────────────────────────
    await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Job 3' }));
    const capped = await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Job 4 over cap' }));
    check('free plan blocks a 4th active post', capped.status === 402 && capped.json.error === 'quota', capped.body);

    // ── editing ───────────────────────────────────────────────────────────────
    const editBad = await req('PUT', '/api/employer/jobs/' + p1.json.id, 'tokBoss', { title: '' });
    check('rejects an invalid edit', editBad.status === 400);
    const editOk = await req('PUT', '/api/employer/jobs/' + p1.json.id, 'tokBoss', Object.assign({}, goodJob, { title: 'Senior RN' }));
    check('edits a job', editOk.status === 200);
    const listAfterEdit = await req('GET', '/api/employer/jobs', 'tokBoss');
    check('edit persisted', listAfterEdit.json.jobs.some(j => j.title === 'Senior RN'));

    // ── close / reopen (status-only PUT) ─────────────────────────────────────
    const closeIt = await req('PUT', '/api/employer/jobs/' + p1.json.id, 'tokBoss', { status: 'closed' });
    check('closes a job via status-only update', closeIt.status === 200 && closeIt.json.status === 'closed');
    const sAfterClose = await req('GET', '/api/employer/status', 'tokBoss');
    check('closing a post frees up the active-post cap', sAfterClose.json.activeJobs === 2, String(sAfterClose.json.activeJobs));
    // Cap was full with 3 active before closing one — now there's room again.
    const afterCloseCanPost = await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Job 5 after close' }));
    check('posting works again after closing one to free the cap', afterCloseCanPost.status === 200, afterCloseCanPost.body);

    // ── cross-account isolation ───────────────────────────────────────────────
    const rivalList = await req('GET', '/api/employer/jobs', 'tokRival');
    check('a different employer sees an empty job list (no profile yet)', rivalList.status === 200 && rivalList.json.jobs.length === 0);
    const rivalEdit = await req('PUT', '/api/employer/jobs/' + p1.json.id, 'tokRival', goodJob);
    check("a different employer cannot edit someone else's job", rivalEdit.status === 404);
    const rivalDelete = await req('DELETE', '/api/employer/jobs/' + p1.json.id, 'tokRival');
    check("a different employer cannot delete someone else's job", rivalDelete.status === 404);

    // ── delete ────────────────────────────────────────────────────────────────
    const del = await req('DELETE', '/api/employer/jobs/' + p1.json.id, 'tokBoss');
    check('deletes a job', del.status === 200);
    const listAfterDelete = await req('GET', '/api/employer/jobs', 'tokBoss');
    check('deleted job is gone', !listAfterDelete.json.jobs.some(j => j.id === p1.json.id));

    // ── Pro Employer gating ───────────────────────────────────────────────────
    db.prepare('INSERT INTO employer_subscribers (email, customer_id) VALUES (?,?)').run('boss@acme.com', 'cus_employer_1');
    const sPro = await req('GET', '/api/employer/status', 'tokBoss');
    check('Pro Employer status flips pro:true', sPro.json.pro === true);
    // Fill well past the free cap — should never 402 once Pro.
    for (let i = 0; i < 5; i++) await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Pro overflow ' + i }));
    const stillOk = await req('POST', '/api/employer/jobs', 'tokBoss', Object.assign({}, goodJob, { title: 'Pro overflow final' }));
    check('Pro Employer is never capped', stillOk.status === 200, stillOk.body);

    // ── checkout fallback when unconfigured ──────────────────────────────────
    const checkout = await req('POST', '/api/employer/subscribe', 'tokRival');
    check('checkout fails gracefully with no STRIPE_EMPLOYER_PRICE_ID configured', checkout.status === 503 && checkout.json.error === 'not_configured');

    // ═══════════════════ Phase B: candidates, ATS, applications ═══════════════

    // ── candidate opt-in profile ─────────────────────────────────────────────
    const cpDefault = await req('GET', '/api/candidate/profile', 'tokJane');
    check('candidate profile defaults to not searchable', cpDefault.status === 200 && cpDefault.json.searchable === false, cpDefault.body);
    const cpBad = await req('POST', '/api/candidate/profile', 'tokJane', { remotePref: 'moon-base' });
    check('rejects an invalid candidate profile', cpBad.status === 400);
    const cpSave = await req('POST', '/api/candidate/profile', 'tokJane', { searchable: true, openToWork: true, remotePref: 'remote', location: 'Chicago, IL' });
    check('saves the candidate profile', cpSave.status === 200);
    const cpAfter = await req('GET', '/api/candidate/profile', 'tokJane');
    check('candidate profile persists', cpAfter.json.searchable === true && cpAfter.json.location === 'Chicago, IL');

    // ── a second, non-Pro employer posts a job and gets applicants ──────────
    await req('POST', '/api/employer/profile', 'tokStartup', { companyName: 'Startup Inc' });
    const startupJob = await req('POST', '/api/employer/jobs', 'tokStartup', goodJob);
    check('a fresh employer can post a job', startupJob.status === 200, startupJob.body);
    const startupJobId = startupJob.json.id;

    // ── applying ──────────────────────────────────────────────────────────────
    const applyMissing = await req('POST', '/api/employer/jobs/999999/apply', 'tokJane');
    check('applying to a nonexistent job 404s', applyMissing.status === 404);
    const apply1 = await req('POST', '/api/employer/jobs/' + startupJobId + '/apply', 'tokJane');
    check('candidate applies to a job', apply1.status === 200 && Number.isInteger(apply1.json.applicationId), apply1.body);
    const apply2 = await req('POST', '/api/employer/jobs/' + startupJobId + '/apply', 'tokJane');
    check('re-applying is idempotent, not a duplicate row', apply2.status === 200 && apply2.json.alreadyApplied === true);

    // ── applicant list is view-only on the free plan ─────────────────────────
    const appsList = await req('GET', '/api/employer/jobs/' + startupJobId + '/applications', 'tokStartup');
    check('free employer can see who applied', appsList.status === 200 && appsList.json.applications.length === 1 && appsList.json.pro === false, appsList.body);
    const jobCount = await req('GET', '/api/employer/jobs', 'tokStartup');
    check('applicant count reflects the real application', jobCount.json.jobs.find(j => j.id === startupJobId).applicantCount === 1);
    const appId = appsList.json.applications[0].id;
    const putFree = await req('PUT', '/api/employer/applications/' + appId, 'tokStartup', { status: 'reviewed' });
    check('free employer cannot move the ATS pipeline (no ATS on free)', putFree.status === 402 && putFree.json.error === 'pro_required', putFree.body);

    // ── upgrade the startup to Pro Employer, then drive the ATS pipeline ─────
    db.prepare('INSERT INTO employer_subscribers (email, customer_id) VALUES (?,?)').run('startup@x.com', 'cus_startup_1');
    const putBadStatus = await req('PUT', '/api/employer/applications/' + appId, 'tokStartup', { status: 'ghosted' });
    check('rejects an invalid application status', putBadStatus.status === 400);
    const putBadRating = await req('PUT', '/api/employer/applications/' + appId, 'tokStartup', { rating: 9 });
    check('rejects an out-of-range rating', putBadRating.status === 400);
    const putReviewed = await req('PUT', '/api/employer/applications/' + appId, 'tokStartup', { status: 'reviewed', rating: 4, notes: 'Strong ICU background' });
    check('Pro employer moves an application through the ATS', putReviewed.status === 200, putReviewed.body);
    const appsAfter = await req('GET', '/api/employer/jobs/' + startupJobId + '/applications', 'tokStartup');
    const updatedApp = appsAfter.json.applications.find(a => a.id === appId);
    check('status/rating/notes persisted', updatedApp.status === 'reviewed' && updatedApp.rating === 4 && updatedApp.notes === 'Strong ICU background');
    const putReject = await req('PUT', '/api/employer/applications/' + appId, 'tokStartup', { status: 'rejected' });
    check('one-click reject succeeds (fires the polite email, best-effort)', putReject.status === 200);
    const rivalPutApp = await req('PUT', '/api/employer/applications/' + appId, 'tokRival', { status: 'hired' });
    check("a different employer cannot touch someone else's application", rivalPutApp.status === 404);

    // ── candidate search (opt-in only, filtered by profession) ──────────────
    const searchNoProfile = await req('GET', '/api/employer/candidates', 'tokRival');
    check('candidate search requires an employer profile', searchNoProfile.status === 400 && searchNoProfile.json.error === 'no_employer_profile');
    const search1 = await req('GET', '/api/employer/candidates?professionId=registered-nurse', 'tokStartup');
    check('candidate search finds the opted-in candidate by profession', search1.status === 200 && search1.json.candidates.some(c => c.email === 'jane@candidate.com'), search1.body);
    const search2 = await req('GET', '/api/employer/candidates?professionId=software-engineer', 'tokStartup');
    check('candidate search excludes a non-matching profession', !search2.json.candidates.some(c => c.email === 'jane@candidate.com'));
    check('search results never include a candidate who has not opted in', search1.json.candidates.every(c => c.email !== 'rival@other.com'));

    // ── full candidate profile is Pro-only ───────────────────────────────────
    await req('POST', '/api/employer/profile', 'tokRival', { companyName: 'Rival Co' });
    const profileFree = await req('GET', '/api/employer/candidates/jane@candidate.com/profile', 'tokRival');
    check('full candidate profile is Pro-gated', profileFree.status === 402 && profileFree.json.error === 'pro_required');
    const profilePro = await req('GET', '/api/employer/candidates/jane@candidate.com/profile', 'tokStartup');
    check('Pro employer can view the full candidate profile', profilePro.status === 200 && profilePro.json.email === 'jane@candidate.com', profilePro.body);
    check('full candidate profile carries badges + location', Array.isArray(profilePro.json.badges) && profilePro.json.location === 'Chicago, IL');

    // ── "Open to Work" badge visibility (Part 4): full for Pro job seekers,
    //    limited (Pro-employer-only) for free ones — the candidate is still
    //    findable either way, only the badge itself is gated ──────────────────
    const searchFreeEmployer = await req('GET', '/api/employer/candidates?professionId=registered-nurse', 'tokRival'); // rival: free employer, has a profile
    const janeToFree = searchFreeEmployer.json.candidates.find(c => c.email === 'jane@candidate.com');
    check('a free job seeker\'s Open to Work badge is hidden from a free employer', janeToFree && janeToFree.openToWork === false, JSON.stringify(janeToFree));
    const searchProEmployer = await req('GET', '/api/employer/candidates?professionId=registered-nurse', 'tokStartup'); // startup: Pro employer
    const janeToPro = searchProEmployer.json.candidates.find(c => c.email === 'jane@candidate.com');
    check("a free job seeker's Open to Work badge is still shown to a Pro employer", janeToPro && janeToPro.openToWork === true, JSON.stringify(janeToPro));
    check('the candidate is findable in search either way — only the badge is gated', !!janeToFree);

    // ── contact-request flow ─────────────────────────────────────────────────
    const contactMissing = await req('POST', '/api/employer/candidates/nobody@x.com/contact', 'tokStartup', { message: 'hi' });
    check('contacting a non-opted-in candidate 404s', contactMissing.status === 404);
    const contactOk = await req('POST', '/api/employer/candidates/jane@candidate.com/contact', 'tokStartup', { message: "Let's talk about the RN role." });
    check('employer sends a contact request', contactOk.status === 200, contactOk.body);
    const janeRequests = await req('GET', '/api/candidate/contact-requests', 'tokJane');
    check('candidate sees the pending contact request with the company name', janeRequests.status === 200 && janeRequests.json.requests.some(r => r.companyName === 'Startup Inc' && r.status === 'pending'), janeRequests.body);
    const reqId = janeRequests.json.requests.find(r => r.companyName === 'Startup Inc').id;
    const badApprove = await req('POST', '/api/candidate/contact-requests/' + reqId, 'tokJane', { status: 'whatever' });
    check('rejects an invalid contact-request status', badApprove.status === 400);
    const approve = await req('POST', '/api/candidate/contact-requests/' + reqId, 'tokJane', { status: 'approved' });
    check('candidate approves the contact request', approve.status === 200 && approve.json.status === 'approved');
    const rivalCannotApprove = await req('POST', '/api/candidate/contact-requests/' + reqId, 'tokStartup', { status: 'approved' });
    check("an employer cannot approve on the candidate's behalf", rivalCannotApprove.status === 404);

    // ═══════════════════ Phase C: Job Feed Aggregator ═══════════════════════

    check('job feed requires auth', (await req('GET', '/api/job-feed')).status === 401);

    // startupJob ("Registered Nurse", still active) syncs into job_feed on
    // post, with priority (Employer Portal jobs get priority placement) and a
    // best-effort profession guess from the title.
    const feed1 = await req('GET', '/api/job-feed', 'tokJane'); // jane's saved profession is registered-nurse
    check('Jobs for You surfaces the matching employer posting', feed1.status === 200 && feed1.json.jobs.some(j => j.jobPostingId === startupJobId), feed1.body);
    const featuredJob = feed1.json.jobs.find(j => j.jobPostingId === startupJobId);
    check('employer jobs in the feed carry priority + a null external url (in-platform apply)', featuredJob.priority === 1 && featuredJob.url === null);

    const feedOtherProf = await req('GET', '/api/job-feed?professionId=software-engineer', 'tokJane');
    check('job feed is filtered by profession — a non-matching profession excludes it', !feedOtherProf.json.jobs.some(j => j.jobPostingId === startupJobId));

    // Closing a posting pulls it out of the feed immediately, not just on the next refresh.
    await req('PUT', '/api/employer/jobs/' + startupJobId, 'tokStartup', { status: 'closed' });
    const feedAfterClose = await req('GET', '/api/job-feed', 'tokJane');
    check('closing a job removes it from the feed', !feedAfterClose.json.jobs.some(j => j.jobPostingId === startupJobId), feedAfterClose.body);
    await req('PUT', '/api/employer/jobs/' + startupJobId, 'tokStartup', { status: 'active' });
    const feedAfterReopen = await req('GET', '/api/job-feed', 'tokJane');
    check('reopening a job puts it back in the feed', feedAfterReopen.json.jobs.some(j => j.jobPostingId === startupJobId));

    // Deleting a posting removes it from the feed too.
    await req('DELETE', '/api/employer/jobs/' + startupJobId, 'tokStartup');
    const feedAfterDelete = await req('GET', '/api/job-feed', 'tokJane');
    check('deleting a job removes it from the feed', !feedAfterDelete.json.jobs.some(j => j.jobPostingId === startupJobId));

    // ═══════════════════ Phase D: temp/gig staffing ═══════════════════════

    const gigJobPost = await req('POST', '/api/employer/jobs', 'tokStartup', Object.assign({}, goodJob, { title: 'Event Staff', jobType: 'temp', gigRate: '20', gigType: 'event-based', location: 'Chicago, IL' }));
    check('posts a "Need Staff Fast" gig job with a gigType', gigJobPost.status === 200, gigJobPost.body);
    const gigJobId = gigJobPost.json.id;
    const regularJobPost = await req('POST', '/api/employer/jobs', 'tokStartup', Object.assign({}, goodJob, { title: 'Staff Nurse' }));
    const regularJobId = regularJobPost.json.id;

    const matchesNotGig = await req('GET', '/api/employer/jobs/' + regularJobId + '/matches', 'tokStartup');
    check('matching a non-gig posting is rejected', matchesNotGig.status === 400 && matchesNotGig.json.error === 'not_a_gig');

    // rival (has an employer profile, never upgraded to Pro) posts its own gig
    // job to prove the 402 case with ownership satisfied — the ownership check
    // runs before the Pro gate, so testing 402 requires the caller to actually
    // own the posting (a non-owner gets 404 regardless of plan, per the same
    // fix applied to the ATS update route).
    const rivalGigPost = await req('POST', '/api/employer/jobs', 'tokRival', Object.assign({}, goodJob, { title: 'Rival Gig', jobType: 'temp', gigRate: '20' }));
    const matchesFree = await req('GET', '/api/employer/jobs/' + rivalGigPost.json.id + '/matches', 'tokRival');
    check('gig matching is Pro-gated', matchesFree.status === 402 && matchesFree.json.error === 'pro_required', matchesFree.body);

    // A gig-available, opted-in candidate near the job's location and within rate.
    db.prepare("INSERT INTO users (email,username,password_hash) VALUES (?,?,?)").run('gigger@candidate.com', 'Gig Gigson', 'x');
    db.prepare(`
      INSERT INTO candidate_profiles (email, searchable, open_to_work, remote_pref, location, gig_available, hourly_rate, gig_schedule, updated_at)
      VALUES ('gigger@candidate.com', 1, 0, 'any', 'Chicago, IL', 1, 15, 'weekends', ?)
    `).run(Date.now());
    // jane opted in earlier but never turned on gig availability — should NOT show up in matches.
    const matchesPro = await req('GET', '/api/employer/jobs/' + gigJobId + '/matches', 'tokStartup');
    check('Pro employer gets gig matches for the posting', matchesPro.status === 200 && matchesPro.json.matches.some(m => m.email === 'gigger@candidate.com'), matchesPro.body);
    check('a candidate who opted in but never turned on gig availability is excluded', !matchesPro.json.matches.some(m => m.email === 'jane@candidate.com'));

    const rivalMatchesOwn = await req('GET', '/api/employer/jobs/' + gigJobId + '/matches', 'tokRival');
    check("a different employer cannot match against someone else's gig posting", rivalMatchesOwn.status === 404);

  } catch (err) {
    failures++;
    console.error('FATAL', err);
  } finally {
    server.close();
    if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
    console.log('\nALL PASS (0 failures)');
    process.exit(0);
  }
});
