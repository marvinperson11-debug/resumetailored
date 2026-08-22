/* employer-modules.js — pure, testable core for the Employer Portal's
 * operational-module engine, RBAC, and the Base Collaboration Layer.
 *
 * Mirrors the employer-hub.js / career-hub.js pattern: everything that can be
 * reasoned about without a database or an HTTP request lives here (the module
 * registry, per-module record schemas + validation, tier gating, the Scale
 * "5 modules, then locked forever" rule, role-based access control, and the
 * manager-analytics aggregation). server.js wires this into SQLite + auth.
 *
 * There is ONE source of truth for which operational modules an employer has
 * active: Corporate has them all; Scale has exactly the five it confirmed once
 * (stored in `corporate_module_selections` by display name). This module
 * translates between the display names used there and the stable keys used by
 * the record engine.
 */
'use strict';

const { toCsv } = require('./employer-hub.js');

// ── The 21 operational modules ───────────────────────────────────────────────
// `key` is the stable slug the record engine + routes use; `name` is the exact
// display name stored in corporate_module_selections and shown in corporate.js
// (they MUST match, char-for-char, or Scale activation can't be resolved).
// `category` mirrors corporate.js (people | operations | intelligence).
// `statuses` is the allowed lifecycle for a record; the first is the default.
// `fields` drives generic form rendering + validation. `employee` says what an
// Employee role may do on this module: 'submit' (create/read their OWN records),
// 'read' (read-only), or 'none' (managers/admins only).
const MODULE_REGISTRY = Object.freeze([
  { key: 'handbook',      name: 'Handbook Wizard',                       category: 'people',       recordLabel: 'Handbook section', statuses: ['draft', 'published', 'archived'], employee: 'read',
    fields: [{ key: 'title', label: 'Section title', type: 'text', required: true }, { key: 'category', label: 'Category', type: 'text' }, { key: 'body', label: 'Content', type: 'longtext' }, { key: 'version', label: 'Version', type: 'text' }] },
  { key: 'compliance',    name: 'Compliance Vault',                      category: 'operations',   recordLabel: 'Compliance document', statuses: ['active', 'expiring', 'expired', 'archived'], employee: 'none',
    fields: [{ key: 'title', label: 'Document', type: 'text', required: true }, { key: 'authority', label: 'Regulatory authority', type: 'text' }, { key: 'expiresAt', label: 'Expiry date', type: 'date' }, { key: 'notes', label: 'Notes', type: 'longtext' }] },
  { key: 'onboarding',    name: 'Automated Onboarding',                  category: 'people',       recordLabel: 'Onboarding task', statuses: ['assigned', 'in_progress', 'complete'], employee: 'submit',
    fields: [{ key: 'title', label: 'Task', type: 'text', required: true }, { key: 'track', label: 'Track', type: 'text' }, { key: 'dueAt', label: 'Due', type: 'date' }, { key: 'requiresSignature', label: 'Requires signature', type: 'bool' }] },
  { key: 'resource-optimizer', name: 'Resource Optimizer',              category: 'intelligence', recordLabel: 'Utilization entry', statuses: ['open', 'reviewed', 'actioned'], employee: 'none',
    fields: [{ key: 'title', label: 'Team / role', type: 'text', required: true }, { key: 'utilization', label: 'Utilization %', type: 'number' }, { key: 'recommendation', label: 'Recommendation', type: 'longtext' }] },
  { key: 'incidents',     name: 'Incident Reporter',                     category: 'people',       recordLabel: 'Incident report', statuses: ['submitted', 'investigating', 'resolved', 'closed'], employee: 'submit', confidential: true,
    fields: [{ key: 'title', label: 'Summary', type: 'text', required: true }, { key: 'category', label: 'Category', type: 'text' }, { key: 'details', label: 'What happened', type: 'longtext', required: true }, { key: 'anonymous', label: 'Report anonymously', type: 'bool' }] },
  { key: 'supply-chain',  name: 'Supply Chain Hub',                      category: 'operations',   recordLabel: 'Inventory item', statuses: ['in_stock', 'low', 'out'], employee: 'read',
    fields: [{ key: 'title', label: 'Item', type: 'text', required: true }, { key: 'sku', label: 'SKU / barcode', type: 'text' }, { key: 'quantity', label: 'On hand', type: 'number' }, { key: 'reorderAt', label: 'Reorder level', type: 'number' }] },
  { key: 'suppliers',     name: 'Supplier Hub',                          category: 'operations',   recordLabel: 'Supplier', statuses: ['active', 'on_hold', 'inactive'], employee: 'none',
    fields: [{ key: 'title', label: 'Supplier', type: 'text', required: true }, { key: 'contact', label: 'Contact', type: 'text' }, { key: 'terms', label: 'Terms', type: 'text' }, { key: 'reorderUrl', label: 'Reorder link', type: 'url' }] },
  { key: 'spreadsheets',  name: 'AI Spreadsheet Engine',                 category: 'intelligence', recordLabel: 'Spreadsheet', statuses: ['draft', 'final'], employee: 'none',
    fields: [{ key: 'title', label: 'Sheet name', type: 'text', required: true }, { key: 'grid', label: 'Grid (CSV)', type: 'longtext' }] },
  { key: 'internal-email', name: 'Internal Email System',                category: 'operations',   recordLabel: 'Internal message', statuses: ['draft', 'sent'], employee: 'read',
    fields: [{ key: 'title', label: 'Subject', type: 'text', required: true }, { key: 'to', label: 'To', type: 'text' }, { key: 'body', label: 'Body', type: 'longtext' }] },
  { key: 'esignature',    name: 'E-Signature Engine',                    category: 'operations',   recordLabel: 'Signature request', statuses: ['sent', 'signed', 'declined', 'expired'], employee: 'submit',
    fields: [{ key: 'title', label: 'Document', type: 'text', required: true }, { key: 'signerEmail', label: 'Signer', type: 'email', required: true }, { key: 'kind', label: 'Type', type: 'text' }] },
  { key: 'ats',           name: 'Applicant Tracking System (ATS)',       category: 'people',       recordLabel: 'Candidate', statuses: ['new', 'reviewed', 'interview', 'offer', 'hired', 'rejected'], employee: 'none',
    fields: [{ key: 'title', label: 'Candidate', type: 'text', required: true }, { key: 'role', label: 'Role', type: 'text' }, { key: 'score', label: 'Score', type: 'number' }, { key: 'notes', label: 'Notes', type: 'longtext' }] },
  { key: 'pulse',         name: 'Pulse Surveys / Engagement',            category: 'people',       recordLabel: 'Pulse response', statuses: ['open', 'closed'], employee: 'submit', anonymousOk: true,
    fields: [{ key: 'title', label: 'Survey', type: 'text', required: true }, { key: 'score', label: 'Score (0-10)', type: 'number' }, { key: 'comment', label: 'Comment', type: 'longtext' }] },
  { key: 'recognition',   name: 'Employee Recognition',                  category: 'people',       recordLabel: 'Kudos', statuses: ['posted'], employee: 'submit',
    fields: [{ key: 'title', label: 'Recognition', type: 'text', required: true }, { key: 'to', label: 'To', type: 'text', required: true }, { key: 'badge', label: 'Badge', type: 'text' }] },
  { key: 'reviews',       name: '360° Performance Reviews',              category: 'people',       recordLabel: 'Review', statuses: ['requested', 'submitted', 'calibrated'], employee: 'submit',
    fields: [{ key: 'title', label: 'Subject', type: 'text', required: true }, { key: 'kind', label: 'Rater (peer/manager/self)', type: 'text' }, { key: 'score', label: 'Score', type: 'number' }, { key: 'comments', label: 'Comments', type: 'longtext' }] },
  { key: 'training',      name: 'Training & LMS',                        category: 'people',       recordLabel: 'Course', statuses: ['assigned', 'in_progress', 'completed'], employee: 'submit',
    fields: [{ key: 'title', label: 'Course', type: 'text', required: true }, { key: 'path', label: 'Learning path', type: 'text' }, { key: 'mandatory', label: 'Mandatory', type: 'bool' }] },
  { key: 'shifts',        name: 'Shift Scheduling',                      category: 'operations',   recordLabel: 'Shift', statuses: ['open', 'assigned', 'swapped', 'covered'], employee: 'read',
    fields: [{ key: 'title', label: 'Shift', type: 'text', required: true }, { key: 'startsAt', label: 'Starts', type: 'datetime' }, { key: 'endsAt', label: 'Ends', type: 'datetime' }, { key: 'assignee', label: 'Assignee', type: 'text' }] },
  { key: 'timeclock',     name: 'Time Clock & Attendance',               category: 'operations',   recordLabel: 'Time entry', statuses: ['open', 'closed', 'flagged'], employee: 'submit',
    fields: [{ key: 'title', label: 'Entry', type: 'text' }, { key: 'clockIn', label: 'Clock in', type: 'datetime' }, { key: 'clockOut', label: 'Clock out', type: 'datetime' }, { key: 'kind', label: 'Type (shift/PTO)', type: 'text' }] },
  { key: 'expenses',      name: 'Expense & Financial Document Tracker',  category: 'operations',   recordLabel: 'Expense', statuses: ['pending', 'approved', 'rejected', 'reimbursed'], employee: 'submit',
    fields: [{ key: 'title', label: 'Expense', type: 'text', required: true }, { key: 'amount', label: 'Amount', type: 'number', required: true }, { key: 'category', label: 'Category', type: 'text' }, { key: 'receiptUrl', label: 'Receipt', type: 'url' }] },
  { key: 'analytics',     name: 'Manager Analytics Dashboard',           category: 'intelligence', recordLabel: 'Saved view', statuses: ['active'], employee: 'none',
    fields: [{ key: 'title', label: 'View', type: 'text', required: true }, { key: 'config', label: 'Config', type: 'longtext' }] },
  { key: 'help-center',   name: 'Help Center / Knowledge Base',          category: 'intelligence', recordLabel: 'Article', statuses: ['draft', 'published'], employee: 'read',
    fields: [{ key: 'title', label: 'Title', type: 'text', required: true }, { key: 'module', label: 'For module', type: 'text' }, { key: 'body', label: 'Body', type: 'longtext' }] },
  { key: 'data-export',   name: 'Data Export / Portability',            category: 'operations',   recordLabel: 'Export job', statuses: ['ready'], employee: 'none',
    fields: [{ key: 'title', label: 'Export', type: 'text', required: true }, { key: 'scope', label: 'Scope', type: 'text' }] }
]);

// ── The Base Collaboration Layer (always active for Scale & Corporate) ────────
// These are not gated by the Scale "pick 5" rule — they're the shared substrate.
const COLLAB_LAYER = Object.freeze([
  { key: 'chat',      name: 'Internal Chat / Messaging' },
  { key: 'video',     name: 'Video Conferencing' },
  { key: 'drive',     name: 'Shared Drive / Document Vault' },
  { key: 'directory', name: 'Employee Directory' },
  { key: 'calendar',  name: 'Company Calendar' },
  { key: 'copilot',   name: 'Cross-Module AI Copilot' }
]);

const MODULE_KEYS = Object.freeze(MODULE_REGISTRY.map(m => m.key));
const MODULE_BY_KEY = Object.freeze(Object.fromEntries(MODULE_REGISTRY.map(m => [m.key, m])));
const MODULE_BY_NAME = Object.freeze(Object.fromEntries(MODULE_REGISTRY.map(m => [m.name, m])));
const COLLAB_KEYS = Object.freeze(COLLAB_LAYER.map(c => c.key));

function moduleByKey(key) { return MODULE_BY_KEY[String(key || '')] || null; }
function moduleKeyForName(name) { const m = MODULE_BY_NAME[String(name || '')]; return m ? m.key : null; }
function moduleNameForKey(key) { const m = moduleByKey(key); return m ? m.name : null; }

// ── RBAC ─────────────────────────────────────────────────────────────────────
const ROLES = ['admin', 'manager', 'employee'];
const ROLE_RANK = { admin: 3, manager: 2, employee: 1 };
function normRole(role) { const r = String(role || '').toLowerCase(); return ROLES.includes(r) ? r : 'employee'; }
function roleAtLeast(role, min) { return (ROLE_RANK[normRole(role)] || 0) >= (ROLE_RANK[normRole(min)] || 0); }

// What can `role` do on `moduleKey`?
//   read   — see records (employee: only their own, unless module employee==='read'/'none' rules apply)
//   write  — create/update records
//   manage — change status of others' records, delete, export
// Admins can do everything. Managers can read/write/manage every activated
// module. Employees are bounded by the module's `employee` capability.
function modulePermissions(role, moduleKey) {
  const m = moduleByKey(moduleKey);
  const r = normRole(role);
  if (!m) return { read: false, write: false, manage: false, ownOnly: false };
  if (r === 'admin') return { read: true, write: true, manage: true, ownOnly: false };
  if (r === 'manager') return { read: true, write: true, manage: true, ownOnly: false };
  // employee
  if (m.employee === 'submit') return { read: true, write: true, manage: false, ownOnly: true };
  if (m.employee === 'read')   return { read: true, write: false, manage: false, ownOnly: false };
  return { read: false, write: false, manage: false, ownOnly: false }; // 'none'
}

// ── Tier gating + the Scale "5 modules, locked forever" rule ─────────────────
// Which module keys does an employer of `tier` have active, given the display
// names they confirmed (Scale) or nothing (Corporate = all)?
function activeModuleKeys(tier, confirmedNames) {
  const t = String(tier || 'free').toLowerCase();
  if (t === 'corporate') return MODULE_KEYS.slice();
  if (t === 'scale') {
    return (confirmedNames || []).map(moduleKeyForName).filter(Boolean);
  }
  return []; // free / pro (Employer Portal) have no operational modules
}
function isModuleActive({ tier, confirmedNames, moduleKey }) {
  return activeModuleKeys(tier, confirmedNames).includes(String(moduleKey || ''));
}

// Can this employer ACTIVATE `moduleKey` right now? Corporate: always (all are
// active). Scale: only while fewer than 5 are confirmed AND the module isn't
// already active. Once 5 are confirmed the selection is permanent → 403.
const SCALE_MODULE_CAP = 5;
function canActivateModule({ tier, confirmedNames, moduleKey }) {
  const t = String(tier || 'free').toLowerCase();
  const names = confirmedNames || [];
  if (!moduleByKey(moduleKey)) return { allowed: false, code: 'unknown_module', status: 400, message: 'Unknown module.' };
  if (t === 'corporate') return { allowed: true, code: 'ok', status: 200, message: 'All modules are active on Corporate.' };
  if (t !== 'scale') return { allowed: false, code: 'tier_required', status: 402, message: 'Operational modules require Scale or Corporate.' };
  const activeKeys = activeModuleKeys(t, names);
  if (activeKeys.includes(moduleKey)) return { allowed: false, code: 'already_active', status: 409, message: 'That module is already active.' };
  if (activeKeys.length >= SCALE_MODULE_CAP) {
    return { allowed: false, code: 'scale_cap', status: 403, message: 'Scale tier limited to 5 modules. Upgrade to Corporate for full access.' };
  }
  return { allowed: true, code: 'ok', status: 200, message: 'Module can be activated.' };
}

// ── Record validation (generic, schema-driven) ───────────────────────────────
function normStr(v, max) { const s = (v == null ? '' : String(v)).trim(); return max ? s.slice(0, max) : s; }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validate a record body against its module schema. Returns { valid, errors,
// clean } where clean = { title, status, data } ready to persist. Unknown
// fields are dropped (never persisted), so a client can't smuggle extra keys.
function validateRecord(moduleKey, body, { status } = {}) {
  const m = moduleByKey(moduleKey);
  if (!m) return { valid: false, errors: ['Unknown module.'], clean: null };
  const b = body || {};
  const errors = [];
  const data = {};
  let title = normStr(b.title, 200);
  for (const f of m.fields) {
    let v = b[f.key];
    switch (f.type) {
      case 'number': v = (v === '' || v == null) ? null : Number(v); if (v != null && !Number.isFinite(v)) errors.push(`${f.label} must be a number.`); break;
      case 'bool': v = !!v; break;
      case 'email': v = normStr(v, 200).toLowerCase(); if (f.required && !EMAIL_RE.test(v)) errors.push(`${f.label} must be a valid email.`); break;
      case 'url': v = normStr(v, 500); break;
      case 'longtext': v = normStr(v, 20000); break;
      case 'date': case 'datetime': v = (v === '' || v == null) ? null : normStr(v, 40); break;
      default: v = normStr(v, 2000);
    }
    if (f.required && (v === '' || v == null) && f.type !== 'bool' && f.type !== 'email') errors.push(`${f.label} is required.`);
    data[f.key] = v;
  }
  if (!title) title = normStr(data.title || data.name, 200);
  if (!title) errors.push('A title is required.');
  let st = normStr(status || b.status).toLowerCase();
  if (!st) st = m.statuses[0];
  if (!m.statuses.includes(st)) errors.push(`Status must be one of: ${m.statuses.join(', ')}.`);
  if (errors.length) return { valid: false, errors, clean: null };
  return { valid: true, errors: [], clean: { title, status: st, data } };
}

function validateStatusTransition(moduleKey, status) {
  const m = moduleByKey(moduleKey);
  if (!m) return false;
  return m.statuses.includes(String(status || '').toLowerCase());
}

// ── Manager Analytics (pure aggregation over records) ────────────────────────
// records: flat list of { module_key, status, data (obj), created_at, updated_at }.
function buildManagerAnalytics(records) {
  const rows = records || [];
  const byModule = {};
  for (const r of rows) {
    const k = r.module_key;
    byModule[k] = byModule[k] || { total: 0, byStatus: {} };
    byModule[k].total++;
    const s = String(r.status || '').toLowerCase();
    byModule[k].byStatus[s] = (byModule[k].byStatus[s] || 0) + 1;
  }
  const num = (r, key) => { const v = r.data && r.data[key]; const n = Number(v); return Number.isFinite(n) ? n : null; };
  // A few cross-module KPIs the plan names explicitly.
  const ats = rows.filter(r => r.module_key === 'ats');
  const hires = ats.filter(r => r.status === 'hired').length;
  const openReqs = ats.filter(r => !['hired', 'rejected'].includes(r.status)).length;
  const incidents = rows.filter(r => r.module_key === 'incidents');
  const openIncidents = incidents.filter(r => !['resolved', 'closed'].includes(r.status)).length;
  const expenses = rows.filter(r => r.module_key === 'expenses');
  const pendingExpense = expenses.filter(r => r.status === 'pending')
    .reduce((s, r) => s + (num(r, 'amount') || 0), 0);
  const pulse = rows.filter(r => r.module_key === 'pulse').map(r => num(r, 'score')).filter(n => n != null);
  const enps = pulse.length ? Math.round((pulse.reduce((s, n) => s + n, 0) / pulse.length) * 10) / 10 : null;
  return {
    modules: byModule,
    kpis: {
      hires, openRequisitions: openReqs,
      openIncidents, incidentTotal: incidents.length,
      pendingExpenseTotal: Math.round(pendingExpense * 100) / 100,
      avgPulse: enps,
      totalRecords: rows.length
    }
  };
}

// CSV export of a module's records: title, status, timestamps, then its fields.
function recordsToCsv(moduleKey, records) {
  const m = moduleByKey(moduleKey);
  if (!m) return 'error\r\nUnknown module\r\n';
  const cols = [{ key: 'title', label: 'Title' }, { key: 'status', label: 'Status' }]
    .concat(m.fields.filter(f => f.key !== 'title').map(f => ({ key: f.key, label: f.label })))
    .concat([{ key: 'created_at', label: 'Created' }, { key: 'updated_at', label: 'Updated' }]);
  const rows = (records || []).map(r => {
    const flat = {};
    for (const f of m.fields) if (f.key !== 'title') flat[f.key] = (r.data && r.data[f.key] != null) ? r.data[f.key] : '';
    flat.title = r.title; flat.status = r.status; flat.created_at = r.created_at; flat.updated_at = r.updated_at;
    return flat;
  });
  return toCsv(rows, cols);
}

module.exports = {
  MODULE_REGISTRY, COLLAB_LAYER, MODULE_KEYS, COLLAB_KEYS, SCALE_MODULE_CAP, ROLES, ROLE_RANK,
  moduleByKey, moduleKeyForName, moduleNameForKey,
  normRole, roleAtLeast, modulePermissions,
  activeModuleKeys, isModuleActive, canActivateModule,
  validateRecord, validateStatusTransition,
  buildManagerAnalytics, recordsToCsv
};
