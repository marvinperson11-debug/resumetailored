import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Pending mutating actions for the Employer Portal AI Assistant
 * (assistant_pending_actions, migration 0052). A mutating tool
 * (lib/assistant-tools.ts) only ever creates a row here; the real mutation
 * happens in lib/assistant-mutations.ts `executePendingAction`, called from
 * the approve route once a human approves. The row's `id` is the idempotency
 * key for that approval — see `claimForExecution` below.
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export type PendingActionStatus = "pending" | "executed" | "cancelled" | "failed";

export interface ResolvedSpecific {
  label: string;
  value: string;
}

export interface PendingActionArtifactItem {
  id: string;
  label?: string;
  artifact: string;
}

/** Exactly what components/assistant/ActionCard.tsx needs to render this
 *  action, minus `state`/`onApprove`/`onCancel` (the caller supplies those
 *  from the row's own status). */
export interface PendingActionArtifact {
  title: string;
  irreversible: boolean;
  irreversibleLabel?: string;
  resolvedSpecifics?: ResolvedSpecific[];
  items: PendingActionArtifactItem[];
  /** True when this card fails validation as drafted (e.g. publish_job
   *  missing required pay fields) — the card still renders so the employer
   *  can see exactly why, but approval is disabled until a correction (via
   *  chat, reusing this card's pending_action_id) makes it valid. */
  blocked?: boolean;
}

export interface PendingActionRow {
  id: string;
  employerId: string;
  actorUserId: string;
  action: string;
  payload: Record<string, unknown>;
  artifact: PendingActionArtifact;
  irreversible: boolean;
  status: PendingActionStatus;
  failureReason: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface CreatePendingActionInput {
  employerId: string;
  actorUserId: string;
  action: string;
  payload: Record<string, unknown>;
  artifact: PendingActionArtifact;
  irreversible: boolean;
}

const PENDING_COLS = "id, employer_id, actor_user_id, action, payload_json, artifact_json, irreversible, status, failure_reason, created_at, expires_at";
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

function mapRow(r: Record<string, unknown>): PendingActionRow {
  return {
    id: r.id as string,
    employerId: (r.employer_id as string) || "",
    actorUserId: (r.actor_user_id as string) || "",
    action: (r.action as string) || "",
    payload: (r.payload_json as Record<string, unknown>) || {},
    artifact: (r.artifact_json as PendingActionArtifact) || { title: "", irreversible: false, items: [] },
    irreversible: !!r.irreversible,
    status: (r.status as PendingActionStatus) || "pending",
    failureReason: (r.failure_reason as string) ?? null,
    createdAt: (r.created_at as string) || "",
    expiresAt: (r.expires_at as string) || "",
  };
}

/** True once `row.expires_at` has passed (24h after creation by default). */
export function isPendingExpired(row: Pick<PendingActionRow, "expiresAt">, now: number = Date.now()): boolean {
  const t = new Date(row.expiresAt).getTime();
  return Number.isFinite(t) && now > t;
}

/** Create a pending action. Returns null on any store failure — the caller
 *  (a tool executor) treats that as "could not prepare this for approval"
 *  and throws, same as every other input-validation failure in
 *  lib/assistant-tools.ts. */
export async function createPendingAction(input: CreatePendingActionInput): Promise<PendingActionRow | null> {
  const c = db();
  if (!c || !input.employerId || !input.actorUserId || !input.action) return null;
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await c
      .from("assistant_pending_actions")
      .insert({
        employer_id: input.employerId,
        actor_user_id: input.actorUserId,
        action: input.action,
        payload_json: input.payload || {},
        artifact_json: input.artifact,
        irreversible: !!input.irreversible,
        status: "pending",
        created_at: nowIso,
        expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
      })
      .select(PENDING_COLS)
      .single();
    if (error || !data) {
      console.error("[assistant-pending] createPendingAction failed", { action: input.action, error });
      return null;
    }
    return mapRow(data);
  } catch (e) {
    console.error("[assistant-pending] createPendingAction threw", { action: input.action, error: e });
    return null;
  }
}

/** Unscoped lookup by id — deliberately NOT employer-scoped, so a caller can
 *  tell "doesn't exist" (404) apart from "exists but belongs to a different
 *  employer" (403). Only the approve/cancel routes use this, and only to
 *  immediately compare `row.employerId` against the caller's own. */
export async function getPendingActionById(id: string): Promise<PendingActionRow | null> {
  const c = db();
  if (!c || !id) return null;
  try {
    const { data } = await c.from("assistant_pending_actions").select(PENDING_COLS).eq("id", id).maybeSingle();
    return data ? mapRow(data) : null;
  } catch (e) {
    console.error("[assistant-pending] getPendingActionById threw", { id, error: e });
    return null;
  }
}

/** The employer's own open approvals inbox: still-pending, not-yet-expired
 *  rows, newest first. Fetches by status at the query level and filters
 *  expiry in application code — this table is small per employer (rows
 *  expire after 24h), so a second pass in JS is simpler than threading an
 *  inequality through the client for a bounded result set. */
export async function listPendingActions(employerId: string): Promise<PendingActionRow[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c
      .from("assistant_pending_actions")
      .select(PENDING_COLS)
      .eq("employer_id", employerId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data) return [];
    const now = Date.now();
    return data.map(mapRow).filter((r) => !isPendingExpired(r, now));
  } catch (e) {
    console.error("[assistant-pending] listPendingActions threw", e);
    return [];
  }
}

/**
 * Atomically transition `pending` -> `executed`, scoped to this employer, and
 * ONLY if the row is still `pending` right now — the WHERE clause is the
 * idempotency gate: at most one caller's conditional UPDATE can match a given
 * row, so at most one caller ever proceeds to actually run the mutation
 * (lib/assistant-mutations.ts `executePendingAction`). The claim is
 * deliberately optimistic (status flips to 'executed' before the real
 * mutation has run) so a second concurrent approve can never slip through
 * the same gate; if the mutation then fails, the caller who won the claim
 * flips it to 'failed' with a reason (`markFailed` below) — it is the only
 * caller entitled to do that unconditional second write, having already won
 * the race. Returns the claimed row, or null if nothing matched (already
 * resolved, wrong employer, or no such id).
 */
export async function claimForExecution(employerId: string, id: string): Promise<PendingActionRow | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data, error } = await c
      .from("assistant_pending_actions")
      .update({ status: "executed" })
      .eq("id", id)
      .eq("employer_id", employerId)
      .eq("status", "pending")
      .select(PENDING_COLS)
      .maybeSingle();
    if (error || !data) return null;
    return mapRow(data);
  } catch (e) {
    console.error("[assistant-pending] claimForExecution threw", { id, error: e });
    return null;
  }
}

/** Update an already-pending row's payload/artifact IN PLACE — used when a
 *  mutating tool is called again to CORRECT a card the employer hasn't
 *  approved yet (e.g. adding the missing wage range after a blocked
 *  publish), so the correction updates the SAME card instead of leaving a
 *  duplicate row behind. Scoped to this employer and gated on `status =
 *  'pending'`, same idempotency shape as `claimForExecution`/`markCancelled`
 *  — a row that has already resolved (executed/cancelled/failed) is a
 *  terminal record and is never rewritten; the caller falls back to
 *  `createPendingAction` instead. Returns the updated row, or null if
 *  nothing matched (wrong employer, wrong id, or no longer pending). */
export async function updatePendingActionArtifact(
  employerId: string,
  id: string,
  patch: { payload: Record<string, unknown>; artifact: PendingActionArtifact; irreversible: boolean }
): Promise<PendingActionRow | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data, error } = await c
      .from("assistant_pending_actions")
      .update({ payload_json: patch.payload, artifact_json: patch.artifact, irreversible: !!patch.irreversible })
      .eq("id", id)
      .eq("employer_id", employerId)
      .eq("status", "pending")
      .select(PENDING_COLS)
      .maybeSingle();
    if (error || !data) return null;
    return mapRow(data);
  } catch (e) {
    console.error("[assistant-pending] updatePendingActionArtifact threw", { id, error: e });
    return null;
  }
}

/** Merges `patch` into an already-executed row's stored payload — e.g.
 *  send_offer records the DocuSign `envelopeId` here right after a
 *  successful send (lib/assistant-mutations.ts `executeSendOffer`), so it's
 *  visible on the resolved card and queryable later. Best-effort: a failure
 *  here never un-does the real-world send that already happened. */
export async function patchPendingActionPayload(id: string, patch: Record<string, unknown>): Promise<void> {
  const c = db();
  if (!c || !id) return;
  try {
    const existing = await getPendingActionById(id);
    if (!existing) return;
    await c.from("assistant_pending_actions").update({ payload_json: { ...existing.payload, ...patch } }).eq("id", id);
  } catch (e) {
    console.error("[assistant-pending] patchPendingActionPayload threw", { id, error: e });
  }
}

/** Downgrade a claimed-but-failed row from 'executed' to 'failed' with a
 *  human-readable reason. Only ever called by the caller that just won
 *  `claimForExecution` for this same id, so this write does not need its own
 *  conditional WHERE on status. */
export async function markFailed(employerId: string, id: string, reason: string): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c
      .from("assistant_pending_actions")
      .update({ status: "failed", failure_reason: reason.slice(0, 2000) })
      .eq("id", id)
      .eq("employer_id", employerId);
    return !error;
  } catch (e) {
    console.error("[assistant-pending] markFailed threw", { id, error: e });
    return false;
  }
}

/** The job a row's payload names, or null — `draft_job_post` payloads never
 *  carry a `jobId` (there is no job until approval creates one), so every
 *  such row shares the `null` bucket; `publish_job` payloads always carry
 *  the EXISTING job's real id. Used by `resolvePendingUpsertTarget` /
 *  `cancelSiblingPending` below to correlate rows for the SAME thing a tool
 *  call is about, without a dedicated DB column. */
function payloadJobId(row: Pick<PendingActionRow, "payload">): number | null {
  const v = (row.payload as { jobId?: unknown } | undefined)?.jobId;
  return typeof v === "number" ? v : null;
}

/** Fetch every still-pending, non-expired row for (employerId, action) whose
 *  payload names `jobId` (null for draft_job_post). Internal to this module
 *  — callers want either the one to upsert into (`resolvePendingUpsertTarget`)
 *  or all of them to cancel (`cancelSiblingPending`). */
async function listPendingMatching(employerId: string, action: string, jobId: number | null): Promise<PendingActionRow[]> {
  const c = db();
  if (!c || !employerId || !action) return [];
  try {
    const { data, error } = await c
      .from("assistant_pending_actions")
      .select(PENDING_COLS)
      .eq("employer_id", employerId)
      .eq("action", action)
      .eq("status", "pending")
      .limit(200);
    if (error || !data) return [];
    const now = Date.now();
    return data.map(mapRow).filter((r) => !isPendingExpired(r, now) && payloadJobId(r) === jobId);
  } catch (e) {
    console.error("[assistant-pending] listPendingMatching threw", { employerId, action, jobId, error: e });
    return [];
  }
}

/**
 * Fix Round 4, Section A: the id-less correction path. `publish_job` and
 * `draft_job_post` corrected from a NEW conversation have no
 * `pending_action_id` to reuse (the model only knows one from ITS OWN
 * conversation history), so the tool executor falls back to this — the most
 * recent still-pending row for the SAME (employer, action, job) the model is
 * about to draft again. Returns null when there's nothing to upsert into
 * (the caller then creates a fresh row, same as before this fix existed).
 *
 * Also the one place pre-fix duplicate pendings get cleaned up: if more than
 * one still-pending row matches (leftovers from before this upsert existed,
 * or any other way two slipped through), every row except the most recent is
 * cancelled with `failure_reason: 'superseded'` right here, so a caller never
 * has to reason about more than one candidate to merge into.
 */
export async function resolvePendingUpsertTarget(employerId: string, action: string, jobId: number | null): Promise<PendingActionRow | null> {
  const matches = await listPendingMatching(employerId, action, jobId);
  if (!matches.length) return null;
  // Pick the newest by created_at; on an exact tie (the in-process test
  // harness can insert faster than Date.now()'s ms resolution), `>=` prefers
  // whichever this loop sees LATER, which for every real caller of
  // listPendingMatching (ascending, insertion-ordered rows — Postgres grants
  // no ordering guarantee here either) is the one actually inserted last.
  let latest = matches[0];
  for (const r of matches.slice(1)) {
    if (new Date(r.createdAt).getTime() >= new Date(latest.createdAt).getTime()) latest = r;
  }
  for (const stale of matches) {
    if (stale.id !== latest.id) await markCancelled(employerId, stale.id, "superseded");
  }
  return latest;
}

/** `payload.title` for a still-pending draft_job_post row — always present
 *  (`buildDraftJobPostArtifact` always sets it), unlike `artifact.title`,
 *  which is a fixed action label ("Draft a new job posting" / "Post a new
 *  job — will be published"), never the job's own title. Used only to match
 *  a `pending_draft_title` hint against real pending drafts. */
function draftJobPostTitle(row: Pick<PendingActionRow, "payload">): string {
  const v = (row.payload as { title?: unknown } | undefined)?.title;
  return typeof v === "string" ? v : "";
}

/** Case-insensitive substring-or-token match between a user-supplied title
 *  hint (what the employer called the draft in chat, e.g. "the warehouse
 *  associate draft") and a pending draft's real title. A majority (>=60%) of
 *  the hint's own words appearing in the title counts as a match, so "the
 *  warehouse draft" still matches a draft titled "Warehouse Associate". Used
 *  only for `pending_draft_title` — a human's loose description of which
 *  card they mean. */
function draftTitleMatches(hint: string, title: string): boolean {
  const h = hint.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  if (!h || !t) return false;
  if (t.includes(h) || h.includes(t)) return true;
  const hTokens = h.split(/\s+/).filter(Boolean);
  if (!hTokens.length) return false;
  const tTokens = new Set(t.split(/\s+/).filter(Boolean));
  const overlap = hTokens.filter((tok) => tTokens.has(tok)).length;
  return overlap / hTokens.length >= 0.6;
}

/** Exact (case-insensitive, trimmed) match between the `title` field of a
 *  fresh draft_job_post call and a pending draft's stored title. Fix Round
 *  6, Section A: unlike `draftTitleMatches` above, this is deliberately NOT
 *  fuzzy — two drafts that share most words but differ in the one word that
 *  actually distinguishes them (e.g. "TEST R5 Draft Alpha" vs "TEST R5 Draft
 *  Beta") must never match, or a brand-new draft with its own real title
 *  would overwrite an unrelated pending one by token-overlap coincidence. */
function draftIncomingTitleMatches(incomingTitle: string, title: string): boolean {
  const a = incomingTitle.trim().toLowerCase();
  const b = title.trim().toLowerCase();
  return !!a && !!b && a === b;
}

export interface DraftUpsertCandidate {
  id: string;
  title: string;
}

export type DraftUpsertResolution =
  | { status: "none" }
  | { status: "resolved"; row: PendingActionRow }
  | { status: "ambiguous"; candidates: DraftUpsertCandidate[] };

function toDraftUpsertCandidates(rows: PendingActionRow[]): DraftUpsertCandidate[] {
  return rows.map((r) => ({ id: r.id, title: draftJobPostTitle(r) || "Untitled draft" }));
}

/**
 * Deterministic targeting for a draft_job_post call that has no
 * `pending_action_id` — either a correction from a NEW conversation (which
 * only has `pending_draft_title`, the draft's name as the employer said it)
 * or a genuinely fresh draft (which only has its own `title` field,
 * `incomingTitle`). Fix Round 6, Section A folds the incoming title into
 * this resolution as a first-class matching key, in a fixed order, BEFORE
 * any "only one pending" shortcut:
 *
 *   1. `titleHint` (pending_draft_title) given -> fuzzy-match it against
 *      every pending draft's title: exactly one match -> that row; no match
 *      -> `status: 'none'` (create new); more than one match -> ambiguous.
 *   2. Else `incomingTitle` (the call's own `title` field) given -> exact
 *      (case-insensitive) match against every pending draft's title: same
 *      three outcomes.
 *   3. Else (no title supplied anywhere) -> the only case where "exactly one
 *      pending draft" wins by itself, because there is nothing else it could
 *      be; two or more with no title anywhere is ambiguous.
 *
 * This replaces Round 5's unconditional "pending.length === 1 -> that one"
 * shortcut, which fired even when the call carried its OWN title that
 * plainly didn't match the single pending draft — the Oct 23 defect where
 * creating "TEST R5 Draft Beta" while "TEST R5 Draft Alpha" was still
 * pending silently overwrote Alpha instead of creating a second row. A
 * title supplied anywhere that matches nothing pending is always a CREATE,
 * never a guess at the lone pending row.
 *
 * Zero pending drafts always short-circuits to `status: 'none'` before any
 * of the above, since there's nothing to match against either way. No row
 * is created, updated, or cancelled in the ambiguous case (same
 * non-throwing shape as `resolveRescheduleCandidate` in
 * lib/assistant-mutations.ts).
 */
export async function resolveDraftUpsertTarget(employerId: string, titleHint: string, incomingTitle: string = ""): Promise<DraftUpsertResolution> {
  const pending = await listPendingMatching(employerId, "draft_job_post", null);
  if (!pending.length) return { status: "none" };

  const hint = titleHint.trim();
  if (hint) {
    const matches = pending.filter((r) => draftTitleMatches(hint, draftJobPostTitle(r)));
    if (matches.length === 1) return { status: "resolved", row: matches[0] };
    if (matches.length > 1) return { status: "ambiguous", candidates: toDraftUpsertCandidates(matches) };
    return { status: "none" };
  }

  const incoming = incomingTitle.trim();
  if (incoming) {
    const matches = pending.filter((r) => draftIncomingTitleMatches(incoming, draftJobPostTitle(r)));
    if (matches.length === 1) return { status: "resolved", row: matches[0] };
    if (matches.length > 1) return { status: "ambiguous", candidates: toDraftUpsertCandidates(matches) };
    return { status: "none" };
  }

  if (pending.length === 1) return { status: "resolved", row: pending[0] };
  return { status: "ambiguous", candidates: toDraftUpsertCandidates(pending) };
}

/** Fix Round 4, Section A: on approving a publish_job/draft_job_post card,
 *  cancel every OTHER still-pending row for the same (employer, action, job)
 *  — so two live cards for the same publish (or the same in-flight draft)
 *  can never coexist, even one that predates this fix and was never
 *  corrected into the approved row. The row just approved is already
 *  'executed' by the time this runs (claimForExecution flips it before the
 *  real mutation executes), so it is never one of the rows this cancels. */
export async function cancelSiblingPending(employerId: string, action: string, jobId: number | null, reason: string): Promise<void> {
  const siblings = await listPendingMatching(employerId, action, jobId);
  for (const s of siblings) await markCancelled(employerId, s.id, reason);
}

/** Atomically transition `pending` -> `cancelled`, same idempotency gate as
 *  `claimForExecution`. Returns the cancelled row, or null if it was already
 *  resolved (or didn't match this employer/id). */
export async function markCancelled(employerId: string, id: string, reason?: string): Promise<PendingActionRow | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const patch: Record<string, unknown> = { status: "cancelled" };
    if (reason) patch.failure_reason = reason.slice(0, 2000);
    const { data, error } = await c
      .from("assistant_pending_actions")
      .update(patch)
      .eq("id", id)
      .eq("employer_id", employerId)
      .eq("status", "pending")
      .select(PENDING_COLS)
      .maybeSingle();
    if (error || !data) return null;
    return mapRow(data);
  } catch (e) {
    console.error("[assistant-pending] markCancelled threw", { id, error: e });
    return null;
  }
}
