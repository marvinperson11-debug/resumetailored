// queue-sync.js — PURE bridge logic between the standalone AutoApply app and
// the main ResumeTailored app's /api/apply-queue (the source of truth).
//
// Deliberately framework-free (no Next, no Prisma, no fetch) so it is unit-
// testable under plain Node and importable from both the TS server code
// (allowJs) and tests. It only maps statuses, normalizes payloads, and builds
// request URLs/headers. All I/O lives in main-app-queue.ts.

// The main app's queue status enum (source of truth).
const MAIN_STATUSES = ['queued', 'auto_filled', 'submitted', 'manual_needed', 'archived'];

// The standalone app's local Prisma enum.
const LOCAL_STATUSES = ['NEW', 'PREPARED', 'APPLIED'];

// main status → local status. The local enum is coarser, so several main
// states fold onto one local state (documented in autoapply/README.md):
//   queued        → NEW      (not yet prepared)
//   auto_filled   → PREPARED (tailored / ready to fill)
//   submitted     → APPLIED
//   manual_needed → NEW      (surfaced to the user to finish by hand)
//   archived      → APPLIED  (out of the active queue)
const MAIN_TO_LOCAL = {
  queued: 'NEW',
  auto_filled: 'PREPARED',
  submitted: 'APPLIED',
  manual_needed: 'NEW',
  archived: 'APPLIED',
};

// local status → main status. The fallback for anything unmapped is
// 'manual_needed' (per the integration spec).
//   NEW      → queued
//   PREPARED → auto_filled
//   APPLIED  → submitted
const LOCAL_TO_MAIN = {
  NEW: 'queued',
  PREPARED: 'auto_filled',
  APPLIED: 'submitted',
};

function mainToLocalStatus(mainStatus) {
  return MAIN_TO_LOCAL[mainStatus] || 'NEW';
}

function localToMainStatus(localStatus) {
  return LOCAL_TO_MAIN[localStatus] || 'manual_needed';
}

// Normalize one item from the main app's GET /api/apply-queue response into the
// shape the standalone app renders/imports. Tolerant of missing fields.
function normalizeMainItem(raw) {
  raw = raw || {};
  const mainStatus = MAIN_STATUSES.includes(raw.status) ? raw.status : 'queued';
  return {
    mainId: raw.id != null ? String(raw.id) : '',
    jobUrl: raw.jobUrl || '',
    roleTitle: raw.jobTitle || '',
    companyName: raw.companyName || '',
    jobBoard: raw.jobBoard || '',
    mainStatus,
    status: mainToLocalStatus(mainStatus),
    updatedAt: raw.updatedAt || null,
  };
}

// Headers proving a trusted service-to-service call to the main app, naming the
// acting user by email (the shared identity between the two apps).
function mainQueueHeaders(serviceToken, email) {
  return {
    'x-rt-service-token': serviceToken || '',
    'x-rt-user-email': (email || '').trim().toLowerCase(),
    'Content-Type': 'application/json',
  };
}

// Join a base origin and a path without doubling or dropping the slash.
function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = String(path || '');
  return b + (p.startsWith('/') ? p : '/' + p);
}

// True only when both the base URL and the service token are configured.
function isBridgeConfigured(baseUrl, serviceToken) {
  return !!(baseUrl && serviceToken);
}

module.exports = {
  MAIN_STATUSES,
  LOCAL_STATUSES,
  MAIN_TO_LOCAL,
  LOCAL_TO_MAIN,
  mainToLocalStatus,
  localToMainStatus,
  normalizeMainItem,
  mainQueueHeaders,
  joinUrl,
  isBridgeConfigured,
};
