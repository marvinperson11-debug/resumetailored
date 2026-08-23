/* employer-hub.js — pure, testable core for the Employer Portal.
 *
 * Mirrors career-hub.js / llms-txt.js / resume-writeback.js: everything that
 * can be reasoned about without a database or an HTTP request lives here
 * (validation, limits, formatting) so it's unit-testable with no network and
 * no API budget. server.js wires this into routes + SQLite + Stripe.
 */
'use strict';

const WORK_MODES = ['remote', 'hybrid', 'onsite'];
const JOB_TYPES = ['full-time', 'part-time', 'contract', 'temp'];
const APPLICATION_STATUSES = ['new', 'reviewed', 'interview', 'hired', 'rejected'];
// "Need Staff Fast" categories for a temp/gig posting — same-day is the
// urgent case a staffing layer exists for; the rest are just how long the
// engagement runs.
const GIG_TYPES = ['same-day', 'short-term', 'event-based', 'seasonal'];

// ── Employer Portal v2 tiers ────────────────────────────────────────────────
// Free is a LIFETIME cap of 2 job posts EVER — not "2 active at a time". Once
// two postings have been created the counter never decreases, so archiving,
// hiring or deleting a posting does NOT free a slot; a third post requires Pro.
// This is enforced server-side against a monotonic `jobs_posted_lifetime`
// counter on the employer profile (incremented on every successful create),
// which is why deleting a row can't game it — the row is gone but the count
// stays. Pro ($49/mo) unlocks unlimited posts, AI candidate matching, team
// seats, screener questions and analytics. The public name of the internal
// `pro` key is Employer Portal ($49/mo). Scale ($99/mo) adds the collaboration
// layer and five retained modules; Corporate ($299/mo) unlocks the full suite.
const EMPLOYER_TIERS = {
  free: {
    label: 'Free', price: 0,
    lifetimeJobs: 2, seats: 1,
    aiMatching: false, matchPreview: 3,   // free sees the top 3 AI matches, rest locked
    screener: false, analytics: false, api: false
  },
  pro: {
    label: 'Employer Portal', price: 49,
    lifetimeJobs: Infinity, seats: 5,
    aiMatching: true, matchPreview: 3,
    screener: true, analytics: true, api: false, recruitmentDecoder: true
  },
  scale: {
    label: 'Scale', price: 99,
    lifetimeJobs: Infinity, seats: Infinity,
    aiMatching: true, matchPreview: Infinity,
    screener: true, analytics: true, api: true,
    operationalModules: 5, recruitmentDecoder: true
  },
  corporate: {
    label: 'Corporate', price: 299,
    lifetimeJobs: Infinity, seats: Infinity,
    aiMatching: true, matchPreview: Infinity,
    screener: true, analytics: true, api: true,
    operationalModules: Infinity, recruitmentDecoder: true, jobDecoder: true, webStudio: true
  }
};
const EMPLOYER_TIER_NAMES = ['free', 'pro', 'scale', 'corporate'];

// Slug for a public company page (/company/:slug). Lowercase, hyphenated,
// stripped to [a-z0-9-]; capped; never empty (falls back to 'company').
// Uniqueness is resolved by the caller (append -2/-3…); this is just the base.
function slugifyCompany(name) {
  const s = normStr(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s || 'company';
}

function tierConfig(tier) {
  return EMPLOYER_TIERS[String(tier || 'free').toLowerCase()] || EMPLOYER_TIERS.free;
}

// Can this employer create another job posting? Pure — takes the tier and the
// monotonic lifetime count, returns the decision plus the numbers the UI needs.
function canPostJob({ tier, lifetimeJobsPosted }) {
  const cfg = tierConfig(tier);
  const posted = Number(lifetimeJobsPosted) || 0;
  const limit = cfg.lifetimeJobs;
  const allowed = posted < limit;
  return {
    allowed,
    limit: limit === Infinity ? null : limit,
    posted,
    remaining: limit === Infinity ? null : Math.max(0, limit - posted)
  };
}

// Map a Stripe price id (or an explicit plan name in checkout metadata) to a
// tier. Returns 'free' when nothing matches so an unknown price can never
// silently grant a paid tier.
function resolveEmployerTier({ plan, priceId, proPriceId, scalePriceId, corporatePriceId }) {
  const p = String(plan || '').toLowerCase();
  if (p === 'portal' || p === 'employer-portal') return 'pro';
  if (p === 'pro' || p === 'scale' || p === 'corporate') return p;
  if (priceId && corporatePriceId && priceId === corporatePriceId) return 'corporate';
  if (priceId && scalePriceId && priceId === scalePriceId) return 'scale';
  if (priceId && proPriceId && priceId === proPriceId) return 'pro';
  return 'free';
}

// AI-match gating. Given a ranked list (best first) and the employer's tier,
// return which entries are visible and which are locked behind an upgrade.
// Locked entries are stripped of identifying fields so nothing sensitive
// reaches a client that hasn't paid to see it — only enough to render a
// blurred placeholder card and a count. Pure, so the gate is unit-testable.
function applyMatchGate(ranked, tier) {
  const cfg = tierConfig(tier);
  const list = Array.isArray(ranked) ? ranked : [];
  const preview = cfg.matchPreview;
  if (preview === Infinity) {
    return { total: list.length, unlockedCount: list.length, lockedCount: 0, matches: list.map(m => Object.assign({ locked: false }, m)) };
  }
  const matches = list.map((m, i) => {
    if (i < preview) return Object.assign({ locked: false }, m);
    // Locked: keep only the score band so the UI can show a blurred bar; drop PII.
    return { locked: true, scoreBand: m.score >= 80 ? 'high' : m.score >= 60 ? 'medium' : 'low' };
  });
  return { total: list.length, unlockedCount: Math.min(preview, list.length), lockedCount: Math.max(0, list.length - preview), matches };
}

// Screener questions attached to a job posting (Pro+). Accepts an array of
// { question, type, required, options? }; caps count/length so a posting can't
// carry an unbounded blob. type ∈ text|yesno|choice; choice needs ≥2 options.
const SCREENER_TYPES = ['text', 'yesno', 'choice'];
function validateScreenerQuestions(input) {
  let arr = input;
  if (arr == null || arr === '') return { valid: true, errors: [], clean: [] };
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { return { valid: false, errors: ['Screener questions must be valid JSON.'], clean: null }; } }
  if (arr == null) return { valid: true, errors: [], clean: [] };
  if (!Array.isArray(arr)) return { valid: false, errors: ['Screener questions must be a list.'], clean: null };
  if (arr.length > 10) return { valid: false, errors: ['At most 10 screener questions.'], clean: null };
  const errors = []; const clean = [];
  arr.forEach((q, i) => {
    const question = normStr(q && q.question, 300);
    const type = normStr(q && q.type).toLowerCase() || 'text';
    if (question.length < 3) { errors.push(`Question ${i + 1} is too short.`); return; }
    if (!SCREENER_TYPES.includes(type)) { errors.push(`Question ${i + 1} has an invalid type.`); return; }
    let options = null;
    if (type === 'choice') {
      options = (Array.isArray(q.options) ? q.options : []).map(o => normStr(o, 120)).filter(Boolean).slice(0, 8);
      if (options.length < 2) { errors.push(`Question ${i + 1} needs at least 2 options.`); return; }
    }
    clean.push({ id: normStr(q && q.id, 40) || `q${i + 1}`, question, type, required: !!(q && q.required), options });
  });
  if (errors.length) return { valid: false, errors, clean: null };
  return { valid: true, errors: [], clean };
}

// Back-compat shim: some older call sites/tests referenced a flat limits table.
// freeLifetimeJobs is the v2 free cap (2). Kept so nothing that imports
// EMPLOYER_LIMITS breaks; new code should read EMPLOYER_TIERS / tierConfig.
const EMPLOYER_LIMITS = {
  freeLifetimeJobs: EMPLOYER_TIERS.free.lifetimeJobs,
  freeSeats: EMPLOYER_TIERS.free.seats,
  freeMatchPreview: EMPLOYER_TIERS.free.matchPreview
};

function normStr(v, max) {
  const s = (v == null ? '' : String(v)).trim();
  return max ? s.slice(0, max) : s;
}

// Validates a job-posting payload. Returns { valid, errors, clean } — clean
// holds the normalized/trimmed fields, ready to insert, only when valid.
function validateJobPosting(body) {
  const b = body || {};
  const errors = [];
  const title = normStr(b.title, 140);
  const description = normStr(b.description, 8000);
  const requirements = normStr(b.requirements, 4000);
  const location = normStr(b.location, 140);
  const workMode = normStr(b.workMode).toLowerCase();
  const jobType = normStr(b.jobType).toLowerCase();
  const salaryMin = b.salaryMin === '' || b.salaryMin == null ? null : Number(b.salaryMin);
  const salaryMax = b.salaryMax === '' || b.salaryMax == null ? null : Number(b.salaryMax);
  const isGig = jobType === 'temp' || !!b.isGig;
  const gigRate = isGig && b.gigRate !== '' && b.gigRate != null ? Number(b.gigRate) : null;
  const gigSchedule = isGig ? normStr(b.gigSchedule, 200) : '';
  const gigType = isGig ? (normStr(b.gigType).toLowerCase() || 'short-term') : '';

  if (title.length < 3) errors.push('Job title is required.');
  if (description.length < 20) errors.push('A fuller job description is required (at least 20 characters).');
  if (!WORK_MODES.includes(workMode)) errors.push('Work mode must be remote, hybrid, or onsite.');
  if (!JOB_TYPES.includes(jobType)) errors.push('Job type must be full-time, part-time, contract, or temp.');
  if (salaryMin != null && (!Number.isFinite(salaryMin) || salaryMin < 0)) errors.push('Minimum salary must be a positive number.');
  if (salaryMax != null && (!Number.isFinite(salaryMax) || salaryMax < 0)) errors.push('Maximum salary must be a positive number.');
  if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) errors.push('Minimum salary cannot exceed maximum salary.');
  if (gigRate != null && (!Number.isFinite(gigRate) || gigRate < 0)) errors.push('Gig hourly rate must be a positive number.');
  if (isGig && !GIG_TYPES.includes(gigType)) errors.push('Gig type must be same-day, short-term, event-based, or seasonal.');

  if (errors.length) return { valid: false, errors, clean: null };
  return {
    valid: true,
    errors: [],
    clean: { title, description, requirements, location, workMode, jobType, salaryMin, salaryMax, isGig, gigRate, gigSchedule, gigType }
  };
}

function validateApplicationStatus(status) {
  return APPLICATION_STATUSES.includes(String(status || '').toLowerCase());
}

function validateRating(rating) {
  const n = Number(rating);
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

const REMOTE_PREFS = ['remote', 'hybrid', 'onsite', 'any'];
const CONTACT_REQUEST_STATUSES = ['pending', 'approved', 'declined'];

// Candidate-side "let employers find me" profile. Everything optional except
// the two booleans, which default off — visibility is opt-in, never implied.
function validateCandidateProfile(body) {
  const b = body || {};
  const errors = [];
  const searchable = !!b.searchable;
  const openToWork = !!b.openToWork;
  const remotePref = normStr(b.remotePref).toLowerCase() || 'any';
  const location = normStr(b.location, 140);
  const gigAvailable = !!b.gigAvailable;
  const hourlyRate = b.hourlyRate === '' || b.hourlyRate == null ? null : Number(b.hourlyRate);
  const gigSchedule = gigAvailable ? normStr(b.gigSchedule, 200) : '';
  const maxTravelMi = b.maxTravelMi === '' || b.maxTravelMi == null ? null : Number(b.maxTravelMi);

  if (!REMOTE_PREFS.includes(remotePref)) errors.push('Remote preference must be remote, hybrid, onsite, or any.');
  if (hourlyRate != null && (!Number.isFinite(hourlyRate) || hourlyRate < 0)) errors.push('Hourly rate must be a positive number.');
  if (maxTravelMi != null && (!Number.isFinite(maxTravelMi) || maxTravelMi < 0)) errors.push('Max travel distance must be a positive number.');

  if (errors.length) return { valid: false, errors, clean: null };
  return { valid: true, errors: [], clean: { searchable, openToWork, remotePref, location, gigAvailable, hourlyRate, gigSchedule, maxTravelMi } };
}

function validateContactRequestStatus(status) {
  return CONTACT_REQUEST_STATUSES.includes(String(status || '').toLowerCase());
}

// Simple polite rejection email body — plain, brand-only, no external logos.
function buildRejectionEmail({ candidateName, jobTitle, companyName }) {
  const name = normStr(candidateName) || 'there';
  const role = normStr(jobTitle) || 'this role';
  const company = normStr(companyName) || 'the hiring team';
  const subject = `Update on your application for ${role}`;
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#191512;">
    <p>Hi ${name},</p>
    <p>Thank you for your interest in the <strong>${role}</strong> role at <strong>${company}</strong>. After careful review, we've decided to move forward with other candidates at this time.</p>
    <p>We appreciate the time you put into your application and wish you the best in your search.</p>
    <p style="color:#6B7280;">— ${company}, via ResumeTailored</p>
  </div>`;
  return { subject, html };
}

// Candidate search ranking: Pro employers see all searchable candidates;
// free-tier employers only see a capped slice, and "Open to Work" candidates
// who are themselves Pro-visible sort first. Kept pure so scoring/ordering is
// unit-testable without a DB.
function rankCandidates(candidates, { employerIsPro }) {
  const list = (candidates || []).slice();
  list.sort((a, b) => {
    const aBadge = a.openToWorkPro ? 1 : 0;
    const bBadge = b.openToWorkPro ? 1 : 0;
    if (aBadge !== bBadge) return bBadge - aBadge;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  if (employerIsPro) return list;
  return list.slice(0, 10); // free employer search preview cap
}

// Simple profession + location + rate match for a "Need Staff Fast" gig
// posting — no geocoding, just a substring location match and a rate
// ceiling, which is enough for "who's available and roughly affordable"
// without pretending to be a real logistics/dispatch system. Only
// gigAvailable candidates are considered; everything else about ranking
// (Open-to-Work-Pro priority, free-plan cap) still goes through
// rankCandidates afterward.
function matchGigCandidates(candidates, job) {
  const j = job || {};
  const list = (candidates || []).filter(c => c.gigAvailable);
  const scored = list.map(c => {
    let score = 0;
    if (j.professionId && c.professionId && c.professionId === j.professionId) score += 3;
    if (j.location && c.location && c.location.toLowerCase().includes(String(j.location).toLowerCase())) score += 2;
    if (j.gigRate != null && c.hourlyRate != null) score += c.hourlyRate <= j.gigRate ? 2 : -1;
    return Object.assign({}, c, { matchScore: score });
  });
  scored.sort((a, b) => b.matchScore - a.matchScore || (b.updatedAt || 0) - (a.updatedAt || 0));
  return scored;
}

// ── Interview scheduling (pure validation) ──────────────────────────────────
const INTERVIEW_MODES = ['video', 'phone', 'onsite'];
const INTERVIEW_STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled'];
function validateInterview(body) {
  const b = body || {};
  const errors = [];
  const candidateEmail = normStr(b.candidateEmail, 160).toLowerCase();
  const jobId = b.jobId == null || b.jobId === '' ? null : parseInt(b.jobId, 10);
  const scheduledAt = b.scheduledAt == null ? null : Number(b.scheduledAt);
  const mode = normStr(b.mode).toLowerCase();
  const locationOrLink = normStr(b.locationOrLink, 400);
  const notes = normStr(b.notes, 2000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) errors.push('A valid candidate email is required.');
  if (!scheduledAt || !isFinite(scheduledAt)) errors.push('A scheduled date/time is required.');
  if (!INTERVIEW_MODES.includes(mode)) errors.push('Interview mode must be video, phone or onsite.');
  return { valid: errors.length === 0, errors, clean: { candidateEmail, jobId: Number.isInteger(jobId) ? jobId : null, scheduledAt, mode, locationOrLink, notes } };
}

// ── Analytics (pure) ────────────────────────────────────────────────────────
// Hiring funnel counts from a flat list of application rows { status }.
function buildFunnel(applications) {
  const counts = { new: 0, reviewed: 0, interview: 0, hired: 0, rejected: 0 };
  for (const a of (applications || [])) {
    const s = String(a.status || 'new').toLowerCase();
    if (counts[s] != null) counts[s]++;
  }
  const total = (applications || []).length;
  // The pipeline funnel is cumulative-forward: someone "hired" also passed
  // through reviewed + interview. Present both raw and funnel views.
  const funnel = [
    { stage: 'Applied', count: total },
    { stage: 'Reviewed', count: counts.reviewed + counts.interview + counts.hired },
    { stage: 'Interviewed', count: counts.interview + counts.hired },
    { stage: 'Hired', count: counts.hired }
  ];
  return { counts, total, funnel };
}
// Average days from application created_at to the hire (updated_at when status
// became hired). rows: { status, createdAt, updatedAt }. Returns null when no
// hires yet (never fabricates a number).
function computeTimeToHire(applications) {
  const hires = (applications || []).filter(a => String(a.status).toLowerCase() === 'hired' && a.createdAt && a.updatedAt && a.updatedAt >= a.createdAt);
  if (!hires.length) return null;
  const days = hires.map(a => (a.updatedAt - a.createdAt) / (1000 * 60 * 60 * 24));
  return Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10;
}
// CSV export. rows: array of plain objects; cols: [{key,label}]. Quotes and
// escapes every value so a comma/newline/quote in candidate data can't break
// the file or inject a formula.
function toCsv(rows, cols) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralize spreadsheet formula injection
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = cols.map(c => esc(c.label)).join(',');
  const body = (rows || []).map(r => cols.map(c => esc(r[c.key])).join(',')).join('\r\n');
  return header + '\r\n' + body + '\r\n';
}

// ── AI applicant matching (prompt + validation, pure) ───────────────────────
// The scoring itself runs through Claude in server.js; the prompt and the
// output shape live here so they're stable, versioned and unit-testable, and
// so a test can seed the cache without any LLM call. Bump MATCH_PROMPT_VERSION
// to invalidate cached scores.
const MATCH_PROMPT_VERSION = 1;
function buildApplicantMatchPrompt({ jobTitle, jobDescription, requirements, resumeText }) {
  const system = 'You are an expert technical recruiter and ATS. You score how well a candidate resume matches a specific job. Be objective and consistent. Respond with ONLY a JSON object, no markdown.';
  const user = `JOB TITLE: ${normStr(jobTitle, 200)}

JOB DESCRIPTION:
${normStr(jobDescription, 4000)}

REQUIREMENTS:
${normStr(requirements, 2000) || '(none specified)'}

CANDIDATE RESUME:
${normStr(resumeText, 6000) || '(no resume text available)'}

Return a JSON object exactly like:
{
  "score": <integer 0-100, how well this resume matches THIS job>,
  "reasoning": "<one or two sentences, plain, specific to this candidate>",
  "matchedKeywords": ["<skills/terms from the job the resume clearly demonstrates>"],
  "missingKeywords": ["<important skills/terms from the job the resume is missing>"]
}
Keep each keyword list to at most 10 short items. Score 0 if there is no resume text.`;
  return { system, user };
}
function validateMatchResult(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
  let score = Math.round(Number(obj.score));
  if (!Number.isFinite(score)) return { ok: false, error: 'score not a number' };
  score = Math.max(0, Math.min(100, score));
  const arr = (v) => Array.isArray(v) ? v.map(x => normStr(x, 60)).filter(Boolean).slice(0, 10) : [];
  return { ok: true, value: {
    score,
    reasoning: normStr(obj.reasoning, 400),
    matchedKeywords: arr(obj.matchedKeywords),
    missingKeywords: arr(obj.missingKeywords)
  } };
}

// ── Free→Pro nurture sequence ────────────────────────────────────────────────
// Three plain, brand-only emails that convert a free employer to Pro. `step`
// is 1-based; each returns { subject, html } or null past the last step. Pure
// so the copy is testable and the sender (scripts/employer-nurture.js) stays a
// thin scheduler. No external images — a CSS lockup, same house rule as the
// other transactional emails.
const EMPLOYER_NURTURE_STEPS = 3;
// Days after the FIRST nurture email that each step becomes eligible.
const NURTURE_STEP_DELAY_DAYS = { 1: 0, 2: 3, 3: 7 };
// Given the steps already sent (map step->sentAtMs) and the current time,
// return the next step that is DUE, or null. Pure so the scheduler script is a
// thin wrapper and the pacing is unit-testable. Later steps are paced relative
// to when step 1 was sent; each step is emitted at most once.
function nurtureStepDue(sentSteps, now) {
  const sent = sentSteps || {};
  const firstAt = sent[1] || null;
  const DAY = 24 * 60 * 60 * 1000;
  for (let step = 1; step <= EMPLOYER_NURTURE_STEPS; step++) {
    if (sent[step]) continue;
    if (step > 1 && !firstAt) return null;
    const eligibleAt = step === 1 ? 0 : firstAt + (NURTURE_STEP_DELAY_DAYS[step] || 0) * DAY;
    if (now >= eligibleAt) return step;
    return null;
  }
  return null;
}
function buildEmployerNurtureEmail(step, ctx) {
  const c = ctx || {};
  const company = normStr(c.companyName) || 'there';
  const origin = normStr(c.origin) || 'https://resumetailored.com';
  const cta = (label) => `<p style="margin:22px 0;"><a href="${origin}/employer" style="background:#1F5C3D;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block;">${label}</a></p>`;
  const shell = (inner) => `<div style="font-family:Georgia,serif;max-width:540px;margin:0 auto;color:#191512;line-height:1.55;">${inner}<p style="color:#6B7280;font-size:13px;margin-top:26px;">— ResumeTailored for Employers · <a href="${origin}/employer" style="color:#1F5C3D;">resumetailored.com</a></p></div>`;
  if (step === 1) {
    return { subject: `You've used your 2 free job posts, ${company}`, html: shell(
      `<p>Hi ${company},</p>
       <p>You've posted your two free jobs on ResumeTailored — nice. That's the lifetime limit on the free plan, so your next posting needs <strong>Pro</strong>.</p>
       <p>Pro is <strong>$49/month</strong> and unlocks <strong>unlimited job posts</strong>, <strong>AI candidate matching</strong>, team seats, screener questions and analytics.</p>
       ${cta('Upgrade to Pro — $49/mo')}
       <p>Cancel anytime.</p>`) };
  }
  if (step === 2) {
    return { subject: `See who actually matches your roles`, html: shell(
      `<p>Hi ${company},</p>
       <p>Every applicant to your jobs gets an <strong>AI match score</strong> against the role — matched keywords, missing keywords, and a ranked shortlist. On the free plan you can see your <strong>top 3 matches</strong>; Pro reveals the rest.</p>
       <p>Stop reading resumes top-to-bottom. Let the ranking do the first pass.</p>
       ${cta('Unlock all matches — $49/mo')}` ) };
  }
  if (step === 3) {
    return { subject: `A hiring pipeline your whole team can run`, html: shell(
      `<p>Hi ${company},</p>
       <p>Employer Portal gives your recruiters a shared drag-and-drop pipeline — New → Reviewed → Interview → Hired — plus in-app messaging, one-click reject emails, screener questions and analytics. Hiring more? <strong>Scale ($99/mo)</strong> adds the collaboration layer and five retained operational modules.</p>
       ${cta('Start Pro — $49/mo')}
       <p style="font-size:14px;color:#6B7280;">This is the last nudge — we won't email you about this again.</p>` ) };
  }
  return null;
}

module.exports = {
  WORK_MODES, JOB_TYPES, APPLICATION_STATUSES, EMPLOYER_LIMITS, REMOTE_PREFS, CONTACT_REQUEST_STATUSES, GIG_TYPES,
  INTERVIEW_MODES, INTERVIEW_STATUSES,
  EMPLOYER_TIERS, EMPLOYER_TIER_NAMES, SCREENER_TYPES, EMPLOYER_NURTURE_STEPS, NURTURE_STEP_DELAY_DAYS, MATCH_PROMPT_VERSION,
  tierConfig, canPostJob, resolveEmployerTier, applyMatchGate, validateScreenerQuestions, buildEmployerNurtureEmail, nurtureStepDue, slugifyCompany,
  buildApplicantMatchPrompt, validateMatchResult,
  validateJobPosting, validateApplicationStatus, validateRating,
  validateCandidateProfile, validateContactRequestStatus, validateInterview,
  buildRejectionEmail, rankCandidates, matchGigCandidates,
  buildFunnel, computeTimeToHire, toCsv
};
