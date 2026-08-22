#!/usr/bin/env node
/**
 * Employer module engine — pure core (employer-modules.js).
 * Deterministic, offline. Registry, RBAC, tier gating, the Scale 5-module lock,
 * record validation, analytics, CSV. Usage: node test/employer-modules.js
 */
const EM = require('../employer-modules.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── registry ────────────────────────────────────────────────────────────────
check('registry has exactly 21 operational modules', EM.MODULE_REGISTRY.length === 21, String(EM.MODULE_REGISTRY.length));
check('collaboration layer has 6 members', EM.COLLAB_LAYER.length === 6);
check('every module has a unique key', new Set(EM.MODULE_KEYS).size === 21);
check('every module has a category in the known set', EM.MODULE_REGISTRY.every(m => ['people', 'operations', 'intelligence'].includes(m.category)));
check('every module has at least one status', EM.MODULE_REGISTRY.every(m => m.statuses.length >= 1));
check('name↔key round-trips', EM.moduleKeyForName('Handbook Wizard') === 'handbook' && EM.moduleNameForKey('handbook') === 'Handbook Wizard');
check('unknown module resolves to null', EM.moduleByKey('nope') === null && EM.moduleKeyForName('Nope') === null);

// The 21 names MUST match the corporate.js display names exactly (that's the
// join key for Scale activation). Spot-check the tricky ones.
check('ATS name matches the display name exactly', !!EM.moduleByKey('ats') && EM.moduleByKey('ats').name === 'Applicant Tracking System (ATS)');
check('360 reviews name matches exactly', EM.moduleNameForKey('reviews') === '360° Performance Reviews');

// ── RBAC ────────────────────────────────────────────────────────────────────
check('admin can manage any module', EM.modulePermissions('admin', 'expenses').manage === true);
check('manager can write any module', EM.modulePermissions('manager', 'compliance').write === true);
check('employee can submit to expenses but only their own', (() => { const p = EM.modulePermissions('employee', 'expenses'); return p.write && p.ownOnly && !p.manage; })());
check('employee cannot write to compliance (none)', EM.modulePermissions('employee', 'compliance').write === false);
check('employee can read handbook but not write', (() => { const p = EM.modulePermissions('employee', 'handbook'); return p.read && !p.write; })());
check('unknown role normalizes to employee', EM.normRole('wizard') === 'employee');
check('roleAtLeast is a rank check', EM.roleAtLeast('admin', 'manager') && EM.roleAtLeast('manager', 'employee') && !EM.roleAtLeast('employee', 'manager'));

// ── tier gating + Scale 5-lock ──────────────────────────────────────────────
check('corporate has all 21 modules active', EM.activeModuleKeys('corporate').length === 21);
check('free/pro have no operational modules', EM.activeModuleKeys('free').length === 0 && EM.activeModuleKeys('pro').length === 0);
const fiveNames = ['Handbook Wizard', 'Compliance Vault', 'Automated Onboarding', 'Incident Reporter', 'Time Clock & Attendance'];
check('scale active set = its 5 confirmed modules', EM.activeModuleKeys('scale', fiveNames).length === 5);
check('isModuleActive true for a confirmed scale module', EM.isModuleActive({ tier: 'scale', confirmedNames: fiveNames, moduleKey: 'handbook' }));
check('isModuleActive false for an unconfirmed scale module', !EM.isModuleActive({ tier: 'scale', confirmedNames: fiveNames, moduleKey: 'expenses' }));

check('corporate can always activate (all active)', EM.canActivateModule({ tier: 'corporate', confirmedNames: [], moduleKey: 'ats' }).allowed);
check('free cannot activate — 402 tier_required', (() => { const r = EM.canActivateModule({ tier: 'free', confirmedNames: [], moduleKey: 'ats' }); return !r.allowed && r.status === 402; })());
check('scale can activate a 6th → 403 scale_cap with the exact message', (() => {
  const r = EM.canActivateModule({ tier: 'scale', confirmedNames: fiveNames, moduleKey: 'expenses' });
  return !r.allowed && r.status === 403 && r.code === 'scale_cap' && /limited to 5 modules/.test(r.message) && /Upgrade to Corporate/.test(r.message);
})());
check('scale can activate a 2nd when only 1 confirmed', EM.canActivateModule({ tier: 'scale', confirmedNames: ['Handbook Wizard'], moduleKey: 'expenses' }).allowed);
check('scale re-activating an active module → 409', EM.canActivateModule({ tier: 'scale', confirmedNames: fiveNames, moduleKey: 'handbook' }).status === 409);

// ── record validation ───────────────────────────────────────────────────────
const okExpense = EM.validateRecord('expenses', { title: 'Client dinner', amount: '82.50', category: 'Meals' });
check('validates a well-formed expense', okExpense.valid, JSON.stringify(okExpense.errors));
check('expense amount coerced to number', okExpense.clean.data.amount === 82.5);
check('default status applied', okExpense.clean.status === 'pending');
check('rejects missing required title', !EM.validateRecord('expenses', { amount: 5 }).valid);
check('rejects a non-numeric number field', !EM.validateRecord('expenses', { title: 'x', amount: 'lots' }).valid);
check('rejects an invalid status', !EM.validateRecord('handbook', { title: 'Leave policy', status: 'nonsense' }).valid);
check('rejects an unknown module', !EM.validateRecord('nope', { title: 'x' }).valid);
check('drops unknown fields (no smuggling)', (() => { const r = EM.validateRecord('handbook', { title: 'Ok', evil: 'x' }); return r.valid && r.clean.data.evil === undefined; })());
check('esignature requires a valid signer email', !EM.validateRecord('esignature', { title: 'NDA', signerEmail: 'notanemail' }).valid);
check('validateStatusTransition guards statuses', EM.validateStatusTransition('ats', 'hired') && !EM.validateStatusTransition('ats', 'moon'));

// ── analytics ───────────────────────────────────────────────────────────────
const recs = [
  { module_key: 'ats', status: 'hired', data: {} },
  { module_key: 'ats', status: 'interview', data: {} },
  { module_key: 'incidents', status: 'submitted', data: {} },
  { module_key: 'incidents', status: 'resolved', data: {} },
  { module_key: 'expenses', status: 'pending', data: { amount: 100 } },
  { module_key: 'expenses', status: 'pending', data: { amount: 50 } },
  { module_key: 'pulse', status: 'open', data: { score: 8 } },
  { module_key: 'pulse', status: 'open', data: { score: 6 } }
];
const an = EM.buildManagerAnalytics(recs);
check('analytics counts hires', an.kpis.hires === 1);
check('analytics counts open requisitions (non-terminal ATS)', an.kpis.openRequisitions === 1);
check('analytics counts open incidents', an.kpis.openIncidents === 1);
check('analytics sums pending expenses', an.kpis.pendingExpenseTotal === 150);
check('analytics averages pulse', an.kpis.avgPulse === 7);
check('analytics groups by module + status', an.modules.ats.total === 2 && an.modules.ats.byStatus.hired === 1);

// ── CSV ─────────────────────────────────────────────────────────────────────
const csv = EM.recordsToCsv('expenses', [{ title: 'Dinner', status: 'pending', data: { amount: 82.5, category: 'Meals' }, created_at: 1, updated_at: 2 }]);
check('CSV has a header + row', /Title,Status/.test(csv) && /Dinner,pending/.test(csv));
check('CSV neutralizes formula injection', EM.recordsToCsv('handbook', [{ title: '=cmd()', status: 'draft', data: {}, created_at: 1, updated_at: 1 }]).includes("'=cmd()"));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS (0 failures)');
process.exit(failures ? 1 : 0);
