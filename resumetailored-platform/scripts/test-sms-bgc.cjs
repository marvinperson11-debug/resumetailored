#!/usr/bin/env node
/**
 * SMS + Background Checks (Kimi prompt, 2026-11-01) — npm run test:sms-bgc.
 *
 * Same TS-on-the-fly-transpile + `@/`-alias + Module._load mocking shape as
 * scripts/test-talent-pool.cjs (its sibling, not a copy): a fake Clerk
 * (auth/currentUser, for employerContext's tier check), a fake Postgres
 * (the subset of PostgREST chain calls lib/sms-store.ts, lib/sms-consent.ts,
 * lib/sms-quota.ts, lib/bgc-store.ts and lib/webhook-idempotency.ts actually
 * issue — including `.in()`, `.upsert()`, a `bump_usage_counter` RPC, and
 * real unique-constraint violations so idempotency has something real to
 * prove against), and a stubbed `fetch` standing in for Twilio/Checkr's own
 * REST APIs (both clients are raw-fetch, no SDK — see lib/twilio.ts /
 * lib/checkr.ts headers).
 *
 * Layers:
 *   1. Pure logic — exact-value assertions, no mocking, no network:
 *      lib/sms-phone.ts, lib/sms-quiet-hours.ts, lib/sms-consent.ts
 *      (classifyKeyword), lib/sms-quota.ts (capStatusFrom),
 *      lib/bgc-packages.ts, lib/adverse-action.ts.
 *   2. Store-level against the fake Postgres: consent/suppression,
 *      conversation idempotency, webhook-event idempotency (a genuine
 *      23505 unique violation vs. any other insert error), segment-cap
 *      reservation math, and the FCRA adverse-action state machine as
 *      lib/bgc-store.ts actually persists it.
 *   3. Orchestration — lib/sms-send.ts `sendCandidateSms` against every cell
 *      of the acceptance criteria's consent matrix (no phone / no consent /
 *      suppressed / quiet hours / at cap / normal send), with the stubbed
 *      Twilio API standing in for the real one.
 *   4. Route-level — the real route handlers, driven through
 *      `new Request(...)`: confirm:true gating before any candidate-facing
 *      dispatch, plan gating (free tier 402), and that the adverse-action
 *      route's wait period cannot be skipped by any request shape.
 *   5. Webhooks — Twilio inbound (STOP/START keywords, redelivery is a
 *      no-op) and the Checkr webhook (signature verification + redelivery).
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");
const crypto = require("crypto");
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

process.env.ANTHROPIC_API_KEY = "sk-ant-test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
process.env.GUEST_QUOTA_SALT = "test-only-guest-quota-salt-0123456789";
process.env.TOOLS_HASH_SALT = "test-only-tools-hash-salt-0123456789";
process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
process.env.CHECKR_API_KEY = "checkr-test-key";
process.env.CHECKR_WEBHOOK_SECRET = "checkr-webhook-secret";
delete process.env.RESEND_API_KEY;

const transpile = (mod, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  });
  mod._compile(out.outputText, filename);
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

// ── fake world: Clerk identity + a minimal Postgres w/ real unique violations ──
const state = { userId: null, tier: "free", tables: {}, counters: {} };
function resetWorld() {
  state.userId = null;
  state.tier = "free";
  state.tables = {
    applicants: [],
    job_postings: [],
    employer_settings: [],
    messaging_consents: [],
    sms_opt_outs: [],
    sms_numbers: [],
    sms_conversations: [],
    sms_messages: [],
    background_check_orders: [],
    adverse_action_events: [],
    provider_webhook_events: [],
    assistant_audit_log: [],
    usage_counters: [],
  };
  state.counters = {};
  twilioState.sentMessages.length = 0;
  twilioState.nextSendOk = true;
  twilioState.boughtNumbers = 0;
  checkrState.candidates = 0;
  checkrState.invitations = 0;
  checkrState.adverseActions.length = 0;
  checkrState.nextOk = true;
}
const twilioState = { sentMessages: [], nextSendOk: true, boughtNumbers: 0 };
const checkrState = { candidates: 0, invitations: 0, adverseActions: [], nextOk: true };
resetWorld();

let idCounter = 1;
const newId = () => `id_${idCounter++}`;

// Real Postgres timestamps never tie at this test's execution speed; `Date.now()`
// resolution does. A strictly-increasing fake clock for row `created_at` keeps
// "most recent row" queries (e.g. lib/bgc-store.ts `getAdverseActionState`'s
// `order by created_at desc limit 1`) deterministic instead of occasionally
// racing on a millisecond tie.
let fakeClockMs = Date.now();
const fakeNowIso = () => new Date((fakeClockMs += 1)).toISOString();

// Column-tuples that must be unique per table, mirroring the real migrations.
const UNIQUE_CONSTRAINTS = {
  sms_numbers: [["employer_id"]],
  employer_settings: [["employer_id"]],
  sms_conversations: [["employer_id", "applicant_id"]],
  sms_opt_outs: [["phone_normalized"]],
  provider_webhook_events: [["provider", "event_id"]],
  background_check_orders: [["checkr_report_id"]], // partial in reality (where not null) — enforced below
};

function violatesUnique(table, row, existingRows) {
  const tuples = UNIQUE_CONSTRAINTS[table] || [];
  for (const cols of tuples) {
    if (table === "background_check_orders" && (row.checkr_report_id === undefined || row.checkr_report_id === null)) continue; // partial index
    const clash = existingRows.some((r) => cols.every((c) => r[c] === row[c]));
    if (clash) return true;
  }
  return false;
}

function matches(row, filters) {
  return filters.every((f) => {
    const v = row[f.col];
    if (f.op === "eq") return v === f.val;
    if (f.op === "in") return Array.isArray(f.val) && f.val.includes(v);
    return true;
  });
}

function chainFor(table) {
  const ctx = { op: "select", filters: [], insertRows: null, updateRow: null, upsertConflict: null, order: null, limit: null, single: false, maybeSingle: false };
  const rows = () => state.tables[table] || (state.tables[table] = []);
  const exec = () => {
    if (ctx.op === "insert") {
      const all = rows();
      const prepared = ctx.insertRows.map((r) => ({ id: r.id || newId(), created_at: fakeNowIso(), updated_at: fakeNowIso(), ...r }));
      for (const r of prepared) {
        if (violatesUnique(table, r, all)) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${table}_unique"` } };
        all.push(r);
      }
      if (ctx.single) return { data: prepared[0] || null, error: prepared.length ? null : { message: "insert failed" } };
      return { data: prepared, error: null };
    }
    if (ctx.op === "upsert") {
      const all = rows();
      const conflictCols = ctx.upsertConflict ? ctx.upsertConflict.split(",").map((s) => s.trim()) : UNIQUE_CONSTRAINTS[table]?.[0] || ["id"];
      const incoming = Array.isArray(ctx.insertRows) ? ctx.insertRows : [ctx.insertRows];
      const outRows = [];
      for (const r of incoming) {
        const existing = all.find((row) => conflictCols.every((c) => row[c] === r[c]));
        if (existing) {
          Object.assign(existing, r, { updated_at: new Date().toISOString() });
          outRows.push(existing);
        } else {
          const created = { id: r.id || newId(), created_at: fakeNowIso(), ...r };
          all.push(created);
          outRows.push(created);
        }
      }
      if (ctx.single) return { data: outRows[0] || null, error: null };
      return { data: outRows, error: null };
    }
    if (ctx.op === "delete") {
      const all = rows();
      const kept = all.filter((r) => !matches(r, ctx.filters));
      const removed = all.length - kept.length;
      state.tables[table] = kept;
      return { data: removed ? [{}] : [], error: null };
    }
    if (ctx.op === "update") {
      const all = rows();
      const touched = all.filter((r) => matches(r, ctx.filters));
      touched.forEach((r) => Object.assign(r, ctx.updateRow, { updated_at: new Date().toISOString() }));
      if (ctx.single) return { data: touched[0] || null, error: touched.length ? null : { message: "not found" } };
      if (ctx.maybeSingle) return { data: touched[0] || null, error: null };
      return { data: touched, error: null };
    }
    // select
    let filtered = rows().filter((r) => matches(r, ctx.filters));
    if (ctx.order) {
      filtered = [...filtered].sort((a, b) => (ctx.order.asc ? 1 : -1) * (a[ctx.order.col] > b[ctx.order.col] ? 1 : a[ctx.order.col] < b[ctx.order.col] ? -1 : 0));
    }
    if (typeof ctx.limit === "number") filtered = filtered.slice(0, ctx.limit);
    if (ctx.single) return { data: filtered[0] || null, error: filtered[0] ? null : { message: "not found" } };
    if (ctx.maybeSingle) return { data: filtered[0] || null, error: null };
    return { data: filtered, error: null, count: filtered.length };
  };
  const builder = {
    select() {
      return builder;
    },
    eq(col, val) {
      ctx.filters.push({ op: "eq", col, val });
      return builder;
    },
    in(col, val) {
      ctx.filters.push({ op: "in", col, val });
      return builder;
    },
    order(col, opts) {
      ctx.order = { col, asc: !!opts?.ascending };
      return builder;
    },
    limit(n) {
      ctx.limit = n;
      return builder;
    },
    insert(rowsIn) {
      ctx.op = "insert";
      ctx.insertRows = Array.isArray(rowsIn) ? rowsIn : [rowsIn];
      return builder;
    },
    upsert(rowsIn, opts) {
      ctx.op = "upsert";
      ctx.insertRows = rowsIn;
      ctx.upsertConflict = opts?.onConflict || null;
      return builder;
    },
    update(patch) {
      ctx.op = "update";
      ctx.updateRow = patch;
      return builder;
    },
    delete() {
      ctx.op = "delete";
      return builder;
    },
    single() {
      ctx.single = true;
      return exec();
    },
    maybeSingle() {
      ctx.maybeSingle = true;
      return exec();
    },
    then(resolve, reject) {
      return Promise.resolve(exec()).then(resolve, reject);
    },
  };
  return builder;
}

// `bump_usage_counter` RPC — mirrors lib/usage-counter.ts's monotonic counter
// (scope_id, kind, period) -> count, atomically incremented.
function fakeRpc(fn, args) {
  if (fn === "bump_usage_counter") {
    const key = `${args.p_scope}::${args.p_kind}::${args.p_period}`;
    const next = (state.counters[key] || 0) + (args.p_by || 1);
    state.counters[key] = next;
    // lib/usage-counter.ts's getCounter reads this back with a plain SELECT
    // (scope_id, kind, period) -> count, not through the RPC — mirror the
    // bump into the table itself so a subsequent read sees it.
    const rows = state.tables.usage_counters || (state.tables.usage_counters = []);
    const row = rows.find((r) => r.scope_id === args.p_scope && r.kind === args.p_kind && r.period === args.p_period);
    if (row) row.count = next;
    else rows.push({ scope_id: args.p_scope, kind: args.p_kind, period: args.p_period, count: next });
    return Promise.resolve({ data: next, error: null });
  }
  return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } });
}

const fakeDb = { from: (table) => chainFor(table), rpc: fakeRpc };

function fakeClerkUser(id) {
  return {
    id,
    firstName: "Test",
    lastName: "Employer",
    emailAddresses: [{ emailAddress: "employer@example.com" }],
    publicMetadata: id === state.userId ? { plan: "employer", type: "organization", tier: state.tier } : {},
  };
}

// ── fake Twilio / Checkr REST APIs over `fetch` (both clients are raw-fetch) ──

async function fakeFetch(url, init = {}) {
  const u = String(url);
  if (u.includes("api.twilio.com")) {
    if (u.includes("/Messages.json")) {
      const body = new URLSearchParams(init.body);
      twilioState.sentMessages.push({ from: body.get("From"), to: body.get("To"), body: body.get("Body") });
      if (!twilioState.nextSendOk) return jsonRes(400, { code: "21211", message: "invalid number" });
      return jsonRes(201, { sid: `SM${idCounter++}`, status: "queued" });
    }
    if (u.includes("/AvailablePhoneNumbers/")) return jsonRes(200, { available_phone_numbers: [{ phone_number: "+15551234567" }] });
    if (u.includes("/IncomingPhoneNumbers.json")) {
      twilioState.boughtNumbers++;
      return jsonRes(201, { phone_number: "+15551234567", sid: `PN${idCounter++}` });
    }
  }
  if (u.includes("api.checkr.com")) {
    if (u.endsWith("/candidates")) {
      checkrState.candidates++;
      if (!checkrState.nextOk) return jsonRes(422, { error: "invalid_candidate" });
      return jsonRes(201, { id: `cand_${idCounter++}` });
    }
    if (u.endsWith("/invitations")) {
      checkrState.invitations++;
      if (!checkrState.nextOk) return jsonRes(422, { error: "invalid_invitation" });
      return jsonRes(201, { id: `inv_${idCounter++}`, invitation_url: "https://checkr.example/invite" });
    }
    if (u.endsWith("/adverse_items")) {
      checkrState.adverseActions.push(JSON.parse(init.body));
      return jsonRes(201, { id: `adv_${idCounter++}` });
    }
  }
  throw new Error(`fakeFetch: unhandled URL ${u}`);
}
function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
global.fetch = fakeFetch;

const mocks = {
  "@clerk/nextjs/server": () => ({
    auth: async () => ({ userId: state.userId }),
    currentUser: async () => (state.userId ? fakeClerkUser(state.userId) : null),
    clerkClient: async () => ({ users: { getUser: async (id) => fakeClerkUser(id) } }),
  }),
  "@supabase/supabase-js": () => ({ createClient: () => fakeDb }),
  // This harness `require()`s .ts files directly (ts.transpileModule, no webpack), so
  // the real server-only package — which throws unless loaded through Next's own
  // webpack alias for Server/Client Component separation — would crash on import
  // here. lib/twilio-webhook-verify.ts and lib/checkr-webhook-verify.ts use it;
  // mock it to a no-op, same as every other build-tool-only import above.
  "server-only": () => ({}),
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (mocks[request]) return mocks[request]();
  return origLoad.apply(this, arguments);
};

const load = (rel) => require(path.join(ROOT, rel));
const route = (rel) => load(`app/api/${rel}/route.ts`);
const URLBASE = "https://app.resumetailored.com";
const jsonReq = (body, method = "POST") => new Request(`${URLBASE}/x`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function seedApplicant(employerId, over = {}) {
  const jobId = over.jobId || (() => {
    const j = { id: idCounter++, employer_id: employerId, title: "Role" };
    state.tables.job_postings.push(j);
    return j.id;
  })();
  const a = {
    id: idCounter++,
    job_id: jobId,
    name: over.name ?? "Jamie Lee",
    email: over.email ?? "jamie@example.com",
    phone: over.phone ?? "+15551234567",
    phone_normalized: over.phoneNormalized !== undefined ? over.phoneNormalized : "+15551234567",
    resume_text: "",
    cover_letter: "",
    status: "new",
    created_at: new Date().toISOString(),
    status_changed_at: new Date().toISOString(),
    candidate_comms_optout: false,
    ack_sent_at: null,
  };
  state.tables.applicants.push(a);
  return a;
}

(async () => {
  // ═══ 1. Pure logic ═══
  {
    const phone = load("lib/sms-phone.ts");
    check("normalizePhoneE164: 10-digit", phone.normalizePhoneE164("5551234567") === "+15551234567");
    check("normalizePhoneE164: 11-digit with leading 1", phone.normalizePhoneE164("15551234567") === "+15551234567");
    check("normalizePhoneE164: already E.164", phone.normalizePhoneE164("+15551234567") === "+15551234567");
    check("normalizePhoneE164: formatted input", phone.normalizePhoneE164("(555) 123-4567") === "+15551234567");
    check("normalizePhoneE164: area code starting with 0/1 is invalid NANP", phone.normalizePhoneE164("0551234567") === null);
    check("normalizePhoneE164: too short", phone.normalizePhoneE164("12345") === null);
    check("normalizePhoneE164: empty/null", phone.normalizePhoneE164(null) === null && phone.normalizePhoneE164("") === null);
    check("areaCodeOf", phone.areaCodeOf("+15551234567") === "555");
    check("isGsm7: plain ASCII", phone.isGsm7("Hello there, reply STOP.") === true);
    check("isGsm7: CJK forces UCS-2", phone.isGsm7("你好") === false);
    const seg1 = phone.countSegments("short message");
    check("countSegments: short GSM-7 message is 1 segment", seg1.segments === 1 && seg1.encoding === "GSM-7");
    const seg160 = phone.countSegments("x".repeat(160));
    check("countSegments: exactly 160 GSM-7 chars is still 1 segment", seg160.segments === 1);
    const seg161 = phone.countSegments("x".repeat(161));
    check("countSegments: 161 GSM-7 chars rolls over to 2 segments (153-char budget per part)", seg161.segments === 2 && seg161.charsUsed === 8);
    const segUcs = phone.countSegments("你好世界");
    check("countSegments: short CJK message is 1 UCS-2 segment", segUcs.segments === 1 && segUcs.encoding === "UCS-2");
    const segUcsLong = phone.countSegments("你".repeat(70));
    check("countSegments: 70 CJK chars is 1 UCS-2 segment (70-char budget)", segUcsLong.segments === 1);
    const segUcsLonger = phone.countSegments("你".repeat(71));
    check("countSegments: 71 CJK chars rolls to 2 UCS-2 segments (67-char budget per part)", segUcsLonger.segments === 2);

    const qh = load("lib/sms-quiet-hours.ts");
    check("timezoneForPhone: known area code", qh.timezoneForPhone("+12125551234") === "America/New_York");
    check("timezoneForPhone: unknown area code falls back to Eastern (most conservative)", qh.timezoneForPhone("+19995551234") === "America/New_York");
    const quietAt3amEastern = new Date("2026-11-02T08:00:00.000Z"); // 3am EST (UTC-5 in Nov)
    check("isQuietHours: 3am Eastern is quiet", qh.isQuietHours("+12125551234", quietAt3amEastern) === true);
    const noonEastern = new Date("2026-11-02T17:00:00.000Z"); // noon EST
    check("isQuietHours: noon Eastern is not quiet", qh.isQuietHours("+12125551234", noonEastern) === false);
    const nextWindow = qh.nextSendWindow("+12125551234", quietAt3amEastern);
    check("nextSendWindow: resolves to a later, non-quiet moment", nextWindow.getTime() > quietAt3amEastern.getTime() && !qh.isQuietHours("+12125551234", nextWindow));
    check("nextSendWindow: already-open window returns the same instant", qh.nextSendWindow("+12125551234", noonEastern).getTime() === noonEastern.getTime());

    const consent = load("lib/sms-consent.ts");
    check("classifyKeyword: STOP (any case/whitespace)", consent.classifyKeyword("  Stop  ") === "stop");
    check("classifyKeyword: unsubscribe synonym", consent.classifyKeyword("unsubscribe") === "stop");
    check("classifyKeyword: START", consent.classifyKeyword("START") === "start");
    check("classifyKeyword: HELP", consent.classifyKeyword("help") === "help");
    check("classifyKeyword: 'stop' mid-sentence is NOT a keyword (exact match only)", consent.classifyKeyword("please stop texting me") === null);
    check("classifyKeyword: an ordinary reply is not a keyword", consent.classifyKeyword("Sounds good, thanks!") === null);

    const quota = load("lib/sms-quota.ts");
    const st = quota.capStatusFrom("portal", 240, 0);
    check("capStatusFrom: Portal base cap is 250/mo", st.baseLimit === 250 && st.remaining === 10 && st.atCap === false);
    const stAt = quota.capStatusFrom("portal", 250, 0);
    check("capStatusFrom: exactly at the limit is atCap", stAt.atCap === true && stAt.remaining === 0);
    const stOver = quota.capStatusFrom("scale", 950, 500);
    check("capStatusFrom: an overage pack raises the effective limit immediately", stOver.effectiveLimit === 1500 && stOver.atCap === false);
    check("SMS_MONTHLY_SEGMENTS: free tier has no SMS allowance", quota.SMS_MONTHLY_SEGMENTS.free === 0);
    check("SMS_MONTHLY_SEGMENTS: matches the build's tier table", quota.SMS_MONTHLY_SEGMENTS.portal === 250 && quota.SMS_MONTHLY_SEGMENTS.scale === 1000 && quota.SMS_MONTHLY_SEGMENTS.corporate === 5000);
    check("overage pack is $10 for 500 segments", quota.OVERAGE_PACK_SEGMENTS === 500 && quota.OVERAGE_PACK_PRICE_CENTS === 1000);

    const pkgs = load("lib/bgc-packages.ts");
    check("isValidPackageId: accepts the three real packages", pkgs.isValidPackageId("basic") && pkgs.isValidPackageId("standard") && pkgs.isValidPackageId("premium"));
    check("isValidPackageId: rejects junk", pkgs.isValidPackageId("gold") === false);
    const priced = pkgs.priceForPackage(pkgs.BGC_PACKAGES.basic);
    check("priceForPackage: Checkr cost + 15% margin, rounded to the cent", priced.priceCents === Math.round(2500 * 1.15));
    check("priceForPackage: pass-through fee is itemized separately, never folded into the price", priced.passThroughFeeCents === pkgs.BGC_PACKAGES.basic.typicalPassThroughFeeCents && priced.totalCents === priced.priceCents + priced.passThroughFeeCents);
    check("fairChanceWarning: a listed state warns", pkgs.fairChanceWarning("CA") === true);
    check("fairChanceWarning: case-insensitive / trims whitespace", pkgs.fairChanceWarning(" ca ") === true);
    check("fairChanceWarning: an unlisted state does not warn", pkgs.fairChanceWarning("TX") === false);
    check("fairChanceWarning: no state code at all does not warn", pkgs.fairChanceWarning(null) === false && pkgs.fairChanceWarning(undefined) === false);

    const aa = load("lib/adverse-action.ts");
    const mon = new Date("2026-11-02T12:00:00.000Z"); // a Monday
    const plus5bd = aa.addBusinessDays(mon, 5);
    check("addBusinessDays: 5 business days from Monday skips the weekend (lands on the next Monday)", plus5bd.getUTCDay() === 1 && plus5bd.getTime() > mon.getTime());
    const started = aa.startPreAdverse(mon);
    check("startPreAdverse: moves to 'waiting' with a wait-until in the future", started.stage === "waiting" && new Date(started.waitUntil).getTime() > mon.getTime());
    const tooSoon = aa.canSendAdverseNotice(started, mon);
    check("canSendAdverseNotice: refused before the wait elapses", tooSoon.allowed === false && tooSoon.reason === "still_waiting");
    const afterWait = new Date(new Date(started.waitUntil).getTime() + 1000);
    const nowOk = aa.canSendAdverseNotice(started, afterWait);
    check("canSendAdverseNotice: allowed once the wait has elapsed", nowOk.allowed === true);
    const neverStarted = aa.canSendAdverseNotice({ stage: "none", preAdverseSentAt: null, waitUntil: null, adverseNoticeSentAt: null }, mon);
    check("canSendAdverseNotice: refused with no pre-adverse notice at all", neverStarted.allowed === false && neverStarted.reason === "no_pre_adverse");
    const already = aa.canSendAdverseNotice({ stage: "adverse_notice_sent", preAdverseSentAt: null, waitUntil: null, adverseNoticeSentAt: mon.toISOString() }, afterWait);
    check("canSendAdverseNotice: refused once already sent (no double-send)", already.allowed === false && already.reason === "already_sent");
    const canceled = aa.canSendAdverseNotice({ stage: "canceled", preAdverseSentAt: null, waitUntil: null, adverseNoticeSentAt: null }, afterWait);
    check("canSendAdverseNotice: refused once canceled", canceled.allowed === false && canceled.reason === "canceled");
  }

  // ═══ 2. Store-level against the fake Postgres ═══
  {
    resetWorld();
    const consentLib = load("lib/sms-consent.ts");
    const a1 = seedApplicant("emp_1");
    check("recordConsent + isOptedIn: fresh consent reads back opted in", !(await consentLib.isOptedIn(a1.id)) && (await consentLib.recordConsent({ employerId: "emp_1", applicantId: a1.id, phoneNormalized: a1.phone_normalized })) && (await consentLib.isOptedIn(a1.id)));
    check("isOptedIn: an applicant with NO consent row (the entire pre-existing pool) is never opted in", (await consentLib.isOptedIn(99999)) === false);

    check("isSuppressed: a number with no opt-out row is not suppressed", (await consentLib.isSuppressed(a1.phone_normalized)) === false);
    await consentLib.recordOptOut(a1.phone_normalized);
    check("recordOptOut: suppresses immediately", (await consentLib.isSuppressed(a1.phone_normalized)) === true);
    await consentLib.recordOptOut(a1.phone_normalized); // repeat STOP
    check("recordOptOut: a repeat STOP is a harmless no-op, not a duplicate-key error", state.tables.sms_opt_outs.length === 1);
    await consentLib.recordOptIn(a1.phone_normalized);
    check("recordOptIn (START): lifts the suppression", (await consentLib.isSuppressed(a1.phone_normalized)) === false);
    check("recordOptIn: does NOT create a fresh application-time consent — the original grant still stands, unchanged", (await consentLib.isOptedIn(a1.id)) === true);

    const smsStore = load("lib/sms-store.ts");
    const conv1 = await smsStore.getOrCreateConversation("emp_1", a1.id, a1.phone_normalized);
    const conv2 = await smsStore.getOrCreateConversation("emp_1", a1.id, a1.phone_normalized);
    check("getOrCreateConversation: idempotent — a second call for the same (employer, applicant) reuses the row, never forks a second thread", conv1.id === conv2.id && state.tables.sms_conversations.length === 1);

    const wh = load("lib/webhook-idempotency.ts");
    const claim1 = await wh.claimWebhookEvent("twilio_status", "SM123:delivered");
    const claim2 = await wh.claimWebhookEvent("twilio_status", "SM123:delivered");
    check("claimWebhookEvent: first delivery claims", claim1 === "claimed");
    check("claimWebhookEvent: a RETRY of the exact same event is a genuine duplicate", claim2 === "duplicate");
    const claim3 = await wh.claimWebhookEvent("twilio_status", "SM123:sent");
    check("claimWebhookEvent: a real status PROGRESSION (different event id) is not mistaken for a duplicate", claim3 === "claimed");
    const claimOtherProvider = await wh.claimWebhookEvent("checkr", "SM123:delivered");
    check("claimWebhookEvent: the same event id under a DIFFERENT provider is not a duplicate (provider disambiguates the id space)", claimOtherProvider === "claimed");

    const quota = load("lib/sms-quota.ts");
    const r1 = await quota.reserveSegments("emp_2", "portal", 200);
    check("reserveSegments: a reservation within the cap succeeds and consumes exactly the segments used", r1.reserved === true && r1.status.used === 200);
    const r2 = await quota.reserveSegments("emp_2", "portal", 60); // 200 + 60 = 260 > 250
    check("reserveSegments: a reservation that would exceed the cap is refused and consumes NOTHING (soft cap, never a double-count)", r2.reserved === false && r2.status.used === 200);
    const overaged = await quota.purchaseOveragePack("emp_2", "portal");
    check("purchaseOveragePack: raises the effective cap by exactly one pack (+500) immediately", overaged.effectiveLimit === 750);
    const r3 = await quota.reserveSegments("emp_2", "portal", 60);
    check("reserveSegments: the same send that was just refused now fits, after the overage purchase", r3.reserved === true && r3.status.used === 260);

    const bgc = load("lib/bgc-store.ts");
    const emp3 = seedApplicant("emp_3");
    checkrState.nextOk = true;
    const order = await bgc.createOrder({
      employerId: "emp_3",
      applicantId: emp3.id,
      packageId: "basic",
      orderedBy: "user_1",
      candidateFirstName: "Jamie",
      candidateLastName: "Lee",
      candidateEmail: emp3.email,
      candidatePhone: emp3.phone_normalized,
      candidateStateCode: "CA",
      billingMode: "per_check",
    });
    check("createOrder: a successful order lands as invitation_sent with the right price (Checkr cost + 15%)", order.ok === true && order.order.status === "invitation_sent" && order.order.priceCents === Math.round(2500 * 1.15));
    check("createOrder: fair-chance warning is set for a listed state", order.order.fairChanceWarning === true);
    check("createOrder: audits both bgc.ordered and bgc.invitation_sent", state.tables.assistant_audit_log.some((r) => r.action === "bgc.ordered") && state.tables.assistant_audit_log.some((r) => r.action === "bgc.invitation_sent"));
    check("createOrder: zero PII beyond name/email/phone ever reaches the order row (no ssn/dob columns)", !("ssn" in order.order) && !("dob" in order.order));

    const pre = await bgc.startPreAdverseAction(order.order, "user_1", null, new Date("2026-11-02T12:00:00.000Z"));
    check("startPreAdverseAction: sends the pre-adverse notice and starts the wait", pre.ok === true);
    const dup = await bgc.startPreAdverseAction(order.order, "user_1", null);
    check("startPreAdverseAction: refuses to start a second time for the same order", dup.ok === false && dup.error === "already_started");
    const early = await bgc.sendAdverseNoticeAction(order.order, "user_1", null, new Date("2026-11-03T12:00:00.000Z"));
    check("sendAdverseNoticeAction: CANNOT skip the waiting period — refused the next day, one business day in", early.ok === false && early.error === "still_waiting");
    check("sendAdverseNoticeAction: a refused attempt is still audited (adverse_action.blocked)", state.tables.assistant_audit_log.some((r) => r.action === "adverse_action.blocked"));
    const afterWaitState = await bgc.getAdverseActionState(order.order.id);
    const late = await bgc.sendAdverseNoticeAction(order.order, "user_1", null, new Date(new Date(afterWaitState.waitUntil).getTime() + 60000));
    check("sendAdverseNoticeAction: allowed once the wait has genuinely elapsed", late.ok === true);
    const finalState = await bgc.getAdverseActionState(order.order.id);
    check("getAdverseActionState: reflects the completed flow", finalState.stage === "adverse_notice_sent");
  }

  // ═══ 3. Orchestration — lib/sms-send.ts across the consent matrix ═══
  {
    resetWorld();
    const send = load("lib/sms-send.ts");
    const consentLib = load("lib/sms-consent.ts");
    const smsStore = load("lib/sms-store.ts");

    const noPhoneApplicant = seedApplicant("emp_a", { phoneNormalized: null });
    const r1 = await send.sendCandidateSms({ employerId: "emp_a", tier: "portal", employerDisplayName: "Acme", actorUserId: "u1", applicantId: noPhoneApplicant.id, body: "hi" });
    check("sendCandidateSms: no phone on file -> refused, nothing queued, nothing sent", r1.ok === false && r1.deniedReason === "no_phone" && twilioState.sentMessages.length === 0);

    const noConsentApplicant = seedApplicant("emp_a"); // seeded with a real phone but NO consent row — the entire pre-existing pool's exact shape
    const r2 = await send.sendCandidateSms({ employerId: "emp_a", tier: "portal", employerDisplayName: "Acme", actorUserId: "u1", applicantId: noConsentApplicant.id, body: "hi" });
    check("sendCandidateSms: no consent row (every pre-existing applicant) -> refused, no send", r2.ok === false && r2.deniedReason === "no_consent");

    await smsStore.saveSmsNumber("emp_a", "+15559998888", "PNtest");
    const consentedApplicant = seedApplicant("emp_a", { phoneNormalized: "+15552223333" });
    await consentLib.recordConsent({ employerId: "emp_a", applicantId: consentedApplicant.id, phoneNormalized: consentedApplicant.phone_normalized });

    await consentLib.recordOptOut(consentedApplicant.phone_normalized);
    const r3 = await send.sendCandidateSms({ employerId: "emp_a", tier: "portal", employerDisplayName: "Acme", actorUserId: "u1", applicantId: consentedApplicant.id, body: "hi" });
    check("sendCandidateSms: suppressed (STOP) overrides an existing opt-in -> refused", r3.ok === false && r3.deniedReason === "suppressed");
    await consentLib.recordOptIn(consentedApplicant.phone_normalized);

    const quietAt3amEastern = new Date("2026-11-02T08:00:00.000Z");
    const r4 = await send.sendCandidateSms({ employerId: "emp_a", tier: "portal", employerDisplayName: "Acme", actorUserId: "u1", applicantId: consentedApplicant.id, body: "hi", now: quietAt3amEastern });
    check("sendCandidateSms: quiet hours for the recipient -> QUEUED, not refused, not sent yet", r4.ok === true && r4.queued === true && r4.queueReason === "quiet_hours" && twilioState.sentMessages.length === 0);

    const noonEastern = new Date("2026-11-02T17:00:00.000Z");
    twilioState.sentMessages.length = 0;
    const r5 = await send.sendCandidateSms({ employerId: "emp_a", tier: "portal", employerDisplayName: "Acme", actorUserId: "u1", applicantId: consentedApplicant.id, body: "Thanks for applying!", now: noonEastern });
    check("sendCandidateSms: normal send during open hours, under cap -> sent via Twilio", r5.ok === true && r5.queued === false && twilioState.sentMessages.length === 1);
    check("sendCandidateSms: the FIRST outbound message in a thread carries the employer name + STOP disclosure", twilioState.sentMessages[0].body.includes("Acme") && twilioState.sentMessages[0].body.includes("Reply STOP to opt out"));

    twilioState.sentMessages.length = 0;
    const r6 = await send.sendCandidateSms({ employerId: "emp_a", tier: "portal", employerDisplayName: "Acme", actorUserId: "u1", applicantId: consentedApplicant.id, body: "Following up", now: noonEastern });
    check("sendCandidateSms: the SECOND outbound message in the thread is plain (no repeated employer-name/STOP boilerplate)", r6.ok === true && !twilioState.sentMessages[0].body.includes("Reply STOP to opt out"));

    const quota = load("lib/sms-quota.ts");
    const preCapStatus = await quota.getSmsCapStatus("emp_a", "portal", noonEastern);
    await quota.reserveSegments("emp_a", "portal", preCapStatus.remaining); // top up to exactly the Portal cap for this cycle
    twilioState.sentMessages.length = 0;
    const r7 = await send.sendCandidateSms({ employerId: "emp_a", tier: "portal", employerDisplayName: "Acme", actorUserId: "u1", applicantId: consentedApplicant.id, body: "Are you still interested?", now: noonEastern });
    check("sendCandidateSms: at cap -> QUEUED (soft cap never hard-blocks a live conversation), nothing sent to Twilio", r7.ok === true && r7.queued === true && r7.queueReason === "cap" && twilioState.sentMessages.length === 0);
    check("sendCandidateSms: a cap-queue event is audited (sms.cap_warning)", state.tables.assistant_audit_log.some((r) => r.action === "sms.cap_warning"));

    // Overage purchase must restore sending immediately, via the queue-flush path.
    const flush = load("lib/sms-queue-flush.ts");
    await quota.purchaseOveragePack("emp_a", "portal");
    const flushResult = await flush.flushQueuedForEmployer("emp_a", noonEastern);
    check("flushQueuedForEmployer: the cap-queued message sends immediately once the overage pack lifts the cap", flushResult.sent >= 1 && twilioState.sentMessages.length >= 1);
  }

  // ═══ 4. Route-level ═══
  {
    resetWorld();
    state.userId = "emp_route_1";
    state.tier = "free";

    const numbersRoute = route("employer/sms/numbers");
    const resFree = await numbersRoute.GET();
    check("GET /employer/sms/numbers: Free tier is gated (402 plan_required) — SMS is hidden, not half-working", resFree.status === 402);

    state.tier = "portal";
    const smsRoute = route("employer/sms/applicants/[applicantId]/messages");
    const applicant = seedApplicant("emp_route_1");
    const resNoConfirm = await smsRoute.POST(jsonReq({ body: "hello" }), { params: { applicantId: String(applicant.id) } });
    check("POST .../messages: missing confirm:true is refused BEFORE consent/suppression/quota ever run", resNoConfirm.status === 400 && (await resNoConfirm.json()).error === "confirmation_required");
    check("POST .../messages: an unconfirmed request never reaches Twilio", twilioState.sentMessages.length === 0);

    const bgcRoute = route("employer/background-checks");
    const resBgcNoConfirm = await bgcRoute.POST(jsonReq({ applicantId: applicant.id, packageId: "basic" }));
    check("POST /employer/background-checks: missing confirm:true is refused before Checkr is ever called", resBgcNoConfirm.status === 400 && (await resBgcNoConfirm.json()).error === "confirmation_required");
    check("POST /employer/background-checks: an unconfirmed order never creates a Checkr candidate", checkrState.candidates === 0);

    checkrState.nextOk = true;
    const resBgcOrder = await bgcRoute.POST(jsonReq({ applicantId: applicant.id, packageId: "basic", candidateStateCode: "NY", confirm: true }));
    const bgcOrderBody = await resBgcOrder.json();
    check("POST /employer/background-checks: a confirmed order succeeds", resBgcOrder.status === 200 && bgcOrderBody.ok === true);

    // Adverse action: reachable on Portal (the lowest paid tier), and the wait period cannot be skipped by any request shape — confirm:true included.
    const adverseRoute = route("employer/background-checks/[id]/adverse-action");
    const resStart = await adverseRoute.POST(jsonReq({ action: "start_pre_adverse", confirm: true }), { params: { id: bgcOrderBody.order.id } });
    check("POST .../adverse-action: Portal tier can start the FCRA flow (not Scale/Corporate-only)", resStart.status === 200);
    const resSkip = await adverseRoute.POST(jsonReq({ action: "send_adverse_notice", confirm: true }), { params: { id: bgcOrderBody.order.id } });
    check("POST .../adverse-action: send_adverse_notice with confirm:true STILL cannot skip the wait — the check runs after confirmation, not instead of it", resSkip.status === 409 && (await resSkip.json()).error === "still_waiting");

    // Free tier cannot even reach the adverse-action route.
    state.tier = "free";
    const resFreeAdverse = await adverseRoute.POST(jsonReq({ action: "start_pre_adverse", confirm: true }), { params: { id: bgcOrderBody.order.id } });
    check("POST .../adverse-action: Free tier is refused the same way ordering itself is (402) — not a separate, higher floor", resFreeAdverse.status === 402);
    state.tier = "portal";
  }

  // ═══ 5. Webhooks ═══
  {
    resetWorld();
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    const emp = "emp_webhook_1";
    const smsStore = load("lib/sms-store.ts");
    await smsStore.saveSmsNumber(emp, "+15559998888", "PNtest");
    const applicant = seedApplicant(emp, { phoneNormalized: "+15552223333" });

    function signedTwilioForm(url, params) {
      const body = new URLSearchParams(params).toString();
      const signature = crypto
        .createHmac("sha1", authToken)
        .update(Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url), "utf8")
        .digest("base64");
      return { body, signature };
    }

    const inboundRoute = route("webhooks/twilio-inbound-webhook");
    const stopUrl = `${URLBASE}/api/webhooks/twilio-inbound-webhook`;
    const stopParams = { MessageSid: "SMstop1", From: "+15552223333", To: "+15559998888", Body: "STOP" };
    const stopSigned = signedTwilioForm(stopUrl, stopParams);
    const resStop = await inboundRoute.POST(new Request(stopUrl, { method: "POST", headers: { "x-twilio-signature": stopSigned.signature, "content-type": "application/x-www-form-urlencoded" }, body: stopSigned.body }));
    check("Twilio inbound webhook: a correctly-signed STOP suppresses the number", resStop.status === 200 && state.tables.sms_opt_outs.some((r) => r.phone_normalized === "+15552223333"));

    const badSigned = { body: stopSigned.body, signature: "garbage" };
    const resBadSig = await inboundRoute.POST(new Request(stopUrl, { method: "POST", headers: { "x-twilio-signature": badSigned.signature, "content-type": "application/x-www-form-urlencoded" }, body: badSigned.body }));
    check("Twilio inbound webhook: an invalid signature is refused (401), never processed", resBadSig.status === 401);

    const suppressedCountBefore = state.tables.sms_opt_outs.length;
    const resStopRetry = await inboundRoute.POST(new Request(stopUrl, { method: "POST", headers: { "x-twilio-signature": stopSigned.signature, "content-type": "application/x-www-form-urlencoded" }, body: stopSigned.body }));
    check("Twilio inbound webhook: a RETRY of the same MessageSid is a no-op (idempotent), not double-processed", resStopRetry.status === 200 && state.tables.sms_opt_outs.length === suppressedCountBefore);

    const startParams = { MessageSid: "SMstart1", From: "+15552223333", To: "+15559998888", Body: "START" };
    const startSigned = signedTwilioForm(stopUrl, startParams);
    const resStart = await inboundRoute.POST(new Request(stopUrl, { method: "POST", headers: { "x-twilio-signature": startSigned.signature, "content-type": "application/x-www-form-urlencoded" }, body: startSigned.body }));
    check("Twilio inbound webhook: a correctly-signed START lifts the suppression", resStart.status === 200 && !state.tables.sms_opt_outs.some((r) => r.phone_normalized === "+15552223333"));

    const msgParams = { MessageSid: "SMmsg1", From: "+15552223333", To: "+15559998888", Body: "Sounds great, see you then!" };
    const msgSigned = signedTwilioForm(stopUrl, msgParams);
    const resMsg = await inboundRoute.POST(new Request(stopUrl, { method: "POST", headers: { "x-twilio-signature": msgSigned.signature, "content-type": "application/x-www-form-urlencoded" }, body: msgSigned.body }));
    check("Twilio inbound webhook: an ordinary reply from a known candidate is routed into that candidate's thread", resMsg.status === 200 && state.tables.sms_messages.some((m) => m.body === "Sounds great, see you then!" && m.direction === "inbound"));

    const statusRoute = route("webhooks/twilio-status-webhook");
    const sentRow = await (async () => {
      const conv = await smsStore.getOrCreateConversation(emp, applicant.id, applicant.phone_normalized);
      return smsStore.createMessage({ conversationId: conv.id, employerId: emp, direction: "outbound", body: "hi", segments: 1, status: "sent", providerMessageSid: "SMstatus1" });
    })();
    const statusUrl = `${URLBASE}/api/webhooks/twilio-status-webhook`;
    const statusParams = { MessageSid: "SMstatus1", MessageStatus: "delivered" };
    const statusSigned = signedTwilioForm(statusUrl, statusParams);
    const resStatus = await statusRoute.POST(new Request(statusUrl, { method: "POST", headers: { "x-twilio-signature": statusSigned.signature, "content-type": "application/x-www-form-urlencoded" }, body: statusSigned.body }));
    check("Twilio status webhook: a delivered callback updates the message status", resStatus.status === 200 && state.tables.sms_messages.find((m) => m.id === sentRow.id).status === "delivered");
    const resStatusRetry = await statusRoute.POST(new Request(statusUrl, { method: "POST", headers: { "x-twilio-signature": statusSigned.signature, "content-type": "application/x-www-form-urlencoded" }, body: statusSigned.body }));
    check("Twilio status webhook: a retry of the exact same (sid, status) pair is idempotent", resStatusRetry.status === 200);

    // Checkr webhook signature + idempotency.
    const checkrRoute = route("webhooks/checkr-webhook");
    const bgc = load("lib/bgc-store.ts");
    const checkrOrder = await bgc.createOrder({ employerId: emp, applicantId: applicant.id, packageId: "basic", orderedBy: "u1", candidateFirstName: "Jamie", candidateLastName: "Lee", candidateEmail: "jamie@example.com", billingMode: "per_check" });
    const reportEvent = { id: "evt_report_1", type: "report.completed", data: { object: { id: "report_1", invitation_id: checkrOrder.order.checkrInvitationId, status: "clear", result: "clear" } } };
    const raw = JSON.stringify(reportEvent);
    const sig = crypto.createHmac("sha256", process.env.CHECKR_WEBHOOK_SECRET).update(raw, "utf8").digest("hex");
    const resCheckr = await checkrRoute.POST(new Request(`${URLBASE}/api/webhooks/checkr-webhook`, { method: "POST", headers: { "x-checkr-signature": sig }, body: raw }));
    check("Checkr webhook: a correctly-signed report.completed event updates the order to completed/clear", resCheckr.status === 200 && (await bgc.getOrder(emp, checkrOrder.order.id)).status === "completed");
    const resCheckrBadSig = await checkrRoute.POST(new Request(`${URLBASE}/api/webhooks/checkr-webhook`, { method: "POST", headers: { "x-checkr-signature": "garbage" }, body: raw }));
    check("Checkr webhook: an invalid signature is refused (401)", resCheckrBadSig.status === 401);
    const resCheckrRetry = await checkrRoute.POST(new Request(`${URLBASE}/api/webhooks/checkr-webhook`, { method: "POST", headers: { "x-checkr-signature": sig }, body: raw }));
    check("Checkr webhook: a retry of the exact same event id is idempotent (no second audit entry)", resCheckrRetry.status === 200 && state.tables.assistant_audit_log.filter((r) => r.action === "bgc.status_changed").length === 1);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
})().catch((e) => {
  console.error("UNCAUGHT", e);
  process.exit(1);
});
