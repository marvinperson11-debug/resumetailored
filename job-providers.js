/* job-providers.js — resilient, multi-source live job search.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Job Finder used to depend on a SINGLE provider (JSearch via RapidAPI).
 * When that key 403s (not subscribed / expired / quota) every search returns
 * nothing and the feature looks completely dead — which is exactly what
 * happened in production ("[refresh-job-feed] JSearch (HVAC Technician):
 * jsearch_403"). A hiring tool cannot have a single point of failure that
 * silently empties every result.
 *
 * So search now fans out across every CONFIGURED provider and MERGES the
 * results. A provider that errors (bad key, rate limit, network) is logged and
 * skipped — it never empties the whole page. The response carries a `sources`
 * array so the route/UI can tell the difference between "a provider failed"
 * and "there genuinely are no matches", i.e. no more silent failures.
 *
 * PROVIDERS
 *   - adzuna     — env-gated (ADZUNA_APP_ID + ADZUNA_APP_KEY). Free signup,
 *                  full US coverage across ALL sectors incl. skilled trades
 *                  (HVAC, electricians, CDL…). This is the recommended primary
 *                  source for nationwide, non-remote US search.
 *   - jsearch    — env-gated (RAPIDAPI_KEY). Kept for continuity; skipped when
 *                  the key is absent or the call fails.
 *   - usajobs    — env-gated (USAJOBS_API_KEY + USAJOBS_EMAIL). US federal jobs.
 *   - remotive   — zero-key. Remote roles. Always available fallback.
 *   - arbeitnow  — zero-key. Remote/EU roles. Always available fallback.
 *   - jobicy     — zero-key. Remote roles. Always available fallback.
 *   - themuse    — zero-key. Curated companies (some on-site US). Fallback.
 *
 * Everything here is dependency-light and unit-testable: the normalizers are
 * pure (raw JSON in → normalized job[] out) and `searchJobs` accepts an
 * injectable `fetchImpl`, so test/job-providers.js drives the whole fan-out
 * with canned responses and no network.
 */
'use strict';

const crypto = require('crypto');
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// Strip HTML, collapse whitespace, clamp — job descriptions arrive as HTML
// from several providers and we only ever show a short snippet.
function snippet(s, n = 320) {
  return String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}
function firstStr(...xs) { for (const x of xs) { if (x != null && String(x).trim()) return String(x).trim(); } return ''; }

// ── Normalizers (pure) ───────────────────────────────────────────────────────
// Every provider maps onto the SAME shape the frontend already renders:
// { id,title,company,location,remote,employmentType,postedAt,url,applyUrl,logo,descriptionSnippet,source }

function normalizeAdzuna(json) {
  const rows = (json && Array.isArray(json.results)) ? json.results : [];
  return rows.map(j => {
    const loc = j.location && (j.location.display_name || (Array.isArray(j.location.area) ? j.location.area.join(', ') : '')) || '';
    return {
      id: 'adzuna:' + firstStr(j.id, sha256((j.title || '') + (j.company && j.company.display_name || '') + (j.redirect_url || ''))),
      title: firstStr(j.title),
      company: firstStr(j.company && j.company.display_name),
      location: loc,
      remote: /remote/i.test((j.title || '') + ' ' + loc),
      employmentType: j.contract_time || j.contract_type || '',
      postedAt: j.created || null,
      url: firstStr(j.redirect_url),
      applyUrl: firstStr(j.redirect_url),
      logo: '',
      descriptionSnippet: snippet(j.description),
      source: 'adzuna'
    };
  }).filter(j => j.title);
}

function normalizeJsearch(json) {
  const data = (json && Array.isArray(json.data)) ? json.data : [];
  return data.map(j => ({
    id: 'jsearch:' + firstStr(j.job_id, sha256((j.job_title || '') + (j.employer_name || '') + (j.job_apply_link || ''))),
    title: firstStr(j.job_title),
    company: firstStr(j.employer_name),
    location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', '),
    remote: !!j.job_is_remote,
    employmentType: j.job_employment_type || '',
    postedAt: j.job_posted_at_datetime_utc || null,
    url: firstStr(j.job_apply_link, j.job_google_link),
    applyUrl: firstStr(j.job_apply_link),
    logo: firstStr(j.employer_logo),
    descriptionSnippet: snippet(j.job_description),
    source: 'jsearch'
  })).filter(j => j.title);
}

function normalizeRemotive(json) {
  const rows = (json && Array.isArray(json.jobs)) ? json.jobs : [];
  return rows.map(j => ({
    id: 'remotive:' + firstStr(j.id, sha256((j.title || '') + (j.company_name || '') + (j.url || ''))),
    title: firstStr(j.title),
    company: firstStr(j.company_name),
    location: firstStr(j.candidate_required_location, 'Remote'),
    remote: true,
    employmentType: j.job_type || '',
    postedAt: j.publication_date || null,
    url: firstStr(j.url),
    applyUrl: firstStr(j.url),
    logo: firstStr(j.company_logo),
    descriptionSnippet: snippet(j.description),
    source: 'remotive'
  })).filter(j => j.title);
}

function normalizeArbeitnow(json) {
  const rows = (json && Array.isArray(json.data)) ? json.data : [];
  return rows.map(j => ({
    id: 'arbeitnow:' + firstStr(j.slug, sha256((j.title || '') + (j.company_name || '') + (j.url || ''))),
    title: firstStr(j.title),
    company: firstStr(j.company_name),
    location: firstStr(j.location, (j.remote ? 'Remote' : '')),
    remote: !!j.remote,
    employmentType: Array.isArray(j.job_types) ? j.job_types.join(', ') : '',
    postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
    url: firstStr(j.url),
    applyUrl: firstStr(j.url),
    logo: '',
    descriptionSnippet: snippet(j.description),
    source: 'arbeitnow'
  })).filter(j => j.title);
}

function normalizeJobicy(json) {
  const rows = (json && Array.isArray(json.jobs)) ? json.jobs : [];
  return rows.map(j => ({
    id: 'jobicy:' + firstStr(j.id, sha256((j.jobTitle || '') + (j.companyName || '') + (j.url || ''))),
    title: firstStr(j.jobTitle),
    company: firstStr(j.companyName),
    location: firstStr(j.jobGeo, 'Remote'),
    remote: true,
    employmentType: Array.isArray(j.jobType) ? j.jobType.join(', ') : (j.jobType || ''),
    postedAt: j.pubDate || null,
    url: firstStr(j.url),
    applyUrl: firstStr(j.url),
    logo: firstStr(j.companyLogo),
    descriptionSnippet: snippet(j.jobExcerpt || j.jobDescription),
    source: 'jobicy'
  })).filter(j => j.title);
}

function normalizeTheMuse(json) {
  const rows = (json && Array.isArray(json.results)) ? json.results : [];
  return rows.map(j => {
    const locs = (j.locations || []).map(l => l.name).filter(Boolean);
    return {
      id: 'themuse:' + firstStr(j.id, sha256((j.name || '') + (j.company && j.company.name || ''))),
      title: firstStr(j.name),
      company: firstStr(j.company && j.company.name),
      location: locs.join('; ') || '',
      remote: locs.some(l => /remote/i.test(l)),
      employmentType: firstStr(j.type),
      postedAt: j.publication_date || null,
      url: firstStr(j.refs && j.refs.landing_page),
      applyUrl: firstStr(j.refs && j.refs.landing_page),
      logo: '',
      descriptionSnippet: snippet(j.contents),
      source: 'themuse'
    };
  }).filter(j => j.title && j.url);
}

// ── Provider fetchers ────────────────────────────────────────────────────────
// Each returns a normalized job[] or throws. All accept the shared search
// params { query, location, remote, datePosted, jobType, page } and a fetchImpl.
const DATE_MAP_ADZUNA = { today: 1, '3days': 3, week: 7, month: 31 };
const DATE_MAP_JSEARCH = { today: 'today', '3days': '3days', week: 'week', month: 'month' };

async function fetchAdzuna(params, fetchImpl) {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return null; // not configured
  const country = (process.env.ADZUNA_COUNTRY || 'us').toLowerCase();
  const page = Math.max(1, params.page || 1);
  const qs = new URLSearchParams({ app_id: id, app_key: key, results_per_page: '25', 'content-type': 'application/json' });
  if (params.query) qs.set('what', params.query);
  if (params.location) qs.set('where', params.location);
  if (params.remote === 'remote') qs.set('what_or', (params.query ? params.query + ' ' : '') + 'remote');
  if (params.jobType === 'FULLTIME') qs.set('full_time', '1');
  if (params.jobType === 'PARTTIME') qs.set('part_time', '1');
  if (params.jobType === 'CONTRACTOR') qs.set('contract', '1');
  const days = DATE_MAP_ADZUNA[params.datePosted];
  if (days) qs.set('max_days_old', String(days));
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${qs.toString()}`;
  const r = await fetchImpl(url);
  if (!r.ok) { const e = new Error('adzuna_http_' + r.status); e.code = 'provider_error'; throw e; }
  return normalizeAdzuna(await r.json());
}

async function fetchJsearch(params, fetchImpl) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return null;
  const qs = new URLSearchParams({ query: params.location ? `${params.query} in ${params.location}` : params.query, page: String(params.page || 1), num_pages: '1' });
  if (params.remote === 'remote') qs.set('remote_jobs_only', 'true');
  if (params.jobType) qs.set('employment_types', params.jobType);
  const d = DATE_MAP_JSEARCH[params.datePosted]; if (d) qs.set('date_posted', d);
  const r = await fetchImpl(`https://jsearch.p.rapidapi.com/search?${qs.toString()}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' }
  });
  if (!r.ok) { const e = new Error('jsearch_http_' + r.status); e.code = 'provider_error'; throw e; }
  const json = await r.json();
  // JSearch returns HTTP 200 with an error-shaped body on quota/auth issues —
  // treat a missing data array as a hard error, never a legit "zero jobs".
  if (!json || (json.status && String(json.status).toLowerCase() === 'error') || !Array.isArray(json.data)) {
    const e = new Error('jsearch_bad_response'); e.code = 'provider_error'; throw e;
  }
  return normalizeJsearch(json);
}

async function fetchUsajobs(params, fetchImpl) {
  const key = process.env.USAJOBS_API_KEY, email = process.env.USAJOBS_EMAIL;
  if (!key || !email) return null;
  const qs = new URLSearchParams({ ResultsPerPage: '25', Page: String(params.page || 1) });
  if (params.query) qs.set('Keyword', params.query);
  if (params.location) qs.set('LocationName', params.location);
  const r = await fetchImpl(`https://data.usajobs.gov/api/search?${qs.toString()}`, {
    headers: { 'Host': 'data.usajobs.gov', 'User-Agent': email, 'Authorization-Key': key }
  });
  if (!r.ok) { const e = new Error('usajobs_http_' + r.status); e.code = 'provider_error'; throw e; }
  const json = await r.json();
  const items = (json && json.SearchResult && json.SearchResult.SearchResultItems) || [];
  return items.map(it => {
    const d = it.MatchedObjectDescriptor || {};
    return {
      id: 'usajobs:' + firstStr(it.MatchedObjectId, sha256(d.PositionTitle || '')),
      title: firstStr(d.PositionTitle),
      company: firstStr(d.OrganizationName, 'U.S. Federal Government'),
      location: (d.PositionLocationDisplay || (d.PositionLocation && d.PositionLocation[0] && d.PositionLocation[0].LocationName) || ''),
      remote: /remote|telework/i.test(JSON.stringify(d.PositionRemuneration || '') + (d.PositionTitle || '')),
      employmentType: (d.PositionSchedule && d.PositionSchedule[0] && d.PositionSchedule[0].Name) || '',
      postedAt: d.PublicationStartDate || null,
      url: firstStr(d.PositionURI),
      applyUrl: firstStr(d.ApplyURI && d.ApplyURI[0], d.PositionURI),
      logo: '',
      descriptionSnippet: snippet(d.QualificationSummary || (d.UserArea && d.UserArea.Details && d.UserArea.Details.JobSummary)),
      source: 'usajobs'
    };
  }).filter(j => j.title);
}

async function fetchRemotive(params, fetchImpl) {
  const qs = new URLSearchParams({ limit: '25' });
  if (params.query) qs.set('search', params.query);
  const r = await fetchImpl(`https://remotive.com/api/remote-jobs?${qs.toString()}`);
  if (!r.ok) { const e = new Error('remotive_http_' + r.status); e.code = 'provider_error'; throw e; }
  return normalizeRemotive(await r.json());
}

async function fetchArbeitnow(params, fetchImpl) {
  const r = await fetchImpl('https://www.arbeitnow.com/api/job-board-api');
  if (!r.ok) { const e = new Error('arbeitnow_http_' + r.status); e.code = 'provider_error'; throw e; }
  let jobs = normalizeArbeitnow(await r.json());
  // Arbeitnow has no server-side query — filter client-side by the keyword.
  if (params.query) {
    const q = params.query.toLowerCase();
    jobs = jobs.filter(j => (j.title + ' ' + j.company + ' ' + j.descriptionSnippet).toLowerCase().includes(q));
  }
  return jobs;
}

async function fetchJobicy(params, fetchImpl) {
  const qs = new URLSearchParams({ count: '25' });
  if (params.query) qs.set('tag', params.query);
  const r = await fetchImpl(`https://jobicy.com/api/v2/remote-jobs?${qs.toString()}`);
  if (!r.ok) { const e = new Error('jobicy_http_' + r.status); e.code = 'provider_error'; throw e; }
  return normalizeJobicy(await r.json());
}

async function fetchTheMuse(params, fetchImpl) {
  const qs = new URLSearchParams({ page: String((params.page || 1) - 1) });
  if (params.location) qs.set('location', params.location);
  const url = `https://www.themuse.com/api/public/jobs?${qs.toString()}`;
  const r = await fetchImpl(url);
  if (!r.ok) { const e = new Error('themuse_http_' + r.status); e.code = 'provider_error'; throw e; }
  let jobs = normalizeTheMuse(await r.json());
  if (params.query) {
    const q = params.query.toLowerCase();
    jobs = jobs.filter(j => (j.title + ' ' + j.company).toLowerCase().includes(q));
  }
  return jobs;
}

// Provider registry, in priority order. `keyed` providers (with a real API
// key + broad coverage) run first; the zero-key remote fallbacks run only when
// the keyed providers returned few/no results, so a configured Adzuna doesn't
// get its US trade results diluted by remote-only listings.
const PROVIDERS = [
  { name: 'adzuna', fetch: fetchAdzuna, keyed: true, enabled: () => !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) },
  { name: 'jsearch', fetch: fetchJsearch, keyed: true, enabled: () => !!process.env.RAPIDAPI_KEY },
  { name: 'usajobs', fetch: fetchUsajobs, keyed: true, enabled: () => !!(process.env.USAJOBS_API_KEY && process.env.USAJOBS_EMAIL) },
  { name: 'remotive', fetch: fetchRemotive, keyed: false, enabled: () => process.env.JOB_FALLBACKS_OFF !== '1' },
  { name: 'themuse', fetch: fetchTheMuse, keyed: false, enabled: () => process.env.JOB_FALLBACKS_OFF !== '1' },
  { name: 'jobicy', fetch: fetchJobicy, keyed: false, enabled: () => process.env.JOB_FALLBACKS_OFF !== '1' },
  { name: 'arbeitnow', fetch: fetchArbeitnow, keyed: false, enabled: () => process.env.JOB_FALLBACKS_OFF !== '1' }
];

function dedupe(jobs) {
  const seen = new Set(); const out = [];
  for (const j of jobs) {
    const k = (j.url && j.url.toLowerCase()) || (j.title + '|' + j.company).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(j);
  }
  return out;
}

/**
 * Fan out across every configured provider and merge. Never throws for a
 * single provider failure. Returns:
 *   { jobs, sources: [{ name, keyed, ok, count, error }], anyKeyedConfigured }
 *
 * `anyKeyedConfigured` lets the caller warn an admin that only the remote
 * fallbacks are live (i.e. add Adzuna/JSearch for full coverage).
 */
async function searchJobs(params, opts = {}) {
  const fetchImpl = opts.fetchImpl || global.fetch;
  const list = (opts.providers || PROVIDERS).filter(p => p.enabled());
  const keyed = list.filter(p => p.keyed);
  const unkeyed = list.filter(p => !p.keyed);
  const sources = [];
  let jobs = [];

  async function run(providers) {
    const settled = await Promise.allSettled(providers.map(async p => {
      const res = await p.fetch(params, fetchImpl);
      return { p, res };
    }));
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        const { p, res } = s.value;
        if (res == null) continue; // provider opted out (not configured)
        sources.push({ name: p.name, keyed: p.keyed, ok: true, count: res.length });
        jobs = jobs.concat(res);
      } else {
        const reason = s.reason || {};
        // We can't recover the provider name from a rejected settle reliably,
        // so annotate at throw time instead: reason.provider is set below.
        sources.push({ name: reason.provider || 'unknown', keyed: !!reason.keyed, ok: false, count: 0, error: reason.message || String(reason) });
      }
    }
  }

  // Wrap each fetch so a rejection still knows which provider it was.
  const tag = (providers) => providers.map(p => ({
    ...p,
    fetch: async (par, f) => {
      try { return await p.fetch(par, f); }
      catch (err) { err.provider = p.name; err.keyed = p.keyed; throw err; }
    }
  }));

  await run(tag(keyed));
  // Only reach for remote-only fallbacks if the keyed providers didn't already
  // return a healthy set — keeps a good US search from being padded with
  // unrelated remote roles, but guarantees the page is never empty.
  if (jobs.length < 5) await run(tag(unkeyed));

  jobs = dedupe(jobs);
  return { jobs, sources, anyKeyedConfigured: keyed.length > 0 };
}

module.exports = {
  searchJobs, dedupe, snippet,
  normalizeAdzuna, normalizeJsearch, normalizeRemotive, normalizeArbeitnow, normalizeJobicy, normalizeTheMuse,
  fetchAdzuna, fetchJsearch, fetchUsajobs, fetchRemotive, fetchArbeitnow, fetchJobicy, fetchTheMuse,
  PROVIDERS
};
