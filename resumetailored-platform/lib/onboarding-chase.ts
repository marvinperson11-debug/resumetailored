import type { SupabaseClient } from "@supabase/supabase-js"; // type-only: see listCompletedOfferEnvelopesLocal
import { getApplicant, getJob, getEmployerProfile } from "./employer-store";
import { listAllActionsForEmployer, createPendingAction, type PendingActionArtifact } from "./assistant-pending";
import { getEmployerTimezone } from "./employer-time";
import { buildOnboardingPlan, type OnboardingPlanContent } from "./onboarding-plan";
import { listActivePlans, setOnboardingPlanStatus, getOnboardingPlan } from "./onboarding-store";
import { cancelAllQueuedForPendingAction } from "./assistant-send-queue";

/**
 * Onboarding chase (Prompt 6, Section 3) — ticked from instrumentation.ts's
 * existing 30-minute loop, alongside lib/assistant-brief.ts and
 * lib/assistant-runner-up.ts. DELIBERATELY self-contained, same reasoning as
 * those two files document on themselves: this file must stay importable by
 * the EDGE compile instrumentation.ts also goes through, so it never
 * imports lib/assistant-mutations.ts, lib/docusign-store.ts, or
 * lib/employees-store.ts (the first two reach lib/docusign.ts -> Node's
 * `crypto`; the third calls Node's `crypto.randomInt` directly for invite
 * codes). The pending-action artifact this scan drafts is built INLINE
 * below instead of via lib/assistant-mutations.ts's own `buildOnboardingPlan`
 * helper — a few duplicated lines in exchange for `npm run build` staying
 * green, matching lib/assistant-runner-up.ts's own precedent exactly. The
 * completed-offer-envelope query is similarly a minimal direct query (same
 * pattern as lib/assistant-brief.ts `countOffersAwaitingSignatureLocal`)
 * rather than importing lib/docusign-store.ts for it.
 *
 * `executeOnboardingPlan` — the real storage + employee handoff + reminder
 * scheduling that runs once a drafted card is APPROVED — lives in
 * lib/assistant-mutations.ts instead, because approval only ever happens
 * through the API route (never through instrumentation.ts's tick), so it's
 * free to import whatever it needs.
 */

interface CompletedOfferEnvelope {
  employerId: string;
  applicantId: number | null;
  position: string;
  startDate: string;
  candidateName: string;
  completedAt: string;
  sentAt: string;
}

let onboardingBriefClient: SupabaseClient | null = null;
async function listCompletedOfferEnvelopesLocal(): Promise<CompletedOfferEnvelope[]> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    if (!onboardingBriefClient) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
      if (!url || !key) return [];
      onboardingBriefClient = createClient(url, key, { auth: { persistSession: false } });
    }
    const { data } = await onboardingBriefClient
      .from("docusign_envelopes")
      .select("employer_id, applicant_id, offer, candidate_name, completed_at, sent_at")
      .eq("doc_type", "offer")
      .eq("status", "completed")
      .limit(500);
    return (data || []).map((r) => {
      const offer = (r.offer as { position?: string; startDate?: string }) || {};
      return {
        employerId: (r.employer_id as string) || "",
        applicantId: typeof r.applicant_id === "number" ? r.applicant_id : null,
        position: offer.position || "",
        startDate: offer.startDate || "",
        candidateName: (r.candidate_name as string) || "",
        completedAt: (r.completed_at as string) || "",
        sentAt: (r.sent_at as string) || "",
      };
    });
  } catch {
    return [];
  }
}

function onboardingChaseDays(): number {
  const v = Number(process.env.ASSISTANT_ONBOARDING_CHASE_DAYS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 14;
}

function payloadApplicantId(row: { payload: Record<string, unknown> }): number | null {
  const v = row.payload.applicantId;
  return typeof v === "number" ? v : null;
}

/** Builds the SAME payload/artifact shape lib/assistant-mutations.ts
 *  `executeOnboardingPlan` expects — see this file's header for why it's
 *  built here rather than imported. */
function buildOnboardingPlanArtifactInline(args: {
  applicantId: number;
  jobId: number;
  jobTitle: string;
  candidateName: string;
  companyName: string;
  startDateRaw: string;
  fallbackAnchorIso: string;
  employerTz: string;
}): { payload: Record<string, unknown>; artifact: PendingActionArtifact } {
  const plan: OnboardingPlanContent = buildOnboardingPlan({
    jobTitle: args.jobTitle,
    candidateName: args.candidateName,
    companyName: args.companyName,
    startDateRaw: args.startDateRaw,
    fallbackAnchorIso: args.fallbackAnchorIso,
    employerTz: args.employerTz,
  });
  const payload = { applicantId: args.applicantId, jobId: args.jobId, plan, createEmployeeRecord: true };
  const artifact: PendingActionArtifact = {
    title: `Onboarding plan for ${args.candidateName} — ${args.jobTitle}`,
    irreversible: false,
    resolvedSpecifics: [
      { label: "Candidate", value: args.candidateName },
      { label: "Job", value: args.jobTitle },
      { label: "Start date", value: plan.startDateDisplay },
      { label: "Employees list", value: "If not already in your Employees list, we'll add them." },
    ],
    items: [
      { id: "checklist", label: "Day-one checklist", artifact: plan.dayOneChecklist.map((c) => `• ${c}`).join("\n") },
      { id: "schedule", label: "First-week schedule", artifact: plan.firstWeekSchedule.map((s) => `${s.label} — ${s.dateDisplay}`).join("\n") },
      { id: "paperwork", label: "Paperwork / e-sign", artifact: plan.paperwork.map((p) => `${p.item} — due ${p.dueDateDisplay}`).join("\n") },
      { id: "reminders", label: "Candidate reminder texts (sent exactly as shown)", artifact: plan.reminders.map((r) => `[${r.whenLabel}] ${r.body}`).join("\n\n") },
    ],
  };
  return { payload, artifact };
}

export interface OnboardingCompletionScanResult {
  scanned: number;
  drafted: number;
}

/** For every applicant this drafts a card for, it does so AT MOST ONCE EVER
 *  — dedupe is `listAllActionsForEmployer` (lib/assistant-pending.ts), which
 *  looks at every row ever created for (employer, "onboarding_plan")
 *  regardless of status, so a card the employer let expire or cancelled is
 *  never redrafted on a later tick. */
export async function runOnboardingCompletionScan(): Promise<OnboardingCompletionScanResult> {
  const envelopes = await listCompletedOfferEnvelopesLocal();
  let scanned = 0;
  let drafted = 0;
  for (const env of envelopes) {
    if (env.applicantId === null || !env.employerId) continue;
    scanned++;
    try {
      const applicant = await getApplicant(env.employerId, env.applicantId);
      if (!applicant) continue;
      const already = await listAllActionsForEmployer(env.employerId, "onboarding_plan");
      if (already.some((row) => payloadApplicantId(row) === env.applicantId)) continue;

      const job = await getJob(env.employerId, applicant.jobId);
      const profile = await getEmployerProfile(env.employerId);
      const employerTz = await getEmployerTimezone(env.employerId);
      const { payload, artifact } = buildOnboardingPlanArtifactInline({
        applicantId: env.applicantId,
        jobId: applicant.jobId,
        jobTitle: job?.title || env.position || "the role",
        candidateName: applicant.name || env.candidateName || "the new hire",
        companyName: profile?.companyName || "",
        startDateRaw: env.startDate,
        fallbackAnchorIso: env.completedAt || env.sentAt,
        employerTz,
      });
      const row = await createPendingAction({ employerId: env.employerId, actorUserId: env.employerId, action: "onboarding_plan", payload, artifact, irreversible: false });
      if (row) drafted++;
    } catch (e) {
      console.error("[onboarding-chase] completion scan: applicant failed", { employerId: env.employerId, applicantId: env.applicantId, error: e });
    }
  }
  return { scanned, drafted };
}

export interface OnboardingExpiryScanResult {
  scanned: number;
  expired: number;
}

/** Ticked alongside the completion scan. `now` is injectable for tests. */
export async function runOnboardingExpiryScan(now: number = Date.now()): Promise<OnboardingExpiryScanResult> {
  const active = await listActivePlans();
  const cutoffMs = now - onboardingChaseDays() * 24 * 60 * 60 * 1000;
  let scanned = 0;
  let expired = 0;
  for (const plan of active) {
    scanned++;
    const createdMs = new Date(plan.createdAt).getTime();
    if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;
    const ok = await setOnboardingPlanStatus(plan.employerId, plan.applicantId, "expired");
    if (ok) {
      await cancelAllQueuedForPendingAction(plan.employerId, plan.pendingActionId);
      expired++;
    }
  }
  return { scanned, expired };
}

export interface CompleteOnboardingResult {
  found: boolean;
  completed: boolean;
}

/** Mark a plan complete by hand — always safe/instant (stopping a chase is
 *  never riskier than letting it continue), same reasoning as every other
 *  disable-is-instant switch in this feature. Idempotent: a plan that's
 *  already complete/expired simply reports `completed:false` (nothing to
 *  do), never an error. Called from lib/assistant-tools.ts's
 *  `complete_onboarding` tool, never from instrumentation.ts — the
 *  self-containment rule above is about THIS FILE'S OWN import graph, not
 *  about every caller of it. */
export async function completeOnboardingPlan(employerId: string, applicantId: number): Promise<CompleteOnboardingResult> {
  const plan = await getOnboardingPlan(employerId, applicantId);
  if (!plan) return { found: false, completed: false };
  if (plan.status !== "active") return { found: true, completed: false };
  const ok = await setOnboardingPlanStatus(employerId, applicantId, "complete");
  if (ok) await cancelAllQueuedForPendingAction(employerId, plan.pendingActionId);
  return { found: true, completed: ok };
}
