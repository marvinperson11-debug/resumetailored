import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { OnboardingPlanContent } from "./onboarding-plan";

/**
 * Onboarding chase persistence (`onboarding_plans`, migration 0069) —
 * Prompt 6, Section 3. One row per applicant, created only on approval of
 * the onboarding-plan pending action (lib/assistant-mutations.ts
 * `executeOnboardingPlan`); `applicant_id` is the primary key, so this table
 * is itself a second, permanent dedupe record (in addition to
 * lib/assistant-pending.ts `listAllActionsForEmployer`, which dedupes
 * BEFORE approval — see lib/onboarding-chase.ts for why both exist).
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

export type OnboardingPlanStatus = "active" | "complete" | "expired";

export interface OnboardingPlanRow {
  applicantId: number;
  employerId: string;
  jobId: number | null;
  plan: OnboardingPlanContent;
  status: OnboardingPlanStatus;
  pendingActionId: string;
  createdAt: string;
}

const COLS = "applicant_id, employer_id, job_id, plan, status, actor_user_id, actor_email, created_at, updated_at";

function mapRow(r: Record<string, unknown>): OnboardingPlanRow {
  const plan = (r.plan as { content?: OnboardingPlanContent; pendingActionId?: string }) || {};
  return {
    applicantId: r.applicant_id as number,
    employerId: (r.employer_id as string) || "",
    jobId: (r.job_id as number) ?? null,
    plan: (plan.content as OnboardingPlanContent) || { startDateDisplay: "", dayOneChecklist: [], firstWeekSchedule: [], paperwork: [], reminders: [] },
    status: (r.status as OnboardingPlanStatus) || "active",
    pendingActionId: plan.pendingActionId || "",
    createdAt: (r.created_at as string) || "",
  };
}

export async function getOnboardingPlan(employerId: string, applicantId: number): Promise<OnboardingPlanRow | null> {
  const c = db();
  if (!c || !employerId || !applicantId) return null;
  try {
    const { data } = await c.from("onboarding_plans").select(COLS).eq("employer_id", employerId).eq("applicant_id", applicantId).maybeSingle();
    return data ? mapRow(data) : null;
  } catch {
    return null;
  }
}

export interface SaveOnboardingPlanInput {
  employerId: string;
  applicantId: number;
  jobId: number | null;
  plan: OnboardingPlanContent;
  pendingActionId: string;
  actorUserId: string;
  actorEmail: string | null;
}

export async function saveOnboardingPlan(input: SaveOnboardingPlanInput): Promise<OnboardingPlanRow | null> {
  const c = db();
  if (!c || !input.employerId || !input.applicantId) return null;
  try {
    const { data, error } = await c
      .from("onboarding_plans")
      .insert({
        applicant_id: input.applicantId,
        employer_id: input.employerId,
        job_id: input.jobId,
        plan: { content: input.plan, pendingActionId: input.pendingActionId },
        status: "active",
        actor_user_id: input.actorUserId,
        actor_email: input.actorEmail,
      })
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[onboarding-store] saveOnboardingPlan failed", { applicantId: input.applicantId, error });
      return null;
    }
    return mapRow(data);
  } catch (e) {
    console.error("[onboarding-store] saveOnboardingPlan threw", { applicantId: input.applicantId, error: e });
    return null;
  }
}

export async function setOnboardingPlanStatus(employerId: string, applicantId: number, status: OnboardingPlanStatus): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !applicantId) return false;
  try {
    const { error } = await c
      .from("onboarding_plans")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("employer_id", employerId)
      .eq("applicant_id", applicantId)
      .eq("status", "active"); // idempotent: a plan already resolved is never flipped again
    return !error;
  } catch {
    return false;
  }
}

/** Every ACTIVE plan, cross-employer — the 14-day backstop scan's candidate
 *  pool (lib/onboarding-chase.ts). Fetches by status at the query level and
 *  compares `created_at` against the cutoff in application code, same
 *  convention as lib/assistant-send-queue.ts `listDueQueued` (this table
 *  only ever holds a bounded number of active plans at a time, so a second
 *  pass in JS is simpler than threading an inequality through the client). */
export async function listActivePlans(): Promise<OnboardingPlanRow[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from("onboarding_plans").select(COLS).eq("status", "active").limit(500);
    if (error || !data) return [];
    return data.map(mapRow);
  } catch (e) {
    console.error("[onboarding-store] listActivePlans threw", e);
    return [];
  }
}

/** Count of ACTIVE plans for one employer — the daily-brief's "chase items"
 *  figure (lib/assistant-brief.ts), bounded and auditable. */
export async function countActivePlans(employerId: string): Promise<number> {
  const c = db();
  if (!c || !employerId) return 0;
  try {
    const { data, error } = await c.from("onboarding_plans").select("applicant_id").eq("employer_id", employerId).eq("status", "active").limit(500);
    if (error || !data) return 0;
    return data.length;
  } catch {
    return 0;
  }
}
