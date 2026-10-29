import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Access } from "./plan";
import { normalizeTier } from "./employer-tier";

/**
 * Free-tier "one permanent hiring story" (Taylor Combined Build v5, Section
 * E). Marvin's settled rules: a Free employer gets exactly ONE job post
 * ever, ONE active candidate slot (with every candidate tool), and ONE
 * non-owner employee — but never a lock icon or an upfront wall for any of
 * it. Every page stays reachable; the paywall only ever shows up INSIDE the
 * action that would exceed one of those three, phrased as graduation (what
 * the employer just accomplished + what upgrading unlocks), never as a
 * punishment.
 *
 * This module is split into three layers on purpose:
 *   1. `requireTierFor` — the ONE shared gate every Free-limited call site
 *      uses to turn "would this exceed the Free limit?" into either a pass
 *      or a graduation-shaped refusal. It does NOT know how to detect a
 *      violation for any specific feature — that varies too much per
 *      feature (a job create is a count check, an edit is a field-identity
 *      check, a refill is a cooldown check) to live in one function without
 *      smuggling seven different shapes of logic behind one signature. Each
 *      call site computes its own `isWithinFreeLimit` boolean using the
 *      detector functions below, then asks this gate to render it.
 *   2. The detector functions (`jobCreateAllowed`, `isLockedJobField`,
 *      `isSubstantialRoleRewrite`, `candidateAddAllowed`,
 *      `refillCooldownOk`, `employeeAddAllowed`) — pure, directly testable,
 *      no network.
 *   3. The `free_tier_state` store (migration 0077) — the grandfather
 *      snapshot plus the one monotonic counter (jobs ever created) and the
 *      one timestamp (last candidate refill) this feature needs that
 *      nothing else in the schema already tracks.
 */

export function isFreeTier(access: Access): boolean {
  if (access.isAdmin) return false;
  return normalizeTier(access.tier) === "free";
}

export type FreeFeatureKey = "job_create" | "job_edit_locked_field" | "job_identity_change" | "job_edit_closed" | "candidate_add" | "candidate_refill_cooldown" | "employee_add";

export interface GateResult {
  allowed: boolean;
  /** Graduation-shaped refusal copy — empty string when allowed. Always
   *  names a real accomplishment (supplied by the caller from the
   *  employer's own activity) and what upgrading to Portal unlocks; never
   *  phrased as a penalty. */
  message: string;
}

const FEATURE_UNLOCKS: Record<FreeFeatureKey, string> = {
  job_create: "posting unlimited jobs and managing unlimited candidates on the Portal plan",
  job_edit_locked_field: "editing every field, anytime, with no locked fields, on the Portal plan",
  job_identity_change: "posting and editing as many roles as you need on the Portal plan",
  job_edit_closed: "reopening and editing closed posts freely on the Portal plan",
  candidate_add: "unlimited candidate slots on the Portal plan",
  candidate_refill_cooldown: "refilling candidate slots anytime, with no cooldown, on the Portal plan",
  employee_add: "unlimited team members on the Portal plan",
};

/** Core of the shared gate, keyed on an already-resolved tier string rather
 *  than a full `Access` — some call sites (the assistant's approval-time
 *  mutation executors, lib/assistant-mutations.ts) only ever have an
 *  `employerId`, no session/Access object, and resolve a tier string
 *  themselves (lib/employer-plan.ts `resolveTierForUserId`). Both
 *  `requireTierFor` below and those executors go through this one function
 *  so the graduation copy can never drift between the two. */
export function gradeGate(tier: string, featureKey: FreeFeatureKey, accomplishmentContext: string, isWithinFreeLimit: boolean): GateResult {
  if (normalizeTier(tier) !== "free") return { allowed: true, message: "" };
  if (isWithinFreeLimit) return { allowed: true, message: "" };
  const accomplishment = accomplishmentContext.trim();
  const unlock = FEATURE_UNLOCKS[featureKey];
  const message = accomplishment ? `${accomplishment} — upgrading unlocks ${unlock}.` : `Upgrading unlocks ${unlock}.`;
  return { allowed: false, message };
}

/** The ONE shared gate for every Free-limited action reached through a
 *  normal signed-in request (Section E.2). Non-free tiers (and the admin
 *  bypass) always pass through untouched — this never touches Portal/
 *  Scale/Corporate behavior. For a Free employer, `isWithinFreeLimit` is
 *  the caller's own, feature-specific determination of whether THIS action
 *  stays inside the one-hiring-story limit; this function's only job is to
 *  turn a `false` into the one consistent graduation shape (a real
 *  accomplishment + the named unlock) instead of a bare rejection. */
export function requireTierFor(access: Access, featureKey: FreeFeatureKey, accomplishmentContext: string, isWithinFreeLimit: boolean): GateResult {
  return gradeGate(access.isAdmin ? "corporate" : access.tier || "free", featureKey, accomplishmentContext, isWithinFreeLimit);
}

// ── free_tier_state store ────────────────────────────────────────────────────

let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export interface FreeTierState {
  employerId: string;
  jobsCount: number;
  candidatesActive: number;
  employeesNonOwner: number;
  lastCandidateRefillAt: string | null;
}

const DEFAULT_STATE = (employerId: string): FreeTierState => ({ employerId, jobsCount: 0, candidatesActive: 0, employeesNonOwner: 0, lastCandidateRefillAt: null });

function mapRow(employerId: string, r: Record<string, unknown> | null): FreeTierState {
  if (!r) return DEFAULT_STATE(employerId);
  return {
    employerId,
    jobsCount: Number(r.jobs_count) || 0,
    candidatesActive: Number(r.candidates_active) || 0,
    employeesNonOwner: Number(r.employees_non_owner) || 0,
    lastCandidateRefillAt: (r.last_candidate_refill_at as string) || null,
  };
}

/** Read this employer's free-tier counters — a Free employer who has never
 *  touched any of this (including every new signup after migration 0077)
 *  simply has no row yet, which reads back as all-zero/null, never an error. */
export async function getFreeTierState(employerId: string): Promise<FreeTierState> {
  const c = db();
  if (!c || !employerId) return DEFAULT_STATE(employerId);
  try {
    const { data } = await c.from("free_tier_state").select("jobs_count, candidates_active, employees_non_owner, last_candidate_refill_at").eq("employer_id", employerId).maybeSingle();
    return mapRow(employerId, data as Record<string, unknown> | null);
  } catch {
    return DEFAULT_STATE(employerId);
  }
}

/** Insert the row if this employer has never touched any of this before, or
 *  update it in place otherwise — a plain `.upsert()` would do the same
 *  thing against real Postgres, but this reads-then-branches explicitly so
 *  a second write to an existing row is always a real UPDATE (never a
 *  second, duplicate INSERT), which matters most for a monotonic counter
 *  like `jobs_count`. */
async function updateOrInsertFreeTierState(employerId: string, patch: Record<string, unknown>): Promise<void> {
  const c = db();
  if (!c || !employerId) return;
  const { data } = await c.from("free_tier_state").select("employer_id").eq("employer_id", employerId).maybeSingle();
  const stamped = { ...patch, updated_at: new Date().toISOString() };
  if (data) {
    await c.from("free_tier_state").update(stamped).eq("employer_id", employerId);
  } else {
    await c.from("free_tier_state").insert({ employer_id: employerId, ...stamped });
  }
}

/** Bump the monotonic "jobs ever created" counter by exactly one, creating
 *  the row at 1 if this is the employer's first. Called from the one place
 *  both the hand-driven job form and Taylor's one-shot flow share creating
 *  a job (app/api/employer/jobs/route.ts, lib/assistant-mutations.ts
 *  `executeDraftJobPost`), so neither path can let a Free employer end up
 *  with a second job uncounted. Best-effort: a failure here never blocks
 *  the job that was already created — it only means the next create-gate
 *  check re-reads a stale (too-low) count, which fails safe toward "allow"
 *  rather than toward blocking a legitimate first job. */
export async function incrementJobsCount(employerId: string): Promise<void> {
  try {
    const current = await getFreeTierState(employerId);
    await updateOrInsertFreeTierState(employerId, { jobs_count: current.jobsCount + 1 });
  } catch (e) {
    console.error("[employer-free-tier] incrementJobsCount failed", e);
  }
}

/** Stamp the moment a Free employer's candidate slot was last refilled —
 *  read back by `refillCooldownOk` on the NEXT refill attempt. */
export async function recordCandidateRefill(employerId: string, whenIso = new Date().toISOString()): Promise<void> {
  try {
    await updateOrInsertFreeTierState(employerId, { last_candidate_refill_at: whenIso });
  } catch (e) {
    console.error("[employer-free-tier] recordCandidateRefill failed", e);
  }
}

// ── Pure detectors ────────────────────────────────────────────────────────────

/** JOB: exactly one job post EVER. `jobsCountEver` comes from
 *  `free_tier_state.jobs_count` — a grandfathered employer who already has
 *  2+ jobs keeps every one of them, but this always reads false for them
 *  (2 >= 1), exactly as intended: the block fires at "snapshot + attempted
 *  new", never retroactively removing anything they already had. */
export function jobCreateAllowed(jobsCountEver: number): boolean {
  return jobsCountEver < 1;
}

/** EDIT RULE: title + role category (this product's closest field to
 *  "category" is `department` — there is no separate category column) lock
 *  the moment a Free post first goes live. Every other field stays editable
 *  while the post is ACTIVE. `changedFields` is the set of field names the
 *  patch actually attempts to change (a field present in the patch with the
 *  SAME value as already saved is not a real change and should not be
 *  passed here). */
export const LOCKED_JOB_FIELDS = ["title", "department"] as const;
export function isLockedJobFieldEdit(changedFields: readonly string[]): boolean {
  return changedFields.some((f) => (LOCKED_JOB_FIELDS as readonly string[]).includes(f));
}

/** Normalize text to a word-bag for the identity-change heuristic below —
 *  lowercase, strip punctuation, split on whitespace, drop empties. */
function wordBag(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** IDENTITY CHANGE: a deterministic diff fallback (capped LLM judgment is a
 *  server-side enhancement left for a follow-up; this is the always-on
 *  floor so the rule holds even with no model call). A description is too
 *  thin to judge meaningfully under 20 words — let a short post's edits
 *  pass rather than block on noise. Otherwise: if fewer than HALF of the
 *  original description's words still appear in the new one, the role has
 *  been substantially rewritten, not merely improved — e.g. rewriting a
 *  "Warehouse Associate" post into a "Dental Hygienist" post shares almost
 *  no vocabulary and trips this; fixing typos, tightening phrasing, or
 *  adding a paragraph about benefits keeps the vast majority of the
 *  original words and does not. */
export function isSubstantialRoleRewrite(oldDescription: string, newDescription: string): boolean {
  const oldWords = wordBag(oldDescription);
  if (oldWords.length < 20) return false;
  const newWords = new Set(wordBag(newDescription));
  const kept = oldWords.filter((w) => newWords.has(w)).length;
  const overlapRatio = kept / oldWords.length;
  return overlapRatio < 0.5;
}

/** CLOSED POST: no edits are offered at all on Free — not even reactivating
 *  with a change. Reactivation is AS IS ONLY. */
export function jobEditAllowedWhileClosed(): boolean {
  return false;
}

/** CANDIDATE: one active slot. `activeCountNow` excludes rejected
 *  applicants (the same "non-rejected" definition the existing manual-add
 *  route already uses). `ceilingBaseline` is `free_tier_state.candidates_active`
 *  — 0 for anyone who signed up after migration 0077, or a grandfathered
 *  employer's snapshot count, so `max(1, ceilingBaseline)` is always at
 *  least the new rule's floor of 1 and never less than what they already
 *  had the moment the snapshot was taken. */
export function candidateCeiling(ceilingBaseline: number): number {
  return Math.max(1, ceilingBaseline);
}
export function candidateAddAllowed(activeCountNow: number, ceilingBaseline: number): boolean {
  return activeCountNow < candidateCeiling(ceilingBaseline);
}

/** CANDIDATE REFILL COOLDOWN: once a slot has been filled at least once,
 *  the NEXT refill (adding a candidate after the slot was emptied by a
 *  hire/reject) is limited to once per rolling window. `lastRefillAtIso`
 *  null means this employer has never refilled before — always allowed
 *  (their very first fill is not a "refill"). */
export function refillCooldownOk(lastRefillAtIso: string | null, now: number, cooldownDays: number): boolean {
  if (!lastRefillAtIso) return true;
  const last = new Date(lastRefillAtIso).getTime();
  if (!Number.isFinite(last)) return true;
  const elapsedDays = (now - last) / 86_400_000;
  return elapsedDays >= cooldownDays;
}
export function freeRefillCooldownDays(): number {
  const v = Number(process.env.ASSISTANT_FREE_REFILL_COOLDOWN_DAYS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 30;
}

/** EMPLOYEE: one non-owner employee; the owner's own row (bound to the
 *  employer's own Clerk user id, `employees.clerk_user_id`) never counts —
 *  EVERY other row does, including the common case of an employee who has
 *  no `clerk_user_id` at all yet (never invited/linked to a portal
 *  account): a null/empty id is not the owner, so it still counts. Only an
 *  id that equals the employer's own is excluded. `ceilingBaseline` is
 *  `free_tier_state.employees_non_owner`, same grandfather-floor reasoning
 *  as candidates above. */
export function nonOwnerEmployeeCount(employeeClerkUserIds: readonly (string | null)[], employerId: string): number {
  return employeeClerkUserIds.filter((id) => id !== employerId).length;
}
export function employeeCeiling(ceilingBaseline: number): number {
  return Math.max(1, ceilingBaseline);
}
export function employeeAddAllowed(nonOwnerCountNow: number, ceilingBaseline: number): boolean {
  return nonOwnerCountNow < employeeCeiling(ceilingBaseline);
}

// ── Job edit gate (shared by the hand-driven PATCH route and Taylor's
//    publish_job-on-approval path — see lib/assistant-mutations.ts) ───────────

export interface JobEditCheckInput {
  tier: string;
  /** The job's status BEFORE this edit. */
  status: string;
  title: string;
  department: string;
  description: string;
  /** Set once the job first goes active+public; null means it has never
   *  been published, so title/department are not locked yet. */
  publishedAt: string | null;
  /** Only the fields this patch actually attempts to CHANGE (same-value
   *  "changes" should already be filtered out by the caller). */
  patch: { title?: string; department?: string; description?: string; status?: string };
}

/** Decide whether a Free-tier job edit is allowed, and if not, the
 *  graduation-shaped refusal. Non-free tiers always pass — the lock, the
 *  closed-is-frozen rule, and identity-change detection are Free-only
 *  (paid tiers may replace/edit posts freely, per Marvin's rule 6). */
export function checkFreeJobEdit(input: JobEditCheckInput): GateResult {
  if (normalizeTier(input.tier) !== "free") return { allowed: true, message: "" };

  // CLOSED POST: reactivation is AS IS ONLY — a status-only patch (closed ->
  // active, nothing else) is the one allowed shape; anything that also
  // touches a real field is refused, full stop, with no edit step offered.
  if (input.status === "closed") {
    const otherFields = Object.keys(input.patch).filter((k) => k !== "status");
    if (otherFields.length) {
      return gradeGate(input.tier, "job_edit_closed", `Your "${input.title}" post is closed`, false);
    }
    return { allowed: true, message: "" };
  }

  // LOCKED FIELDS: title + role category (department) lock the moment the
  // post has gone live once (publishedAt set) — editable freely before that
  // first publish, since there is no "identity" yet to lock.
  if (input.publishedAt) {
    const currentByField: Record<string, string> = { title: input.title, department: input.department };
    const lockedChanged = (Object.keys(input.patch) as (keyof typeof input.patch)[]).filter(
      (k) => (LOCKED_JOB_FIELDS as readonly string[]).includes(k) && input.patch[k] !== undefined && input.patch[k] !== currentByField[k]
    );
    if (lockedChanged.length) {
      return gradeGate(input.tier, "job_edit_locked_field", `You've published "${input.title}"`, false);
    }
  }

  // IDENTITY CHANGE: a description rewrite substantial enough to read as a
  // different role entirely. Small honest edits (typo fixes, tightened
  // phrasing, an added paragraph) keep most of the original wording and
  // pass; a wholesale swap to a different job does not.
  if (input.patch.description !== undefined && isSubstantialRoleRewrite(input.description, input.patch.description)) {
    return gradeGate(input.tier, "job_identity_change", `You've published "${input.title}"`, false);
  }

  return { allowed: true, message: "" };
}
