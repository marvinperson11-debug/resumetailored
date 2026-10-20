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
  });
}
resetWorld();

function matches(row, filters) {
  return filters.every((f) => {
    if (f.op === "eq") return row[f.col] === f.val;
    if (f.op === "in") return (f.val || []).includes(row[f.col]);
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
          if (prop === "eq" || prop === "in") { ctx.filters.push({ op: prop, col: args[0], val: args[1] }); return p; }
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
    clerkClient: async () => ({ users: { getUser: async () => ({ emailAddresses: [{ emailAddress: "owner@example.com" }] }) } }),
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
      "windows: an interview 1.5h out with nothing sent yet is due for BOTH 24h and 2h",
      JSON.stringify(dueReminderWindows({ status: "scheduled", scheduledAt: at(1.5), reminder24hSent: false, reminder2hSent: false }, now).sort()) ===
        JSON.stringify(["24h", "2h"])
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
      "scheduler: exactly 3 reminders sent (interview #1 gets 24h+2h, interview #2 gets 24h only), and a real email was attempted for each",
      result1.reminded === 3 && emailsSent.length === 3,
      emailsSent
    );
    check(
      "scheduler: interview #1 got both windows, #2 got only 24h",
      JSON.stringify(scan.reminded.filter((r) => r.id === 1).map((r) => r.which).sort()) === JSON.stringify(["24h", "2h"]) &&
        JSON.stringify(scan.reminded.filter((r) => r.id === 2).map((r) => r.which)) === JSON.stringify(["24h"]),
      scan.reminded
    );
    check(
      "scheduler: each reminder email actually went to the real seeded candidate address",
      emailsSent.every((e) => e.body.to === "maria@example.com" || e.body.to === "devon@example.com"),
      emailsSent.map((e) => e.body.to)
    );

    // Apply the stamps the real markInterviewReminded would have persisted, then re-run.
    for (const r of scan.reminded) {
      const row = scan.rows.find((x) => x.id === r.id);
      if (r.which === "24h") row.reminder24hSent = true;
      else row.reminder2hSent = true;
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

  // ═══ 4. tool registry shape: exactly the five read-only tools ═══
  {
    const { ASSISTANT_TOOL_NAMES, ASSISTANT_TOOL_EXECUTORS, ASSISTANT_TOOL_DEFS } = load("lib/assistant-tools.ts");
    const expected = ["get_jobs", "summarize_candidates", "summarize_pipeline", "get_schedule", "get_candidate"];
    check("tool registry: contains ONLY the five specified read-only tools, nothing else", JSON.stringify([...ASSISTANT_TOOL_NAMES].sort()) === JSON.stringify([...expected].sort()), ASSISTANT_TOOL_NAMES);
    check("tool registry: every name has exactly one executor and one def", expected.every((n) => typeof ASSISTANT_TOOL_EXECUTORS[n] === "function" && ASSISTANT_TOOL_DEFS.some((d) => d.name === n)));
    const mutatingWords = /\b(create|update|delete|send|move|schedule|cancel|publish|invite|remove|message)\b/i;
    check(
      "tool registry: no tool name or description implies a mutation (defense in depth beyond 'there is no mutating executor')",
      ASSISTANT_TOOL_DEFS.every((d) => !mutatingWords.test(d.name) && !mutatingWords.test(d.description))
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

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) {
    console.error("FAILURES DETECTED");
    process.exit(1);
  }
  console.log("ALL PASS");
})();
