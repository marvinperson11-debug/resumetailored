import type { SupabaseClient } from "@supabase/supabase-js"; // type-only: see listCompletedOfferEnvelopesLocal
import { getApplicant, getJob, getEmployerProfile } from "./employer-store";
import { listAllActionsForEmployer, createPendingAction, type PendingActionArtifact } from "./assistant-pending";
import { getEmployerTimezone } from "./employer-time";
import { buildOnboardingPlan, type OnboardingPlanContent } from "./onboarding-plan";
import { listActivePlans, setOnboardingPlanStatus, getOnboardingPlan } from "./onboarding-store";
import { cancelAllQueuedForPendingAction } from "./assistant-send-queue";
import { resolveTierForUserId } from "./employer-plan";
import { createReminder } from "./employer-reminders";

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
 *
 * `runOnboardingOverdueNudgeScan` (Corporate-tier follow-up, Scale+'s
 * "Taylor nudges on overdue items") is ticked alongside the two scans
 * above, same self-containment rule: it deliberately does NOT import
 * lib/day-one-tasks.ts, lib/checklist-store.ts, lib/paperwork-store.ts, or
 * lib/training-store.ts for their data — paperwork-store.ts in particular
 * reaches lib/paperwork-crypto.ts -> Node's `crypto`, which must stay out
 * of this EDGE-reachable file — and instead runs a few minimal direct
 * queries, same precedent as `listCompletedOfferEnvelopesLocal` above. It
 * nudges the EMPLOYER ONLY, via the existing employer-internal reminder
 * system (lib/employer-reminders.ts `createReminder`, delivered by
 * lib/reminder-cron.ts's existing 15s scan) — never a new send channel, and
 * never a message to the new hire themselves.
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
/** Shared by every minimal direct query in this file (the completed-offer
 *  scan and the overdue-nudge scan) — same cached client, same reasoning:
 *  no store-module import, so this file's EDGE-compile graph stays clean. */
async function localClient(): Promise<SupabaseClient | null> {
  if (onboardingBriefClient) return onboardingBriefClient;
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  onboardingBriefClient = createClient(url, key, { auth: { persistSession: false } });
  return onboardingBriefClient;
}

async function listCompletedOfferEnvelopesLocal(): Promise<CompletedOfferEnvelope[]> {
  try {
    const c = await localClient();
    if (!c) return [];
    const { data } = await c
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
export function buildOnboardingPlanArtifactInline(args: {
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
      // Taylor auto-drafting a plan is Scale and above (Decision #2) — a
      // Portal employer still gets the full onboarding feature, just only
      // ever through the hand-driven "Start onboarding" button
      // (app/api/employer/applicants/[id]/start-onboarding), never from
      // this tick.
      const tier = await resolveTierForUserId(env.employerId);
      if (tier !== "scale" && tier !== "corporate") continue;
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

export interface OverdueNudgeScanResult {
  scanned: number;
  nudged: number;
}

/** Re-nudging an employer about the same still-overdue hire more than once
 *  every 24h would turn "Taylor nudges on overdue items" into spam — this
 *  caps it at one nudge per hire per cooldown window while anything stays
 *  outstanding (`onboarding_overdue_nudges`, migration 0097). Exported for
 *  tests; not meant to be tuned in production. */
const OVERDUE_NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface MinimalEmployeeRow {
  id: number;
  name: string;
  start_date: string | null;
}

/** Scale+'s "Taylor nudges on overdue items" (Corporate-tier follow-up).
 *  For every active plan whose employer is Scale or Corporate, once the
 *  hire's own start date has passed, checks whether anything from their
 *  day-one tasks, checklist, paperwork (W-4/I-9/direct deposit), or
 *  handbook acknowledgment is still outstanding — and if so, fires AT MOST
 *  ONE employer-internal reminder per `OVERDUE_NUDGE_COOLDOWN_MS` (see this
 *  file's header for why this never touches lib/day-one-tasks.ts /
 *  lib/checklist-store.ts / lib/paperwork-store.ts / lib/training-store.ts
 *  directly). Employer-facing only — the new hire is never messaged. */
export async function runOnboardingOverdueNudgeScan(now: number = Date.now()): Promise<OverdueNudgeScanResult> {
  const c = await localClient();
  if (!c) return { scanned: 0, nudged: 0 };
  const plans = await listActivePlans();
  let scanned = 0;
  let nudged = 0;
  for (const plan of plans) {
    scanned++;
    try {
      const tier = await resolveTierForUserId(plan.employerId);
      if (tier !== "scale" && tier !== "corporate") continue; // Corporate-tier follow-up to Decision #2's Scale+ auto-draft

      const { data: empRows } = await c
        .from("employees")
        .select("id, name, start_date")
        .eq("employer_id", plan.employerId)
        .eq("applicant_id", plan.applicantId)
        .limit(1);
      const emp = ((empRows || [])[0] as MinimalEmployeeRow | undefined) ?? undefined;
      if (!emp) continue;
      const startMs = emp.start_date ? new Date(emp.start_date).getTime() : NaN;
      if (!Number.isFinite(startMs) || startMs > now) continue; // day one hasn't come yet — nothing can be "overdue"

      const overdue: string[] = [];

      const { data: tasks } = await c.from("day_one_tasks").select("label, done").eq("employer_id", plan.employerId).eq("employee_id", emp.id);
      for (const row of tasks || []) if (!(row as { done?: boolean }).done) overdue.push(String((row as { label?: string }).label || "a day-one task"));

      const { data: checklists } = await c
        .from("employee_checklists")
        .select("id")
        .eq("employer_id", plan.employerId)
        .eq("employee_id", emp.id)
        .order("created_at", { ascending: false })
        .limit(1);
      const checklistId = (checklists || [])[0]?.id as number | undefined;
      if (checklistId) {
        const { data: items } = await c.from("employee_checklist_items").select("label, done").eq("employer_id", plan.employerId).eq("checklist_id", checklistId);
        for (const row of items || []) if (!(row as { done?: boolean }).done) overdue.push(String((row as { label?: string }).label || "a checklist item"));
      }

      const { data: paperworkRows } = await c.from("onboarding_paperwork").select("kind, status").eq("employer_id", plan.employerId).eq("employee_id", emp.id);
      const paperworkByKind = new Map((paperworkRows || []).map((r) => [(r as { kind?: string }).kind, (r as { status?: string }).status]));
      if ((paperworkByKind.get("w4") || "not_started") === "not_started") overdue.push("W-4");
      if ((paperworkByKind.get("i9") || "not_started") !== "verified") overdue.push("I-9");
      if ((paperworkByKind.get("direct_deposit") || "not_started") === "not_started") overdue.push("Direct deposit");

      const { data: handbookDocs } = await c
        .from("training_docs")
        .select("id")
        .eq("employer_id", plan.employerId)
        .eq("doc_kind", "policy")
        .eq("require_signature", true)
        .eq("assign_to", "all")
        .limit(1);
      const handbookId = (handbookDocs || [])[0]?.id as number | undefined;
      if (handbookId) {
        const { data: acks } = await c
          .from("acknowledgments")
          .select("status")
          .eq("employer_id", plan.employerId)
          .eq("training_doc_id", handbookId)
          .eq("employee_id", emp.id)
          .limit(1);
        const ackStatus = (acks || [])[0]?.status as string | undefined;
        if (ackStatus !== "signed" && ackStatus !== "waived") overdue.push("Employee handbook");
      }

      if (overdue.length === 0) continue;

      const { data: nudgeRows } = await c.from("onboarding_overdue_nudges").select("last_nudged_at").eq("employee_id", emp.id).limit(1);
      const lastNudgedAt = (nudgeRows || [])[0]?.last_nudged_at as string | undefined;
      if (lastNudgedAt && now - new Date(lastNudgedAt).getTime() < OVERDUE_NUDGE_COOLDOWN_MS) continue;

      const reminder = await createReminder({
        employerId: plan.employerId,
        actorUserId: plan.employerId,
        actorEmail: null,
        title: `Onboarding is overdue for ${emp.name || "a new hire"}`,
        note: `Still outstanding: ${overdue.join(", ")}.`,
        dueAt: new Date(now).toISOString(),
        targetType: "employee",
        targetId: emp.id,
      });
      if (!reminder) continue;

      if (lastNudgedAt) {
        await c.from("onboarding_overdue_nudges").update({ last_nudged_at: new Date(now).toISOString(), overdue_summary: overdue.join(", ") }).eq("employee_id", emp.id);
      } else {
        await c.from("onboarding_overdue_nudges").insert({ employee_id: emp.id, employer_id: plan.employerId, last_nudged_at: new Date(now).toISOString(), overdue_summary: overdue.join(", ") });
      }
      nudged++;
    } catch (e) {
      console.error("[onboarding-chase] overdue nudge scan: plan failed", { employerId: plan.employerId, applicantId: plan.applicantId, error: e });
    }
  }
  return { scanned, nudged };
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
