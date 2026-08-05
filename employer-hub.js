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

  if (title.length < 3) errors.push('Job title is required.');
  if (description.length < 20) errors.push('A fuller job description is required (at least 20 characters).');
  if (!WORK_MODES.includes(workMode)) errors.push('Work mode must be remote, hybrid, or onsite.');
  if (!JOB_TYPES.includes(jobType)) errors.push('Job type must be full-time, part-time, contract, or temp.');
  if (salaryMin != null && (!Number.isFinite(salaryMin) || salaryMin < 0)) errors.push('Minimum salary must be a positive number.');
  if (salaryMax != null && (!Number.isFinite(salaryMax) || salaryMax < 0)) errors.push('Maximum salary must be a positive number.');
  if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) errors.push('Minimum salary cannot exceed maximum salary.');
  if (gigRate != null && (!Number.isFinite(gigRate) || gigRate < 0)) errors.push('Gig hourly rate must be a positive number.');

  if (errors.length) return { valid: false, errors, clean: null };
  return {
    valid: true,
    errors: [],
    clean: { title, description, requirements, location, workMode, jobType, salaryMin, salaryMax, isGig, gigRate, gigSchedule }
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

module.exports = {
  WORK_MODES, JOB_TYPES, APPLICATION_STATUSES, EMPLOYER_LIMITS, REMOTE_PREFS, CONTACT_REQUEST_STATUSES,
  validateJobPosting, validateApplicationStatus, validateRating,
  validateCandidateProfile, validateContactRequestStatus,
  buildRejectionEmail, rankCandidates
};
