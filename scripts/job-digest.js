#!/usr/bin/env node
/**
 * Daily job-alert digest.
 *
 * For every user who turned on job alerts in the Career Hub Job Finder
 * (check_ins.job_alerts = 1) and has a saved profession, search JSearch for
 * fresh openings and email them the top 5 via Resend — subject
 * "N new <Profession> jobs posted today".
 *
 * Run once a day (cron / Railway scheduled job):
 *     node scripts/job-digest.js
 *
 * Requires RAPIDAPI_KEY (JSearch) and RESEND_API_KEY (email). DATA_DIR must
 * point at the same SQLite dir the app uses. Pure email HTML comes from
 * CH.buildJobDigestEmail so it is unit-tested without sending anything.
 */
require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const CH = require('../career-hub.js');

const ORIGIN = process.env.PUBLIC_ORIGIN || 'https://resumetailored.com';
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = new Database(path.join(dataDir, 'resumetailor.db'));

async function jsearch(query) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error('RAPIDAPI_KEY not set');
  const qs = new URLSearchParams({ query, page: '1', num_pages: '1', date_posted: 'today' });
  const r = await fetch(`https://jsearch.p.rapidapi.com/search?${qs}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' }
  });
  if (!r.ok) throw new Error('jsearch_' + r.status);
  return r.json();
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

(async () => {
  const rows = db.prepare("SELECT email, profession_id, seniority, lang FROM check_ins WHERE job_alerts = 1 AND profession_id != ''").all();
  console.log(`[job-digest] ${rows.length} subscriber(s)`);
  let sent = 0, skipped = 0;
  // Cache JSearch per profession so many subscribers to the same role cost one call.
  const cache = {};
  for (const row of rows) {
    const prof = CH.resolveProfession(row.profession_id, row.seniority);
    if (!prof) { skipped++; continue; }
    const lang = row.lang === 'zh' ? 'zh' : 'en';
    try {
      let jobs = cache[prof.id];
      if (!jobs) { jobs = CH.normalizeJobs(await jsearch(prof.label)); cache[prof.id] = jobs; }
      if (!jobs.length) { skipped++; continue; }
      const profLabel = lang === 'zh' ? prof.labelZh : prof.label;
      const { subject, html } = CH.buildJobDigestEmail(profLabel, jobs, ORIGIN, lang);
      if (await sendEmail(row.email, subject, html)) sent++;
    } catch (e) {
      console.error(`[job-digest] ${row.email}: ${e.message}`);
      skipped++;
    }
  }
  console.log(`[job-digest] sent ${sent}, skipped ${skipped}`);
  process.exit(0);
})();
