#!/usr/bin/env node
/**
 * Welcome Email build (npm run test:welcome-email).
 *
 * Mirrors the harness scripts/test-employer-assistant.cjs already proved out
 * for this codebase's webhook features: Clerk, the Anthropic SDK (unused
 * here, kept out), and Supabase are faked at the module-load level; the
 * Svix signing in section 1 is the same scheme
 * app/api/webhooks/inbound-email/route.ts's own test section already
 * exercises, just against lib/clerk-webhook-verify.ts instead of
 * lib/assistant-resend-inbound.ts. A dedicated file rather than extending
 * that one: this feature shares no state or tables with the Employer Portal
 * AI Assistant, and a multi-user Clerk mock (candidate vs. employer
 * accounts) is a different shape than that file's single hardcoded
 * employer-only mock.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");

let failures = 0;
let passes = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passes++;
    console.log("PASS ", name);
  } else {
    failures++;
    console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "");
  }
};

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
process.env.CLERK_PLATFORM_WEBHOOK_SECRET = "whsec_" + Buffer.from("test-signing-secret-bytes!!").toString("base64");
process.env.RESEND_API_KEY = "test-resend-key";
delete process.env.WELCOME_GRACE_MINUTES;

const transpile = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  });
  module._compile(out.outputText, filename);
};
require.extensions[".ts"] = transpile;
require.extensions[".tsx"] = transpile;

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

// ── shared fake world: an in-memory Postgres, a multi-user Clerk, and a captured outbox ──
const state = {};
function resetWorld() {
  Object.assign(state, {
    tables: { welcome_comms: [] },
    clerkUsers: {}, // userId -> { plan, firstName, email }
    outbox: [], // { to, subject, html, replyTo }
    nextId: {},
  });
}
resetWorld();

function matches(row, filters) {
  return filters.every((f) => {
    if (f.op === "eq") return row[f.col] === f.val;
    if (f.op === "is") return (row[f.col] ?? null) === f.val;
    return true;
  });
}

function chainFor(table) {
  const ctx = { op: "select", filters: [], insertRows: null, updateRow: null };
  const exec = () => {
    const rows = state.tables[table] || (state.tables[table] = []);
    if (ctx.op === "select") {
      const filtered = rows.filter((r) => matches(r, ctx.filters));
      return { data: filtered, error: null };
    }
    if (ctx.op === "insert" || ctx.op === "upsert") {
      const out = [];
      for (const row of ctx.insertRows) {
        const full = { created_at: new Date().toISOString(), state: "pending", version: null, welcomed_at: null, ...row };
        rows.push(full);
        out.push(full);
      }
      return { data: out, error: null };
    }
    if (ctx.op === "update") {
      const targets = rows.filter((r) => matches(r, ctx.filters));
      for (const t of targets) Object.assign(t, ctx.updateRow);
      return { data: targets, error: null };
    }
    return { data: null, error: null };
  };
  const single = () => {
    const r = exec();
    return Promise.resolve({ data: (r.data || [])[0] ?? null, error: null });
  };
  const p = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve, reject) => { try { resolve(exec()); } catch (e) { reject(e); } };
        if (prop === "maybeSingle" || prop === "single") return single;
        return (...args) => {
          if (prop === "insert" || prop === "upsert") { ctx.op = prop; ctx.insertRows = Array.isArray(args[0]) ? args[0] : [args[0]]; return p; }
          if (prop === "update") { ctx.op = "update"; ctx.updateRow = args[0]; return p; }
          if (prop === "eq" || prop === "is") { ctx.filters.push({ op: prop, col: args[0], val: args[1] }); return p; }
          return p; // select/order/limit: no-ops in this harness
        };
      },
    }
  );
  return p;
}
const fakeDb = { from: (table) => chainFor(table) };

const mocks = {
  "@supabase/supabase-js": () => ({ createClient: () => fakeDb }),
  "@clerk/nextjs/server": () => ({
    clerkClient: async () => ({
      users: {
        getUser: async (userId) => {
          const u = state.clerkUsers[userId];
          if (!u) throw new Error("user not found");
          return {
            publicMetadata: u.plan ? { plan: u.plan } : {},
            firstName: u.firstName ?? null,
            emailAddresses: u.email ? [{ emailAddress: u.email }] : [],
          };
        },
      },
    }),
  }),
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (mocks[request]) return mocks[request]();
  return origLoad.apply(this, arguments);
};

// Capture sendEmail's outbound HTTP call (lib/email.ts posts to Resend via plain fetch).
const prevFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes("api.resend.com")) {
    const body = JSON.parse(opts.body);
    state.outbox.push(body);
    return { ok: true };
  }
  return { ok: true };
};

const load = (rel) => {
  delete require.cache[require.resolve(path.join(ROOT, rel))];
  return require(path.join(ROOT, rel));
};
const route = (rel) => load(`app/api/${rel}/route.ts`);
const URLBASE = "https://app.resumetailored.com";

// ── Svix signing helper (same scheme as the real header) ──
const SIGNING_SECRET_RAW = process.env.CLERK_PLATFORM_WEBHOOK_SECRET;
function svixSign(id, timestamp, rawBody) {
  const b64 = SIGNING_SECRET_RAW.slice("whsec_".length);
  const key = Buffer.from(b64, "base64");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  return "v1," + crypto.createHmac("sha256", key).update(signedContent, "utf8").digest("base64");
}
function svixReq(body, { id = "msg_test_1", timestamp = String(Math.floor(Date.now() / 1000)), tamperSig = false, omitHeaders = false } = {}) {
  const rawBody = JSON.stringify(body);
  const headers = { "content-type": "application/json" };
  if (!omitHeaders) {
    headers["svix-id"] = id;
    headers["svix-timestamp"] = timestamp;
    headers["svix-signature"] = tamperSig ? "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" : svixSign(id, timestamp, rawBody);
  }
  return new Request(`${URLBASE}/api/webhooks/clerk-welcome`, { method: "POST", headers, body: rawBody });
}
function clerkUserCreated(userId) {
  return { type: "user.created", data: { id: userId } };
}
function clerkUserUpdated(userId, { plan, firstName, email } = {}) {
  return {
    type: "user.updated",
    data: {
      id: userId,
      first_name: firstName ?? null,
      public_metadata: plan ? { plan } : {},
      primary_email_address_id: "idn_1",
      email_addresses: email ? [{ id: "idn_1", email_address: email }] : [],
    },
  };
}

(async () => {
  // ═══ 1. Svix verification (webhook auth) ═══
  {
    resetWorld();
    const r = route("webhooks/clerk-welcome");

    const validRes = await r.POST(svixReq(clerkUserCreated("user_svix_1")));
    check("svix: a correctly-signed delivery is accepted", validRes.status === 200, validRes.status);

    const badSigRes = await r.POST(svixReq(clerkUserCreated("user_svix_2"), { tamperSig: true }));
    check("svix: a tampered signature -> 401", badSigRes.status === 401, badSigRes.status);

    const staleTs = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const staleRes = await r.POST(svixReq(clerkUserCreated("user_svix_3"), { timestamp: staleTs }));
    check("svix: a timestamp 10 minutes old -> 401 (stale)", staleRes.status === 401, staleRes.status);

    const noHeadersRes = await r.POST(svixReq(clerkUserCreated("user_svix_4"), { omitHeaders: true }));
    check("svix: a non-Svix-signed delivery (no headers) -> 401", noHeadersRes.status === 401, noHeadersRes.status);

    const prevSecret = process.env.CLERK_PLATFORM_WEBHOOK_SECRET;
    delete process.env.CLERK_PLATFORM_WEBHOOK_SECRET;
    const unconfiguredRes = await r.POST(svixReq(clerkUserCreated("user_svix_5")));
    check("svix: CLERK_PLATFORM_WEBHOOK_SECRET unset -> 401, never falls through", unconfiguredRes.status === 401, unconfiguredRes.status);
    process.env.CLERK_PLATFORM_WEBHOOK_SECRET = prevSecret;

    check("svix: exactly one pending row was created (the single valid delivery)", state.tables.welcome_comms.length === 1, state.tables.welcome_comms);
  }

  // ═══ 2. user.created -> pending row; duplicate delivery -> still one row, zero sends ═══
  {
    resetWorld();
    const r = route("webhooks/clerk-welcome");
    const res1 = await r.POST(svixReq(clerkUserCreated("user_dup")));
    check("user.created: first delivery -> 200", res1.status === 200, res1.status);
    check("user.created: creates exactly one pending row", state.tables.welcome_comms.length === 1 && state.tables.welcome_comms[0].state === "pending", state.tables.welcome_comms);

    const res2 = await r.POST(svixReq(clerkUserCreated("user_dup"), { id: "msg_test_2" }));
    check("user.created: a retried delivery (different Svix message id, same Clerk user) -> 200", res2.status === 200, res2.status);
    check("user.created: still exactly one row — no duplicate", state.tables.welcome_comms.length === 1, state.tables.welcome_comms);
    check("user.created: zero emails sent from user.created alone", state.outbox.length === 0, state.outbox);
  }

  // ═══ 3. Grace scan ═══
  {
    const { runWelcomeScan } = load("lib/welcome-email.ts");
    const GRACE_MS = 30 * 60 * 1000;
    const now = Date.now();

    resetWorld();
    state.clerkUsers["user_grace_employer"] = { plan: "employer", firstName: "Priya", email: "priya@example.com" };
    state.clerkUsers["user_grace_candidate"] = { plan: undefined, firstName: "Sam", email: "sam@example.com" };
    state.tables.welcome_comms = [
      { user_id: "user_grace_employer", state: "pending", version: null, created_at: new Date(now - GRACE_MS - 60_000).toISOString(), welcomed_at: null },
      { user_id: "user_grace_candidate", state: "pending", version: null, created_at: new Date(now - GRACE_MS - 60_000).toISOString(), welcomed_at: null },
      { user_id: "user_grace_toosoon", state: "pending", version: null, created_at: new Date(now - 60_000).toISOString(), welcomed_at: null },
    ];
    state.clerkUsers["user_grace_toosoon"] = { plan: "employer", firstName: "Too", email: "too@example.com" };

    const result = await runWelcomeScan(now);
    check("grace scan: scans exactly the 2 rows past the grace window", result.scanned === 2, result);
    check("grace scan: sends exactly 2 emails", result.sent === 2 && state.outbox.length === 2, state.outbox);

    const employerRow = state.tables.welcome_comms.find((r) => r.user_id === "user_grace_employer");
    check("grace scan: pending + metadata plan=employer -> employer version sent, row welcomed, version recorded", employerRow.state === "welcomed" && employerRow.version === "employer", employerRow);
    const candidateRow = state.tables.welcome_comms.find((r) => r.user_id === "user_grace_candidate");
    check("grace scan: pending + no plan -> candidate version", candidateRow.state === "welcomed" && candidateRow.version === "candidate", candidateRow);
    const tooSoonRow = state.tables.welcome_comms.find((r) => r.user_id === "user_grace_toosoon");
    check("grace scan: a row younger than the grace window is untouched", tooSoonRow.state === "pending", tooSoonRow);

    check(
      "grace scan: the employer email actually went to the employer's address with the employer subject",
      state.outbox.some((m) => m.to === "priya@example.com" && m.subject === "Welcome to ResumeTailored for Employers. Your first job post is free.")
    );
    check(
      "grace scan: the candidate email went to the candidate's address with the candidate subject",
      state.outbox.some((m) => m.to === "sam@example.com" && m.subject === "Welcome to ResumeTailored. Start with one job posting.")
    );
  }

  // ═══ 4. user.updated with plan=employer -> employer version immediately; second user.updated -> nothing ═══
  {
    resetWorld();
    const r = route("webhooks/clerk-welcome");
    await r.POST(svixReq(clerkUserCreated("user_upd_1")));
    state.outbox.length = 0;

    const res1 = await r.POST(svixReq(clerkUserUpdated("user_upd_1", { plan: "employer", firstName: "Jo", email: "jo@example.com" })));
    check("user.updated: plan=employer -> 200", res1.status === 200, res1.status);
    check("user.updated: sends the employer version immediately, once", state.outbox.length === 1 && state.outbox[0].subject.includes("for Employers"), state.outbox);
    const row1 = state.tables.welcome_comms.find((x) => x.user_id === "user_upd_1");
    check("user.updated: row flips to welcomed/employer", row1.state === "welcomed" && row1.version === "employer", row1);

    const res2 = await r.POST(svixReq(clerkUserUpdated("user_upd_1", { plan: "employer", firstName: "Jo", email: "jo@example.com" })));
    check("user.updated: a second delivery for the same user -> 200", res2.status === 200, res2.status);
    check("user.updated: the second delivery sends NOTHING", state.outbox.length === 1, state.outbox);
  }

  // ═══ 5. Claim route path: pending row exists, claim fires -> employer version once; scan later sends nothing ═══
  {
    resetWorld();
    const { insertPendingWelcome, runWelcomeScan } = load("lib/welcome-email.ts");
    await insertPendingWelcome("user_claim_1");
    state.clerkUsers["user_claim_1"] = { plan: "employer", firstName: "Lee", email: "lee@example.com" };

    const claimFree = route("employer/claim-free");
    const prevMocks = { ...mocks };
    mocks["@clerk/nextjs/server"] = () => ({
      currentUser: async () => ({ id: "user_claim_1", firstName: "Lee", emailAddresses: [{ emailAddress: "lee@example.com" }] }),
      clerkClient: async () => ({
        users: {
          updateUserMetadata: async () => ({}),
          getUser: async (userId) => {
            const u = state.clerkUsers[userId];
            return { publicMetadata: u.plan ? { plan: u.plan } : {}, firstName: u.firstName ?? null, emailAddresses: u.email ? [{ emailAddress: u.email }] : [] };
          },
        },
      }),
    });
    // lib/plan.ts (imported by the claim-free route) also reads next/headers' cookies() — stub it too.
    mocks["next/headers"] = () => ({ cookies: () => ({ get: () => undefined }) });
    delete require.cache[require.resolve(path.join(ROOT, "app/api/employer/claim-free/route.ts"))];
    delete require.cache[require.resolve(path.join(ROOT, "lib/plan.ts"))];
    delete require.cache[require.resolve(path.join(ROOT, "lib/admin.ts"))];
    const claimRoute = load("app/api/employer/claim-free/route.ts");

    const claimReq = new Request(`${URLBASE}/api/employer/claim-free`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const claimRes = await claimRoute.POST(claimReq);
    check("claim route: claiming the free employer tier succeeds", claimRes.status === 200, [claimRes.status, await claimRes.clone().text()]);
    check("claim route: fires the employer welcome email once, immediately", state.outbox.length === 1 && state.outbox[0].subject.includes("for Employers"), state.outbox);
    const claimedRow = state.tables.welcome_comms.find((x) => x.user_id === "user_claim_1");
    check("claim route: the row is welcomed/employer", claimedRow.state === "welcomed" && claimedRow.version === "employer", claimedRow);

    state.outbox.length = 0;
    const scanResult = await runWelcomeScan();
    check("claim route: the later grace scan finds nothing to send for this user", state.outbox.length === 0, state.outbox);

    Object.keys(mocks).forEach((k) => delete mocks[k]);
    Object.assign(mocks, prevMocks);
  }

  // ═══ 6. Ordering: candidate welcome already sent, later employer metadata -> NO second email ═══
  {
    resetWorld();
    const { insertPendingWelcome, decideAndSend } = load("lib/welcome-email.ts");
    await insertPendingWelcome("user_order_1");
    const first = await decideAndSend("user_order_1", { planHint: undefined, firstNameHint: "Alex", emailHint: "alex@example.com" });
    check("ordering: first call with no plan sends the candidate version", first.sent === true && first.version === "candidate", first);
    check("ordering: exactly one email so far", state.outbox.length === 1, state.outbox);

    const second = await decideAndSend("user_order_1", { planHint: "employer", firstNameHint: "Alex", emailHint: "alex@example.com" });
    check("ordering: a later call with employer metadata sends NOTHING — the marker wins", second.sent === false, second);
    check("ordering: still exactly one email ever, and it's the candidate version", state.outbox.length === 1 && state.outbox[0].subject.includes("Start with one job posting"), state.outbox);
  }

  // ═══ 7. Copy integrity — exact approved subject + key body strings, both versions ═══
  {
    const { renderWelcomeEmail } = load("lib/welcome-email.ts");
    const candidate = renderWelcomeEmail("candidate", "Jordan");
    check("copy: candidate subject is exactly the approved string", candidate.subject === "Welcome to ResumeTailored. Start with one job posting.", candidate.subject);
    check(
      "copy: candidate body contains the approved key sentences verbatim",
      candidate.html.includes("Hi Jordan,") &&
        candidate.html.includes("Thanks for joining ResumeTailored. Your account is ready.") &&
        candidate.html.includes("Your free account includes unlimited resume tailoring, cover letters, and ATS scans. No credit card needed.") &&
        candidate.html.includes("Tailor my first resume") &&
        candidate.html.includes("https://app.resumetailored.com") &&
        candidate.html.includes("Questions? Just reply to this email and we will help.") &&
        candidate.html.includes("support@resumetailored.com"),
      candidate.html
    );

    const employer = renderWelcomeEmail("employer", "Jordan");
    check("copy: employer subject is exactly the approved string", employer.subject === "Welcome to ResumeTailored for Employers. Your first job post is free.", employer.subject);
    check(
      "copy: employer body contains the approved key sentences verbatim",
      employer.html.includes("Your employer account is ready.") &&
        employer.html.includes("Your free tier covers 1 job post, up to 10 candidates, and 1 seat.") &&
        employer.html.includes("Post your first job") &&
        employer.html.includes("https://app.resumetailored.com/employer") &&
        employer.html.includes("with your approval on everything it sends.") &&
        employer.html.includes("Questions? Just reply to this email and we will help."),
      employer.html
    );
  }

  // ═══ 8. firstName fallback renders when Clerk firstName is null ═══
  {
    resetWorld();
    const { insertPendingWelcome, decideAndSend } = load("lib/welcome-email.ts");
    await insertPendingWelcome("user_fallback_1");
    const result = await decideAndSend("user_fallback_1", { planHint: undefined, firstNameHint: null, emailHint: "priya.patel@example.com" });
    check("fallback: sends even with a null firstName", result.sent === true, result);
    check("fallback: greets with the email's local-part, not 'null' or 'there'-by-default-when-avoidable", state.outbox[0].html.includes("Hi priya.patel,"), state.outbox[0].html);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  global.fetch = prevFetch;
  process.exit(failures ? 1 : 0);
})();
