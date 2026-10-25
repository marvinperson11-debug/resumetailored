#!/usr/bin/env node
/**
 * GA4 free_claim_started / free_claim_completed (npm run test:ga4-free-claim).
 *
 * Mirrors the legacy test/ga4-events.js harness (payload shape, dedupe,
 * retry-after-failure, env guard) adapted to this app's own lib/ga4-events.ts,
 * which dedupes against Supabase `ga4_processed_events` (migration 0070)
 * instead of legacy's SQLite `usage_store`. Supabase is faked in-process —
 * an insert simulates the table's real UNIQUE (user_id, event_name) index by
 * rejecting a second insert for the same pair with a Postgres 23505 error,
 * and a delete removes matching rows — so this drives every claim/release
 * path without a network call.
 *
 * Also source-scans app/api/employer/claim-free/route.ts to confirm the two
 * trackers are actually wired in at the right points and fire-and-forget
 * (never awaited), the same wiring check test/ga4-events.js runs against
 * server.js for the legacy webhooks.
 */
const fs = require("fs");
const path = require("path");
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

require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(out.outputText, filename);
};

// ── fake Supabase: an in-memory table with a real UNIQUE(user_id, event_name) index ──
function makeFakeDb() {
  const rows = []; // { user_id, event_name }
  const existsIdx = (user_id, event_name) => rows.findIndex((r) => r.user_id === user_id && r.event_name === event_name);

  function chainFor(op, row) {
    const filters = [];
    const exec = () => {
      if (op === "insert") {
        const idx = existsIdx(row.user_id, row.event_name);
        if (idx !== -1) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "ga4_processed_events_user_event_idx"' } };
        }
        rows.push({ ...row });
        return { data: [row], error: null };
      }
      if (op === "delete") {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (filters.every((f) => rows[i][f.col] === f.val)) rows.splice(i, 1);
        }
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };
    const p = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (resolve, reject) => { try { resolve(exec()); } catch (e) { reject(e); } };
          if (prop === "eq") return (col, val) => { filters.push({ col, val }); return p; };
          return () => p;
        },
      }
    );
    return p;
  }

  return {
    from(table) {
      if (table !== "ga4_processed_events") throw new Error("unexpected table " + table);
      return {
        insert(row) { return chainFor("insert", row); },
        delete() { return chainFor("delete", null); },
      };
    },
    _rows: rows,
  };
}

const Module = require("module");
let currentFakeDb = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@supabase/supabase-js") {
    return { createClient: () => currentFakeDb };
  }
  return origLoad.apply(this, arguments);
};

function loadGa4Events() {
  delete require.cache[require.resolve(path.join(ROOT, "lib/ga4-events.ts"))];
  return require(path.join(ROOT, "lib/ga4-events.ts"));
}

const SUPABASE_ENV = { NEXT_PUBLIC_SUPABASE_URL: "http://supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-role-test" };
const GA4_ENV = { GA4_API_SECRET: "sek", GA4_CLIENT_SALT: "pepper" };
const QUIET_LOG = { log() {}, error() {} };

(async () => {
  // lib/ga4-events.ts caches its Supabase client at module scope (`cachedDb`),
  // same pattern as lib/welcome-email.ts — reload the module per section so
  // each section's fake DB is picked up fresh.

  // ── client_id scheme: EXACT legacy scheme, stable, salted, pseudonymous ──
  {
    currentFakeDb = makeFakeDb();
    const { ga4ClientId } = loadGa4Events();
    const crypto = require("crypto");
    const expected = crypto.createHash("sha256").update("pepper:user_abc").digest("hex").slice(0, 32);
    check("client_id matches sha256(salt + ':' + seed) truncated to 32 hex — the exact legacy scheme", ga4ClientId("user_abc", { GA4_CLIENT_SALT: "pepper" }) === expected);
    check("client_id is deterministic for the same seed+salt", ga4ClientId("user_1", { GA4_CLIENT_SALT: "a" }) === ga4ClientId("user_1", { GA4_CLIENT_SALT: "a" }));
    check("client_id changes with the seed (two users never collide)", ga4ClientId("user_1", { GA4_CLIENT_SALT: "a" }) !== ga4ClientId("user_2", { GA4_CLIENT_SALT: "a" }));
    check("client_id is 32 hex chars and never contains the raw Clerk id", /^[0-9a-f]{32}$/.test(ga4ClientId("user_abc", { GA4_CLIENT_SALT: "pepper" })) && !ga4ClientId("user_abc", { GA4_CLIENT_SALT: "pepper" }).includes("user_abc"));
  }

  // ── payload shape: measurement_id/api_secret in URL, timestamp present, params correct ──
  {
    currentFakeDb = makeFakeDb();
    const { trackFreeClaimStarted, ga4ClientId } = loadGa4Events();
    const calls = [];
    const fetchImpl = async (u, o) => { calls.push({ u, o }); return { status: 204 }; };
    const r = await trackFreeClaimStarted({ userId: "user_shape" }, { env: { ...SUPABASE_ENV, ...GA4_ENV }, fetchImpl, log: QUIET_LOG });
    check("free_claim_started sends on first call", r.sent && calls.length === 1);
    const url = calls[0].u;
    check("URL carries measurement_id and api_secret", /measurement_id=G-JWC76X5X68/.test(url) && /api_secret=sek/.test(url), url);
    const body = JSON.parse(calls[0].o.body);
    check("body carries a timestamp_micros", typeof body.timestamp_micros === "number" && body.timestamp_micros > 0);
    check("client_id is the salted hash, not the raw Clerk userId", body.client_id === ga4ClientId("user_shape", GA4_ENV) && body.client_id !== "user_shape");
    check("user_id mirrors client_id", body.user_id === body.client_id);
    check("event name is free_claim_started", body.events[0].name === "free_claim_started");
    check("params: claim_source=employer_free, plan=free, no monetary value", body.events[0].params.claim_source === "employer_free" && body.events[0].params.plan === "free" && body.events[0].params.value === undefined);
  }

  // ── started: first call fires; immediate double-submit does not ──
  {
    currentFakeDb = makeFakeDb();
    const { trackFreeClaimStarted } = loadGa4Events();
    const calls = [];
    const fetchImpl = async (u, o) => { calls.push({ u, o }); return { status: 204 }; };
    const env = { ...SUPABASE_ENV, ...GA4_ENV };

    const r1 = await trackFreeClaimStarted({ userId: "user_double" }, { env, fetchImpl, log: QUIET_LOG });
    check("first free_claim_started fires", r1.sent && calls.length === 1);

    const r2 = await trackFreeClaimStarted({ userId: "user_double" }, { env, fetchImpl, log: QUIET_LOG });
    check("an immediate second call (double-submit) fires nothing", !r2.sent && r2.reason === "duplicate" && calls.length === 1);

    check("exactly one dedupe row exists for this user+event", currentFakeDb._rows.filter((r) => r.user_id === "user_double" && r.event_name === "free_claim_started").length === 1);
  }

  // ── completed: success path fires; forced failure fires nothing; replay after success never refires ──
  {
    currentFakeDb = makeFakeDb();
    const { trackFreeClaimCompleted } = loadGa4Events();
    const env = { ...SUPABASE_ENV, ...GA4_ENV };

    // Forced failure (simulated MP 500): fires nothing, and leaves no dedupe row (re-fireable).
    const failCalls = [];
    const failFetch = async (u, o) => { failCalls.push({ u, o }); return { status: 500 }; };
    const rFail = await trackFreeClaimCompleted({ userId: "user_complete" }, { env, fetchImpl: failFetch, log: QUIET_LOG });
    check("a forced-failure MP send fires nothing (sent:false)", !rFail.sent && rFail.reason === "send_failed");
    check("the failed send still reached the MP endpoint once", failCalls.length === 1);
    check("a failed send leaves the dedupe row absent (re-fireable)", currentFakeDb._rows.filter((r) => r.user_id === "user_complete" && r.event_name === "free_claim_completed").length === 0);

    // Success path: fires, and the row is now present.
    const okCalls = [];
    const okFetch = async (u, o) => { okCalls.push({ u, o }); return { status: 204 }; };
    const rOk = await trackFreeClaimCompleted({ userId: "user_complete" }, { env, fetchImpl: okFetch, log: QUIET_LOG });
    check("the success path fires free_claim_completed", rOk.sent && okCalls.length === 1);
    check("event name is free_claim_completed with the right params", JSON.parse(okCalls[0].o.body).events[0].name === "free_claim_completed" && JSON.parse(okCalls[0].o.body).events[0].params.claim_source === "employer_free");
    check("the dedupe row is now present (MP returned 2xx)", currentFakeDb._rows.filter((r) => r.user_id === "user_complete" && r.event_name === "free_claim_completed").length === 1);

    // Replay after success: never refires.
    const replayCalls = [];
    const replayFetch = async (u, o) => { replayCalls.push({ u, o }); return { status: 204 }; };
    const rReplay = await trackFreeClaimCompleted({ userId: "user_complete" }, { env, fetchImpl: replayFetch, log: QUIET_LOG });
    check("a replay after a prior success never refires", !rReplay.sent && rReplay.reason === "duplicate" && replayCalls.length === 0);
  }

  // ── started and completed are independently dedupe-keyed for the same user ──
  {
    currentFakeDb = makeFakeDb();
    const { trackFreeClaimStarted, trackFreeClaimCompleted } = loadGa4Events();
    const calls = [];
    const fetchImpl = async (u, o) => { calls.push({ u, o }); return { status: 204 }; };
    const env = { ...SUPABASE_ENV, ...GA4_ENV };

    await trackFreeClaimStarted({ userId: "user_both" }, { env, fetchImpl, log: QUIET_LOG });
    const rCompleted = await trackFreeClaimCompleted({ userId: "user_both" }, { env, fetchImpl, log: QUIET_LOG });
    check("completed fires independently of started's own dedupe key (same user, different event)", rCompleted.sent && calls.length === 2);
  }

  // ── env guard: GA4 unset -> no throw, no call, no dedupe row written ──
  {
    currentFakeDb = makeFakeDb();
    const { trackFreeClaimStarted } = loadGa4Events();
    const calls = [];
    const fetchImpl = async (u, o) => { calls.push({ u, o }); return { status: 204 }; };
    const r = await trackFreeClaimStarted({ userId: "user_noga4" }, { env: { ...SUPABASE_ENV }, fetchImpl, log: QUIET_LOG });
    check("missing GA4_API_SECRET -> unconfigured, no MP call, no throw", r.sent === false && r.reason === "unconfigured" && calls.length === 0);
  }

  // ── env guard: Supabase unset -> best-effort send still happens, no throw, no dedupe possible ──
  {
    currentFakeDb = makeFakeDb(); // never touched: createClient() is never called without Supabase env
    const { trackFreeClaimStarted } = loadGa4Events();
    const calls = [];
    const fetchImpl = async (u, o) => { calls.push({ u, o }); return { status: 204 }; };
    const r = await trackFreeClaimStarted({ userId: "user_nosupabase" }, { env: { ...GA4_ENV }, fetchImpl, log: QUIET_LOG });
    check("missing Supabase env never throws and still sends (best-effort, no dedupe)", r.sent === true);
  }

  // ── invalid input: no userId is rejected before any dedupe write or network call ──
  {
    currentFakeDb = makeFakeDb();
    const { trackFreeClaimStarted, trackFreeClaimCompleted } = loadGa4Events();
    const calls = [];
    const fetchImpl = async (u, o) => { calls.push({ u, o }); return { status: 204 }; };
    const env = { ...SUPABASE_ENV, ...GA4_ENV };
    const r1 = await trackFreeClaimStarted({ userId: "" }, { env, fetchImpl, log: QUIET_LOG });
    const r2 = await trackFreeClaimCompleted({ userId: undefined }, { env, fetchImpl, log: QUIET_LOG });
    check("an empty/missing userId is rejected before any write or network call", !r1.sent && r1.reason === "invalid_event" && !r2.sent && r2.reason === "invalid_event" && calls.length === 0);
  }

  // ── wired into app/api/employer/claim-free/route.ts at the right points, fire-and-forget ──
  {
    const route = fs.readFileSync(path.join(ROOT, "app/api/employer/claim-free/route.ts"), "utf8");
    check("the route imports both trackers from lib/ga4-events", /trackFreeClaimStarted/.test(route) && /trackFreeClaimCompleted/.test(route));

    const authCheckIdx = route.indexOf('"not_signed_in"');
    const startedIdx = route.indexOf("trackFreeClaimStarted(");
    const accessIdx = route.indexOf("await getAccess()");
    check("free_claim_started fires after the auth check but before getAccess()/any further processing", authCheckIdx > -1 && startedIdx > authCheckIdx && startedIdx < accessIdx);
    check("trackFreeClaimStarted is not awaited (fire-and-forget)", !/await\s+trackFreeClaimStarted\(/.test(route));

    const metadataWriteIdx = route.indexOf("updateUserMetadata(");
    const completedIdx = route.indexOf("trackFreeClaimCompleted(");
    const okReturnIdx = route.indexOf('{ ok: true }');
    check("free_claim_completed fires after the metadata write commits and before the ok:true response", metadataWriteIdx > -1 && completedIdx > metadataWriteIdx && completedIdx < okReturnIdx);
    check("trackFreeClaimCompleted is not awaited (fire-and-forget)", !/await\s+trackFreeClaimCompleted\(/.test(route));

    // Negative control: completed must NOT be reachable from the alreadyEmployer
    // no-op or the confirm-required reprompt (both return before the try block).
    const alreadyEmployerReturnIdx = route.indexOf("alreadyEmployer: true");
    const confirmRequiredIdx = route.indexOf('"confirm_required"');
    check("the alreadyEmployer no-op returns before the metadata write / completed call", alreadyEmployerReturnIdx > -1 && alreadyEmployerReturnIdx < metadataWriteIdx && alreadyEmployerReturnIdx < completedIdx);
    check("the confirm-required reprompt returns before the metadata write / completed call", confirmRequiredIdx > -1 && confirmRequiredIdx < metadataWriteIdx && confirmRequiredIdx < completedIdx);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
