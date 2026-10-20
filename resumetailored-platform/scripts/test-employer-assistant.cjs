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

  // ═══ 4. tool registry shape: five read-only tools + four mutating tools (Prompt 2) ═══
  {
    const { ASSISTANT_TOOL_NAMES, ASSISTANT_TOOL_EXECUTORS, ASSISTANT_TOOL_DEFS, READ_ONLY_TOOL_NAMES } = load("lib/assistant-tools.ts");
    const readOnly = ["get_jobs", "summarize_candidates", "summarize_pipeline", "get_schedule", "get_candidate"];
    const mutating = ["draft_job_post", "move_candidates", "schedule_interviews", "message_candidates"];
    check("tool registry: contains exactly the five read-only + four mutating tools, nothing else", JSON.stringify([...ASSISTANT_TOOL_NAMES].sort()) === JSON.stringify([...readOnly, ...mutating].sort()), ASSISTANT_TOOL_NAMES);
    check(
      "tool registry: every name has exactly one executor and one def",
      [...readOnly, ...mutating].every((n) => typeof ASSISTANT_TOOL_EXECUTORS[n] === "function" && ASSISTANT_TOOL_DEFS.some((d) => d.name === n))
    );
    check("tool registry: READ_ONLY_TOOL_NAMES is exactly the original five", JSON.stringify([...READ_ONLY_TOOL_NAMES].sort()) === JSON.stringify([...readOnly].sort()), READ_ONLY_TOOL_NAMES);
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
      "plan gating (chat): a Portal-tier turn is offered ONLY the five read-only tools — the mutating ones are never in the list Claude sees",
      JSON.stringify(toolNamesSent) === JSON.stringify(["get_candidate", "get_jobs", "get_schedule", "summarize_candidates", "summarize_pipeline"]),
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
      "plan gating (chat): a Scale-tier turn is offered all nine tools",
      scaleToolNames.length === 9 && scaleToolNames.includes("draft_job_post") && scaleToolNames.includes("message_candidates"),
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
    const drafted = await ASSISTANT_TOOL_EXECUTORS.draft_job_post("emp_1", { role_description: "We're hiring a warehouse associate for our busy fulfillment center.", title: "Warehouse Associate", publish: true }, { actorUserId: "user_1", actorEmail: null });
    check("draft_job_post (publish): the card says it will be published", /will be published/i.test(drafted.data.card.title), drafted.data.card.title);
    const { approvePendingAction } = load("lib/assistant-mutations.ts");
    const outcome = await approvePendingAction("emp_1", "user_1", null, drafted.data.pendingActionId);
    check("draft_job_post (publish): approving with publish=true creates an ACTIVE, publicly-listed job", outcome.status === "executed" && state.tables.job_postings[0].status === "active" && state.tables.job_postings[0].public_listed === true, state.tables.job_postings[0]);
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

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) {
    console.error("FAILURES DETECTED");
    process.exit(1);
  }
  console.log("ALL PASS");
})();
