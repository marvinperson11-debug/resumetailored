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

// Free employer plan: 3 ACTIVE (non-closed) job posts. Pro Employer ($29/mo)
// is unlimited plus full candidate search + ATS + priority listing.
const EMPLOYER_LIMITS = {
  freeActiveJobs: 3
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

module.exports = {
  WORK_MODES, JOB_TYPES, APPLICATION_STATUSES, EMPLOYER_LIMITS, REMOTE_PREFS, CONTACT_REQUEST_STATUSES, GIG_TYPES,
  INTERVIEW_MODES, INTERVIEW_STATUSES,
  validateJobPosting, validateApplicationStatus, validateRating,
  validateCandidateProfile, validateContactRequestStatus, validateInterview,
  buildRejectionEmail, rankCandidates, matchGigCandidates,
  buildFunnel, computeTimeToHire, toCsv
};
