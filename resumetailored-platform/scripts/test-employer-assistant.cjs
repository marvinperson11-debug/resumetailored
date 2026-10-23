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
  }

  // ═══ 4. tool registry shape: six read-only tools (Prompt 3 adds get_pipeline_health) + six mutating tools (Prompt 2 + Prompt 4's set_ack_template/send_offer) ═══
  {
    const { ASSISTANT_TOOL_NAMES, ASSISTANT_TOOL_EXECUTORS, ASSISTANT_TOOL_DEFS, READ_ONLY_TOOL_NAMES } = load("lib/assistant-tools.ts");
    const readOnly = ["get_jobs", "summarize_candidates", "summarize_pipeline", "get_schedule", "get_candidate", "get_pipeline_health"];
    const mutating = ["draft_job_post", "move_candidates", "schedule_interviews", "message_candidates", "set_ack_template", "send_offer"];
    check("tool registry: contains exactly the six read-only + six mutating tools, nothing else", JSON.stringify([...ASSISTANT_TOOL_NAMES].sort()) === JSON.stringify([...readOnly, ...mutating].sort()), ASSISTANT_TOOL_NAMES);
    check(
      "tool registry: every name has exactly one executor and one def",
      [...readOnly, ...mutating].every((n) => typeof ASSISTANT_TOOL_EXECUTORS[n] === "function" && ASSISTANT_TOOL_DEFS.some((d) => d.name === n))
    );
    check("tool registry: READ_ONLY_TOOL_NAMES is exactly the six read-only tools", JSON.stringify([...READ_ONLY_TOOL_NAMES].sort()) === JSON.stringify([...readOnly].sort()), READ_ONLY_TOOL_NAMES);
    const mutatingWords = /\b(create|update|delete|send|move|schedule|cancel|publish|invite|remove|message)\b/i;
    check(
      "tool registry: the five READ-ONLY tools' name/description still imply no mutation (defense in depth beyond 'there is no mutating executor' for those five)",
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

  // ═══ 11. Portal-tier chat is never even OFFERED the mutating tools (so "decline gracefully, zero rows created" is true by construction); Scale-tier gets all nine ═══
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
      "plan gating (chat): a Portal-tier turn is offered ONLY the six read-only tools — the mutating ones are never in the list Claude sees",
      JSON.stringify(toolNamesSent) === JSON.stringify(["get_candidate", "get_jobs", "get_pipeline_health", "get_schedule", "summarize_candidates", "summarize_pipeline"]),
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
      "plan gating (chat): a Scale-tier turn is offered all twelve tools",
      scaleToolNames.length === 12 &&
        scaleToolNames.includes("draft_job_post") &&
        scaleToolNames.includes("message_candidates") &&
        scaleToolNames.includes("get_pipeline_health") &&
        scaleToolNames.includes("set_ack_template") &&
        scaleToolNames.includes("send_offer"),
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

    const result2 = await runDailyBriefScan(forcedNow.getTime() + 3600000); // same day, one hour later
    check("daily brief: a second tick the same day sends nothing", result2.sent === 0 && result2.quietSkipped === 0, result2);

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

    if (prevEmployerTz29 === undefined) delete process.env.EMPLOYER_TIMEZONE;
    else process.env.EMPLOYER_TIMEZONE = prevEmployerTz29;
  }

  // ═══ 30. daily brief: an LLM failure still sends a fallback brief, logged as a failure ═══
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
    check("daily brief: the LLM failure is logged via logAction with status 'failed'", auditRows.some((r) => r.action === "daily_brief" && r.status === "failed"), auditRows);
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

    // (b) Send fires within one worker tick of a new applicant, body byte-identical to the template (personalized).
    state.tables.applicants = [{ id: 501, job_id: 1, name: "Jamie Rivera", email: "jamie@example.com", status: "new", notes: "", created_at: new Date().toISOString(), ack_sent_at: null }];
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
    state.tables.applicants.push({ id: 503, job_id: 2, name: "Lee Park", email: "lee@example.com", status: "new", notes: "", created_at: new Date().toISOString(), ack_sent_at: null });
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

    // An opted-out candidate who applied AFTER the template (new enough to otherwise qualify).
    state.tables.applicants.push({ id: 702, job_id: 1, name: "Casey Optout", email: "casey@example.com", status: "new", notes: "", created_at: new Date().toISOString(), ack_sent_at: null, candidate_comms_optout: true });
    // A genuinely eligible applicant: applied AFTER the template, not opted out.
    state.tables.applicants.push({ id: 703, job_id: 1, name: "Jordan New", email: "jordan@example.com", status: "new", notes: "", created_at: new Date().toISOString(), ack_sent_at: null, candidate_comms_optout: false });

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
    // Both the still-unacked applicant from the disabled window (801) and a new one (802) are
    // still newer than the template's own created_at, so both catch up — disabling only pauses,
    // it never permanently blacklists an applicant who happened to arrive while it was off.
    const settingId = state.tables.assistant_ack_settings[0].id;
    check("ack panel toggle: re-enabling succeeds", await setAckSettingEnabled("emp_1", settingId, true));
    state.tables.applicants.push({ id: 802, job_id: 1, name: "Robin Again", email: "robin@example.com", status: "new", notes: "", created_at: new Date().toISOString(), ack_sent_at: null, candidate_comms_optout: false });
    const scan2 = await runAssistantAckScan();
    check(
      "ack panel toggle: re-enabled via the panel -> the next new application IS acknowledged",
      scan2.sent === 2 && !!state.tables.applicants.find((a) => a.id === 801).ack_sent_at && !!state.tables.applicants.find((a) => a.id === 802).ack_sent_at,
      scan2
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

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) {
    console.error("FAILURES DETECTED");
    process.exit(1);
  }
  console.log("ALL PASS");
})();
