#!/usr/bin/env node
/**
 * Signed-out free tier, over real HTTP (npm run test:guest-http). Needs a production build:
 *   npm run build && npm run test:guest-http
 *
 * test-guest-gate.cjs drives the route handlers and middleware in-process; this starts the
 * real `next start` and talks to it over a socket, which is the only way to prove the parts
 * that only exist in a running server:
 *   - the server REFUSES TO BOOT without GUEST_QUOTA_SALT (instrumentation.ts),
 *   - the real clerkMiddleware lets a signed-out visitor onto /candidate and bounces the rest,
 *   - the rt_guest cookie actually leaves the server as a real Set-Cookie header,
 *   - a forged x-forwarded-for does not dodge the rate limiter.
 * Claude and Supabase are two tiny local servers (ANTHROPIC_BASE_URL / NEXT_PUBLIC_SUPABASE_URL),
 * so nothing leaves the machine and no key is real. Clerk runs for real, with a made-up
 * production-instance key: a request with no session cookie is "signed out" without any network.
 */
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 3111;
const MOCK_PORT = 4545;
// "localhost", not 127.0.0.1: Next rewrites a pass-through to its own configured host, and a mismatch
// makes it try to proxy the request to itself ("Failed to proxy ... EPIPE").
const APP = `http://localhost:${APP_PORT}`;

let failures = 0;
let passes = 0;
const check = (name, ok, detail) => {
  if (ok) { passes++; console.log("PASS ", name); }
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

// ── mock Claude + mock Supabase (PostgREST) ──────────────────────────────────────
const seen = { claude: [], spendMicro: 0, quotas: new Map(), inserts: [] };
const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
    const body = raw ? JSON.parse(raw) : {};
    const json = (code, v) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (url.pathname === "/v1/messages") {
      seen.claude.push(body);
      return json(200, { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "TAILORED OVER HTTP" }], stop_reason: "end_turn", usage: { input_tokens: 2000, output_tokens: 1000 } });
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop();
      const k = (id) => `${id}|${body.p_day}|${body.p_tool}`;
      if (fn === "guest_quota_reserve") {
        const g = seen.quotas.get(k(body.p_guest)) || 0;
        if (g >= body.p_limit) return json(200, "guest_cap");
        const ip = seen.quotas.get(k(body.p_ip_key)) || 0;
        if (ip >= body.p_ip_limit) return json(200, "ip_cap");
        seen.quotas.set(k(body.p_guest), g + 1); seen.quotas.set(k(body.p_ip_key), ip + 1);
        return json(200, "ok");
      }
      if (fn === "guest_quota_refund") {
        for (const id of [body.p_guest, body.p_ip_key]) if (seen.quotas.has(k(id))) seen.quotas.set(k(id), Math.max(0, seen.quotas.get(k(id)) - 1));
        res.writeHead(204); return res.end();
      }
      if (fn === "guest_spend_add") { seen.spendMicro += body.p_micro; return json(200, seen.spendMicro); }
      return json(404, { message: "unknown rpc " + fn });
    }
    if (url.pathname === "/rest/v1/guest_spend") return json(200, [{ micro_usd: seen.spendMicro }]);
    if (url.pathname === "/rest/v1/generations" && req.method === "POST") { seen.inserts.push(body); res.writeHead(201); return res.end(); }
    json(200, []);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────────
const env = (extra = {}) => ({
  ...process.env,
  NODE_ENV: "production",
  PORT: String(APP_PORT),
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k", // "clerk.example.com$"
  CLERK_SECRET_KEY: "sk_live_test_not_real",
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  ANTHROPIC_API_KEY: "sk-ant-test",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  ...extra,
});
const startNext = (extra) => spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT)], { cwd: ROOT, env: env(extra), stdio: ["ignore", "pipe", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUp(ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(APP + "/api/health-probe", { redirect: "manual" }); return true; } catch { await sleep(300); }
  }
  return false;
}
const get = (p, headers = {}) => fetch(APP + p, { redirect: "manual", headers });
const post = (p, body, headers = {}) => fetch(APP + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const cookieOf = (res) => { const c = res.headers.get("set-cookie"); return c && /rt_guest=/.test(c) ? c.split(";")[0] : null; };
const RESUME = "Jane Doe\njane@example.com\nEXPERIENCE\nNurse at General Hospital 2019-2024\n- Cared for patients across an ICU ward";
const JOB = "Registered Nurse needed at St Mary. ICU experience, BLS required. Strong communication and teamwork skills.";

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  let child = null;
  const stop = async () => { if (child && child.exitCode === null) { child.kill("SIGTERM"); await sleep(500); if (child.exitCode === null) child.kill("SIGKILL"); } };
  try {
    // ── 1. it refuses to boot without the salt ──────────────────────────────────
    child = startNext({ GUEST_QUOTA_SALT: "" });
    let out = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
    const exited = await Promise.race([new Promise((r) => child.on("exit", (code) => r(code))), sleep(30000).then(() => "still-running")]);
    check("boot: `next start` without GUEST_QUOTA_SALT exits non-zero instead of serving", exited !== "still-running" && exited !== 0, { exited, out: out.slice(-400) });
    check("boot: ...and says why", /GUEST_QUOTA_SALT/.test(out), out.slice(-400));
    await stop();

    // ── 2. boots with it ───────────────────────────────────────────────────────
    child = startNext({ GUEST_QUOTA_SALT: "http-test-guest-quota-salt-0123456789" });
    out = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
    const up = await waitUp();
    check("boot: ...and serves with it", up, out.slice(-400));
    if (!up) throw new Error("server never came up");

    // ── 3. the real middleware ─────────────────────────────────────────────────
    const cand = await get("/candidate");
    const html = await cand.text();
    check("middleware: a signed-out visitor gets /candidate (200, the dashboard)", cand.status === 200 && /<html/i.test(html), { status: cand.status, location: cand.headers.get("location") });
    for (const p of ["/candidate/settings", "/candidate/profile", "/candidate/resumes", "/candidate/shareable-links", "/candidate/applications", "/candidate/studio", "/candidate/templates"]) {
      const r = await get(p);
      const loc = r.headers.get("location") || "";
      check(`middleware: ${p} bounces a signed-out visitor to sign-in`, r.status === 307 && loc.includes("/sign-in") && loc.includes(encodeURIComponent(p)), { status: r.status, loc });
    }
    for (const p of ["/dashboard", "/employer/messages", "/employer/team", "/employer/docusign", "/employer/some-future-page", "/employee"]) {
      const r = await get(p);
      check(`middleware: ${p} still bounces to /sign-in`, r.status === 307 && new URL(r.headers.get("location") || "http://x/", APP).pathname === "/sign-in", { status: r.status, loc: r.headers.get("location") });
    }
    // ── 3b. the anonymous employer taste: three pages open, demo data only ───────
    for (const [p, needle] of [["/employer", "Demo company"], ["/employer/jobs", "Customer Success Manager"], ["/employer/candidates", "Maya Okafor"]]) {
      const r = await get(p);
      const body = await r.text();
      check(`employer demo: a signed-out visitor gets ${p} (200, demo mode, not /sign-in)`, r.status === 200 && body.includes(needle) && body.includes("data-employer-demo-banner"), { status: r.status, loc: r.headers.get("location") });
      // (the translated UI strings ride along in every page and contain placeholder addresses like name@company.com;
      // what must not appear is any address that is neither a fixture nor part of the shipped copy)
      const copy = require("fs").readFileSync(require("path").join(__dirname, "../messages/en.json"), "utf8");
      const emails = (body.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || []).filter((e) => !/@example\.com$/i.test(e) && !copy.includes(e) && !/^example\d*@email\.com$/.test(e)); // (the last is Clerk's own sign-in placeholder)
      check(`employer demo: ${p} carries no email address but the example.com fixtures`, emails.length === 0, emails);
    }
    for (const p of ["/api/employer/jobs", "/api/employer/candidates", "/api/employer/messages", "/api/employer/documents", "/api/employer/team", "/api/employer/docusign/envelopes"]) {
      const r = await get(p);
      check(`employer demo: GET ${p} is still refused for a guest`, r.status === 401 || r.status === 403, r.status);
    }
    const jd = { title: "Store manager", notes: "Open the store, lead a team of eight and own the weekly numbers." };
    const j1 = await post("/api/employer/jobs/assist", jd, { "cf-connecting-ip": "198.51.100.66" });
    const j1j = await j1.json().catch(() => ({}));
    const jck = cookieOf(j1);
    check("employer demo: the AI job-description writer works once over real HTTP (guest, 1500-token cap)", j1.status === 200 && j1j.description === "TAILORED OVER HTTP" && j1j.guest === true && seen.claude[seen.claude.length - 1].max_tokens === 1500, { status: j1.status, j1j });
    const claudeBefore = seen.claude.length;
    const j2 = await post("/api/employer/jobs/assist", jd, { "cf-connecting-ip": "198.51.100.66", cookie: jck });
    const j2j = await j2.json().catch(() => ({}));
    check("employer demo: the 2nd is 402 guest_quota with the employer message, and Claude is not called", j2.status === 402 && j2j.tool === "employer-jd" && j2j.guest === true && j2j.message === "You've used today's free employer preview. Create a free employer account to post for real." && seen.claude.length === claudeBefore, j2j);
    const pub = await post("/api/employer/jobs", { title: "Real job", description: "A real description of the role.", status: "active" }, { "cf-connecting-ip": "198.51.100.66", cookie: jck });
    check("employer demo: a guest still cannot publish a job (POST /api/employer/jobs refused)", pub.status === 401 || pub.status === 403, pub.status);
    seen.claude.length = 0; seen.spendMicro = 0; // (the tailor checks below count from a clean slate)

    // app/loading.tsx makes Next stream the shell first, so a server-component redirect() reaches the
    // browser as a 200 carrying <meta http-equiv="refresh" content="1;url=…"> (and the RSC payload's
    // NEXT_REDIRECT) rather than as a 307. Either form is a redirect; read whichever arrives.
    const redirectOf = async (res) => {
      if (res.status >= 300 && res.status < 400) return res.headers.get("location");
      const m = (await res.text()).match(/http-equiv="refresh" content="\d+;url=([^"]+)"/);
      return m ? m[1].replace(/&amp;/g, "&") : null;
    };
    const rootTo = await redirectOf(await get("/"));
    check("root: a signed-out visitor to / is sent to /candidate", rootTo === "/candidate", rootTo);
    const proTo = await redirectOf(await get("/?upgrade=pro"));
    check("root: /?upgrade=pro still signs in first (keeping the upgrade intent)", proTo === "/sign-in?upgrade=pro", proTo);

    // ── 4. a guest tailors once, exports, and is told to sign up on the second try ─
    const ipHeaders = { "cf-connecting-ip": "198.51.100.77" };
    const t1 = await post("/api/tailor", { resume: RESUME, jobPosting: JOB, mode: "resume" }, ipHeaders);
    const t1j = await t1.json().catch(() => ({}));
    const setCookie = t1.headers.get("set-cookie") || "";
    check("tailor: a guest gets a result over real HTTP", t1.status === 200 && t1j.result === "TAILORED OVER HTTP" && t1j.guest === true, { status: t1.status, t1j });
    check("tailor: the rt_guest cookie is a real Set-Cookie header — HttpOnly, 180 days, Lax", /rt_guest=[A-Za-z0-9_-]{24};/.test(setCookie) && /HttpOnly/i.test(setCookie) && /Max-Age=15552000/.test(setCookie) && /SameSite=lax/i.test(setCookie), setCookie);
    check("tailor: Claude was called with the guest's 4096-token cap", seen.claude.length === 1 && seen.claude[0].max_tokens === 4096, seen.claude.map((c) => c.max_tokens));
    check("tailor: nothing was written to generations", seen.inserts.length === 0);
    check("tailor: the run was added to the anonymous spend total (2000x$3 + 1000x$15 = 21000 micro-USD)", seen.spendMicro === 21000, seen.spendMicro);
    const ck = cookieOf(t1);
    const exp = await post("/api/export/authorize", { tplIds: ["r1"] }, { ...ipHeaders, cookie: ck });
    const expj = await exp.json().catch(() => ({}));
    check("export: the same guest may download — watermark on", exp.status === 200 && expj.watermark === true && expj.guest === true, { status: exp.status, expj });
    const t2 = await post("/api/tailor", { resume: RESUME, jobPosting: JOB, mode: "resume" }, { ...ipHeaders, cookie: ck });
    const t2j = await t2.json().catch(() => ({}));
    check("tailor: the second run -> 402 guest_quota with the account-urge message", t2.status === 402 && t2j.error === "guest_quota" && t2j.tool === "tailor" && t2j.limit === 1 && t2j.resets === "tomorrow" && t2j.guest === true && t2j.message === "You've used today's free resume tailoring. Create a free account — it's free, unlimited, and saves your work.", t2j);
    check("tailor: ...and Claude was not called again", seen.claude.length === 1);

    // ── 5. protected data stays protected ──────────────────────────────────────
    for (const p of ["/api/resumes", "/api/applications", "/api/user/instructions", "/api/profile"]) {
      const r = await get(p);
      check(`api: GET ${p} is still 401 for a guest`, r.status === 401, r.status);
    }

    // ── 6. a forged x-forwarded-for does not dodge the limiter ─────────────────
    const codes = [];
    for (let i = 0; i < 24; i++) codes.push((await post("/api/tailor/ats-report", {}, { "x-forwarded-for": `spoofed-${i}, 198.51.100.88` })).status);
    check("rate-limit: varying the forwarded-for the client writes does not mint a new bucket (400s, then 429 after 20)", codes.slice(0, 20).every((c) => c === 400) && codes.slice(20).every((c) => c === 429), codes.join());
  } catch (e) {
    failures++;
    console.error("FAIL  harness:", e && e.message);
  } finally {
    await stop();
    mock.close();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) { console.error("\nFAILED"); process.exit(1); }
  console.log("ALL PASS");
  process.exit(0);
})();
