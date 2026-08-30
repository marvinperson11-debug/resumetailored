#!/usr/bin/env node
/**
 * Smoke-test the AutoApply ↔ main-app apply-queue bridge, end to end.
 *
 * It assumes the apps are ALREADY RUNNING and points at them by URL (spawning
 * the standalone app needs Postgres + Google OAuth, so this script does not try
 * to boot it). Everything the standalone app does to the main app is a
 * server-to-server call authenticated by the shared service token + the user's
 * email — this script makes exactly those calls, so it verifies the real bridge
 * protocol against a live main app.
 *
 * Usage:
 *   node scripts/smoke-test-autoapply-bridge.js \
 *     --main-url http://localhost:3000 \
 *     --service-token "$RT_SERVICE_TOKEN" \
 *     [--standalone-url http://localhost:3001] \
 *     [--extension-token aa_xxx] \
 *     [--email someone@example.com]
 *
 * Flags (all optional):
 *   --main-url        main ResumeTailored app origin (default http://localhost:3000)
 *   --service-token   shared RT_SERVICE_TOKEN (default: env RT_SERVICE_TOKEN)
 *   --standalone-url  standalone AutoApply app origin — enables the real proxy checks
 *   --extension-token an AutoApply ExtensionToken — required for the standalone proxy checks
 *   --email           test user email (default: a random smoke-test address)
 *   --keep            don't delete the test job at the end
 *
 * Exit code 0 = all executed steps passed; 1 = a failure.
 */

const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf("--" + name);
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  if (i !== -1) return true; // boolean flag
  return def;
}

const MAIN = String(flag("main-url", "http://localhost:3000")).replace(/\/+$/, "");
const STANDALONE = flag("standalone-url", null);
const SERVICE_TOKEN = flag("service-token", process.env.RT_SERVICE_TOKEN || "");
const EXT_TOKEN = flag("extension-token", null);
const EMAIL = String(flag("email", `smoke_${Date.now()}@autoapply-test.local`)).toLowerCase();
const KEEP = !!flag("keep", false);
// --no-signup: skip creating a real user (use the service token for the "add"
// step). Recommended against PRODUCTION so the run leaves ZERO persistent data —
// the only row it creates (an apply_queue entry) is deleted at the end.
const NO_SIGNUP = !!flag("no-signup", false);

let pass = 0, fail = 0, skip = 0;
const results = [];
function record(step, ok, detail) {
  if (ok === "skip") { skip++; results.push(["SKIP", step, detail]); console.log(`SKIP  ${step}${detail ? " — " + detail : ""}`); return; }
  if (ok) { pass++; results.push(["PASS", step, detail]); console.log(`PASS  ${step}${detail ? " — " + detail : ""}`); }
  else { fail++; results.push(["FAIL", step, detail]); console.error(`FAIL  ${step}${detail ? " — " + detail : ""}`); }
}

async function req(url, opts = {}) {
  const res = await fetch(url, opts);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json: json || {} };
}
const svcHeaders = () => ({
  "x-rt-service-token": SERVICE_TOKEN,
  "x-rt-user-email": EMAIL,
  "Content-Type": "application/json",
});

const TEST_URL = `https://smoke.example.com/jobs/${Date.now()}`;
let createdId = null;

async function main() {
  console.log(`\nAutoApply bridge smoke test`);
  console.log(`  main app:    ${MAIN}`);
  console.log(`  standalone:  ${STANDALONE || "(not provided — proxy checks skipped)"}`);
  console.log(`  service tok: ${SERVICE_TOKEN ? "set" : "MISSING"}`);
  console.log(`  test email:  ${EMAIL}\n`);

  // 1) Main app reachable.
  try {
    const r = await req(`${MAIN}/api/status`);
    record("1. main app is reachable (GET /api/status)", r.status === 200, `HTTP ${r.status}`);
  } catch (e) {
    record("1. main app is reachable (GET /api/status)", false, e.message);
    return summarize();
  }

  if (!SERVICE_TOKEN) {
    record("service token present", false, "pass --service-token or set RT_SERVICE_TOKEN; the bridge steps need it");
    return summarize();
  }

  // 2) Create a test user on the main app (browser path) to add a job "as the
  //    user". Skipped with --no-signup (recommended for production): the service
  //    token adds the job instead, so no persistent user is created.
  let bearer = null;
  if (NO_SIGNUP) {
    record("2. create a test user on the main app (signup)", "skip", "--no-signup: using the service token, no user created");
  } else {
    try {
      const pw = `Sm0ke!${Math.random().toString(36).slice(2)}Aa9`;
      const r = await req(`${MAIN}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, username: "Smoke Test", password: pw }),
      });
      bearer = r.json && r.json.token;
      record("2. create a test user on the main app (signup)", r.status === 200 && !!bearer, `HTTP ${r.status}`);
    } catch (e) {
      record("2. create a test user on the main app (signup)", false, e.message);
    }
  }

  // 3) Add a job to the main queue as the user (browser session bearer). Falls
  //    back to the service token if signup was unavailable.
  {
    const asUser = bearer
      ? { headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" } }
      : { headers: svcHeaders() };
    const r = await req(`${MAIN}/api/apply-queue`, {
      method: "POST",
      ...asUser,
      body: JSON.stringify({ job_url: TEST_URL, job_title: "Smoke Engineer", company_name: "SmokeCo" }),
    });
    createdId = r.json && r.json.item && r.json.item.id;
    record(`3. add a job to the main queue ${bearer ? "as the user" : "(via service token)"}`,
      r.status === 201 && !!createdId, `HTTP ${r.status}`);
  }

  // 4) As the STANDALONE app (service token + email): read the main queue and see
  //    the job. This is exactly what main-app-queue.fetchMainQueue() does.
  {
    const r = await req(`${MAIN}/api/apply-queue`, { headers: svcHeaders() });
    const found = r.status === 200 && (r.json.items || []).some((i) => i.jobUrl === TEST_URL);
    record("4. standalone app reads the job from the main queue (service bridge)", found, `HTTP ${r.status}, count ${r.json.count}`);
  }

  // 5) Import into the standalone app's local DB — only when a live standalone
  //    URL + an ExtensionToken are provided (the proxy is auth-gated).
  if (STANDALONE && EXT_TOKEN) {
    const base = String(STANDALONE).replace(/\/+$/, "");
    const auth = { Authorization: `Bearer ${EXT_TOKEN}`, "Content-Type": "application/json" };
    const rc = await req(`${base}/api/apply-queue/count`, { headers: auth });
    record("5a. standalone proxy /api/apply-queue/count responds", rc.status === 200, `HTTP ${rc.status}`);
    const ri = await req(`${base}/api/apply-queue/import`, { method: "POST", headers: auth });
    record("5b. standalone POST /api/apply-queue/import succeeds", ri.status === 200 && typeof ri.json.total === "number",
      `HTTP ${ri.status}, imported ${ri.json.imported}, updated ${ri.json.updated}`);
  } else {
    record("5. import into the standalone app's local DB", "skip",
      "needs --standalone-url and --extension-token (proxy is auth-gated); covered by autoapply typecheck + queue-sync tests");
  }

  // 6) Status write-back: as the standalone app, PATCH the main queue item. This
  //    is what updateMainStatus() sends for PREPARED (→auto_filled) then APPLIED
  //    (→submitted).
  if (createdId) {
    const p1 = await req(`${MAIN}/api/apply-queue/${createdId}`, {
      method: "PATCH", headers: svcHeaders(), body: JSON.stringify({ status: "auto_filled" }),
    });
    const g1 = await req(`${MAIN}/api/apply-queue`, { headers: svcHeaders() });
    const isAuto = (g1.json.items || []).find((i) => i.jobUrl === TEST_URL)?.status === "auto_filled";
    record("6a. write-back PREPARED → auto_filled reflects on the main queue", p1.status === 200 && isAuto, `HTTP ${p1.status}`);

    const p2 = await req(`${MAIN}/api/apply-queue/${createdId}`, {
      method: "PATCH", headers: svcHeaders(), body: JSON.stringify({ status: "submitted" }),
    });
    const g2 = await req(`${MAIN}/api/apply-queue`, { headers: svcHeaders() });
    const isSubmitted = (g2.json.items || []).find((i) => i.jobUrl === TEST_URL)?.status === "submitted";
    record("6b. write-back APPLIED → submitted reflects on the main queue", p2.status === 200 && isSubmitted, `HTTP ${p2.status}`);
  } else {
    record("6. status write-back", false, "no job id from step 3");
  }

  // 7) Cleanup.
  if (createdId && !KEEP) {
    const r = await req(`${MAIN}/api/apply-queue/${createdId}`, { method: "DELETE", headers: svcHeaders() });
    record("7. cleanup: delete the test job", r.status === 200, `HTTP ${r.status}`);
  } else if (KEEP) {
    record("7. cleanup", "skip", "--keep set");
  }

  summarize();
}

function summarize() {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`SUMMARY: ${pass} passed, ${fail} failed, ${skip} skipped`);
  console.log(`${"─".repeat(60)}`);
  if (fail > 0) {
    console.log("Failing steps:");
    for (const [s, step, detail] of results) if (s === "FAIL") console.log(`  ✗ ${step}${detail ? " — " + detail : ""}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("smoke test threw:", e); process.exit(1); });
