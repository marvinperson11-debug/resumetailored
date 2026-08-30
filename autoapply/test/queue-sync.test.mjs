#!/usr/bin/env node
/**
 * Unit tests for the pure bridge logic (src/lib/queue-sync.js) — the status
 * maps, payload normalization, header building, and URL joining that connect
 * the standalone AutoApply app to the main ResumeTailored app's /api/apply-queue.
 *
 * Framework-free so it runs under plain Node with no build step, Postgres, or
 * Next.js:  node autoapply/test/queue-sync.test.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const sync = require(path.join(here, "..", "src", "lib", "queue-sync.js"));

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
};

// ── main → local status mapping (local enum is coarser) ──────────────────────
check("queued → NEW", sync.mainToLocalStatus("queued") === "NEW");
check("auto_filled → PREPARED", sync.mainToLocalStatus("auto_filled") === "PREPARED");
check("submitted → APPLIED", sync.mainToLocalStatus("submitted") === "APPLIED");
check("manual_needed → NEW", sync.mainToLocalStatus("manual_needed") === "NEW");
check("archived → APPLIED", sync.mainToLocalStatus("archived") === "APPLIED");
check("unknown main status → NEW (safe default)", sync.mainToLocalStatus("wat") === "NEW");

// ── local → main status mapping (fallback manual_needed per spec) ────────────
check("NEW → queued", sync.localToMainStatus("NEW") === "queued");
check("PREPARED → auto_filled", sync.localToMainStatus("PREPARED") === "auto_filled");
check("APPLIED → submitted", sync.localToMainStatus("APPLIED") === "submitted");
check("unknown local status → manual_needed (fallback)", sync.localToMainStatus("ZzZ") === "manual_needed");

// Every main status maps to a real local status, and vice-versa.
check("all main statuses map to a valid local status",
  sync.MAIN_STATUSES.every((s) => sync.LOCAL_STATUSES.includes(sync.mainToLocalStatus(s))));
check("all local statuses map to a valid main status",
  sync.LOCAL_STATUSES.every((s) => sync.MAIN_STATUSES.includes(sync.localToMainStatus(s))));

// ── normalizeMainItem ────────────────────────────────────────────────────────
const norm = sync.normalizeMainItem({
  id: 42, jobUrl: "https://x/y", jobTitle: "RN", companyName: "Mercy", jobBoard: "linkedin",
  status: "auto_filled", updatedAt: 123,
});
check("normalize maps main id to string mainId", norm.mainId === "42");
check("normalize carries role/company/board", norm.roleTitle === "RN" && norm.companyName === "Mercy" && norm.jobBoard === "linkedin");
check("normalize keeps mainStatus + derives local status", norm.mainStatus === "auto_filled" && norm.status === "PREPARED");

const empty = sync.normalizeMainItem({});
check("normalize tolerates a missing payload", empty.mainId === "" && empty.jobUrl === "" && empty.status === "NEW" && empty.mainStatus === "queued");
check("normalize coerces an unknown status to queued/NEW", sync.normalizeMainItem({ status: "bogus" }).mainStatus === "queued");

// ── headers + url + config guard ─────────────────────────────────────────────
const h = sync.mainQueueHeaders("secret", "  User@Example.COM ");
check("headers carry the service token", h["x-rt-service-token"] === "secret");
check("headers lowercase + trim the email", h["x-rt-user-email"] === "user@example.com");
check("headers set JSON content-type", h["Content-Type"] === "application/json");

check("joinUrl avoids double slashes", sync.joinUrl("https://a.com/", "/api/x") === "https://a.com/api/x");
check("joinUrl adds a missing slash", sync.joinUrl("https://a.com", "api/x") === "https://a.com/api/x");

check("bridge configured needs both url + token", sync.isBridgeConfigured("https://a", "t") === true);
check("bridge not configured when url missing", sync.isBridgeConfigured("", "t") === false);
check("bridge not configured when token missing", sync.isBridgeConfigured("https://a", "") === false);

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? "" : "s"})`); process.exit(1); }
console.log("\nALL PASS (0 failures)");
process.exit(0);
