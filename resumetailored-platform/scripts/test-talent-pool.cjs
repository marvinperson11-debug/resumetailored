#!/usr/bin/env node
/**
 * Talent Pool ("Get Found by employers") — npm run test:talent-pool.
 *
 * Same three-layer shape as scripts/test-application-tracker.cjs (its
 * sibling, not a copy — talent_pool_profiles/talent_pool_contact_requests
 * are net-new tables, migrations 0082/0083):
 *   - Pure logic (lib/talent-pool-core.ts): exact-value assertions, no
 *     mocking, no network.
 *   - Store-level CRUD (lib/talent-pool-store.ts) against a minimal fake
 *     Supabase client built to the exact subset of PostgREST chain calls
 *     the store actually issues (select/eq/order/limit/maybeSingle/single/
 *     insert/update) — the same shape test-application-tracker.cjs's
 *     fake Postgres supports, reused here rather than re-invented.
 *   - Route-level (app/api/talent-pool/**, app/api/employer/talent-pool/**)
 *     driven through the REAL route handlers with a faked
 *     @clerk/nextjs/server (auth + currentUser, for employerContext's tier
 *     check) and the fake Supabase client.
 *
 * Both talent_pool tables are RLS-on/no-policies, service-role only (see
 * the migrations' own header comments) — there is no Postgres RLS to prove
 * against a real database here. What this suite proves instead is the
 * actual access boundary: that lib/talent-pool-store.ts and the routes
 * built on it never let one candidate/employer see another's row, exactly
 * the scoping a real RLS policy would have enforced.
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
delete process.env.RESEND_API_KEY; // email sends are no-ops; we assert on DB-visible outcomes only

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

// ── fake world: Clerk (auth + per-user identity) + a minimal Postgres ──────
const state = { userId: null, tier: "free", identities: {}, tables: {} };
function resetWorld() {
  state.userId = null;
  state.tier = "free";
  state.identities = {};
  state.tables = { talent_pool_profiles: [], talent_pool_contact_requests: [], employer_profiles: [], user_profiles: [] };
}
resetWorld();

function setIdentity(id, { firstName = null, lastName = null, imageUrl = null, email = null, locale = null } = {}) {
  state.identities[id] = { firstName, lastName, imageUrl, email, locale };
}

let idCounter = 1;
function newId() {
  return `id_${idCounter++}`;
}

function matches(row, filters) {
  return filters.every((f) => {
    const v = row[f.col];
    if (f.op === "eq") return v === f.val;
    return true;
  });
}

function chainFor(table) {
  const ctx = { op: "select", filters: [], insertRows: null, updateRow: null, order: null, limit: null, single: false, maybeSingle: false };
  const rows = () => state.tables[table] || (state.tables[table] = []);
  const exec = () => {
    if (ctx.op === "insert") {
      const inserted = ctx.insertRows.map((r) => ({ id: r.id || newId(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
      rows().push(...inserted);
      if (ctx.single) return { data: inserted[0] || null, error: inserted.length ? null : { message: "insert failed" } };
      return { data: inserted, error: null };
    }
    if (ctx.op === "update") {
      const all = rows();
      const touched = all.filter((r) => matches(r, ctx.filters));
      touched.forEach((r) => Object.assign(r, ctx.updateRow));
      if (ctx.single) return { data: touched[0] || null, error: touched.length ? null : { message: "not found" } };
      if (ctx.maybeSingle) return { data: touched[0] || null, error: null };
      return { data: touched, error: null };
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
    update(patch) {
      ctx.op = "update";
      ctx.updateRow = patch;
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

function fakeClerkUser(id) {
  const idn = state.identities[id] || {};
  return {
    id,
    firstName: idn.firstName ?? null,
    lastName: idn.lastName ?? null,
    imageUrl: idn.imageUrl ?? null,
    emailAddresses: idn.email === null || idn.email === undefined ? (idn.email === null ? [] : [{ emailAddress: idn.email }]) : [{ emailAddress: idn.email }],
    publicMetadata: id === state.userId ? { plan: "employer", type: "organization", tier: state.tier, ...(idn.locale ? { locale: idn.locale } : {}) } : idn.locale ? { locale: idn.locale } : {},
  };
}

const mocks = {
  "@clerk/nextjs/server": () => ({
    auth: async () => ({ userId: state.userId }),
    currentUser: async () => (state.userId ? fakeClerkUser(state.userId) : null),
    clerkClient: async () => ({
      users: {
        getUser: async (id) => fakeClerkUser(id),
      },
    }),
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
const req = (body, method = "PATCH") => new Request(`${URLBASE}/x`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const postReq = (body) => req(body, "POST");

(async () => {
  // ═══ 1. lib/talent-pool-core.ts — pure logic ═══
  {
    const core = load("lib/talent-pool-core.ts");

    check("TALENT_POOL_VISIBLE_FIELDS covers every spec field (Q2) plus name/photo", core.TALENT_POOL_VISIBLE_FIELDS.join(",") === "name,photo,headline,skills,location,desiredRoles,yearsExperience,workAuthorization,bio");
    check("isTalentPoolField accepts a real field", core.isTalentPoolField("headline") === true);
    check("isTalentPoolField rejects junk", core.isTalentPoolField("ssn") === false && core.isTalentPoolField(42) === false);

    const dv = core.defaultVisibility();
    check("defaultVisibility: everything visible by default (Q4 — no minimum completeness, no default-hidden field)", core.TALENT_POOL_VISIBLE_FIELDS.every((f) => dv[f] === true));

    const patched = core.normalizeVisibility({ location: false, ssn: true }, core.defaultVisibility());
    check("normalizeVisibility: an explicit false hides that field", patched.location === false);
    check("normalizeVisibility: everything else stays visible", patched.headline === true && patched.skills === true);
    check("normalizeVisibility: an unknown key is dropped, never stored", !("ssn" in patched));
    check("normalizeVisibility: anything but explicit false (e.g. a stray string) stays visible, not just boolean true", core.normalizeVisibility({ bio: "yes" }, core.defaultVisibility()).bio === true);

    const profileData = {
      name: "Jamie Lee",
      photoUrl: "https://img/x.png",
      headline: "Senior PM",
      skills: ["sql", "figma"],
      location: "Austin, TX",
      desiredRoles: ["Product Manager"],
      yearsExperience: 6,
      workAuthorization: "US citizen",
      bio: "Ships things.",
    };
    const projectedAll = core.projectVisibleFields(profileData, core.defaultVisibility());
    check("projectVisibleFields: fully-visible profile includes every field", Object.keys(projectedAll).length === 9);
    const hiddenLocation = core.normalizeVisibility({ location: false, bio: false }, core.defaultVisibility());
    const projectedPartial = core.projectVisibleFields(profileData, hiddenLocation);
    check("projectVisibleFields: a hidden field is OMITTED entirely, never sent as null/blank (so the client can tell 'not shared' from 'shared but blank')", !("location" in projectedPartial) && !("bio" in projectedPartial));
    check("projectVisibleFields: contact info is never part of the shape at all — no email/phone key exists on the type", !("email" in projectedAll) && !("phone" in projectedAll));

    check("matchesSearch: a skill match (case-insensitive) passes", core.matchesSearch(profileData, { skills: ["SQL"] }) === true);
    check("matchesSearch: a skill the candidate doesn't have fails", core.matchesSearch(profileData, { skills: ["cobol"] }) === false);
    check("matchesSearch: a location substring match passes", core.matchesSearch(profileData, { location: "austin" }) === true);
    check("matchesSearch: desiredRole substring match passes", core.matchesSearch(profileData, { desiredRole: "product" }) === true);
    check("matchesSearch: minYearsExperience at/under the candidate's years passes", core.matchesSearch(profileData, { minYearsExperience: 6 }) === true);
    check("matchesSearch: minYearsExperience over the candidate's years fails", core.matchesSearch(profileData, { minYearsExperience: 7 }) === false);
    check("matchesSearch: null yearsExperience fails any minYearsExperience filter (never treated as 0 or infinite)", core.matchesSearch({ ...profileData, yearsExperience: null }, { minYearsExperience: 1 }) === false);
    check("matchesSearch: free-text q over headline+bio passes", core.matchesSearch(profileData, { q: "ships" }) === true);
    check("matchesSearch: free-text q with no match fails", core.matchesSearch(profileData, { q: "cobol mainframe" }) === false);
    check("matchesSearch: no filters at all always passes", core.matchesSearch(profileData, {}) === true);

    // Contact-request state machine (Q3).
    check("CONTACT_REQUEST_STATUSES is exactly the four states", core.CONTACT_REQUEST_STATUSES.join(",") === "pending,accepted,declined,withdrawn");
    check("isContactRequestStatus accepts a real status", core.isContactRequestStatus("declined") === true);
    check("isContactRequestStatus rejects junk", core.isContactRequestStatus("maybe") === false);

    const acceptMove = core.validateContactStatusMove("pending", "accepted");
    check("validateContactStatusMove: pending -> accepted is valid", acceptMove.ok === true && acceptMove.toStatus === "accepted");
    const declineMove = core.validateContactStatusMove("pending", "declined");
    check("validateContactStatusMove: pending -> declined is valid", declineMove.ok === true);
    check("validateContactStatusMove: pending -> pending is rejected (not a real move)", core.validateContactStatusMove("pending", "pending").ok === false);
    check("validateContactStatusMove: pending -> junk is rejected", core.validateContactStatusMove("pending", "bogus").ok === false);
    check("validateContactStatusMove: accepted -> declined is rejected (terminal state, no transition out)", core.validateContactStatusMove("accepted", "declined").ok === false);
    check("validateContactStatusMove: declined -> accepted is rejected (terminal state)", core.validateContactStatusMove("declined", "accepted").ok === false);
    check("validateContactStatusMove: withdrawn -> accepted is rejected (terminal state)", core.validateContactStatusMove("withdrawn", "accepted").ok === false);

    check("MAX_PENDING_CONTACT_REQUESTS_PER_EMPLOYER is 10 per the DECISIONS (Q1)", core.MAX_PENDING_CONTACT_REQUESTS_PER_EMPLOYER === 10);
    check("canSendContactRequest: under the cap is allowed", core.canSendContactRequest(9) === true);
    check("canSendContactRequest: AT the cap is blocked (10 pending already)", core.canSendContactRequest(10) === false);
    check("canSendContactRequest: over the cap is blocked", core.canSendContactRequest(11) === false);

    check("canResendAfterHistory: no prior history allows a send", core.canResendAfterHistory([]) === true);
    check("canResendAfterHistory: a prior decline blocks any future send to that candidate", core.canResendAfterHistory(["declined"]) === false);
    check("canResendAfterHistory: a prior withdrawal (employer's own cancel) does NOT block a resend", core.canResendAfterHistory(["withdrawn"]) === true);
    check("canResendAfterHistory: a prior acceptance does not block (irrelevant history, but not a block)", core.canResendAfterHistory(["accepted"]) === true);
  }

  // ═══ 2. lib/talent-pool-store.ts — CRUD against the fake Postgres ═══
  {
    resetWorld();
    const store = load("lib/talent-pool-store.ts");

    check("talentPoolEnabled: true once Supabase env vars are set", store.talentPoolEnabled() === true);

    const nothing = await store.getTalentPoolProfile("cand_1");
    check("getTalentPoolProfile: no row yet -> null, not a thrown error", nothing === null);

    const saved1 = await store.upsertTalentPoolProfile("cand_1", { headline: "Senior PM", skills: ["sql", "figma"], location: "Austin, TX", yearsExperience: 6 });
    check("upsertTalentPoolProfile: creates a row on first save", saved1 !== null && saved1.headline === "Senior PM");
    check("upsertTalentPoolProfile: a freshly-created row is NOT discoverable yet (filling in a profile is not the same as opting in)", saved1.isDiscoverable === false);

    const saved2 = await store.upsertTalentPoolProfile("cand_1", { bio: "Ships things." });
    check("upsertTalentPoolProfile: a second save UPDATES the same row rather than creating a second one", state.tables.talent_pool_profiles.length === 1);
    check("upsertTalentPoolProfile: fields not in this patch are preserved (partial update)", saved2.headline === "Senior PM" && saved2.bio === "Ships things.");

    const optedIn = await store.setTalentPoolDiscoverable("cand_1", true);
    check("setTalentPoolDiscoverable(true): flips is_discoverable and stamps opted_in_at", optedIn.isDiscoverable === true && !!optedIn.optedInAt);

    setIdentity("cand_1", { firstName: "Jamie", lastName: "Lee", imageUrl: "https://img/jamie.png" });
    const identity1 = { name: "Jamie Lee", photoUrl: "https://img/jamie.png" };
    const preview = store.previewForCandidate(optedIn, identity1);
    check("previewForCandidate: uses the SAME projection an employer gets — fully-visible profile includes name/photo from the supplied identity", preview.name === "Jamie Lee" && preview.headline === "Senior PM");

    // ── Opt-out cascade (Q4): immediate non-discoverability + auto-withdraw pending inbound ──
    const emp1Request = await store.createContactRequest("emp_1", optedIn, "Love your background — let's talk.");
    check("createContactRequest: a discoverable candidate can receive a request", emp1Request.ok === true);
    const optedOut = await store.setTalentPoolDiscoverable("cand_1", false);
    check("setTalentPoolDiscoverable(false): is_discoverable flips to false IMMEDIATELY", optedOut.isDiscoverable === false);
    check("setTalentPoolDiscoverable(false): opted_out_at is stamped", !!optedOut.optedOutAt);
    const afterOptOut = await store.getContactRequestForCandidate("cand_1", emp1Request.request.id);
    check("Opt-out auto-withdraws any still-pending INBOUND request — never left dangling for the employer to act on", afterOptOut.status === "withdrawn" && !!afterOptOut.respondedAt);

    // Opting back in restores the filled-in fields instead of starting over (soft-delete model, Q5).
    const backIn = await store.setTalentPoolDiscoverable("cand_1", true);
    check("Opting back in after an opt-out restores the SAME row's fields (soft delete, not a fresh start)", backIn.headline === "Senior PM" && backIn.skills.join(",") === "sql,figma");

    // ── Visible-fields projection via the store, with a hidden field ──
    await store.upsertTalentPoolProfile("cand_1", { visibility: { location: false } });
    const afterHide = await store.getTalentPoolProfile("cand_1");
    const hiddenPreview = store.previewForCandidate(afterHide, identity1);
    check("Hiding a field via upsertTalentPoolProfile is reflected in the next preview — the field is omitted", !("location" in hiddenPreview) && hiddenPreview.headline === "Senior PM");

    // ── A second, unrelated candidate — scoping proof (the store IS the RLS boundary here) ──
    await store.upsertTalentPoolProfile("cand_2", { headline: "Data Analyst", location: "Boston, MA" });
    await store.setTalentPoolDiscoverable("cand_2", true);
    const cand1Row = await store.getTalentPoolProfile("cand_1");
    const cand2Row = await store.getTalentPoolProfile("cand_2");
    check("getTalentPoolProfile(cand_1) never returns cand_2's row, and vice versa — per-candidate scoping holds with no RLS policy to lean on", cand1Row.candidateId === "cand_1" && cand2Row.candidateId === "cand_2" && cand1Row.headline !== cand2Row.headline);

    // ── Search (Q2): discoverable only, filtered, projected ──
    const identities = async (id) => (id === "cand_1" ? identity1 : { name: "Taylor Chen", photoUrl: null });
    const notDiscoverable = await store.upsertTalentPoolProfile("cand_3", { headline: "Should never appear", location: "Nowhere" });
    const resultsAll = await store.searchTalentPool({}, identities);
    check("searchTalentPool: a non-discoverable profile never appears, even with no filters", !resultsAll.some((r) => r.profile.headline === "Should never appear") && !!notDiscoverable);
    check("searchTalentPool: discoverable profiles DO appear", resultsAll.some((r) => r.profile.headline === "Data Analyst"));
    const filteredBoston = await store.searchTalentPool({ location: "boston" }, identities);
    check("searchTalentPool: a location filter excludes a non-matching discoverable profile", filteredBoston.length === 1 && filteredBoston[0].profile.location === "Boston, MA");
    check("searchTalentPool: result cards never carry a 'location' key for a candidate who hid it (cand_1)", resultsAll.find((r) => r.profile.headline === "Senior PM") === undefined || !("location" in resultsAll.find((r) => r.profile.headline === "Senior PM")));

    const byId = await store.getDiscoverableProfileById(afterHide.id);
    check("getDiscoverableProfileById: a discoverable profile's own id resolves", byId !== null && byId.id === afterHide.id);
    const hiddenRow = await store.getTalentPoolProfile("cand_3"); // not discoverable
    const byIdHidden = await store.getDiscoverableProfileById(hiddenRow.id);
    check("getDiscoverableProfileById: a NON-discoverable profile's id resolves to null — an employer can't bypass the gate by guessing an id", byIdHidden === null);

    // ── Contact flow (Q1/Q3/Q7): cap, decline-blocks-resend, state machine, per-employer/candidate scoping ──
    const freshCandidate = await store.setTalentPoolDiscoverable("cand_4", true);
    const sent1 = await store.createContactRequest("emp_2", freshCandidate, "Hi there");
    check("createContactRequest: a clean send succeeds", sent1.ok === true && sent1.request.status === "pending");
    const emptyMsg = await store.createContactRequest("emp_2", freshCandidate, "   ");
    check("createContactRequest: an empty/whitespace-only message is rejected (a message is required, Q3)", emptyMsg.ok === false);

    const declined = await store.respondToContactRequest("cand_4", sent1.request.id, "declined");
    check("respondToContactRequest: candidate can decline their own incoming request", declined.ok === true && declined.request.status === "declined");
    const resend = await store.createContactRequest("emp_2", freshCandidate, "Please reconsider");
    check("Decline-blocks-resend (Q3/Q7): the SAME employer cannot send this candidate another request after a decline", resend.ok === false);

    const otherEmployerCandidate = await store.setTalentPoolDiscoverable("cand_5", true);
    const notMine = await store.respondToContactRequest("cand_4", "nonexistent-id", "accepted");
    check("respondToContactRequest: responding to an id that isn't this candidate's own request fails cleanly (scoping — not a crash)", notMine.ok === false);

    const crossSend = await store.createContactRequest("emp_3", otherEmployerCandidate, "Hello from a different employer");
    check("Decline-blocks-resend is per (employer, candidate) pair — a DIFFERENT employer may still send to cand_4", (await store.createContactRequest("emp_4", freshCandidate, "A third employer, first attempt")).ok === true);
    check("...and the unrelated emp_3 -> cand_5 send is unaffected by cand_4's history", crossSend.ok === true);

    // 10-pending cap (Q1/Q7).
    for (let i = 0; i < 9; i++) {
      await store.setTalentPoolDiscoverable(`cand_cap_${i}`, true);
    }
    let lastOk = null;
    for (let i = 0; i < 9; i++) {
      const target = await store.getTalentPoolProfile(`cand_cap_${i}`);
      lastOk = await store.createContactRequest("emp_cap", target, `Request #${i}`);
    }
    const pendingCount = await store.countPendingContactRequestsForEmployer("emp_cap");
    check("countPendingContactRequestsForEmployer: 9 sends (plus 1 already counted via emp_cap test setup if any) tracked accurately", pendingCount === 9, pendingCount);
    await store.setTalentPoolDiscoverable("cand_cap_9", true);
    const tenth = await store.createContactRequest("emp_cap", await store.getTalentPoolProfile("cand_cap_9"), "Request #10");
    check("The 10th pending send is allowed (cap is 10, not 9)", tenth.ok === true, lastOk);
    await store.setTalentPoolDiscoverable("cand_cap_10", true);
    const eleventh = await store.createContactRequest("emp_cap", await store.getTalentPoolProfile("cand_cap_10"), "Request #11");
    check("The 11th pending send is BLOCKED — the 10-pending cap (Q1/Q7) holds", eleventh.ok === false);
    await store.respondToContactRequest("cand_cap_0", (await store.listIncomingContactRequests("cand_cap_0"))[0].id, "accepted");
    const afterResolve = await store.createContactRequest("emp_cap", await store.getTalentPoolProfile("cand_cap_10"), "Request #11, retried");
    check("Resolving one pending request frees a slot for a new one ('blocked until a pending one resolves', Q1)", afterResolve.ok === true);

    // Per-candidate / per-employer list scoping.
    const incomingCand4 = await store.listIncomingContactRequests("cand_4");
    check("listIncomingContactRequests(cand_4) never includes a request addressed to cand_5 or any cand_cap_*", incomingCand4.every((r) => r.candidateId === "cand_4"));
    const sentEmp2 = await store.listSentContactRequests("emp_2");
    check("listSentContactRequests(emp_2) never includes a request sent by emp_3/emp_4/emp_cap", sentEmp2.every((r) => r.employerId === "emp_2"));
  }

  // ═══ 3. Candidate-side routes (app/api/talent-pool/**) ═══
  {
    resetWorld();
    const profileRoute = route("talent-pool/profile");
    const requestsRoute = route("talent-pool/requests");
    const requestIdRoute = route("talent-pool/requests/[id]");

    state.userId = null;
    const unauthGet = await profileRoute.GET();
    check("GET /api/talent-pool/profile: signed-out -> 401 (candidate opt-in needs an account, Q1 free-for-all-tiers still means an account)", unauthGet.status === 401);

    state.userId = "cand_A";
    setIdentity("cand_A", { firstName: "Ana", lastName: "Reyes" });
    const emptyGet = await profileRoute.GET();
    const emptyBody = await emptyGet.json();
    check("GET /api/talent-pool/profile: a brand-new candidate gets a default (not-discoverable) shape, not a 500", emptyGet.status === 200 && emptyBody.profile.isDiscoverable === false);

    const saveRes = await profileRoute.PATCH(req({ headline: "Staff Engineer", skills: ["rust", "go"], location: "Seattle, WA" }));
    check("PATCH /api/talent-pool/profile: a plain field edit succeeds", saveRes.status === 200);

    const toggleRes = await profileRoute.PATCH(req({ discoverable: true }));
    const toggleBody = await toggleRes.json();
    check("PATCH /api/talent-pool/profile: the opt-in toggle (discoverable:true) is a SEPARATE call from field edits — never silently paired with an unreviewed field change", toggleRes.status === 200 && toggleBody.profile.isDiscoverable === true);

    const bothIgnoredFields = await profileRoute.PATCH(req({ discoverable: true, headline: "should be ignored" }));
    const bothBody = await bothIgnoredFields.json();
    check("PATCH /api/talent-pool/profile: when `discoverable` is present, the opt-in branch runs and field keys in the SAME call are ignored (one call never does both)", bothBody.profile.headline === "Staff Engineer");

    // A second candidate, as an employer's incoming-request target.
    state.userId = "cand_B";
    setIdentity("cand_B", { firstName: "Bo", lastName: "Kim" });
    await profileRoute.PATCH(req({ headline: "Designer" }));
    await profileRoute.PATCH(req({ discoverable: true }));

    // Seed a contact request from an employer directly via the store (employer routes covered in section 4).
    const store = load("lib/talent-pool-store.ts");
    const candBProfile = await store.getTalentPoolProfile("cand_B");
    state.tables.employer_profiles.push({ user_id: "emp_X", company_name: "Acme Robotics" });
    await store.createContactRequest("emp_X", candBProfile, "We'd love to chat about a Design Lead role.");

    state.userId = "cand_A";
    const crossRequests = await requestsRoute.GET();
    const crossBody = await crossRequests.json();
    check("GET /api/talent-pool/requests: candidate A's incoming list never contains a request addressed to candidate B", crossBody.requests.length === 0);

    state.userId = "cand_B";
    const ownRequests = await requestsRoute.GET();
    const ownBody = await ownRequests.json();
    check("GET /api/talent-pool/requests: candidate B sees their own incoming request, with the employer's company name resolved", ownBody.requests.length === 1 && ownBody.requests[0].employerCompany === "Acme Robotics");
    const reqId = ownBody.requests[0].id;

    const badStatus = await requestIdRoute.PATCH(req({ status: "withdrawn" }), { params: { id: reqId } });
    check("PATCH /api/talent-pool/requests/[id]: a candidate cannot set an arbitrary status (only accepted/declined) — withdrawn is the employer/system-only transition", badStatus.status === 400);

    state.userId = "cand_A";
    const crossRespond = await requestIdRoute.PATCH(req({ status: "accepted" }), { params: { id: reqId } });
    check("PATCH /api/talent-pool/requests/[id]: candidate A cannot accept/decline a request addressed to candidate B — scoped lookup, not just a status check", crossRespond.status === 400);

    state.userId = "cand_B";
    const acceptRes = await requestIdRoute.PATCH(req({ status: "accepted" }), { params: { id: reqId } });
    check("PATCH /api/talent-pool/requests/[id]: candidate B accepts their own request", acceptRes.status === 200);
    const reAccept = await requestIdRoute.PATCH(req({ status: "declined" }), { params: { id: reqId } });
    check("PATCH /api/talent-pool/requests/[id]: a second response to an already-resolved (terminal) request is rejected — no transition out of a terminal state", reAccept.status === 400);
  }

  // ═══ 4. Employer-side routes (app/api/employer/talent-pool/**) — tier gating ═══
  {
    resetWorld();
    const searchRoute = route("employer/talent-pool/search");
    const detailRoute = route("employer/talent-pool/[id]");
    const contactRoute = route("employer/talent-pool/contact");
    const store = load("lib/talent-pool-store.ts");

    // Seed one discoverable candidate directly via the store.
    state.userId = "seed";
    const seeded = await store.setTalentPoolDiscoverable("cand_search", true);
    await store.upsertTalentPoolProfile("cand_search", { headline: "Backend Engineer", skills: ["go", "postgres"], location: "Denver, CO" });
    setIdentity("cand_search", { firstName: "Robin", lastName: "Patel" });

    // Free tier: blocked from both browse and contact (Q1).
    state.userId = "emp_free";
    state.tier = "free";
    const freeSearch = await searchRoute.GET(new Request(`${URLBASE}/x?location=denver`));
    check("GET /api/employer/talent-pool/search: a Free-tier employer is refused BEFORE any query runs (402 tier_locked)", freeSearch.status === 402, await freeSearch.json());
    const freeDetail = await detailRoute.GET(new Request(`${URLBASE}/x`), { params: { id: seeded.id } });
    check("GET /api/employer/talent-pool/[id]: a Free-tier employer can't bypass the search gate by guessing a profile id directly", freeDetail.status === 402);
    const freeContact = await contactRoute.POST(postReq({ profileId: seeded.id, message: "Hi" }));
    check("POST /api/employer/talent-pool/contact: a Free-tier employer is refused", freeContact.status === 402);

    // Portal tier: can browse, cannot contact (Q1).
    state.userId = "emp_portal";
    state.tier = "portal";
    const portalSearch = await searchRoute.GET(new Request(`${URLBASE}/x?location=denver`));
    const portalSearchBody = await portalSearch.json();
    check("GET /api/employer/talent-pool/search: Portal tier can browse and finds the Denver candidate", portalSearch.status === 200 && portalSearchBody.results.length === 1 && portalSearchBody.results[0].profile.location === "Denver, CO");
    check("Search results never include an email/phone key (contact info is never shown on a card, Q2)", !("email" in portalSearchBody.results[0].profile) && !("phone" in portalSearchBody.results[0].profile));
    const portalDetail = await detailRoute.GET(new Request(`${URLBASE}/x`), { params: { id: seeded.id } });
    check("GET /api/employer/talent-pool/[id]: Portal tier can open the detail view", portalDetail.status === 200);
    const portalContact = await contactRoute.POST(postReq({ profileId: seeded.id, message: "Hi" }));
    check("POST /api/employer/talent-pool/contact: Portal tier is refused (contact needs Scale, Q1)", portalContact.status === 402);

    // Scale tier: can do both.
    state.userId = "emp_scale";
    state.tier = "scale";
    const scaleSearch = await searchRoute.GET(new Request(`${URLBASE}/x`));
    check("GET /api/employer/talent-pool/search: Scale tier can browse", scaleSearch.status === 200);
    const scaleContact = await contactRoute.POST(postReq({ profileId: seeded.id, message: "We have a role you'd be great for." }));
    check("POST /api/employer/talent-pool/contact: Scale tier can send a contact request", scaleContact.status === 200, await scaleContact.json().catch(() => null));

    // GET sent requests: contact info only once accepted, and never for someone else's sent list.
    state.tables.user_profiles.push({ user_id: "cand_search", phone: "555-0100" });
    setIdentity("cand_search", { firstName: "Robin", lastName: "Patel", email: "robin@example.com" });
    const sentBeforeAccept = await contactRoute.GET();
    const sentBeforeAcceptBody = await sentBeforeAccept.json();
    check("GET /api/employer/talent-pool/contact: a PENDING sent request never carries a contact object", sentBeforeAcceptBody.requests[0].contact === undefined);

    const incomingId = (await store.listIncomingContactRequests("cand_search"))[0].id;
    await store.respondToContactRequest("cand_search", incomingId, "accepted");
    const sentAfterAccept = await contactRoute.GET();
    const sentAfterAcceptBody = await sentAfterAccept.json();
    check("GET /api/employer/talent-pool/contact: once ACCEPTED, the candidate's contact details (as they chose to share) appear inside the request view (Q3)", sentAfterAcceptBody.requests[0].contact.email === "robin@example.com" && sentAfterAcceptBody.requests[0].contact.phone === "555-0100");

    state.userId = "emp_portal"; // never sent anything
    const otherEmployerSent = await contactRoute.GET();
    const otherEmployerSentBody = await otherEmployerSent.json();
    check("GET /api/employer/talent-pool/contact: an employer who never sent a request sees an empty list, never emp_scale's", otherEmployerSentBody.requests.length === 0);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
})().catch((e) => {
  console.error("Uncaught error in test-talent-pool.cjs:", e);
  process.exit(1);
});
