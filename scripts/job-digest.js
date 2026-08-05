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

// Mirrors server.js's isSubscriber() locally — this script doesn't require
// server.js (it boots the whole app), so the comp/owner-email rule is
// duplicated here rather than shared.
const COMP_EMAILS = (process.env.COMP_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function isPro(email) {
  const e = email.toLowerCase();
  if (e === (process.env.OWNER_EMAIL || 'support@resumetailored.com').toLowerCase()) return true;
  if (COMP_EMAILS.includes(e)) return true;
  return !!db.prepare('SELECT 1 FROM subscribers WHERE email = ?').get(e);
}
// AI job matching digest is Pro-only (Part 4) — built entirely from data the
// user already generated (no fresh LLM call per subscriber per day, see
// CH.computeJobMatchScore).
function matchInfoFor(email) {
  const gapRow = db.prepare('SELECT match_score, payload FROM gap_reports WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email);
  const bandRank = { gold: 3, silver: 2, bronze: 1 };
  const badgeRows = db.prepare('SELECT band, score FROM badges WHERE email = ?').all(email);
  let bestBand = null;
  for (const r of badgeRows) if (!bestBand || (bandRank[r.band] || 0) > (bandRank[bestBand.band] || 0)) bestBand = r;
  const score = CH.computeJobMatchScore({
    latestGapScore: gapRow ? gapRow.match_score : null,
    bestBandScore: bestBand ? bestBand.score : null
  });
  if (score == null) return null;
  let topGap = null;
  if (gapRow) { try { const payload = JSON.parse(gapRow.payload); topGap = (payload.gaps && payload.gaps[0] && payload.gaps[0].requirement) || null; } catch (e) {} }
  return { score, topGap };
}

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

// Employer Portal jobs for a profession, freshest first — kept in sync into
// job_feed on every job posting write (see server.js), so this is a plain
// read with no extra API cost. Normalized to the same shape as
// CH.normalizeJobs output so they slot into the same email template and sort
// first, matching the Job Feed Aggregator's "employer jobs get priority
// placement" rule.
function employerJobsFor(professionId) {
  if (!professionId) return [];
  const rows = db.prepare("SELECT * FROM job_feed WHERE source = 'employer' AND profession_id = ? ORDER BY posted_at DESC LIMIT 5").all(professionId);
  return rows.map(r => ({
    id: `employer:${r.id}`, title: r.title, company: r.company, location: r.location,
    remote: !!r.remote, employmentType: r.job_type, postedAt: r.posted_at, url: '', applyUrl: '',
    descriptionSnippet: r.description || ''
  }));
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
      let jsJobs = cache[prof.id];
      if (jsJobs === undefined) {
        try { jsJobs = CH.normalizeJobs(await jsearch(prof.label)); } catch (e) { jsJobs = []; }
        cache[prof.id] = jsJobs;
      }
      const jobs = employerJobsFor(prof.id).concat(jsJobs).slice(0, 5);
      if (!jobs.length) { skipped++; continue; }
      const profLabel = lang === 'zh' ? prof.labelZh : prof.label;
      const matchInfo = isPro(row.email) ? matchInfoFor(row.email) : null;
      const { subject, html } = CH.buildJobDigestEmail(profLabel, jobs, ORIGIN, lang, matchInfo);
      if (await sendEmail(row.email, subject, html)) sent++;
    } catch (e) {
      console.error(`[job-digest] ${row.email}: ${e.message}`);
      skipped++;
    }
  }
  console.log(`[job-digest] sent ${sent}, skipped ${skipped}`);
  process.exit(0);
})();
