import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TRACKER_STAGES, type TrackerStage, type TrackerSource, validateStageMove } from "./tracker-core";

/**
 * Application Tracker persistence (Combined Build, Sections 1/2/4 —
 * migrations 0078/0079/0080). Service-role client, scoped by the Clerk
 * user_id, same shape as lib/applications.ts and lib/job-distribution-store.ts.
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

export function trackerEnabled(): boolean {
  return db() !== null;
}

export interface TrackedNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface TrackedApplication {
  id: string;
  jobTitle: string;
  company: string;
  location: string | null;
  postingUrl: string | null;
  description: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  source: TrackerSource;
  sourceJobId: number | null;
  stage: TrackerStage;
  stageChangedAt: string;
  appliedAt: string | null;
  notes: TrackedNote[];
  extractedMeta: Record<string, unknown> | null;
  nudgesOff: boolean;
  lastVerifiedAt: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromRow(r: any): TrackedApplication {
  return {
    id: r.id,
    jobTitle: r.job_title || "",
    company: r.company || "",
    location: r.location ?? null,
    postingUrl: r.posting_url ?? null,
    description: r.description ?? null,
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
    source: r.source || "manual",
    sourceJobId: r.source_job_id ?? null,
    stage: r.stage || "Clipped",
    stageChangedAt: r.stage_changed_at,
    appliedAt: r.applied_at ?? null,
    notes: Array.isArray(r.notes) ? r.notes : [],
    extractedMeta: r.extracted_meta ?? null,
    nudgesOff: !!r.nudges_off,
    lastVerifiedAt: r.last_verified_at ?? null,
    archived: !!r.archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const clean = (s?: string | null, max = 4000) => {
  const v = (s ?? "").toString().trim();
  return v ? v.slice(0, max) : "";
};
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface CreateTrackedApplicationInput {
  jobTitle: string;
  company: string;
  location?: string | null;
  postingUrl?: string | null;
  description?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  source: TrackerSource;
  sourceJobId?: number | null;
  stage?: TrackerStage;
  extractedMeta?: Record<string, unknown> | null;
  lastVerifiedAt?: string | null;
}

export async function listTrackedApplications(userId: string, includeArchived = false): Promise<TrackedApplication[]> {
  const c = db();
  if (!c || !userId) return [];
  try {
    let q = c.from("tracked_applications").select("*").eq("user_id", userId);
    if (!includeArchived) q = q.eq("archived", false);
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(500);
    if (error || !data) return [];
    return data.map(fromRow);
  } catch {
    return [];
  }
}

export async function getTrackedApplication(userId: string, id: string): Promise<TrackedApplication | null> {
  const c = db();
  if (!c || !userId || !id) return null;
  try {
    const { data, error } = await c.from("tracked_applications").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
    if (error || !data) return null;
    return fromRow(data);
  } catch {
    return null;
  }
}

export async function createTrackedApplication(userId: string, input: CreateTrackedApplicationInput): Promise<TrackedApplication | null> {
  const c = db();
  if (!c || !userId) return null;
  const jobTitle = clean(input.jobTitle, 300);
  const company = clean(input.company, 300);
  if (!jobTitle && !company) return null; // need at least one real identifying field — never create a wholly-blank card
  try {
    const row: Record<string, unknown> = {
      user_id: userId,
      job_title: jobTitle,
      company,
      location: clean(input.location, 300) || null,
      posting_url: clean(input.postingUrl, 2000) || null,
      description: clean(input.description, 20000) || null,
      salary_min: numOrNull(input.salaryMin),
      salary_max: numOrNull(input.salaryMax),
      source: input.source,
      source_job_id: input.sourceJobId ?? null,
      stage: input.stage || "Clipped",
      extracted_meta: input.extractedMeta ?? null,
      last_verified_at: input.lastVerifiedAt ?? (input.source !== "manual" ? new Date().toISOString() : null),
    };
    const { data, error } = await c.from("tracked_applications").insert(row).select("*").single();
    if (error || !data) {
      console.error("[tracker-store] createTrackedApplication failed", error);
      return null;
    }
    return fromRow(data);
  } catch (e) {
    console.error("[tracker-store] createTrackedApplication threw", e);
    return null;
  }
}

export interface UpdateTrackedApplicationInput {
  jobTitle?: string;
  company?: string;
  location?: string | null;
  postingUrl?: string | null;
  description?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  nudgesOff?: boolean;
  archived?: boolean;
}

/** Plain field edit — never touches stage (use moveStage for that, which
 *  also stamps stage_changed_at and logs the audit event). */
export async function updateTrackedApplication(userId: string, id: string, input: UpdateTrackedApplicationInput): Promise<TrackedApplication | null> {
  const c = db();
  if (!c || !userId || !id) return null;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.jobTitle !== undefined) row.job_title = clean(input.jobTitle, 300);
  if (input.company !== undefined) row.company = clean(input.company, 300);
  if (input.location !== undefined) row.location = clean(input.location, 300) || null;
  if (input.postingUrl !== undefined) row.posting_url = clean(input.postingUrl, 2000) || null;
  if (input.description !== undefined) row.description = clean(input.description, 20000) || null;
  if (input.salaryMin !== undefined) row.salary_min = numOrNull(input.salaryMin);
  if (input.salaryMax !== undefined) row.salary_max = numOrNull(input.salaryMax);
  if (input.nudgesOff !== undefined) row.nudges_off = !!input.nudgesOff;
  if (input.archived !== undefined) row.archived = !!input.archived;
  try {
    const { data, error } = await c.from("tracked_applications").update(row).eq("user_id", userId).eq("id", id).select("*").single();
    if (error || !data) return null;
    return fromRow(data);
  } catch {
    return null;
  }
}

export async function addNote(userId: string, id: string, text: string): Promise<TrackedApplication | null> {
  const cleaned = clean(text, 4000);
  if (!cleaned) return null;
  const existing = await getTrackedApplication(userId, id);
  if (!existing) return null;
  const notes = [...existing.notes, { id: cryptoRandomId(), text: cleaned, createdAt: new Date().toISOString() }];
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from("tracked_applications").update({ notes, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", id).select("*").single();
    if (error || !data) return null;
    return fromRow(data);
  } catch {
    return null;
  }
}

function cryptoRandomId(): string {
  // Node 18+ has globalThis.crypto.randomUUID; fall back defensively.
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export interface MoveStageResult {
  ok: boolean;
  reason?: string;
  application?: TrackedApplication;
}

/** Move a tracked application's stage — validates with the pure
 *  lib/tracker-core.ts rule, stamps `stage_changed_at`, sets `applied_at`
 *  the first time it reaches "Applied" (never overwritten on a later move),
 *  and logs the `stage_change` audit event. */
export async function moveStage(userId: string, id: string, toStage: unknown): Promise<MoveStageResult> {
  const existing = await getTrackedApplication(userId, id);
  if (!existing) return { ok: false, reason: "not found" };
  const check = validateStageMove(existing.stage, toStage);
  if (!check.ok) return { ok: false, reason: check.reason };
  const c = db();
  if (!c) return { ok: false, reason: "unavailable" };
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { stage: check.toStage, stage_changed_at: now, updated_at: now };
  if (check.toStage === "Applied" && !existing.appliedAt) row.applied_at = now;
  try {
    const { data, error } = await c.from("tracked_applications").update(row).eq("user_id", userId).eq("id", id).select("*").single();
    if (error || !data) return { ok: false, reason: "save failed" };
    const application = fromRow(data);
    await logEvent(userId, id, "stage_change", { fromStage: existing.stage, toStage: check.toStage });
    return { ok: true, application };
  } catch {
    return { ok: false, reason: "save failed" };
  }
}

export async function deleteTrackedApplication(userId: string, id: string): Promise<boolean> {
  const c = db();
  if (!c || !userId || !id) return false;
  try {
    const { error } = await c.from("tracked_applications").delete().eq("user_id", userId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

// ── application_events (audit trail) ────────────────────────────────────────

export interface ApplicationEvent {
  id: string;
  trackedApplicationId: string;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Best-effort, same reasoning as every other audit-log writer in this
 *  codebase (lib/assistant-audit.ts): a logging failure must never block the
 *  action that triggered it, but is loud in the server log. */
export async function logEvent(userId: string, trackedApplicationId: string, event: string, payload: Record<string, unknown> = {}): Promise<void> {
  const c = db();
  if (!c || !userId || !trackedApplicationId || !event) return;
  try {
    const { error } = await c.from("application_events").insert({ tracked_application_id: trackedApplicationId, user_id: userId, event, payload });
    if (error) console.error("[tracker-store] logEvent failed", { event, error });
  } catch (e) {
    console.error("[tracker-store] logEvent threw", { event, error: e });
  }
}

export async function listEvents(userId: string, trackedApplicationId: string, limit = 100): Promise<ApplicationEvent[]> {
  const c = db();
  if (!c || !userId || !trackedApplicationId) return [];
  try {
    const { data, error } = await c
      .from("application_events")
      .select("id, tracked_application_id, event, payload, created_at")
      .eq("user_id", userId)
      .eq("tracked_application_id", trackedApplicationId)
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 500)));
    if (error || !data) return [];
    return (data as { id: string; tracked_application_id: string; event: string; payload: Record<string, unknown>; created_at: string }[]).map((r) => ({
      id: r.id,
      trackedApplicationId: r.tracked_application_id,
      event: r.event,
      payload: r.payload || {},
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/** The most recent SUBSTANTIVE event's timestamp for a tracked application,
 *  if any — used by the nudge check as the dwell reference for
 *  "Interviewing" (the spec's "7d post-last-event"). Deliberately excludes
 *  `nudge_fired`/`nudge_dismissed` themselves — counting a nudge as
 *  "activity" would push its own reference time forward every time it
 *  fires, resetting the dwell clock to zero forever and ensuring it never
 *  dwells long enough to fire again. Falls back to null (caller falls back
 *  to stageChangedAt) when there's no substantive event yet. */
export async function lastEventAt(userId: string, trackedApplicationId: string): Promise<string | null> {
  const c = db();
  if (!c || !userId || !trackedApplicationId) return null;
  try {
    const { data, error } = await c
      .from("application_events")
      .select("created_at")
      .eq("user_id", userId)
      .eq("tracked_application_id", trackedApplicationId)
      .not("event", "in", "(nudge_fired,nudge_dismissed)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return (data.created_at as string) || null;
  } catch {
    return null;
  }
}

// ── ATS link (Section 4) ─────────────────────────────────────────────────────

export interface AtsScoreEntry {
  id: string;
  trackedApplicationId: string;
  score: number;
  verdict: string;
  resumeId: string | null;
  resumeLabel: string | null;
  runAt: string;
}

export async function recordAtsScore(
  userId: string,
  trackedApplicationId: string,
  input: { score: number; verdict: string; resumeId?: string | null; resumeLabel?: string | null }
): Promise<AtsScoreEntry | null> {
  const c = db();
  if (!c || !userId || !trackedApplicationId) return null;
  try {
    const { data, error } = await c
      .from("tracked_application_ats_scores")
      .insert({
        tracked_application_id: trackedApplicationId,
        user_id: userId,
        score: Math.round(input.score),
        verdict: clean(input.verdict, 200),
        resume_id: input.resumeId ?? null,
        resume_label: input.resumeLabel ?? null,
      })
      .select("*")
      .single();
    if (error || !data) return null;
    await logEvent(userId, trackedApplicationId, "ats_score_recorded", { score: data.score });
    return {
      id: data.id,
      trackedApplicationId: data.tracked_application_id,
      score: data.score,
      verdict: data.verdict || "",
      resumeId: data.resume_id ?? null,
      resumeLabel: data.resume_label ?? null,
      runAt: data.run_at,
    };
  } catch (e) {
    console.error("[tracker-store] recordAtsScore threw", e);
    return null;
  }
}

export async function listAtsScores(userId: string, trackedApplicationId: string): Promise<AtsScoreEntry[]> {
  const c = db();
  if (!c || !userId || !trackedApplicationId) return [];
  try {
    const { data, error } = await c
      .from("tracked_application_ats_scores")
      .select("*")
      .eq("user_id", userId)
      .eq("tracked_application_id", trackedApplicationId)
      .order("run_at", { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      trackedApplicationId: r.tracked_application_id as string,
      score: r.score as number,
      verdict: (r.verdict as string) || "",
      resumeId: (r.resume_id as string) ?? null,
      resumeLabel: (r.resume_label as string) ?? null,
      runAt: r.run_at as string,
    }));
  } catch {
    return [];
  }
}

// ── "Real status" for our own jobs (Section 4) ──────────────────────────────

/** Best-effort match of a tracked application's `sourceJobId` to the real
 *  `applicants` row the candidate's OWN apply-form submission created — by
 *  (job_id, email), since `applicants` carries no Clerk user id at all (the
 *  public apply form is intentionally sign-in-free). Null when no matching
 *  row exists: that tracked application is then rendered as self-managed,
 *  never implying an employer-status surface that isn't real (the spec's
 *  honesty rule). Case-insensitive on email, since the candidate's account
 *  email and what they typed into the apply form may differ only by case. */
export async function findOurJobApplicantStatus(jobId: number, candidateEmail: string): Promise<{ status: string; statusChangedAt: string } | null> {
  const c = db();
  const email = (candidateEmail || "").trim().toLowerCase();
  if (!c || !Number.isFinite(jobId) || !email) return null;
  try {
    const { data, error } = await c.from("applicants").select("status, status_changed_at, created_at, email").eq("job_id", jobId).ilike("email", email).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return null;
    return { status: (data.status as string) || "new", statusChangedAt: (data.status_changed_at as string) || (data.created_at as string) || "" };
  } catch {
    return null;
  }
}

export { TRACKER_STAGES };
