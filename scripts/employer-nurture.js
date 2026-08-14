#!/usr/bin/env node
/**
 * Free→Pro employer nurture sequence.
 *
 * Emails free-tier employers who have hit the lifetime free job-post cap
 * (jobs_posted_lifetime >= free limit) and are NOT on a paid employer tier, a
 * 3-step sequence that converts them to Pro. Steps are paced relative to the
 * first send (day 0, day 3, day 7) and each step is sent at most once, tracked
 * in the employer_nurture table so re-running the script is idempotent.
 *
 * Run once a day (cron / the in-process career-cron scheduler):
 *     node scripts/employer-nurture.js
 *
 * Requires RESEND_API_KEY to actually send (otherwise it logs what it WOULD
 * send and records nothing). DATA_DIR must point at the same SQLite dir the app
 * uses. The email copy comes from EH.buildEmployerNurtureEmail so it is
 * unit-tested without sending anything. DRY_RUN=1 forces log-only.
 */
require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const EH = require('../employer-hub.js');

const ORIGIN = process.env.PUBLIC_ORIGIN || 'https://resumetailored.com';
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = new Database(path.join(dataDir, 'resumetailor.db'));
const DRY_RUN = process.env.DRY_RUN === '1' || !process.env.RESEND_API_KEY;

// Owner/comp accounts and real subscribers are never nurtured.
const COMP_EMAILS = (process.env.COMP_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function isPaidEmployer(email) {
  const e = email.toLowerCase();
  if (e === (process.env.OWNER_EMAIL || 'support@resumetailored.com').toLowerCase()) return true;
  if (COMP_EMAILS.includes(e)) return true;
  const row = db.prepare('SELECT status FROM employer_subscribers WHERE email = ?').get(e);
  return !!row && (!row.status || row.status === 'active');
}

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'ResumeTailored <noreply@resumetailored.com>', to, subject, html })
    });
    if (!r.ok) { console.error(`[employer-nurture] send to ${to} failed: ${r.status}`); return false; }
    return true;
  } catch (e) { console.error(`[employer-nurture] send to ${to} error: ${e.message}`); return false; }
}

// Which step (if any) is due for this employer right now — pacing lives in the
// pure EH.nurtureStepDue so it's unit-tested; this just loads the sent map.
function dueStep(email, now) {
  const sent = {};
  for (const r of db.prepare('SELECT step, sent_at FROM employer_nurture WHERE employer_email = ?').all(email)) sent[r.step] = r.sent_at;
  return EH.nurtureStepDue(sent, now);
}

(async () => {
  const limit = EH.EMPLOYER_TIERS.free.lifetimeJobs;
  const capped = db.prepare('SELECT email, company_name FROM employer_profiles WHERE jobs_posted_lifetime >= ?').all(limit);
  console.log(`[employer-nurture] ${capped.length} employer(s) at/over the free cap${DRY_RUN ? ' (DRY RUN — no email sent)' : ''}`);
  const now = Date.now();
  let sent = 0, skipped = 0;
  for (const emp of capped) {
    if (isPaidEmployer(emp.email)) { skipped++; continue; }
    const step = dueStep(emp.email, now);
    if (!step) { skipped++; continue; }
    const mail = EH.buildEmployerNurtureEmail(step, { companyName: emp.company_name, origin: ORIGIN });
    if (!mail) { skipped++; continue; }
    if (DRY_RUN) {
      console.log(`[employer-nurture] WOULD send step ${step} to ${emp.email}: "${mail.subject}"`);
      skipped++; continue;
    }
    if (await sendEmail(emp.email, mail.subject, mail.html)) {
      db.prepare('INSERT OR IGNORE INTO employer_nurture (employer_email, step, sent_at) VALUES (?,?,?)').run(emp.email, step, now);
      sent++;
    } else skipped++;
  }
  console.log(`[employer-nurture] sent ${sent}, skipped ${skipped}`);
  process.exit(0);
})();
