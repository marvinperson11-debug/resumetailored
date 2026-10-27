#!/usr/bin/env node
/**
 * Sitemap + Indeed + ZipRecruiter feeds, over REAL HTTP (npm run test:sitemap-feed-http).
 * Needs a production build: `npm run build && npm run test:sitemap-feed-http`.
 *
 * scripts/test-sitemap-feed-freshness.cjs drives the route handlers in-process against a
 * fake Postgres proxy — it proves there is no module-level cache in the data-access layer,
 * but it calls `GET()` directly via `require()`, so it cannot see anything that only exists
 * on the wire: a response-level cache (CDN/edge, a reused `Response` object), Next's own
 * fetch Data Cache applying to the Supabase REST calls despite `force-dynamic`, or a
 * Cache-Control header that differs from what the handler source says it sets. This is
 * exactly the class of bug the overnight runtime-snapshot incident turned out to be (a
 * handler that reads correctly in a unit test but serves a frozen response once deployed) —
 * so this test starts the REAL `next start` server and a REAL small HTTP server standing in
 * for Supabase's PostgREST, and talks to both over real sockets, same technique as
 * scripts/test-guest-http.cjs.
 *
 * It also proves the "silent fallback" fix: a PostgREST error must turn into a 503, never a
 * confident 200 with an empty/stale body.
 */
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 3112;
const MOCK_PORT = 4546;
const APP = `http://localhost:${APP_PORT}`;

let failures = 0;
let passes = 0;
const check = (name, ok, detail) => {
  if (ok) { passes++; console.log("PASS ", name); }
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

// ── mock PostgREST: a tiny in-memory Postgres standing in for Supabase, reached over a real
// HTTP socket (same wire format supabase-js actually speaks — verified empirically: a plain
// JSON array for a list select, maybeSingle()/single() take [0] client-side; a non-2xx status
// becomes `{ data: null, error: {...} }`). ───────────────────────────────────────────────────
const state = { tables: { job_postings: [], job_distribution: [], employer_profiles: [] }, errorOn: null };

function coerce(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}
function parseFilters(search) {
  const filters = [];
  for (const [k, v] of search) {
    if (k === "select" || k === "limit" || k === "order") continue;
    const m = v.match(/^(\w+)\.(.*)$/);
    if (m) filters.push({ col: k, op: m[1], val: m[2] });
  }
  return filters;
}
function rowMatches(row, filters) {
  return filters.every((f) => {
    if (f.op === "eq") return row[f.col] === coerce(f.val);
    if (f.op === "in") return f.val.replace(/^\(|\)$/g, "").split(",").map(coerce).includes(row[f.col]);
    return true;
  });
}

const mock = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
  const table = m ? m[1] : null;
  if (!table) { res.writeHead(404, { "content-type": "application/json" }); return res.end("[]"); }
  if (state.errorOn === table) {
    res.writeHead(500, { "content-type": "application/json" });
    return res.end(JSON.stringify({ message: "simulated PostgREST failure", code: "XX000" }));
  }
  const filters = parseFilters(url.searchParams);
  const rows = (state.tables[table] || []).filter((r) => rowMatches(r, filters));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(rows));
});

// ── helpers ──────────────────────────────────────────────────────────────────────
const env = (extra = {}) => ({
  ...process.env,
  NODE_ENV: "production",
  PORT: String(APP_PORT),
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k",
  CLERK_SECRET_KEY: "sk_live_test_not_real",
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  GUEST_QUOTA_SALT: "http-test-sitemap-feed-salt-0123456789",
  ...extra,
});
const startNext = (extra) => spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT)], { cwd: ROOT, env: env(extra), stdio: ["ignore", "pipe", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUp(ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(APP + "/sitemap.xml"); return true; } catch { await sleep(300); }
  }
  return false;
}
const nonceOf = (xml) => (xml.match(/TEMPORARY-DIAGNOSTIC nonce=([\w-]+) generatedAt=([^\s-]+)/) || [])[1];

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  let child = null;
  const stop = async () => { if (child && child.exitCode === null) { child.kill("SIGTERM"); await sleep(500); if (child.exitCode === null) child.kill("SIGKILL"); } };
  try {
    child = startNext();
    let out = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
    const up = await waitUp();
    check("boot: next start serves over real HTTP", up, out.slice(-400));
    if (!up) throw new Error("server never came up");

    // ═══ Sitemap: job 31 absent, then present after a seeded insert — over real HTTP ═══
    state.tables.job_postings = [{ id: 30, status: "active", public_listed: true, updated_at: "2026-10-26T09:00:00.000Z" }];
    const sm1res = await fetch(APP + "/sitemap.xml");
    const sm1 = await sm1res.text();
    check("sitemap (HTTP): Cache-Control is no-store", sm1res.headers.get("cache-control") === "no-store", sm1res.headers.get("cache-control"));
    check("sitemap (HTTP) call 1: job 31 absent (not yet seeded)", !sm1.includes("/jobs/31"), sm1);
    check("sitemap (HTTP) call 1: job 30 present", sm1.includes("/jobs/30"));

    state.tables.job_postings.push({ id: 31, status: "active", public_listed: true, updated_at: "2026-10-26T13:38:20.000Z" });
    const sm2res = await fetch(APP + "/sitemap.xml");
    const sm2 = await sm2res.text();
    check("sitemap (HTTP) call 2: job 31 now present over a REAL round trip — no edge/CDN/Next cache froze call 1's response", sm2.includes("/jobs/31"), sm2);
    check("sitemap (HTTP) call 1 and call 2 differ", sm1 !== sm2);
    const n1 = nonceOf(sm1), n2 = nonceOf(sm2);
    check("sitemap (HTTP): the per-request diagnostic nonce is present and advances between requests (rules out a frozen/reused Response object)", !!n1 && !!n2 && n1 !== n2, { n1, n2 });

    // The frozen-snapshot reading: nonce advances even when the row set itself does NOT change —
    // proves liveness is being exercised on every request, not just when content happens to differ.
    const sm3res = await fetch(APP + "/sitemap.xml");
    const sm3 = await sm3res.text();
    const n3 = nonceOf(sm3);
    check("sitemap (HTTP): nonce still advances on a THIRD call with unchanged rows (same job set, different nonce)", n3 !== n2 && sm3.includes("/jobs/30") && sm3.includes("/jobs/31"), { n2, n3 });

    // Silent-fallback class, closed: a PostgREST error must 503, not a confident empty/stale 200.
    state.errorOn = "job_postings";
    const smErrRes = await fetch(APP + "/sitemap.xml");
    check("sitemap (HTTP): a PostgREST query failure answers 503, not a silently-empty 200", smErrRes.status === 503, smErrRes.status);
    state.errorOn = null;

    // ═══ Indeed feed — over real HTTP ═══
    const token = "indeed-feed-token-http-test";
    state.tables.employer_profiles = [{ user_id: "employer-1", job_feed_token: token, company_name: "Acme Co" }];
    state.tables.job_distribution = [{ job_id: 30, employer_id: "employer-1", channels: { indeedFeed: { enabled: true } } }];
    state.tables.job_postings = [
      { id: 30, employer_id: "employer-1", status: "active", public_listed: true, title: "Job 30", description: "A real description of this role.", created_at: "2026-10-26T09:00:00.000Z", updated_at: "2026-10-26T09:00:00.000Z" },
    ];
    const if1res = await fetch(APP + "/api/jobs/feed/" + token);
    const if1 = await if1res.text();
    check("Indeed feed (HTTP): Cache-Control is no-store", if1res.headers.get("cache-control") === "no-store", if1res.headers.get("cache-control"));
    check("Indeed feed (HTTP) call 1: job 31 absent (not yet distribution-enabled)", !if1.includes("<referencenumber>31</referencenumber>"), if1);
    check("Indeed feed (HTTP) call 1: job 30 present", if1.includes("<referencenumber>30</referencenumber>"));

    state.tables.job_distribution.push({ job_id: 31, employer_id: "employer-1", channels: { indeedFeed: { enabled: true } } });
    state.tables.job_postings.push({ id: 31, employer_id: "employer-1", status: "active", public_listed: true, title: "Job 31", description: "A real description of this role too.", created_at: "2026-10-26T13:38:20.000Z", updated_at: "2026-10-26T13:38:20.000Z" });
    const if2res = await fetch(APP + "/api/jobs/feed/" + token);
    const if2 = await if2res.text();
    check("Indeed feed (HTTP) call 2: job 31 now present over a REAL round trip", if2.includes("<referencenumber>31</referencenumber>"), if2);
    check("Indeed feed (HTTP): nonce advances between calls", nonceOf(if1) !== nonceOf(if2), { n1: nonceOf(if1), n2: nonceOf(if2) });

    // A job that is still distribution-enabled but has since gone status=closed must drop out
    // of the feed — this is the exact overnight symptom (a closed job staying in the feed).
    state.tables.job_postings[1].status = "closed";
    const if3res = await fetch(APP + "/api/jobs/feed/" + token);
    const if3 = await if3res.text();
    check("Indeed feed (HTTP): a job closed after being feed-enabled drops out immediately, over a real HTTP round trip", !if3.includes("<referencenumber>31</referencenumber>") && if3.includes("<referencenumber>30</referencenumber>"), if3);

    state.errorOn = "job_distribution";
    const ifErrRes = await fetch(APP + "/api/jobs/feed/" + token);
    check("Indeed feed (HTTP): a PostgREST query failure answers 503, not a silently-empty/stale 200", ifErrRes.status === 503, ifErrRes.status);
    state.errorOn = null;

    // ═══ ZipRecruiter feed — over real HTTP (same token, sibling channel) ═══
    state.tables.job_postings[1].status = "active"; // job 31 back open for this section
    // job 30's existing distribution row only has indeedFeed enabled (from the section
    // above) — give it zipRecruiter too, so this section can assert that closing job 31
    // doesn't take job 30 down with it, same as the Indeed section's equivalent check.
    state.tables.job_distribution.push({ job_id: 30, employer_id: "employer-1", channels: { zipRecruiter: { enabled: true } } });
    state.tables.job_distribution.push({ job_id: 31, employer_id: "employer-1", channels: { zipRecruiter: { enabled: true } } });
    const zr1res = await fetch(APP + "/api/jobs/ziprecruiter-feed/" + token);
    const zr1 = await zr1res.text();
    check("ZipRecruiter feed (HTTP): Cache-Control is no-store", zr1res.headers.get("cache-control") === "no-store", zr1res.headers.get("cache-control"));
    check("ZipRecruiter feed (HTTP): job 31 present (zipRecruiter channel enabled, status active)", zr1.includes("<referencenumber>31</referencenumber>"), zr1);

    state.tables.job_postings[1].status = "closed";
    const zr2res = await fetch(APP + "/api/jobs/ziprecruiter-feed/" + token);
    const zr2 = await zr2res.text();
    check("ZipRecruiter feed (HTTP): the same job closing drops it out over a real round trip, even though its channel row is still enabled", !zr2.includes("<referencenumber>31</referencenumber>") && zr2.includes("<referencenumber>30</referencenumber>"), zr2);
    check("ZipRecruiter feed (HTTP): nonce advances between calls", nonceOf(zr1) !== nonceOf(zr2), { n1: nonceOf(zr1), n2: nonceOf(zr2) });

    state.errorOn = "job_postings";
    const zrErrRes = await fetch(APP + "/api/jobs/ziprecruiter-feed/" + token);
    check("ZipRecruiter feed (HTTP): a PostgREST query failure answers 503, not a silently-empty/stale 200", zrErrRes.status === 503, zrErrRes.status);
    state.errorOn = null;

    console.log(`\n${failures ? failures + " FAILURE(S)" : "ALL PASS"} (${passes} passed)`);
  } catch (e) {
    console.error("FATAL", e);
    failures++;
  } finally {
    await stop();
    mock.close();
  }
  process.exit(failures ? 1 : 0);
})();
