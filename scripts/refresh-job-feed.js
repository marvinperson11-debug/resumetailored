#!/usr/bin/env node
/**
 * Job Feed Aggregator — background refresh.
 *
 * Populates the job_feed table from every configured source so
 * GET /api/job-feed ("Jobs for You") is fast (a plain SELECT, no live API
 * call per view) and personalizable by profession. Run every 6h (cron /
 * Railway scheduled job):
 *
 *     node scripts/refresh-job-feed.js
 *
 * Sources, and why each is what it is:
 *   - JSearch (RAPIDAPI_KEY): refreshed only for professions someone has
 *     actually saved (SELECT DISTINCT profession_id FROM check_ins), not a
 *     blanket top-N warm — this runs unconditionally every 6h regardless of
 *     traffic, so it stays demand-driven to keep the API bill bounded.
 *   - Company career-page RSS (JOB_FEED_RSS_URLS): the one source with no
 *     partner-approval gate. Format: comma-separated
 *     "profession_id|label|https://url" triples.
 *   - Indeed / ZipRecruiter: both require a business partner-approval
 *     process, not a signup-and-go API key (see EMPLOYER_PORTAL_PLAN.md) —
 *     these are stubs that log and no-op until real credentials exist. The
 *     upsert/dedup plumbing is already wired, so activating either later is
 *     an env var + the actual HTTP call, no schema or route changes.
 *
 * DATA_DIR must match the app's SQLite dir. Every source is best-effort: one
 * failing source is logged and skipped, never a fatal exit — a feed that's
 * missing one source is better than a feed that's empty because one API
 * had a bad day.
 */
require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const CH = require('../career-hub.js');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = new Database(path.join(dataDir, 'resumetailor.db'));

function upsertFeedRow(row) {
  db.prepare(`
    INSERT INTO job_feed (source, external_id, title, company, location, url, description, remote, job_type, profession_id, priority, posted_at, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)
    ON CONFLICT(source, external_id) DO UPDATE SET title=excluded.title, company=excluded.company, location=excluded.location,
      url=excluded.url, description=excluded.description, remote=excluded.remote, job_type=excluded.job_type,
      profession_id=excluded.profession_id, posted_at=excluded.posted_at, fetched_at=excluded.fetched_at
  `).run(row.source, row.externalId, row.title, row.company || '', row.location || '', row.url, row.description || '',
    row.remote ? 1 : 0, row.jobType || '', row.professionId || '', row.postedAt || null, Date.now());
}

// ── JSearch: only for professions someone has actually saved ────────────────
async function jsearchFetch(query) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error('RAPIDAPI_KEY not set');
  const qs = new URLSearchParams({ query, page: '1', num_pages: '1' });
  const r = await fetch(`https://jsearch.p.rapidapi.com/search?${qs}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' }
  });
  if (!r.ok) throw new Error('jsearch_' + r.status);
  return r.json();
}
async function refreshJSearch() {
  if (!process.env.RAPIDAPI_KEY) { console.log('[refresh-job-feed] JSearch: RAPIDAPI_KEY not set, skipping'); return; }
  const profIds = db.prepare("SELECT DISTINCT profession_id FROM check_ins WHERE profession_id != ''").all().map(r => r.profession_id).slice(0, 30);
  let added = 0;
  for (const id of profIds) {
    const prof = CH.resolveProfession(id, '');
    if (!prof) continue;
    try {
      const jobs = CH.normalizeJobs(await jsearchFetch(prof.label));
      for (const j of jobs) {
        upsertFeedRow({ source: 'jsearch', externalId: j.id, title: j.title, company: j.company, location: j.location,
          url: j.url, description: j.descriptionSnippet, remote: j.remote, jobType: j.employmentType, professionId: prof.id,
          postedAt: j.postedAt ? Date.parse(j.postedAt) || null : null });
        added++;
      }
    } catch (e) { console.error(`[refresh-job-feed] JSearch (${prof.label}): ${e.message}`); }
  }
  console.log(`[refresh-job-feed] JSearch: ${added} listing(s) across ${profIds.length} profession(s)`);
}

// ── Company career-page RSS: the one source with no partner-approval gate ───
async function refreshRss() {
  const spec = (process.env.JOB_FEED_RSS_URLS || '').trim();
  if (!spec) { console.log('[refresh-job-feed] RSS: JOB_FEED_RSS_URLS not set, skipping'); return; }
  const feeds = spec.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [professionId, label, url] = s.split('|').map(x => (x || '').trim());
    return { professionId, label, url };
  }).filter(f => f.url);
  let added = 0;
  for (const feed of feeds) {
    try {
      const r = await fetch(feed.url);
      if (!r.ok) throw new Error('http_' + r.status);
      const items = CH.parseRssItems(await r.text());
      for (const item of items) {
        upsertFeedRow({ source: 'rss', externalId: item.guid, title: item.title, company: feed.label || '',
          url: item.link, description: item.description, professionId: feed.professionId || '',
          postedAt: item.pubDate ? Date.parse(item.pubDate) || null : null });
        added++;
      }
    } catch (e) { console.error(`[refresh-job-feed] RSS (${feed.label || feed.url}): ${e.message}`); }
  }
  console.log(`[refresh-job-feed] RSS: ${added} listing(s) across ${feeds.length} feed(s)`);
}

// ── Indeed / ZipRecruiter: partner-gated, stubbed until real credentials exist ─
async function refreshIndeed() {
  if (!process.env.INDEED_PUBLISHER_ID) { console.log('[refresh-job-feed] Indeed: not configured (requires partner approval), skipping'); return; }
  console.log('[refresh-job-feed] Indeed: INDEED_PUBLISHER_ID is set but no adapter is implemented yet — add the fetch call here.');
}
async function refreshZipRecruiter() {
  if (!process.env.ZIPRECRUITER_API_KEY) { console.log('[refresh-job-feed] ZipRecruiter: not configured (requires partner approval), skipping'); return; }
  console.log('[refresh-job-feed] ZipRecruiter: ZIPRECRUITER_API_KEY is set but no adapter is implemented yet — add the fetch call here.');
}

// Drop stale (>14d) non-employer listings so the feed doesn't accumulate
// dead links forever. Employer Portal rows are kept in sync by server.js on
// every job posting write, never by this cleanup.
function pruneStale() {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const info = db.prepare("DELETE FROM job_feed WHERE source != 'employer' AND fetched_at < ?").run(cutoff);
  if (info.changes) console.log(`[refresh-job-feed] pruned ${info.changes} stale listing(s)`);
}

(async () => {
  await refreshJSearch();
  await refreshRss();
  await refreshIndeed();
  await refreshZipRecruiter();
  pruneStale();
  process.exit(0);
})();
