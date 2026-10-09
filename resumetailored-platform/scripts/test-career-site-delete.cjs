#!/usr/bin/env node
/**
 * Career-site delete regression test (npm run test:career-site-delete).
 * Owner can delete their own site; another employer cannot touch it; a team member (whose workspace id
 * is the owner's but whose own user id differs) cannot delete; deletion is soft; the site then reads as
 * "deleted" and can be created again cleanly. Uses an in-memory stand-in for the Supabase client.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  module._compile(out.outputText, filename);
};
// Stub the heavy imports career-site-store pulls in (no network / env needed for the pure paths under test).
const Module = require("module");
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "./tenant-resolve") return path.join(ROOT, "scripts/.stub-tenant-resolve.cjs");
  return realResolve.call(this, request, ...rest);
};
fs.writeFileSync(path.join(ROOT, "scripts/.stub-tenant-resolve.cjs"), "exports.isSlugTaken=async()=>false;exports.recordSlugAlias=async()=>{};");
process.on("exit", () => { try { fs.unlinkSync(path.join(ROOT, "scripts/.stub-tenant-resolve.cjs")); } catch {} });

const { canManageCareerSite } = require(path.join(ROOT, "lib/career-site-permissions.ts"));
const store = require(path.join(ROOT, "lib/career-site-store.ts"));

let failures = 0;
const check = (name, ok, detail) => { if (ok) console.log("PASS ", name); else { failures++; console.error("FAIL ", name, detail ? "— " + detail : ""); } };

// ── minimal in-memory Supabase stand-in for the calls the store makes ──
function fakeClient(rows) {
  const from = () => {
    let op = "select", patch = null, filters = [], wantSelect = false;
    const match = (r) => filters.every(([col, kind, val]) => (kind === "eq" ? r[col] === val : kind === "is" ? (val === null ? r[col] == null : r[col] === val) : true));
    const run = () => {
      if (op === "update") {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, patch));
        return { data: wantSelect ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
    };
    const b = {
      select() { wantSelect = true; return b; },
      update(p) { op = "update"; patch = p; return b; },
      eq(c, v) { filters.push([c, "eq", v]); return b; },
      is(c, v) { filters.push([c, "is", v]); return b; },
      maybeSingle: async () => ({ data: run().data[0] || null, error: null }),
      single: async () => { const d = run().data; return d && d[0] ? { data: d[0], error: null } : { data: null, error: { message: "no row" } }; },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from };
}
const mkRow = (employer, slug, extra = {}) => ({ id: slug.length, employer_id: employer, slug, company_name: slug + " Inc", about_text: "old about", benefits: ["old benefit"], deleted_at: null, ...extra });

(async () => {
  // Permission rule
  check("owner (user id === workspace id) may manage", canManageCareerSite({ userId: "emp_A", employerId: "emp_A" }));
  check("invited team member (own user id ≠ workspace id) may NOT", !canManageCareerSite({ userId: "user_member", employerId: "emp_A" }));
  check("no session may NOT", !canManageCareerSite(null) && !canManageCareerSite(undefined));
  check("empty ids may NOT", !canManageCareerSite({ userId: "", employerId: "" }));

  // Store: owner deletes own, other employer cannot
  const rows = [mkRow("emp_A", "acme"), mkRow("emp_B", "globex")];
  const client = fakeClient(rows);
  check("another employer's delete does not touch A's site (B deleting 'emp_A' via B's own id)", (await store.softDeleteCareerSite("emp_C", client)) === false && !rows[0].deleted_at && !rows[1].deleted_at);
  check("owner A deletes their own site", (await store.softDeleteCareerSite("emp_A", client)) === true && !!rows[0].deleted_at);
  check("B's site is untouched by A's delete", rows[1].deleted_at === null);
  check("delete is SOFT: the row, slug and content are kept", rows.length === 2 && rows[0].slug === "acme" && rows[0].about_text === "old about");
  check("deleting twice reports nothing to delete", (await store.softDeleteCareerSite("emp_A", client)) === false);
  check("empty employer id deletes nothing", (await store.softDeleteCareerSite("", client)) === false);

  // State + create again
  check("a deleted site reads as 'deleted' (not silently recreated)", (await store.getCareerSiteState("emp_A", client)).state === "deleted");
  check("B's site still reads as active", (await store.getCareerSiteState("emp_B", client)).state === "active");
  const again = await store.createCareerSite("emp_A", "Acme", client);
  check("creating again works and keeps the same address", !!again && again.slug === "acme");
  check("creating again starts clean (old content not carried over)", !!again && again.aboutText === "" && again.benefits.length === 0, JSON.stringify(again));
  check("the revived site is live again", rows[0].deleted_at === null && (await store.getCareerSiteState("emp_A", client)).state === "active");
  check("creating when one is already live returns it unchanged", (await store.createCareerSite("emp_B", "Globex", client)).slug === "globex");

  // Server wiring
  const route = fs.readFileSync(path.join(ROOT, "app/api/employer/career-site/route.ts"), "utf8");
  const del = route.slice(route.indexOf("export async function DELETE"), route.indexOf("export async function PATCH"));
  check("DELETE route checks the session owner server-side (employerContext + canManageCareerSite)", /employerContext\(\)/.test(del) && /canManageCareerSite\(ctx\)/.test(del) && /403/.test(del));
  check("DELETE route never reads the employer id from the request", !/req\b|searchParams|request\./.test(del.replace(/export async function DELETE\(\)/, "")));
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function DELETE"));
  check("POST (re-create) is owner-only too", /canManageCareerSite\(ctx\)/.test(post));
  const store_src = fs.readFileSync(path.join(ROOT, "lib/career-site-store.ts"), "utf8");
  check("public page read returns nothing for a soft-deleted site", /isDeletedRow\(row\)\) return null/.test(store_src));
  check("migration adds deleted_at", /deleted_at/.test(fs.readFileSync(path.join(ROOT, "supabase/migrations/0045_career_site_soft_delete.sql"), "utf8")));
  const ui = fs.readFileSync(path.join(ROOT, "app/employer/career-site/career-site-client.tsx"), "utf8");
  check("UI: delete takes two confirmation steps and only shows while a site exists", /deleteStep === 1/.test(ui) && /deleteStep === 2/.test(ui) && /!loading && hasSite/.test(ui));
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
