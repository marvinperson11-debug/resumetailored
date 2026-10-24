#!/usr/bin/env node
/**
 * Employer Portal AI Assistant — Phase 0 foundation (npm run test:assistant).
 *
 * Three layers, each tested at the level that actually carries risk:
 *   - Pure window/cap logic (lib/interview-reminders.ts, lib/assistant-chat.ts):
 *     exact-value assertions, no mocking.
 *   - The reminder scan's ORCHESTRATION (lib/interview-reminders.ts
 *     runInterviewReminderScan): its two real dependencies
 *     (lib/employer-collab-store.ts, lib/employer-notify.ts) are stubbed at
 *     the module-load level (same technique as Clerk/Anthropic/Supabase
 *     below, just one layer further in) so the test is about the
 *     orchestration's own idempotency, not about re-proving Supabase query
 *     syntax already covered by reading the code.
 *   - The chat route + tool registry + audit log: driven through the REAL
 *     route handler and REAL lib/assistant-*.ts, lib/employer-store.ts,
 *     lib/employer-collab-store.ts against an in-memory fake Postgres (Clerk
 *     and the Anthropic SDK are also faked — same three outside things
 *     test-guest-gate.cjs fakes, for the same reason).
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const ROOT = path.resolve(__dirname, "..");

let failures = 0;
let passes = 0;
const check = (name, ok, detail) => {
  if (ok) { passes++; console.log("PASS ", name); }
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

process.env.ANTHROPIC_API_KEY = "sk-ant-test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
process.env.GUEST_QUOTA_SALT = "test-only-guest-quota-salt-0123456789";
delete process.env.RESEND_API_KEY; // email sends are no-ops; we only assert on the DB-visible outcomes

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

// ── shared fake world (Clerk + Anthropic + an in-memory Postgres) ───────────
const state = {};
function resetWorld() {
  Object.assign(state, {
    userId: null,
    plan: "free",
    tier: "free",
    tables: { job_postings: [], applicants: [], assistant_audit_log: [] },
    counters: new Map(),
    nextId: {},
    claudeScript: [],
    claudeCalls: [],
    claudeFail: null,
    forceInsertError: null, // one-shot: { table, error } — injects a Postgres-shaped error into the NEXT insert on `table`
  });
}
resetWorld();

function matches(row, filters) {
  return filters.every((f) => {
    if (f.op === "eq") return row[f.col] === f.val;
    if (f.op === "in") return (f.val || []).includes(row[f.col]);
    if (f.op === "is") return (row[f.col] ?? null) === f.val;
    return true; // or/not/gte/lte: unused by the queries this harness exercises
  });
}

function chainFor(table) {
  const ctx = { op: "select", filters: [], insertRows: null, updateRow: null };
  const exec = () => {
    const rows = state.tables[table] || (state.tables[table] = []);
    if (ctx.op === "select") {
      const filtered = rows.filter((r) => matches(r, ctx.filters));
      return { data: filtered, error: null, count: filtered.length };
    }
    if (ctx.op === "insert" || ctx.op === "upsert") {
      if (state.forceInsertError && state.forceInsertError.table === table) {
        const err = state.forceInsertError.error;
        state.forceInsertError = null;
        return { data: null, error: err };
      }
      const out = [];
      for (const row of ctx.insertRows) {
        const id = row.id ?? `${table}-${(state.nextId[table] = (state.nextId[table] || 0) + 1)}`;
        const full = { created_at: new Date().toISOString(), ...row, id };
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
    if (ctx.op === "delete") {
      state.tables[table] = rows.filter((r) => !matches(r, ctx.filters));
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
  const single = () => {
    if (table === "usage_counters" && ctx.op === "select") {
      const scope = ctx.filters.find((f) => f.col === "scope_id")?.val;
      const kind = ctx.filters.find((f) => f.col === "kind")?.val;
      const period = ctx.filters.find((f) => f.col === "period")?.val;
      return Promise.resolve({ data: { count: state.counters.get(`${scope}|${kind}|${period}`) || 0 }, error: null });
    }
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
          if (prop === "delete") { ctx.op = "delete"; return p; }
          if (prop === "eq" || prop === "in" || prop === "is") { ctx.filters.push({ op: prop, col: args[0], val: args[1] }); return p; }
          return p; // select/order/limit/or/not/gte/lte: no-ops in this harness
        };
      },
    }
  );
  return p;
}

const rpcImpl = {
  bump_usage_counter({ p_scope, p_kind, p_period, p_by }) {
    const key = `${p_scope}|${p_kind}|${p_period}`;
    const next = (state.counters.get(key) || 0) + (p_by || 1);
    state.counters.set(key, next);
    return next;
  },
};
const fakeDb = {
  rpc(name, args) {
    return Promise.resolve({ data: rpcImpl[name] ? rpcImpl[name](args) : null, error: rpcImpl[name] ? null : { message: `unknown rpc ${name}` } });
  },
  from: (table) => chainFor(table),
};

class FakeAnthropic {
  constructor() {
    this.messages = {
      create: async (args) => {
        state.claudeCalls.push(args);
        if (state.claudeFail) throw new Error("upstream failure");
        const next = state.claudeScript.shift();
        return next || { content: [{ type: "text", text: "I don't have an answer for that." }], usage: { input_tokens: 10, output_tokens: 10 } };
      },
    };
  }
}

const mocks = {
  "@clerk/nextjs/server": () => ({
    auth: async () => ({ userId: state.userId }),
    currentUser: async () => (state.userId ? { id: state.userId, publicMetadata: { plan: "employer", type: "organization", tier: state.tier } } : null),
    clerkClient: async () => ({ users: { getUser: async () => ({ emailAddresses: [{ emailAddress: "owner@example.com" }], publicMetadata: { tier: state.tier } }) } }),
  }),
  "@anthropic-ai/sdk": () => ({ __esModule: true, default: FakeAnthropic }),
  "@supabase/supabase-js": () => ({ createClient: () => fakeDb }),
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (mocks[request]) return mocks[request]();
  return origLoad.apply(this, arguments);
};

const load = (rel) => require(path.join(ROOT, rel));
const route = (rel) => load(`app/api/${rel}/route.ts`);
const URLBASE = "https://app.resumetailored.com";

(async () => {
  // ═══ 1. pure window logic (lib/interview-reminders.ts) ═══
  {
    const { dueReminderWindows, hoursUntil } = load("lib/interview-reminders.ts");
    const now = Date.now();
    const at = (hrs) => new Date(now + hrs * 60 * 60 * 1000).toISOString();

    check(
      "windows: an interview 1.5h out with nothing sent yet is due for 2h ONLY (mutual exclusion — the 2h window supersedes 24h, no double reminder)",
      JSON.stringify(dueReminderWindows({ status: "scheduled", scheduledAt: at(1.5), reminder24hSent: false, reminder2hSent: false }, now)) ===
        JSON.stringify(["2h"])
    );
    check(
      "windows: an interview exactly at 'now' (hours <= 0) is never due",
      dueReminderWindows({ status: "scheduled", scheduledAt: at(0), reminder24hSent: false, reminder2hSent: false }, now).length === 0
    );
    check(
      "windows: an interview 20h out is due for 24h only (not yet inside the 2h window)",
      JSON.stringify(dueReminderWindows({ status: "scheduled", scheduledAt: at(20), reminder24hSent: false, reminder2hSent: false }, now)) ===
        JSON.stringify(["24h"])
    );
    check(
      "windows: an interview 30h out is due for neither",
      dueReminderWindows({ status: "scheduled", scheduledAt: at(30), reminder24hSent: false, reminder2hSent: false }, now).length === 0
    );
    check(
      "windows: idempotent — once both flags are set, nothing is due even 1.5h out",
      dueReminderWindows({ status: "scheduled", scheduledAt: at(1.5), reminder24hSent: true, reminder2hSent: true }, now).length === 0
    );
    check(
      "windows: the 24h flag alone still leaves the 2h window due, 1.5h out",
      JSON.stringify(dueReminderWindows({ status: "scheduled", scheduledAt: at(1.5), reminder24hSent: true, reminder2hSent: false }, now)) ===
        JSON.stringify(["2h"])
    );
    check(
      "windows: a cancelled interview is never due, however close",
      dueReminderWindows({ status: "cancelled", scheduledAt: at(0.5), reminder24hSent: false, reminder2hSent: false }, now).length === 0
    );
    check(
      "windows: a past interview (already started) is never due",
      dueReminderWindows({ status: "scheduled", scheduledAt: at(-0.5), reminder24hSent: false, reminder2hSent: false }, now).length === 0
    );
    check("windows: hoursUntil is null for an unparseable date", hoursUntil("not-a-date", now) === null);
  }

  // ═══ 1b. lib/employer-time.ts (Fix 2/3): wall-clock <-> UTC conversion is DST-correct,
  // display shows the right zone abbreviation, and day boundaries are computed in the
  // employer's own timezone rather than the server's UTC ═══
  {
    const { getEmployerTimezone, wallClockToUtc, formatEmployerTime, startOfDayInTz, localHourInTz, DEFAULT_EMPLOYER_TIMEZONE } = load("lib/employer-time.ts");
    const NY = "America/New_York";

    check("employer-time: default timezone is America/New_York", DEFAULT_EMPLOYER_TIMEZONE === "America/New_York");
    const prevTzEnv = process.env.EMPLOYER_TIMEZONE;
    delete process.env.EMPLOYER_TIMEZONE;
    check("employer-time: getEmployerTimezone resolves to the default with no env override", (await getEmployerTimezone("emp_1")) === "America/New_York");
    process.env.EMPLOYER_TIMEZONE = "America/Chicago";
    check("employer-time: getEmployerTimezone respects EMPLOYER_TIMEZONE when set", (await getEmployerTimezone("emp_1")) === "America/Chicago");
    if (prevTzEnv === undefined) delete process.env.EMPLOYER_TIMEZONE;
    else process.env.EMPLOYER_TIMEZONE = prevTzEnv;

    // "Oct 24 10:00 AM" in America/New_York, while EDT (UTC-4) is in effect -> 14:00 UTC.
    check(
      "employer-time: wallClockToUtc resolves an October wall-clock time via EDT (UTC-4)",
      wallClockToUtc("2026-10-24T10:00:00", NY) === "2026-10-24T14:00:00.000Z",
      wallClockToUtc("2026-10-24T10:00:00", NY)
    );
    // The SAME wall-clock numbers in mid-January, while EST (UTC-5) is in effect -> 15:00 UTC.
    check(
      "employer-time: wallClockToUtc resolves the SAME wall-clock time via EST (UTC-5) in January",
      wallClockToUtc("2026-01-24T10:00:00", NY) === "2026-01-24T15:00:00.000Z",
      wallClockToUtc("2026-01-24T10:00:00", NY)
    );

    // Both sides of the Nov 1, 2026 fall-back DST transition (2026's US "spring forward"/
    // "fall back" dates: DST ends Sun Nov 1, 2026 02:00 local).
    check(
      "employer-time: wallClockToUtc — just BEFORE the fall-back transition is still EDT (UTC-4)",
      wallClockToUtc("2026-10-31T23:00:00", NY) === "2026-11-01T03:00:00.000Z",
      wallClockToUtc("2026-10-31T23:00:00", NY)
    );
    check(
      "employer-time: wallClockToUtc — just AFTER the fall-back transition is EST (UTC-5)",
      wallClockToUtc("2026-11-02T11:00:00", NY) === "2026-11-02T16:00:00.000Z",
      wallClockToUtc("2026-11-02T11:00:00", NY)
    );

    // Display: the right zone abbreviation on each side of the same transition.
    check(
      "employer-time: formatEmployerTime shows EDT in October",
      /EDT/.test(formatEmployerTime("2026-10-24T14:00:00.000Z", NY)) && /10:00\s*AM/.test(formatEmployerTime("2026-10-24T14:00:00.000Z", NY)),
      formatEmployerTime("2026-10-24T14:00:00.000Z", NY)
    );
    check(
      "employer-time: formatEmployerTime shows EST in January",
      /EST/.test(formatEmployerTime("2026-01-24T15:00:00.000Z", NY)) && /10:00\s*AM/.test(formatEmployerTime("2026-01-24T15:00:00.000Z", NY)),
      formatEmployerTime("2026-01-24T15:00:00.000Z", NY)
    );
    check("employer-time: formatEmployerTime fails soft on an unparseable instant (returns the raw input, not a crash)", formatEmployerTime("not-a-date", NY) === "not-a-date");

    // Day boundaries and local-hour math, the basis for Fix 3's "today" fixes.
    check(
      "employer-time: localHourInTz reads the correct LOCAL hour, not the UTC hour",
      localHourInTz(Date.parse("2026-10-24T14:00:00.000Z"), NY) === 10,
      localHourInTz(Date.parse("2026-10-24T14:00:00.000Z"), NY)
    );
    check(
      "employer-time: startOfDayInTz is midnight in NY (04:00 UTC under EDT), not midnight UTC",
      new Date(startOfDayInTz(Date.parse("2026-10-24T18:00:00.000Z"), NY)).toISOString() === "2026-10-24T04:00:00.000Z",
      new Date(startOfDayInTz(Date.parse("2026-10-24T18:00:00.000Z"), NY)).toISOString()
    );
    check(
      "employer-time: startOfDayInTz correctly shifts to EST (05:00 UTC) in January",
      new Date(startOfDayInTz(Date.parse("2026-01-24T18:00:00.000Z"), NY)).toISOString() === "2026-01-24T05:00:00.000Z",
      new Date(startOfDayInTz(Date.parse("2026-01-24T18:00:00.000Z"), NY)).toISOString()
    );
  }

  // ═══ 2. the reminder scan's orchestration: listInterviewsForReminderScan/markInterviewReminded ═══
  // stubbed (same reasoning as the chat-route tests trust the real Supabase query
  // syntax without re-deriving it here); the email send itself runs for REAL
  // (lib/interview-reminders.ts's own notifyCandidateOfInterviewReminder, which
  // calls the real getApplicant/getEmployerProfile against the in-memory fake
  // Postgres below, then the real sendEmail against a mocked fetch) so this is
  // an honest end-to-end check that a reminder is actually attempted, not just
  // that a mock was called.
  {
    resetWorld();
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist" }];
    state.tables.applicants = [
      { id: 101, job_id: 1, name: "Maria", email: "maria@example.com" },
      { id: 102, job_id: 1, name: "Devon", email: "devon@example.com" },
    ];
    const prevResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "test-resend-key";
    const emailsSent = [];
    const prevFetch = global.fetch;
    global.fetch = async (url, opts) => {
      emailsSent.push({ url, body: JSON.parse(opts.body) });
      return { ok: true };
    };

    const scan = { rows: [], reminded: [] };
    const stubCollab = {
      listInterviewsForReminderScan: async () => scan.rows,
      markInterviewReminded: async (id, which) => scan.reminded.push({ id, which }),
    };
    const stubMocks = { "./employer-collab-store": () => stubCollab };
    const prevLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (stubMocks[request]) return stubMocks[request]();
      return prevLoad.apply(this, arguments);
    };
    delete require.cache[require.resolve(path.join(ROOT, "lib/interview-reminders.ts"))];
    const { runInterviewReminderScan } = load("lib/interview-reminders.ts");

    const now = Date.now();
    const at = (hrs) => new Date(now + hrs * 60 * 60 * 1000).toISOString();
    scan.rows = [
      { id: 1, employerId: "emp_1", applicantId: 101, jobId: 1, jobTitle: "Dental Hygienist", title: "Phone screen", scheduledAt: at(1.5), durationMin: 30, mode: "phone", location: "", interviewer: "", status: "scheduled", roomUrl: "", reminder24hSent: false, reminder2hSent: false, applicantName: "Maria", applicantEmail: "maria@example.com" },
      { id: 2, employerId: "emp_1", applicantId: 102, jobId: 1, jobTitle: "Dental Hygienist", title: "Final round", scheduledAt: at(20), durationMin: 45, mode: "video", location: "", interviewer: "", status: "scheduled", roomUrl: "", reminder24hSent: false, reminder2hSent: false, applicantName: "Devon", applicantEmail: "devon@example.com" },
    ];

    const result1 = await runInterviewReminderScan(now);
    check("scheduler: scans both seeded interviews", result1.scanned === 2, result1);
    check(
      "scheduler: exactly 2 reminders sent (interview #1 gets 2h ONLY — mutual exclusion supersedes its 24h window — interview #2 gets 24h only), and a real email was attempted for each",
      result1.reminded === 2 && emailsSent.length === 2,
      emailsSent
    );
    check(
      "scheduler: interview #1 got only '2h' (never both), #2 got only '24h'",
      JSON.stringify(scan.reminded.filter((r) => r.id === 1).map((r) => r.which)) === JSON.stringify(["2h"]) &&
        JSON.stringify(scan.reminded.filter((r) => r.id === 2).map((r) => r.which)) === JSON.stringify(["24h"]),
      scan.reminded
    );
    check(
      "scheduler: each reminder email actually went to the real seeded candidate address",
      emailsSent.every((e) => e.body.to === "maria@example.com" || e.body.to === "devon@example.com"),
      emailsSent.map((e) => e.body.to)
    );

    // Apply the stamps the real markInterviewReminded would have persisted
    // (which === "2h" stamps BOTH flags — see lib/employer-collab-store.ts),
    // then re-run.
    for (const r of scan.reminded) {
      const row = scan.rows.find((x) => x.id === r.id);
      if (r.which === "24h") row.reminder24hSent = true;
      else { row.reminder24hSent = true; row.reminder2hSent = true; }
    }
    scan.reminded = [];
    emailsSent.length = 0;
    const result2 = await runInterviewReminderScan(now);
    check("scheduler: a second run at the same `now` sends nothing (idempotent)", result2.reminded === 0 && emailsSent.length === 0, result2);

    Module._load = prevLoad;
    delete require.cache[require.resolve(path.join(ROOT, "lib/interview-reminders.ts"))];
    global.fetch = prevFetch;
    if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResendKey;
  }

  // ═══ 2b. markInterviewReminded: "2h" stamps BOTH flags (the real implementation,
  // against the fake DB directly — not the stub) ═══
  {
    resetWorld();
    state.tables.interviews = [
      { id: 55, employer_id: "emp_1", applicant_id: 101, job_id: 1, title: "Phone screen", scheduled_at: new Date().toISOString(), duration_min: 30, mode: "phone", status: "scheduled", reminder_24h_sent: false, reminder_2h_sent: false },
      { id: 56, employer_id: "emp_1", applicant_id: 102, job_id: 1, title: "Final round", scheduled_at: new Date().toISOString(), duration_min: 30, mode: "phone", status: "scheduled", reminder_24h_sent: false, reminder_2h_sent: false },
    ];
    const { markInterviewReminded } = load("lib/employer-collab-store.ts");
    await markInterviewReminded(55, "2h");
    const row55 = state.tables.interviews.find((r) => r.id === 55);
    check("markInterviewReminded('2h') stamps BOTH reminder_24h_sent and reminder_2h_sent", row55.reminder_24h_sent === true && row55.reminder_2h_sent === true, row55);

    await markInterviewReminded(56, "24h");
    const row56 = state.tables.interviews.find((r) => r.id === 56);
    check("markInterviewReminded('24h') stamps ONLY reminder_24h_sent", row56.reminder_24h_sent === true && row56.reminder_2h_sent === false, row56);
  }

  // ═══ 3. audit log: append, employer-scoped, no update/delete capability ═══
  {
    resetWorld();
    const audit = load("lib/assistant-audit.ts");
    await audit.logAction({ employerId: "emp_A", actorUserId: "user_A", actorEmail: "a@example.com", action: "get_jobs", targetType: null, targetId: null, payload: { status: "active" }, status: "executed" });
    await audit.logAction({ employerId: "emp_A", actorUserId: "user_A", actorEmail: "a@example.com", action: "get_candidate", targetType: "candidate", targetId: 7, payload: { candidateId: 7 }, status: "failed" });
    await audit.logAction({ employerId: "emp_B", actorUserId: "user_B", actorEmail: "b@example.com", action: "get_jobs", targetType: null, targetId: null, payload: {}, status: "executed" });

    const aLog = await audit.listActions("emp_A");
    const bLog = await audit.listActions("emp_B");
    check("audit: employer A's log has exactly its own 2 rows", aLog.length === 2 && aLog.every((r) => r.employerId === "emp_A"), aLog);
    check("audit: employer A cannot see employer B's row", !aLog.some((r) => r.action === "get_jobs" && r.employerId === "emp_B"));
    check("audit: employer B's log has exactly its own 1 row", bLog.length === 1 && bLog[0].employerId === "emp_B", bLog);
    check("audit: a failed tool call is recorded with status 'failed' and its target", aLog.some((r) => r.action === "get_candidate" && r.status === "failed" && r.targetId === "7"));
    check("audit: a logged row's payload is exactly the tool's inputs", aLog.some((r) => r.action === "get_jobs" && JSON.stringify(r.payload) === JSON.stringify({ status: "active" })));

    const src = fs.readFileSync(path.join(ROOT, "lib/assistant-audit.ts"), "utf8");
    check(
      "audit: the module itself exposes no update/delete against assistant_audit_log (append-only is enforced in code too, not just the DB trigger)",
      !/\.from\(\s*["']assistant_audit_log["']\s*\)\s*\.\s*(update|delete)\s*\(/.test(src) && !/export\s+(async\s+)?function\s+(update|delete)/i.test(src)
    );
    const migration = fs.readFileSync(path.join(ROOT, "supabase/migrations/0051_assistant_audit_log.sql"), "utf8");
    check("audit: the migration installs BEFORE UPDATE and BEFORE DELETE triggers that raise", /before update[\s\S]*assistant_audit_log_block_mutation/i.test(migration) && /before delete[\s\S]*assistant_audit_log_block_mutation/i.test(migration));

    // Fix Round 3, Section D: migration 0051's REAL column set has no column
    // named "payload" (it's payload_json) — `logAction` is the ONLY writer
    // against this table (every other caller, including the daily-brief
    // quiet-skip write, goes through it), so aligning this one insert call
    // aligns every writer at once. A future writer that bypasses logAction
    // and inserts directly under a `payload:` key (instead of `payload_json`)
    // would silently store an empty payload on read — this fails the build
    // instead, the same "prove it from source" shape as the append-only check
    // just above.
    check(
      "audit (Fix Round 3, D): the real column set from migration 0051 is exactly what's declared (no 'payload' column — it's 'payload_json')",
      /create table if not exists public\.assistant_audit_log[\s\S]*?\);/i.test(migration) &&
        /payload_json jsonb/i.test(migration) &&
        !/\bpayload\s+jsonb/i.test(migration),
      migration
    );
    check(
      "audit (Fix Round 3, D): logAction's insert targets payload_json, never a bare 'payload' key",
      /payload_json:\s*input\.payload/.test(src) && !/[^_]payload:\s*input\.payload/.test(src),
      src
    );
  }

  // ═══ 4. tool registry shape: seven read-only tools (Prompt 3's get_pipeline_health, Prompt 5's hiring_report) + eleven Scale-gated tools (ten mutating — Prompt 2 + Prompt 4's set_ack_template/send_offer + Fix Round 2's publish_job + Fix Round 3's reschedule_interview + Prompt 5's start_job_from_playbook/create_interview_kit — plus Fix Round 5's read-only-but-Scale-gated get_pending_actions) ═══
  {
    const { ASSISTANT_TOOL_NAMES, ASSISTANT_TOOL_EXECUTORS, ASSISTANT_TOOL_DEFS, READ_ONLY_TOOL_NAMES } = load("lib/assistant-tools.ts");
    const readOnly = ["get_jobs", "summarize_candidates", "summarize_pipeline", "get_schedule", "get_candidate", "get_pipeline_health", "hiring_report"];
    const mutating = [
      "draft_job_post",
      "publish_job",
      "move_candidates",
      "schedule_interviews",
      "message_candidates",
      "set_ack_template",
      "send_offer",
      "reschedule_interview",
      "start_job_from_playbook",
      "create_interview_kit",
    ];
    const scaleGated = ["get_pending_actions", ...mutating];
    check("tool registry: contains exactly the seven read-only + eleven Scale-gated tools, nothing else", JSON.stringify([...ASSISTANT_TOOL_NAMES].sort()) === JSON.stringify([...readOnly, ...scaleGated].sort()), ASSISTANT_TOOL_NAMES);
    check(
      "tool registry: every name has exactly one executor and one def",
      [...readOnly, ...scaleGated].every((n) => typeof ASSISTANT_TOOL_EXECUTORS[n] === "function" && ASSISTANT_TOOL_DEFS.some((d) => d.name === n))
    );
    check("tool registry: READ_ONLY_TOOL_NAMES is exactly the seven read-only tools", JSON.stringify([...READ_ONLY_TOOL_NAMES].sort()) === JSON.stringify([...readOnly].sort()), READ_ONLY_TOOL_NAMES);
    check("tool registry (Fix Round 5): get_pending_actions is NOT in READ_ONLY_TOOL_NAMES — it's gated to the mutate-capable population even though it mutates nothing itself", !READ_ONLY_TOOL_NAMES.includes("get_pending_actions"), READ_ONLY_TOOL_NAMES);
    const mutatingWords = /\b(create|update|delete|send|move|schedule|cancel|publish|invite|remove|message)\b/i;
    check(
      "tool registry: the seven READ-ONLY tools' name/description still imply no mutation (defense in depth beyond 'there is no mutating executor' for those seven)",
      ASSISTANT_TOOL_DEFS.filter((d) => readOnly.includes(d.name)).every((d) => !mutatingWords.test(d.name) && !mutatingWords.test(d.description))
    );
  }

  // ═══ 5. chat route: unauthenticated -> 401; below-Portal -> 403; Portal -> 200 ═══
  {
    resetWorld();
    const send = async () => {
      const req = new Request(`${URLBASE}/api/employer/assistant/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "What jobs do I have open?" }] }),
      });
      return route("employer/assistant/chat").POST(req);
    };

    state.userId = null;
    const guestRes = await send();
    check("chat route: unauthenticated -> 401", guestRes.status === 401, guestRes.status);

    state.userId = "emp_1";
    state.tier = "free";
    const freeRes = await send();
    check("chat route: a signed-in Free-tier employer -> 403", freeRes.status === 403, freeRes.status);
    const freeBody = await freeRes.clone().json();
    check("chat route: the 403 names why (portal_required)", freeBody.error === "portal_required", freeBody);

    state.tier = "portal";
    state.claudeScript = [{ content: [{ type: "text", text: "You have 1 open job: Dental Hygienist." }], usage: { input_tokens: 10, output_tokens: 10 } }];
    const portalRes = await send();
    check("chat route: a Portal-tier employer -> 200", portalRes.status === 200, portalRes.status);
    const text = await portalRes.text();
    check("chat route: the body is the assistant's reply text", text.includes("Dental Hygienist"), text);
  }

  // ═══ 6. anti-fabrication: a summary against seeded fixtures contains only seeded facts ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "portal";
    state.tables.job_postings = [{ id: 501, employer_id: "emp_1", title: "Dental Hygienist", status: "active", department: "Clinical", location: "Downtown", public_listed: true, created_at: "2026-01-01T00:00:00Z" }];
    state.tables.applicants = [
      { id: 9001, job_id: 501, name: "Maria Alvarez", email: "maria@example.com", resume_text: "", cover_letter: "", match_score: 88, match_analysis: null, status: "interviewed", notes: "", created_at: "2026-01-02T00:00:00Z" },
      { id: 9002, job_id: 501, name: "Devon Wu", email: "devon@example.com", resume_text: "", cover_letter: "", match_score: 61, match_analysis: null, status: "new", notes: "", created_at: "2026-01-03T00:00:00Z" },
    ];

    const { runAssistantTurn } = load("lib/assistant-chat.ts");
    // A deterministic stand-in for "the model": first call asks for the real tool,
    // second call composes an answer using ONLY the tool_result it was handed —
    // this is testing the PLUMBING (tool output really reaches the final answer,
    // nothing is invented in between), not Claude's own judgment, which no offline
    // test can exercise.
    // First "model" turn asks for the real tool. Second turn is scripted to
    // literally quote the names out of that tool's REAL (just-computed) JSON
    // result — so this is checking real plumbing (does the tool's actual data
    // reach the final answer unaltered?), not a hand-typed string that merely
    // happens to match what we expect.
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const realToolResult = (await ASSISTANT_TOOL_EXECUTORS.summarize_candidates("emp_1", { jobId: 501 })).data;
    const names = realToolResult.candidates.map((c) => c.name);
    state.claudeScript = [
      { content: [{ type: "tool_use", id: "tu_1", name: "summarize_candidates", input: { jobId: 501 } }], usage: { input_tokens: 10, output_tokens: 10 } },
      {
        content: [{ type: "text", text: `Job #501 has ${realToolResult.count} candidates: ${names.join(", ")}.` }],
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    ];

    const turn = await runAssistantTurn({ employerId: "emp_1", actorUserId: "user_1", actorEmail: "owner@example.com", messages: [{ role: "user", content: "Summarize candidates for the hygienist job." }] });
    check("anti-fabrication: the turn succeeds", turn.ok === true, turn);
    if (turn.ok) {
      check("anti-fabrication: the reply names the REAL seeded candidates", turn.reply.includes("Maria Alvarez") && turn.reply.includes("Devon Wu"), turn.reply);
      check("anti-fabrication: the reply does not contain a name that was never seeded", !/Jordan|Sam Smith|John Doe/.test(turn.reply), turn.reply);
    }
    const auditRows = await load("lib/assistant-audit.ts").listActions("emp_1");
    check("anti-fabrication: the tool call that produced this answer is in the audit log", auditRows.some((r) => r.action === "summarize_candidates" && r.status === "executed"), auditRows);
  }

  // ═══ 7. "Move Maria to interviews" — no mutating tool exists, so nothing executes ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "portal";
    state.claudeScript = [
      {
        content: [{ type: "text", text: "I'm read-only for now and can't move candidates between stages yet — you'll need to do that yourself in the portal." }],
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    ];
    const { runAssistantTurn } = load("lib/assistant-chat.ts");
    const turn = await runAssistantTurn({ employerId: "emp_1", actorUserId: "user_1", actorEmail: "owner@example.com", messages: [{ role: "user", content: "Move Maria to interviews." }] });
    check("read-only: the assistant declines rather than attempting an action", turn.ok === true && /read-only|can't|cannot/i.test(turn.reply), turn);
    const auditRows = await load("lib/assistant-audit.ts").listActions("emp_1");
    check("read-only: NOTHING was written to the audit log (no tool was ever called)", auditRows.length === 0, auditRows);
  }

  // ═══ 8. cost caps ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "portal";
    const { runAssistantTurn, maxConversationTurns, maxEmployerDailyTurns, CONVERSATION_CAP_MESSAGE, DAILY_CAP_MESSAGE } = load("lib/assistant-chat.ts");

    const tooMany = Array.from({ length: maxConversationTurns() + 1 }, (_, i) => ({ role: "user", content: `message ${i}` }));
    const capped = await runAssistantTurn({ employerId: "emp_1", actorUserId: "user_1", actorEmail: null, messages: tooMany });
    check("cost caps: exceeding the per-conversation cap refuses with the stop message", capped.ok === false && capped.reason === "conversation_cap" && capped.reply === CONVERSATION_CAP_MESSAGE, capped);
    check("cost caps: the cap refusal never calls the model", state.claudeCalls.length === 0);

    resetWorld();
    state.userId = "emp_1";
    state.tier = "portal";
    state.counters.set(`emp_1|assistant_turn|${new Date().toISOString().slice(0, 10)}`, maxEmployerDailyTurns());
    const dailyCapped = await runAssistantTurn({ employerId: "emp_1", actorUserId: "user_1", actorEmail: null, messages: [{ role: "user", content: "hi" }] });
    check("cost caps: at the per-employer daily cap, the chat route refuses further calls", dailyCapped.ok === false && dailyCapped.reason === "daily_cap" && dailyCapped.reply === DAILY_CAP_MESSAGE, dailyCapped);
    check("cost caps: the daily cap refusal never calls the model either", state.claudeCalls.length === 0);

    resetWorld();
    state.userId = "emp_1";
    state.tier = "portal";
    state.claudeScript = [{ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }];
    await runAssistantTurn({ employerId: "emp_1", actorUserId: "user_1", actorEmail: null, messages: [{ role: "user", content: "hi" }] });
    const day = new Date().toISOString().slice(0, 10);
    check("cost caps: a normal turn bumps the per-employer daily counter by exactly 1", state.counters.get(`emp_1|assistant_turn|${day}`) === 1, [...state.counters.entries()]);
  }

  // ═══ 9. ActionCard component: pending and failed states render per spec ═══
  await (async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://app.resumetailored.com" });
    const { window } = dom;
    for (const k of ["window", "document", "navigator", "HTMLElement", "Event"]) {
      try { Object.defineProperty(globalThis, k, { value: k === "window" ? window : window[k], configurable: true, writable: true }); } catch { /* read-only on this Node */ }
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    const messages = JSON.parse(fs.readFileSync(path.join(ROOT, "messages/en.json"), "utf8"));
    const lookup = (ns, key) => `${ns}.${key}`.split(".").reduce((o, k) => (o == null ? o : o[k]), messages);
    const intlMock = () => ({
      useTranslations: (ns) => {
        const t = (key) => {
          const v = lookup(ns, key);
          if (typeof v !== "string") throw new Error(`missing i18n key ${ns}.${key}`);
          return v;
        };
        return t;
      },
    });
    const prevLoad2 = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === "next-intl") return intlMock();
      if (mocks[request]) return mocks[request]();
      return prevLoad2.apply(this, arguments);
    };

    const React = require("react");
    const { createRoot } = require("react-dom/client");
    delete require.cache[require.resolve(path.join(ROOT, "components/assistant/ActionCard.tsx"))];
    const { ActionCard } = load("components/assistant/ActionCard.tsx");

    const container = window.document.getElementById("root");
    const root = createRoot(container);
    const { act } = React;

    await act(async () => {
      root.render(
        React.createElement(ActionCard, {
          title: "Move candidate to Interviewed",
          irreversible: true,
          irreversibleLabel: "This can't be unsent",
          resolvedSpecifics: [{ label: "Candidate", value: "Maria Alvarez" }],
          items: [{ id: "1", artifact: "Maria Alvarez — Dental Hygienist" }],
          state: "pending",
        })
      );
    });
    const html1 = container.innerHTML;
    check("ActionCard[pending]: shows the title", html1.includes("Move candidate to Interviewed"));
    check("ActionCard[pending]: shows the real artifact text, not a paraphrase", html1.includes("Maria Alvarez — Dental Hygienist"));
    check("ActionCard[pending]: shows the resolved specific", html1.includes("Candidate") && html1.includes("Maria Alvarez"));
    check("ActionCard[pending]: shows the irreversible label", html1.includes("This can&#x27;t be unsent") || html1.includes("This can't be unsent"));
    check("ActionCard[pending]: has both Approve and Cancel controls", container.querySelectorAll("button").length === 2);

    await act(async () => {
      root.render(
        React.createElement(ActionCard, {
          title: "Send a follow-up message",
          irreversible: true,
          items: [{ id: "1", artifact: "Hi Maria, ..." }],
          state: "failed",
          failureReason: "The candidate's email bounced.",
        })
      );
    });
    const html2 = container.innerHTML;
    check("ActionCard[failed]: shows the failure reason", html2.includes("The candidate's email bounced."));
    check("ActionCard[failed]: no Approve/Cancel controls once failed", container.querySelectorAll("button").length === 0);

    await act(async () => root.unmount());
    Module._load = prevLoad2;
  })();

  // ═══ 10. plan gating: canAssistantMutate (lib/employer-plan.ts) ═══
  {
    const { canAssistantMutate } = load("lib/employer-plan.ts");
    check("plan gating: free is not mutate-capable", canAssistantMutate({ plan: "employer", type: "organization", tier: "free" }) === false);
    check("plan gating: portal is not mutate-capable (read-only assistant only)", canAssistantMutate({ plan: "employer", type: "organization", tier: "portal" }) === false);
    check("plan gating: scale IS mutate-capable", canAssistantMutate({ plan: "employer", type: "organization", tier: "scale" }) === true);
    check("plan gating: corporate IS mutate-capable", canAssistantMutate({ plan: "employer", type: "organization", tier: "corporate" }) === true);
    check("plan gating: admin bypasses tier entirely", canAssistantMutate({ plan: "employer", type: "organization", tier: "free", isAdmin: true }) === true);
  }

  // ═══ 11. Portal-tier chat is never even OFFERED the mutating tools (so "decline gracefully, zero rows created" is true by construction); Scale-tier gets all eighteen (Fix Round 5 adds get_pending_actions; Prompt 5 adds hiring_report to the read-only side and start_job_from_playbook/create_interview_kit to the mutating side) ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "portal";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist", status: "active" }];
    state.claudeScript = [{ content: [{ type: "text", text: "I can't do that yet on this plan — that needs the Scale plan. I can still look things up for you." }], usage: { input_tokens: 10, output_tokens: 10 } }];
    const { runAssistantTurn } = load("lib/assistant-chat.ts");
    const turn = await runAssistantTurn({ employerId: "emp_1", actorUserId: "user_1", actorEmail: null, canMutate: false, messages: [{ role: "user", content: "Post a new job for a hygienist and publish it." }] });
    check("plan gating (chat): a Portal-tier turn succeeds with a graceful decline", turn.ok === true, turn);
    const toolNamesSent = (state.claudeCalls[0]?.tools || []).map((t) => t.name).sort();
    check(
      "plan gating (chat): a Portal-tier turn is offered ONLY the seven read-only tools — the mutating ones are never in the list Claude sees",
      JSON.stringify(toolNamesSent) === JSON.stringify(["get_candidate", "get_jobs", "get_pipeline_health", "get_schedule", "hiring_report", "summarize_candidates", "summarize_pipeline"]),
      toolNamesSent
    );
    check("plan gating (chat): zero pending-action rows were created", (state.tables.assistant_pending_actions || []).length === 0);

    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.claudeScript = [{ content: [{ type: "text", text: "Sure, what would you like me to do?" }], usage: { input_tokens: 10, output_tokens: 10 } }];
    await load("lib/assistant-chat.ts").runAssistantTurn({ employerId: "emp_1", actorUserId: "user_1", actorEmail: null, canMutate: true, messages: [{ role: "user", content: "hi" }] });
    const scaleToolNames = (state.claudeCalls[0]?.tools || []).map((t) => t.name).sort();
    check(
      "plan gating (chat): a Scale-tier turn is offered all eighteen tools",
      scaleToolNames.length === 18 &&
        scaleToolNames.includes("draft_job_post") &&
        scaleToolNames.includes("publish_job") &&
        scaleToolNames.includes("message_candidates") &&
        scaleToolNames.includes("get_pipeline_health") &&
        scaleToolNames.includes("set_ack_template") &&
        scaleToolNames.includes("send_offer") &&
        scaleToolNames.includes("reschedule_interview") &&
        scaleToolNames.includes("get_pending_actions") &&
        scaleToolNames.includes("hiring_report") &&
        scaleToolNames.includes("start_job_from_playbook") &&
        scaleToolNames.includes("create_interview_kit"),
      scaleToolNames
    );
  }

  // ═══ 12. draft_job_post: pending action created with NO job yet; approve executes exactly once (idempotent); draft never publishes ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    const drafted = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: "We're hiring a dental hygienist to join our downtown clinic team.", title: "Dental Hygienist", location: "Austin, TX", publish: false },
      ctx
    );
    const pendingId = drafted.data.pendingActionId;
    check("draft_job_post: returns a pending action id and a pending card", drafted.data.status === "pending" && !!pendingId && drafted.data.card.items[0].artifact.includes("Dental Hygienist"), drafted);
    check("draft_job_post: NO job was created yet — drafting the tool call creates only the pending row", (state.tables.job_postings || []).length === 0);

    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const outcome1 = await approvePendingAction("emp_1", "user_1", "owner@example.com", pendingId);
    check("draft_job_post: approve executes and creates exactly one job", outcome1.status === "executed" && state.tables.job_postings.length === 1, [outcome1, state.tables.job_postings]);
    check("draft_job_post: the job is saved as a DRAFT — not published (smoke-tested behavior)", state.tables.job_postings[0].status === "draft" && !state.tables.job_postings[0].public_listed, state.tables.job_postings[0]);

    const outcome2 = await approvePendingAction("emp_1", "user_1", "owner@example.com", pendingId);
    check("draft_job_post: a second approve is a no-op — reports 'executed' without creating a second job", outcome2.status === "executed" && state.tables.job_postings.length === 1, [outcome2, state.tables.job_postings.length]);

    const auditRows = await load("lib/assistant-audit.ts").listActions("emp_1");
    check(
      "logAction: the execution is audited with the APPROVING user as actor and status 'executed'",
      auditRows.some((r) => r.action === "draft_job_post" && r.status === "executed" && r.actorUserId === "user_1"),
      auditRows
    );
  }

  // ═══ 13. draft_job_post: publish=true path is verified separately from the draft path ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const drafted = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      {
        role_description: "We're hiring a warehouse associate for our busy fulfillment center. Duties include picking, packing, and shipping orders accurately.",
        title: "Warehouse Associate",
        publish: true,
        salary_min: 45000,
        salary_max: 55000,
        benefits_description: "Health insurance, 401(k) match, paid time off.",
      },
      { actorUserId: "user_1", actorEmail: null }
    );
    check("draft_job_post (publish): the card says it will be published", /will be published/i.test(drafted.data.card.title), drafted.data.card.title);
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const outcome = await approvePendingAction("emp_1", "user_1", null, drafted.data.pendingActionId);
    check("draft_job_post (publish): approving with publish=true creates an ACTIVE, publicly-listed job", outcome.status === "executed" && state.tables.job_postings[0].status === "active" && state.tables.job_postings[0].public_listed === true, state.tables.job_postings[0]);
  }

  // ═══ 13b. draft_job_post publish-path validation parity (Prompt 4, Part A.3): the
  // assistant's publish path must reject the EXACT same inputs the hand-driven jobs
  // route would reject, via the one shared lib/job-publish-validation.ts gate. ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const { jobPublishViolation } = load("lib/job-publish-validation.ts");

    const badInput = { status: "active", publicListed: true, title: "Line Cook", description: "We're hiring a line cook for our busy downtown restaurant kitchen team. Weekend availability is required and prior experience is a plus.", location: "", salaryMin: null, salaryMax: null, benefitsDescription: "" };
    check("shared validator: a publish with no pay data is itself a violation (sanity check before using it as a fixture)", !!jobPublishViolation(badInput));

    // Same payload the hand route's POST /api/employer/jobs would 422 on.
    const drafted = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: badInput.description, title: badInput.title, publish: true },
      { actorUserId: "user_1", actorEmail: null }
    );
    check("draft_job_post (publish, invalid): the card is still created (pre-approval visibility)", drafted.data.status === "pending" && !!drafted.data.pendingActionId);
    check(
      "draft_job_post (publish, invalid): the card surfaces the SAME pay-transparency message the hand route would 422 with",
      drafted.data.card.resolvedSpecifics.some((s) => s.label.includes("Can't publish yet") && s.value === jobPublishViolation(badInput).message),
      drafted.data.card
    );
    check("draft_job_post (publish, invalid): NO job was created by drafting alone", (state.tables.job_postings || []).length === 0);

    const outcome = await approvePendingAction("emp_1", "user_1", null, drafted.data.pendingActionId);
    check(
      "draft_job_post (publish, invalid): approving still fails at execution — never silently publishes an invalid listing",
      outcome.status === "failed" && outcome.failureReason === jobPublishViolation(badInput).message,
      outcome
    );
    check("draft_job_post (publish, invalid): still zero jobs after a failed approve", (state.tables.job_postings || []).length === 0);

    // Fixing it (adding the required pay fields) and re-drafting succeeds, same as
    // resubmitting the hand-driven form with the missing fields filled in.
    const fixed = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: badInput.description, title: badInput.title, publish: true, salary_min: 40000, salary_max: 48000, benefits_description: "Health insurance, paid sick leave." },
      { actorUserId: "user_1", actorEmail: null }
    );
    check("draft_job_post (publish, fixed): the card now says it will be published", /will be published/i.test(fixed.data.card.title), fixed.data.card.title);
    const fixedOutcome = await approvePendingAction("emp_1", "user_1", null, fixed.data.pendingActionId);
    check("draft_job_post (publish, fixed): approving now succeeds and publishes", fixedOutcome.status === "executed" && state.tables.job_postings.length === 1 && state.tables.job_postings[0].status === "active", [fixedOutcome, state.tables.job_postings]);
  }

  // ═══ 13c. (Section E) employer corrections in chat update the SAME pending action — no
  // duplicate rows — and approval only succeeds once validation actually passes ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const { jobPublishViolation } = load("lib/job-publish-validation.ts");

    const badInput = { status: "active", publicListed: true, title: "Server", description: "We're hiring a server for our busy downtown restaurant. Weekend availability is required.", location: "", salaryMin: null, salaryMax: null, benefitsDescription: "" };
    const drafted = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: badInput.description, title: badInput.title, publish: true }, { actorUserId: "user_1", actorEmail: null });
    const violationMsg = jobPublishViolation(badInput).message;
    check(
      "same-row update: the blocked card shows the hand-route error string VERBATIM",
      drafted.data.card.resolvedSpecifics.some((s) => s.label.includes("Can't publish yet") && s.value === violationMsg),
      drafted.data.card
    );

    // The employer corrects it in chat — BEFORE ever approving — by passing the SAME
    // pending_action_id the first card returned, rather than drafting a fresh one.
    const corrected = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      {
        role_description: badInput.description,
        title: badInput.title,
        publish: true,
        salary_min: 42000,
        salary_max: 50000,
        benefits_description: "Health insurance, paid time off.",
        pending_action_id: drafted.data.pendingActionId,
      },
      { actorUserId: "user_1", actorEmail: null }
    );
    check("same-row update: the correction reuses the SAME pending action id", corrected.data.pendingActionId === drafted.data.pendingActionId, [drafted.data.pendingActionId, corrected.data.pendingActionId]);
    check(
      "same-row update: exactly ONE pending action row exists for this draft — no duplicate",
      (state.tables.assistant_pending_actions || []).filter((r) => r.employer_id === "emp_1").length === 1,
      state.tables.assistant_pending_actions
    );
    check("same-row update: the card now says it will be published", /will be published/i.test(corrected.data.card.title), corrected.data.card.title);

    // Approval was impossible before the correction (the row never left 'pending' because
    // nobody tried); now that validation passes, approving actually executes.
    const outcome = await approvePendingAction("emp_1", "user_1", null, corrected.data.pendingActionId);
    check(
      "same-row update: approval only succeeds once validation passes — now it publishes",
      outcome.status === "executed" && state.tables.job_postings.length === 1 && state.tables.job_postings[0].status === "active",
      outcome
    );

    // A pending_action_id belonging to a different employer (or a different action, or
    // already resolved) is ignored, never hijacked — it just falls back to a fresh row.
    const foreignAttempt = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_A",
      { role_description: "A completely different role for a different employer.", title: "Other Role", pending_action_id: corrected.data.pendingActionId },
      { actorUserId: "user_A", actorEmail: null }
    );
    check("same-row update: a pending_action_id belonging to a different employer is ignored, not hijacked", foreignAttempt.data.pendingActionId !== corrected.data.pendingActionId, foreignAttempt.data.pendingActionId);

    // And once a row has already resolved (executed, here), a later correction can no longer
    // rewrite it in place — it drafts a fresh row instead, since the old one is a terminal record.
    const afterResolved = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: badInput.description, title: "Yet another edit", pending_action_id: corrected.data.pendingActionId },
      { actorUserId: "user_1", actorEmail: null }
    );
    check("same-row update: a correction aimed at an already-EXECUTED row creates a fresh one instead of rewriting history", afterResolved.data.pendingActionId !== corrected.data.pendingActionId, afterResolved.data.pendingActionId);
  }

  // ═══ 14. employer scoping: user from a different employer cannot approve/cancel/see another employer's action (403, distinct from 404) ═══
  {
    resetWorld();
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const drafted = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_A", { role_description: "A role only employer A should be able to touch." }, { actorUserId: "user_A", actorEmail: null });
    const pendingId = drafted.data.pendingActionId;

    const { approvePendingAction, cancelPendingAction } = load("lib/assistant-mutations.ts");
    const approveAsB = await approvePendingAction("emp_B", "user_B", null, pendingId);
    check("employer scoping: employer B approving employer A's action is forbidden, not silently a no-op", approveAsB.found === true && approveAsB.forbidden === true, approveAsB);
    check("employer scoping: the forbidden attempt did not execute anything", (state.tables.job_postings || []).length === 0);

    const cancelAsB = await cancelPendingAction("emp_B", pendingId);
    check("employer scoping: employer B cancelling employer A's action is also forbidden", cancelAsB.found === true && cancelAsB.forbidden === true, cancelAsB);

    const missing = await approvePendingAction("emp_A", "user_A", null, "does-not-exist");
    check("employer scoping: approving a nonexistent id is 'not found', distinguishable from 'forbidden'", missing.found === false && missing.forbidden === false, missing);

    // Same distinction at the real HTTP route level.
    state.userId = "emp_B";
    const approveRes = await route("employer/assistant/actions/[id]/approve").POST(new Request(`${URLBASE}/x`, { method: "POST" }), { params: { id: pendingId } });
    check("employer scoping (route): employer B's own session gets a real 403 approving employer A's id", approveRes.status === 403, approveRes.status);
    const notFoundRes = await route("employer/assistant/actions/[id]/approve").POST(new Request(`${URLBASE}/x`, { method: "POST" }), { params: { id: "does-not-exist" } });
    check("employer scoping (route): a nonexistent id is a real 404", notFoundRes.status === 404, notFoundRes.status);
  }

  // ═══ 15. move_candidates: full draft→approve flow; a changed precondition fails the WHOLE batch with a reason, nothing partially moved ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist", status: "active" }];
    state.tables.applicants = [
      { id: 101, job_id: 1, name: "Maria Alvarez", email: "maria@example.com", status: "new", notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 102, job_id: 1, name: "Devon Wu", email: "devon@example.com", status: "new", notes: "", created_at: "2026-01-01T00:00:00Z" },
    ];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    const drafted = await ASSISTANT_TOOL_EXECUTORS.move_candidates("emp_1", { job_id: 1, candidate_ids: [101, 102], to_stage: "reviewed" }, ctx);
    const artifactText = drafted.data.card.items.map((i) => i.artifact).join(" | ");
    check("move_candidates: the card shows the REAL candidate names and real from→to stages", artifactText.includes("Maria Alvarez") && artifactText.includes("Devon Wu") && artifactText.includes("new") && artifactText.includes("reviewed"), artifactText);
    check("move_candidates: nothing moved yet — drafting only created the pending row", state.tables.applicants.every((a) => a.status === "new"));

    const outcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", drafted.data.pendingActionId);
    check("move_candidates: approve moves both candidates", outcome.status === "executed" && state.tables.applicants.every((a) => a.status === "reviewed"), [outcome, state.tables.applicants]);

    // Draft a second move, then simulate another session changing Maria's stage before anyone approves this one.
    const drafted2 = await ASSISTANT_TOOL_EXECUTORS.move_candidates("emp_1", { job_id: 1, candidate_ids: [101, 102], to_stage: "shortlisted" }, ctx);
    state.tables.applicants.find((a) => a.id === 101).status = "interviewed"; // changed out from under the draft
    const outcome2 = await approvePendingAction("emp_1", "user_1", "owner@example.com", drafted2.data.pendingActionId);
    check("move_candidates precondition: a stale candidate stage fails the WHOLE batch with a human-readable reason", outcome2.status === "failed" && /Maria Alvarez/.test(outcome2.failureReason || ""), outcome2);
    check("move_candidates precondition: nothing in the batch was moved — not even the still-valid candidate (all-or-nothing)", state.tables.applicants.find((a) => a.id === 102).status === "reviewed");

    const auditRows = await load("lib/assistant-audit.ts").listActions("emp_1");
    check("move_candidates precondition: the failure is audited with status 'failed'", auditRows.some((r) => r.action === "move_candidates" && r.status === "failed"), auditRows);
  }

  // ═══ 16. schedule_interviews: a colliding existing interview is flagged in the artifact BEFORE approval ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist", status: "active" }];
    state.tables.applicants = [
      { id: 101, job_id: 1, name: "Maria Alvarez", email: "maria@example.com", status: "new", notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 102, job_id: 1, name: "Devon Wu", email: "devon@example.com", status: "new", notes: "", created_at: "2026-01-01T00:00:00Z" },
    ];
    const slot = "2026-11-05T15:00:00.000Z"; // "Thursday 10am" in some US timezone — exact instant is what matters here
    state.tables.interviews = [
      { id: 1, employer_id: "emp_1", applicant_id: 102, job_id: 1, title: "Existing panel interview", scheduled_at: slot, duration_min: 30, mode: "video", status: "scheduled", location: "", interviewer: "", notes: "", room_url: "", room_name: "", recording_url: "", recording_id: "", transcript_url: "", ai_summary: null, record_enabled: false, created_at: "2026-01-01T00:00:00Z" },
    ];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const drafted = await ASSISTANT_TOOL_EXECUTORS.schedule_interviews("emp_1", { job_id: 1, candidate_ids: [101], scheduled_at: slot, duration_min: 30, mode: "video" }, { actorUserId: "user_1", actorEmail: null });
    const artifactText = drafted.data.card.items[0].artifact;
    check("schedule_interviews: a colliding slot is flagged with a clash warning naming the other interview", /⚠/.test(artifactText) && /Existing panel interview/.test(artifactText), artifactText);

    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const outcome = await approvePendingAction("emp_1", "user_1", null, drafted.data.pendingActionId);
    check("schedule_interviews: approving despite the clash still schedules it (the clash is a warning, not a hard block) via the real createInterview path", outcome.status === "executed" && state.tables.interviews.length === 2, [outcome, state.tables.interviews.length]);
  }

  // ═══ 17. message_candidates: filter resolves to named candidates; irreversible; undo window; cancel within window prevents send; after send, cancel → 409 "can't be unsent" ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist", status: "active" }];
    state.tables.applicants = [
      { id: 101, job_id: 1, name: "Maria Alvarez", email: "maria@example.com", status: "rejected", notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 102, job_id: 1, name: "Devon Wu", email: "devon@example.com", status: "interviewed", notes: "", created_at: "2026-01-01T00:00:00Z" },
    ];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const { listDueQueued } = load("lib/assistant-send-queue.ts");
    const { runAssistantSendQueueScan } = load("lib/assistant-send-worker.ts");

    const drafted = await ASSISTANT_TOOL_EXECUTORS.message_candidates(
      "emp_1",
      { filter: { job_id: 1, status: "rejected" }, message: "Hi {{firstName}}, thanks for your patience — we've decided to move forward with another candidate." },
      { actorUserId: "user_1", actorEmail: null }
    );
    check("message_candidates (filter): resolves the filter to the real named candidate on the card, not a description", drafted.data.card.items.length === 1 && drafted.data.card.items[0].label === "Maria Alvarez" && drafted.data.card.items[0].artifact.includes("Hi Maria,"), drafted.data.card);
    check("message_candidates: the card is irreversible", drafted.data.card.irreversible === true);

    const outcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", drafted.data.pendingActionId);
    check("message_candidates: approving ENQUEUES, it does not send inline", outcome.status === "executed" && (state.tables.messages || []).length === 0, [outcome, state.tables.messages]);
    const queued = (state.tables.assistant_send_queue || []).find((r) => r.status === "queued");
    check("message_candidates: a send_queue row was created for the resolved candidate", !!queued && queued.candidate_id === 101, queued);

    const notYetDue = await listDueQueued(Date.now());
    check("undo window: the row is not due immediately after approval (send_at is in the future)", notYetDue.length === 0, notYetDue);
    const scanTooEarly = await runAssistantSendQueueScan(Date.now());
    check("undo window: a send-queue scan before send_at sends nothing", scanTooEarly.scanned === 0 && (state.tables.messages || []).length === 0);

    // Cancel within the window — nothing should ever send for this row.
    const { cancelQueued, getSendQueueById } = load("lib/assistant-send-queue.ts");
    const cancelOk = await cancelQueued("emp_1", queued.id);
    check("undo window: cancelling a still-queued row within the window succeeds", cancelOk === true);
    await runAssistantSendQueueScan(Date.now() + 120_000); // even if "time" moves past send_at now, a cancelled row must never send
    check("undo window: a cancelled row is never sent, even once its send_at has passed", (state.tables.messages || []).length === 0, state.tables.messages);
    const afterCancel = await getSendQueueById(queued.id);
    check("undo window: the cancelled row's status is 'cancelled'", afterCancel.status === "cancelled", afterCancel);

    // A second message, allowed to actually go through this time.
    const drafted2 = await ASSISTANT_TOOL_EXECUTORS.message_candidates("emp_1", { candidate_ids: [102], message: "Hi {{firstName}}, congratulations on advancing to the next round!" }, { actorUserId: "user_1", actorEmail: null });
    const outcome2 = await approvePendingAction("emp_1", "user_1", "owner@example.com", drafted2.data.pendingActionId);
    const queued2 = (state.tables.assistant_send_queue || []).find((r) => r.pending_action_id === drafted2.data.pendingActionId);
    check("undo window: the second message's send_at respects ASSISTANT_UNDO_WINDOW_SECONDS", outcome2.status === "executed" && !!queued2, queued2);

    const scanAfterWindow = await runAssistantSendQueueScan(Date.now() + 120_000);
    check("undo window: once send_at has passed, the scan actually sends it (preserving the exact body text)", scanAfterWindow.sent === 1, scanAfterWindow);
    check("undo window: the real sendMessage lib wrote the real message row, personalized for Devon", (state.tables.messages || []).some((m) => m.applicant_id === 102 && m.content.includes("Hi Devon,")), state.tables.messages);

    // Now try to undo AFTER it sent.
    const cancelAfterSendRes = await route("employer/assistant/send-queue/[id]/cancel").POST(new Request(`${URLBASE}/x`, { method: "POST" }), { params: { id: queued2.id } });
    check("undo window: cancelling an already-sent row answers 409", cancelAfterSendRes.status === 409, cancelAfterSendRes.status);
    const cancelAfterSendBody = await cancelAfterSendRes.clone().json();
    check("undo window: the 409 surfaces \"can't be unsent\"", /can't be unsent/i.test(cancelAfterSendBody.message || ""), cancelAfterSendBody);
  }

  // ═══ 18. plan gating at the approve route itself: a Portal-tier employer is refused even with a (hypothetically) existing pending-action id ═══
  {
    resetWorld();
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const drafted = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: "Drafted while on Scale, approved after a hypothetical downgrade." }, { actorUserId: "user_1", actorEmail: null });

    state.userId = "emp_1";
    state.tier = "portal"; // downgraded (or never was Scale) by the time approval is attempted
    const res = await route("employer/assistant/actions/[id]/approve").POST(new Request(`${URLBASE}/x`, { method: "POST" }), { params: { id: drafted.data.pendingActionId } });
    check("plan gating (approve route): a sub-Scale employer is refused with an upgrade note, not a crash", res.status === 403, res.status);
    const body = await res.clone().json();
    check("plan gating (approve route): the refusal names the Scale plan", body.error === "scale_required", body);
    check("plan gating (approve route): nothing executed", (state.tables.job_postings || []).length === 0);
  }

  // ═══ 19. migrations declare the mandatory explicit Supabase grants (the app's own static source of truth for "no permission denied after 2026-10-30") ═══
  {
    const m52 = fs.readFileSync(path.join(ROOT, "supabase/migrations/0052_assistant_pending_actions.sql"), "utf8");
    const m53 = fs.readFileSync(path.join(ROOT, "supabase/migrations/0053_assistant_send_queue.sql"), "utf8");
    check("grants: assistant_pending_actions grants select/insert/update to service_role explicitly", /grant select, insert, update on public\.assistant_pending_actions to service_role/i.test(m52), m52);
    check("grants: assistant_pending_actions revokes public/anon/authenticated", /revoke all on public\.assistant_pending_actions from public, anon, authenticated/i.test(m52));
    check("grants: assistant_send_queue grants select/insert/update to service_role explicitly", /grant select, insert, update on public\.assistant_send_queue to service_role/i.test(m53), m53);
    check("grants: assistant_send_queue revokes public/anon/authenticated", /revoke all on public\.assistant_send_queue from public, anon, authenticated/i.test(m53));
    check("grants: both tables enable row level security", /enable row level security/i.test(m52) && /enable row level security/i.test(m53));
  }

  // ═══ 20. assistant-staleness.ts: pure math, boundary at exactly N days (Prompt 3) ═══
  {
    const { isStale, staleSummary, isJobIdle, assistantStaleDays } = load("lib/assistant-staleness.ts");
    const now = Date.now();
    const daysAgo = (d) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();

    check("staleness: exactly N days already counts as stale (boundary is >=)", isStale({ status: "new", statusChangedAt: daysAgo(7) }, 7, now) === true);
    check("staleness: N-1 days does not count as stale yet", isStale({ status: "new", statusChangedAt: daysAgo(6) }, 7, now) === false);
    check("staleness: N+1 days counts as stale", isStale({ status: "new", statusChangedAt: daysAgo(8) }, 7, now) === true);
    check("staleness: 'hired' is never stale, however old", isStale({ status: "hired", statusChangedAt: daysAgo(400) }, 7, now) === false);
    check("staleness: 'rejected' is never stale, however old", isStale({ status: "rejected", statusChangedAt: daysAgo(400) }, 7, now) === false);
    check("staleness: default is 7 days when ASSISTANT_STALE_DAYS is unset", assistantStaleDays() === 7);

    const summary = staleSummary(
      [
        { id: 1, name: "A", jobId: 10, jobTitle: "Role", status: "new", statusChangedAt: daysAgo(10) },
        { id: 2, name: "B", jobId: 10, jobTitle: "Role", status: "new", statusChangedAt: daysAgo(3) },
        { id: 3, name: "C", jobId: 10, jobTitle: "Role", status: "new", statusChangedAt: daysAgo(20) },
      ],
      7,
      now
    );
    check("staleSummary: counts exactly the stale candidates", summary.totalStale === 2, summary.totalStale);
    check(
      "staleSummary: longest-idle first within a job",
      summary.byJob.get(10).items[0].name === "C" && summary.byJob.get(10).items[1].name === "A",
      summary.byJob.get(10)
    );
    check("isJobIdle: boundary at exactly idleDays", isJobIdle(daysAgo(14), 14, now) === true && isJobIdle(daysAgo(13), 14, now) === false);
  }

  // ═══ 21. get_pipeline_health: the read-only staleness tool (Prompt 3) ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "portal"; // read-only tool — must work at Portal, not just Scale
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist", status: "active" }];
    const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
    state.tables.applicants = [
      { id: 101, job_id: 1, name: "Maria", email: "maria@example.com", status: "new", notes: "", created_at: daysAgo(30), status_changed_at: daysAgo(10) },
      { id: 102, job_id: 1, name: "Devon", email: "devon@example.com", status: "new", notes: "", created_at: daysAgo(30), status_changed_at: daysAgo(2) },
    ];
    const { ASSISTANT_TOOL_EXECUTORS, READ_ONLY_TOOL_NAMES } = load("lib/assistant-tools.ts");
    check("get_pipeline_health: is read-only (Portal tier gets it)", READ_ONLY_TOOL_NAMES.includes("get_pipeline_health"));
    const result = await ASSISTANT_TOOL_EXECUTORS.get_pipeline_health("emp_1", {});
    check(
      "get_pipeline_health: finds exactly the one stale candidate, with the real name",
      result.data.totalStale === 1 && result.data.jobs[0].longestIdle[0].name === "Maria",
      result.data
    );
  }

  // ═══ 22. assistant-reschedule.ts: deterministic token derive/hash/parse/validate (Prompt 3) ═══
  {
    const prevDomain = process.env.INBOUND_EMAIL_DOMAIN;
    const prevSecret = process.env.INBOUND_WEBHOOK_SECRET;

    delete process.env.INBOUND_EMAIL_DOMAIN;
    delete require.cache[require.resolve(path.join(ROOT, "lib/assistant-reschedule.ts"))];
    const offMod = load("lib/assistant-reschedule.ts");
    check("reschedule tokens: unconfigured (no INBOUND_EMAIL_DOMAIN) -> null Reply-To", (await offMod.rescheduleReplyTo(1)) === null);

    process.env.INBOUND_EMAIL_DOMAIN = "reply.resumetailored.com";
    process.env.INBOUND_WEBHOOK_SECRET = "test-inbound-secret-0123456789";
    delete require.cache[require.resolve(path.join(ROOT, "lib/assistant-reschedule.ts"))];
    const mod = load("lib/assistant-reschedule.ts");

    const addr1 = await mod.rescheduleReplyTo(42);
    const addr2 = await mod.rescheduleReplyTo(42);
    check("reschedule tokens: deterministic — the SAME interview gets the SAME Reply-To every time", !!addr1 && addr1 === addr2, [addr1, addr2]);
    const parsed = mod.parseReplyAddress(addr1);
    check("reschedule tokens: parses its own generated address back out", parsed && parsed.interviewId === 42, parsed);
    const hash = await mod.tokenHashForInterview(42);
    check("reschedule tokens: a valid token+hash+recent schedule validates", (await mod.isValidReplyToken(parsed, hash, new Date().toISOString())) === true);
    check("reschedule tokens: a tampered token is rejected", (await mod.isValidReplyToken({ interviewId: 42, token: "0000000000000000" }, hash, new Date().toISOString())) === false);
    check(
      "reschedule tokens: a reply far past the interview's own schedule is treated as expired",
      (await mod.isValidReplyToken(parsed, hash, new Date(Date.now() - 40 * 86400000).toISOString())) === false
    );
    check("reschedule tokens: a 'Name <addr>' form still parses", JSON.stringify(mod.parseReplyAddress(`Candidate <${addr1}>`)) === JSON.stringify(parsed));
    check("reschedule tokens: garbage is not an address", mod.parseReplyAddress("not-an-address@example.com") === null);

    if (prevDomain === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = prevDomain;
    if (prevSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevSecret;
    delete require.cache[require.resolve(path.join(ROOT, "lib/assistant-reschedule.ts"))];
  }

  // ═══ 23. reminder emails: tokenized Reply-To when configured; plain fallback otherwise; optout suppresses ═══
  {
    resetWorld();
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist" }];
    state.tables.applicants = [{ id: 101, job_id: 1, name: "Maria", email: "maria@example.com" }];
    const prevResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "test-resend-key";
    const prevDomain = process.env.INBOUND_EMAIL_DOMAIN;
    const prevSecret = process.env.INBOUND_WEBHOOK_SECRET;
    process.env.INBOUND_EMAIL_DOMAIN = "reply.resumetailored.com";
    process.env.INBOUND_WEBHOOK_SECRET = "test-inbound-secret-0123456789";

    const emailsSent = [];
    const prevFetch = global.fetch;
    global.fetch = async (url, opts) => {
      emailsSent.push({ url, body: JSON.parse(opts.body) });
      return { ok: true };
    };

    const scan = { rows: [] };
    const stubCollab = {
      listInterviewsForReminderScan: async () => scan.rows,
      markInterviewReminded: async () => {},
      setInterviewRescheduleTokenHash: async () => {},
    };
    const stubMocks = { "./employer-collab-store": () => stubCollab };
    const prevLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (stubMocks[request]) return stubMocks[request]();
      return prevLoad.apply(this, arguments);
    };
    delete require.cache[require.resolve(path.join(ROOT, "lib/interview-reminders.ts"))];
    const { runInterviewReminderScan } = load("lib/interview-reminders.ts");
    const { parseReplyAddress, tokenHashForInterview } = load("lib/assistant-reschedule.ts");

    const now = Date.now();
    // 20h out: due for the 24h window only, not yet the 2h one — exactly one
    // email per scan call, so this block's Reply-To assertions aren't
    // muddied by a second (but identically-tokenized) send.
    const at = (hrs) => new Date(now + hrs * 60 * 60 * 1000).toISOString();
    scan.rows = [
      {
        id: 7, employerId: "emp_1", applicantId: 101, jobId: 1, jobTitle: "Dental Hygienist", title: "Phone screen",
        scheduledAt: at(20), durationMin: 30, mode: "phone", location: "", interviewer: "", status: "scheduled",
        roomUrl: "", reminder24hSent: false, reminder2hSent: false, applicantName: "Maria", applicantEmail: "maria@example.com",
        candidateCommsOptout: false,
      },
    ];

    await runInterviewReminderScan(now);
    check(
      "reminder reply-to: a reminder carries a tokenized Reply-To when INBOUND_EMAIL_DOMAIN+SECRET are set",
      emailsSent.length === 1 && /^resc-7-[a-f0-9]+@reply\.resumetailored\.com$/.test(emailsSent[0].body.reply_to || ""),
      emailsSent[0] && emailsSent[0].body
    );
    const parsedAddr = parseReplyAddress(emailsSent[0].body.reply_to);
    check(
      "reminder reply-to: the embedded token hashes to exactly what the module would compute for this interview",
      parsedAddr && require("crypto").createHash("sha256").update(parsedAddr.token).digest("hex") === (await tokenHashForInterview(7))
    );

    // Opted out: suppressed entirely, no Reply-To even computed.
    emailsSent.length = 0;
    scan.rows[0].candidateCommsOptout = true;
    scan.rows[0].reminder24hSent = false;
    scan.rows[0].reminder2hSent = false;
    await runInterviewReminderScan(now);
    check("reminder reply-to: an opted-out interview gets no reminder at all", emailsSent.length === 0, emailsSent);

    // Feature off: falls back to the existing plain employer reply-to, unchanged.
    delete process.env.INBOUND_EMAIL_DOMAIN;
    emailsSent.length = 0;
    scan.rows[0].candidateCommsOptout = false;
    scan.rows[0].reminder24hSent = false;
    scan.rows[0].reminder2hSent = false;
    await runInterviewReminderScan(now);
    check(
      "reminder reply-to: feature off (no INBOUND_EMAIL_DOMAIN) keeps the existing plain employer reply-to",
      emailsSent.length === 1 && emailsSent[0].body.reply_to === "owner@example.com",
      emailsSent[0] && emailsSent[0].body
    );

    Module._load = prevLoad;
    delete require.cache[require.resolve(path.join(ROOT, "lib/interview-reminders.ts"))];
    global.fetch = prevFetch;
    if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResendKey;
    if (prevDomain === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = prevDomain;
    if (prevSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevSecret;
  }

  // ═══ 24. inbound webhook route: auth + payload shape ═══
  {
    resetWorld();
    const prevSecret = process.env.INBOUND_WEBHOOK_SECRET;

    delete process.env.INBOUND_WEBHOOK_SECRET;
    const offRes = await route("webhooks/inbound-email").POST(
      new Request(`${URLBASE}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    );
    check("inbound webhook: unconfigured (no INBOUND_WEBHOOK_SECRET) -> 404, no information disclosed", offRes.status === 404, offRes.status);

    process.env.INBOUND_WEBHOOK_SECRET = "test-inbound-secret-0123456789";
    const badSecretRes = await route("webhooks/inbound-email").POST(
      new Request(`${URLBASE}/x`, { method: "POST", headers: { "content-type": "application/json", "x-inbound-webhook-secret": "wrong" }, body: "{}" })
    );
    check("inbound webhook: wrong secret -> 401", badSecretRes.status === 401, badSecretRes.status);

    const badPayloadRes = await route("webhooks/inbound-email").POST(
      new Request(`${URLBASE}/x`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-inbound-webhook-secret": "test-inbound-secret-0123456789" },
        body: "{}",
      })
    );
    check("inbound webhook: correctly-authed but unrecognizable body -> 400", badPayloadRes.status === 400, badPayloadRes.status);

    const unknownTokenRes = await route("webhooks/inbound-email").POST(
      new Request(`${URLBASE}/x`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-inbound-webhook-secret": "test-inbound-secret-0123456789" },
        body: JSON.stringify({ from: "candidate@example.com", to: "resc-999-deadbeefdeadbeef@reply.resumetailored.com", text: "sure, Friday works", subject: "Re: interview" }),
      })
    );
    check("inbound webhook: unknown token (no such interview) -> 404, no information disclosed", unknownTokenRes.status === 404, unknownTokenRes.status);

    if (prevSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevSecret;
  }

  // ═══ 24b. Resend inbound adapter (Prompt 4): Svix signature verification, stale-timestamp
  // rejection, unknown-envelope 400, retry dedupe (no second Resend fetch), body-fetch mapping,
  // quoted-reply stripping, and unknown-token-after-mapping. ═══
  {
    resetWorld();
    const nodeCrypto = require("crypto");
    const prevSigningSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET;
    const prevResendKey = process.env.RESEND_API_KEY;
    const prevDomain = process.env.INBOUND_EMAIL_DOMAIN;
    const prevWebhookSecret = process.env.INBOUND_WEBHOOK_SECRET;
    process.env.RESEND_API_KEY = "test-resend-key";
    process.env.INBOUND_EMAIL_DOMAIN = "reply.resumetailored.com";
    process.env.INBOUND_WEBHOOK_SECRET = "test-inbound-secret-0123456789";

    const secretRaw = Buffer.from("a-pretend-resend-signing-key-for-tests");
    const signingSecretEnv = "whsec_" + secretRaw.toString("base64");
    function svixSign(id, timestamp, rawBody) {
      const key = secretRaw; // decodeSvixSecret strips "whsec_" then base64-decodes — same bytes
      const signedContent = `${id}.${timestamp}.${rawBody}`;
      const sig = nodeCrypto.createHmac("sha256", key).update(signedContent, "utf8").digest("base64");
      return `v1,${sig}`;
    }
    function svixReq(body, { id = "msg_test_1", timestamp = String(Math.floor(Date.now() / 1000)), tamperSig = false, omitHeaders = false } = {}) {
      const rawBody = JSON.stringify(body);
      const headers = { "content-type": "application/json" };
      if (!omitHeaders) {
        headers["svix-id"] = id;
        headers["svix-timestamp"] = timestamp;
        headers["svix-signature"] = tamperSig ? "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" : svixSign(id, timestamp, rawBody);
      }
      return new Request(`${URLBASE}/x`, { method: "POST", headers, body: rawBody });
    }
    const envelope = (emailId) => ({ type: "email.received", data: { email_id: emailId, from: "candidate@example.com", to: "x@reply.resumetailored.com", subject: "Re: interview" } });

    // (a) Svix headers present but RESEND_WEBHOOK_SIGNING_SECRET unset -> 401, never falls through to the legacy path.
    delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
    const unconfiguredRes = await route("webhooks/inbound-email").POST(svixReq(envelope("email_1")));
    check("resend adapter: Svix headers present but signing secret unset -> 401", unconfiguredRes.status === 401, unconfiguredRes.status);

    process.env.RESEND_WEBHOOK_SIGNING_SECRET = signingSecretEnv;

    // (b) Tampered signature -> 401.
    const tamperedRes = await route("webhooks/inbound-email").POST(svixReq(envelope("email_2"), { tamperSig: true }));
    check("resend adapter: invalid signature -> 401", tamperedRes.status === 401, tamperedRes.status);

    // (c) Stale timestamp (10 minutes old) with an otherwise-correct signature -> 401.
    const staleTs = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const staleRes = await route("webhooks/inbound-email").POST(svixReq(envelope("email_3"), { timestamp: staleTs }));
    check("resend adapter: stale timestamp (>5min skew) -> 401", staleRes.status === 401, staleRes.status);

    // (d) Valid signature, fresh timestamp, body doesn't match the expected envelope shape -> 400.
    const unknownEnvelopeRes = await route("webhooks/inbound-email").POST(svixReq({ type: "email.sent", data: {} }));
    check("resend adapter: valid signature but unknown envelope shape -> 400", unknownEnvelopeRes.status === 400, unknownEnvelopeRes.status);

    // Mock Resend's "retrieve received email" fetch for the remaining, body-fetch-dependent cases.
    const fetchCalls = [];
    const prevFetch = global.fetch;
    const fetchResponses = new Map(); // email_id -> response body (or null to simulate a fetch failure)
    global.fetch = async (url) => {
      fetchCalls.push(url);
      const id = decodeURIComponent(String(url).split("/").pop());
      const resp = fetchResponses.get(id);
      if (resp === undefined) return { ok: false };
      return { ok: true, json: async () => resp };
    };

    // Seed a real interview so the mapped reply-to resolves.
    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist", status: "active" }];
    state.tables.applicants = [{ id: 101, job_id: 1, name: "Maria Alvarez", email: "maria@example.com", status: "new", notes: "", created_at: "2026-01-01T00:00:00Z" }];
    const { tokenHashForInterview, rescheduleReplyTo } = load("lib/assistant-reschedule.ts");
    const scheduledAt = "2026-11-05T15:00:00.000Z";
    const replyTo = await rescheduleReplyTo(777);
    state.tables.interviews = [
      {
        id: 777, employer_id: "emp_1", applicant_id: 101, job_id: 1, title: "Phone screen", scheduled_at: scheduledAt, duration_min: 30, mode: "phone",
        status: "scheduled", location: "", interviewer: "", notes: "", room_url: "", room_name: "", recording_url: "", recording_id: "", transcript_url: "",
        ai_summary: null, record_enabled: false, created_at: "2026-01-01T00:00:00Z",
        reschedule_token_hash: await tokenHashForInterview(777), candidate_comms_optout: false,
      },
    ];
    state.claudeScript = [{ content: [{ type: "text", text: JSON.stringify({ intent: "reschedule", proposed_times: ["2026-11-07T19:00:00.000Z"] }) }] }];

    // (e) Body-fetch mapping + quoted-reply stripping, end to end.
    const quotedBody = "Can we do Friday at 2pm instead?\n\nOn Mon, Nov 3, 2026 at 9:00 AM, Employer <owner@example.com> wrote:\n> Please confirm your interview time.";
    fetchResponses.set("email_happy", { from: "maria@example.com", to: replyTo, subject: "Re: interview", text: quotedBody });
    const happyRes = await route("webhooks/inbound-email").POST(svixReq(envelope("email_happy")));
    const happyJson = await happyRes.json();
    check("resend adapter: valid delivery -> 200 reschedule_pending", happyRes.status === 200 && happyJson.outcome === "reschedule_pending", [happyRes.status, happyJson]);
    check("resend adapter: exactly one fetch to Resend's receiving API for this email_id", fetchCalls.filter((u) => u.includes("email_happy")).length === 1, fetchCalls);

    const { listPendingActions } = load("lib/assistant-pending.ts");
    const pendingNow = await listPendingActions("emp_1");
    const created = pendingNow.find((p) => p.action === "reschedule_interview");
    check(
      "resend adapter: quoted-reply tail stripped before it reaches the card (no 'wrote:' quote text on it)",
      !!created && created.artifact.items[0].artifact.includes("Can we do Friday at 2pm instead?") && !created.artifact.items[0].artifact.includes("Please confirm your interview time"),
      created && created.artifact.items[0].artifact
    );

    // (f) Retry: the SAME email_id delivered again must be recognized as a duplicate
    // WITHOUT a second fetch to Resend's API (pre-claimed before the body is ever fetched).
    const fetchCountBefore = fetchCalls.length;
    const retryRes = await route("webhooks/inbound-email").POST(svixReq(envelope("email_happy")));
    const retryJson = await retryRes.json();
    check("resend adapter: a retried delivery (same email_id) -> outcome duplicate", retryJson.outcome === "duplicate", retryJson);
    check("resend adapter: the retry did NOT fetch the body again", fetchCalls.length === fetchCountBefore, [fetchCountBefore, fetchCalls.length]);
    const pendingAfterRetry = await listPendingActions("emp_1");
    check("resend adapter: the retry did not create a second pending action", pendingAfterRetry.length === pendingNow.length, [pendingNow.length, pendingAfterRetry.length]);

    // (g) Unknown token after mapping: valid signature + envelope + fetch, but the mapped
    // reply-to address matches no real interview -> 404, no information disclosed.
    fetchResponses.set("email_unknown", { from: "someone@example.com", to: "resc-999999-deadbeefdeadbeef@reply.resumetailored.com", subject: "Re:", text: "sure" });
    const unknownRes = await route("webhooks/inbound-email").POST(svixReq(envelope("email_unknown")));
    check("resend adapter: unknown token after mapping -> 404, no information disclosed", unknownRes.status === 404, unknownRes.status);

    global.fetch = prevFetch;
    if (prevSigningSecret === undefined) delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
    else process.env.RESEND_WEBHOOK_SIGNING_SECRET = prevSigningSecret;
    if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResendKey;
    if (prevDomain === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = prevDomain;
    if (prevWebhookSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevWebhookSecret;
  }

  // ═══ 25. inbound reschedule: exactly one pending action; duplicate delivery -> still one; cancelled-in-between approval fails with reason ═══
  {
    resetWorld();
    const prevDomain = process.env.INBOUND_EMAIL_DOMAIN;
    const prevSecret = process.env.INBOUND_WEBHOOK_SECRET;
    process.env.INBOUND_EMAIL_DOMAIN = "reply.resumetailored.com";
    process.env.INBOUND_WEBHOOK_SECRET = "test-inbound-secret-0123456789";

    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist", status: "active" }];
    state.tables.applicants = [{ id: 101, job_id: 1, name: "Maria Alvarez", email: "maria@example.com", status: "new", notes: "", created_at: "2026-01-01T00:00:00Z" }];
    const scheduledAt = "2026-11-05T15:00:00.000Z";
    const { tokenHashForInterview, rescheduleReplyTo } = load("lib/assistant-reschedule.ts");
    const replyTo = await rescheduleReplyTo(501);
    state.tables.interviews = [
      {
        id: 501, employer_id: "emp_1", applicant_id: 101, job_id: 1, title: "Phone screen", scheduled_at: scheduledAt, duration_min: 30, mode: "phone",
        status: "scheduled", location: "", interviewer: "", notes: "", room_url: "", room_name: "", recording_url: "", recording_id: "", transcript_url: "",
        ai_summary: null, record_enabled: false, created_at: "2026-01-01T00:00:00Z",
        reschedule_token_hash: await tokenHashForInterview(501), candidate_comms_optout: false,
      },
    ];

    const { processInboundReschedule } = load("lib/assistant-inbound.ts");
    state.claudeScript = [{ content: [{ type: "text", text: JSON.stringify({ intent: "reschedule", proposed_times: ["2026-11-07T19:00:00.000Z"] }) }] }];
    const payload = { from: "maria@example.com", subject: "Re: interview", text: "Can we do Friday at 2pm instead?", originalTo: replyTo, providerMessageId: "msg-reschedule-1" };
    const result1 = await processInboundReschedule(payload);
    check("inbound reschedule: a parseable reply creates exactly one pending action", result1.outcome === "reschedule_pending" && !!result1.pendingActionId, result1);

    const { getPendingActionById, listPendingActions } = load("lib/assistant-pending.ts");
    const row = await getPendingActionById(result1.pendingActionId);
    check("inbound reschedule: the card names the real candidate", row && row.artifact.title.includes("Maria Alvarez"), row && row.artifact);
    check(
      "inbound reschedule: the card shows the current time AND the proposed time",
      row.artifact.resolvedSpecifics.some((s) => s.label === "Current time") && row.artifact.resolvedSpecifics.some((s) => s.label === "Proposed"),
      row.artifact.resolvedSpecifics
    );
    check(
      "inbound reschedule: the card quotes the candidate's actual reply text",
      row.artifact.items[0].artifact.includes("Can we do Friday at 2pm instead?"),
      row.artifact.items[0].artifact
    );

    const result1b = await processInboundReschedule(payload); // same providerMessageId — a provider retry
    check("inbound reschedule: a duplicate provider delivery is recognized as a duplicate", result1b.outcome === "duplicate", result1b);
    const pendingAfterDup = await listPendingActions("emp_1");
    check("inbound reschedule: the duplicate delivery did NOT create a second pending action", pendingAfterDup.length === 1, pendingAfterDup.length);

    // The interview is cancelled before anyone approves the reschedule.
    state.tables.interviews.find((iv) => iv.id === 501).status = "cancelled";
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const outcome = await approvePendingAction("emp_1", "emp_1", null, result1.pendingActionId);
    check(
      "inbound reschedule: approving after the interview was cancelled fails with a human-readable reason, never revives it",
      outcome.status === "failed" && /no longer scheduled/i.test(outcome.failureReason || ""),
      outcome
    );

    if (prevDomain === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = prevDomain;
    if (prevSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevSecret;
  }

  // ═══ 25b. inbound claim hardening (Fix 0): a genuine unique-constraint violation on the
  // claim insert IS a duplicate; EVERY OTHER insert error must surface as a real failure
  // (outcome "error" / HTTP 500) and must NEVER be reported as "duplicate" — an error must
  // never be readable as a successful dedupe. ═══
  {
    resetWorld();
    const prevDomain = process.env.INBOUND_EMAIL_DOMAIN;
    const prevSecret = process.env.INBOUND_WEBHOOK_SECRET;
    process.env.INBOUND_EMAIL_DOMAIN = "reply.resumetailored.com";
    process.env.INBOUND_WEBHOOK_SECRET = "test-inbound-secret-0123456789";
    const { processInboundReschedule, claimResendDelivery } = load("lib/assistant-inbound.ts");

    // (a) A real unique-constraint violation on the insert -> genuine duplicate.
    state.forceInsertError = { table: "assistant_inbound_events", error: { code: "23505", message: 'duplicate key value violates unique constraint "assistant_inbound_events_provider_message_id_key"' } };
    const uniqueResult = await processInboundReschedule({ from: "x@example.com", subject: "", text: "hi", originalTo: "resc-1-deadbeefdeadbeef@reply.resumetailored.com", providerMessageId: "msg-unique-1" });
    check("inbound claim: a genuine unique-constraint violation -> outcome 'duplicate'", uniqueResult.outcome === "duplicate", uniqueResult);

    // (b) Some OTHER insert error (not a unique violation) -> must be reported as 'error', NEVER 'duplicate'.
    state.forceInsertError = { table: "assistant_inbound_events", error: { code: "53300", message: "sorry, too many clients already" } };
    const otherErrorResult = await processInboundReschedule({ from: "x@example.com", subject: "", text: "hi", originalTo: "resc-1-deadbeefdeadbeef@reply.resumetailored.com", providerMessageId: "msg-other-error-1" });
    check("inbound claim: a non-unique-violation insert error -> outcome 'error', NOT 'duplicate'", otherErrorResult.outcome === "error", otherErrorResult);

    // (c) The same distinction via the exported claimResendDelivery (used by the Resend adapter path).
    state.forceInsertError = { table: "assistant_inbound_events", error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    check("claimResendDelivery: unique violation -> 'duplicate'", (await claimResendDelivery("resend-unique-1")) === "duplicate");
    state.forceInsertError = { table: "assistant_inbound_events", error: { code: "42501", message: "permission denied for table assistant_inbound_events" } };
    check("claimResendDelivery: a permission-denied insert error -> 'error', NOT 'duplicate'", (await claimResendDelivery("resend-other-1")) === "error");

    // (d) End to end through the legacy webhook route: a non-unique claim error must answer 500, never 200 duplicate.
    state.forceInsertError = { table: "assistant_inbound_events", error: { code: "08006", message: "connection failure" } };
    const routeRes = await route("webhooks/inbound-email").POST(
      new Request(`${URLBASE}/x`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-inbound-webhook-secret": "test-inbound-secret-0123456789" },
        body: JSON.stringify({ from: "x@example.com", to: "resc-1-deadbeefdeadbeef@reply.resumetailored.com", text: "hi", subject: "", "message-id": "msg-500-test-1" }),
      })
    );
    check("inbound webhook (legacy path): a non-unique claim error -> HTTP 500, never 200 duplicate", routeRes.status === 500, routeRes.status);

    state.forceInsertError = null;
    if (prevDomain === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = prevDomain;
    if (prevSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevSecret;
  }

  // ═══ 25c. inbound reschedule timezone (Fix 2): the model's wall-clock reply time is
  // converted via the EMPLOYER's own timezone (default America/New_York), correctly across
  // a DST boundary — the fix for "a candidate's 'Friday 2pm' reply parsed 4-5 hours off" ═══
  {
    resetWorld();
    const prevDomain = process.env.INBOUND_EMAIL_DOMAIN;
    const prevSecret = process.env.INBOUND_WEBHOOK_SECRET;
    process.env.INBOUND_EMAIL_DOMAIN = "reply.resumetailored.com";
    process.env.INBOUND_WEBHOOK_SECRET = "test-inbound-secret-0123456789";

    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist", status: "active" }];
    state.tables.applicants = [{ id: 101, job_id: 1, name: "Maria Alvarez", email: "maria@example.com", status: "new", notes: "", created_at: "2026-01-01T00:00:00Z" }];
    const scheduledAt = "2026-11-05T15:00:00.000Z";
    const { tokenHashForInterview, rescheduleReplyTo } = load("lib/assistant-reschedule.ts");
    const replyTo = await rescheduleReplyTo(901);
    state.tables.interviews = [
      {
        id: 901, employer_id: "emp_1", applicant_id: 101, job_id: 1, title: "Phone screen", scheduled_at: scheduledAt, duration_min: 30, mode: "phone",
        status: "scheduled", location: "", interviewer: "", notes: "", room_url: "", room_name: "", recording_url: "", recording_id: "", transcript_url: "",
        ai_summary: null, record_enabled: false, created_at: "2026-01-01T00:00:00Z",
        reschedule_token_hash: await tokenHashForInterview(901), candidate_comms_optout: false,
      },
    ];

    const { processInboundReschedule } = load("lib/assistant-inbound.ts");
    // The model returns a NAIVE wall-clock local time (no "Z", no offset) per the new
    // prompt contract — Nov 6, 2026 is AFTER the Nov 1 2026 DST fall-back, so this is an
    // EST (UTC-5) instant: 14:00 local -> 19:00 UTC. Under the OLD prompt (which asked the
    // model to produce an absolute offset itself, assuming the interview's own offset) this
    // exact case was the reported defect class ("EDT parsed as UTC-5", off by an hour across
    // the transition the interview itself predates).
    state.claudeScript = [{ content: [{ type: "text", text: JSON.stringify({ intent: "reschedule", proposed_times: ["2026-11-06T14:00:00"] }) }] }];
    const payload = { from: "maria@example.com", subject: "Re: interview", text: "Can we do Friday at 2pm instead?", originalTo: replyTo, providerMessageId: "msg-tz-1" };
    const result = await processInboundReschedule(payload);
    check("inbound reschedule tz: a naive wall-clock reply time still creates a pending action", result.outcome === "reschedule_pending" && !!result.pendingActionId, result);

    const { getPendingActionById } = load("lib/assistant-pending.ts");
    const row = await getPendingActionById(result.pendingActionId);
    check(
      "inbound reschedule tz: the naive '2026-11-06T14:00:00' (employer default tz America/New_York, EST after the Nov 1 transition) resolves to 19:00 UTC, not 14:00 or some other offset",
      row && row.payload.newScheduledAt === "2026-11-06T19:00:00.000Z",
      row && row.payload
    );
    check(
      "inbound reschedule tz: the card displays the proposed time with an EST/EDT abbreviation, not a raw UTC string",
      row && /E[SD]T/.test(row.artifact.resolvedSpecifics.find((s) => s.label === "Proposed")?.value || ""),
      row && row.artifact.resolvedSpecifics
    );

    if (prevDomain === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = prevDomain;
    if (prevSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevSecret;
  }

  // ═══ 26. inbound: an unparseable reply notifies the employer with zero pending actions ═══
  {
    resetWorld();
    const prevDomain = process.env.INBOUND_EMAIL_DOMAIN;
    const prevSecret = process.env.INBOUND_WEBHOOK_SECRET;
    process.env.INBOUND_EMAIL_DOMAIN = "reply.resumetailored.com";
    process.env.INBOUND_WEBHOOK_SECRET = "test-inbound-secret-0123456789";

    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist", status: "active" }];
    state.tables.applicants = [{ id: 101, job_id: 1, name: "Maria", email: "maria@example.com", status: "new", notes: "", created_at: "2026-01-01T00:00:00Z" }];
    const { tokenHashForInterview, rescheduleReplyTo } = load("lib/assistant-reschedule.ts");
    const scheduledAt = new Date(Date.now() + 86400000).toISOString();
    const replyTo = await rescheduleReplyTo(601);
    state.tables.interviews = [
      {
        id: 601, employer_id: "emp_1", applicant_id: 101, job_id: 1, title: "Phone screen", scheduled_at: scheduledAt, status: "scheduled",
        duration_min: 30, mode: "phone", location: "", interviewer: "", notes: "", room_url: "", room_name: "", recording_url: "", recording_id: "",
        transcript_url: "", ai_summary: null, record_enabled: false, created_at: "2026-01-01T00:00:00Z",
        reschedule_token_hash: await tokenHashForInterview(601), candidate_comms_optout: false,
      },
    ];

    const { processInboundReschedule } = load("lib/assistant-inbound.ts");
    state.claudeScript = [{ content: [{ type: "text", text: JSON.stringify({ intent: "unknown", proposed_times: [] }) }] }];
    const result = await processInboundReschedule({
      from: "maria@example.com", subject: "Re: interview", text: "lorem ipsum gibberish reply", originalTo: replyTo, providerMessageId: "msg-unknown-1",
    });
    check("inbound unparseable: outcome is 'unknown', no pending action id", result.outcome === "unknown" && !result.pendingActionId, result);
    const { listPendingActions } = load("lib/assistant-pending.ts");
    check("inbound unparseable: zero pending actions were created", (await listPendingActions("emp_1")).length === 0);
    const notifications = state.tables.activity_events || [];
    check(
      "inbound unparseable: the employer got an in-app notification quoting the raw reply",
      notifications.some((n) => n.employer_id === "emp_1" && n.event_type === "candidate_reply_unparsed" && /lorem ipsum gibberish reply/.test(n.body || "")),
      notifications
    );

    if (prevDomain === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = prevDomain;
    if (prevSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevSecret;
  }

  // ═══ 27. inbound: "stop" sets the optout flag and suppresses the next reminder ═══
  {
    resetWorld();
    const prevDomain = process.env.INBOUND_EMAIL_DOMAIN;
    const prevSecret = process.env.INBOUND_WEBHOOK_SECRET;
    process.env.INBOUND_EMAIL_DOMAIN = "reply.resumetailored.com";
    process.env.INBOUND_WEBHOOK_SECRET = "test-inbound-secret-0123456789";

    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist", status: "active" }];
    state.tables.applicants = [{ id: 101, job_id: 1, name: "Maria", email: "maria@example.com", status: "new", notes: "", created_at: "2026-01-01T00:00:00Z" }];
    const { tokenHashForInterview, rescheduleReplyTo } = load("lib/assistant-reschedule.ts");
    const now = Date.now();
    const scheduledAt = new Date(now + 1.5 * 3600000).toISOString();
    const replyTo = await rescheduleReplyTo(701);
    state.tables.interviews = [
      {
        id: 701, employer_id: "emp_1", applicant_id: 101, job_id: 1, title: "Phone screen", scheduled_at: scheduledAt, status: "scheduled",
        duration_min: 30, mode: "phone", location: "", interviewer: "", notes: "", room_url: "", room_name: "", recording_url: "", recording_id: "",
        transcript_url: "", ai_summary: null, record_enabled: false, created_at: "2026-01-01T00:00:00Z", reminder_24h_sent: false, reminder_2h_sent: false,
        reschedule_token_hash: await tokenHashForInterview(701), candidate_comms_optout: false,
      },
    ];

    const { processInboundReschedule } = load("lib/assistant-inbound.ts");
    state.claudeScript = [{ content: [{ type: "text", text: JSON.stringify({ intent: "stop", proposed_times: [] }) }] }];
    const result = await processInboundReschedule({
      from: "maria@example.com", subject: "Re: interview", text: "please stop emailing me", originalTo: replyTo, providerMessageId: "msg-stop-1",
    });
    check("inbound stop: outcome is 'stop'", result.outcome === "stop", result);
    const iv = state.tables.interviews.find((i) => i.id === 701);
    check("inbound stop: candidate_comms_optout is now true on the interview row", iv.candidate_comms_optout === true, iv);

    const { dueReminderWindows } = load("lib/interview-reminders.ts");
    check(
      "inbound stop: the next reminder window check is suppressed for this interview",
      dueReminderWindows({ status: "scheduled", scheduledAt, reminder24hSent: false, reminder2hSent: false, candidateCommsOptout: true }, now).length === 0
    );

    if (prevDomain === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = prevDomain;
    if (prevSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevSecret;
  }

  // ═══ 28. daily brief: a due Scale-tier employer gets exactly one brief; a second same-day tick sends nothing ═══
  // (EMPLOYER_TIMEZONE pinned to UTC for sections 28-31: they test the SCAN's own orchestration,
  // not Fix 3's tz-aware boundary math — section 32 covers that directly and precisely — so
  // pinning to UTC keeps these `setUTCHours`-based fixtures meaning exactly what they say.)
  {
    resetWorld();
    const prevEmployerTz28 = process.env.EMPLOYER_TIMEZONE;
    process.env.EMPLOYER_TIMEZONE = "UTC";
    state.tier = "scale";
    const emp = "emp_1";
    state.tables.employer_profiles = [{ user_id: emp, company_name: "Acme Dental" }];
    state.tables.job_postings = [{ id: 1, employer_id: emp, title: "Dental Hygienist", status: "active", updated_at: new Date().toISOString() }];
    state.tables.applicants = [{ id: 101, job_id: 1, name: "Maria", email: "maria@example.com", status: "new", notes: "", created_at: new Date().toISOString(), status_changed_at: new Date().toISOString() }];
    const todayAt = (h) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
    state.tables.interviews = [
      {
        id: 1, employer_id: emp, applicant_id: 101, job_id: 1, title: "Phone screen", scheduled_at: todayAt(14), duration_min: 30, mode: "phone",
        status: "scheduled", location: "", interviewer: "", notes: "", room_url: "", room_name: "", recording_url: "", recording_id: "",
        transcript_url: "", ai_summary: null, record_enabled: false, created_at: new Date().toISOString(),
      },
    ];

    state.claudeScript = [{ content: [{ type: "text", text: "Good morning! You have 1 interview today with Maria for Dental Hygienist." }] }];
    const { runDailyBriefScan } = load("lib/assistant-brief.ts");
    const forcedNow = new Date();
    forcedNow.setUTCHours(8, 0, 0, 0);
    const result1 = await runDailyBriefScan(forcedNow.getTime());
    check("daily brief: a due Scale-tier employer gets exactly one brief", result1.sent === 1, result1);
    const notif = (state.tables.activity_events || []).filter((n) => n.event_type === "assistant_daily_brief");
    check("daily brief: exactly one in-app notification was logged", notif.length === 1, notif);

    // Fix Round 7, Section A: a SENT brief used to leave zero audit trace — only
    // the quiet-skip branch was ever specced to log. Now every brief decision
    // logs exactly one row, with counts-only payload (never the rendered prose).
    const { listActions } = load("lib/assistant-audit.ts");
    const sentAuditRows = await listActions(emp);
    check("daily brief (Fix Round 7): a sent brief logs exactly one audit row", sentAuditRows.filter((r) => r.action === "daily_brief").length === 1, sentAuditRows);
    const sentRow = sentAuditRows.find((r) => r.action === "daily_brief");
    check(
      "daily brief (Fix Round 7): the sent row is status='executed' with counts-only payload (interviews_today=1, no fallback/forced flags)",
      !!sentRow && sentRow.status === "executed" && sentRow.payload.interviews_today === 1 && sentRow.payload.pending_actions === 0 &&
        sentRow.payload.new_candidates === 1 && sentRow.payload.stale_items === 0 && sentRow.payload.idle_jobs === 0 &&
        typeof sentRow.payload.rendered_length === "number" && sentRow.payload.rendered_length > 0 &&
        sentRow.payload.fallback === undefined && sentRow.payload.forced === undefined,
      sentRow
    );

    const result2 = await runDailyBriefScan(forcedNow.getTime() + 3600000); // same day, one hour later
    check("daily brief: a second tick the same day sends nothing", result2.sent === 0 && result2.quietSkipped === 0, result2);
    const auditRowsAfterSecondTick = (await listActions(emp)).filter((r) => r.action === "daily_brief");
    check("daily brief (Fix Round 7): a second same-day tick overlap logs nothing new — exactly one row total", auditRowsAfterSecondTick.length === 1, auditRowsAfterSecondTick);

    if (prevEmployerTz28 === undefined) delete process.env.EMPLOYER_TIMEZONE;
    else process.env.EMPLOYER_TIMEZONE = prevEmployerTz28;
  }

  // ═══ 29. daily brief: a quiet day (nothing to report) sets last_brief_at AND logs a quiet
  // audit row, but sends zero ═══
  {
    resetWorld();
    const prevEmployerTz29 = process.env.EMPLOYER_TIMEZONE;
    process.env.EMPLOYER_TIMEZONE = "UTC";
    state.tier = "scale";
    const emp = "emp_1";
    state.tables.employer_profiles = [{ user_id: emp, company_name: "Acme Dental" }];
    const forcedNow = new Date();
    forcedNow.setUTCHours(9, 0, 0, 0);
    const { runDailyBriefScan } = load("lib/assistant-brief.ts");
    const result = await runDailyBriefScan(forcedNow.getTime());
    check("daily brief: a quiet day sends zero (ASSISTANT_BRIEF_QUIET_SKIP defaults to true)", result.sent === 0 && result.quietSkipped === 1, result);
    const { getBriefStates } = load("lib/assistant-brief-store.ts");
    const states2 = await getBriefStates([emp]);
    check("daily brief: last_brief_at was still set on a quiet day (prevents a retry storm)", !!(states2.get(emp) && states2.get(emp).lastBriefAt), states2.get(emp));
    const { listActions } = load("lib/assistant-audit.ts");
    const quietAuditRows = await listActions(emp);
    check(
      "daily brief (Fix 4): a quiet skip is logged as an audit row (action='daily_brief', status='executed', payload.quiet=true) — 'did it run?' is answerable from the audit trail",
      quietAuditRows.some((r) => r.action === "daily_brief" && r.status === "executed" && r.payload && r.payload.quiet === true),
      quietAuditRows
    );
    // Fix Round 3, Section D: the full readback, under migration 0051's REAL
    // column set (id, employer_id, actor_user_id, actor_email, action,
    // target_type, target_id, payload_json, status, created_at — there is NO
    // column named "payload"). `reason` lives inside payload_json alongside
    // `quiet`, written by the exact same logAction call in
    // lib/assistant-brief.ts — this closes the item-6 evidence gap by
    // checking it was actually written and actually reads back, not just
    // that SOME row with quiet=true exists.
    const quietRow = quietAuditRows.find((r) => r.action === "daily_brief" && r.status === "executed" && r.payload && r.payload.quiet === true);
    check("daily brief (Fix Round 3, D): the quiet audit row's reason reads back correctly", !!quietRow && quietRow.payload.reason === "nothing_to_report", quietRow);
    const rawQuietRow = (state.tables.assistant_audit_log || []).find((r) => r.employer_id === emp && r.action === "daily_brief");
    check(
      "daily brief (Fix Round 3, D): the row was actually written under payload_json (the real column) — never a nonexistent 'payload' column",
      !!rawQuietRow && rawQuietRow.payload_json && rawQuietRow.payload_json.quiet === true && rawQuietRow.payload === undefined,
      rawQuietRow
    );

    if (prevEmployerTz29 === undefined) delete process.env.EMPLOYER_TIMEZONE;
    else process.env.EMPLOYER_TIMEZONE = prevEmployerTz29;
  }

  // ═══ 30. daily brief: an LLM failure still sends a fallback brief, logged as executed/fallback
  // (Fix Round 7: this used to log status='failed' with an empty payload — the ruling is that a
  // sent fallback brief IS a successful brief send, not a failure, so it logs like any other sent
  // brief except for payload.fallback=true) ═══
  {
    resetWorld();
    const prevEmployerTz30 = process.env.EMPLOYER_TIMEZONE;
    process.env.EMPLOYER_TIMEZONE = "UTC";
    state.tier = "scale";
    const emp = "emp_1";
    state.tables.employer_profiles = [{ user_id: emp, company_name: "Acme Dental" }];
    state.tables.job_postings = [{ id: 1, employer_id: emp, title: "Dental Hygienist", status: "active", updated_at: new Date().toISOString() }];
    state.tables.applicants = [{ id: 101, job_id: 1, name: "Maria", email: "maria@example.com", status: "new", notes: "", created_at: new Date().toISOString(), status_changed_at: new Date().toISOString() }];
    const todayAt = (h) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
    state.tables.interviews = [
      {
        id: 1, employer_id: emp, applicant_id: 101, job_id: 1, title: "Phone screen", scheduled_at: todayAt(14), duration_min: 30, mode: "phone",
        status: "scheduled", location: "", interviewer: "", notes: "", room_url: "", room_name: "", recording_url: "", recording_id: "",
        transcript_url: "", ai_summary: null, record_enabled: false, created_at: new Date().toISOString(),
      },
    ];
    state.claudeFail = true;
    const forcedNow = new Date();
    forcedNow.setUTCHours(10, 0, 0, 0);
    const { runDailyBriefScan } = load("lib/assistant-brief.ts");
    const result = await runDailyBriefScan(forcedNow.getTime());
    check("daily brief: an LLM failure still sends exactly one fallback brief", result.sent === 1 && result.llmFailed === 1, result);
    const notif = (state.tables.activity_events || []).find((n) => n.event_type === "assistant_daily_brief");
    check("daily brief: the fallback brief mentions the real seeded facts (no model needed)", notif && /Maria|Dental Hygienist|interview/i.test(notif.body || ""), notif);
    const { listActions } = load("lib/assistant-audit.ts");
    const auditRows = await listActions(emp);
    check("daily brief (Fix Round 7): the LLM failure is logged via logAction with status='executed' and payload.fallback=true — never 'failed' (the brief itself still went out)", auditRows.some((r) => r.action === "daily_brief" && r.status === "executed" && r.payload.fallback === true), auditRows);
    check("daily brief (Fix Round 7): exactly one audit row for this brief event", auditRows.filter((r) => r.action === "daily_brief").length === 1, auditRows);
    state.claudeFail = null;
    if (prevEmployerTz30 === undefined) delete process.env.EMPLOYER_TIMEZONE;
    else process.env.EMPLOYER_TIMEZONE = prevEmployerTz30;
  }

  // ═══ 31. daily brief: a Portal-tier employer never gets a brief (and never consumes the per-tick budget) ═══
  {
    resetWorld();
    const prevEmployerTz31 = process.env.EMPLOYER_TIMEZONE;
    process.env.EMPLOYER_TIMEZONE = "UTC";
    state.tier = "portal";
    const emp = "emp_1";
    state.tables.employer_profiles = [{ user_id: emp, company_name: "Acme Dental" }];
    const forcedNow = new Date();
    forcedNow.setUTCHours(9, 0, 0, 0);
    const { runDailyBriefScan } = load("lib/assistant-brief.ts");
    const result = await runDailyBriefScan(forcedNow.getTime());
    check("daily brief: a Portal-tier employer is skipped entirely", result.scanned === 0 && result.sent === 0, result);
    if (prevEmployerTz31 === undefined) delete process.env.EMPLOYER_TIMEZONE;
    else process.env.EMPLOYER_TIMEZONE = prevEmployerTz31;
  }

  // ═══ 32. daily brief: briefDueNow boundary (pure) — tz explicitly "UTC" reproduces the
  // pre-Fix-3 boundary exactly (0 offset); separate America/New_York checks below prove the
  // boundary is actually computed in the EMPLOYER's own timezone, not always UTC ═══
  {
    const { briefDueNow } = load("lib/assistant-brief.ts");
    const now = Date.now();
    const atHour = (h) => { const d = new Date(now); d.setUTCHours(h, 0, 0, 0); return d.getTime(); };
    check("briefDueNow: before brief_hour today, never-briefed -> not yet due", briefDueNow({ lastBriefAt: null, briefHour: 7 }, atHour(6), "UTC") === false);
    check("briefDueNow: at/after brief_hour today, never-briefed -> due", briefDueNow({ lastBriefAt: null, briefHour: 7 }, atHour(7), "UTC") === true);
    const todayBoundaryIso = new Date(atHour(0)).toISOString();
    check("briefDueNow: already briefed at today's boundary -> not due again today", briefDueNow({ lastBriefAt: todayBoundaryIso, briefHour: 7 }, atHour(9), "UTC") === false);
    const yesterdayIso = new Date(atHour(0) - 24 * 60 * 60 * 1000).toISOString();
    check("briefDueNow: briefed yesterday, past brief_hour today -> due again", briefDueNow({ lastBriefAt: yesterdayIso, briefHour: 7 }, atHour(9), "UTC") === true);

    // Fix 3: the SAME instant is "due" or "not yet due" depending on the employer's own
    // timezone — 06:00 UTC is 02:00 AM in America/New_York (EDT, UTC-4) on Oct 24 2026, well
    // before a 7am-local brief_hour; it is also already past 7am in a UTC+9 zone.
    const oct24At6utc = Date.parse("2026-10-24T06:00:00.000Z");
    check(
      "briefDueNow (Fix 3): 06:00 UTC is 02:00 AM in America/New_York — NOT yet due for a 7am-local brief",
      briefDueNow({ lastBriefAt: null, briefHour: 7 }, oct24At6utc, "America/New_York") === false
    );
    check(
      "briefDueNow (Fix 3): the SAME instant (06:00 UTC) IS due in Asia/Tokyo (UTC+9, already 15:00 local)",
      briefDueNow({ lastBriefAt: null, briefHour: 7 }, oct24At6utc, "Asia/Tokyo") === true
    );
    // Already briefed at NY's own local midnight boundary (04:00 UTC under EDT) -> not due
    // again at 11am UTC the same NY calendar day (07:00 AM EDT, past brief_hour but same day).
    const nyMidnightUtcIso = new Date(Date.parse("2026-10-24T04:00:00.000Z")).toISOString();
    check(
      "briefDueNow (Fix 3): already briefed at NY's own local midnight -> not due again later the same NY day",
      briefDueNow({ lastBriefAt: nyMidnightUtcIso, briefHour: 7 }, Date.parse("2026-10-24T15:00:00.000Z"), "America/New_York") === false
    );
    // But the NEXT NY calendar day, past brief_hour local, is due again.
    check(
      "briefDueNow (Fix 3): the next NY calendar day, past brief_hour local, is due again",
      briefDueNow({ lastBriefAt: nyMidnightUtcIso, briefHour: 7 }, Date.parse("2026-10-25T15:00:00.000Z"), "America/New_York") === true
    );
  }

  // ═══ 32b. daily brief: ?force=1 (Fix 4) — bypasses due-check AND quiet-skip, never writes
  // last_brief_at; the admin route wires it through ═══
  {
    resetWorld();
    const prevEmployerTz32b = process.env.EMPLOYER_TIMEZONE;
    process.env.EMPLOYER_TIMEZONE = "UTC";
    state.tier = "scale";
    const emp = "emp_1";
    state.tables.employer_profiles = [{ user_id: emp, company_name: "Acme Dental" }];
    // Deliberately empty seed data — zero interviews, zero pending actions, zero of
    // everything `hasNothingToReport` checks — and `now` set BEFORE brief_hour, so a
    // non-forced run would answer "not due" outright.
    const { runDailyBriefScan } = load("lib/assistant-brief.ts");
    const { getBriefStates } = load("lib/assistant-brief-store.ts");
    const earlyNow = new Date();
    earlyNow.setUTCHours(2, 0, 0, 0);

    const notDueYet = await runDailyBriefScan(earlyNow.getTime());
    check("daily brief force (Fix 4): WITHOUT force, before brief_hour, nothing is due", notDueYet.scanned === 0 && notDueYet.sent === 0, notDueYet);

    const forced = await runDailyBriefScan(earlyNow.getTime(), { force: true });
    check(
      "daily brief force (Fix 4): WITH force, the employer is scanned and briefed even though not due and nothing to report (quiet-skip overridden)",
      forced.scanned === 1 && forced.sent === 1 && forced.quietSkipped === 0,
      forced
    );
    const statesAfterForce = await getBriefStates([emp]);
    check(
      "daily brief force (Fix 4): a forced run does NOT write last_brief_at — it must not consume the employer's real daily slot",
      !(statesAfterForce.get(emp) && statesAfterForce.get(emp).lastBriefAt),
      statesAfterForce.get(emp)
    );
    // Fix Round 7, checklist item 1: "Admin force the brief on the cleaned account ->
    // exactly one daily_brief audit row appears (forced:true)".
    const { listActions } = load("lib/assistant-audit.ts");
    const forcedAuditRows = (await listActions(emp)).filter((r) => r.action === "daily_brief");
    check("daily brief force (Fix Round 7): exactly one audit row for the forced brief", forcedAuditRows.length === 1, forcedAuditRows);
    check(
      "daily brief force (Fix Round 7): the forced row is status='executed' with payload.forced=true",
      forcedAuditRows[0] && forcedAuditRows[0].status === "executed" && forcedAuditRows[0].payload.forced === true,
      forcedAuditRows[0]
    );

    // Now prove a REAL due, non-quiet employer still briefs normally and DOES set
    // last_brief_at when force is NOT set (unaffected by Fix 4).
    resetWorld();
    process.env.EMPLOYER_TIMEZONE = "UTC";
    state.tier = "scale";
    state.tables.employer_profiles = [{ user_id: emp, company_name: "Acme Dental" }];
    state.tables.job_postings = [{ id: 1, employer_id: emp, title: "Dental Hygienist", status: "active", updated_at: new Date().toISOString() }];
    state.tables.applicants = [{ id: 101, job_id: 1, name: "Maria", email: "maria@example.com", status: "new", notes: "", created_at: new Date().toISOString(), status_changed_at: new Date().toISOString() }];
    const dueNow = new Date();
    dueNow.setUTCHours(9, 0, 0, 0);
    state.tables.interviews = [
      {
        id: 1, employer_id: emp, applicant_id: 101, job_id: 1, title: "Phone screen", scheduled_at: new Date(dueNow.getTime() + 3600000).toISOString(), duration_min: 30, mode: "phone",
        status: "scheduled", location: "", interviewer: "", notes: "", room_url: "", room_name: "", recording_url: "", recording_id: "",
        transcript_url: "", ai_summary: null, record_enabled: false, created_at: new Date().toISOString(),
      },
    ];
    const normalResult = await runDailyBriefScan(dueNow.getTime());
    check("daily brief force (Fix 4): a normal (non-quiet, non-forced) due employer still briefs exactly once", normalResult.sent === 1, normalResult);
    const statesAfterNormal = await getBriefStates([emp]);
    check("daily brief force (Fix 4): a normal run DOES write last_brief_at", !!(statesAfterNormal.get(emp) && statesAfterNormal.get(emp).lastBriefAt), statesAfterNormal.get(emp));

    if (prevEmployerTz32b === undefined) delete process.env.EMPLOYER_TIMEZONE;
    else process.env.EMPLOYER_TIMEZONE = prevEmployerTz32b;
  }

  // ═══ 33. migrations: 0051's fix is committed, and the two new Prompt-3 tables declare grants ═══
  {
    const m51 = fs.readFileSync(path.join(ROOT, "supabase/migrations/0051_assistant_audit_log.sql"), "utf8");
    check(
      "grants: 0051's committed file includes the Oct 30 grant lines (matches what was hand-applied to production)",
      /revoke all on public\.assistant_audit_log from public, anon, authenticated/i.test(m51) && /grant select, insert, update on public\.assistant_audit_log to service_role/i.test(m51),
      m51
    );

    const m56 = fs.readFileSync(path.join(ROOT, "supabase/migrations/0056_assistant_inbound_events.sql"), "utf8");
    const m57 = fs.readFileSync(path.join(ROOT, "supabase/migrations/0057_assistant_brief_state.sql"), "utf8");
    check("grants: assistant_inbound_events grants select/insert/update to service_role explicitly", /grant select, insert, update on public\.assistant_inbound_events to service_role/i.test(m56), m56);
    check("grants: assistant_inbound_events revokes public/anon/authenticated", /revoke all on public\.assistant_inbound_events from public, anon, authenticated/i.test(m56));
    check("grants: assistant_brief_state grants select/insert/update to service_role explicitly", /grant select, insert, update on public\.assistant_brief_state to service_role/i.test(m57), m57);
    check("grants: assistant_brief_state revokes public/anon/authenticated", /revoke all on public\.assistant_brief_state from public, anon, authenticated/i.test(m57));
    check("grants: both new Prompt-3 tables enable row level security", /enable row level security/i.test(m56) && /enable row level security/i.test(m57));

    const m61 = fs.readFileSync(path.join(ROOT, "supabase/migrations/0061_assistant_ack_settings.sql"), "utf8");
    check("grants: assistant_ack_settings grants select/insert/update to service_role explicitly", /grant select, insert, update on public\.assistant_ack_settings to service_role/i.test(m61), m61);
    check("grants: assistant_ack_settings revokes public/anon/authenticated", /revoke all on public\.assistant_ack_settings from public, anon, authenticated/i.test(m61));
    check("grants: assistant_ack_settings enables row level security", /enable row level security/i.test(m61));
  }

  // ═══ 34. runner-up pool (Prompt 4): pure eligibility/ranking rules ═══
  {
    const { isRunnerUpEligible, rankRunnerUps, runnerUpMessageBody, buildRunnerUpArtifact, RUNNER_UP_SCORE_THRESHOLD, RUNNER_UP_MAX_CANDIDATES } = load("lib/assistant-runner-up.ts");
    const base = { applicantId: 1, jobId: 1, status: "new", matchScore: null, commsOptout: false };

    check("runner-up: a candidate on the SAME job is never a runner-up for it", !isRunnerUpEligible({ ...base, jobId: 2 }, 2));
    check("runner-up: an opted-out candidate is excluded even with a strong stage", !isRunnerUpEligible({ ...base, status: "shortlisted", commsOptout: true }, 2));
    check("runner-up: hired is excluded (already worked out)", !isRunnerUpEligible({ ...base, status: "hired", matchScore: 99 }, 2));
    check("runner-up: offer extended is excluded (already worked out)", !isRunnerUpEligible({ ...base, status: "offer extended", matchScore: 99 }, 2));
    check("runner-up: shortlisted with no score at all is still eligible (strong stage alone qualifies)", isRunnerUpEligible({ ...base, status: "shortlisted", matchScore: null }, 2));
    check("runner-up: interviewed qualifies", isRunnerUpEligible({ ...base, status: "interviewed" }, 2));
    check("runner-up: rejected qualifies (the classic silver-medalist stage)", isRunnerUpEligible({ ...base, status: "rejected" }, 2));
    check(`runner-up: a weak stage ('new') with score >= ${RUNNER_UP_SCORE_THRESHOLD} still qualifies`, isRunnerUpEligible({ ...base, status: "new", matchScore: RUNNER_UP_SCORE_THRESHOLD }, 2));
    check("runner-up: a weak stage with score just under the threshold does not qualify", !isRunnerUpEligible({ ...base, status: "new", matchScore: RUNNER_UP_SCORE_THRESHOLD - 1 }, 2));
    check("runner-up: a weak stage with no score at all does not qualify", !isRunnerUpEligible({ ...base, status: "reviewed", matchScore: null }, 2));

    const ranked = rankRunnerUps(
      [{ id: 1, score: 60 }, { id: 2, score: 90 }, { id: 3, score: null }, { id: 4, score: 75 }, { id: 5, score: 85 }, { id: 6, score: 70 }, { id: 7, score: 50 }],
      5
    );
    check("runner-up: ranked descending by score", ranked.map((r) => r.id).join(",") === "2,5,4,6,1", ranked);
    check(`runner-up: capped to ${RUNNER_UP_MAX_CANDIDATES} by default`, rankRunnerUps([{ score: 1 }, { score: 2 }, { score: 3 }, { score: 4 }, { score: 5 }, { score: 6 }]).length === RUNNER_UP_MAX_CANDIDATES);
    check("runner-up: an unscored candidate never outranks a scored one", rankRunnerUps([{ id: "unscored", score: null }, { id: "scored", score: 1 }], 1)[0].id === "scored");

    const body = runnerUpMessageBody("Line Cook", "Joe's Diner");
    check("runner-up: message body names the new role and the company, and carries the firstName placeholder", body.includes("Line Cook") && body.includes("Joe's Diner") && body.includes("{{firstName}}"), body);

    const artifact = buildRunnerUpArtifact("Line Cook", [{ id: 11, name: "Pat Rivera" }, { id: 12, name: "Sam Lee" }], "Hi {{firstName}}, new role: Line Cook.");
    check("runner-up artifact: irreversible (it's a real send once approved)", artifact.irreversible === true);
    check("runner-up artifact: names the new role", artifact.resolvedSpecifics.some((s) => s.label === "New role" && s.value === "Line Cook"), artifact.resolvedSpecifics);
    check("runner-up artifact: personalizes each candidate's item with their own first name", artifact.items[0].artifact.includes("Hi Pat,") && artifact.items[1].artifact.includes("Hi Sam,"), artifact.items);
  }

  // ═══ 35. runner-up pool: end-to-end scan — ranking + max-5 cap, optout exclusion, no-candidates flag, never rescans, scoring cap ═══
  {
    resetWorld();
    const prevAnthropicKey = process.env.ANTHROPIC_API_KEY;

    state.tables.job_postings = [
      { id: 1, employer_id: "emp_1", title: "Server", status: "active", runner_up_scanned: true, created_at: "2026-01-01T00:00:00Z" },
      { id: 2, employer_id: "emp_1", title: "Line Cook", description: "Prep and cook orders in a fast-paced kitchen.", requirements: [], status: "active", runner_up_scanned: false, created_at: new Date().toISOString() },
    ];
    // 7 eligible candidates on job 1 (a DIFFERENT job), all with persisted
    // scores — exercises the ranking + max-5 cap with zero scoring calls
    // (the "use persisted match scores where available" path).
    state.tables.applicants = [
      { id: 201, job_id: 1, name: "Rejected Strong", email: "a@example.com", status: "rejected", match_score: 80, candidate_comms_optout: false, notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 202, job_id: 1, name: "Shortlisted Mid", email: "b@example.com", status: "shortlisted", match_score: 60, candidate_comms_optout: false, notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 203, job_id: 1, name: "New HighScore", email: "c@example.com", status: "new", match_score: 90, candidate_comms_optout: false, notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 204, job_id: 1, name: "New LowScore", email: "d@example.com", status: "new", match_score: 40, candidate_comms_optout: false, notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 205, job_id: 1, name: "Opted Out", email: "e@example.com", status: "rejected", match_score: 99, candidate_comms_optout: true, notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 206, job_id: 1, name: "Hired Already", email: "f@example.com", status: "hired", match_score: 99, candidate_comms_optout: false, notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 207, job_id: 1, name: "Offer Out", email: "g@example.com", status: "offer extended", match_score: 99, candidate_comms_optout: false, notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 209, job_id: 1, name: "Rejected Seventy", email: "h@example.com", status: "rejected", match_score: 70, candidate_comms_optout: false, notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 210, job_id: 1, name: "Rejected SeventyFive", email: "i@example.com", status: "rejected", match_score: 75, candidate_comms_optout: false, notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 211, job_id: 1, name: "Rejected SixtyFive", email: "j@example.com", status: "rejected", match_score: 65, candidate_comms_optout: false, notes: "", created_at: "2026-01-01T00:00:00Z" },
      { id: 212, job_id: 1, name: "Rejected EightyFive", email: "k@example.com", status: "rejected", match_score: 85, candidate_comms_optout: false, notes: "", created_at: "2026-01-01T00:00:00Z" },
    ];

    const { runRunnerUpScan } = load("lib/assistant-runner-up.ts");
    const { listPendingActions } = load("lib/assistant-pending.ts");

    const result1 = await runRunnerUpScan();
    check("runner-up scan: scanned exactly the one job due (job 1 was already scanned)", result1.scanned === 1, result1);
    check("runner-up scan: drafted exactly one pending action", result1.created === 1, result1);

    const pending = await listPendingActions("emp_1");
    check("runner-up scan: exactly one pending action exists, action = message_candidates", pending.length === 1 && pending[0].action === "message_candidates", pending);
    const ids = (pending[0].payload.candidates || []).map((c) => c.id).sort((a, b) => a - b);
    check("runner-up scan: capped to the top 5 by score (203,212,201,210,209), excluding the lower-scoring 202/211 and every excluded candidate", JSON.stringify(ids) === JSON.stringify([201, 203, 209, 210, 212]), ids);
    check("runner-up scan: the opted-out candidate never appears", !ids.includes(205));
    check("runner-up scan: hired/offer-extended candidates never appear", !ids.includes(206) && !ids.includes(207));
    check("runner-up scan: the job is flagged scanned", state.tables.job_postings.find((j) => j.id === 2).runner_up_scanned === true);

    // Never rescans: a second tick with the job already flagged creates nothing new.
    const result2 = await runRunnerUpScan();
    check("runner-up scan: a job already flagged is never scanned again", result2.scanned === 0 && result2.created === 0, result2);
    const pendingAfter = await listPendingActions("emp_1");
    check("runner-up scan: no second pending action from the re-tick", pendingAfter.length === 1, pendingAfter.length);

    // No candidates: a DIFFERENT employer with zero past applicants anywhere still
    // gets its job flagged, with zero pending actions (a separate employer so the
    // emp_1 leftover pool above — candidates not in its own top 5 — can't leak in).
    state.tables.job_postings.push({ id: 100, employer_id: "emp_2", title: "Dishwasher", description: "Wash dishes.", requirements: [], status: "active", runner_up_scanned: false, created_at: new Date().toISOString() });
    const result3 = await runRunnerUpScan();
    check("runner-up scan (no candidates): still scans the job", result3.scanned === 1, result3);
    check("runner-up scan (no candidates): flagged, not created", result3.created === 0 && result3.flaggedNoCandidates === 1, result3);
    check("runner-up scan (no candidates): the job is flagged scanned even with nothing to propose", state.tables.job_postings.find((j) => j.id === 100).runner_up_scanned === true);
    const pendingForEmp2 = await listPendingActions("emp_2");
    check("runner-up scan (no candidates): no pending action was created for it", pendingForEmp2.length === 0, pendingForEmp2.length);

    // Scoring cap: 12 eligible, unscored candidates on a fresh job -> at most 10 get scored this tick.
    delete process.env.ANTHROPIC_API_KEY; // force the deterministic local fallback (no Claude call to mock)
    state.tables.job_postings.push({ id: 4, employer_id: "emp_1", title: "Busser", description: "Clear and reset tables quickly between guests in a busy dining room.", requirements: ["teamwork"], status: "active", runner_up_scanned: false, created_at: new Date().toISOString() });
    for (let i = 0; i < 12; i++) {
      state.tables.applicants.push({
        id: 300 + i, job_id: 1, name: `Unscored ${i}`, email: `u${i}@example.com`, status: "rejected", match_score: null, candidate_comms_optout: false,
        resume_text: "Line cook and kitchen prep experience, teamwork and food safety.", notes: "", created_at: "2026-01-01T00:00:00Z",
      });
    }
    await runRunnerUpScan();
    const scoredCount = state.tables.applicants.filter((a) => a.id >= 300 && a.id < 312 && typeof a.match_score === "number").length;
    check("runner-up scan: the scoring cap is respected — at most 10 of the 12 unscored candidates got scored this tick", scoredCount <= 10, scoredCount);
    check("runner-up scan: at least one unscored candidate WAS scored via the deterministic fallback (no Anthropic key)", scoredCount >= 1, scoredCount);

    if (prevAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropicKey;
  }

  // ═══ 36. standing auto-acknowledgment templates (Prompt 4): approval flow, exact-body send
  // within one worker tick, disable stops sends, job-specific beats account-wide, edit = new approval ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [
      { id: 1, employer_id: "emp_1", title: "Server", status: "active" },
      { id: 2, employer_id: "emp_1", title: "Line Cook", status: "active" },
    ];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const { runAssistantAckScan } = load("lib/assistant-ack-worker.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    // (a) Approval flow: drafting creates a pending action, NOT a live setting yet.
    const drafted = await ASSISTANT_TOOL_EXECUTORS.set_ack_template("emp_1", { template: "Thanks for applying, {{firstName}}! We'll be in touch soon." }, ctx);
    check("ack template: drafting returns a pending card, not an immediate setting", drafted.data.status === "pending" && !!drafted.data.pendingActionId);
    check("ack template: nothing is live yet (no row in assistant_ack_settings)", (state.tables.assistant_ack_settings || []).length === 0);

    // (Section F) The card must render the FULL wrapped body — greeting + template +
    // sign-off/footer — exactly as sendEmail will deliver it, not the bare template.
    const ackCardText = drafted.data.card.items[0].artifact;
    check("ack approve-what-sends: the card includes the greeting line", /^Hi \{\{firstName\}\},/.test(ackCardText), ackCardText);
    check(
      "ack approve-what-sends: the approved template sentence appears VERBATIM in the middle",
      ackCardText.includes("Thanks for applying, {{firstName}}! We'll be in touch soon."),
      ackCardText
    );
    check("ack approve-what-sends: the card includes the exact footer line sendEmail's shell appends", ackCardText.includes("Sent via ResumeTailored. Reply to this email to respond directly."), ackCardText);
    check(
      "ack approve-what-sends: the greeting comes before the template, which comes before the footer (same order as the real email)",
      ackCardText.indexOf("Hi {{firstName}}") < ackCardText.indexOf("Thanks for applying") && ackCardText.indexOf("Thanks for applying") < ackCardText.indexOf("Sent via ResumeTailored"),
      ackCardText
    );

    const approveOutcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", drafted.data.pendingActionId);
    check("ack template: approving creates exactly one enabled, account-wide setting", approveOutcome.status === "executed" && state.tables.assistant_ack_settings.length === 1 && state.tables.assistant_ack_settings[0].enabled === true && state.tables.assistant_ack_settings[0].job_id == null, state.tables.assistant_ack_settings);

    // (b) Send fires within one worker tick of a new applicant, body byte-identical to the
    // template (personalized). 501's created_at is pinned explicitly 1ms after the setting's own
    // last_enabled_at (Fix Round 6, Section C: the gate is now strict `>`, so a synchronous
    // back-to-back approve-then-push can otherwise tie within the same millisecond).
    const settingAfterApprovalA = state.tables.assistant_ack_settings[0];
    state.tables.applicants = [{ id: 501, job_id: 1, name: "Jamie Rivera", email: "jamie@example.com", status: "new", notes: "", created_at: new Date(new Date(settingAfterApprovalA.last_enabled_at).getTime() + 1).toISOString(), ack_sent_at: null }];
    const sendsBefore = (state.tables.messages || []).length;
    const result1 = await runAssistantAckScan();
    check("ack worker: scanned the one new applicant", result1.scanned === 1, result1);
    check("ack worker: sent exactly one acknowledgment", result1.sent === 1, result1);
    const sent1 = (state.tables.messages || []).slice(sendsBefore);
    check(
      "ack worker: the sent body is byte-identical to the approved template, personalized with the candidate's first name",
      sent1.length === 1 && sent1[0].content === "Thanks for applying, Jamie! We'll be in touch soon.",
      sent1
    );
    check("ack worker: ack_sent_at is stamped on the applicant", !!state.tables.applicants.find((a) => a.id === 501).ack_sent_at);

    // Idempotency: a second tick never re-sends to the same applicant.
    const result2 = await runAssistantAckScan();
    check("ack worker: a second tick sends nothing more for the same applicant", result2.sent === 0, result2);
    check("ack worker: still exactly one message total", (state.tables.messages || []).length === sendsBefore + 1);

    // (c) Disable stops sends.
    const settingId = state.tables.assistant_ack_settings[0].id;
    const { setAckSettingEnabled } = load("lib/assistant-ack-settings.ts");
    check("ack settings: disable succeeds", await setAckSettingEnabled("emp_1", settingId, false));
    state.tables.applicants.push({ id: 502, job_id: 1, name: "Casey Nguyen", email: "casey@example.com", status: "new", notes: "", created_at: new Date().toISOString(), ack_sent_at: null });
    const result3 = await runAssistantAckScan();
    check("ack worker: disabled template -> a new applicant is scanned but never acknowledged", result3.scanned === 1 && result3.sent === 0, result3);
    check("ack worker: the new applicant's ack_sent_at stays null while disabled", !state.tables.applicants.find((a) => a.id === 502).ack_sent_at);

    // (d) Job-specific overrides account-wide: re-enable a job-specific template for job 2 via a
    // fresh approval, and prove it wins over the (still-disabled) account-wide one for that job,
    // while job 1 (no job-specific template) still gets nothing since the account-wide one is off.
    const jobScoped = await ASSISTANT_TOOL_EXECUTORS.set_ack_template("emp_1", { template: "Hi {{firstName}}, thanks for applying to our Line Cook role!", job_id: 2 }, ctx);
    await approvePendingAction("emp_1", "user_1", "owner@example.com", jobScoped.data.pendingActionId);
    // Same deterministic +1ms pin as 501 above, against this (job-specific) setting's own last_enabled_at.
    const jobScopedSetting = state.tables.assistant_ack_settings.find((s) => s.job_id === 2 && s.enabled);
    state.tables.applicants.push({ id: 503, job_id: 2, name: "Lee Park", email: "lee@example.com", status: "new", notes: "", created_at: new Date(new Date(jobScopedSetting.last_enabled_at).getTime() + 1).toISOString(), ack_sent_at: null });
    const result4 = await runAssistantAckScan();
    check("ack worker: job-specific template fires for its own job even though the account-wide one is disabled", result4.sent === 1, result4);
    const sentJobScoped = (state.tables.messages || []).filter((m) => m.applicant_id === 503);
    check("ack worker: job-specific body is exactly the job-specific template", sentJobScoped.length === 1 && sentJobScoped[0].content === "Hi Lee, thanks for applying to our Line Cook role!", sentJobScoped);
    check("ack worker: job 1 (no job-specific template, account-wide disabled) still gets nothing for a new applicant there", (await (async () => { state.tables.applicants.push({ id: 504, job_id: 1, name: "Noor Ahmed", email: "noor@example.com", status: "new", notes: "", created_at: new Date().toISOString(), ack_sent_at: null }); const r = await runAssistantAckScan(); return r.sent === 0 && !state.tables.applicants.find((a) => a.id === 504).ack_sent_at; })()));

    // (e) Edit requires re-approval: re-enabling the account-wide template with DIFFERENT text is a
    // NEW pending action (never an in-place update) and only takes effect once THAT is approved.
    const edited = await ASSISTANT_TOOL_EXECUTORS.set_ack_template("emp_1", { template: "New wording: thanks, {{firstName}}!" }, ctx);
    check("ack template edit: drafting a changed template does not touch the stored settings yet", state.tables.assistant_ack_settings.filter((s) => s.employer_id === "emp_1" && s.job_id == null && s.enabled).length === 0, state.tables.assistant_ack_settings);
    await approvePendingAction("emp_1", "user_1", "owner@example.com", edited.data.pendingActionId);
    const enabledAccountWide = state.tables.assistant_ack_settings.filter((s) => s.job_id == null && s.enabled);
    check("ack template edit: after approval, exactly one enabled account-wide row with the NEW text", enabledAccountWide.length === 1 && enabledAccountWide[0].template === "New wording: thanks, {{firstName}}!", enabledAccountWide);
    check("ack template edit: the OLD account-wide row (from step a) is still there, just disabled — never deleted", state.tables.assistant_ack_settings.some((s) => s.job_id == null && !s.enabled && s.template.includes("We'll be in touch soon")));
  }

  // ═══ 36b. (Section H) ack worker bounded scope + absolute opt-out — reproduces the Oct 23
  // incident exactly: a pre-template applicant and an opted-out candidate both stay silent even
  // though ack_sent_at is null on both, while a genuinely post-template, non-opted applicant is
  // still acknowledged normally; an interview-level opt-out silences the same applicant too ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Cashier", status: "active" }];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const { runAssistantAckScan } = load("lib/assistant-ack-worker.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    // An applicant who applied BEFORE any template existed (2h ago).
    const preTemplateAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    state.tables.applicants = [
      { id: 701, job_id: 1, name: "Pat Early", email: "pat@example.com", status: "new", notes: "", created_at: preTemplateAt, ack_sent_at: null, candidate_comms_optout: false },
    ];

    // Approve the standing template NOW — its own created_at is the authorization boundary.
    const drafted = await ASSISTANT_TOOL_EXECUTORS.set_ack_template("emp_1", { template: "Thanks for applying, {{firstName}}!" }, ctx);
    await approvePendingAction("emp_1", "user_1", "owner@example.com", drafted.data.pendingActionId);
    const templateCreatedAt = state.tables.assistant_ack_settings[0].created_at;
    check(
      "ack bounded scope: fixture sanity check — the template's created_at is after the pre-template applicant's",
      new Date(templateCreatedAt).getTime() > new Date(preTemplateAt).getTime()
    );

    // An opted-out candidate who applied AFTER the template (new enough to otherwise qualify),
    // and a genuinely eligible applicant who applied AFTER the template, not opted out. Both
    // pinned explicitly 1ms after the setting's own last_enabled_at (Fix Round 6, Section C: the
    // gate is now strict `>`, so a synchronous back-to-back approve-then-push can otherwise tie
    // within the same millisecond) — this test is about the OPT-OUT check and the ELIGIBLE case,
    // not an accidental timing tie deciding either outcome.
    const templateSettingB = state.tables.assistant_ack_settings[0];
    const afterTemplateB = new Date(new Date(templateSettingB.last_enabled_at).getTime() + 1).toISOString();
    state.tables.applicants.push({ id: 702, job_id: 1, name: "Casey Optout", email: "casey@example.com", status: "new", notes: "", created_at: afterTemplateB, ack_sent_at: null, candidate_comms_optout: true });
    state.tables.applicants.push({ id: 703, job_id: 1, name: "Jordan New", email: "jordan@example.com", status: "new", notes: "", created_at: afterTemplateB, ack_sent_at: null, candidate_comms_optout: false });

    const result = await runAssistantAckScan();
    check("ack bounded scope: all three candidates were scanned", result.scanned === 3, result);
    check("ack bounded scope: exactly one acknowledgment sent — only the post-template, non-opted applicant", result.sent === 1, result);
    check("ack bounded scope: the PRE-TEMPLATE applicant stays silent — never acknowledged retroactively", !state.tables.applicants.find((a) => a.id === 701).ack_sent_at);
    check("ack bounded scope: the OPTED-OUT applicant stays silent even though they're new", !state.tables.applicants.find((a) => a.id === 702).ack_sent_at);
    check("ack bounded scope: the eligible post-template, non-opted applicant WAS acknowledged", !!state.tables.applicants.find((a) => a.id === 703).ack_sent_at);
    const sentMessages = state.tables.messages || [];
    check("ack bounded scope: exactly one message was actually sent, to the eligible applicant", sentMessages.length === 1 && sentMessages[0].applicant_id === 703, sentMessages);

    // Interview-level opt-out (the candidate replied "stop" to an interview invite) also
    // silences the ack worker for that same applicant, even with no applicant-level flag set.
    state.tables.applicants.push({ id: 704, job_id: 1, name: "Riley Stop", email: "riley@example.com", status: "new", notes: "", created_at: new Date().toISOString(), ack_sent_at: null, candidate_comms_optout: false });
    state.tables.interviews = [{ id: 1, employer_id: "emp_1", applicant_id: 704, job_id: 1, title: "Interview", scheduled_at: new Date().toISOString(), status: "scheduled", candidate_comms_optout: true }];
    const result2 = await runAssistantAckScan();
    check("ack bounded scope: an interview-level opt-out for the same applicant also silences the ack worker", !state.tables.applicants.find((a) => a.id === 704).ack_sent_at, result2);
    check("ack bounded scope: no message was sent for the interview-opted-out applicant", !(state.tables.messages || []).some((m) => m.applicant_id === 704));
  }

  // ═══ 36c. (Section G) set_ack_template disable path: immediate, no approval, no pending
  // row; the panel's own enabled toggle behaves the same way; editing TEXT still requires the
  // normal approval card even while disabled ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Barista", status: "active" }];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const { runAssistantAckScan } = load("lib/assistant-ack-worker.ts");
    const { setAckSettingEnabled } = load("lib/assistant-ack-settings.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    const drafted = await ASSISTANT_TOOL_EXECUTORS.set_ack_template("emp_1", { template: "Thanks for applying, {{firstName}}!" }, ctx);
    await approvePendingAction("emp_1", "user_1", "owner@example.com", drafted.data.pendingActionId);
    check("ack disable: one enabled account-wide setting exists before disabling", state.tables.assistant_ack_settings.filter((s) => s.enabled).length === 1);

    // Disable via chat ("stop the auto-replies" etc. resolves to disable: true): no approval,
    // no pending action, live immediately.
    const pendingBefore = (state.tables.assistant_pending_actions || []).length;
    const disableResult = await ASSISTANT_TOOL_EXECUTORS.set_ack_template("emp_1", { disable: true }, ctx);
    check("ack disable: disabling creates NO pending action", (state.tables.assistant_pending_actions || []).length === pendingBefore, state.tables.assistant_pending_actions);
    check("ack disable: the setting is disabled immediately", state.tables.assistant_ack_settings.filter((s) => s.enabled).length === 0, state.tables.assistant_ack_settings);
    check("ack disable: the tool result reports it disabled, not a pending card", disableResult.data.disabled === true && !disableResult.data.pendingActionId, disableResult.data);

    // The next application is silent.
    state.tables.applicants = [{ id: 801, job_id: 1, name: "Sam New", email: "sam@example.com", status: "new", notes: "", created_at: new Date().toISOString(), ack_sent_at: null, candidate_comms_optout: false }];
    const scan1 = await runAssistantAckScan();
    check("ack disable: the next application is silent after a chat disable", scan1.sent === 0 && !state.tables.applicants[0].ack_sent_at, scan1);

    // Toggling the SAME setting back on via the panel route (setAckSettingEnabled) is the same
    // underlying flip the chat disable used — re-enabling it resumes sends with no new approval.
    // Fix Round 4, Section B (reproducing the Oct 23 incident exactly): 801 arrived WHILE this
    // was off — re-enabling must NOT retro-fire to it, because `last_enabled_at` moves to NOW on
    // every re-enable rather than staying pinned to the template's original created_at. Only 802,
    // who arrives AFTER the re-enable, gets caught up — disabling pauses, it does not grant a
    // catch-up for whoever applied during the off window.
    const settingId = state.tables.assistant_ack_settings[0].id;
    check("ack panel toggle: re-enabling succeeds", await setAckSettingEnabled("emp_1", settingId, true));
    // Fix Round 6, Section C: deterministic instead of a wall-clock sleep — read back the
    // ACTUAL stamped last_enabled_at from the fake table and construct 802's created_at
    // explicitly 1ms after it, so the strict-> gate is exercised the same way on every run
    // instead of depending on a sleep outrunning however fast the test happens to execute.
    const lastEnabledAt1 = state.tables.assistant_ack_settings.find((s) => s.id === settingId).last_enabled_at;
    state.tables.applicants.push({ id: 802, job_id: 1, name: "Robin Again", email: "robin@example.com", status: "new", notes: "", created_at: new Date(new Date(lastEnabledAt1).getTime() + 1).toISOString(), ack_sent_at: null, candidate_comms_optout: false });
    const scan2 = await runAssistantAckScan();
    check(
      "ack panel toggle: re-enabled via the panel -> the applicant who arrived WHILE OFF (801) is never retro-acked, only the one AFTER re-enable (802)",
      scan2.sent === 1 && !state.tables.applicants.find((a) => a.id === 801).ack_sent_at && !!state.tables.applicants.find((a) => a.id === 802).ack_sent_at,
      scan2
    );

    // Fix Round 6, Section C: the tie case — an applicant created_at EXACTLY equal to
    // last_enabled_at is concurrent with the enable transition. The safe default is NOT to
    // send (a skipped ack is recoverable; an uninvited one is not), enforced by the gate's
    // strict `>` (lib/assistant-ack-worker.ts).
    state.tables.applicants.push({ id: 850, job_id: 1, name: "Exactly Tied", email: "tied@example.com", status: "new", notes: "", created_at: lastEnabledAt1, ack_sent_at: null, candidate_comms_optout: false });
    const scanTie = await runAssistantAckScan();
    check(
      "ack panel toggle tie: created_at exactly equal to last_enabled_at is NOT acked (strict-> gate)",
      scanTie.sent === 0 && !state.tables.applicants.find((a) => a.id === 850).ack_sent_at,
      scanTie
    );

    // And toggling it off again via the panel also silences future sends — same code path the
    // chat disable calls under the hood.
    check("ack panel toggle: disabling again succeeds", await setAckSettingEnabled("emp_1", settingId, false));
    state.tables.applicants.push({ id: 803, job_id: 1, name: "Taylor Off", email: "taylor@example.com", status: "new", notes: "", created_at: new Date().toISOString(), ack_sent_at: null, candidate_comms_optout: false });
    const scan3 = await runAssistantAckScan();
    check("ack panel toggle: disabled via the panel -> silent", scan3.sent === 0 && !state.tables.applicants.find((a) => a.id === 803).ack_sent_at, scan3);

    // Editing the template TEXT — even while currently disabled — still requires the normal
    // approval card; disabling never grants a bypass for a changed template.
    const edited = await ASSISTANT_TOOL_EXECUTORS.set_ack_template("emp_1", { template: "New text entirely, {{firstName}}." }, ctx);
    check("ack disable: an edited template still returns a pending card, not an immediate change", edited.data.status === "pending" && !!edited.data.pendingActionId, edited.data);
    check(
      "ack disable: the edited text is NOT live until approved",
      !state.tables.assistant_ack_settings.some((s) => s.template.includes("New text entirely")),
      state.tables.assistant_ack_settings
    );
    await approvePendingAction("emp_1", "user_1", "owner@example.com", edited.data.pendingActionId);
    check(
      "ack disable: once approved, the edited text IS live",
      state.tables.assistant_ack_settings.some((s) => s.template.includes("New text entirely") && s.enabled),
      state.tables.assistant_ack_settings
    );

    // Disabling a scope with nothing active is reported back, not thrown as an error.
    const nothingToDisable = await ASSISTANT_TOOL_EXECUTORS.set_ack_template("emp_1", { disable: true, job_id: 1 }, ctx);
    check("ack disable: disabling a scope with no active template reports back cleanly, not an error", nothingToDisable.data.disabled === false && /no active/i.test(nothingToDisable.data.message), nothingToDisable.data);
  }

  // ═══ 37. send_offer (Prompt 4): complete artifact, execution reuses the shared docusign path
  // (no reimplementation), envelope id recorded post-execution, audited with the approver ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Server", status: "active" }];
    state.tables.applicants = [{ id: 601, job_id: 1, name: "Robin Chen", email: "robin@example.com", status: "interviewed", notes: "", created_at: "2026-01-01T00:00:00Z" }];

    const sendOfferCalls = [];
    const fakeAccess = { isAdmin: false, tier: "scale" };
    const stubMocks = {
      "./docusign-offer-send": () => ({
        sendOfferEnvelope: async (employerId, userId, access, input) => {
          sendOfferCalls.push({ employerId, userId, access, input });
          return { ok: true, envelope: { id: 9001, docType: "offer", envelopeId: "env-123" }, envelopeId: "env-123", status: "sent" };
        },
      }),
    };
    const prevLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (stubMocks[request]) return stubMocks[request]();
      return prevLoad.apply(this, arguments);
    };
    delete require.cache[require.resolve(path.join(ROOT, "lib/assistant-mutations.ts"))];
    delete require.cache[require.resolve(path.join(ROOT, "lib/assistant-tools.ts"))];

    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    const drafted = await ASSISTANT_TOOL_EXECUTORS.send_offer(
      "emp_1",
      { candidate_id: 601, position: "Senior Server", salary: "$55,000/year", start_date: "2026-12-01", message: "Excited to have you join the team!" },
      ctx
    );
    check("send_offer: drafting returns a pending card", drafted.data.status === "pending" && !!drafted.data.pendingActionId, drafted);
    check(
      "send_offer artifact: complete offer summary — recipient, document, position, salary, personal message",
      drafted.data.card.resolvedSpecifics.some((s) => s.label === "Recipient" && s.value.includes("Robin Chen") && s.value.includes("robin@example.com")) &&
        drafted.data.card.resolvedSpecifics.some((s) => s.label === "Document" && s.value === "Offer letter") &&
        drafted.data.card.resolvedSpecifics.some((s) => s.label === "Position" && s.value === "Senior Server") &&
        drafted.data.card.resolvedSpecifics.some((s) => s.label === "Salary" && s.value === "$55,000/year") &&
        drafted.data.card.items[0].artifact.includes("Excited to have you join the team!"),
      drafted.data.card
    );
    check("send_offer artifact: irreversible (a real DocuSign send once approved)", drafted.data.card.irreversible === true);
    check("send_offer: drafting alone never calls the docusign path", sendOfferCalls.length === 0);

    const outcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", drafted.data.pendingActionId, fakeAccess);
    check("send_offer: approving executes exactly once, through the shared docusign path — no reimplementation", outcome.status === "executed" && sendOfferCalls.length === 1, [outcome, sendOfferCalls.length]);
    check(
      "send_offer: the shared function was called with this employer, the approving user, the approving employer's plan access, and the resolved candidate/position",
      sendOfferCalls[0].employerId === "emp_1" &&
        sendOfferCalls[0].userId === "user_1" &&
        sendOfferCalls[0].access === fakeAccess &&
        sendOfferCalls[0].input.applicantId === 601 &&
        sendOfferCalls[0].input.position === "Senior Server",
      sendOfferCalls[0]
    );

    const { getPendingActionById } = load("lib/assistant-pending.ts");
    const row = await getPendingActionById(drafted.data.pendingActionId);
    check("send_offer: the envelope id is recorded on the pending action's payload post-execution", row.payload.envelopeId === "env-123" && row.payload.envelopeStatus === "sent", row.payload);

    const auditRows = await load("lib/assistant-audit.ts").listActions("emp_1");
    check(
      "send_offer: audited as executed with the APPROVING user as actor",
      auditRows.some((r) => r.action === "send_offer" && r.status === "executed" && r.actorUserId === "user_1" && r.actorEmail === "owner@example.com"),
      auditRows
    );

    Module._load = prevLoad;
    delete require.cache[require.resolve(path.join(ROOT, "lib/assistant-mutations.ts"))];
    delete require.cache[require.resolve(path.join(ROOT, "lib/assistant-tools.ts"))];
  }

  // ═══ 38. (Fix Round 2, Section A) candidate + interviewer confirmation emails
  // (lib/employer-notify.ts) render every date/time through the employer's OWN
  // timezone (lib/employer-time.ts formatEmployerTime) — never a raw UTC string.
  // This closes the one remaining fmtWhen call site; lib/interview-reminders.ts's
  // reminder emails already went through formatEmployerTime (see section 23). ═══
  {
    resetWorld();
    const prevTz38 = process.env.EMPLOYER_TIMEZONE;
    process.env.EMPLOYER_TIMEZONE = "America/New_York";
    const prevResendKey38 = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "test-resend-key";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist" }];
    state.tables.applicants = [{ id: 101, job_id: 1, name: "Maria", email: "maria@example.com" }];

    const emailsSent38 = [];
    const prevFetch38 = global.fetch;
    global.fetch = async (url, opts) => {
      emailsSent38.push({ url, body: JSON.parse(opts.body) });
      return { ok: true };
    };

    const { notifyCandidateOfInterview, notifyInterviewerOfInterview } = load("lib/employer-notify.ts");
    const interview = {
      id: 7, applicantId: 101, jobId: 1, jobTitle: "Dental Hygienist", title: "Phone screen",
      // 2026-10-24T14:00:00.000Z is 10:00 AM EDT in America/New_York.
      scheduledAt: "2026-10-24T14:00:00.000Z", durationMin: 30, mode: "phone", location: "", interviewer: "",
      status: "scheduled", roomUrl: "", applicantName: "Maria", applicantEmail: "maria@example.com",
    };

    await notifyCandidateOfInterview("emp_1", interview, "scheduled");
    check("candidate interview email: exactly one send", emailsSent38.length === 1, emailsSent38);
    check("candidate interview email: shows the EDT-abbreviated employer-local time", /10:00\s*AM\s*EDT/.test(emailsSent38[0].body.html), emailsSent38[0].body.html);
    check("candidate interview email: no raw UTC string anywhere in the body", !/UTC/.test(emailsSent38[0].body.html), emailsSent38[0].body.html);

    emailsSent38.length = 0;
    await notifyCandidateOfInterview("emp_1", interview, "cancelled");
    check("candidate cancellation email: shows the EDT-abbreviated employer-local time", /10:00\s*AM\s*EDT/.test(emailsSent38[0].body.html), emailsSent38[0].body.html);
    check("candidate cancellation email: no raw UTC string", !/UTC/.test(emailsSent38[0].body.html), emailsSent38[0].body.html);

    emailsSent38.length = 0;
    await notifyInterviewerOfInterview("emp_1", "user_1", interview);
    check("interviewer confirmation email: exactly one send", emailsSent38.length === 1, emailsSent38);
    check("interviewer confirmation email: shows the EDT-abbreviated employer-local time", /10:00\s*AM\s*EDT/.test(emailsSent38[0].body.html), emailsSent38[0].body.html);
    check("interviewer confirmation email: no raw UTC string", !/UTC/.test(emailsSent38[0].body.html), emailsSent38[0].body.html);

    global.fetch = prevFetch38;
    if (prevResendKey38 === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResendKey38;
    if (prevTz38 === undefined) delete process.env.EMPLOYER_TIMEZONE;
    else process.env.EMPLOYER_TIMEZONE = prevTz38;
  }

  // ═══ 39. (Fix Round 2, Section B) chat system prompt: display times in the
  // employer's own timezone only — never a parenthetical UTC conversion ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.claudeScript = [{ content: [{ type: "text", text: "Your interview is at 10:00 AM EDT." }], usage: { input_tokens: 10, output_tokens: 10 } }];
    const prevTz39 = process.env.EMPLOYER_TIMEZONE;
    process.env.EMPLOYER_TIMEZONE = "America/New_York";
    await load("lib/assistant-chat.ts").runAssistantTurn({
      employerId: "emp_1", actorUserId: "user_1", actorEmail: null, canMutate: true,
      messages: [{ role: "user", content: "When is my next interview?" }],
    });
    const systemSent = state.claudeCalls[0]?.system || "";
    check(
      "chat system prompt: instructs the model to show employer-local time only, never a UTC conversion",
      /never show the raw UTC\/ISO value/i.test(systemSent) && /never add a parenthetical UTC conversion/i.test(systemSent),
      systemSent
    );
    if (prevTz39 === undefined) delete process.env.EMPLOYER_TIMEZONE;
    else process.env.EMPLOYER_TIMEZONE = prevTz39;
  }

  // ═══ 40. publish_job (Fix Round 2, Section C): reproduces the Oct 23 defect exactly
  // — draft job 15 with no pay, "publish it" → ONE pending action on job 15's id, the
  // card shows the verbatim hand-route error with approve disabled (blocked), a chat
  // correction updates the SAME card, and approval only publishes once valid — IN
  // PLACE (updateJob), never a duplicate job ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [
      {
        id: 15, employer_id: "emp_1", title: "Line Cook",
        description: "We're hiring a line cook for our busy downtown restaurant kitchen team. Weekend availability is required and prior experience is a plus.",
        location: "Austin, TX", status: "draft", public_listed: false, salary_min: null, salary_max: null, benefits_description: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const { jobPublishViolation } = load("lib/job-publish-validation.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    const drafted = await ASSISTANT_TOOL_EXECUTORS.publish_job("emp_1", { job_id: 15 }, ctx);
    check("publish_job: returns a pending action targeting job 15, no new job yet", drafted.data.status === "pending" && !!drafted.data.pendingActionId && drafted.targetId === 15 && state.tables.job_postings.length === 1, drafted);

    const expectedViolation = jobPublishViolation({
      status: "active", publicListed: true, title: "Line Cook",
      description: state.tables.job_postings[0].description, location: "Austin, TX",
      salaryMin: null, salaryMax: null, benefitsDescription: "",
    });
    check(
      "publish_job (blocked): the card surfaces the SAME pay-transparency message the hand route would reject with, verbatim",
      drafted.data.card.resolvedSpecifics.some((s) => s.label.includes("Can't publish yet") && s.value === expectedViolation.message),
      drafted.data.card
    );
    check("publish_job (blocked): the card is marked blocked — approve disabled in the UI", drafted.data.card.blocked === true, drafted.data.card);
    check("publish_job (blocked): job 15 is untouched — still a draft, not public", state.tables.job_postings[0].status === "draft" && !state.tables.job_postings[0].public_listed, state.tables.job_postings[0]);
    check("publish_job (blocked): still exactly one job posting — drafting alone never creates a duplicate", state.tables.job_postings.length === 1);

    // Defense in depth, on an INDEPENDENT job's blocked draft (job 16 — a
    // different job_id than the one corrected below, so Fix Round 4's id-less
    // upsert can never merge it with `drafted`): even if something bypassed
    // the disabled button and called approve anyway, the SAME kind of
    // validation blocks execution — never a silent publish. (Not reused
    // below: once a row leaves 'pending' it is a terminal record, same as
    // draft_job_post's own "already-resolved" case in section 13c —
    // correcting IT would draft a fresh row.)
    state.tables.job_postings.push({
      id: 16, employer_id: "emp_1", title: "Dishwasher",
      description: "We're hiring a dishwasher for our busy downtown restaurant kitchen team. Weekend availability is required.",
      location: "Austin, TX", status: "draft", public_listed: false, salary_min: null, salary_max: null, benefits_description: null,
      created_at: "2026-01-01T00:00:00Z",
    });
    const bypassAttempt = await ASSISTANT_TOOL_EXECUTORS.publish_job("emp_1", { job_id: 16 }, ctx);
    const bypassViolation = jobPublishViolation({
      status: "active", publicListed: true, title: "Dishwasher",
      description: state.tables.job_postings.find((j) => j.id === 16).description, location: "Austin, TX",
      salaryMin: null, salaryMax: null, benefitsDescription: "",
    });
    const bypassOutcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", bypassAttempt.data.pendingActionId);
    check(
      "publish_job (blocked): even if approve were called anyway on an independent blocked card, execution still fails with the identical reason — never silently publishes",
      bypassOutcome.status === "failed" && bypassOutcome.failureReason === bypassViolation.message,
      bypassOutcome
    );
    check(
      "publish_job (blocked): still only drafts — job 15 and job 16 both remain unpublished after that failed approve",
      state.tables.job_postings.length === 2 && state.tables.job_postings.every((j) => j.status === "draft"),
      state.tables.job_postings
    );

    // The employer corrects the FIRST card in chat — never having approved it — by
    // passing the SAME pending_action_id, exactly like draft_job_post's own
    // correction flow (section 13c).
    const corrected = await ASSISTANT_TOOL_EXECUTORS.publish_job(
      "emp_1",
      { job_id: 15, field_updates: { salary_min: 42000, salary_max: 50000, benefits_description: "Health insurance, paid time off." }, pending_action_id: drafted.data.pendingActionId },
      ctx
    );
    check("publish_job (corrected): reuses the SAME pending action id — no duplicate card", corrected.data.pendingActionId === drafted.data.pendingActionId, [drafted.data.pendingActionId, corrected.data.pendingActionId]);
    check(
      "publish_job (corrected): exactly ONE still-PENDING action row exists for this employer (the bypass attempt above is a separate, already-resolved 'failed' row)",
      (state.tables.assistant_pending_actions || []).filter((r) => r.employer_id === "emp_1" && r.status === "pending").length === 1,
      state.tables.assistant_pending_actions
    );
    check("publish_job (corrected): the card is no longer blocked", corrected.data.card.blocked !== true, corrected.data.card);
    check("publish_job (corrected): still targets job 15 — the SAME job id end to end", corrected.targetId === 15, corrected);

    // Fix Round 3, Section B: a SECOND correction in the same still-pending conversation
    // (e.g. the employer also tweaks the benefits wording) must still land on the SAME
    // row — the upsert isn't a one-shot special case for exactly one correction.
    const corrected2 = await ASSISTANT_TOOL_EXECUTORS.publish_job(
      "emp_1",
      { job_id: 15, field_updates: { benefits_description: "Health insurance, paid time off, and a 401(k) match." }, pending_action_id: corrected.data.pendingActionId },
      ctx
    );
    check("publish_job (corrected twice): STILL the SAME pending action id after a second correction", corrected2.data.pendingActionId === drafted.data.pendingActionId, [drafted.data.pendingActionId, corrected.data.pendingActionId, corrected2.data.pendingActionId]);
    check(
      "publish_job (corrected twice): exactly ONE still-pending row for this employer, even after two corrections",
      (state.tables.assistant_pending_actions || []).filter((r) => r.employer_id === "emp_1" && r.status === "pending").length === 1,
      state.tables.assistant_pending_actions
    );
    check(
      "publish_job (corrected twice): the FIRST correction's wage fields were preserved (merged, not dropped) even though this call only mentioned benefits — the card is still unblocked",
      corrected2.data.card.blocked !== true,
      corrected2.data.card
    );

    const outcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", corrected2.data.pendingActionId);
    check(
      "publish_job (corrected): approval now publishes job 15 IN PLACE — updateJob, never createJob — no duplicate job (job 16 from the independent bypass fixture is unaffected, still a draft)",
      outcome.status === "executed" && outcome.targetId === 15 && state.tables.job_postings.length === 2 &&
        state.tables.job_postings[0].id === 15 && state.tables.job_postings[0].status === "active" && state.tables.job_postings[0].public_listed === true &&
        state.tables.job_postings[1].id === 16 && state.tables.job_postings[1].status === "draft",
      [outcome, state.tables.job_postings]
    );
    check(
      "publish_job (corrected): the pay fields from the correction were actually saved",
      state.tables.job_postings[0].salary_min === 42000 && state.tables.job_postings[0].salary_max === 50000,
      state.tables.job_postings[0]
    );

    const auditRows40 = await load("lib/assistant-audit.ts").listActions("emp_1");
    check(
      "publish_job: the execution is audited with the APPROVING user as actor",
      auditRows40.some((r) => r.action === "publish_job" && r.status === "executed" && r.actorUserId === "user_1"),
      auditRows40
    );
  }

  // ═══ 41. publish_job: a job with complete pay data publishes on the first try with
  // no field_updates; a nonexistent or cross-tenant job_id 404s rather than silently
  // drafting against nothing ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [
      {
        id: 20, employer_id: "emp_1", title: "Warehouse Associate",
        description: "We're hiring a warehouse associate for our busy fulfillment center. Duties include picking, packing, and shipping orders accurately.",
        location: "Dallas, TX", status: "draft", public_listed: false,
        salary_min: 45000, salary_max: 55000, benefits_description: "Health insurance, 401(k) match, paid time off.",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const ctx = { actorUserId: "user_1", actorEmail: null };

    const drafted = await ASSISTANT_TOOL_EXECUTORS.publish_job("emp_1", { job_id: 20 }, ctx);
    check("publish_job (clean): not blocked", drafted.data.card.blocked !== true, drafted.data.card);
    check('publish_job (clean): the card says it will be published', drafted.data.card.title === 'Publish "Warehouse Associate"', drafted.data.card.title);
    const outcome = await approvePendingAction("emp_1", "user_1", null, drafted.data.pendingActionId);
    check(
      "publish_job (clean): approving publishes the EXISTING job 20 in place — only one job exists before and after",
      outcome.status === "executed" && state.tables.job_postings.length === 1 && state.tables.job_postings[0].id === 20 && state.tables.job_postings[0].status === "active",
      [outcome, state.tables.job_postings]
    );

    let threwMissing = false;
    try {
      await ASSISTANT_TOOL_EXECUTORS.publish_job("emp_1", { job_id: 9999 }, ctx);
    } catch (e) {
      threwMissing = /could not be found/i.test(e.message);
    }
    check("publish_job: a nonexistent job_id throws rather than drafting against nothing", threwMissing);

    let threwForeign = false;
    try {
      await ASSISTANT_TOOL_EXECUTORS.publish_job("emp_B", { job_id: 20 }, { actorUserId: "user_B", actorEmail: null });
    } catch (e) {
      threwForeign = /could not be found/i.test(e.message);
    }
    check("publish_job: a job belonging to a DIFFERENT employer is treated as not found — never cross-tenant", threwForeign);
  }

  // ═══ 42. (Fix Round 2, Section E) the admin manual-trigger route also runs the
  // runner-up scan, and marks a fresh unscanned job scanned — idempotent per job, same
  // as the instrumentation.ts 30-minute tick (section 35) ═══
  {
    resetWorld();
    const { ADMIN_USER_ID } = load("lib/admin.ts");
    state.userId = ADMIN_USER_ID;
    state.tables.job_postings = [
      {
        id: 1, employer_id: "emp_1", title: "Server", status: "active", runner_up_scanned: false,
        description: "We're hiring a server for our busy downtown restaurant. Weekend availability is required and prior experience is a plus.",
        requirements: [], created_at: new Date().toISOString(),
      },
    ];

    const req = { nextUrl: new URL(`${URLBASE}/api/admin/cert-reminder-scan?do=1`) };
    const res = await route("admin/cert-reminder-scan").GET(req);
    check("admin trigger: 200 for the admin user", res.status === 200, res.status);
    const body = await res.json();
    check("admin trigger: the response includes the runner-up scan's own result", body.runnerUp && body.runnerUp.scanned === 1, body.runnerUp);
    check("admin trigger: the fresh job is now flagged scanned", state.tables.job_postings.find((j) => j.id === 1).runner_up_scanned === true, state.tables.job_postings);

    // Idempotent: running the trigger again scans nothing new for that same job.
    const res2 = await route("admin/cert-reminder-scan").GET(req);
    const body2 = await res2.json();
    check("admin trigger: a second run never rescans an already-scanned job", body2.runnerUp && body2.runnerUp.scanned === 0, body2.runnerUp);
  }

  // ═══ 43. (Fix Round 3, Section A) reschedule_interview via chat: case-insensitive
  // name resolution; zero/ambiguous matches offer real candidate options instead of a
  // dead end ("could not find a candidate named ..."); approval MOVES the same
  // interview (never inserts) with exactly one 'rescheduled' notification; a
  // cancellation in between fails with a reason; corrections land on the same card ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const prevResendKey43 = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "test-resend-key";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Dental Hygienist" }];
    state.tables.applicants = [
      { id: 101, job_id: 1, name: "Maria Alvarez", email: "maria.a@example.com" },
      { id: 102, job_id: 1, name: "Maria Chen", email: "maria.c@example.com" },
      { id: 103, job_id: 1, name: "Sam Lee", email: "sam@example.com" },
    ];
    state.tables.interviews = [
      { id: 201, employer_id: "emp_1", applicant_id: 101, job_id: 1, title: "Phone screen", scheduled_at: "2026-11-02T14:00:00.000Z", duration_min: 30, mode: "phone", status: "scheduled" },
      { id: 202, employer_id: "emp_1", applicant_id: 102, job_id: 1, title: "Phone screen", scheduled_at: "2026-11-03T14:00:00.000Z", duration_min: 30, mode: "phone", status: "scheduled" },
      { id: 203, employer_id: "emp_1", applicant_id: 103, job_id: 1, title: "Phone screen", scheduled_at: "2026-11-04T14:00:00.000Z", duration_min: 30, mode: "phone", status: "scheduled" },
    ];

    const emailsSent43 = [];
    const prevFetch43 = global.fetch;
    global.fetch = async (_url, opts) => {
      emailsSent43.push({ body: JSON.parse(opts.body) });
      return { ok: true };
    };

    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    // Zero match — reproduces "could not find a candidate named TEST R2 Verify
    // Candidate" exactly, but must come back with real options rather than a dead end.
    const noMatch = await ASSISTANT_TOOL_EXECUTORS.reschedule_interview("emp_1", { candidate_name: "TEST R2 Verify Candidate", new_time: "2026-11-05T15:00:00.000Z" }, ctx);
    check("reschedule (chat): an unknown name resolves=false rather than throwing a dead-end error", noMatch.data.resolved === false && noMatch.data.reason === "no_match", noMatch);
    check(
      "reschedule (chat): the zero-match result offers every real scheduled candidate as options",
      noMatch.data.candidates.length === 3 && noMatch.data.candidates.some((c) => c.name === "Sam Lee"),
      noMatch.data.candidates
    );
    check("reschedule (chat): a zero-match resolution creates no pending action", (state.tables.assistant_pending_actions || []).length === 0, state.tables.assistant_pending_actions);

    // Ambiguous — "Maria" matches two real candidates by case-insensitive substring.
    const ambiguous = await ASSISTANT_TOOL_EXECUTORS.reschedule_interview("emp_1", { candidate_name: "maria", new_time: "2026-11-05T15:00:00.000Z" }, ctx);
    check("reschedule (chat): an ambiguous name resolves=false with reason 'ambiguous'", ambiguous.data.resolved === false && ambiguous.data.reason === "ambiguous", ambiguous);
    check(
      "reschedule (chat): ambiguous options list exactly the two matching candidates, as chips to choose from",
      ambiguous.data.candidates.length === 2 && ambiguous.data.candidates.every((c) => /^maria/i.test(c.name)),
      ambiguous.data.candidates
    );
    check("reschedule (chat): still no pending action after the ambiguous attempt", (state.tables.assistant_pending_actions || []).length === 0);

    // Case-insensitive EXACT match resolves to exactly one candidate.
    const resolved = await ASSISTANT_TOOL_EXECUTORS.reschedule_interview("emp_1", { candidate_name: "sam lee", new_time: "2026-11-05T15:00:00.000Z" }, ctx);
    check("reschedule (chat): a case-insensitive exact match resolves to a pending card", resolved.data.status === "pending" && !!resolved.data.pendingActionId && resolved.targetId === 203, resolved);
    check("reschedule (chat): the card names the real candidate and shows both times", resolved.data.card.title.includes("Sam Lee") && resolved.data.card.resolvedSpecifics.some((s) => s.label === "New time"), resolved.data.card);
    check("reschedule (chat): no interview was created while merely drafting — still exactly 3", state.tables.interviews.length === 3, state.tables.interviews.length);

    // Approve: the SAME interview row moves — count unchanged, exactly one 'rescheduled' email.
    // The candidate notification is deliberately fire-and-forget inside the executor
    // (`.catch(() => {})`, never awaited) — give its promise chain a tick to land
    // before asserting on it, same as a real caller would never block a request on it.
    const outcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", resolved.data.pendingActionId);
    await new Promise((r) => setTimeout(r, 20));
    check("reschedule (chat) approved: the SAME interview id was the target — never a new one", outcome.status === "executed" && outcome.targetId === 203, outcome);
    check("reschedule (chat) approved: interview COUNT is unchanged after approval — nothing was inserted", state.tables.interviews.length === 3, state.tables.interviews.length);
    const moved = state.tables.interviews.find((iv) => iv.id === 203);
    check("reschedule (chat) approved: the SAME row's scheduled_at changed to the new time", moved.scheduled_at === "2026-11-05T15:00:00.000Z", moved);
    const untouched = state.tables.interviews.filter((iv) => iv.id !== 203);
    check("reschedule (chat) approved: every OTHER interview is untouched", untouched.every((iv) => iv.scheduled_at !== "2026-11-05T15:00:00.000Z"), untouched);
    check("reschedule (chat) approved: exactly one notification email was sent", emailsSent43.length === 1, emailsSent43);
    check("reschedule (chat) approved: it is a 'rescheduled' email, never a fresh 'scheduled' one", /rescheduled/i.test(emailsSent43[0].body.subject), emailsSent43[0].body);

    // Cancelled in between: approval fails with a reason, candidate is not notified
    // again, and nothing new was ever inserted anywhere in this section.
    emailsSent43.length = 0;
    const target2 = await ASSISTANT_TOOL_EXECUTORS.reschedule_interview("emp_1", { candidate_id: 101, new_time: "2026-11-06T16:00:00.000Z" }, ctx);
    state.tables.interviews.find((iv) => iv.id === 201).status = "cancelled";
    const cancelledOutcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", target2.data.pendingActionId);
    await new Promise((r) => setTimeout(r, 20));
    check("reschedule (chat): cancelled-in-between fails with a reason, never revives the interview", cancelledOutcome.status === "failed" && !!cancelledOutcome.failureReason, cancelledOutcome);
    check(
      "reschedule (chat): the cancelled interview's time is untouched",
      state.tables.interviews.find((iv) => iv.id === 201).scheduled_at === "2026-11-02T14:00:00.000Z"
    );
    check("reschedule (chat): the candidate was not notified for the failed reschedule", emailsSent43.length === 0, emailsSent43);
    check("reschedule (chat): still exactly 3 interviews total — no insert happened anywhere in this whole section", state.tables.interviews.length === 3, state.tables.interviews.length);

    // Correction: a still-pending card, corrected with a different new_time, updates the SAME row.
    const drafted3 = await ASSISTANT_TOOL_EXECUTORS.reschedule_interview("emp_1", { candidate_id: 102, new_time: "2026-11-07T15:00:00.000Z" }, ctx);
    const corrected3 = await ASSISTANT_TOOL_EXECUTORS.reschedule_interview(
      "emp_1",
      { candidate_id: 102, new_time: "2026-11-07T18:00:00.000Z", pending_action_id: drafted3.data.pendingActionId },
      ctx
    );
    check("reschedule (chat) correction: reuses the SAME pending action id", corrected3.data.pendingActionId === drafted3.data.pendingActionId, [drafted3.data.pendingActionId, corrected3.data.pendingActionId]);
    check(
      "reschedule (chat) correction: exactly one pending row exists for this employer afterward",
      (state.tables.assistant_pending_actions || []).filter((r) => r.employer_id === "emp_1" && r.status === "pending").length === 1,
      state.tables.assistant_pending_actions
    );

    // Source guard: the executor behind every approval never calls createInterview —
    // the Oct 23 defect must stay structurally impossible, not just behaviorally absent.
    const mutSrc43 = fs.readFileSync(path.join(ROOT, "lib/assistant-mutations.ts"), "utf8");
    const execFnMatch = /async function executeRescheduleInterview[\s\S]*?\n}\n/.exec(mutSrc43);
    check("reschedule: executeRescheduleInterview's own source never calls createInterview(", !!execFnMatch && !/createInterview\(/.test(execFnMatch[0]), execFnMatch && execFnMatch[0]);

    global.fetch = prevFetch43;
    if (prevResendKey43 === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResendKey43;
  }

  // ═══ 44. (Fix Round 4, Section A) draft_job_post: a correction in a NEW conversation —
  // no pending_action_id, because the model only knows one from ITS OWN conversation
  // history — still lands on the SAME still-pending card instead of opening a second one.
  // Fields the correction doesn't repeat (title, location, publish) are merged forward
  // from the first call, never dropped, and approval is only enabled once the merged
  // result actually validates. ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const ctx = { actorUserId: "user_1", actorEmail: null };
    const longDesc = "We're hiring a warehouse associate for our busy fulfillment center. Duties include picking, packing, and shipping orders accurately.";

    const drafted = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: longDesc, title: "Warehouse Associate", location: "Dallas, TX", publish: true },
      ctx
    );
    check("cross-conversation upsert (draft): the first call is blocked — no pay data yet", /can't publish yet/i.test(drafted.data.card.title), drafted.data.card.title);
    check("cross-conversation upsert (draft): exactly one pending row exists", (state.tables.assistant_pending_actions || []).length === 1);

    // A brand-new "conversation" calls the tool again with NO pending_action_id, supplying
    // only what was missing — never repeating title, location, or publish.
    const corrected = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: longDesc, salary_min: 45000, salary_max: 55000, benefits_description: "Health insurance, 401(k) match, paid time off." },
      ctx
    );
    check("cross-conversation upsert (draft): the SAME row id is reused, never a second one", corrected.data.pendingActionId === drafted.data.pendingActionId, [drafted.data.pendingActionId, corrected.data.pendingActionId]);
    check(
      "cross-conversation upsert (draft): row count is unchanged — still exactly one pending row",
      (state.tables.assistant_pending_actions || []).length === 1,
      state.tables.assistant_pending_actions
    );
    check("cross-conversation upsert (draft): the card is no longer blocked — it will publish", /will be published/i.test(corrected.data.card.title), corrected.data.card.title);
    check(
      "cross-conversation upsert (draft): title and location from the FIRST call survive even though this call never repeated them",
      corrected.data.card.items[0].artifact.includes("Warehouse Associate") && corrected.data.card.items[0].artifact.includes("Dallas, TX"),
      corrected.data.card
    );

    const outcome = await approvePendingAction("emp_1", "user_1", null, corrected.data.pendingActionId);
    check(
      "cross-conversation upsert (draft): approval now succeeds and creates exactly one ACTIVE job",
      outcome.status === "executed" && state.tables.job_postings.length === 1 && state.tables.job_postings[0].status === "active" && state.tables.job_postings[0].location === "Dallas, TX",
      [outcome, state.tables.job_postings]
    );
  }

  // ═══ 45. (Fix Round 5, Section B — supersedes Fix Round 4's "most recent wins" test for
  // this exact bucket) draft_job_post: two pending drafts, no pending_draft_title and no
  // pending_action_id — the model cannot tell which one the employer means, so this is now
  // an AMBIGUITY outcome: nothing is created, updated, or cancelled, and the result carries
  // both candidates for the model to ask about. (Round 4's fallback — silently picking "the
  // most recent" — is exactly what Round 5 Section B removes for this bucket, because it
  // could silently land a correction on the wrong draft.) ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const ctx = { actorUserId: "user_1", actorEmail: null };
    const longDesc = "We're hiring a warehouse associate for our busy fulfillment center. Duties include picking, packing, and shipping orders accurately.";
    const otherDesc = "We're hiring an office receptionist to greet visitors and manage front-desk calls.";

    const first = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: longDesc, title: "Warehouse Associate" }, ctx);
    check("ambiguous (draft): the first id-less call just creates a row — nothing to upsert into yet", !!first.data.pendingActionId && (state.tables.assistant_pending_actions || []).length === 1);

    // A SECOND pending draft, planted directly — standing in for one that arrived from a
    // different conversation. A real second draft_job_post call right now would MERGE into
    // the sole existing pending row instead (rule: no title + exactly one pending draft ->
    // that row), so reaching the two-pending-drafts state this test is actually about
    // requires seeding the second one directly, same technique as the old "legacy duplicate"
    // fixtures this section replaces.
    state.tables.assistant_pending_actions.push({
      id: "draft-receptionist", employer_id: "emp_1", actor_user_id: "user_1", action: "draft_job_post",
      payload_json: { title: "Office Receptionist", description: otherDesc, location: "", publish: false, salaryMin: null, salaryMax: null, benefitsDescription: "", rawInput: { role_description: otherDesc, title: "Office Receptionist" } },
      artifact_json: {
        title: "Draft a new job posting", irreversible: false,
        resolvedSpecifics: [{ label: "Title", value: "Office Receptionist" }, { label: "Visibility", value: "Draft — not published" }],
        items: [{ id: "job", artifact: `Office Receptionist\n\n${otherDesc}` }],
      },
      irreversible: false, status: "pending", failure_reason: null,
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    check(
      "ambiguous (draft): the fixture now has two pending draft_job_post rows for this employer",
      (state.tables.assistant_pending_actions || []).filter((r) => r.employer_id === "emp_1" && r.status === "pending").length === 2
    );

    // A THIRD id-less call, with no pending_draft_title — there is no way to tell which of
    // the two pending drafts this is correcting.
    const ambiguous = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: longDesc, publish: true, salary_min: 45000, salary_max: 55000, benefits_description: "Health insurance, 401(k) match, paid time off." },
      ctx
    );
    check("ambiguous (draft): the call reports resolved:false, reason:'ambiguous' instead of guessing", ambiguous.data.resolved === false && ambiguous.data.reason === "ambiguous", ambiguous.data);
    check(
      "ambiguous (draft): the candidate list is complete — both pending drafts, by title",
      Array.isArray(ambiguous.data.candidates) && ambiguous.data.candidates.length === 2 &&
        ambiguous.data.candidates.some((c) => c.title === "Warehouse Associate") &&
        ambiguous.data.candidates.some((c) => c.title === "Office Receptionist"),
      ambiguous.data.candidates
    );
    check(
      "ambiguous (draft): ZERO rows mutated — no new row, no update, no cancellation; still exactly the original two pending",
      (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 2 &&
        state.tables.assistant_pending_actions.every((r) => r.status === "pending"),
      state.tables.assistant_pending_actions
    );
  }

  // ═══ 46. (Fix Round 4, Section A) publish_job: the SAME cross-conversation, id-less
  // upsert as draft_job_post — a correction with no pending_action_id lands on the one
  // still-pending publish_job card for the SAME job, never a second one. ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [
      {
        id: 30, employer_id: "emp_1", title: "Line Cook",
        description: "We're hiring a line cook for our busy downtown restaurant kitchen team. Weekend availability is required and prior experience is a plus.",
        location: "Austin, TX", status: "draft", public_listed: false, salary_min: null, salary_max: null, benefits_description: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    const drafted = await ASSISTANT_TOOL_EXECUTORS.publish_job("emp_1", { job_id: 30 }, ctx);
    check("cross-conversation upsert (publish): the first call is blocked — no pay data yet", drafted.data.card.blocked === true, drafted.data.card);
    check("cross-conversation upsert (publish): exactly one pending row targets job 30", (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 1);

    // A brand-new "conversation" — NO pending_action_id — supplies just the missing fields.
    const corrected = await ASSISTANT_TOOL_EXECUTORS.publish_job(
      "emp_1",
      { job_id: 30, field_updates: { salary_min: 42000, salary_max: 50000, benefits_description: "Health insurance, paid time off." } },
      ctx
    );
    check("cross-conversation upsert (publish): the SAME row id is reused, never a second one", corrected.data.pendingActionId === drafted.data.pendingActionId, [drafted.data.pendingActionId, corrected.data.pendingActionId]);
    check(
      "cross-conversation upsert (publish): row count is unchanged — still exactly one pending row",
      (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 1,
      state.tables.assistant_pending_actions
    );
    check("cross-conversation upsert (publish): the card is no longer blocked", corrected.data.card.blocked !== true, corrected.data.card);

    const outcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", corrected.data.pendingActionId);
    check(
      "cross-conversation upsert (publish): approval publishes job 30 IN PLACE — still exactly one job posting",
      outcome.status === "executed" && outcome.targetId === 30 && state.tables.job_postings.length === 1 && state.tables.job_postings[0].status === "active",
      [outcome, state.tables.job_postings]
    );
  }

  // ═══ 47. (Fix Round 4, Section A) publish_job: pre-existing duplicate pendings for the
  // SAME job collapse to the most recent on the next id-less call (the stale one is
  // cancelled/superseded), and approving the survivor sweeps any OTHER still-pending
  // publish_job row for that job too — two live publish cards for one job can never
  // coexist. ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [
      {
        id: 31, employer_id: "emp_1", title: "Barista",
        description: "We're hiring a barista for our busy downtown coffee shop. Weekend availability is required and prior experience is a plus.",
        location: "Austin, TX", status: "draft", public_listed: false, salary_min: null, salary_max: null, benefits_description: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    const first = await ASSISTANT_TOOL_EXECUTORS.publish_job("emp_1", { job_id: 31 }, ctx);
    check("legacy duplicates (publish): the first id-less call just creates a row for job 31", !!first.data.pendingActionId);

    // Plant a SECOND, OLDER pending publish_job row for the SAME job directly — standing in
    // for a duplicate left over from before the id-less upsert existed.
    state.tables.assistant_pending_actions.push({
      id: "legacy-dup-2", employer_id: "emp_1", actor_user_id: "user_1", action: "publish_job",
      payload_json: { jobId: 31, updates: {} },
      artifact_json: { title: 'Publish "Barista" — can\'t publish yet', irreversible: false, blocked: true, items: [{ id: "31", artifact: "A pre-fix duplicate row nobody ever resolved." }] },
      irreversible: false, status: "pending", failure_reason: null,
      created_at: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    check(
      "legacy duplicates (publish): the fixture now has two pending publish_job rows targeting job 31",
      (state.tables.assistant_pending_actions || []).filter((r) => r.employer_id === "emp_1" && r.status === "pending" && r.payload_json.jobId === 31).length === 2
    );

    const merged = await ASSISTANT_TOOL_EXECUTORS.publish_job(
      "emp_1",
      { job_id: 31, field_updates: { salary_min: 38000, salary_max: 44000, benefits_description: "Health insurance, paid sick leave." } },
      ctx
    );
    check("legacy duplicates (publish): the id-less call lands on the MOST RECENT row, not the planted legacy one", merged.data.pendingActionId === first.data.pendingActionId, [merged.data.pendingActionId, first.data.pendingActionId]);
    check(
      "legacy duplicates (publish): exactly ONE pending row remains for job 31 — the legacy duplicate was cancelled, not left dangling",
      (state.tables.assistant_pending_actions || []).filter((r) => r.employer_id === "emp_1" && r.status === "pending" && r.payload_json.jobId === 31).length === 1,
      state.tables.assistant_pending_actions
    );
    const legacyRow = state.tables.assistant_pending_actions.find((r) => r.id === "legacy-dup-2");
    check("legacy duplicates (publish): the stale row is cancelled with reason 'superseded'", legacyRow.status === "cancelled" && legacyRow.failure_reason === "superseded", legacyRow);

    const outcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", merged.data.pendingActionId);
    check(
      "legacy duplicates (publish): approval succeeds and publishes job 31 IN PLACE — still exactly one job posting, never a duplicate",
      outcome.status === "executed" && state.tables.job_postings.length === 1 && state.tables.job_postings[0].id === 31 && state.tables.job_postings[0].status === "active",
      [outcome, state.tables.job_postings]
    );
  }

  // ═══ 48. (Fix Round 4, Section B) auto-ack enable clock: reproduces the Oct 23 incident
  // across a disable→enable→disable→enable sequence — eligibility always follows the
  // LATEST enable, never an earlier one still sitting in the row's history. ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Host", status: "active" }];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const { runAssistantAckScan } = load("lib/assistant-ack-worker.ts");
    const { setAckSettingEnabled } = load("lib/assistant-ack-settings.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    // Initial approval — unchanged: an applicant right after approval IS acknowledged.
    const drafted = await ASSISTANT_TOOL_EXECUTORS.set_ack_template("emp_1", { template: "Thanks for applying, {{firstName}}!" }, ctx);
    await approvePendingAction("emp_1", "user_1", "owner@example.com", drafted.data.pendingActionId);
    const settingId = state.tables.assistant_ack_settings[0].id;
    // Pinned explicitly 1ms after the setting's own last_enabled_at (Fix Round 6, Section C: the
    // gate is now strict `>`, so a synchronous back-to-back approve-then-push can otherwise tie
    // within the same millisecond).
    const initialSetting = state.tables.assistant_ack_settings[0];
    state.tables.applicants = [{ id: 901, job_id: 1, name: "Enable One", email: "one@example.com", status: "new", notes: "", created_at: new Date(new Date(initialSetting.last_enabled_at).getTime() + 1).toISOString(), ack_sent_at: null, candidate_comms_optout: false }];
    const scanInitial = await runAssistantAckScan();
    check("ack enable clock: initial-approval flow unchanged — an applicant right after approval is acknowledged", scanInitial.sent === 1 && !!state.tables.applicants.find((a) => a.id === 901).ack_sent_at, scanInitial);

    // Cycle 1: disable, an applicant arrives while OFF, re-enable — that applicant stays silent.
    // Fix Round 6, Section C: 902's created_at is pinned a full second in the past (not plain
    // "now") so that whatever instant the upcoming re-enable happens to stamp, it is
    // deterministically later — no wall-clock sleep needed to avoid a same-millisecond tie.
    check("ack enable clock: disable #1 succeeds", await setAckSettingEnabled("emp_1", settingId, false));
    state.tables.applicants.push({ id: 902, job_id: 1, name: "During Off One", email: "offone@example.com", status: "new", notes: "", created_at: new Date(Date.now() - 1000).toISOString(), ack_sent_at: null, candidate_comms_optout: false });
    const scanWhileOff1 = await runAssistantAckScan();
    check("ack enable clock: while off, the new applicant is scanned but never acked", scanWhileOff1.sent === 0 && !state.tables.applicants.find((a) => a.id === 902).ack_sent_at, scanWhileOff1);
    check("ack enable clock: re-enable #1 succeeds", await setAckSettingEnabled("emp_1", settingId, true));
    // Read back the ACTUAL stamped last_enabled_at and construct 903's created_at explicitly
    // 1ms after it, instead of sleeping and hoping "now" landed later.
    const lastEnabledAtCycle1 = state.tables.assistant_ack_settings.find((s) => s.id === settingId).last_enabled_at;
    state.tables.applicants.push({ id: 903, job_id: 1, name: "After Enable One", email: "afterone@example.com", status: "new", notes: "", created_at: new Date(new Date(lastEnabledAtCycle1).getTime() + 1).toISOString(), ack_sent_at: null, candidate_comms_optout: false });
    const scanAfterEnable1 = await runAssistantAckScan();
    check(
      "ack enable clock: after re-enable #1, the applicant who arrived WHILE off (902) is still never acked, only the one AFTER re-enable (903)",
      scanAfterEnable1.sent === 1 && !state.tables.applicants.find((a) => a.id === 902).ack_sent_at && !!state.tables.applicants.find((a) => a.id === 903).ack_sent_at,
      scanAfterEnable1
    );

    // Cycle 2: disable again, another applicant arrives while OFF, re-enable again — the
    // worker must follow THIS (latest) enable, not any earlier one in the row's history.
    check("ack enable clock: disable #2 succeeds", await setAckSettingEnabled("emp_1", settingId, false));
    state.tables.applicants.push({ id: 904, job_id: 1, name: "During Off Two", email: "offtwo@example.com", status: "new", notes: "", created_at: new Date(Date.now() - 1000).toISOString(), ack_sent_at: null, candidate_comms_optout: false });
    const scanWhileOff2 = await runAssistantAckScan();
    check("ack enable clock: while off (cycle 2), the new applicant is scanned but never acked", scanWhileOff2.sent === 0 && !state.tables.applicants.find((a) => a.id === 904).ack_sent_at, scanWhileOff2);
    check("ack enable clock: re-enable #2 succeeds", await setAckSettingEnabled("emp_1", settingId, true));
    const lastEnabledAtCycle2 = state.tables.assistant_ack_settings.find((s) => s.id === settingId).last_enabled_at;
    state.tables.applicants.push({ id: 905, job_id: 1, name: "After Enable Two", email: "aftertwo@example.com", status: "new", notes: "", created_at: new Date(new Date(lastEnabledAtCycle2).getTime() + 1).toISOString(), ack_sent_at: null, candidate_comms_optout: false });
    const scanAfterEnable2 = await runAssistantAckScan();
    check(
      "ack enable clock: after re-enable #2 (the LATEST enable), 904 (during cycle-2 off) and 902 (during cycle-1 off) both stay silent forever — only 905 (after the latest enable) is acked",
      scanAfterEnable2.sent === 1 &&
        !state.tables.applicants.find((a) => a.id === 902).ack_sent_at &&
        !state.tables.applicants.find((a) => a.id === 904).ack_sent_at &&
        !!state.tables.applicants.find((a) => a.id === 905).ack_sent_at,
      scanAfterEnable2
    );
  }

  // ═══ 49. (Fix Round 5, Section B) draft_job_post: a correction in a NEW conversation that
  // names the pending draft by title (pending_draft_title) — reproducing the Oct 23 report,
  // where an unrelated REAL job of a confusingly similar name sat in get_jobs the whole time.
  // Exactly one pending draft exists, so the title hint confirms the target; the SAME row is
  // updated, never a second one, and the real job table is never touched by the correction. ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    // Standing in for "TEST Prompt 4 Draft Check" (id 13) from the Oct 23 report — a REAL,
    // already-published job of a confusingly similar name that draft_job_post must never touch.
    state.tables.job_postings = [
      {
        id: 13, employer_id: "emp_1", title: "TEST Prompt 4 Draft Check",
        description: "An unrelated real job of a similar name — must never be mistaken for the pending draft.",
        location: "", status: "active", public_listed: true, salary_min: 40000, salary_max: 50000, benefits_description: "Health insurance.",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const ctx = { actorUserId: "user_1", actorEmail: null };
    const longDesc = "We're hiring for a role created to verify this fix end to end. Duties include testing and sign-off.";

    const drafted = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: longDesc, title: "TEST R4 Draft Verify" }, ctx);
    check(
      "title-targeted upsert (draft): the first call creates exactly one pending draft; the real job table is untouched",
      !!drafted.data.pendingActionId && (state.tables.assistant_pending_actions || []).length === 1 && state.tables.job_postings.length === 1
    );

    // A brand-new "conversation" — no pending_action_id — names the draft by title instead.
    const corrected = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: longDesc, pending_draft_title: "TEST R4 Draft Verify", salary_min: 40000, salary_max: 48000, benefits_description: "Health insurance, paid time off." },
      ctx
    );
    check("title-targeted upsert (draft): the SAME row is reused, never a second one", corrected.data.pendingActionId === drafted.data.pendingActionId, [drafted.data.pendingActionId, corrected.data.pendingActionId]);
    check(
      "title-targeted upsert (draft): still exactly one pending row, and the unrelated REAL job (id 13) was never touched or duplicated",
      (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 1 &&
        state.tables.job_postings.length === 1 && state.tables.job_postings[0].id === 13 && state.tables.job_postings[0].title === "TEST Prompt 4 Draft Check",
      [state.tables.assistant_pending_actions, state.tables.job_postings]
    );
  }

  // ═══ 50. (Fix Round 5, Section B) draft_job_post: two pending drafts — pending_draft_title
  // disambiguates to exactly one; that row is updated, the OTHER stays untouched (not merged,
  // not cancelled, not superseded). ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const ctx = { actorUserId: "user_1", actorEmail: null };
    const warehouseDesc = "We're hiring a warehouse associate for our busy fulfillment center. Duties include picking, packing, and shipping orders accurately.";
    const receptionistDesc = "We're hiring an office receptionist to greet visitors, answer phones, and manage the front desk calendar.";

    const warehouse = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: warehouseDesc, title: "Warehouse Associate" }, ctx);
    check("title disambiguation (draft): the first id-less call just creates a row", !!warehouse.data.pendingActionId && (state.tables.assistant_pending_actions || []).length === 1);

    // A SECOND pending draft, planted directly for the same reason as section 45: a real
    // second draft_job_post call right now would merge into the sole existing row instead of
    // creating an independent one.
    const receptionistId = "draft-receptionist-50";
    state.tables.assistant_pending_actions.push({
      id: receptionistId, employer_id: "emp_1", actor_user_id: "user_1", action: "draft_job_post",
      payload_json: { title: "Office Receptionist", description: receptionistDesc, location: "", publish: false, salaryMin: null, salaryMax: null, benefitsDescription: "", rawInput: { role_description: receptionistDesc, title: "Office Receptionist" } },
      artifact_json: {
        title: "Draft a new job posting", irreversible: false,
        resolvedSpecifics: [{ label: "Title", value: "Office Receptionist" }, { label: "Visibility", value: "Draft — not published" }],
        items: [{ id: "job", artifact: `Office Receptionist\n\n${receptionistDesc}` }],
      },
      irreversible: false, status: "pending", failure_reason: null,
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    check("title disambiguation (draft): two independent pending drafts exist", (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 2);

    const corrected = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: warehouseDesc, pending_draft_title: "warehouse", publish: true, salary_min: 45000, salary_max: 55000, benefits_description: "Health insurance, 401(k) match, paid time off." },
      ctx
    );
    check(
      "title disambiguation (draft): a partial, case-insensitive title hint resolves to the WAREHOUSE row, not the receptionist one",
      corrected.data.pendingActionId === warehouse.data.pendingActionId,
      [corrected.data.pendingActionId, warehouse.data.pendingActionId, receptionistId]
    );
    check(
      "title disambiguation (draft): still exactly two pending rows — the receptionist draft is untouched",
      (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 2,
      state.tables.assistant_pending_actions
    );
    const receptionistRow = state.tables.assistant_pending_actions.find((r) => r.id === receptionistId);
    check(
      "title disambiguation (draft): the receptionist row's own fields are unchanged and still pending",
      receptionistRow.payload_json.title === "Office Receptionist" && receptionistRow.status === "pending",
      receptionistRow
    );
    check("title disambiguation (draft): the warehouse card now says it will be published", /will be published/i.test(corrected.data.card.title), corrected.data.card.title);
  }

  // ═══ 51. (Fix Round 5, Section B) draft_job_post: zero pending drafts, pending_draft_title
  // given anyway — falls through to a normal create, no crash, and the title hint itself is
  // never stored as a job field. ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const ctx = { actorUserId: "user_1", actorEmail: null };

    const created = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: "We're hiring a dog groomer for our busy downtown pet spa.", pending_draft_title: "a draft that was never actually created" },
      ctx
    );
    check(
      "zero-pending create (draft): no crash — a title hint with nothing pending still creates a normal new card",
      created.data.resolved !== false && created.data.status === "pending" && !!created.data.pendingActionId,
      created.data
    );
    check("zero-pending create (draft): exactly one pending row now exists", (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 1, state.tables.assistant_pending_actions);
    check(
      "zero-pending create (draft): pending_draft_title itself was never stored as a job field on the new row",
      !("pending_draft_title" in (state.tables.assistant_pending_actions[0].payload_json.rawInput || {})),
      state.tables.assistant_pending_actions[0]
    );
  }

  // ═══ 52. (Fix Round 5, Section A) get_pending_actions: employer-scoped, Scale-gated, and a
  // blocked card surfaces its validation error — exactly what the employer's own
  // pending-approvals inbox route already shows them, nothing more. ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [
      {
        id: 40, employer_id: "emp_1", title: "Sous Chef",
        description: "We're hiring a sous chef for our busy downtown kitchen.",
        location: "Austin, TX", status: "draft", public_listed: false, salary_min: null, salary_max: null, benefits_description: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const { ASSISTANT_TOOL_EXECUTORS, READ_ONLY_TOOL_NAMES } = load("lib/assistant-tools.ts");
    const ctx = { actorUserId: "user_1", actorEmail: null };

    // A blocked draft (no pay data, publish=true) and a blocked publish_job for job 40 — both
    // for emp_1 — plus an unrelated pending row for a DIFFERENT employer, to prove scoping.
    const blockedDraft = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: "We're hiring a line cook for our busy kitchen team.", title: "Line Cook", publish: true }, ctx);
    const blockedPublish = await ASSISTANT_TOOL_EXECUTORS.publish_job("emp_1", { job_id: 40 }, ctx);
    await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_other",
      { role_description: "A different employer's own pending draft — must never appear in emp_1's list." },
      { actorUserId: "user_other", actorEmail: null }
    );

    check("get_pending_actions: not in READ_ONLY_TOOL_NAMES — Scale-gated, same population as the mutations", !READ_ONLY_TOOL_NAMES.includes("get_pending_actions"));

    const result = await ASSISTANT_TOOL_EXECUTORS.get_pending_actions("emp_1", {}, ctx);
    const rows = result.data.pendingActions;
    check(
      "get_pending_actions: returns exactly this employer's two pending rows — not the other employer's",
      rows.length === 2 && rows.every((r) => [blockedDraft.data.pendingActionId, blockedPublish.data.pendingActionId].includes(r.pendingActionId)),
      rows
    );

    const draftEntry = rows.find((r) => r.pendingActionId === blockedDraft.data.pendingActionId);
    check("get_pending_actions: the blocked draft shows its real title, not the generic action label", draftEntry.title === "Line Cook", draftEntry);
    check(
      "get_pending_actions: the blocked draft is flagged blocked, and its validation error is among the fields the inbox already shows",
      draftEntry.blocked === true && draftEntry.fields.some((f) => /can't publish yet/i.test(f.label)),
      draftEntry
    );

    const publishEntry = rows.find((r) => r.pendingActionId === blockedPublish.data.pendingActionId);
    check(
      "get_pending_actions: the blocked publish_job shows the real job's title and its own validation error",
      publishEntry.title === "Sous Chef" && publishEntry.blocked === true && publishEntry.fields.some((f) => /can't publish yet/i.test(f.label)),
      publishEntry
    );
  }

  // ═══ 53. (Fix Round 6, Section A) draft_job_post: title-aware upsert resolution —
  // reproduces the live defect exactly, through the REAL executor calls (not row inserts):
  // creating "TEST R6 Draft Beta" while "TEST R6 Draft Alpha" is the lone pending draft must
  // create a SECOND row, never overwrite Alpha just because it was the only one pending. The
  // incoming call's own `title` field is now a first-class matching key, consulted BEFORE the
  // single-pending shortcut. ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const ctx = { actorUserId: "user_1", actorEmail: null };
    const alphaDesc = "We're hiring for TEST R6 Draft Alpha — a frontline support role handling inbound customer calls.";
    const betaDesc = "We're hiring for TEST R6 Draft Beta — a separate warehouse role, unrelated to Alpha.";
    const gammaDesc = "We're hiring for TEST R6 Draft Gamma — a third, deliberately different role entirely.";

    const alpha = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: alphaDesc, title: "TEST R6 Draft Alpha" }, ctx);
    check("title discrimination: Alpha drafted — exactly one pending row", !!alpha.data.pendingActionId && (state.tables.assistant_pending_actions || []).length === 1);

    // The overwrite scenario: a fresh call, in a NEW conversation (no pending_action_id, no
    // pending_draft_title), for a DIFFERENTLY-titled job while Alpha is the only thing pending.
    const beta = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: betaDesc, title: "TEST R6 Draft Beta" }, ctx);
    check("title discrimination: Beta creates a SECOND row rather than overwriting Alpha", beta.data.pendingActionId !== alpha.data.pendingActionId, [alpha.data.pendingActionId, beta.data.pendingActionId]);
    check("title discrimination: two pending rows now exist — both present", (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 2, state.tables.assistant_pending_actions);
    let alphaRow = state.tables.assistant_pending_actions.find((r) => r.id === alpha.data.pendingActionId);
    check("title discrimination: Alpha's own row is untouched — still titled Alpha", alphaRow.payload_json.title === "TEST R6 Draft Alpha", alphaRow);
    check("title discrimination: Beta's card shows Beta's own title, not Alpha's", beta.data.card.resolvedSpecifics.some((s) => s.label === "Title" && s.value === "TEST R6 Draft Beta"), beta.data.card);

    // Correction by name (pending_draft_title) updates the NAMED row only — Beta stays untouched.
    const correctedAlpha = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: alphaDesc, pending_draft_title: "Alpha", salary_min: 45000, salary_max: 55000, benefits_description: "Health insurance, 401(k) match, paid time off." },
      ctx
    );
    check("title discrimination: correction naming Alpha updates Alpha's row", correctedAlpha.data.pendingActionId === alpha.data.pendingActionId, [alpha.data.pendingActionId, correctedAlpha.data.pendingActionId]);
    check("title discrimination: still exactly two pending rows after the named correction", (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 2);
    const betaRowAfterNamedCorrection = state.tables.assistant_pending_actions.find((r) => r.id === beta.data.pendingActionId);
    check(
      "title discrimination: Beta's row is untouched by a correction that named Alpha",
      betaRowAfterNamedCorrection.payload_json.title === "TEST R6 Draft Beta" && betaRowAfterNamedCorrection.payload_json.salaryMin === null,
      betaRowAfterNamedCorrection
    );

    // Fresh create reusing Alpha's EXACT title (no pending_draft_title) -> updates Alpha, the
    // documented intended behavior — never a third row for what is really the same draft.
    const reusedTitle = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: "A completely rewritten description for the same Alpha role.", title: "TEST R6 Draft Alpha" },
      ctx
    );
    check(
      "title discrimination: a fresh call reusing Alpha's exact title updates Alpha, not a third row",
      reusedTitle.data.pendingActionId === alpha.data.pendingActionId && (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 2,
      [reusedTitle.data.pendingActionId, state.tables.assistant_pending_actions]
    );

    // A deliberately DIFFERENT title (Gamma) still creates a brand-new, third row.
    const gamma = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: gammaDesc, title: "TEST R6 Draft Gamma" }, ctx);
    check(
      "title discrimination: a deliberately different title (Gamma) creates a THIRD row, never an overwrite",
      gamma.data.pendingActionId !== alpha.data.pendingActionId && gamma.data.pendingActionId !== beta.data.pendingActionId,
      [alpha.data.pendingActionId, beta.data.pendingActionId, gamma.data.pendingActionId]
    );
    check("title discrimination: three pending rows now exist", (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 3);

    // Untargeted correction (no pending_draft_title, no title) with EXACTLY ONE pending draft
    // still updates that one — the single-pending shortcut survives for the case it was always
    // meant for: no title supplied anywhere to disambiguate.
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS: EXEC2 } = load("lib/assistant-tools.ts");
    const soleDraft = await EXEC2.draft_job_post("emp_1", { role_description: alphaDesc, title: "TEST R6 Draft Alpha" }, ctx);
    const untargeted = await EXEC2.draft_job_post(
      "emp_1",
      { role_description: alphaDesc, salary_min: 45000, salary_max: 55000, benefits_description: "Health insurance, 401(k) match, paid time off." },
      ctx
    );
    check(
      "title discrimination: untargeted correction with exactly one pending draft still updates that one",
      untargeted.data.pendingActionId === soleDraft.data.pendingActionId && (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 1,
      [soleDraft.data.pendingActionId, untargeted.data.pendingActionId]
    );

    // Ambiguity path: a pending_draft_title that fuzzy-matches MORE than one pending draft
    // returns chips and mutates nothing.
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS: EXEC3 } = load("lib/assistant-tools.ts");
    const draftAlpha2 = await EXEC3.draft_job_post("emp_1", { role_description: "We're hiring for TEST Draft Warehouse Alpha, a picking role.", title: "TEST Draft Warehouse Alpha" }, ctx);
    const draftBeta2 = await EXEC3.draft_job_post("emp_1", { role_description: "We're hiring for TEST Draft Warehouse Beta, a packing role.", title: "TEST Draft Warehouse Beta" }, ctx);
    check("title discrimination ambiguity: two pending drafts exist, both containing 'Warehouse'", (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 2);
    const ambiguousByHint = await EXEC3.draft_job_post(
      "emp_1",
      { role_description: "A correction that names both by a shared word.", pending_draft_title: "Warehouse", salary_min: 40000, salary_max: 48000, benefits_description: "Health insurance." },
      ctx
    );
    check("title discrimination ambiguity: a hint matching two drafts reports resolved:false, reason:'ambiguous'", ambiguousByHint.data.resolved === false && ambiguousByHint.data.reason === "ambiguous", ambiguousByHint.data);
    check(
      "title discrimination ambiguity: both candidates are offered, by title",
      Array.isArray(ambiguousByHint.data.candidates) && ambiguousByHint.data.candidates.length === 2 &&
        ambiguousByHint.data.candidates.some((c) => c.title === "TEST Draft Warehouse Alpha") &&
        ambiguousByHint.data.candidates.some((c) => c.title === "TEST Draft Warehouse Beta"),
      ambiguousByHint.data.candidates
    );
    check(
      "title discrimination ambiguity: ZERO rows mutated by the ambiguous hint — still exactly the original two pending, unchanged",
      (state.tables.assistant_pending_actions || []).filter((r) => r.status === "pending").length === 2 &&
        state.tables.assistant_pending_actions.find((r) => r.id === draftAlpha2.data.pendingActionId).payload_json.title === "TEST Draft Warehouse Alpha" &&
        state.tables.assistant_pending_actions.find((r) => r.id === draftBeta2.data.pendingActionId).payload_json.title === "TEST Draft Warehouse Beta",
      state.tables.assistant_pending_actions
    );
  }

  // ═══ 54. (Fix Round 6, Section B) confirmation cards render the COMPLETE current field
  // set, not a delta — a blocked draft_job_post card corrected with a wage (via the structured
  // salary_min/salary_max fields, no free-text pay_range) must visibly show that wage before
  // approval, and an updated card's rendering must be byte-identical in shape to what a fresh
  // card built with the same final fields would show (same function, same code path, every
  // time). publish_job's card gets the same treatment. ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const ctx = { actorUserId: "user_1", actorEmail: null };
    const roleDescription = "We're hiring a line cook for our busy kitchen team, responsible for prep and plating during dinner service.";

    // A blocked draft (publish=true, no pay data yet) ...
    const blocked = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: roleDescription, title: "Line Cook", publish: true }, ctx);
    check("card completeness (draft): first call is blocked — no pay data yet", /can't publish yet/i.test(blocked.data.card.title), blocked.data.card.title);
    check(
      "card completeness (draft): the blocked card shows no Pay range yet — nothing to show",
      !blocked.data.card.resolvedSpecifics.some((s) => s.label === "Pay range"),
      blocked.data.card.resolvedSpecifics
    );

    // ... corrected with the wage via the STRUCTURED salary_min/salary_max fields only (no
    // free-text pay_range) — exactly the shape that previously stored the wage invisibly.
    const corrected = await ASSISTANT_TOOL_EXECUTORS.draft_job_post(
      "emp_1",
      { role_description: roleDescription, salary_min: 42000, salary_max: 50000, benefits_description: "Health insurance, paid sick leave." },
      ctx
    );
    check("card completeness (draft): the SAME row is updated, not a second one", corrected.data.pendingActionId === blocked.data.pendingActionId);
    const payField = corrected.data.card.resolvedSpecifics.find((s) => s.label === "Pay range");
    check("card completeness (draft): the updated card now visibly shows the wage", !!payField && /42,?000/.test(payField.value) && /50,?000/.test(payField.value), corrected.data.card.resolvedSpecifics);
    check(
      "card completeness (draft): the updated card also shows benefits",
      corrected.data.card.resolvedSpecifics.some((s) => s.label === "Benefits" && s.value === "Health insurance, paid sick leave."),
      corrected.data.card.resolvedSpecifics
    );

    // Parity: a FRESH draft built with the exact same final fields in one call must render an
    // identical resolvedSpecifics set to the UPDATED card above — no delta-display exception.
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS: EXEC2 } = load("lib/assistant-tools.ts");
    const fresh = await EXEC2.draft_job_post(
      "emp_1",
      { role_description: roleDescription, title: "Line Cook", publish: true, salary_min: 42000, salary_max: 50000, benefits_description: "Health insurance, paid sick leave." },
      ctx
    );
    check(
      "card completeness (draft) parity: a fresh card built with the same final fields renders the identical resolvedSpecifics as the updated card",
      JSON.stringify(fresh.data.card.resolvedSpecifics) === JSON.stringify(corrected.data.card.resolvedSpecifics),
      [fresh.data.card.resolvedSpecifics, corrected.data.card.resolvedSpecifics]
    );

    // Same completeness rule for publish_job: a blocked publish corrected with a wage via
    // field_updates must show it too.
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [
      {
        id: 60, employer_id: "emp_1", title: "Sous Chef",
        description: "We're hiring a sous chef for our busy downtown kitchen.",
        location: "Austin, TX", status: "draft", public_listed: false, salary_min: null, salary_max: null, benefits_description: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const { ASSISTANT_TOOL_EXECUTORS: EXEC3 } = load("lib/assistant-tools.ts");
    const blockedPublish = await EXEC3.publish_job("emp_1", { job_id: 60 }, ctx);
    check("card completeness (publish): blocked — no pay data on the job yet", blockedPublish.data.card.blocked === true, blockedPublish.data.card);
    check("card completeness (publish): no Pay range shown yet", !blockedPublish.data.card.resolvedSpecifics.some((s) => s.label === "Pay range"), blockedPublish.data.card.resolvedSpecifics);
    const correctedPublish = await EXEC3.publish_job(
      "emp_1",
      { job_id: 60, pending_action_id: blockedPublish.data.pendingActionId, field_updates: { salary_min: 55000, salary_max: 65000, benefits_description: "Health insurance, 401(k) match." } },
      ctx
    );
    const publishPayField = correctedPublish.data.card.resolvedSpecifics.find((s) => s.label === "Pay range");
    check("card completeness (publish): the corrected card visibly shows the wage", !!publishPayField && /55,?000/.test(publishPayField.value) && /65,?000/.test(publishPayField.value), correctedPublish.data.card.resolvedSpecifics);
    check(
      "card completeness (publish): the corrected card also shows benefits",
      correctedPublish.data.card.resolvedSpecifics.some((s) => s.label === "Benefits" && s.value === "Health insurance, 401(k) match."),
      correctedPublish.data.card.resolvedSpecifics
    );
  }

  // ═══ 55. (Fix Round 7, Section B) envelope void — happy path from 'sent', a completed
  // envelope exposes no void (409, immutable history), and voiding twice is safe ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const emp = "emp_1";
    const connection = () => ({
      employer_id: emp, account_id: "acct1", account_name: "Acme", account_email: "acme@docusign.test",
      base_uri: "https://demo.docusign.net", access_token: "tok-1", access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      refresh_token: "refresh-dummy",
    });
    state.tables.docusign_connections = [connection()];
    state.tables.docusign_envelopes = [
      {
        id: 501, employer_id: emp, doc_type: "offer", document_name: "Offer letter", applicant_id: null, envelope_id: "env-501",
        subject: "Your offer", message: "", status: "sent", offer: {}, candidate_name: "Robin Chen", candidate_email: "robin@example.com",
        sent_by: emp, sent_at: new Date().toISOString(), created_at: new Date().toISOString(), requested_docs: [], attachments: [], sign_token: "tok-501", copies_sent: [],
      },
      {
        id: 502, employer_id: emp, doc_type: "offer", document_name: "Offer letter", applicant_id: null, envelope_id: "env-502",
        subject: "Your offer", message: "", status: "completed", offer: {}, candidate_name: "Sam Lee", candidate_email: "sam@example.com",
        sent_by: emp, sent_at: new Date().toISOString(), completed_at: new Date().toISOString(), created_at: new Date().toISOString(),
        requested_docs: [], attachments: [], sign_token: "tok-502", copies_sent: [],
      },
    ];

    const voidFetchCalls = [];
    const prevFetch55 = global.fetch;
    global.fetch = async (url, opts) => {
      voidFetchCalls.push({ url: String(url), opts });
      return { ok: true, json: async () => ({ status: "voided" }) };
    };

    const voidPost = (id, reason) =>
      route("employer/docusign/envelopes/[id]/void").POST(
        new Request(`${URLBASE}/x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }),
        { params: { id } }
      );

    // Completed envelope: NO void is exposed, no DocuSign call is even attempted.
    const completedRes = await voidPost("502", "test cleanup");
    check("void: a completed envelope returns 409 (immutable history, per Marvin's standing rule)", completedRes.status === 409, completedRes.status);
    check("void: attempting a completed envelope never calls the DocuSign API", voidFetchCalls.length === 0, voidFetchCalls);
    const stillCompleted = state.tables.docusign_envelopes.find((e) => e.id === 502);
    check("void: the completed envelope's status is untouched", stillCompleted.status === "completed", stillCompleted);

    // Happy path: void from 'sent'.
    const voidRes = await voidPost("501", "Candidate withdrew");
    check("void: a 'sent' envelope voids successfully (200)", voidRes.status === 200, voidRes.status);
    const voidBody = await voidRes.json();
    check("void: the response's envelope reflects the new 'voided' status", voidBody.envelope && voidBody.envelope.status === "voided", voidBody);
    check("void: exactly one DocuSign void call was made", voidFetchCalls.length === 1, voidFetchCalls);
    const voidedRow = state.tables.docusign_envelopes.find((e) => e.id === 501);
    check("void: the local row's status actually transitioned to 'voided'", voidedRow.status === "voided", voidedRow);

    const { listActions } = load("lib/assistant-audit.ts");
    const voidAuditRows = (await listActions(emp)).filter((r) => r.action === "void_envelope");
    check("void: exactly one audit row for the void action", voidAuditRows.length === 1, voidAuditRows);
    check(
      "void: the audit row is status='executed', targeting the envelope, with the reason in its payload",
      voidAuditRows[0].status === "executed" && voidAuditRows[0].targetType === "envelope" && String(voidAuditRows[0].targetId) === "501" && voidAuditRows[0].payload.reason === "Candidate withdrew",
      voidAuditRows[0]
    );

    // Idempotent double-void: voiding the now-'voided' envelope again is a clean 409, not a crash
    // or a second DocuSign call — the route's own 'sent'-only guard catches it before any fetch.
    const secondVoidRes = await voidPost("501", "again");
    check("void: voiding an already-voided envelope is a safe 409 (idempotent), not a crash", secondVoidRes.status === 409, secondVoidRes.status);
    check("void: the second attempt made no additional DocuSign call", voidFetchCalls.length === 1, voidFetchCalls);
    const auditRowsAfterSecondVoid = (await listActions(emp)).filter((r) => r.action === "void_envelope");
    check("void: the double-void attempt logged no second audit row", auditRowsAfterSecondVoid.length === 1, auditRowsAfterSecondVoid);

    global.fetch = prevFetch55;
  }

  // ═══ 56. (Fix Round 7) voiding an offer removes it from the brief's "awaiting signature"
  // count — the brief goes from non-quiet to quiet once the only outstanding offer is voided ═══
  {
    resetWorld();
    const prevEmployerTz56 = process.env.EMPLOYER_TIMEZONE;
    process.env.EMPLOYER_TIMEZONE = "UTC";
    state.userId = "emp_1";
    state.tier = "scale";
    const emp = "emp_1";
    state.tables.employer_profiles = [{ user_id: emp, company_name: "Acme Dental" }];
    state.tables.docusign_connections = [
      {
        employer_id: emp, account_id: "acct1", account_name: "Acme", account_email: "acme@docusign.test",
        base_uri: "https://demo.docusign.net", access_token: "tok-1", access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        refresh_token: "refresh-dummy",
      },
    ];
    state.tables.docusign_envelopes = [
      {
        id: 601, employer_id: emp, doc_type: "offer", document_name: "Offer letter", applicant_id: null, envelope_id: "env-601",
        subject: "Your offer", message: "", status: "sent", offer: {}, candidate_name: "Robin Chen", candidate_email: "robin@example.com",
        sent_by: emp, sent_at: new Date().toISOString(), created_at: new Date().toISOString(), requested_docs: [], attachments: [], sign_token: "tok-601", copies_sent: [],
      },
    ];

    const prevFetch56 = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ status: "voided" }) });

    const { runDailyBriefScan } = load("lib/assistant-brief.ts");
    const day1 = new Date();
    day1.setUTCHours(9, 0, 0, 0);
    const before = await runDailyBriefScan(day1.getTime());
    check(
      "void + brief (checklist item 3, before): an offer awaiting signature alone keeps the brief non-quiet",
      before.sent === 1 && before.quietSkipped === 0,
      before
    );

    const voidRes = await route("employer/docusign/envelopes/[id]/void").POST(
      new Request(`${URLBASE}/x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Candidate withdrew" }) }),
      { params: { id: "601" } }
    );
    check("void + brief: the void itself succeeds", voidRes.status === 200, voidRes.status);

    const day2 = new Date(day1.getTime() + 24 * 60 * 60 * 1000); // next calendar day, same local hour -> due again
    const after = await runDailyBriefScan(day2.getTime());
    check(
      "void + brief (checklist item 3, after): once voided, the offer no longer counts as awaiting signature — the next brief goes quiet",
      after.sent === 0 && after.quietSkipped === 1,
      after
    );

    global.fetch = prevFetch56;
    if (prevEmployerTz56 === undefined) delete process.env.EMPLOYER_TIMEZONE;
    else process.env.EMPLOYER_TIMEZONE = prevEmployerTz56;
  }

  // ═══ 57. lib/playbooks.ts: role playbooks are well-formed and free of protected-class screening questions (Prompt 5) ═══
  {
    const { PLAYBOOK_KEYS, getPlaybook, playbookQuestionViolatesPolicy, playbookKeyList } = load("lib/playbooks.ts");
    check(
      "playbooks: exactly the five required roles exist",
      JSON.stringify([...PLAYBOOK_KEYS].sort()) === JSON.stringify(["dental-hygienist", "dispatcher", "hvac-service-tech", "personal-assistant", "restaurant-server"].sort()),
      PLAYBOOK_KEYS
    );
    for (const key of PLAYBOOK_KEYS) {
      const pb = getPlaybook(key);
      check(`playbooks[${key}]: has 3-5 screening questions`, pb.screeningQuestions.length >= 3 && pb.screeningQuestions.length <= 5, pb.screeningQuestions);
      check(`playbooks[${key}]: has 6-8 interview questions`, pb.interviewKit.questions.length >= 6 && pb.interviewKit.questions.length <= 8, pb.interviewKit.questions);
      check(`playbooks[${key}]: has 4-6 scorecard criteria`, pb.interviewKit.scorecard.length >= 4 && pb.interviewKit.scorecard.length <= 6, pb.interviewKit.scorecard);
      check(`playbooks[${key}]: the skeleton description never pre-fills a wage figure`, !/\$\d|\bper hour\b|\bsalary\b/i.test(pb.skeletonDescription), pb.skeletonDescription);
      const allQuestions = [...pb.screeningQuestions, ...pb.interviewKit.questions, ...pb.interviewKit.scorecard];
      check(
        `playbooks[${key}]: no screening/interview question matches a banned protected-class phrase (age/religion/marital-family/pregnancy/national-origin/disability)`,
        !allQuestions.some((q) => playbookQuestionViolatesPolicy(q)),
        allQuestions.filter((q) => playbookQuestionViolatesPolicy(q))
      );
    }
    check("playbooks: getPlaybook returns null for an unknown key", getPlaybook("astronaut") === null);
    check("playbooks: playbookKeyList lists every key", PLAYBOOK_KEYS.every((k) => playbookKeyList().includes(k)), playbookKeyList());
    check(
      "playbooks (banned-phrase canary): the policy check itself actually catches an illegal question — proves the test isn't vacuously passing",
      playbookQuestionViolatesPolicy("How old are you?") === true && playbookQuestionViolatesPolicy("What is your religion?") === true && playbookQuestionViolatesPolicy("Do you have children?") === true
    );
  }

  // ═══ 58. start_job_from_playbook: full flow — trigger -> skeleton+kit card -> chip answers update the SAME card across multiple turns without forgetting an earlier answer -> approve -> unpublished draft with pay filled, screening questions + kit stored (Prompt 5) ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { JOB_PLAYBOOKS } = load("lib/playbooks.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    const started = await ASSISTANT_TOOL_EXECUTORS.start_job_from_playbook("emp_1", { playbook_key: "personal-assistant" }, ctx);
    check(
      "start_job_from_playbook: returns a pending card pre-loaded with the playbook's skeleton description",
      started.data.status === "pending" && !!started.data.pendingActionId && started.data.card.items[0].artifact.includes("Personal Assistant"),
      started.data.card
    );
    check(
      "start_job_from_playbook: the card includes the playbook's screening questions",
      started.data.card.items.some((i) => i.id === "screening" && i.artifact.includes(JOB_PLAYBOOKS["personal-assistant"].screeningQuestions[0])),
      started.data.card.items
    );
    check(
      "start_job_from_playbook: the card includes the playbook's interview kit",
      started.data.card.items.some((i) => i.id === "kit" && i.artifact.includes(JOB_PLAYBOOKS["personal-assistant"].interviewKit.questions[0])),
      started.data.card.items
    );
    check(
      "start_job_from_playbook: never publishes — stays a draft even with no publish flag asked for",
      started.data.card.resolvedSpecifics.some((s) => s.label === "Visibility" && /Draft/.test(s.value)),
      started.data.card.resolvedSpecifics
    );
    check("start_job_from_playbook: NO job created yet", (state.tables.job_postings || []).length === 0);

    // Turn 2: the employer answers hours ONLY — updates the SAME card.
    const turn2 = await ASSISTANT_TOOL_EXECUTORS.start_job_from_playbook(
      "emp_1",
      { playbook_key: "personal-assistant", pending_action_id: started.data.pendingActionId, hours: "Full-time, Mon–Fri" },
      ctx
    );
    check("start_job_from_playbook (turn 2): hours answer updates the SAME pending card, not a second one", turn2.data.pendingActionId === started.data.pendingActionId && turn2.data.updated === true, turn2.data);
    check("start_job_from_playbook (turn 2): still exactly one pending row", (state.tables.assistant_pending_actions || []).length === 1);

    // Turn 3: the employer answers pay + location ONLY — the earlier hours answer must NOT be forgotten.
    const turn3 = await ASSISTANT_TOOL_EXECUTORS.start_job_from_playbook(
      "emp_1",
      { playbook_key: "personal-assistant", pending_action_id: started.data.pendingActionId, salary_min: 45000, salary_max: 55000, location: "Austin, TX" },
      ctx
    );
    check(
      "start_job_from_playbook (turn 3): the card still shows turn 2's hours AND turn 3's pay/location together — a later turn never erases an earlier answer",
      /Full-time, Mon–Fri/.test(turn3.data.card.items[0].artifact) && /Austin, TX/.test(turn3.data.card.items[0].artifact),
      turn3.data.card.items[0].artifact
    );

    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const outcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", turn3.data.pendingActionId);
    check("start_job_from_playbook: approve executes and creates exactly one job", outcome.status === "executed" && state.tables.job_postings.length === 1, outcome);
    const job = state.tables.job_postings[0];
    check("start_job_from_playbook: the job is saved as an UNPUBLISHED draft, never auto-published", job.status === "draft" && !job.public_listed, job);
    check("start_job_from_playbook: pay is filled in from the chip answers", job.salary_min === 45000 && job.salary_max === 55000, job);
    check(
      "start_job_from_playbook: the playbook's screening questions are stored on the job",
      JSON.stringify(job.screening_questions) === JSON.stringify(JOB_PLAYBOOKS["personal-assistant"].screeningQuestions),
      job.screening_questions
    );
    check(
      "start_job_from_playbook: the playbook's interview kit is stored, sourced 'playbook'",
      state.tables.job_interview_kits.length === 1 &&
        state.tables.job_interview_kits[0].job_id === job.id &&
        state.tables.job_interview_kits[0].source === "playbook" &&
        JSON.stringify(state.tables.job_interview_kits[0].questions) === JSON.stringify(JOB_PLAYBOOKS["personal-assistant"].interviewKit.questions),
      state.tables.job_interview_kits
    );

    let threwUnknown = false;
    try {
      await ASSISTANT_TOOL_EXECUTORS.start_job_from_playbook("emp_1", { playbook_key: "astronaut" }, ctx);
    } catch {
      threwUnknown = true;
    }
    check("start_job_from_playbook: an unknown playbook_key is rejected rather than silently drafting something generic", threwUnknown === true);
  }

  // ═══ 59. create_interview_kit: grounded in the job's real fields, stored on approval, refuses (no pending row, no model call) on a too-thin job post (Prompt 5) ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const ctx = { actorUserId: "user_1", actorEmail: "owner@example.com" };

    state.tables.job_postings = [
      {
        id: 701,
        employer_id: "emp_1",
        title: "Warehouse Associate",
        status: "active",
        description:
          "We need a dependable warehouse associate experienced with forklift operation, inventory counts, and pallet jacks to keep our busy fulfillment center running smoothly every shift.",
        requirements: ["Forklift certification", "Ability to lift 50 lbs"],
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const generatedKit = {
      questions: [
        "Tell me about your forklift certification experience.",
        "How do you approach inventory counts?",
        "Describe handling a pallet jack safely.",
        "What's your experience lifting 50 lbs regularly?",
        "How do you keep a fulfillment center running during a rush?",
        "Tell me about a time you caught an inventory error.",
      ],
      scorecard: ["Forklift competency", "Safety awareness", "Physical capability", "Attention to detail"],
    };
    state.claudeScript = [{ content: [{ type: "text", text: JSON.stringify(generatedKit) }], usage: { input_tokens: 10, output_tokens: 10 } }];

    const result = await ASSISTANT_TOOL_EXECUTORS.create_interview_kit("emp_1", { job_id: 701 }, ctx);
    const cardJson = JSON.stringify(result.data.card);
    check(
      "create_interview_kit: grounded — the card's questions reference the job's own real fields (forklift / pallet jack / lift 50 lbs), not generic fabricated ones",
      /forklift/i.test(cardJson) && /pallet jack/i.test(cardJson) && /50 lbs/.test(cardJson),
      cardJson
    );
    check("create_interview_kit: pending, nothing stored yet", result.data.status === "pending" && (state.tables.job_interview_kits || []).length === 0);

    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const outcome = await approvePendingAction("emp_1", "user_1", "owner@example.com", result.data.pendingActionId);
    check(
      "create_interview_kit: approve stores exactly one kit, sourced 'llm', with the real generated questions/scorecard",
      outcome.status === "executed" &&
        state.tables.job_interview_kits.length === 1 &&
        state.tables.job_interview_kits[0].job_id === 701 &&
        state.tables.job_interview_kits[0].source === "llm" &&
        JSON.stringify(state.tables.job_interview_kits[0].questions) === JSON.stringify(generatedKit.questions),
      state.tables.job_interview_kits
    );

    // thin-job-post refusal path: no pending row, no model call.
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [{ id: 702, employer_id: "emp_1", title: "Helper", status: "draft", description: "Need help.", requirements: [], created_at: "2026-01-01T00:00:00Z" }];
    const thin = await ASSISTANT_TOOL_EXECUTORS.create_interview_kit("emp_1", { job_id: 702 }, ctx);
    check("create_interview_kit (thin job): refuses, structured, non-throwing", thin.data.resolved === false && thin.data.reason === "thin_job", thin.data);
    check("create_interview_kit (thin job): creates NO pending row", (state.tables.assistant_pending_actions || []).length === 0);
    check("create_interview_kit (thin job): never calls the model — a thin job is cheaper to refuse than to generate against", state.claudeCalls.length === 0);
  }

  // ═══ 60. message_candidates: Spanish-first multilingual drafting — gloss_en required for a non-English draft, the card shows both clearly labeled, the gloss is faithful (keeps pay/dates), the SPANISH body is what actually sends, and the English path is completely unchanged (Prompt 5) ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "scale";
    state.tables.job_postings = [{ id: 1, employer_id: "emp_1", title: "Personal Assistant", status: "active", created_at: "2026-01-01T00:00:00Z" }];
    state.tables.applicants = [
      { id: 9101, job_id: 1, name: "Maria Alvarez", email: "maria@example.com", resume_text: "", cover_letter: "", match_score: null, match_analysis: null, status: "new", notes: "", created_at: "2026-01-01T00:00:00Z" },
    ];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const { ASSISTANT_MESSAGE_LANGUAGES } = load("lib/assistant-mutations.ts");
    const ctx = { actorUserId: "user_1", actorEmail: null };

    check("message_candidates: the language registry supports 'en' and 'es' today (one-line-per-language by design)", Object.keys(ASSISTANT_MESSAGE_LANGUAGES).sort().join(",") === "en,es", ASSISTANT_MESSAGE_LANGUAGES);

    let threwNoGloss = false;
    try {
      await ASSISTANT_TOOL_EXECUTORS.message_candidates("emp_1", { candidate_ids: [9101], message: "Hola {{firstName}}, gracias por tu interés.", language: "es" }, ctx);
    } catch {
      threwNoGloss = true;
    }
    check("message_candidates: APPROVE-WHAT-YOU-SEE — a Spanish draft with no gloss_en is rejected before any card is made", threwNoGloss === true);

    const sent = await ASSISTANT_TOOL_EXECUTORS.message_candidates(
      "emp_1",
      {
        candidate_ids: [9101],
        message: "Hola {{firstName}}, gracias por tu interés. El salario es de $20/hora y la fecha de inicio es el 1 de marzo.",
        language: "es",
        gloss_en: "Hi {{firstName}}, thank you for your interest. The pay is $20/hour and the start date is March 1st.",
      },
      ctx
    );
    const cardText = sent.data.card.items[0].artifact;
    check("message_candidates (es): the card shows BOTH the Spanish text and the English gloss, clearly labeled", /Spanish/.test(cardText) && /English gloss/.test(cardText), cardText);
    check("message_candidates (es): the gloss is faithful — it does not drop the pay figure or the date", /\$20\/hour/.test(cardText) && /March 1/.test(cardText), cardText);
    check("message_candidates (es): the Spanish body itself is still the one that will send", /\$20\/hora/.test(cardText) && /gracias por tu interés/.test(cardText), cardText);
    check("message_candidates (es): Language is surfaced in resolvedSpecifics", sent.data.card.resolvedSpecifics.some((s) => s.label === "Language" && s.value === "Spanish"), sent.data.card.resolvedSpecifics);
    check("message_candidates (es): irreversible=true, same as every message_candidates call", sent.data.card.irreversible === true);

    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const approveOutcome = await approvePendingAction("emp_1", "user_1", null, sent.data.pendingActionId);
    check("message_candidates (es): approving queues the send", approveOutcome.status === "executed", approveOutcome);
    const queued = (state.tables.assistant_send_queue || []).find((r) => r.pending_action_id === sent.data.pendingActionId);
    check("message_candidates (es): the queued send body is the SPANISH text — the gloss is never sent", !!queued && /gracias por tu interés/.test(queued.body) && !/thank you for your interest/.test(queued.body), queued);

    // English path unchanged: no Language resolvedSpecific, no gloss required, plain artifact text.
    const enResult = await ASSISTANT_TOOL_EXECUTORS.message_candidates("emp_1", { candidate_ids: [9101], message: "Hi Maria, thanks for applying!" }, ctx);
    check(
      "message_candidates (en): completely unchanged — no Language resolvedSpecific, plain (un-labeled) artifact text",
      !enResult.data.card.resolvedSpecifics.some((s) => s.label === "Language") && enResult.data.card.items[0].artifact === "Hi Maria, thanks for applying!",
      enResult.data.card
    );
  }

  // ═══ 61. hiring_report: plain-language reports assembled ONLY from real query results — every number in the prose and the source-number block traces to the seeded fixtures, Portal tier gets it (read-only) (Prompt 5) ═══
  {
    resetWorld();
    state.userId = "emp_1";
    state.tier = "portal";
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const iso = (deltaMs) => new Date(now + deltaMs).toISOString();
    state.tables.job_postings = [{ id: 801, employer_id: "emp_1", title: "Dispatcher", status: "active", created_at: iso(-40 * DAY), updated_at: iso(-40 * DAY) }];
    state.tables.applicants = [
      { id: 9201, job_id: 801, name: "Alex Kim", email: "a@x.com", resume_text: "", cover_letter: "", match_score: 70, match_analysis: null, status: "hired", notes: "", created_at: iso(-20 * DAY), status_changed_at: iso(-5 * DAY) },
      { id: 9202, job_id: 801, name: "Riley Jordan", email: "r@x.com", resume_text: "", cover_letter: "", match_score: 55, match_analysis: null, status: "new", notes: "", created_at: iso(-3 * DAY), status_changed_at: iso(-3 * DAY) },
      { id: 9203, job_id: 801, name: "Sam Lee", email: "s@x.com", resume_text: "", cover_letter: "", match_score: 40, match_analysis: null, status: "reviewed", notes: "", created_at: iso(-10 * DAY), status_changed_at: iso(-9 * DAY) },
    ];

    const { gatherHiringReportFacts, hiringReportSourceNumbers, fallbackHiringReportText } = load("lib/hiring-report.ts");
    const facts = await gatherHiringReportFacts("emp_1", "month", now);
    check("hiring_report facts: funnel counts reflect the real seeded pipeline", facts.funnelCounts.hired === 1 && facts.funnelCounts.new === 1 && facts.funnelCounts.reviewed === 1, facts.funnelCounts);
    check("hiring_report facts: time-to-fill is computed from the real job/hire dates (job created -40d, hired at -5d -> 35 days)", facts.timeToFillDays.length === 1 && facts.timeToFillDays[0].jobTitle === "Dispatcher" && facts.timeToFillDays[0].days === 35, facts.timeToFillDays);
    check(
      "hiring_report facts: longest-idle reuses the SAME staleness math as get_pipeline_health (Sam Lee, stale at 9 days >= the 7-day default)",
      facts.longestIdle.length === 1 && facts.longestIdle[0].name === "Sam Lee" && facts.longestIdle[0].days === 9,
      facts.longestIdle
    );
    check("hiring_report facts: applicants-per-job counts the real seeded applicants for the period", facts.applicantsPerJob.length === 1 && facts.applicantsPerJob[0].jobTitle === "Dispatcher" && facts.applicantsPerJob[0].count === 3, facts.applicantsPerJob);

    const expectedSourceNumbers = hiringReportSourceNumbers(facts);
    check("hiring_report: the source-number block is present and non-empty", Array.isArray(expectedSourceNumbers) && expectedSourceNumbers.length > 0, expectedSourceNumbers);

    const expectedProse = `Hiring report drawn only from: ${JSON.stringify(facts)}`;
    state.claudeScript = [{ content: [{ type: "text", text: expectedProse }], usage: { input_tokens: 10, output_tokens: 10 } }];
    const { ASSISTANT_TOOL_EXECUTORS } = load("lib/assistant-tools.ts");
    const result = await ASSISTANT_TOOL_EXECUTORS.hiring_report("emp_1", { period: "month" });
    check("hiring_report: period passes through", result.data.period === "month");
    check("hiring_report: the prose is exactly what was rendered from the REAL facts — no re-fabrication between the facts and the tool's return", result.data.report === expectedProse, result.data.report);
    check("hiring_report: sourceNumbers returned by the tool exactly matches the real query results", JSON.stringify(result.data.sourceNumbers) === JSON.stringify(expectedSourceNumbers), result.data.sourceNumbers);

    check(
      "hiring_report: fallbackHiringReportText (no-LLM path) is assembled directly from facts, no network, and names the real job",
      fallbackHiringReportText(facts).includes("Dispatcher"),
      fallbackHiringReportText(facts)
    );

    // Default period when omitted is 'month'.
    state.claudeScript = [{ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10, output_tokens: 10 } }];
    const defaulted = await ASSISTANT_TOOL_EXECUTORS.hiring_report("emp_1", {});
    check("hiring_report: period defaults to 'month' when omitted", defaulted.data.period === "month", defaulted.data);
  }

  // ═══ 62. migrations: 0066 declares the new table's grants and leaves job_postings' existing grants alone (Prompt 5) ═══
  {
    const m66 = fs.readFileSync(path.join(ROOT, "supabase/migrations/0066_interview_kits_and_screening_questions.sql"), "utf8");
    check("grants: job_interview_kits grants select/insert/update to service_role explicitly", /grant select, insert, update on public\.job_interview_kits to service_role/i.test(m66), m66);
    check("grants: job_interview_kits revokes public/anon/authenticated", /revoke all on public\.job_interview_kits from public, anon, authenticated/i.test(m66), m66);
    check("grants: job_interview_kits enables row level security", /enable row level security/i.test(m66));
    check("migrations: 0066 adds screening_questions as a plain jsonb array column, matching requirements/nice_to_haves' shape", /add column if not exists screening_questions jsonb not null default '\[\]'::jsonb/i.test(m66), m66);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) {
    console.error("FAILURES DETECTED");
    process.exit(1);
  }
  console.log("ALL PASS");
})();
