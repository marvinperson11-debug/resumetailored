#!/usr/bin/env node
/**
 * Application Tracker (Combined Build: Kanban, self-filling clip, ATS link,
 * attribution report, channel off-signal) — npm run test:tracker.
 *
 * Sibling to scripts/test-employer-assistant.cjs rather than an addition to
 * it: that file already exercises the channel-disable / merge-semantics
 * regression (Section 5) directly against its own proven fake Postgres,
 * since it touches EXISTING tables (job_distribution) that harness already
 * supports end to end. Everything here is net-new surface (tracked_applications,
 * application_events, tracked_application_ats_scores) with its own minimal
 * fake Supabase client — built to the exact subset of PostgREST chain calls
 * lib/tracker-store.ts and lib/attribution-store.ts actually issue, not a
 * general-purpose mock.
 *
 * Three layers:
 *   - Pure logic (lib/tracker-core.ts, lib/clip-extract.ts,
 *     lib/safe-fetch.ts, lib/attribution-report.ts): exact-value assertions,
 *     no mocking, no network.
 *   - Store-level CRUD (lib/tracker-store.ts, lib/attribution-store.ts)
 *     against the fake Postgres below.
 *   - Route-level (app/api/tracker/**, app/api/employer/attribution,
 *     app/api/employer/jobs/[id]/channels) driven through the REAL route
 *     handlers with a faked @clerk/nextjs/server auth() and the fake
 *     Supabase client.
 */
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

process.env.ANTHROPIC_API_KEY = "sk-ant-test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
process.env.GUEST_QUOTA_SALT = "test-only-guest-quota-salt-0123456789";
process.env.TOOLS_HASH_SALT = "test-only-tools-hash-salt-0123456789";

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

// ── fake world: Clerk + a minimal Postgres over state.tables ────────────────
const state = { userId: null, tables: {} };
function resetWorld() {
  state.userId = null;
  state.tables = { tracked_applications: [], application_events: [], tracked_application_ats_scores: [], applicants: [], job_postings: [], employer_profiles: [], career_sites: [] };
}
resetWorld();

let idCounter = 1;
function newId() {
  return `id_${idCounter++}`;
}

function matches(row, filters) {
  return filters.every((f) => {
    const v = row[f.col];
    if (f.op === "eq") return v === f.val;
    if (f.op === "in") return (f.val || []).includes(v);
    if (f.op === "not_in") return !(f.val || []).includes(v);
    if (f.op === "ilike") return typeof v === "string" && v.toLowerCase() === String(f.val).toLowerCase();
    return true;
  });
}

// Real Postgres applies column DEFAULTs on INSERT (migrations 0078/0079/0080);
// this fake has no schema, so it must apply the same defaults explicitly or
// a column the code never sets on create (relying on the DB default, exactly
// as lib/tracker-store.ts does for `archived`/`nudges_off`) would come back
// `undefined` instead of `false` and silently break every `.eq(col, false)`
// filter downstream.
const TABLE_DEFAULTS = {
  tracked_applications: { archived: false, nudges_off: false, notes: [], stage: "Clipped" },
};

function chainFor(table) {
  const ctx = { op: "select", filters: [], insertRows: null, updateRow: null, order: null, limit: null, single: false, maybeSingle: false };
  const rows = () => state.tables[table] || (state.tables[table] = []);
  const exec = () => {
    if (ctx.op === "insert") {
      const defaults = TABLE_DEFAULTS[table] || {};
      const inserted = ctx.insertRows.map((r) => ({ id: r.id || newId(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...defaults, ...r }));
      rows().push(...inserted);
      const result = inserted;
      if (ctx.single) return { data: result[0] || null, error: result.length ? null : { message: "insert failed" } };
      return { data: result, error: null };
    }
    if (ctx.op === "upsert") {
      // TRUE upsert (replace-by-conflict-key), unlike test-employer-assistant.cjs's
      // append-only mock — job_distribution's real primary key is job_id, so
      // a second approval for the same job REPLACES the row, never appends a
      // second one. This is what makes the feed-removal round-trip test below
      // meaningful: with append-only semantics, an earlier still-enabled row
      // would linger and the feed route would wrongly keep listing a job
      // that's since been disabled.
      const onConflict = ctx.onConflict || "id";
      const result = ctx.insertRows.map((r) => {
        const existing = rows().find((row) => row[onConflict] === r[onConflict]);
        if (existing) {
          Object.assign(existing, r);
          return existing;
        }
        const fresh = { id: r.id || newId(), created_at: new Date().toISOString(), ...r };
        rows().push(fresh);
        return fresh;
      });
      if (ctx.single) return { data: result[0] || null, error: result.length ? null : { message: "upsert failed" } };
      return { data: result, error: null };
    }
    if (ctx.op === "update") {
      const all = rows();
      const touched = all.filter((r) => matches(r, ctx.filters));
      touched.forEach((r) => Object.assign(r, ctx.updateRow));
      if (ctx.single) return { data: touched[0] || null, error: touched.length ? null : { message: "not found" } };
      if (ctx.maybeSingle) return { data: touched[0] || null, error: null };
      return { data: touched, error: null };
    }
    if (ctx.op === "delete") {
      const all = rows();
      const kept = all.filter((r) => !matches(r, ctx.filters));
      const removed = all.length - kept.length;
      state.tables[table] = kept;
      return { data: null, error: removed ? null : null };
    }
    // select
    let filtered = rows().filter((r) => matches(r, ctx.filters));
    if (ctx.order) filtered = [...filtered].sort((a, b) => (ctx.order.asc ? 1 : -1) * (a[ctx.order.col] > b[ctx.order.col] ? 1 : a[ctx.order.col] < b[ctx.order.col] ? -1 : 0));
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
    not(col, op, val) {
      // lib/tracker-store.ts only ever calls .not("event", "in", "(a,b)") — parse that one shape.
      const m = /^\((.*)\)$/.exec(val || "");
      ctx.filters.push({ op: "not_in", col, val: m ? m[1].split(",") : [] });
      return builder;
    },
    ilike(col, val) {
      ctx.filters.push({ op: "ilike", col, val });
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
    upsert(rowsIn, opts) {
      ctx.op = "upsert";
      ctx.insertRows = Array.isArray(rowsIn) ? rowsIn : [rowsIn];
      ctx.onConflict = opts?.onConflict || "id";
      return builder;
    },
    insert(rowsIn) {
      ctx.op = "insert";
      ctx.insertRows = Array.isArray(rowsIn) ? rowsIn : [rowsIn];
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

const fakeDb = { from: (table) => chainFor(table) };

const mocks = {
  "@clerk/nextjs/server": () => ({
    auth: async () => ({ userId: state.userId }),
  }),
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
  // ═══ 1. lib/tracker-core.ts — pure Kanban/nudge/honesty-rule logic ═══
  {
    const core = load("lib/tracker-core.ts");
    check("TRACKER_STAGES is exactly the six Kanban columns, in order", core.TRACKER_STAGES.join(",") === "Clipped,Applied,Interviewing,Offer,Rejected,Withdrawn");
    check("isTrackerStage accepts a real stage", core.isTrackerStage("Applied") === true);
    check("isTrackerStage rejects junk", core.isTrackerStage("Hired") === false && core.isTrackerStage(42) === false);

    // Stage-dwell nudges.
    const now = Date.now();
    const dayMs = 86_400_000;
    const appliedRef14 = new Date(now - 14 * dayMs - 1000).toISOString();
    check(
      "checkDwellNudge: Applied dwelling >=14d is due",
      core.checkDwellNudge({ stage: "Applied", referenceTime: appliedRef14, nudgesOff: false }, now).due === true
    );
    const appliedRef13 = new Date(now - 13 * dayMs).toISOString();
    check(
      "checkDwellNudge: Applied dwelling 13d is NOT due yet",
      core.checkDwellNudge({ stage: "Applied", referenceTime: appliedRef13, nudgesOff: false }, now).due === false
    );
    const interviewRef7 = new Date(now - 7 * dayMs - 1000).toISOString();
    check(
      "checkDwellNudge: Interviewing dwelling >=7d is due",
      core.checkDwellNudge({ stage: "Interviewing", referenceTime: interviewRef7, nudgesOff: false }, now).due === true
    );
    check(
      "checkDwellNudge: a per-tracker nudgesOff switch suppresses the nudge even past the window",
      core.checkDwellNudge({ stage: "Applied", referenceTime: appliedRef14, nudgesOff: true }, now).due === false
    );
    check(
      "checkDwellNudge: Clipped/Offer/Rejected/Withdrawn never dwell-nudge, no matter how old",
      ["Clipped", "Offer", "Rejected", "Withdrawn"].every((stage) => core.checkDwellNudge({ stage, referenceTime: new Date(now - 999 * dayMs).toISOString(), nudgesOff: false }, now).due === false)
    );
    check(
      "nudgeWindowDays is env-overridable for tests (live verification checklist shortens the window)",
      (() => {
        process.env.TRACKER_NUDGE_APPLIED_DAYS = "1";
        const v = core.nudgeWindowDays("Applied");
        delete process.env.TRACKER_NUDGE_APPLIED_DAYS;
        return v === 1;
      })()
    );
    check("nudgeWindowDays falls back to the spec default (14/7) when unset or invalid", core.nudgeWindowDays("Applied") === 14 && core.nudgeWindowDays("Interviewing") === 7);

    // Honesty-rule field shape.
    const partial = { jobTitle: "Line Cook", company: "", location: "", description: "Kitchen team.", salaryMin: null, salaryMax: null };
    check(
      "emptyClipFieldNames: flags exactly the fields that are empty/null — never invents a value to avoid flagging",
      core.emptyClipFieldNames(partial).sort().join(",") === "company,location,salaryMax,salaryMin"
    );
    check("emptyClipFieldNames: a fully-filled object flags nothing", core.emptyClipFieldNames({ jobTitle: "x", company: "y", location: "z", description: "w", salaryMin: 1, salaryMax: 2 }).length === 0);
    check("capturedLabel: null lastVerifiedAt -> null (never a fabricated date)", core.capturedLabel(null) === null);
    check("capturedLabel: a real ISO timestamp -> its own date, not reformatted into something else", core.capturedLabel("2026-03-05T12:00:00Z") === "2026-03-05");

    // Stage transitions.
    const moveOk = core.validateStageMove("Applied", "Interviewing");
    check("validateStageMove: a real forward move is accepted", moveOk.ok === true && moveOk.toStage === "Interviewing");
    check("validateStageMove: moving to the SAME stage is rejected (not a real move)", core.validateStageMove("Applied", "Applied").ok === false);
    check("validateStageMove: an unknown stage string is rejected", core.validateStageMove("Applied", "Hired").ok === false);
  }

  // ═══ 2. lib/safe-fetch.ts — SSRF guard, pure classification (no network) ═══
  {
    const sf = load("lib/safe-fetch.ts");
    check("isAllowedProtocol: https allowed", sf.isAllowedProtocol("https:") === true);
    check("isAllowedProtocol: http allowed", sf.isAllowedProtocol("http:") === true);
    check("isAllowedProtocol: ftp refused", sf.isAllowedProtocol("ftp:") === false);
    check("isAllowedProtocol: file refused", sf.isAllowedProtocol("file:") === false);

    const privateIPv4 = ["127.0.0.1", "10.0.0.1", "172.16.5.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "192.0.2.5", "198.51.100.5", "203.0.113.5", "224.0.0.1", "255.255.255.255"];
    for (const ip of privateIPv4) check(`isBlockedIp: ${ip} (private/loopback/link-local/metadata) is blocked`, sf.isBlockedIp(ip) === true, ip);
    const publicIPv4 = ["8.8.8.8", "1.1.1.1", "93.184.216.34"];
    for (const ip of publicIPv4) check(`isBlockedIp: ${ip} (a real public address) is allowed`, sf.isBlockedIp(ip) === false, ip);
    check("isBlockedIp: the cloud metadata address 169.254.169.254 is specifically caught", sf.isBlockedIp("169.254.169.254") === true);
    check("isBlockedIp: IPv6 loopback ::1 is blocked", sf.isBlockedIp("::1") === true);
    check("isBlockedIp: IPv6 unspecified :: is blocked", sf.isBlockedIp("::") === true);
    check("isBlockedIp: IPv6 link-local fe80:: is blocked", sf.isBlockedIp("fe80::1") === true);
    check("isBlockedIp: IPv6 unique-local fd00:: is blocked", sf.isBlockedIp("fd12:3456::1") === true);
    check("isBlockedIp: IPv4-mapped IPv6 of a private address (::ffff:127.0.0.1) is blocked — the dual-stack rebinding case", sf.isBlockedIp("::ffff:127.0.0.1") === true);
    check("isBlockedIp: IPv4-mapped IPv6 of a PUBLIC address is allowed", sf.isBlockedIp("::ffff:8.8.8.8") === false);
    check("isBlockedIp: a real public IPv6 (global unicast, 2xxx::) is allowed", sf.isBlockedIp("2606:4700:4700::1111") === false);
    check("isBlockedIp: garbage/unparseable input fails CLOSED (blocked, not allowed)", sf.isBlockedIp("not-an-ip") === true && sf.isBlockedIp("") === true);

    // resolveAndCheckHost: literal IP vs DNS, and the "any address in the
    // answer is private -> block the whole host" rebinding defense.
    const literalPrivate = await sf.resolveAndCheckHost("127.0.0.1");
    check("resolveAndCheckHost: a literal private IP in the URL is blocked with no DNS call", literalPrivate.ok === false && literalPrivate.reason === "blocked_address");
    const literalPublic = await sf.resolveAndCheckHost("8.8.8.8");
    check("resolveAndCheckHost: a literal public IP in the URL is allowed", literalPublic.ok === true);

    const mixedAnswer = await sf.resolveAndCheckHost("evil.example", async () => ["93.184.216.34", "169.254.169.254"]);
    check("resolveAndCheckHost: a DNS answer mixing one public + one private address blocks the WHOLE host (rebinding defense)", mixedAnswer.ok === false && mixedAnswer.reason === "blocked_address", mixedAnswer);
    const allPublicAnswer = await sf.resolveAndCheckHost("good.example", async () => ["93.184.216.34", "1.1.1.1"]);
    check("resolveAndCheckHost: a DNS answer with only public addresses is allowed", allPublicAnswer.ok === true, allPublicAnswer);
    const dnsFailure = await sf.resolveAndCheckHost("nonexistent.invalid", async () => {
      throw new Error("NXDOMAIN");
    });
    check("resolveAndCheckHost: a DNS lookup failure fails CLOSED (blocked, not allowed)", dnsFailure.ok === false && dnsFailure.reason === "dns_failed", dnsFailure);
    const emptyAnswer = await sf.resolveAndCheckHost("empty.example", async () => []);
    check("resolveAndCheckHost: a DNS answer with zero addresses fails CLOSED", emptyAnswer.ok === false, emptyAnswer);

    // safeFetchHtml end-to-end with an injected fetchFn — proves the
    // redirect-revalidation, timeout, size-cap, and content-type guards
    // without any real network call.
    function fakeResponse({ status = 200, headers = {}, bodyChunks = [] }) {
      const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
        body: {
          getReader() {
            let i = 0;
            return {
              async read() {
                if (i < bodyChunks.length) return { done: false, value: Buffer.from(bodyChunks[i++], "utf-8") };
                return { done: true, value: undefined };
              },
              releaseLock() {},
            };
          },
        },
      };
    }
    const allowAllLookup = async () => ["93.184.216.34"];

    const redirectThenHtml = await sf.safeFetchHtml("https://good.example/job", {
      lookupFn: allowAllLookup,
      fetchFn: (async (url) => {
        if (String(url) === "https://good.example/job") return fakeResponse({ status: 302, headers: { location: "https://good.example/job2" } });
        return fakeResponse({ status: 200, headers: { "content-type": "text/html" }, bodyChunks: ["<html><title>ok</title></html>"] });
      }),
    });
    check("safeFetchHtml: a redirect hop is followed and the final URL/content is returned", redirectThenHtml.html.includes("<title>ok</title>") && redirectThenHtml.finalUrl.includes("/job2"), redirectThenHtml);

    let redirectToPrivateCode = null;
    try {
      await sf.safeFetchHtml("https://good.example/job", {
        lookupFn: allowAllLookup,
        fetchFn: async () => fakeResponse({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
      });
    } catch (e) {
      redirectToPrivateCode = e.code;
    }
    check("safeFetchHtml: a redirect to a private/metadata address is blocked on the SECOND hop, not just the first URL", redirectToPrivateCode === "blocked_address", redirectToPrivateCode);

    let loginRequiredCode = null;
    try {
      await sf.safeFetchHtml("https://good.example/job", { lookupFn: allowAllLookup, fetchFn: async () => fakeResponse({ status: 401 }) });
    } catch (e) {
      loginRequiredCode = e.code;
    }
    check("safeFetchHtml: a 401 is surfaced as login_required, distinguishable from a generic failure", loginRequiredCode === "login_required");

    let notHtmlCode = null;
    try {
      await sf.safeFetchHtml("https://good.example/job.pdf", { lookupFn: allowAllLookup, fetchFn: async () => fakeResponse({ status: 200, headers: { "content-type": "application/pdf" } }) });
    } catch (e) {
      notHtmlCode = e.code;
    }
    check("safeFetchHtml: a non-HTML content-type is refused (HTML only)", notHtmlCode === "not_html");

    let tooLargeCode = null;
    try {
      await sf.safeFetchHtml("https://good.example/job", {
        lookupFn: allowAllLookup,
        maxBytes: 10,
        fetchFn: async () => fakeResponse({ status: 200, headers: { "content-type": "text/html" }, bodyChunks: ["x".repeat(5), "x".repeat(5), "x".repeat(5)] }),
      });
    } catch (e) {
      tooLargeCode = e.code;
    }
    check("safeFetchHtml: a response exceeding the size cap is aborted mid-stream, never buffered unbounded", tooLargeCode === "too_large");

    let blockedProtocolCode = null;
    try {
      await sf.safeFetchHtml("ftp://good.example/job", { lookupFn: allowAllLookup, fetchFn: async () => fakeResponse({ status: 200 }) });
    } catch (e) {
      blockedProtocolCode = e.code;
    }
    check("safeFetchHtml: a non-http(s) protocol is refused before any fetch is attempted", blockedProtocolCode === "bad_protocol");

    let blockedHostCode = null;
    try {
      await sf.safeFetchHtml("https://internal.example/job", { lookupFn: async () => ["10.0.0.5"], fetchFn: async () => fakeResponse({ status: 200 }) });
    } catch (e) {
      blockedHostCode = e.code;
    }
    check("safeFetchHtml: a hostname resolving to a private address is refused before any fetch is attempted", blockedHostCode === "blocked_address");
  }

  // ═══ 3. lib/clip-extract.ts — deterministic meta/JSON-LD extraction on
  // synthetic LinkedIn/Indeed/Greenhouse-SHAPED fixtures (with and without
  // JSON-LD). These are hand-built to match each board's known JSON-LD/meta
  // CONVENTIONS, not saved real pages — this harness has no browser/network
  // access to capture one. See the operator report for why that matters
  // before the browser-extension leg (Kimi's closing watch note). ═══
  {
    const { extractJobFields } = load("lib/clip-extract.ts");

    // Greenhouse/Lever-shaped: clean JSON-LD JobPosting, the common case.
    const jsonLdHtml = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org/",
        "@type": "JobPosting",
        title: "Senior Backend Engineer",
        hiringOrganization: { "@type": "Organization", name: "Acme Corp" },
        jobLocation: { "@type": "Place", address: { addressLocality: "Austin", addressRegion: "TX", addressCountry: "US" } },
        description: "<p>Build our API.</p><p>5+ years experience.</p>",
        baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", minValue: 140000, maxValue: 180000, unitText: "YEAR" } },
      })}</script>
      </head><body>irrelevant nav/footer text</body></html>`;
    const r1 = extractJobFields(jsonLdHtml);
    check("clip-extract (JSON-LD fixture): title extracted exactly", r1.fields.jobTitle === "Senior Backend Engineer", r1.fields);
    check("clip-extract (JSON-LD fixture): company extracted from hiringOrganization", r1.fields.company === "Acme Corp");
    check("clip-extract (JSON-LD fixture): location joined from address parts", r1.fields.location === "Austin, TX, US");
    check("clip-extract (JSON-LD fixture): description HTML stripped to plain text", r1.fields.description.includes("Build our API.") && !r1.fields.description.includes("<p>"));
    check("clip-extract (JSON-LD fixture): salary range extracted as numbers", r1.fields.salaryMin === 140000 && r1.fields.salaryMax === 180000);
    check("clip-extract (JSON-LD fixture): the raw JSON-LD is captured verbatim in meta for audit", !!r1.meta.jsonLd && r1.meta.jsonLd.title === "Senior Backend Engineer");

    // Remote job via jobLocationType TELECOMMUTE.
    const remoteHtml = `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Remote Designer", jobLocationType: "TELECOMMUTE" })}</script></head><body></body></html>`;
    check("clip-extract: jobLocationType TELECOMMUTE maps to 'Remote'", extractJobFields(remoteHtml).fields.location === "Remote");

    // Indeed-shaped: NO JSON-LD at all (Indeed often omits it on SERP-style
    // pages) — must fall back to og:/meta tags, honestly, never guessing
    // fields those tags don't carry (no salary tag here -> stays empty).
    const metaOnlyHtml = `<!doctype html><html><head>
      <title>Warehouse Associate - Initech | Indeed.com</title>
      <meta property="og:title" content="Warehouse Associate" />
      <meta property="og:site_name" content="Initech" />
      <meta name="description" content="Pack and ship orders in our Columbus facility." />
      </head><body>a bunch of unrelated indeed chrome, related jobs, footer links</body></html>`;
    const r2 = extractJobFields(metaOnlyHtml);
    check("clip-extract (meta-only fixture, no JSON-LD): title from og:title", r2.fields.jobTitle === "Warehouse Associate", r2.fields);
    check("clip-extract (meta-only fixture): company from og:site_name", r2.fields.company === "Initech");
    check("clip-extract (meta-only fixture): description from meta description", r2.fields.description === "Pack and ship orders in our Columbus facility.");
    check("clip-extract (meta-only fixture, honesty rule): location was NEVER on the page -> stays empty, not guessed", r2.fields.location === "");
    check("clip-extract (meta-only fixture, honesty rule): salary was NEVER on the page -> stays null, not guessed", r2.fields.salaryMin === null && r2.fields.salaryMax === null);

    // LinkedIn-shaped: JSON-LD present but with only SOME fields populated
    // (LinkedIn's public JobPosting markup commonly omits baseSalary) —
    // proves JSON-LD and meta don't cross-contaminate: a field JSON-LD
    // supplies is never overwritten by a DIFFERENT og: tag value.
    const partialHtml = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Product Manager", hiringOrganization: { name: "Globex" } })}</script>
      <meta property="og:title" content="Totally Different Title - LinkedIn" />
      <meta property="og:site_name" content="LinkedIn" />
      </head><body></body></html>`;
    const r3 = extractJobFields(partialHtml);
    check("clip-extract (partial JSON-LD fixture): JSON-LD's own title wins over a conflicting og:title — never overwritten", r3.fields.jobTitle === "Product Manager", r3.fields);
    check("clip-extract (partial JSON-LD fixture): JSON-LD's own company wins over og:site_name", r3.fields.company === "Globex");
    check("clip-extract (partial JSON-LD fixture, honesty rule): a field absent from BOTH JSON-LD and meta (location) stays empty", r3.fields.location === "");

    // A page with garbage/invalid JSON-LD must not throw — falls through to meta.
    const brokenJsonHtml = `<html><head><script type="application/ld+json">{not valid json,,,</script><meta property="og:title" content="Fallback Title" /></head><body></body></html>`;
    const r4 = extractJobFields(brokenJsonHtml);
    check("clip-extract: malformed JSON-LD is skipped without throwing, and meta fallback still runs", r4.fields.jobTitle === "Fallback Title", r4.fields);

    // Totally empty page: every field honestly empty, no throw.
    const blankHtml = `<html><head></head><body>nothing here</body></html>`;
    const r5 = extractJobFields(blankHtml);
    check(
      "clip-extract: a page with nothing extractable returns every field empty (honesty rule), never throws",
      r5.fields.jobTitle === "" && r5.fields.company === "" && r5.fields.location === "" && r5.fields.description === "" && r5.fields.salaryMin === null && r5.fields.salaryMax === null
    );
  }

  // ═══ 4. lib/attribution-report.ts — exact-count fixtures, zero-fill, direct bucket ═══
  {
    const ar = load("lib/attribution-report.ts");
    const zero = ar.emptyAttributionCounts();
    check("emptyAttributionCounts: every channel zero, direct zero, total zero (renders zeros, not blanks)", zero.total === 0 && zero.direct === 0 && ar.ATTRIBUTION_CHANNELS.every((c) => zero.byChannel[c] === 0));

    const rows = [
      { attribution: { utmSource: "indeed" } },
      { attribution: { utmSource: "indeed" } },
      { attribution: { utmSource: "linkedin" } },
      { attribution: { utmSource: "ziprecruiter" } },
      { attribution: { utmSource: "google_jobs" } },
      { attribution: null }, // direct
      { attribution: { utmSource: "" } }, // direct — present but empty
      { attribution: { utmSource: "some_random_referrer" } }, // unrecognized -> direct, never dropped
    ];
    const counts = ar.buildAttributionCounts(rows);
    check("buildAttributionCounts: exact per-channel counts match the fixture", counts.byChannel.indeed === 2 && counts.byChannel.linkedin === 1 && counts.byChannel.ziprecruiter === 1 && counts.byChannel.google_jobs === 1, counts);
    check("buildAttributionCounts: null/empty/unrecognized attribution all bucket into direct — 3 total", counts.direct === 3, counts);
    check("buildAttributionCounts: total counts every row exactly once", counts.total === rows.length, counts);

    const report = ar.buildAttributionReport(
      [{ id: 1, title: "Job A" }, { id: 2, title: "Job B (no applicants)" }],
      new Map([[1, [{ attribution: { utmSource: "indeed" } }, { attribution: null }]]])
    );
    check("buildAttributionReport: a job with zero applicants still renders a zero row, not a missing one", report.byJob.find((j) => j.jobId === 2).counts.total === 0, report.byJob);
    check("buildAttributionReport: the aggregate sums across every job", report.aggregate.total === 2 && report.aggregate.byChannel.indeed === 1 && report.aggregate.direct === 1, report.aggregate);
  }

  // ═══ 5. lib/job-distribution.ts — disable/merge semantics, pure (Section 5;
  // the live tool-call + approval round trip is covered end to end in
  // scripts/test-employer-assistant.cjs §79d) ═══
  {
    const jd = load("lib/job-distribution.ts");
    check("hasDisableRequest: true when any channel is named", jd.hasDisableRequest({ indeedFeed: true }) === true);
    check("hasDisableRequest: false for an empty/undefined disable object", jd.hasDisableRequest(undefined) === false && jd.hasDisableRequest({}) === false);

    const existing = { indeedFeed: { enabled: true }, linkedin: { enabled: true, mode: "share" }, zipRecruiter: { enabled: true } };
    const afterDisableIndeed = jd.buildChannelsFromInput({ indeedFeed: false, linkedin: false, zipRecruiter: false, disable: { indeedFeed: true } }, existing);
    check("buildChannelsFromInput: disabling indeedFeed turns only it off", afterDisableIndeed.indeedFeed.enabled === false, afterDisableIndeed);
    check("buildChannelsFromInput: disabling indeedFeed PRESERVES linkedin and zipRecruiter exactly as they were", afterDisableIndeed.linkedin.enabled === true && afterDisableIndeed.zipRecruiter.enabled === true, afterDisableIndeed);
    check("buildChannelsFromInput: disabling LinkedIn preserves its mode", jd.buildChannelsFromInput({ indeedFeed: false, linkedin: false, zipRecruiter: false, disable: { linkedin: true } }, existing).linkedin.mode === "share");
    const fromScratch = jd.buildChannelsFromInput({ indeedFeed: false, linkedin: false, zipRecruiter: false, disable: { zipRecruiter: true } }, null);
    check("buildChannelsFromInput: disabling a channel that was never on (no existing row) is a safe no-op shaped as 'off'", fromScratch.zipRecruiter.enabled === false);
  }

  // ═══ 6. lib/tracker-store.ts — CRUD + stage moves + notes + audit events,
  // against the fake Postgres ═══
  {
    resetWorld();
    const store = load("lib/tracker-store.ts");
    check("trackerEnabled: true once a fake Supabase client resolves", store.trackerEnabled() === true);

    const created = await store.createTrackedApplication("user_1", { jobTitle: "Line Cook", company: "Acme Kitchens", source: "manual", stage: "Clipped" });
    check("createTrackedApplication: returns the saved row with defaults applied", !!created && created.stage === "Clipped" && created.source === "manual", created);
    check("createTrackedApplication: refuses a wholly-blank card (no jobTitle AND no company)", (await store.createTrackedApplication("user_1", { jobTitle: "", company: "", source: "manual" })) === null);

    const list1 = await store.listTrackedApplications("user_1");
    check("listTrackedApplications: scoped to the user, returns the created row", list1.length === 1 && list1[0].id === created.id);
    const otherUserList = await store.listTrackedApplications("user_2");
    check("listTrackedApplications: a different user sees nothing — ownership-scoped", otherUserList.length === 0);

    const moved = await store.moveStage("user_1", created.id, "Applied");
    check("moveStage: a valid move succeeds and stamps appliedAt the first time it reaches Applied", moved.ok === true && !!moved.application.appliedAt, moved);
    const noopMove = await store.moveStage("user_1", created.id, "Applied");
    check("moveStage: moving to the SAME stage again is rejected (pure validateStageMove rule)", noopMove.ok === false, noopMove);
    const badMove = await store.moveStage("user_1", created.id, "NotAStage");
    check("moveStage: an invalid stage name is rejected", badMove.ok === false, badMove);
    const crossUserMove = await store.moveStage("user_2", created.id, "Interviewing");
    check("moveStage: another user cannot move someone else's card — ownership-scoped", crossUserMove.ok === false, crossUserMove);

    const events = await store.listEvents("user_1", created.id);
    check("moveStage logs a stage_change application_event — the audit trail", events.some((e) => e.event === "stage_change" && e.payload.toStage === "Applied"), events);

    const noted = await store.addNote("user_1", created.id, "Recruiter called.");
    check("addNote: appends a note with text/id/createdAt", !!noted && noted.notes.length === 1 && noted.notes[0].text === "Recruiter called.", noted);

    const archived = await store.updateTrackedApplication("user_1", created.id, { archived: true });
    check("updateTrackedApplication: archiving sets the flag", !!archived && archived.archived === true);
    const listExcludesArchived = await store.listTrackedApplications("user_1");
    check("listTrackedApplications: excludes archived by default", listExcludesArchived.length === 0);
    const listIncludesArchived = await store.listTrackedApplications("user_1", true);
    check("listTrackedApplications: includeArchived=true still returns it", listIncludesArchived.length === 1);

    const deleted = await store.deleteTrackedApplication("user_1", created.id);
    check("deleteTrackedApplication: succeeds", deleted === true);
    check("deleteTrackedApplication: the row is actually gone", (await store.listTrackedApplications("user_1", true)).length === 0);

    // ATS link.
    const created2 = await store.createTrackedApplication("user_1", { jobTitle: "Nurse", company: "City Hospital", source: "manual", stage: "Applied" });
    const scored = await store.recordAtsScore("user_1", created2.id, { score: 82, verdict: "Strong match", resumeId: "r1", resumeLabel: "My Resume" });
    check("recordAtsScore: saves a score history row", !!scored && scored.score === 82, scored);
    const history = await store.listAtsScores("user_1", created2.id);
    check("listAtsScores: returns the score just recorded, most-recent first", history.length === 1 && history[0].score === 82, history);

    // Real-status lookup for our-own-job cards (Section 4): best-effort
    // email match against `applicants`, honest null when there's no match.
    state.tables.applicants.push({ id: 1, job_id: 777, email: "candidate@example.com", status: "shortlisted", status_changed_at: "2026-02-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" });
    const realMatch = await store.findOurJobApplicantStatus(777, "Candidate@Example.com"); // case-insensitive
    check("findOurJobApplicantStatus: matches by job_id + email, case-insensitively, returns the REAL pipeline status", !!realMatch && realMatch.status === "shortlisted", realMatch);
    const noMatch = await store.findOurJobApplicantStatus(777, "someone-else@example.com");
    check("findOurJobApplicantStatus: no matching applicant -> null (self-managed, no employer-status surface implied)", noMatch === null);
    const externalJob = await store.findOurJobApplicantStatus(999, "candidate@example.com");
    check("findOurJobApplicantStatus: an unrelated job id -> null", externalJob === null);
  }

  // ═══ 7. Nudge orchestration (lib/tracker-nudges.ts) against the store ═══
  {
    resetWorld();
    const store = load("lib/tracker-store.ts");
    const nudges = load("lib/tracker-nudges.ts");

    const app = await store.createTrackedApplication("user_1", { jobTitle: "Analyst", company: "Beta Inc", source: "manual", stage: "Applied" });
    // Backdate stage_changed_at to 15 days ago so the Applied dwell window has passed.
    const row = state.tables.tracked_applications.find((r) => r.id === app.id);
    row.stage_changed_at = new Date(Date.now() - 15 * 86_400_000).toISOString();

    const due1 = await nudges.getDueNudges("user_1");
    check("getDueNudges: a 15-day-dwelling Applied card surfaces a nudge", due1.length === 1 && due1[0].application.id === app.id, due1);
    check("getDueNudges: the nudge message never claims to know employer behavior — it's phrased as dwell time only", /no response yet/i.test(due1[0].message) && !/employer (has|hasn't)/i.test(due1[0].message), due1[0].message);

    const fired = (await store.listEvents("user_1", app.id)).filter((e) => e.event === "nudge_fired");
    check("getDueNudges: logs exactly one nudge_fired event for this dwell window", fired.length === 1, fired);

    const due2 = await nudges.getDueNudges("user_1");
    check("getDueNudges: calling again within the SAME dwell window still returns the nudge (keeps showing until dismissed)", due2.length === 1);
    const firedAgain = (await store.listEvents("user_1", app.id)).filter((e) => e.event === "nudge_fired");
    check("getDueNudges: does NOT log a second nudge_fired for the same reference time — fires once per dwell window", firedAgain.length === 1, firedAgain);

    const dismissed = await nudges.dismissNudge("user_1", app.id);
    check("dismissNudge: succeeds", dismissed === true);
    const due3 = await nudges.getDueNudges("user_1");
    check("getDueNudges: a dismissed nudge is suppressed for the SAME reference time", due3.length === 0, due3);

    // Per-tracker off switch.
    await store.updateTrackedApplication("user_1", app.id, { nudgesOff: true });
    const due4 = await nudges.getDueNudges("user_1");
    check("getDueNudges: the per-tracker nudgesOff switch suppresses it even though it's still dwelling", due4.length === 0);
  }

  // ═══ 8. Route level: app/api/tracker/** driven through the real handlers ═══
  {
    resetWorld();
    state.userId = "user_1";
    const req = (body) => new Request(`${URLBASE}/x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    const createRes = await route("tracker").POST(req({ jobTitle: "Mechanic", company: "AutoCo" }));
    const createData = await createRes.json();
    check("POST /api/tracker: creates a manual card", createRes.status === 200 && createData.application.source === "manual", createData);

    state.userId = null;
    const unauthRes = await route("tracker").GET();
    check("GET /api/tracker: 401 when signed out", unauthRes.status === 401);
    state.userId = "user_1";

    const listRes = await route("tracker").GET();
    const listData = await listRes.json();
    check("GET /api/tracker: lists the card just created", listData.applications.length === 1);

    const id = createData.application.id;
    const patchStageRes = await (await route("tracker/[id]")).PATCH(req({ stage: "Applied" }), { params: { id } });
    const patchStageData = await patchStageRes.json();
    check("PATCH /api/tracker/[id]: a stage move through the real route succeeds", patchStageRes.status === 200 && patchStageData.application.stage === "Applied", patchStageData);

    const getOneRes = await (await route("tracker/[id]")).GET(new Request(`${URLBASE}/x`), { params: { id } });
    const getOneData = await getOneRes.json();
    check("GET /api/tracker/[id]: an external (manual) card has realStatus: null — never an employer-status surface", getOneData.realStatus === null, getOneData);

    const delRes = await (await route("tracker/[id]")).DELETE(new Request(`${URLBASE}/x`, { method: "DELETE" }), { params: { id } });
    check("DELETE /api/tracker/[id]: succeeds", delRes.status === 200);
    check("DELETE /api/tracker/[id]: the card is actually gone", (await (await (await route("tracker")).GET()).json()).applications.length === 0);
  }

  // ═══ 9. Route level: the clip extractor's URL recognition for OUR OWN jobs
  // (Section 2's "fullest fill, still real data") — via lib/tracker-clip.ts
  // directly, with getPublicJob backed by the fake job_postings table. ═══
  {
    resetWorld();
    state.userId = "user_1";
    state.tables.employer_profiles.push({ user_id: "emp_1", company_name: "Acme Corp" });
    state.tables.job_postings.push({
      id: 123,
      employer_id: "emp_1",
      title: "Data Analyst",
      description: "Analyze data pipelines and build dashboards for the growth team, working closely with product and marketing.",
      location: "Remote",
      remote_type: "remote",
      status: "active",
      public_listed: true,
      salary_min: 70000,
      salary_max: 90000,
    });
    process.env.NEXT_PUBLIC_APP_URL = URLBASE;
    const clip = load("lib/tracker-clip.ts");
    const result = await clip.clipFromUrl("user_1", `${URLBASE}/jobs/123`);
    check("clipFromUrl: recognizes our own job URL and pulls REAL fields from job_postings, not a scrape", result.ok === true && result.application.jobTitle === "Data Analyst" && result.application.company === "Acme Corp", result);
    check("clipFromUrl: our-own-job clip sets source 'our_job' and links sourceJobId", result.application.source === "our_job" && result.application.sourceJobId === 123, result.application);
    check("clipFromUrl: salary comes from the real job row", result.application.salaryMin === 70000 && result.application.salaryMax === 90000);

    // Our-own-job URL for a job that's since been unpublished falls back to
    // the generic external path rather than failing outright — and that
    // path will itself fail safely (no real network in this harness) with a
    // clean "couldn't read that page" message, never a crash.
    state.tables.job_postings[0].status = "closed";
    const resultClosed = await clip.clipFromUrl("user_1", `${URLBASE}/jobs/123`);
    check("clipFromUrl: a since-closed 'our job' URL falls back cleanly (no crash) rather than claiming stale real data", resultClosed.ok === false, resultClosed);

    const badUrl = await clip.clipFromUrl("user_1", "not a url at all");
    check("clipFromUrl: garbage input is refused cleanly, not thrown", badUrl.ok === false);
  }

  // ═══ 10. Route level: attribution report + channel toggle gating ═══
  {
    resetWorld();
    state.tables.job_postings.push(
      { id: 1, employer_id: "emp_1", title: "Job A", status: "active", public_listed: true },
      { id: 2, employer_id: "emp_1", title: "Job B", status: "active", public_listed: true }
    );
    state.tables.applicants.push(
      { id: 10, job_id: 1, attribution: { utm_source: "indeed" } },
      { id: 11, job_id: 1, attribution: null },
      { id: 12, job_id: 2, attribution: { utm_source: "linkedin" } }
    );
    const attrStore = load("lib/attribution-store.ts");
    const report = await attrStore.buildEmployerAttributionReport("emp_1");
    check("buildEmployerAttributionReport: per-job + aggregate counts cross-check against the raw fixture rows exactly", report.aggregate.total === 3 && report.aggregate.byChannel.indeed === 1 && report.aggregate.byChannel.linkedin === 1 && report.aggregate.direct === 1, report);
    check("buildEmployerAttributionReport: job-scoped narrows to one job's counts only", (await attrStore.buildEmployerAttributionReport("emp_1", 1)).aggregate.total === 2);

    const plan = load("lib/employer-plan.ts");
    const scaleAccess = { tier: "scale", isAdmin: false };
    const freeAccess = { tier: "free", isAdmin: false };
    check("canUseAttributionReport: false when the flag is unset, even on Scale — the feature ships dark by default", plan.canUseAttributionReport(scaleAccess) === false);
    process.env.ATTRIBUTION_REPORT_ENABLED = "on";
    check("canUseAttributionReport: true on Scale once the flag is explicitly turned on", plan.canUseAttributionReport(scaleAccess) === true);
    check("canUseAttributionReport: still false on Free even with the flag on — tier gate is independent of the flag", plan.canUseAttributionReport(freeAccess) === false);
    delete process.env.ATTRIBUTION_REPORT_ENABLED;
  }

  // ═══ 11. Channel off-signal — live feed-removal round trip (Section 5),
  // against a fake that enforces job_distribution's REAL single-row-per-job
  // upsert semantics (see the `upsert` case in chainFor above). This is the
  // one assertion scripts/test-employer-assistant.cjs §79d could not make
  // reliably, since its own job_distribution fake is append-only. Drives the
  // REAL store functions + REAL feed route handlers directly (not through
  // the assistant/pending-action pipeline, which is already covered end to
  // end in that other harness). ═══
  {
    resetWorld();
    const jd = load("lib/job-distribution.ts");
    const jds = load("lib/job-distribution-store.ts");
    process.env.NEXT_PUBLIC_APP_URL = URLBASE;

    state.tables.employer_profiles.push({ user_id: "emp_1", company_name: "Acme Kitchens" });
    state.tables.job_postings.push(
      { id: 61, employer_id: "emp_1", title: "Dishwasher", description: "Kitchen team.", location: "Austin, TX", status: "active", public_listed: true, published_at: "2026-01-01T00:00:00Z" },
      { id: 62, employer_id: "emp_1", title: "Prep Cook", description: "Kitchen team.", location: "Austin, TX", status: "active", public_listed: true, published_at: "2026-01-01T00:00:00Z" }
    );

    const token = await jds.ensureEmployerFeedToken("emp_1");
    check("ensureEmployerFeedToken: generates a real token", !!token);

    // Enable both Indeed and ZipRecruiter on job 61, only ZipRecruiter on 62.
    const channels61 = jd.buildChannelsFromInput({ indeedFeed: true, zipRecruiter: true, linkedin: false }, null);
    await jds.upsertDistribution("emp_1", 61, channels61, "user_1", "owner@example.com");
    const channels62 = jd.buildChannelsFromInput({ indeedFeed: false, zipRecruiter: true, linkedin: false }, null);
    await jds.upsertDistribution("emp_1", 62, channels62, "user_1", "owner@example.com");

    const indeedXml1 = await (await route("jobs/feed/[token]").GET(new Request(`${URLBASE}/x`), { params: { token } })).text();
    const zrXml1 = await (await route("jobs/ziprecruiter-feed/[token]").GET(new Request(`${URLBASE}/x`), { params: { token } })).text();
    check("channel off-signal setup: job 61 (Indeed+ZR) appears on BOTH real feed routes", /<referencenumber>61<\/referencenumber>/.test(indeedXml1) && /<referencenumber>61<\/referencenumber>/.test(zrXml1), { indeedXml1, zrXml1 });
    check("channel off-signal setup: job 62 (ZR only) appears ONLY on the ZipRecruiter feed", !/<referencenumber>62<\/referencenumber>/.test(indeedXml1) && /<referencenumber>62<\/referencenumber>/.test(zrXml1));

    // Disable Indeed on job 61 — a SECOND upsert for the SAME job_id, which
    // must REPLACE the row (real primary-key upsert), not append a second one.
    const existing61 = await jds.getDistribution("emp_1", 61);
    const channels61Off = jd.buildChannelsFromInput({ indeedFeed: false, zipRecruiter: false, linkedin: false, disable: { indeedFeed: true } }, existing61.channels);
    await jds.upsertDistribution("emp_1", 61, channels61Off, "user_1", "owner@example.com");
    check("channel off-signal: exactly ONE job_distribution row exists for job 61 after the second upsert (true upsert, not append)", state.tables.job_distribution.filter((r) => r.job_id === 61).length === 1);

    const indeedXml2 = await (await route("jobs/feed/[token]").GET(new Request(`${URLBASE}/x`), { params: { token } })).text();
    const zrXml2 = await (await route("jobs/ziprecruiter-feed/[token]").GET(new Request(`${URLBASE}/x`), { params: { token } })).text();
    check("channel off-signal: job 61 is GONE from the real Indeed feed route after disabling indeedFeed (removal-by-omission)", !/<referencenumber>61<\/referencenumber>/.test(indeedXml2), indeedXml2);
    check("channel off-signal: job 61 is STILL on the real ZipRecruiter feed route — disabling Indeed never touched it (merge semantics)", /<referencenumber>61<\/referencenumber>/.test(zrXml2), zrXml2);
    check("channel off-signal: job 62 (never touched) is UNCHANGED — still ZR only, not on Indeed", !/<referencenumber>62<\/referencenumber>/.test(indeedXml2) && /<referencenumber>62<\/referencenumber>/.test(zrXml2));

    // Re-enable: reversible.
    const existing61b = await jds.getDistribution("emp_1", 61);
    const channels61On = jd.buildChannelsFromInput({ indeedFeed: true, zipRecruiter: false, linkedin: false }, existing61b.channels);
    await jds.upsertDistribution("emp_1", 61, channels61On, "user_1", "owner@example.com");
    const indeedXml3 = await (await route("jobs/feed/[token]").GET(new Request(`${URLBASE}/x`), { params: { token } })).text();
    check("channel off-signal: re-enabling Indeed brings job 61 BACK onto the real feed route — reversible", /<referencenumber>61<\/referencenumber>/.test(indeedXml3), indeedXml3);
  }

  // ═══ 12. lib/legacy-migration-map.ts — One Surface merge (Section F):
  // status mapping, unmappable predicate, dedupe/merge planning, reconciliation
  // counts, and the legacy-route redirect target — all pure, no DB. ═══
  {
    const lm = load("lib/legacy-migration-map.ts");

    check("legacyApplicationsRedirectTarget: /candidate/applications -> /candidate/tracker", lm.legacyApplicationsRedirectTarget("/candidate/applications") === "/candidate/tracker");
    check("legacyApplicationsRedirectTarget: trailing slash also redirects", lm.legacyApplicationsRedirectTarget("/candidate/applications/") === "/candidate/tracker");
    check("legacyApplicationsRedirectTarget: an unrelated path is untouched", lm.legacyApplicationsRedirectTarget("/candidate/tracker") === null && lm.legacyApplicationsRedirectTarget("/candidate/applications/42") === null);

    // Status -> stage mapping against the REAL applications.status check constraint (migration 0004).
    const statusCases = [
      ["Applied", "Applied"],
      ["Phone Screen", "Interviewing"],
      ["Interview", "Interviewing"],
      ["Offer", "Offer"],
      ["Rejected", "Rejected"],
      ["Withdrawn", "Withdrawn"],
      ["Ghosted", "Clipped"],
      ["Some Future Status", "Clipped"],
      ["", "Clipped"],
      [null, "Clipped"],
      [undefined, "Clipped"],
    ];
    for (const [status, stage] of statusCases) {
      check(`mapLegacyStatusToStage(${JSON.stringify(status)}) -> ${stage}`, lm.mapLegacyStatusToStage(status) === stage);
    }

    // Unmappable predicate: both role and company blank -> flagged, never guessed.
    check("isUnmappableLegacyRow: blank role AND blank company -> unmappable", lm.isUnmappableLegacyRow({ role: "  ", company: "" }) === true);
    check("isUnmappableLegacyRow: a role with no company is still mappable", lm.isUnmappableLegacyRow({ role: "Line Cook", company: "" }) === false);
    check("isUnmappableLegacyRow: a company with no role is still mappable", lm.isUnmappableLegacyRow({ role: "", company: "Acme" }) === false);

    // Original status string preserved in the card's note, never silently dropped.
    const noteGhosted = lm.buildLegacyNoteText({ status: "Ghosted" }, "Clipped");
    check("buildLegacyNoteText: a remapped status (Ghosted->Clipped) is preserved verbatim in the note", noteGhosted.includes("Ghosted"), noteGhosted);
    const noteDirect = lm.buildLegacyNoteText({ status: "Applied" }, "Applied");
    check("buildLegacyNoteText: a 1:1 mapping (Applied->Applied) needs no 'migrated from' line", !noteDirect.includes("Migrated from legacy tracker"), noteDirect);
    const noteExtras = lm.buildLegacyNoteText(
      { status: "Applied", salary: "$120k", contact_name: "Jess", contact_email: "jess@x.com", follow_up_date: "2026-03-01", resume_id: "r_9", notes: "Great recruiter call" },
      "Applied"
    );
    check(
      "buildLegacyNoteText: salary/contact/follow-up/resume/notes with no destination column are all preserved verbatim, nothing dropped",
      ["$120k", "Jess", "jess@x.com", "2026-03-01", "r_9", "Great recruiter call"].every((s) => noteExtras.includes(s)),
      noteExtras
    );

    // Reconciliation: seeded fixtures -> exact migrated/merged/unmappable counts.
    // Rows 2 and 5 share a posting URL that ALSO matches a pre-existing tracked
    // card (as if the Kanban board was already in parallel use) -> both merge
    // into that one card instead of creating duplicates.
    const legacyRows = [
      { id: 1, user_id: "u1", role: "Line Cook", company: "Diner Co", status: "Applied", url: "https://jobs.example.com/1" },
      { id: 2, user_id: "u1", role: "Sous Chef", company: "Bistro Co", status: "Interview", url: "https://jobs.example.com/2" },
      { id: 3, user_id: "u1", role: "Host", company: "Cafe Co", status: "Ghosted", url: null },
      { id: 4, user_id: "u1", role: "  ", company: "", status: "Applied", url: "https://jobs.example.com/4" }, // unmappable: blank role+company
      { id: 5, user_id: "u1", role: "Barista", company: "Cafe Co", status: "Rejected", url: "https://jobs.example.com/2" }, // dedupes with row 2 AND the pre-existing card
    ];
    const existingTracked = [{ id: "existing_abc", user_id: "u1", posting_url: "https://jobs.example.com/2" }];
    const plan = lm.planLegacyMigration(legacyRows, existingTracked);
    const summary = lm.summarizeMigrationPlan(plan);
    check(
      "planLegacyMigration: reconciliation is exact on seeded fixtures (2 migrated, 2 merged, 1 unmappable = 5 legacy rows, none lost or double-counted)",
      summary.migrated === 2 && summary.merged === 2 && summary.unmappable === 1 && plan.length === legacyRows.length,
      { summary, plan }
    );
    check("planLegacyMigration: row 4 (blank role+company) is flagged unmappable, not guessed into a card", plan.find((p) => p.legacyId === 4).outcome === "unmappable");
    check(
      "planLegacyMigration: rows 2 and 5 both dedupe by (user_id, posting_url) onto the SAME pre-existing tracked card, not two new duplicates",
      plan.find((p) => p.legacyId === 2).outcome === "merged" &&
        plan.find((p) => p.legacyId === 2).mergedInto === "existing_abc" &&
        plan.find((p) => p.legacyId === 5).outcome === "merged" &&
        plan.find((p) => p.legacyId === 5).mergedInto === "existing_abc",
      plan
    );
    check(
      "planLegacyMigration: row 3 (no url, Ghosted) migrates fresh as Clipped — no url means it can never dedupe",
      plan.find((p) => p.legacyId === 3).outcome === "migrated" && plan.find((p) => p.legacyId === 3).stage === "Clipped"
    );
    check("planLegacyMigration: row 1 (unique url) migrates fresh as Applied", plan.find((p) => p.legacyId === 1).outcome === "migrated" && plan.find((p) => p.legacyId === 1).stage === "Applied");

    // Idempotency / re-run guard: a second pass with the handled ids excluded has nothing left to do except the untouched unmappable row.
    const alreadyHandled = new Set(plan.filter((p) => p.outcome !== "unmappable").map((p) => p.legacyId));
    const secondPass = lm.planLegacyMigration(legacyRows, existingTracked, alreadyHandled);
    check(
      "planLegacyMigration: a second run (safe to re-run) skips every already-migrated/merged row but still flags the untouched unmappable row every time",
      secondPass.filter((p) => p.outcome !== "unmappable").length === 0 && secondPass.filter((p) => p.outcome === "unmappable").length === 1,
      secondPass
    );
  }

  // ═══ 13. Route level: the legacy /api/applications surface is read-only
  // from app code (One Surface merge, Section F) — POST/PATCH/DELETE must
  // all refuse with 410 regardless of auth state; GET's own read path and
  // auth gate are unchanged. ═══
  {
    resetWorld();
    const appsRoute = route("applications");
    const appsIdRoute = route("applications/[id]");

    const postRes = await appsRoute.POST();
    const postData = await postRes.json();
    check("POST /api/applications: refuses with 410 legacy_read_only (no write path left)", postRes.status === 410 && postData.error === "legacy_read_only", postData);

    const patchRes = await appsIdRoute.PATCH();
    const patchData = await patchRes.json();
    check("PATCH /api/applications/[id]: refuses with 410 legacy_read_only", patchRes.status === 410 && patchData.error === "legacy_read_only", patchData);

    const deleteRes = await appsIdRoute.DELETE();
    const deleteData = await deleteRes.json();
    check("DELETE /api/applications/[id]: refuses with 410 legacy_read_only", deleteRes.status === 410 && deleteData.error === "legacy_read_only", deleteData);

    state.userId = null;
    const unauthGet = await appsRoute.GET();
    check("GET /api/applications: still 401s when signed out (the read path keeps its own auth gate, unchanged)", unauthGet.status === 401);
  }

  // ═══ 14. One Surface merge (Section F): nav has exactly one Tracker entry
  // pointed at the board, no dangling /candidate/applications nav link, and
  // the i18n keys this build needs exist in all 5 locales (full key-set
  // parity is also enforced generically by `npm run lint:i18n`; this just
  // pins this build's own acceptance bar). ═══
  {
    const sidebarSrc = fs.readFileSync(path.join(ROOT, "components/candidate-sidebar.tsx"), "utf8");
    const navHrefs = [...sidebarSrc.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    check(
      "candidate-sidebar: exactly one applications/tracker nav entry, pointed at the board (not the old list)",
      navHrefs.filter((h) => h === "/candidate/tracker" || h === "/candidate/applications").length === 1 && navHrefs.includes("/candidate/tracker") && !navHrefs.includes("/candidate/applications"),
      navHrefs
    );

    const LOCALES = ["en", "es", "fr", "hi", "zh"];
    const messages = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(fs.readFileSync(path.join(ROOT, "messages", `${l}.json`), "utf8"))]));
    for (const l of LOCALES) {
      check(`messages/${l}.json: nav.tracker exists (the renamed nav entry)`, typeof messages[l]?.nav?.tracker === "string" && messages[l].nav.tracker.length > 0);
      check(`messages/${l}.json: nav.applications is gone (replaced, not duplicated)`, messages[l]?.nav?.applications === undefined);
      check(
        `messages/${l}.json: the tracker namespace exists with the same key set as en (lint:i18n also enforces this generically)`,
        Object.keys(messages[l]?.tracker || {}).length > 0 && Object.keys(messages[l].tracker).sort().join(",") === Object.keys(messages.en.tracker || {}).sort().join(",")
      );
    }
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) {
    console.error("FAILURES DETECTED");
    process.exit(1);
  }
  console.log("ALL PASS");
})();
