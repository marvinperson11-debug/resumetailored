/* test/job-providers.js — multi-source job search fan-out (no network).
 * Run: node test/job-providers.js  → prints ALL PASS or the failures. */
'use strict';
const assert = require('assert');
const JP = require('../job-providers.js');

const failures = [];
async function ok(name, fn) { try { await fn(); console.log('  ✓', name); } catch (e) { failures.push(name + ' — ' + e.message); console.log('  ✗', name, '—', e.message); } }

// Fake fetch that returns a canned response per URL substring.
function fakeFetch(map) {
  return async (url) => {
    for (const [needle, val] of Object.entries(map)) {
      if (url.includes(needle)) {
        if (val === 'ERR') return { ok: false, status: 403, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => val };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

(async () => {
console.log('normalizers');
await ok('adzuna normalizer maps fields', () => {
  const jobs = JP.normalizeAdzuna({ results: [{ id: '1', title: 'HVAC Technician', company: { display_name: 'CoolAir' }, location: { display_name: 'Dallas, TX' }, redirect_url: 'https://a/1', description: '<b>Fix</b> units', created: '2026-08-01' }] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'HVAC Technician');
  assert.equal(jobs[0].company, 'CoolAir');
  assert.equal(jobs[0].location, 'Dallas, TX');
  assert.equal(jobs[0].source, 'adzuna');
  assert.ok(!/</.test(jobs[0].descriptionSnippet), 'HTML stripped');
});
await ok('remotive/jobicy/arbeitnow/muse normalizers tolerate empty', () => {
  assert.deepEqual(JP.normalizeRemotive({}), []);
  assert.deepEqual(JP.normalizeJobicy(null), []);
  assert.deepEqual(JP.normalizeArbeitnow({ data: [] }), []);
  assert.deepEqual(JP.normalizeTheMuse({}), []);
});
await ok('jsearch normalizer maps fields', () => {
  const jobs = JP.normalizeJsearch({ data: [{ job_id: 'x', job_title: 'Electrician', employer_name: 'Volt', job_city: 'Reno', job_state: 'NV', job_apply_link: 'https://j/x' }] });
  assert.equal(jobs[0].title, 'Electrician');
  assert.equal(jobs[0].location, 'Reno, NV');
});

console.log('dedupe');
await ok('dedupe collapses same url', () => {
  const out = JP.dedupe([{ title: 'A', company: 'X', url: 'https://u/1' }, { title: 'A2', company: 'X', url: 'https://U/1' }, { title: 'B', company: 'Y', url: '' }]);
  assert.equal(out.length, 2);
});

console.log('searchJobs fan-out');
await ok('one keyed provider 403 does NOT empty results (fallbacks fill in)', async () => {
  const providers = [
    { name: 'jsearch', keyed: true, enabled: () => true, fetch: JP.fetchJsearch },
    { name: 'remotive', keyed: false, enabled: () => true, fetch: JP.fetchRemotive }
  ];
  const fetchImpl = fakeFetch({
    'jsearch.p.rapidapi.com': 'ERR',
    'remotive.com': { jobs: [{ id: 1, title: 'Remote Dev', company_name: 'Acme', url: 'https://r/1', description: 'x' }] }
  });
  process.env.RAPIDAPI_KEY = 'test';
  const { jobs, sources } = await JP.searchJobs({ query: 'developer', location: '', page: 1 }, { fetchImpl, providers });
  assert.ok(jobs.length >= 1, 'still returned fallback jobs');
  const js = sources.find(s => s.name === 'jsearch');
  assert.ok(js && js.ok === false, 'jsearch reported as failed');
  assert.ok(js.error && /403/.test(js.error), 'error carries the 403');
  delete process.env.RAPIDAPI_KEY;
});
await ok('keyed success suppresses remote-only padding', async () => {
  const providers = [
    { name: 'adzuna', keyed: true, enabled: () => true, fetch: JP.fetchAdzuna },
    { name: 'remotive', keyed: false, enabled: () => true, fetch: JP.fetchRemotive }
  ];
  const adzunaRows = { results: Array.from({ length: 10 }, (_, i) => ({ id: i, title: 'HVAC Tech ' + i, company: { display_name: 'Co' }, redirect_url: 'https://a/' + i, location: { display_name: 'TX' } })) };
  const fetchImpl = fakeFetch({ 'api.adzuna.com': adzunaRows, 'remotive.com': { jobs: [{ id: 99, title: 'Remote', company_name: 'R', url: 'https://r/99' }] } });
  process.env.ADZUNA_APP_ID = 'id'; process.env.ADZUNA_APP_KEY = 'key';
  const { jobs, sources } = await JP.searchJobs({ query: 'hvac technician', location: '', page: 1 }, { fetchImpl, providers });
  assert.ok(jobs.length >= 10);
  assert.ok(!sources.find(s => s.name === 'remotive'), 'remote fallback not called when keyed returned enough');
  assert.ok(jobs.every(j => j.source === 'adzuna'));
  delete process.env.ADZUNA_APP_ID; delete process.env.ADZUNA_APP_KEY;
});
await ok('empty location = nationwide (no where param sent to adzuna)', async () => {
  let capturedUrl = '';
  const fetchImpl = async (url) => { capturedUrl = url; return { ok: true, status: 200, json: async () => ({ results: [] }) }; };
  process.env.ADZUNA_APP_ID = 'id'; process.env.ADZUNA_APP_KEY = 'key';
  await JP.fetchAdzuna({ query: 'hvac technician', location: '', page: 1 }, fetchImpl);
  assert.ok(capturedUrl.includes('what=hvac'), 'keyword sent');
  assert.ok(!/[?&]where=/.test(capturedUrl), 'no where param when location empty (nationwide)');
  delete process.env.ADZUNA_APP_ID; delete process.env.ADZUNA_APP_KEY;
});

  if (failures.length) { console.log('\nFAILURES:\n' + failures.map(f => ' - ' + f).join('\n')); process.exit(1); }
  console.log('\nALL PASS');
})();
