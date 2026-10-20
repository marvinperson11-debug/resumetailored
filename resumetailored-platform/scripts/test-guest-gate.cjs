#!/usr/bin/env node
/**
 * Signed-out free tier (npm run test:guest-gate).
 *
 * Drives the REAL route handlers and the REAL middleware at the Request -> Response boundary
 * — the same functions Next calls — with the three outside things faked:
 *   - Clerk: `auth()` / `currentUser()` answer from `state.userId` (null = a guest). The route
 *     matcher is Clerk's own `createRouteMatcher`, so the middleware matrix tests real matching.
 *   - Anthropic: a recording fake (no network); it can fail on demand.
 *   - Supabase: an in-memory store whose three guest RPCs mirror supabase/migrations/0048 line
 *     for line (that SQL was exercised against Postgres 16 separately, including a 30-way race
 *     for the last slot — see the PR).
 * Everything else — lib/guest.ts, lib/rate-limit.ts, lib/client-ip.ts, lib/plan.ts, the prompt
 * builders, every route — is the code that ships.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");

// ── environment ─────────────────────────────────────────────────────────────────
process.env.GUEST_QUOTA_SALT = "test-only-guest-quota-salt-0123456789";
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
delete process.env.GUEST_DAILY_BUDGET_USD;
process.env.NODE_ENV = "production"; // so the Secure cookie flag is exercised

let failures = 0;
let passes = 0;
const check = (name, ok, detail) => {
  if (ok) { passes++; console.log("PASS ", name); }
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

// ── load real Clerk matcher before the module hook goes in ───────────────────────
const realClerk = require("@clerk/nextjs/server");

// ── fake world ───────────────────────────────────────────────────────────────────
const state = {};
function resetWorld() {
  Object.assign(state, {
    userId: null,
    plan: "free",
    spendMicro: 0,
    quotas: new Map(),
    rpcCalls: [],
    inserts: [],
    deletes: [],
    selects: [],
    fromCalls: [],
    failRpc: false,
    rpcOverride: null,
    createClientThrows: false,
    authThrows: false,
    spendError: false,
    claudeCalls: [],
    claudeFail: null,
    claudeText: "TAILORED RESUME TEXT",
    claudeUsage: { input_tokens: 1000, output_tokens: 500 },
  });
}
resetWorld();

const quotaKey = (id, day, tool) => `${id}|${day}|${tool}`;
const rpcImpl = {
  // Mirrors 0048_guest_quotas.sql: guest row, then ip row; a rejected ip charge undoes the guest charge.
  guest_quota_reserve({ p_guest, p_ip_key, p_day, p_tool, p_limit, p_ip_limit }) {
    const g = state.quotas.get(quotaKey(p_guest, p_day, p_tool)) || 0;
    if (g >= p_limit) return "guest_cap";
    const ip = state.quotas.get(quotaKey(p_ip_key, p_day, p_tool)) || 0;
    if (ip >= p_ip_limit) return "ip_cap";
    state.quotas.set(quotaKey(p_guest, p_day, p_tool), g + 1);
    state.quotas.set(quotaKey(p_ip_key, p_day, p_tool), ip + 1);
    return "ok";
  },
  guest_quota_refund({ p_guest, p_ip_key, p_day, p_tool }) {
    for (const id of [p_guest, p_ip_key]) {
      const k = quotaKey(id, p_day, p_tool);
      if (state.quotas.has(k)) state.quotas.set(k, Math.max(0, state.quotas.get(k) - 1));
    }
    return null;
  },
  guest_spend_add({ p_micro }) {
    state.spendMicro += Math.max(0, p_micro);
    return state.spendMicro;
  },
};

function chain(table) {
  const ctx = { table, op: "select", filters: {} };
  const p = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve, reject) => {
          try { resolve(settle(ctx)); } catch (e) { reject(e); }
        };
      }
      return (...args) => {
        if (prop === "insert" || prop === "upsert" || prop === "update" || prop === "delete") {
          ctx.op = String(prop);
          if (prop === "insert" || prop === "upsert") state.inserts.push({ table, row: args[0] });
        } else if (prop === "eq") ctx.filters[args[0]] = args[1];
        return p;
      };
    },
  });
  return p;
}
function settle(ctx) {
  if (ctx.op === "select") state.selects.push(ctx.table);
  if (ctx.table === "guest_spend" && ctx.op === "select") return state.spendError ? { data: null, error: { message: "spend table unreadable" } } : { data: { micro_usd: state.spendMicro }, error: null };
  if (ctx.op === "delete") state.deletes.push({ table: ctx.table, filters: { ...ctx.filters } });
  if (ctx.table === "guest_quotas" && ctx.op === "select") {
    const c = state.quotas.get(quotaKey(ctx.filters.guest_id, ctx.filters.day, ctx.filters.tool));
    return { data: c ? { count: c } : null, error: null };
  }
  return { data: null, error: null, count: 0 };
}
const fakeDb = {
  rpc(name, args) {
    state.rpcCalls.push({ name, args });
    if (state.rpcOverride) return state.rpcOverride(name, args);
    if (state.failRpc) return Promise.resolve({ data: null, error: { message: "boom" } });
    return Promise.resolve({ data: rpcImpl[name](args), error: null });
  },
  from: (table) => { state.fromCalls.push(table); return chain(table); },
};

class FakeAnthropic {
  constructor() {
    this.messages = {
      create: async (args) => {
        state.claudeCalls.push(args);
        if (state.claudeFail) { const e = new Error("upstream failure"); e.status = state.claudeFail; throw e; }
        const text = typeof state.claudeText === "function" ? state.claudeText(args) : state.claudeText;
        return { content: [{ type: "text", text }], usage: { ...state.claudeUsage } };
      },
    };
  }
}

const mocks = {
  "@clerk/nextjs/server": () => ({
    auth: async () => { if (state.authThrows) throw new Error("clerk is down"); return { userId: state.userId }; },
    currentUser: async () =>
      state.userId ? { id: state.userId, emailAddresses: [{ emailAddress: "member@example.com" }], publicMetadata: { plan: state.plan, type: "individual" } } : null,
    clerkClient: async () => ({ users: { updateUserMetadata: async () => {} } }),
    clerkMiddleware: (handler) => (req) => handler(async () => ({ userId: state.userId }), req),
    createRouteMatcher: realClerk.createRouteMatcher,
  }),
  // The employer pages read their copy through next-intl; the real en.json answers (a missing key throws).
  "next-intl/server": () => {
    const en = require("../messages/en.json");
    const lookup = (ns, key) => (ns ? `${ns}.${key}` : key).split(".").reduce((o, k) => (o == null ? undefined : o[k]), en);
    return {
      getTranslations: async (ns) => {
        const t = (key, vals) => {
          const m = lookup(ns, key);
          if (typeof m !== "string") throw new Error(`missing message ${ns}.${key}`);
          return vals ? m.replace(/\{(\w+)\}/g, (_, k) => String(vals[k])) : m;
        };
        t.has = (key) => typeof lookup(ns, key) === "string";
        return t;
      },
      getFormatter: async () => ({ dateTime: (d) => d.toISOString() }),
    };
  },
  "next/headers": () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Headers() }),
  "@anthropic-ai/sdk": () => ({ __esModule: true, default: FakeAnthropic }),
  "@supabase/supabase-js": () => ({ createClient: () => { if (state.createClientThrows) throw new Error("Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL."); return fakeDb; } }),
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (mocks[request]) return mocks[request]();
  return origLoad.apply(this, arguments);
};
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
const transpile = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  });
  module._compile(out.outputText, filename);
};
require.extensions[".ts"] = transpile;
require.extensions[".tsx"] = transpile;

const load = (rel) => require(path.join(ROOT, rel));
const route = (rel) => load(`app/api/${rel}/route.ts`);

// ── request helpers ──────────────────────────────────────────────────────────────
let ipSeq = 10;
const nextIp = () => `203.0.113.${ipSeq++}`;
const URLBASE = "https://app.resumetailored.com";

/** A visitor: one IP, one cookie jar. */
function visitor(ip = nextIp()) {
  const v = {
    ip,
    jar: "",
    last: null,
    async send(rel, { method = "POST", body, form, headers = {}, xff } = {}) {
      const h = { "cf-connecting-ip": ip, ...headers };
      if (xff !== undefined) h["x-forwarded-for"] = xff;
      if (v.jar) h.cookie = v.jar;
      let init = { method, headers: h };
      if (form) init.body = form;
      else if (body !== undefined) { h["content-type"] = "application/json"; init.body = JSON.stringify(body); }
      const req = new Request(`${URLBASE}/api/${rel}`, init);
      const m = route(rel)[method];
      const res = await m(req, { params: { id: "1", sub: "x" } });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie && /^rt_guest=/.test(setCookie)) v.jar = setCookie.split(";")[0];
      let json = null;
      try { json = await res.clone().json(); } catch { /* not json */ }
      v.last = { status: res.status, json, setCookie, res };
      return v.last;
    },
  };
  return v;
}
const RESUME = "Jane Doe\njane@example.com\nEXPERIENCE\nNurse at General Hospital 2019-2024\n- Cared for patients across an ICU ward";
const JOB = "Registered Nurse needed at St Mary. ICU experience, BLS required. Strong communication and teamwork skills.";
const tailorBody = (extra = {}) => ({ resume: RESUME, jobPosting: JOB, mode: "resume", ...extra });
const quotaTotal = (tool) => [...state.quotas].filter(([k]) => k.endsWith(`|${tool}`) && !k.startsWith("ip:")).reduce((a, [, v]) => a + v, 0);
const insertsTo = (table) => state.inserts.filter((i) => i.table === table).length;
const MSG = (label) => `You've used today's free ${label}. Create a free account — it's free, unlimited, and saves your work.`;

(async () => {
  // ═══ 0. client-IP helper: parity with the legacy client-ip.js, and the XFF rule ═══
  {
    const legacy = require(path.resolve(ROOT, "..", "client-ip.js"));
    const { getClientIp, normalizeIp } = load("lib/client-ip.ts");
    const samples = ["203.0.113.9", " 203.0.113.9 ", "::ffff:203.0.113.9", "2001:db8:abcd:12::1", "2001:DB8:abcd:12:ffff:ffff:ffff:ffff", "fe80::1%eth0", "not-an-ip", "", "999.1.1.1", "::1", "1.2.3.4:80"];
    check("client-ip: normalizeIp agrees with the legacy helper on every sample", samples.every((s) => normalizeIp(s) === legacy.normalizeIp(s)), samples.filter((s) => normalizeIp(s) !== legacy.normalizeIp(s)));
    const req = (headers, ip) => Object.assign(new Request(URLBASE, { headers }), ip ? { ip } : {});
    check("client-ip: CF-Connecting-IP wins", getClientIp(req({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "9.9.9.9" })) === "198.51.100.7");
    check("client-ip: IPv6 buckets to its /64", getClientIp(req({ "cf-connecting-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" })) === "2001:0db8:0001:0002::/64");
    check("client-ip: junk CF header falls through to the platform ip", getClientIp(req({ "cf-connecting-ip": "garbage" }, "198.51.100.8")) === "198.51.100.8");
    check("client-ip: with no CF header the RIGHTMOST x-forwarded-for entry is used (legacy req.ip with trust proxy 1)", getClientIp(req({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 198.51.100.9" })) === "198.51.100.9");
    check("client-ip: the leftmost (client-written) x-forwarded-for entry is never used", getClientIp(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.9" })) !== "6.6.6.6");
    check("client-ip: nothing usable -> 'unknown'", getClientIp(req({})) === "unknown");
  }

  // ═══ 1. configuration: refuse to boot without the salt ═══
  {
    const guest = load("lib/guest.ts");
    const saved = process.env.GUEST_QUOTA_SALT;
    const throwsWith = (v, fn) => { if (v === undefined) delete process.env.GUEST_QUOTA_SALT; else process.env.GUEST_QUOTA_SALT = v; try { fn(); return false; } catch (e) { return /GUEST_QUOTA_SALT/.test(String(e.message)); } };
    check("config: assertGuestConfig throws when GUEST_QUOTA_SALT is unset", throwsWith(undefined, guest.assertGuestConfig));
    check("config: ...and when it is shorter than 16 characters", throwsWith("short-salt", guest.assertGuestConfig));
    process.env.GUEST_QUOTA_SALT = saved;
    check("config: ...and not when it is long enough", (() => { try { guest.assertGuestConfig(); return true; } catch { return false; } })());

    process.env.NEXT_RUNTIME = "nodejs";
    const inst = load("instrumentation.ts");
    const realExit = process.exit;
    const origErr = console.error;
    let exitCode = null;
    let fatal = "";
    process.exit = (c) => { exitCode = c; };
    console.error = (...a) => { fatal += a.join(" "); };
    delete process.env.GUEST_QUOTA_SALT;
    await inst.register();
    check("boot: instrumentation.register() exits 1 without the salt (Next would otherwise log the error and keep serving)", exitCode === 1, exitCode);
    check("boot: ...saying what is missing", /GUEST_QUOTA_SALT/.test(fatal) && /Refusing to start/.test(fatal), fatal);
    exitCode = null; fatal = "";
    process.env.GUEST_QUOTA_SALT = "short";
    await inst.register();
    check("boot: ...and with a too-short salt", exitCode === 1);
    exitCode = null; fatal = "";
    process.env.GUEST_QUOTA_SALT = saved;
    await inst.register();
    process.exit = realExit;
    console.error = origErr;
    check("boot: ...and starts normally with a good one", exitCode === null && fatal === "", { exitCode, fatal });
    delete process.env.NEXT_RUNTIME;
    delete process.env.GUEST_DAILY_BUDGET_USD;
    check("config: budget defaults to $25 and honours GUEST_DAILY_BUDGET_USD", guest.guestBudgetUsd() === 25 && (process.env.GUEST_DAILY_BUDGET_USD = "7.5", guest.guestBudgetUsd() === 7.5) && (process.env.GUEST_DAILY_BUDGET_USD = "nope", guest.guestBudgetUsd() === 25));
    delete process.env.GUEST_DAILY_BUDGET_USD;
    const ai = load("lib/ai.ts");
    check("spend: the hardcoded rates are for the model the app actually calls", ai.CLAUDE_MODEL === guest.SPEND_MODEL && guest.RATE_IN_PER_MTOK === 3 && guest.RATE_OUT_PER_MTOK === 15, ai.CLAUDE_MODEL);
    check("spend: 1000 in + 500 out = 10500 micro-USD ($0.0105)", guest.usageMicroUsd({ input_tokens: 1000, output_tokens: 500 }) === 10500);
  }

  // ═══ 2. a guest's first tailor + export ═══
  {
    resetWorld();
    const g = visitor();
    const r = await g.send("tailor", { body: tailorBody({ customInstructions: "ALWAYS SHOUT" }) });
    check("tailor: a guest completes one run (200 + result + guest flag)", r.status === 200 && r.json.result === "TAILORED RESUME TEXT" && r.json.guest === true, r.json);
    check("tailor: guest output is capped at 4096 tokens", state.claudeCalls[0] && state.claudeCalls[0].max_tokens === 4096, state.claudeCalls[0] && state.claudeCalls[0].max_tokens);
    check("tailor: a guest's customInstructions are ignored", !JSON.stringify(state.claudeCalls[0]).includes("ALWAYS SHOUT") && !state.selects.includes("user_prefs"));
    check("tailor: nothing is persisted for a guest (no generations row)", insertsTo("generations") === 0);
    check("tailor: the guest gets an rt_guest cookie — HttpOnly, 180 days, Secure, Lax, path /", /^rt_guest=[A-Za-z0-9_-]{24}; Path=\/; Max-Age=15552000; HttpOnly; SameSite=Lax; Secure$/.test(r.setCookie || ""), r.setCookie);
    const call = state.rpcCalls.find((c) => c.name === "guest_quota_reserve");
    check("tailor: only opaque ids reach the store — never the address", call && /^[0-9a-f]{32}$/.test(call.args.p_guest) && /^ip:[0-9a-f]{32}$/.test(call.args.p_ip_key) && !JSON.stringify(state.rpcCalls).includes("203.0.113"), call && call.args);
    check("tailor: the slot is reserved BEFORE the Claude call, limit 1/day, per-IP ceiling 10", call && call.args.p_limit === 1 && call.args.p_ip_limit === 10 && state.rpcCalls.findIndex((c) => c.name === "guest_quota_reserve") < state.rpcCalls.findIndex((c) => c.name === "guest_spend_add"));
    check("tailor: the run's cost (usage x sonnet rates) is added to today's anonymous spend", state.spendMicro === 10500, state.spendMicro);

    const exp = await g.send("export/authorize", { body: { tplIds: ["r1"] } });
    check("export: the same guest may download — allowed, watermark ON, free-tier", exp.status === 200 && exp.json.ok === true && exp.json.watermark === true && exp.json.pro === false && exp.json.guest === true, exp.json);
    const expPro = await g.send("export/authorize", { body: { tplIds: ["r2"] } });
    check("export: a Pro template is still refused for a guest (402 pro_template)", expPro.status === 402 && expPro.json.error === "pro_template", expPro.json);
    const proTpl = await visitor().send("tailor", { body: tailorBody({ templateId: "r2" }) });
    check("tailor: a guest asking for a Pro template is refused BEFORE any quota is spent", proTpl.status === 402 && proTpl.json.error === "pro_template" && quotaTotal("tailor") === 1, proTpl.json);

    // ═══ 3. second tailor, same day ═══
    const again = await g.send("tailor", { body: tailorBody() });
    check("tailor: the second run the same day -> 402 guest_quota with the full payload", again.status === 402 && again.json.error === "guest_quota" && again.json.tool === "tailor" && again.json.limit === 1 && again.json.resets === "tomorrow" && again.json.guest === true, again.json);
    check("tailor: ...and the account-urge message, verbatim", again.json.message === MSG("resume tailoring"), again.json.message);
    check("tailor: ...and Claude was not called a second time", state.claudeCalls.length === 1);
    check("tailor: a returning guest is not handed a new cookie", again.setCookie === null || !/^rt_guest=/.test(again.setCookie));

    // ═══ 4. cover letter has its own cap ═══
    const cl1 = await g.send("cover-letter", { body: { resume: RESUME, jobPosting: JOB } });
    check("cover-letter: independent of the tailor cap — the same guest still gets one", cl1.status === 200 && cl1.json.result && cl1.json.guest === true, cl1.json);
    const clCall = state.claudeCalls[state.claudeCalls.length - 1];
    check("cover-letter: guest runs at 4096 tokens, nothing persisted", clCall.max_tokens === 4096 && insertsTo("generations") === 0);
    const cl2 = await g.send("cover-letter", { body: { resume: RESUME, jobPosting: JOB } });
    check("cover-letter: second one -> 402 guest_quota (tool cover-letter, limit 1)", cl2.status === 402 && cl2.json.error === "guest_quota" && cl2.json.tool === "cover-letter" && cl2.json.limit === 1 && cl2.json.message === MSG("cover letter"), cl2.json);
  }

  // ═══ 5. ATS scan caps at 3 ═══
  {
    resetWorld();
    state.claudeText = '{"score":72,"verdict":"Good","matched":["icu"],"missing":["bls"],"suggestions":["Add BLS"]}';
    const g = visitor();
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await g.send("ats-scan", { body: { resume: RESUME, jobPosting: JOB } })).status);
    check("ats-scan: three scans a day, the fourth is 402", statuses.join() === "200,200,200,402", statuses.join());
    check("ats-scan: the 402 carries tool + limit 3", g.last.json.tool === "ats-scan" && g.last.json.limit === 3 && g.last.json.error === "guest_quota");
    check("ats-scan: nothing persisted for a guest; spend recorded per scan", insertsTo("generations") === 0 && state.spendMicro === 3 * 10500, state.spendMicro);
    const big = await visitor().send("ats-scan", { body: { resume: "x".repeat(50001), jobPosting: JOB } });
    check("ats-scan: a guest's oversize text is a 400 and spends nothing", big.status === 400 && quotaTotal("ats-scan") === 3);
    // provider overloaded -> local fallback -> the scan is given back
    const g2 = visitor();
    state.claudeFail = 529;
    const fb = await g2.send("ats-scan", { body: { resume: RESUME, jobPosting: JOB } });
    check("ats-scan: when Claude is overloaded the local fallback answers and the guest's slot is returned", fb.status === 200 && fb.json.fallback === true && quotaTotal("ats-scan") === 3, [fb.status, quotaTotal("ats-scan")]);
  }

  // ═══ 6. one representative other tool: LinkedIn analyze, 1/day ═══
  {
    resetWorld();
    state.claudeText = JSON.stringify({ score: 61, jobTitle: "Nurse", breakdown: { headline: 50, about: 60, experience: 70, keywords: 55 }, suggestions: [{ issue: "Weak headline", fix: "Add role + specialty", priority: "high", section: "headline" }], presentKeywords: ["ICU"], missingKeywords: ["BLS"] });
    const g = visitor();
    const body = { profileText: "Registered nurse with eight years of ICU experience. Passionate about patient care and mentoring." };
    const a = await g.send("linkedin/analyze", { body });
    check("linkedin/analyze: a guest gets one analysis", a.status === 200 && a.json.analysis && a.json.analysis.score === 61, a.json);
    check("linkedin/analyze: the analysis is not saved for a guest", insertsTo("linkedin_analyses") === 0 && state.inserts.length === 0, state.inserts);
    const b = await g.send("linkedin/analyze", { body });
    check("linkedin/analyze: the second -> 402 guest_quota, limit 1", b.status === 402 && b.json.error === "guest_quota" && b.json.tool === "linkedin-analyze" && b.json.limit === 1 && b.json.message === MSG("LinkedIn profile analysis"), b.json);
    const imp = visitor();
    const i1 = await imp.send("linkedin/import", { body: { linkedinJson: { firstName: "Jane", lastName: "Doe", headline: "Nurse", positions: [{ title: "RN", companyName: "General Hospital" }] } } });
    check("linkedin/import: a guest gets one import", i1.status === 200 && i1.json.parsedProfile, i1.json);
    const i2 = await imp.send("linkedin/import", { body: { linkedinJson: { firstName: "Jane", lastName: "Doe", headline: "Nurse", positions: [{ title: "RN", companyName: "General Hospital" }] } } });
    check("linkedin/import: ...and the second is 402", i2.status === 402 && i2.json.tool === "linkedin-import", i2.json);
    const bad = visitor();
    const b1 = await bad.send("linkedin/import", { body: { linkedinJson: "{not json" } });
    check("linkedin/import: unreadable input is a 400 and the guest keeps their import", b1.status === 400 && quotaTotal("linkedin-import") === 1, [b1.status, quotaTotal("linkedin-import")]);
    const sc = visitor();
    const s1 = await sc.send("linkedin/scrape", { body: { url: "https://example.com/in/jane" } });
    check("linkedin/scrape: a non-LinkedIn URL is a 400 and takes no allowance", s1.status === 400 && quotaTotal("linkedin-scrape") === 0);
  }

  // ═══ 7. refund when Claude fails ═══
  {
    resetWorld();
    const g = visitor();
    state.claudeFail = 500;
    const r1 = await g.send("tailor", { body: tailorBody() });
    check("refund: a failed Claude call returns 500", r1.status === 500);
    check("refund: ...and the guest's slot is given back", quotaTotal("tailor") === 0 && state.rpcCalls.some((c) => c.name === "guest_quota_refund"), [...state.quotas]);
    state.claudeFail = null;
    const r2 = await g.send("tailor", { body: tailorBody() });
    check("refund: ...so the retry works", r2.status === 200, r2.json);
    state.claudeFail = 500;
    const g2 = visitor();
    const c1 = await g2.send("cover-letter", { body: { resume: RESUME, jobPosting: JOB } });
    check("refund: same for cover letters", c1.status === 500 && quotaTotal("cover-letter") === 0);
  }

  // ═══ 8. forgeable x-forwarded-for ═══
  {
    resetWorld();
    // (a) the rate limiter: same client behind CF, a different leftmost XFF every time.
    const v = visitor("198.51.100.200");
    const statuses = [];
    for (let i = 0; i < 25; i++) statuses.push((await v.send("tailor/ats-report", { body: {}, xff: `spoof-${i}.example, 10.0.0.1` })).status);
    check("rate-limit: a client cannot dodge it by varying the x-forwarded-for it sends (429 after 20/min)", statuses.slice(0, 20).every((s) => s === 400) && statuses.slice(20).every((s) => s === 429), statuses.join());
    // (b) no CF header at all: keyed on the RIGHTMOST xff entry, which the client cannot choose.
    const raw = async (i) => (await route("tailor/ats-report").POST(new Request(`${URLBASE}/api/tailor/ats-report`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `1.1.1.${i}, 198.51.100.201` }, body: "{}" }))).status;
    const s2 = [];
    for (let i = 0; i < 22; i++) s2.push(await raw(i));
    check("rate-limit: without a CF header it keys on the proxy-added (rightmost) entry, not the forged leftmost", s2.slice(0, 20).every((s) => s === 400) && s2.slice(20).every((s) => s === 429), s2.join());
    // (c) guest identity: a cookie-less bot with spoofed xff is still one address.
    resetWorld();
    const ok = [];
    for (let i = 0; i < 10; i++) {
      const bot = visitor("198.51.100.210"); // fresh jar every time: no cookie sent
      ok.push((await bot.send("tailor", { body: tailorBody(), xff: `9.9.9.${i}` })).status);
    }
    const eleventh = visitor("198.51.100.210");
    const last = await eleventh.send("tailor", { body: tailorBody(), xff: "9.9.9.99" });
    check("identity: 10 cookie-less requests from one address get 10 runs (a new cookie each)...", ok.every((s) => s === 200), ok.join());
    check("identity: ...the 11th is stopped by the per-IP ceiling (402 guest_quota, scope network) — dropping the cookie does not mint unlimited runs", last.status === 402 && last.json.error === "guest_quota" && last.json.scope === "network", last.json);
    check("identity: ...and a refused request leaves no residue on the guest's own row", quotaTotal("tailor") === 10, quotaTotal("tailor"));
    // (d) two people behind one IP, each with a cookie, do not share a single allowance.
    resetWorld();
    const a = visitor("198.51.100.220"); const b = visitor("198.51.100.220");
    const ra = await a.send("tailor", { body: tailorBody() }); const rb = await b.send("tailor", { body: tailorBody() });
    check("identity: two visitors behind one IP each get their own run (the cookie is mixed into the id)", ra.status === 200 && rb.status === 200 && a.jar !== b.jar);
    // (e) the salt matters.
    const idsA = state.rpcCalls.filter((c) => c.name === "guest_quota_reserve").map((c) => c.args.p_ip_key);
    check("identity: different visitors on one IP share the ip-ceiling key but not the guest id", idsA[0] === idsA[1] && state.rpcCalls[0].args.p_guest !== state.rpcCalls[1].args.p_guest);
  }

  // ═══ 9. middleware matrix ═══
  {
    resetWorld();
    const { NextRequest } = require("next/server");
    const mw = load("middleware.ts").default;
    const run = async (p, { host = "app.resumetailored.com" } = {}) => mw(new NextRequest(`https://${host}${p}`, { headers: { host } }), {});
    const verdict = async (p) => {
      const res = await run(p);
      if (res === undefined || res === null) return "pass";
      const loc = res.headers.get("location");
      return `${res.status} ${loc ? new URL(loc).pathname + new URL(loc).search : ""}`.trim();
    };

    state.userId = null;
    check("middleware[guest]: /candidate is public", (await verdict("/candidate")) === "pass");
    check("middleware[guest]: /candidate/ and /candidate?x=1 are public", (await verdict("/candidate/")) === "pass" && (await verdict("/candidate?x=1")) === "pass");
    const memberPages = ["/candidate/settings", "/candidate/profile", "/candidate/resumes", "/candidate/shareable-links", "/candidate/applications", "/candidate/studio", "/candidate/studio/edit", "/candidate/templates", "/candidate/help", "/candidate/some-future-page"];
    for (const p of memberPages) {
      const v = await verdict(p);
      check(`middleware[guest]: ${p} -> 307 to sign-in, returning here`, v === `307 /sign-in?redirect_url=${encodeURIComponent(p)}`, v);
    }
    for (const p of ["/dashboard", "/dashboard/x", "/employer/messages", "/employer/team", "/employee", "/employee/settings"]) {
      check(`middleware[guest]: ${p} -> 307 /sign-in (same end-state as the old "/" hop)`, (await verdict(p)) === "307 /sign-in", await verdict(p));
    }
    check("middleware[guest]: /employee/accept stays reachable (it handles signed-out itself)", (await verdict("/employee/accept")) === "pass");
    check("middleware[guest]: /employer-checkout still goes to sign-up with the plan preserved", (await verdict("/employer-checkout?plan=portal")) === `307 /sign-up?redirect_url=${encodeURIComponent("/employer-checkout?plan=portal")}`, await verdict("/employer-checkout?plan=portal"));
    check("middleware[guest]: /candidate?upgrade=pro signs in first (buying Pro needs an account)", (await verdict("/candidate?upgrade=pro")) === `307 /sign-in?redirect_url=${encodeURIComponent("/candidate?upgrade=pro")}`, await verdict("/candidate?upgrade=pro"));
    check("middleware[guest]: /, /sign-in and the tool APIs are not gated by the middleware", (await verdict("/")) === "pass" && (await verdict("/sign-in")) === "pass" && (await verdict("/api/tailor")) === "pass" && (await verdict("/api/export/authorize")) === "pass");

    // every page that exists under /candidate (any depth) is member-only except the dashboard itself
    const pages = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "page.tsx") pages.push(path.relative(path.join(ROOT, "app"), dir));
      }
    })(path.join(ROOT, "app/candidate"));
    const urls = pages.map((p) => "/" + p.split(path.sep).filter((s) => !/^\(.*\)$/.test(s)).map((s) => (/^\[\.\.\./.test(s) ? "catch-all" : /^\[/.test(s) ? "1" : s)).join("/"));
    const publicOnes = [];
    for (const u of urls) if ((await verdict(u)) === "pass") publicOnes.push(u);
    check("middleware[guest]: of every page.tsx under app/candidate, /candidate is the ONLY public one", publicOnes.length === 1 && publicOnes[0] === "/candidate", { pages: urls, publicOnes });

    state.userId = "user_123";
    const all = ["/candidate", ...memberPages, "/dashboard", "/employer", "/employee", "/employee/settings", "/candidate?upgrade=pro"];
    const results = await Promise.all(all.map(verdict));
    check("middleware[signed in]: every route above passes straight through (unchanged)", results.every((v) => v === "pass"), results.map((v, i) => `${all[i]}=${v}`).filter((s) => !s.endsWith("=pass")));
    state.userId = null;
  }

  // ═══ 10. signed-in paths are unchanged ═══
  {
    resetWorld();
    state.userId = "user_123";
    const m = visitor();
    const t = await m.send("tailor", { body: tailorBody({ customInstructions: "Plain direct language." }) });
    check("signed-in tailor: 200, no guest flag, no rt_guest cookie", t.status === 200 && t.json.result && t.json.guest === undefined && !t.setCookie, [t.status, t.setCookie]);
    check("signed-in tailor: still the full 8192-token output", state.claudeCalls[0].max_tokens === 8192);
    check("signed-in tailor: custom instructions still reach the prompt", JSON.stringify(state.claudeCalls[0]).includes("Plain direct language."));
    check("signed-in tailor: still persisted to generations", insertsTo("generations") === 1);
    check("signed-in: the guest store is never touched (no guest RPCs, no quota)", !state.rpcCalls.length && state.quotas.size === 0);
    let ok = 0;
    for (let i = 0; i < 4; i++) if ((await m.send("tailor", { body: tailorBody() })).status === 200) ok++;
    check("signed-in tailor: no daily cap (5 in a row)", ok === 4);
    const cl = await m.send("cover-letter", { body: { resume: RESUME, jobPosting: JOB } });
    check("signed-in cover-letter: 8192 tokens, persisted, no guest flag", cl.status === 200 && cl.json.guest === undefined && state.claudeCalls[state.claudeCalls.length - 1].max_tokens === 8192);
    const ex = await m.send("export/authorize", { body: { tplIds: ["r1"] } });
    check("signed-in export (free): watermark on, no guest flag", ex.status === 200 && ex.json.watermark === true && ex.json.guest === undefined, ex.json);
    const exPro = await m.send("export/authorize", { body: { tplIds: ["r2"] } });
    check("signed-in export (free, Pro template): still 402", exPro.status === 402);
    state.plan = "pro";
    const exP = await m.send("export/authorize", { body: { tplIds: ["r2"] } });
    check("signed-in export (Pro): every template, watermark off", exP.status === 200 && exP.json.watermark === false && exP.json.pro === true, exP.json);
    state.plan = "free";
    state.claudeText = '{"score":72,"verdict":"Good","matched":["icu"],"missing":["bls"],"suggestions":[]}';
    let atsOk = 0;
    for (let i = 0; i < 5; i++) if ((await m.send("ats-scan", { body: { resume: RESUME, jobPosting: JOB } })).status === 200) atsOk++;
    check("signed-in ats-scan: no cap (5 in a row), no guest flag", atsOk === 5 && m.last.json.guest === undefined);
    const big = await m.send("ats-scan", { body: { resume: "x".repeat(60000), jobPosting: JOB } });
    check("signed-in ats-scan: still no size cap (unchanged)", big.status === 200);
    check("signed-in: a spent ceiling does not touch them", (state.spendMicro = 26e6, (await m.send("tailor", { body: tailorBody() })).status === 200));
    state.userId = null;
  }

  // ═══ 11. the global anonymous spend ceiling ═══
  {
    resetWorld();
    const logs = [];
    const origErr = console.error;
    console.error = (...a) => { logs.push(a.join(" ")); };
    state.spendMicro = 25e6; // exactly at the ceiling: not yet over
    const atCeiling = await visitor().send("tailor", { body: tailorBody() });
    state.spendMicro = 25e6 + 1;
    const over = await visitor().send("tailor", { body: tailorBody() });
    const over2 = await visitor().send("cover-letter", { body: { resume: RESUME, jobPosting: JOB } });
    console.error = origErr;
    check("budget: at $25.00 a guest generation still starts", atCeiling.status === 200, atCeiling.json);
    check("budget: past $25 a NEW guest generation is declined (503 guest_capacity) and Claude is not called", over.status === 503 && over.json.error === "guest_capacity" && over.json.guest === true && state.claudeCalls.length === 1, over.json);
    check("budget: ...for every Claude tool, with the sign-up message", over2.status === 503 && /Create a free account/.test(over2.json.message));
    check("budget: ...and it takes no quota", quotaTotal("tailor") === 1 && quotaTotal("cover-letter") === 0);
    const trip = logs.filter((l) => /\[guest-budget\] TRIPPED/.test(l));
    check("budget: tripping is logged clearly, once", trip.length === 1 && /\$25\.00/.test(trip[0]) && /GUEST_DAILY_BUDGET_USD/.test(trip[0]), logs);
    const upload = new FormData(); upload.append("file", new File(["Jane Doe resume text"], "r.txt", { type: "text/plain" }));
    const x = await visitor().send("extract-text", { form: upload });
    check("budget: a tool that costs no Claude spend (resume upload) keeps working", x.status === 200, x.json);
    process.env.GUEST_DAILY_BUDGET_USD = "40";
    const raised = await visitor().send("tailor", { body: tailorBody() });
    delete process.env.GUEST_DAILY_BUDGET_USD;
    check("budget: raising GUEST_DAILY_BUDGET_USD reopens it", raised.status === 200);
  }

  // ═══ 12. fail closed ═══
  {
    resetWorld();
    state.failRpc = true;
    const origErr = console.error; console.error = () => {};
    const r = await visitor().send("tailor", { body: tailorBody() });
    console.error = origErr;
    check("fail-closed: if the quota store errors the guest is declined (503) and Claude is NOT called", r.status === 503 && r.json.error === "guest_unavailable" && state.claudeCalls.length === 0, r.json);
    state.failRpc = false;
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    // an unreadable spend total also declines (getDb is cached, so exercise via a store that throws on read)
    check("fail-closed: the message still invites a free account", /Create a free account/.test(r.json.message));
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  }

  // ═══ 13. resume upload ═══
  {
    resetWorld();
    const file = (name, content) => { const f = new FormData(); f.append("file", new File([content], name)); return f; };
    const g = visitor();
    const r1 = await g.send("extract-text", { form: file("resume.txt", "Jane Doe\nNurse") });
    check("extract-text: a guest can upload a resume", r1.status === 200 && /Jane Doe/.test(r1.json.text), r1.json);
    const big = await visitor().send("extract-text", { form: file("big.txt", "a".repeat(2 * 1024 * 1024 + 1)) });
    check("extract-text: 2MB cap for guests (413) — and it takes no allowance", big.status === 413 && quotaTotal("extract-text") === 1, big.json);
    const early = await visitor().send("extract-text", { form: file("x.txt", "tiny"), headers: { "content-length": String(50 * 1024 * 1024) } });
    check("extract-text: an oversize declared body is refused before it is read (413)", early.status === 413);
    const empty = visitor();
    const e1 = await empty.send("extract-text", { form: file("empty.txt", "   ") });
    check("extract-text: an unreadable (empty) file is a 400 and the upload is given back", e1.status === 400 && quotaTotal("extract-text") === 1, [e1.status, quotaTotal("extract-text")]);
    const spoof = await visitor().send("extract-text", { form: file("fake.pdf", "not really a pdf") });
    check("extract-text: a file whose bytes don't match its extension is a 400, no allowance used", spoof.status === 400 && quotaTotal("extract-text") === 1);
    const d = visitor();
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await d.send("extract-text", { form: file("r.txt", `resume ${i}`) })).status);
    check("extract-text: 3 readable uploads a day, then 402 guest_quota", codes.join() === "200,200,200,402" && d.last.json.tool === "extract-text" && d.last.json.limit === 3, codes.join());
    const rpm = visitor("198.51.100.250");
    const per = [];
    for (let i = 0; i < 7; i++) per.push((await rpm.send("extract-text", { form: file("r.txt", `x${i}`) })).status);
    check("extract-text: 5 a minute — the 6th request is 429 whatever the daily count", per.slice(5).every((s) => s === 429), per.join());
  }

  // ═══ 14. job-link import ═══
  {
    resetWorld();
    const realFetch = global.fetch;
    const html = '<html><script type="application/ld+json">' + JSON.stringify({ "@type": "JobPosting", title: "Registered Nurse", description: "Care for critically ill ICU patients, administer medication, monitor vital signs and coordinate with the care team. " + "Requires BLS certification and two years of ICU experience. ".repeat(3), hiringOrganization: { name: "St Mary" } }) + "</script></html>";
    let upstream = () => new Response(html, { status: 200 });
    global.fetch = async (u, init) => (String(u).startsWith("https://boards.greenhouse.io") ? upstream() : realFetch(u, init));
    const g = visitor();
    const bad = await g.send("fetch-job-url", { body: { url: "https://evil.example.com/job" } });
    check("fetch-job-url: an unsupported site is a 400 and takes no allowance", bad.status === 400 && quotaTotal("fetch-job-url") === 0);
    const ok = await g.send("fetch-job-url", { body: { url: "https://boards.greenhouse.io/acme/jobs/1" } });
    check("fetch-job-url: a guest can import a posting", ok.status === 200 && /Registered Nurse/.test(ok.json.text), ok.json);
    upstream = () => new Response("nope", { status: 500 });
    const fail = await g.send("fetch-job-url", { body: { url: "https://boards.greenhouse.io/acme/jobs/2" } });
    check("fetch-job-url: a failed fetch is given back", fail.status === 422 && quotaTotal("fetch-job-url") === 1, [fail.status, quotaTotal("fetch-job-url")]);
    upstream = () => new Response(html, { status: 200 });
    const g3 = visitor(); // (a fresh visitor: the 5/minute limiter above counts every request, not just successes)
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await g3.send("fetch-job-url", { body: { url: "https://boards.greenhouse.io/acme/jobs/3" } })).status);
    check("fetch-job-url: 3 a day, then 402", codes.join() === "200,200,200,402" && g3.last.json.tool === "fetch-job-url" && g3.last.json.limit === 3, codes.join());
    const rpm = visitor("198.51.100.251");
    const per = [];
    for (let i = 0; i < 7; i++) per.push((await rpm.send("fetch-job-url", { body: { url: "https://evil.example.com/x" } })).status);
    check("fetch-job-url: 5 a minute — the 6th request is 429", per.slice(5).every((s) => s === 429), per.join());
    global.fetch = realFetch;
  }

  // ═══ 15. other free routes + the decoder quota readout ═══
  {
    resetWorld();
    const g = visitor();
    state.claudeText = JSON.stringify({ questions: [{ id: "q1", text: "Tell me about a time you led a team.", category: "behavioral", difficulty: 2, expectedKeywords: ["lead"] }], coaching: { commonMistakes: ["Rambling"], topMentions: ["STAR"] } });
    const iq = await g.send("interview/questions", { body: { jobDescription: JOB + " " + JOB } });
    const iq2 = await g.send("interview/questions", { body: { jobDescription: JOB + " " + JOB } });
    check("interview/questions: a guest gets one question set a day — the 2nd is 402", iq.status === 200 && iq2.status === 402 && iq2.json.tool === "interview-questions" && iq2.json.limit === 1, [iq.status, iq2.status, iq.json]);
    const dg = visitor();
    const q0 = await dg.send("decoder/decode", { method: "GET" });
    check("decoder GET: a guest sees a 1-per-day readout (not a 401)", q0.status === 200 && q0.json.limit === 1 && q0.json.used === 0 && q0.json.guest === true, q0.json);
    const deep = await dg.send("decoder/decode", { body: { jobDescription: JOB, depth: "deep" } });
    check("decoder: deep decode is Pro — a guest gets 402 pro_required, no allowance used", deep.status === 402 && deep.json.error === "pro_required" && quotaTotal("decoder-decode") === 0);
  }

  // ═══ 16. every route with the auth()->401 shape is classified; protected ones stay protected ═══
  {
    resetWorld();
    const GUEST_GATED = new Set(["tailor", "cover-letter", "ats-scan", "extract-text", "fetch-job-url", "linkedin/scrape", "linkedin/import", "linkedin/analyze", "interview/questions", "interview/feedback", "jobs/search", "jobs/cover-letter", "jobs/apply-package", "career/insights", "career/skill-gap", "career/roadmap", "decoder/decode", "employer/jobs/assist"]);
    const GUEST_UNMETERED = new Set(["export/authorize", "tailor/ats-report", "documents/export"]); // no model call / deterministic: allowed, no quota
    const GUEST_READONLY = new Set(["guest/usage"]); // reads the guest's own count for the "free runs left" note: no reserve, no model
    const TOLERANT = new Set(["telemetry/install"]); // always accepted anonymously by design (PWA install ping)
    const PRO_ONLY = new Set(["linkedin/optimize", "interview/mock", "decoder/compare", "personal-website/copy", "resume-video/mp4", "resume-video/script", "resume-video/voiceover", "resume-video/quota", "resume-video/list", "resume-video/settings"]);
    const MEMBER_DATA = new Set(["applications", "applications/[id]", "career", "career/goals", "career/goals/[id]", "career/milestones", "career/milestones/[id]", "career/profile", "jobs/save", "jobs/save/[id]", "jobs/status", "personal-website/mine", "personal-website/publish", "personal-website/save", "personal-website/slug-available", "profile", "profile/locale", "resume-video/saved", "resume-video/saved/[id]", "resume-video/saved/[id]/script", "resume-video/saved/[id]/video", "resumes", "resumes/[id]", "shareable", "user/instructions", "employee/accept", "vacancies", "documents/generate", "documents/selection-criteria", "documents/batch", "documents/batch/[id]"]);

    const apiRoot = path.join(ROOT, "app/api");
    const routes = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "route.ts") routes.push(path.relative(apiRoot, dir).split(path.sep).join("/"));
      }
    })(apiRoot);

    const unclassified = [];
    const mismatched = [];
    for (const r of routes) {
      const src = fs.readFileSync(path.join(apiRoot, r, "route.ts"), "utf8");
      const usesAuth = /await auth\(\)/.test(src);
      const gated = /@\/lib\/guest/.test(src) && /guestReserve/.test(src);
      const known = GUEST_GATED.has(r) || GUEST_UNMETERED.has(r) || GUEST_READONLY.has(r) || TOLERANT.has(r) || PRO_ONLY.has(r) || MEMBER_DATA.has(r);
      if (usesAuth && !known) unclassified.push(r);
      if (GUEST_GATED.has(r) && !gated) mismatched.push(`${r}: classified guest-gated but does not reserve a guest allowance`);
      if (!GUEST_GATED.has(r) && gated) mismatched.push(`${r}: reserves a guest allowance but is not in GUEST_GATED`);
      if (usesAuth && /status: 401/.test(src) && (GUEST_GATED.has(r) || GUEST_UNMETERED.has(r))) mismatched.push(`${r}: still answers 401`);
    }
    check("classification: every route that calls auth() is in exactly one list here (a new route must be decided)", unclassified.length === 0, unclassified);
    check("classification: the guest-gated routes are exactly the ones that reserve an allowance", mismatched.length === 0, mismatched);
    check(`classification: ${GUEST_GATED.size} gated + ${GUEST_UNMETERED.size} unmetered + ${PRO_ONLY.size} Pro-only + ${MEMBER_DATA.size} member-data + ${TOLERANT.size} tolerant`, routes.length >= GUEST_GATED.size);

    // every protected handler still answers a guest with 401 before doing anything
    const leaks = [];
    const origErr = console.error; console.error = () => {};
    for (const r of [...PRO_ONLY, ...MEMBER_DATA]) {
      let mod;
      try { mod = route(r); } catch (e) { leaks.push(`${r}: failed to load (${e.message})`); continue; }
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        if (typeof mod[method] !== "function") continue;
        const init = { method, headers: { "cf-connecting-ip": nextIp() } };
        if (method !== "GET" && method !== "DELETE") { init.body = "{}"; init.headers["content-type"] = "application/json"; }
        let res;
        try { res = await mod[method](new Request(`${URLBASE}/api/${r}`, init), { params: { id: "1" } }); } catch (e) { leaks.push(`${r} ${method}: threw ${e.message}`); continue; }
        if (res.status !== 401) leaks.push(`${r} ${method}: ${res.status}`);
      }
    }
    console.error = origErr;
    check("protected: every Pro-only and member-data route still answers a guest with 401", leaks.length === 0, leaks);
    const tel = await route("telemetry/install").POST(new Request(`${URLBASE}/api/telemetry/install`, { method: "POST", body: JSON.stringify({ platform: "android" }), headers: { "content-type": "application/json" } }));
    check("protected: telemetry/install stays anonymous-tolerant (unchanged)", tel.status === 200);
  }

  // ═══ 17. client-side tolerance (static: the React files cannot run here) ═══
  {
    const tailorSrc = fs.readFileSync(path.join(ROOT, "app/candidate/tools/resume-tailor.tsx"), "utf8");
    check("client: resume-tailor derives signed-in state from Clerk", /useAuth\(\)/.test(tailorSrc) && /signedIn\s*=\s*authLoaded && isSignedIn === true/.test(tailorSrc));
    check("client: resume-tailor skips /api/user/instructions when signed out", /useEffect\(\(\) => \{\s*if \(!signedIn\) return;\s*let alive = true;\s*fetch\("\/api\/user\/instructions"\)/.test(tailorSrc));
    check("client: resume-tailor skips the /api/resumes autosave when signed out", /const persist = useCallback\(async \(content: ResumeDraftContent\) => \{\s*if \(!signedIn\) return;/.test(tailorSrc) && /\[locale, signedIn, autosave\]/.test(tailorSrc));
    const exportSrc = fs.readFileSync(path.join(ROOT, "app/candidate/components/use-export-auth.ts"), "utf8");
    check("client: use-export-auth treats a 401 as export-allowed-with-watermark", /r\.status === 401\) setAuth\(\{ allowed: true, watermark: true/.test(exportSrc));
    const homeSrc = fs.readFileSync(path.join(ROOT, "app/page.tsx"), "utf8");
    check("page: signed-out visitors go to /candidate (sign-in only for ?upgrade=pro)", /if \(!userId\) redirect\(upgrade \? `\/sign-in\$\{upgrade\}` : "\/candidate"\);/.test(homeSrc));
  }

  // ═══ 18. the anonymous employer taste (PR C) ═══
  {
    const demo = load("lib/employer-demo.ts");
    const EN = require("../messages/en.json");
    const EMPLOYER_MSG = "You've used today's free employer preview. Create a free employer account to post for real.";
    const apiRoot = path.join(ROOT, "app/api");
    const allRoutes = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "route.ts") allRoutes.push(path.relative(apiRoot, dir).split(path.sep).join("/"));
      }
    })(apiRoot);
    const srcOf = (r) => fs.readFileSync(path.join(apiRoot, r, "route.ts"), "utf8");

    // ── 18a. classification: every employer-area route, in exactly one class ──
    //  PUBLIC          no session by design (a candidate applying, a career page, a signature-verified webhook)
    //  GUEST_TASTE     open to a signed-out visitor, metered by lib/guest.ts — the ONLY such employer route
    //  ACCOUNT         needs a signed-in employer (requireEmployerId / employerContext / currentUser); a guest is refused
    //  PAID_TIER       ACCOUNT, and the feature is further gated by the employer's tier (lib/employer-plan)
    const PUBLIC = new Set(["public/jobs/[jobId]/apply", "careers/[slug]", "tenant-resolve", "docusign/webhook", "daily/webhook"]);
    const GUEST_TASTE = new Set(["employer/jobs/assist"]);
    const PAID_TIER = new Set([
      "employer/assistant/chat",
      "employer/documents", "employer/docusign/send", "employer/docusign/status", "employer/employees", "employer/interviews", "employer/interviews/[id]",
      "employer/office/chart-data", "employer/office/chart-insert", "employer/office/presentation-generate", "employer/office/presentation-save",
      "employer/office/report-generate", "employer/office/spreadsheet-download", "employer/office/spreadsheet-extract", "employer/office/spreadsheet-generate",
      "employer/office/spreadsheet-save", "employer/schedule/publish", "employer/team", "employer/time-off/[id]", "employer/timesheets/review", "employer/upgrade-card",
    ]);
    // Account-required: everything else under employer/, plus the route that mints an employer checkout.
    // (and the admin-only cert-reminder trigger, which gates on employerContext + isAdmin)
    const ACCOUNT_EXTRA = new Set(["create-employer-checkout-session", "admin/cert-reminder-scan"]);
    const employerArea = allRoutes.filter((r) => r.startsWith("employer/"));
    const isAccount = (r) => (employerArea.includes(r) && !GUEST_TASTE.has(r) && !PAID_TIER.has(r) && !PUBLIC.has(r)) || ACCOUNT_EXTRA.has(r);
    const GATE_RE = /requireEmployerId|employerContext|currentUser\(\)|await auth\(\)/;

    const bad = [];
    for (const r of allRoutes) {
      const src = srcOf(r);
      const touchesEmployerAuth = /requireEmployerId|employerContext/.test(src);
      const classes = [PUBLIC.has(r), GUEST_TASTE.has(r), PAID_TIER.has(r), isAccount(r)].filter(Boolean).length;
      const inArea = r.startsWith("employer/") || PUBLIC.has(r) || ACCOUNT_EXTRA.has(r);
      if (touchesEmployerAuth && !inArea) bad.push(`${r}: uses employer auth but is outside employer/ and unclassified`);
      if (inArea && classes !== 1) bad.push(`${r}: in ${classes} classes`);
      if (PAID_TIER.has(r) && !/@\/lib\/employer-plan/.test(src)) bad.push(`${r}: classified paid-tier but never consults lib/employer-plan`);
      if ((PAID_TIER.has(r) || isAccount(r)) && !GATE_RE.test(src)) bad.push(`${r}: account-required but has no session gate`);
      if (!GUEST_TASTE.has(r) && /guestReserve/.test(src) && r.startsWith("employer/")) bad.push(`${r}: reserves a guest allowance but is not GUEST_TASTE`);
      if (PUBLIC.has(r) && r.endsWith("webhook") && !/verify|signature|Webhook/i.test(src)) bad.push(`${r}: public webhook without signature verification`);
    }
    for (const r of GUEST_TASTE) if (!/guestReserve/.test(srcOf(r)) || !/withGuestCookie/.test(srcOf(r))) bad.push(`${r}: guest taste but does not meter the guest`);
    check("employer classification: every employer-area API route is in exactly one class; account/paid routes are gated; only GUEST_TASTE meters guests", bad.length === 0, bad);
    check(`employer classification: ${PUBLIC.size} public + ${GUEST_TASTE.size} guest-taste + ${PAID_TIER.size} paid-tier + ${employerArea.filter(isAccount).length + ACCOUNT_EXTRA.size} account-required`, employerArea.length > 80);

    // pages: the taste set is exactly DEMO_PAGES
    const empPages = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "page.tsx") empPages.push(path.relative(path.join(ROOT, "app"), dir));
      }
    })(path.join(ROOT, "app/employer"));
    const empUrls = empPages.map((p) => "/" + p.split(path.sep).map((s) => (/^\[\.\.\./.test(s) ? "catch-all" : /^\[/.test(s) ? "1" : s)).join("/"));
    check(`employer pages: ${empUrls.length} page.tsx files under app/employer (3 guest-taste, the rest account-required)`, empUrls.includes("/employer") && empUrls.length >= 10, empUrls);

    // ── 18b. middleware matrix ──
    {
      const { NextRequest } = require("next/server");
      const mw = load("middleware.ts").default;
      const verdict = async (p) => {
        const res = await mw(new NextRequest(`https://app.resumetailored.com${p}`, { headers: { host: "app.resumetailored.com" } }), {});
        if (res === undefined || res === null) return "pass";
        const loc = res.headers.get("location");
        return `${res.status} ${loc ? new URL(loc).pathname + new URL(loc).search : ""}`.trim();
      };
      state.userId = null;
      const tastePaths = ["/employer", "/employer/", "/employer?x=1", "/employer/jobs", "/employer/jobs?new=1", "/employer/candidates", "/employer/candidates?jobId=-1"];
      const results = await Promise.all(tastePaths.map(verdict));
      check("middleware[guest]: /employer, /employer/jobs and /employer/candidates are public (demo mode, not /sign-in)", results.every((v) => v === "pass"), results.map((v, i) => `${tastePaths[i]}=${v}`));
      const publicOnes = [];
      for (const u of empUrls) if ((await verdict(u)) === "pass") publicOnes.push(u);
      check("middleware[guest]: of every page.tsx under app/employer, exactly the 3 demo pages are public", publicOnes.sort().join() === [...demo.DEMO_PAGES].sort().join(), { empUrls, publicOnes });
      const realData = ["/employer/messages", "/employer/team", "/employer/settings", "/employer/docusign", "/employer/documents", "/employer/office", "/employer/employees", "/employer/shortlists", "/employer/some-future-page", "/employer/jobs/123", "/employer/candidates/5", "/employer/jobs/1/edit"];
      const rd = await Promise.all(realData.map(verdict));
      check("middleware[guest]: every real-data employer page (messages, e-sign, documents, team, settings, billing…, and anything added later) -> 307 /sign-in", rd.every((v) => v === "307 /sign-in"), rd.map((v, i) => `${realData[i]}=${v}`));
      check("middleware[guest]: /employer-checkout, /employee and /dashboard behave exactly as before", (await verdict("/employer-checkout?plan=free")) === `307 /sign-up?redirect_url=${encodeURIComponent("/employer-checkout?plan=free")}` && (await verdict("/employee")) === "307 /sign-in" && (await verdict("/dashboard")) === "307 /sign-in");
      state.userId = "emp_1"; state.plan = "employer";
      const all = [...tastePaths, ...realData, "/employer-checkout?plan=free"];
      const sres = await Promise.all(all.map(verdict));
      check("middleware[signed in]: every employer route passes straight through (unchanged)", sres.every((v) => v === "pass"), sres.map((v, i) => `${all[i]}=${v}`).filter((x) => !x.endsWith("=pass")));
      resetWorld();
    }

    // ── 18c. an employer API route answers a guest 401/403 and touches nothing ──
    {
      resetWorld();
      const leaks = [];
      const origErr = console.error; const origLog = console.log; console.error = () => {}; console.log = () => {};
      const accountRoutes = allRoutes.filter((r) => isAccount(r) || PAID_TIER.has(r));
      let calls = 0;
      for (const r of accountRoutes) {
        let mod;
        try { mod = route(r); } catch (e) { leaks.push(`${r}: failed to load (${e.message})`); continue; }
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
          if (typeof mod[method] !== "function") continue;
          const init = { method, headers: { "cf-connecting-ip": nextIp() } };
          if (method !== "GET" && method !== "DELETE") { init.body = "{}"; init.headers["content-type"] = "application/json"; }
          let res;
          try { res = await mod[method](new Request(`${URLBASE}/api/${r}`, init), { params: { id: "1", slug: "x" } }); } catch (e) { leaks.push(`${r} ${method}: threw ${e.message}`); continue; }
          calls++;
          // A refusal is a 401/403, a redirect back to /employer or /sign-in (the browser-navigated OAuth/join routes), or
          // the upgrade card's own empty answer ({data:null} — the client renders nothing). Never data.
          let refused = res.status === 401 || res.status === 403;
          if (!refused && res.status >= 300 && res.status < 400) {
            const loc = res.headers.get("location");
            refused = !!loc && ["/employer", "/sign-in"].includes(new URL(loc, URLBASE).pathname) && new URL(loc, URLBASE).origin === URLBASE;
          }
          if (!refused && r === "employer/upgrade-card" && res.status === 200) refused = JSON.stringify(await res.clone().json()) === '{"data":null}';
          if (!refused) leaks.push(`${r} ${method}: ${res.status}`);
        }
      }
      console.error = origErr; console.log = origLog;
      check(`employer API[guest]: all ${calls} handlers of the ${accountRoutes.length} account/paid routes are refused (401/403, a redirect to /employer or /sign-in, or an empty upgrade card)`, leaks.length === 0 && calls > 100, leaks);
      check("employer API[guest]: ...and read no table, wrote none, called no model, reserved nothing", state.fromCalls.length === 0 && state.inserts.length === 0 && state.claudeCalls.length === 0 && state.rpcCalls.length === 0, { from: state.fromCalls, claude: state.claudeCalls.length, rpc: state.rpcCalls.length });
    }

    // ── 18d. publish gate: a guest cannot create, publish, message, e-sign or file anything ──
    {
      resetWorld();
      const origErr = console.error; const origLog = console.log; console.error = () => {}; console.log = () => {};
      const g = visitor();
      const attempts = [
        ["employer/jobs", { body: { title: "Real job", description: "A real description of the role.", status: "active", salaryMin: 1, salaryMax: 2, benefitsDescription: "x" } }],
        ["employer/messages", { body: { applicantId: 1, body: "hello real person" } }],
        ["employer/docusign/send", { body: { to: "someone@example.com" } }],
        ["employer/documents", { body: { name: "x" } }],
        ["employer/team", { body: { email: "x@example.com", role: "admin" } }],
        ["employer/candidates", { body: { jobId: 1, name: "Real Person", email: "real@person.com", resumeText: "resume resume resume" } }],
        ["employer/shortlists", { body: { name: "x" } }],
      ];
      const out = [];
      for (const [r, init] of attempts) out.push(`${r}=${(await g.send(r, init)).status}`);
      const patch = await g.send("employer/jobs/[id]", { method: "PATCH", body: { status: "active" } });
      const del = await g.send("employer/jobs/[id]", { method: "DELETE" });
      console.error = origErr; console.log = origLog;
      check("publish gate: a guest POST to jobs / messages / e-sign / documents / team / candidates / shortlists is refused", out.every((x) => /=(401|403)$/.test(x)), out);
      check("publish gate: ...and nothing was written (no job row, no message, no envelope)", state.inserts.length === 0 && state.fromCalls.length === 0, state.fromCalls);
      check("publish gate: a guest cannot publish (PATCH) or delete a job by id", (patch.status === 401 || patch.status === 403) && (del.status === 401 || del.status === 403), [patch.status, del.status]);
    }

    // ── 18e. the AI job-description writer: 1/day for a guest ──
    {
      resetWorld();
      state.claudeText = "A polished, inclusive job description.";
      const notes = "We need a customer success manager who owns renewals and onboarding.";
      const g = visitor();
      const r1 = await g.send("employer/jobs/assist", { body: { title: "CSM", notes } });
      check("JD writer: a guest gets one description a day (200, flagged guest)", r1.status === 200 && r1.json.description === "A polished, inclusive job description." && r1.json.guest === true, r1.json);
      check("JD writer: ...it reserved exactly one employer-jd use, and recorded the spend", quotaTotal("employer-jd") === 1 && state.spendMicro > 0 && insertsTo("job_postings") === 0);
      const r2 = await g.send("employer/jobs/assist", { body: { title: "CSM", notes } });
      check("JD writer: the 2nd request the same day is 402 guest_quota with the employer wording", r2.status === 402 && r2.json.error === "guest_quota" && r2.json.tool === "employer-jd" && r2.json.limit === 1 && r2.json.guest === true && r2.json.message === EMPLOYER_MSG, r2.json);
      check("JD writer: ...and Claude was called exactly once", state.claudeCalls.length === 1);
      const g2 = visitor();
      const r3 = await g2.send("employer/jobs/assist", { body: { notes } });
      check("JD writer: a different visitor has their own allowance", r3.status === 200);
      const g3 = visitor();
      const short = await g3.send("employer/jobs/assist", { body: { notes: "hi" } });
      check("JD writer: too-short notes are a 400 and take no allowance", short.status === 400 && quotaTotal("employer-jd") === 2);
      state.claudeFail = 500;
      const origErr = console.error; console.error = () => {};
      const fail = await g3.send("employer/jobs/assist", { body: { notes } });
      console.error = origErr;
      state.claudeFail = null;
      const retry = await g3.send("employer/jobs/assist", { body: { notes } });
      check("JD writer: a failed Claude call is refunded — the guest's one try is still theirs", fail.status === 500 && retry.status === 200, [fail.status, retry.status]);
      const g4 = visitor();
      state.claudeCalls.length = 0;
      await g4.send("employer/jobs/assist", { body: { notes: "x".repeat(50000) } });
      const sent = state.claudeCalls[0] ? JSON.stringify(state.claudeCalls[0].messages) : "";
      check("JD writer: a guest's notes are capped before they reach the model", sent.length > 0 && sent.length < 9000, sent.length);
      state.spendMicro = 26 * 1e6;
      const cap = await visitor().send("employer/jobs/assist", { body: { notes } });
      check("JD writer: held back (503 guest_capacity) once today's anonymous spend ceiling trips", cap.status === 503 && cap.json.error === "guest_capacity" && cap.json.guest === true, cap.json);
      resetWorld();
      state.userId = "cand_1"; state.plan = "pro";
      const nonEmp = await visitor().send("employer/jobs/assist", { body: { notes } });
      check("JD writer: a signed-in non-employer is still 403 — no model call, no guest allowance", nonEmp.status === 403 && state.claudeCalls.length === 0 && state.rpcCalls.length === 0, nonEmp.status);
      resetWorld();
      state.userId = "emp_1"; state.plan = "employer";
      const emp = await visitor().send("employer/jobs/assist", { body: { notes } });
      const emp2 = await visitor().send("employer/jobs/assist", { body: { notes } });
      check("JD writer: a signed-in employer is unchanged — unmetered, no guest flag, no quota rows", emp.status === 200 && emp2.status === 200 && emp.json.guest === undefined && state.rpcCalls.length === 0 && state.quotas.size === 0, [emp.status, emp2.status, emp.json]);
      resetWorld();
    }

    // ── 18f. demo mode: a guest sees demo data and ONLY demo data ──
    {
      resetWorld();
      const origErr = console.error; console.error = () => {};
      const nameOf = (n) => (n && n.type && (n.type.displayName || n.type.name)) || "";
      // collect every id-ish value, every string and every component name in an element tree's props
      const harvest = (node, acc = { ids: [], strings: [], types: [] }, depth = 0) => {
        if (depth > 40 || node == null) return acc;
        if (typeof node === "string") { acc.strings.push(node); return acc; }
        if (typeof node !== "object") return acc;
        if (Array.isArray(node)) { node.forEach((n) => harvest(n, acc, depth + 1)); return acc; }
        if (node.type) acc.types.push(nameOf(node));
        const bag = node.props || node;
        for (const [k, v] of Object.entries(bag)) {
          if ((k === "id" || k === "jobId" || k === "applicantId") && typeof v === "number") acc.ids.push(v);
          if (k === "employerId" || k === "userId") acc.ids.push(`${k}:${String(v)}`);
          harvest(v, acc, depth + 1);
        }
        return acc;
      };
      const jobsPage = require(path.join(ROOT, "app/employer/jobs/page.tsx")).default;
      const candPage = require(path.join(ROOT, "app/employer/candidates/page.tsx")).default;
      const dashPage = require(path.join(ROOT, "app/employer/page.tsx")).default;
      const layout = require(path.join(ROOT, "app/employer/layout.tsx")).default;

      state.userId = null;
      const jobsEl = await jobsPage({ searchParams: {} });
      const candEl = await candPage({ searchParams: { jobId: "1" } });
      const dashEl = await dashPage();
      const layEl = await layout({ children: "CHILD" });
      const j = harvest(jobsEl), c = harvest(candEl), d = harvest(dashEl), l = harvest(layEl);
      const allIds = [...j.ids, ...c.ids, ...d.ids, ...l.ids];
      check("demo[guest]: the pages render the demo job, 8 demo candidates and a demo layout", nameOf(jobsEl) === "JobsClient" && nameOf(candEl) === "DemoPipeline" && j.ids.includes(demo.DEMO_JOB_ID) && c.ids.filter((x) => x < -100).length === 8 && l.types.includes("EmployerDemoProvider"), { j: j.ids, c: c.ids, l: l.types });
      check("demo[guest]: EVERY id in EVERY guest response is a demo fixture id (all negative; no real row can have one)", allIds.length > 0 && allIds.every((x) => typeof x === "number" && demo.isDemoId(x) && x < 0), allIds);
      check("demo[guest]: ...even when the URL asks for a real job (?jobId=1) — the request cannot select data", c.ids.every((x) => demo.isDemoId(x)));
      check("demo[guest]: rendering them read no table, called no model, reserved nothing — there is nothing real to leak", state.fromCalls.length === 0 && state.claudeCalls.length === 0 && state.rpcCalls.length === 0 && state.inserts.length === 0, state.fromCalls);
      const cands = demo.DEMO_CANDIDATES;
      const stagesUsed = new Set(cands.map((x) => x.status));
      check("demo[guest]: 1 job and 6-8 candidates spread across the pipeline stages (Kanban columns)", cands.length >= 6 && cands.length <= 8 && stagesUsed.size >= 5 && [...stagesUsed].every((x) => demo.DEMO_STAGES.includes(x)), [...stagesUsed]);
      check("demo[guest]: sample candidates use example.com addresses only (reserved — never a real person's)", cands.every((x) => /@example\.com$/.test(x.email)));
      const emails = [...j.strings, ...c.strings, ...d.strings].filter((x) => /@/.test(x));
      check("demo[guest]: the only email-like strings in a guest's pages are the example.com fixtures", emails.every((x) => /@example\.com$/.test(x)), emails);
      const dashStats = demo.demoStats();
      check("demo[guest]: dashboard numbers come from the fixtures (1 job, 8 applicants)", dashStats.activeJobs === 1 && dashStats.totalApplicants === 8);
      check("demo[guest]: the demo job is never listed on the public board", jobsEl.props.demoJob.publicListed === false && jobsEl.props.demoJob.status === "active");
      const keys = ["title", "department", "location", "description", "benefits", "req1", "req2", "req3"];
      check("demo: every fixture has its copy under employerDemo (job + each candidate headline)", keys.every((k) => typeof EN.employerDemo.job[k] === "string") && cands.every((x) => typeof EN.employerDemo.candidates[x.key] === "string"));

      resetWorld();
      state.userId = "emp_1"; state.plan = "employer";
      const sJobs = await jobsPage({ searchParams: {} });
      const sCand = await candPage({ searchParams: { jobId: "7" } });
      const sLay = await layout({ children: "CHILD" });
      const sl = harvest(sLay);
      check("demo[employer]: a signed-in employer gets the REAL clients (no demoJob, no demo pipeline, no demo provider)", nameOf(sJobs) === "JobsClient" && sJobs.props.demoJob === undefined && nameOf(sCand) === "CandidatesClient" && sCand.props.initialJobId === 7 && !sl.types.includes("EmployerDemoProvider") && sl.types.includes("EmployerDraftRestorer") && sl.types.includes("DashboardShell"), { sl: sl.types, sjobs: nameOf(sJobs), scand: nameOf(sCand) });
      check("demo[employer]: ...and the layout reads the real workspace (the store is consulted)", state.fromCalls.length > 0);
      resetWorld();
      state.userId = "cand_1"; state.plan = "pro";
      const nl = harvest(await layout({ children: "CHILD" }));
      check("demo[non-employer]: a signed-in candidate still gets the locked-feature gate, never the demo", !nl.types.includes("EmployerDemoProvider") && nl.types.includes("LockedFeature"), nl.types);
      console.error = origErr;
      resetWorld();
    }
  }

  // ═══ 19. fail closed: a reserve that cannot be made NEVER lets the request through ═══
  {
    const guest = load("lib/guest.ts");
    const boot = load("lib/boot-checks.ts");
    const mkReq = (ip = "203.0.113.200", cookie) => new Request(`${URLBASE}/api/x`, { method: "POST", headers: { "cf-connecting-ip": ip, ...(cookie ? { cookie: `rt_guest=${cookie}` } : {}) } });
    const origErr = console.error; const origLog = console.log;
    const quiet = () => { console.error = () => {}; console.log = () => {}; };
    const loud = () => { console.error = origErr; console.log = origLog; };

    // 19a. every way the reserve RPC can go wrong is a 503, never a pass
    const ok = (data) => () => Promise.resolve({ data, error: null });
    const outcomes = {
      "an error object (permission denied)": () => Promise.resolve({ data: null, error: { code: "42501", message: "permission denied for function guest_quota_reserve" } }),
      "an error object (function not in the schema cache)": () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function public.guest_quota_reserve" } }),
      "a thrown exception": () => { throw new Error("socket hang up"); },
      "a rejected promise": () => Promise.reject(new Error("fetch failed")),
      "data: null": ok(null),
      "data: undefined": ok(undefined),
      'data: ""': ok(""),
      'data: "OK" (wrong case)': ok("OK"),
      'data: " ok" (padded)': ok(" ok"),
      "data: true": ok(true),
      "data: {}": ok({}),
      'data: ["ok"] (array)': ok(["ok"]),
      'data: "allow"': ok("allow"),
      'data: {result:"ok"}': ok({ result: "ok" }),
    };
    const leaked = [];
    for (const [label, impl] of Object.entries(outcomes)) {
      resetWorld();
      state.rpcOverride = impl;
      quiet();
      const r = await guest.guestReserve(mkReq(nextIp()), "employer-jd");
      loud();
      if (r.ok) { leaked.push(label); continue; }
      const body = await r.response.clone().json();
      if (r.response.status !== 503 || body.error !== "guest_unavailable" || body.guest !== true) leaked.push(`${label}: ${r.response.status} ${JSON.stringify(body)}`);
    }
    check(`fail-closed: all ${Object.keys(outcomes).length} ways the reserve RPC can fail or return junk decline the guest with 503 guest_unavailable (none proceeds)`, leaked.length === 0, leaked);
    resetWorld();
    state.rpcOverride = ok("ok");
    check('fail-closed: ...and exactly the string "ok" is the only thing that passes', (await guest.guestReserve(mkReq(nextIp()), "employer-jd")).ok === true);
    resetWorld();
    state.spendError = true;
    quiet();
    const sp = await guest.guestReserve(mkReq(nextIp()), "employer-jd");
    loud();
    check("fail-closed: an unreadable spend total declines a Claude-calling tool (503), without reserving", !sp.ok && sp.response.status === 503 && state.rpcCalls.length === 0);
    resetWorld();
    const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL };
    // (getDb caches its client; the missing-credentials branch is covered by test-guest-http's boot checks)

    // 19b. through the real routes: a reserve failure refuses the request and never reaches Claude
    const routeCases = [
      ["tailor", tailorBody(), "tailor"],
      ["employer/jobs/assist", { title: "CSM", notes: "We need a customer success manager who owns renewals and onboarding." }, "employer-jd"],
      ["ats-scan", { resume: RESUME, jobPosting: JOB }, "ats-scan"],
      ["interview/questions", { jobDescription: JOB + " " + JOB }, "interview-questions"],
      ["decoder/decode", { jobDescription: JOB }, "decoder-decode"],
    ];
    const routeLeaks = [];
    for (const mode of ["rpc error", "rpc throws", "junk value"]) {
      for (const [r, body, tool] of routeCases) {
        resetWorld();
        state.rpcOverride = mode === "rpc error" ? () => Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } }) : mode === "rpc throws" ? () => { throw new Error("boom"); } : ok({ weird: true });
        quiet();
        const res = await visitor().send(r, { body });
        loud();
        if (res.status !== 503 || res.json.error !== "guest_unavailable" || state.claudeCalls.length !== 0 || quotaTotal(tool) !== 0) routeLeaks.push(`${r} [${mode}]: ${res.status} claude=${state.claudeCalls.length}`);
      }
    }
    check(`fail-closed: ${routeCases.length} gated routes x 3 failure modes -> 503, Claude NOT called, nothing reserved`, routeLeaks.length === 0, routeLeaks);

    // 19c. every guest-gated route follows the reserve with "refuse unless ok" — no swallowed reserve, no try/catch around it
    {
      const apiRoot = path.join(ROOT, "app/api");
      const bad = [];
      let n = 0;
      (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { walk(full); continue; }
          if (e.name !== "route.ts") continue;
          const src = fs.readFileSync(full, "utf8");
          if (!/guestReserve\(/.test(src)) continue;
          n++;
          const rel = path.relative(apiRoot, dir);
          const m = src.match(/const (\w+) = await guestReserve\(/);
          if (!m) { bad.push(`${rel}: guestReserve result is not bound to a variable`); continue; }
          const v = m[1];
          const after = src.slice(src.indexOf(m[0]));
          if (!new RegExp(`^[^\\n]*\\n?\\s*if \\(!${v}\\.ok\\) return ${v}\\.response;`).test(after)) bad.push(`${rel}: the reserve is not immediately followed by "if (!${v}.ok) return ${v}.response;"`);
          const head = src.slice(0, src.indexOf(m[0]));
          const opens = (head.match(/\btry\s*\{/g) || []).length, closes = (head.match(/\}\s*catch\b/g) || []).length;
          if (opens > closes) bad.push(`${rel}: guestReserve sits inside a try block`);
          if (!/withGuestCookie\(/.test(src)) bad.push(`${rel}: not wrapped in withGuestCookie`);
        }
      })(apiRoot);
      check(`fail-closed: all ${n} routes that reserve a guest allowance refuse on !ok immediately, outside any try, wrapped in withGuestCookie`, n >= 18 && bad.length === 0, bad);
    }

    // 19d. the reserve line says which bucket a request landed in, and never leaks the address or cookie
    {
      resetWorld();
      const lines = [];
      console.log = (...a) => lines.push(a.join(" "));
      console.error = () => {};
      const secretCookie = "SeCrEtCoOkIeValue123456";
      await guest.guestReserve(mkReq("198.51.100.123", secretCookie), "employer-jd");
      await guest.guestReserve(mkReq("198.51.100.123"), "employer-jd");
      loud();
      const [first, second] = lines.filter((l) => l.startsWith("[guest] reserve"));
      check("diagnostics: each reserve logs tool, outcome, a salted guest id, the ip bucket, the header the address came from and whether the cookie was sent", /tool=employer-jd outcome=ok guest=[0-9a-f]{8} ip=[0-9a-f]{8} ipSource=cf-connecting-ip cookie=sent/.test(first || "") && /cookie=minted/.test(second || ""), lines);
      check("diagnostics: ...with no raw IP and no cookie value in the log", !lines.join("\n").includes("198.51.100.123") && !lines.join("\n").includes(secretCookie));
      const { describeClientIp } = load("lib/client-ip.ts");
      const dc = (headers, ip) => describeClientIp(Object.assign(new Request(URLBASE, { headers }), ip ? { ip } : {}));
      check("diagnostics: describeClientIp reports cf-connecting-ip / request.ip / x-forwarded-for (rightmost) / none", dc({ "cf-connecting-ip": "198.51.100.1" }).source === "cf-connecting-ip" && dc({}, "198.51.100.2").source === "request.ip" && dc({ "x-forwarded-for": "6.6.6.6, 198.51.100.3" }).ip === "198.51.100.3" && dc({ "x-forwarded-for": "6.6.6.6, 198.51.100.3" }).source === "x-forwarded-for" && dc({}).source === "none");
    }

    // 19e. the auditor's repro, and the design edge it hides
    {
      resetWorld();
      state.claudeText = "A polished description.";
      const notes = "We need a customer success manager who owns renewals and onboarding.";
      const g = visitor();
      const a = await g.send("employer/jobs/assist", { body: { title: "CSM", notes } });
      const jar = g.jar;
      const b = await g.send("employer/jobs/assist", { body: { title: "CSM", notes } });
      check("repro: a fresh guest — 1st Improve succeeds (sets rt_guest), 2nd returns 402 guest_quota", a.status === 200 && /rt_guest=/.test(a.setCookie || "") && jar && b.status === 402 && b.json.error === "guest_quota", [a.status, b.status]);
      // a client that never sends the cookie back (cleared cookies, private windows, a script with no jar)
      resetWorld();
      state.claudeText = "x";
      const ip = nextIp();
      const codes = [];
      for (let i = 0; i < 12; i++) {
        const r = await route("employer/jobs/assist").POST(new Request(`${URLBASE}/api/employer/jobs/assist`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ notes }) }));
        codes.push(r.status);
      }
      check("repro: a client that NEVER returns the cookie gets one use per request up to the per-IP ceiling (10x the cap), then 402 scope:network — the documented cookie-less bound", codes.slice(0, 10).every((c) => c === 200) && codes.slice(10).every((c) => c === 402), codes.join());
    }

    // 19f. the boot-time self-test exercises the real functions and says so
    {
      resetWorld();
      const st = await guest.guestSelfTest();
      check("self-test: passes against a store that implements reserve / cap / refund", st.ok === true, st);
      check("self-test: ...ran reserve, reserve (cap), refund, reserve through the RPCs, and removed its own rows", state.rpcCalls.map((c) => c.name).join() === "guest_quota_reserve,guest_quota_reserve,guest_quota_refund,guest_quota_reserve" && state.deletes.some((d) => d.table === "guest_quotas" && d.filters.tool === "selftest"), { calls: state.rpcCalls.map((c) => c.name), deletes: state.deletes });
      resetWorld();
      state.rpcOverride = () => Promise.resolve({ data: "ok", error: null }); // a store whose cap never fires
      const noCap = await guest.guestSelfTest();
      check("self-test: FAILS (at the cap step) against a store that always says ok — exactly the silent-unlimited symptom", noCap.ok === false && /reserve #2/.test(noCap.step) && /NOT enforcing/.test(noCap.detail), noCap);
      resetWorld();
      state.rpcOverride = () => Promise.resolve({ data: null, error: { code: "42501", message: "permission denied for function guest_quota_reserve" } });
      const denied = await guest.guestSelfTest();
      check("self-test: FAILS with the database's own error text when the function is not callable", denied.ok === false && /permission denied/.test(denied.detail), denied);
      resetWorld();
      state.rpcOverride = () => { throw new Error("socket hang up"); };
      const thrown = await guest.guestSelfTest();
      check("self-test: never throws — a crashing store is a reported failure", thrown.ok === false);
      // the boot wrapper turns the result into one clear log line
      const logs = [];
      const e2 = console.error, l2 = console.log;
      console.log = (...a) => logs.push("LOG " + a.join(" ")); console.error = (...a) => logs.push("ERR " + a.join(" "));
      boot.startGuestSelfTest(async () => ({ ok: true }), 0);
      boot.startGuestSelfTest(async () => ({ ok: false, step: "reserve #2 (the cap)", detail: "not enforcing" }), 0);
      boot.startGuestSelfTest(async () => { throw new Error("kaboom"); }, 0);
      await new Promise((r) => setTimeout(r, 30));
      console.log = l2; console.error = e2;
      check("self-test: boot wrapper logs OK / FAILED (with step and detail) / CRASHED", logs.some((l) => /^LOG \[guest\] self-test OK/.test(l)) && logs.some((l) => /^ERR \[guest\] SELF-TEST FAILED at "reserve #2 \(the cap\)": not enforcing/.test(l)) && logs.some((l) => /^ERR \[guest\] SELF-TEST CRASHED: kaboom/.test(l)), logs);
    }
    // 19g. a Supabase client that cannot even be created is a 503 JSON decline, not an uncaught 500
    {
      resetWorld();
      for (const k of Object.keys(require.cache)) if (k.endsWith("lib/guest.ts")) delete require.cache[k];
      state.createClientThrows = true;
      const fresh = load("lib/guest.ts");
      quiet();
      const r = await fresh.guestReserve(mkReq(nextIp()), "employer-jd");
      loud();
      state.createClientThrows = false;
      for (const k of Object.keys(require.cache)) if (k.endsWith("lib/guest.ts")) delete require.cache[k];
      check("fail-closed: createClient throwing -> 503 guest_unavailable (JSON), not an uncaught exception", !r.ok && r.response.status === 503 && (await r.response.clone().json()).error === "guest_unavailable");
    }
    // 19h. an unexpected throw inside the JD route still answers JSON with an `error` the UI can show
    {
      resetWorld();
      state.authThrows = true; // Clerk's auth() throwing is the kind of failure that sits outside every inner try
      quiet();
      const r = await visitor().send("employer/jobs/assist", { body: { notes: "We need a customer success manager who owns renewals." } });
      loud();
      state.authThrows = false;
      check("JD writer: an unexpected throw (Clerk auth() failing) is a JSON 500 with an `error`, never a bare 500 — and nothing is reserved", r.status === 500 && typeof r.json?.error === "string" && quotaTotal("employer-jd") === 0, [r.status, r.json]);
    }
    resetWorld();
    void saved;
  }

  // ═══ 20. "free runs left": a guest's responses report { guest, tool, limit, used } ═══
  {
    resetWorld();
    state.claudeText = "A polished description.";
    const notes = "We need a customer success manager who owns renewals and onboarding.";
    const g = visitor();
    const t1 = await g.send("tailor", { body: tailorBody() });
    check("usage: a guest's 1st tailor reports tool, limit 1 and used 1", t1.status === 200 && t1.json.guest === true && t1.json.tool === "tailor" && t1.json.limit === 1 && t1.json.used === 1, t1.json);
    const t2 = await g.send("tailor", { body: tailorBody() });
    check("usage: ...and the 402 is unchanged in shape, with used === limit", t2.status === 402 && t2.json.error === "guest_quota" && t2.json.tool === "tailor" && t2.json.limit === 1 && t2.json.used === 1 && t2.json.guest === true && t2.json.message === MSG("resume tailoring"), t2.json);
    const c1 = await g.send("cover-letter", { body: { name: "Jane", company: "Stripe", role: "Nurse", jobPosting: JOB, highlights: "ICU" } });
    check("usage: a guest's cover letter reports used 1 of 1", c1.status === 200 && c1.json.tool === "cover-letter" && c1.json.used === 1 && c1.json.limit === 1, c1.json);
    const a = [];
    state.claudeText = '{"score":72,"verdict":"Good","matched":["icu"],"missing":["bls"],"suggestions":["Add BLS"]}';
    for (let i = 0; i < 4; i++) a.push(await g.send("ats-scan", { body: { resume: RESUME, jobPosting: JOB } }));
    check("usage: ats-scan counts 1, 2, 3 of 3 — each response carries its own used (the decrement the UI shows)", a.slice(0, 3).map((r) => r.status === 200 && r.json.tool === "ats-scan" && r.json.limit === 3 ? r.json.used : null).join() === "1,2,3", a.map((r) => [r.status, r.json && r.json.used]));
    check("usage: ...the 4th is the usual 402 (used 3 of 3)", a[3].status === 402 && a[3].json.error === "guest_quota" && a[3].json.used === 3 && a[3].json.limit === 3, a[3].json);
    state.claudeText = "A polished description.";
    const j = visitor();
    const jd = await j.send("employer/jobs/assist", { body: { title: "CSM", notes } });
    check("usage: the employer JD writer reports tool employer-jd, used 1 of 1", jd.status === 200 && jd.json.tool === "employer-jd" && jd.json.used === 1 && jd.json.limit === 1 && jd.json.description, jd.json);
    // a failed call is refunded, so it is not reported as a use
    state.claudeFail = true;
    const f = visitor();
    const failed = await f.send("employer/jobs/assist", { body: { title: "CSM", notes } });
    state.claudeFail = false;
    const afterFail = await f.send("employer/jobs/assist", { body: { title: "CSM", notes } });
    check("usage: a failed (refunded) call is not a use — the retry still reports used 1", failed.status === 500 && afterFail.status === 200 && afterFail.json.used === 1, [failed.status, afterFail.json]);
    // the count cannot be read: the run still succeeds, it just does not claim a number
    {
      const h = visitor();
      const origSelect = fakeDb.from;
      fakeDb.from = (table) => (table === "guest_quotas" ? { select: () => ({ eq: function eq() { return { eq: eq, maybeSingle: async () => { throw new Error("boom"); } }; } }) } : origSelect(table));
      const r = await h.send("tailor", { body: tailorBody() });
      fakeDb.from = origSelect;
      check("usage: an unreadable count never breaks the run — 200 with guest:true and limit, no `used`", r.status === 200 && r.json.guest === true && r.json.limit === 1 && !("used" in r.json) && r.json.result, r.json);
    }
    // signed-in: none of it
    state.userId = "user_123";
    const sTailor = await visitor().send("tailor", { body: tailorBody() });
    state.claudeText = '{"score":72,"verdict":"Good","matched":["icu"],"missing":["bls"],"suggestions":["Add BLS"]}';
    const sAts = await visitor().send("ats-scan", { body: { resume: RESUME, jobPosting: JOB } });
    state.userId = null;
    check("usage: a signed-in user's responses carry no guest/used/limit/tool", [sTailor, sAts].every((r) => r.status === 200 && !("guest" in r.json) && !("used" in r.json) && !("limit" in r.json) && !("tool" in r.json)), [sTailor.json, sAts.json]);
  }

  // ═══ 20b. GET /api/guest/usage — the page-load read behind the "free runs left" note ═══
  {
    resetWorld();
    state.claudeText = '{"score":72,"verdict":"Good","matched":["icu"],"missing":["bls"],"suggestions":["Add BLS"]}';
    const peek = (v, tool) => route("guest/usage").GET(new Request(`${URLBASE}/api/guest/usage?tool=${tool}`, { headers: { "cf-connecting-ip": v.ip, ...(v.jar ? { cookie: v.jar } : {}) } }));
    const body = async (r) => r.clone().json();
    const g = visitor();
    check("usage GET: an untouched guest reads used 0 of the tool's limit", (await body(await peek(g, "ats-scan"))).used === 0 && (await body(await peek(g, "ats-scan"))).limit === 3);
    await g.send("ats-scan", { body: { resume: RESUME, jobPosting: JOB } });
    await g.send("ats-scan", { body: { resume: RESUME, jobPosting: JOB } });
    const two = await peek(g, "ats-scan");
    check("usage GET: after two scans it reads { guest:true, tool, used:2, limit:3 }", JSON.stringify(await body(two)) === '{"guest":true,"tool":"ats-scan","used":2,"limit":3}', await body(two));
    for (let i = 0; i < 3; i++) await g.send("ats-scan", { body: { resume: RESUME, jobPosting: JOB } });
    check("usage GET: fully used reads used === limit (3 of 3), never more", (await body(await peek(g, "ats-scan"))).used === 3);
    const rpcMid = state.rpcCalls.length, insMid = state.inserts.length, claudeMid = state.claudeCalls.length;
    await peek(g, "ats-scan");
    check("usage GET: read-only — no reserve/refund RPC, no insert, no model call", state.rpcCalls.length === rpcMid && state.inserts.length === insMid && state.claudeCalls.length === claudeMid, [state.rpcCalls.length - rpcMid, state.inserts.length - insMid, state.claudeCalls.length - claudeMid]);
    const quotaBefore = JSON.stringify([...state.quotas]);
    await peek(g, "ats-scan");
    check("usage GET: ...and it does not change the stored counts", JSON.stringify([...state.quotas]) === quotaBefore);
    const res = await peek(g, "tailor");
    check("usage GET: mints no cookie and is not cacheable", !res.headers.get("set-cookie") && /no-store/.test(res.headers.get("cache-control") || ""));
    check("usage GET: one tool's count is not another's (tailor still 0)", (await body(res)).used === 0);
    const other = visitor();
    check("usage GET: a different visitor (own IP + cookie) reads 0", (await body(await peek(other, "ats-scan"))).used === 0);
    const bad = await peek(g, "nope"); const proto = await peek(g, "constructor"); const none = await route("guest/usage").GET(new Request(`${URLBASE}/api/guest/usage`, { headers: { "cf-connecting-ip": g.ip } }));
    check("usage GET: an unknown, prototype-key or missing tool is a 400", bad.status === 400 && proto.status === 400 && none.status === 400, [bad.status, proto.status, none.status]);
    state.userId = "user_123";
    const selBefore = state.selects.length;
    const signed = await peek(g, "ats-scan");
    state.userId = null;
    check("usage GET: signed in -> { guest:false } and the quota table is not even read", (await body(signed)).guest === false && !("used" in (await body(signed))) && state.selects.length === selBefore, [await body(signed), state.selects.length - selBefore]);
    const origFrom = fakeDb.from;
    fakeDb.from = (table) => (table === "guest_quotas" ? { select: () => ({ eq: function eq() { return { eq, maybeSingle: async () => { throw new Error("boom"); } }; } }) } : origFrom(table));
    const down = await peek(g, "ats-scan");
    fakeDb.from = origFrom;
    check("usage GET: a store error reads as used 0 (the note stays hidden), never a 500", down.status === 200 && (await body(down)).used === 0);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) { console.error("\nFAILED"); process.exit(1); }
  console.log("ALL PASS");
})().catch((e) => { console.error("TEST HARNESS ERROR", e); process.exit(1); });
