#!/usr/bin/env node
/**
 * Weekly Job Search Report — Monday digest (Pro-only).
 *
 * For every user who turned on the Weekly Job Search Report
 * (weekly_report_subscriptions.is_enabled = 1) AND is still a Pro subscriber,
 * compute last week's job-search stats from their `applications` tracker and
 * email a summary + action items via Resend.
 *
 * Run once a week (Monday) — hooked into career-cron.js, or standalone:
 *     node scripts/weekly-report.js
 *
 * Requires RESEND_API_KEY (email). DATA_DIR must point at the same SQLite dir
 * the app uses. The email HTML is built by the pure TOOLS.buildWeeklyReportEmail
 * so it is unit-tested without sending anything.
 */
require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const TOOLS = require('../tools-core.js');

const ORIGIN = process.env.PUBLIC_ORIGIN || 'https://resumetailored.com';
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = new Database(path.join(dataDir, 'resumetailor.db'));

// Mirrors server.js's isSubscriber() locally (this script doesn't boot the app).
const COMP_EMAILS = (process.env.COMP_EMAILS || 'marvinperson11@gmail.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function isPro(email) {
  const e = email.toLowerCase();
  if (e === (process.env.OWNER_EMAIL || 'support@resumetailored.com').toLowerCase()) return true;
  if (COMP_EMAILS.includes(e)) return true;
  return !!db.prepare('SELECT 1 FROM subscribers WHERE email = ?').get(e);
}

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'ResumeTailored <support@resumetailored.com>';
  if (!key) { console.log(`[dry-run] would email ${to}: ${subject}`); return true; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html })
  });
  return r.ok;
}

// Compute last-week stats from the candidate `applications` tracker. Follow-ups
// are Applied rows older than 7 days with no reply moved yet.
function statsFor(email) {
  const weekAgoISO = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const rows = db.prepare('SELECT company, job_title, status, date_applied FROM applications WHERE user_email = ?').all(email.toLowerCase());
  let applied = 0, responses = 0, interviews = 0;
  const stale = [];
  const respondedStatuses = new Set(['Phone Screen', 'Interview', 'Offer', 'Rejected']);
  const interviewStatuses = new Set(['Interview', 'Offer']);
  for (const a of rows) {
    if (a.date_applied && a.date_applied >= weekAgoISO) applied++;
    if (respondedStatuses.has(a.status)) responses++;
    if (interviewStatuses.has(a.status)) interviews++;
    if (a.status === 'Applied' && a.date_applied) {
      const days = Math.floor((Date.now() - new Date(a.date_applied).getTime()) / (24 * 3600 * 1000));
      if (days >= 7) stale.push({ company: a.company, role: a.job_title, days });
    }
  }
  stale.sort((x, y) => y.days - x.days);
  return { applied, responses, interviews, staleFollowUps: stale.slice(0, 5), hasAny: rows.length > 0 };
}

(async () => {
  const subs = db.prepare('SELECT user_email FROM weekly_report_subscriptions WHERE is_enabled = 1').all();
  console.log(`[weekly-report] ${subs.length} subscriber(s)`);
  let sent = 0, skipped = 0;
  for (const row of subs) {
    const email = row.user_email;
    // Weekly Job Search Report is a FREE tool — send to every enabled
    // subscriber regardless of plan (no Pro filter).
    try {
      const stats = statsFor(email);
      const user = db.prepare('SELECT username FROM users WHERE email = ?').get(email);
      const { subject, html } = TOOLS.buildWeeklyReportEmail({ name: (user && user.username) || '', stats, origin: ORIGIN });
      if (await sendEmail(email, subject, html)) {
        db.prepare("UPDATE weekly_report_subscriptions SET last_sent_at = datetime('now') WHERE user_email = ?").run(email);
        sent++;
      }
    } catch (e) {
      console.error(`[weekly-report] ${email}: ${e.message}`);
      skipped++;
    }
  }
  console.log(`[weekly-report] sent ${sent}, skipped ${skipped}`);
  process.exit(0);
})();
