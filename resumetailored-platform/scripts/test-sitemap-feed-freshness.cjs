#!/usr/bin/env node
/**
 * Sitemap + Indeed feed staleness regression (npm run test:sitemap-feed-freshness).
 *
 * Added while chasing a reported bug: a published job stayed absent from both
 * public routes long after a prior fix (app/sitemap.xml/route.ts,
 * app/api/jobs/feed/[token]/route.ts) already made them `force-dynamic` /
 * `no-store`. The audit found no module-level cache, memoization, or
 * `unstable_cache` anywhere in the data-access layer those routes read through
 * (lib/employer-store.ts, lib/job-distribution-store.ts) — but there's no
 * test proving that two sequential calls through the SAME shared path
 * actually see different seeded states, so a cache reintroduced later (e.g. a
 * well-meaning `unstable_cache` wrap around `listPublicJobsForSitemap` to cut
 * Supabase reads) would slip in silently. This test drives the real route
 * handlers against an in-memory fake Postgres (same technique as
 * scripts/test-employer-assistant.cjs) and asserts the second call reflects a
 * job inserted between the two calls.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) console.log("PASS ", name);
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

const transpile = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(out.outputText, filename);
};
require.extensions[".ts"] = transpile;

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = path.join(ROOT, request.slice(2));
    for (const cand of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), base]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
  }
  return origResolve.call(this, request, parent, ...rest);
};

// ── fake world: an in-memory Postgres + NextResponse, same shape as
// scripts/test-employer-assistant.cjs's harness ──────────────────────────────
const state = { tables: { job_postings: [], job_distribution: [], employer_profiles: [] } };

function matches(row, filters) {
  return filters.every((f) => {
    if (f.op === "eq") return row[f.col] === f.val;
    if (f.op === "in") return (f.val || []).includes(row[f.col]);
    return true;
  });
}

function chainFor(table) {
  const ctx = { filters: [] };
  const rows = () => state.tables[table] || (state.tables[table] = []);
  const exec = () => {
    const filtered = rows().filter((r) => matches(r, ctx.filters));
    return { data: filtered, error: null };
  };
  const p = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve, reject) => { try { resolve(exec()); } catch (e) { reject(e); } };
        if (prop === "maybeSingle" || prop === "single") {
          return () => { const r = exec(); return Promise.resolve({ data: (r.data || [])[0] ?? null, error: null }); };
        }
        return (...args) => {
          if (prop === "eq" || prop === "in") { ctx.filters.push({ op: prop, col: args[0], val: args[1] }); return p; }
          return p; // select/order/limit: no-ops here — this harness only needs filtering
        };
      },
    }
  );
  return p;
}

const fakeDb = { from: (table) => chainFor(table), rpc: async () => ({ data: null, error: null }) };

// Raw fetch is stubbed so the test stays hermetic — it is not what this
// test is checking.
global.fetch = async () => ({ headers: { get: () => null } });

const mocks = { "@supabase/supabase-js": () => ({ createClient: () => fakeDb }) };
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (mocks[request]) return mocks[request]();
  return origLoad.apply(this, arguments);
};

const load = (rel) => require(path.join(ROOT, rel));

(async () => {
  // ═══ Sitemap: job 31 absent, then present after a seeded insert ═══
  {
    const { GET } = load("app/sitemap.xml/route.ts");

    state.tables.job_postings = [
      { id: 30, status: "active", public_listed: true, updated_at: "2026-10-26T09:00:00.000Z" },
    ];
    const before = await (await GET()).text();
    check("sitemap call 1: job 31 absent (not yet seeded)", !before.includes("/jobs/31"), before);
    check("sitemap call 1: job 30 present", before.includes("/jobs/30"));

    // Simulate job 31 being published between the two requests.
    state.tables.job_postings.push({ id: 31, status: "active", public_listed: true, updated_at: "2026-10-26T09:38:20.000Z" });
    const after = await (await GET()).text();
    check(
      "sitemap call 2 (same process, same shared path, nothing re-required): job 31 now present — no hidden cache froze call 1's result set",
      after.includes("/jobs/31"),
      after
    );
    check("sitemap call 2: job 30 still present (no regression on existing rows)", after.includes("/jobs/30"));
    check("sitemap call 1 and call 2 differ", before !== after);
  }

  // ═══ Indeed feed: same shape, through the token + job_distribution path ═══
  {
    const { GET } = load("app/api/jobs/feed/[token]/route.ts");
    const token = "feed-token-test";
    state.tables.employer_profiles = [{ user_id: "employer-1", job_feed_token: token, company_name: "Acme Co" }];
    state.tables.job_distribution = [{ job_id: 30, employer_id: "employer-1", channels: { indeedFeed: { enabled: true } } }];
    state.tables.job_postings = [
      { id: 30, employer_id: "employer-1", status: "active", public_listed: true, title: "Job 30", description: "d", created_at: "2026-10-26T09:00:00.000Z", updated_at: "2026-10-26T09:00:00.000Z" },
    ];

    const req = new Request("https://app.resumetailored.com/api/jobs/feed/" + token);
    const before = await (await GET(req, { params: { token } })).text();
    check("feed call 1: job 31 absent (not yet distribution-enabled)", !before.includes("<referencenumber>31</referencenumber>"), before);
    check("feed call 1: job 30 present", before.includes("<referencenumber>30</referencenumber>"));

    // Simulate the employer turning the Indeed-feed channel on for job 31 after publish/approval.
    state.tables.job_distribution.push({ job_id: 31, employer_id: "employer-1", channels: { indeedFeed: { enabled: true } } });
    state.tables.job_postings.push({ id: 31, employer_id: "employer-1", status: "active", public_listed: true, title: "Job 31", description: "d", created_at: "2026-10-26T09:38:20.000Z", updated_at: "2026-10-26T09:38:20.000Z" });

    const after = await (await GET(req, { params: { token } })).text();
    check(
      "feed call 2 (same process, same shared path): job 31 now present — no hidden cache froze call 1's result set",
      after.includes("<referencenumber>31</referencenumber>"),
      after
    );
    check("feed call 1 and call 2 differ", before !== after);

    // The caching fix: no intermediary (CDN/browser) may cache this response.
    const resp = await GET(req, { params: { token } });
    check("feed response Cache-Control is no-store (previously public, max-age=300)", resp.headers.get("cache-control") === "no-store", resp.headers.get("cache-control"));
  }

  console.log(`\n${failures ? failures + " FAILURE(S)" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
