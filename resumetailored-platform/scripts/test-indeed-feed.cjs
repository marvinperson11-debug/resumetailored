#!/usr/bin/env node
/**
 * Distribution Fix 2 — pure-function tests (npm run test:indeed-feed).
 * lib/feed-location.ts (US location-string parsing) and the three new field
 * builders in lib/job-distribution.ts (jobtype / salary range / expiration
 * date). No DB, no network — the feed route's own XML assembly and the
 * get_distribution_status notice are integration-tested against the fake
 * Postgres harness in scripts/test-employer-assistant.cjs instead.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  module._compile(out.outputText, filename);
};

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) console.log("PASS ", name);
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

const { parseFeedLocation, FEED_LOCATION_UNPARSEABLE_NOTICE } = require(path.join(ROOT, "lib/feed-location.ts"));
const { buildIndeedJobType, buildIndeedSalaryField, toIndeedExpirationDate } = require(path.join(ROOT, "lib/job-distribution.ts"));
const { computeValidThrough } = require(path.join(ROOT, "lib/job-posting-lifecycle.ts"));

// ── parseFeedLocation ────────────────────────────────────────────────────────

check(
  "\"City, ST\": splits into city + state + country=US",
  JSON.stringify(parseFeedLocation("LaGrange, GA")) === JSON.stringify({ city: "LaGrange", state: "GA", country: "US", remote: false, unparseable: false })
);

check(
  "\"City, ST ZIP\": the zip is stripped, not leaked into state",
  JSON.stringify(parseFeedLocation("Phoenix, AZ 85003")) === JSON.stringify({ city: "Phoenix", state: "AZ", country: "US", remote: false, unparseable: false })
);

check(
  "\"City, ST ZIP+4\": the extended zip is stripped too",
  JSON.stringify(parseFeedLocation("Phoenix, AZ 85003-1234")) === JSON.stringify({ city: "Phoenix", state: "AZ", country: "US", remote: false, unparseable: false })
);

check(
  "\"City, Full State Name\": mapped to its USPS abbreviation",
  JSON.stringify(parseFeedLocation("Austin, Texas")) === JSON.stringify({ city: "Austin", state: "TX", country: "US", remote: false, unparseable: false })
);

check(
  "\"City, Full State Name\" (multi-word): mapped correctly",
  JSON.stringify(parseFeedLocation("Buffalo, New York")) === JSON.stringify({ city: "Buffalo", state: "NY", country: "US", remote: false, unparseable: false })
);

check(
  "Full state name is case-insensitive",
  JSON.stringify(parseFeedLocation("Atlanta, georgia")) === JSON.stringify({ city: "Atlanta", state: "GA", country: "US", remote: false, unparseable: false })
);

for (const remoteInput of ["Remote", "remote", "Fully Remote", "Work From Home", "work-from-home", "WFH"]) {
  const parsed = parseFeedLocation(remoteInput);
  check(`remote indicator "${remoteInput}" -> city:"remote", no state/country, not unparseable`, parsed.remote === true && parsed.city === "remote" && parsed.state === undefined && parsed.country === undefined && parsed.unparseable === false, parsed);
}

for (const junk of ["Anywhere", "Nationwide", "TBD", "Earth"]) {
  const parsed = parseFeedLocation(junk);
  check(`unparseable junk "${junk}" -> raw text kept as city, flagged unparseable, no state/country`, parsed.city === junk && parsed.unparseable === true && parsed.state === undefined && parsed.country === undefined, parsed);
}

check("empty/blank location -> empty city, not flagged unparseable (nothing to flag)", JSON.stringify(parseFeedLocation("")) === JSON.stringify({ city: "", remote: false, unparseable: false }));
check("null location -> same as empty", JSON.stringify(parseFeedLocation(null)) === JSON.stringify({ city: "", remote: false, unparseable: false }));
check("a bogus 2-letter state abbreviation falls through to unparseable rather than a false match", parseFeedLocation("Nowhereville, ZZ").unparseable === true);
check("FEED_LOCATION_UNPARSEABLE_NOTICE is the exact text both call sites share", typeof FEED_LOCATION_UNPARSEABLE_NOTICE === "string" && /City, ST/.test(FEED_LOCATION_UNPARSEABLE_NOTICE) && /Indeed/.test(FEED_LOCATION_UNPARSEABLE_NOTICE));

// ── buildIndeedJobType ───────────────────────────────────────────────────────

check("buildIndeedJobType: full-time -> fulltime", buildIndeedJobType("full-time") === "fulltime");
check("buildIndeedJobType: part-time -> parttime", buildIndeedJobType("part-time") === "parttime");
check("buildIndeedJobType: contract -> contract", buildIndeedJobType("contract") === "contract");
check("buildIndeedJobType: internship -> internship", buildIndeedJobType("internship") === "internship");
check("buildIndeedJobType: unset/unknown -> \"\" (element omitted)", buildIndeedJobType("") === "" && buildIndeedJobType("made-up") === "");

// ── buildIndeedSalaryField ───────────────────────────────────────────────────

check("buildIndeedSalaryField: both bounds -> a dash range", buildIndeedSalaryField(40000, 55000, "USD", "year") === "40000-55000 USD per year");
check("buildIndeedSalaryField: min-only is UNCHANGED from the pre-Fix-2 single-value string", buildIndeedSalaryField(50000, null, "USD", "year") === "50000 USD per year");
check("buildIndeedSalaryField: max-only is UNCHANGED from the pre-Fix-2 single-value string", buildIndeedSalaryField(null, 60000, "USD", "month") === "60000 USD per month");
check("buildIndeedSalaryField: equal min/max collapses to a single value, not a degenerate range", buildIndeedSalaryField(45000, 45000, "USD", "year") === "45000 USD per year");
check("buildIndeedSalaryField: neither bound -> \"\" (element omitted)", buildIndeedSalaryField(null, null, "USD", "year") === "");

// ── toIndeedExpirationDate ───────────────────────────────────────────────────

check("toIndeedExpirationDate: date-only (no time component), unlike <date>'s full ISO-8601", toIndeedExpirationDate("2026-02-15T00:00:00.000Z") === "2026-02-15");
check("toIndeedExpirationDate: null (never published) -> \"\" (element omitted)", toIndeedExpirationDate(null) === "");
check(
  "toIndeedExpirationDate composes with computeValidThrough: explicit valid_through wins over the 30-day default",
  toIndeedExpirationDate(computeValidThrough("2026-01-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z")) === "2026-06-01"
);
check(
  "toIndeedExpirationDate composes with computeValidThrough: no explicit valid_through -> publishedAt + 30 days",
  toIndeedExpirationDate(computeValidThrough("2026-01-01T00:00:00.000Z", null)) === "2026-01-31"
);

console.log(`\n${failures ? failures + " FAILURE(S)" : "ALL PASS"}`);
process.exit(failures ? 1 : 0);
