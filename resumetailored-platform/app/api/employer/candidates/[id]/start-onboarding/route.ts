import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { canUseOnboardingTools } from "@/lib/employer-plan";
import { employeeAddCurrentlyAllowed } from "@/lib/employer-free-tier";
import { getApplicant, getJob, getEmployerProfile } from "@/lib/employer-store";
import { getEmployerTimezone } from "@/lib/employer-time";
import { listEmployees, createEmployee } from "@/lib/employees-store";
import { createPendingAction, listAllActionsForEmployer } from "@/lib/assistant-pending";
import { buildOnboardingPlanArtifactInline } from "@/lib/onboarding-chase";
import { listEnvelopesForEmail } from "@/lib/docusign-store";

export const runtime = "nodejs";

/**
 * POST — the hand-driven "Start onboarding" button on a hired candidate
 * (prompt item 1): an employer who never uses Taylor can start the SAME
 * onboarding plan Taylor would have drafted automatically on Scale+
 * (lib/onboarding-chase.ts `runOnboardingCompletionScan`). Built from the
 * exact same `buildOnboardingPlanArtifactInline` helper, so the two paths
 * produce byte-identical plan content; both land as an `onboarding_plan`
 * pending action the employer approves through the normal assistant
 * actions pipeline (app/api/employer/assistant/actions/[id]/approve —
 * `isPortalOpenPendingAction` lets a Portal-tier employer approve their own
 * one here, same ruling as distribute_job).
 *
 * Tier split (Decision: Free is explainer-only):
 *  - Free: no plan. This only ensures the employee record exists (same
 *    allowance the "Add as employee" button already uses), so a Free
 *    employer still gets SOMETHING real out of the button — the employee
 *    now shows up in their one-slot Employees hub.
 *  - Portal and above: drafts the full plan as a pending action for the
 *    employer to approve right away.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can start onboarding." }, { status: 403 });

  const applicantId = Number(params.id);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const applicant = await getApplicant(ctx.employerId, applicantId);
  if (!applicant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!canUseOnboardingTools(ctx.access)) {
    // Free tier: just the employee record, same allowance as POST
    // /api/employer/employees — never a plan.
    if (!(await employeeAddCurrentlyAllowed(ctx.access, ctx.employerId))) {
      return NextResponse.json(
        { error: "The Employees Hub is part of the Portal plan. Upgrade to add real employees — everything you've set up will be waiting." },
        { status: 403 }
      );
    }
    const existing = await listEmployees(ctx.employerId);
    let employee = applicant.email ? existing.find((e) => (e.email || "").trim().toLowerCase() === applicant.email.trim().toLowerCase()) : undefined;
    if (!employee) {
      employee = (await createEmployee(ctx.employerId, { name: applicant.name, email: applicant.email, role: applicant.jobTitle || "", status: "active", applicantId })) || undefined;
    }
    if (!employee) return NextResponse.json({ error: "Could not add the employee. Is the database configured?" }, { status: 500 });
    return NextResponse.json({ plan: null, employee });
  }

  // Dedupe against anything already drafted for this applicant — by Taylor's
  // own tick (Scale+) or an earlier click of this same button — same rule
  // lib/onboarding-chase.ts uses: fires at most once ever.
  const already = await listAllActionsForEmployer(ctx.employerId, "onboarding_plan");
  const existingRow = already.find((row) => (row.payload as { applicantId?: number }).applicantId === applicantId);
  if (existingRow) {
    return NextResponse.json({ plan: { pendingActionId: existingRow.id, status: existingRow.status, artifact: existingRow.artifact } });
  }

  const job = await getJob(ctx.employerId, applicant.jobId);
  const profile = await getEmployerProfile(ctx.employerId);
  const employerTz = await getEmployerTimezone(ctx.employerId);

  // An offer may already have been sent + completed via DocuSign (manual
  // route or an earlier chat turn) before this button is ever clicked — use
  // its own startDate when there is one, same as the automatic chase scan
  // does from the envelope. Otherwise fall back to today, exactly like
  // buildOnboardingPlan's own anchor resolution does for an unparseable date.
  const completedOffer = applicant.email
    ? (await listEnvelopesForEmail(ctx.employerId, applicant.email)).find((e) => e.docType === "offer" && e.status === "completed")
    : undefined;

  const { payload, artifact } = buildOnboardingPlanArtifactInline({
    applicantId,
    jobId: applicant.jobId,
    jobTitle: job?.title || applicant.jobTitle || "the role",
    candidateName: applicant.name || "the new hire",
    companyName: profile?.companyName || "",
    startDateRaw: completedOffer?.offer?.startDate || "",
    fallbackAnchorIso: completedOffer?.completedAt || new Date().toISOString(),
    employerTz,
  });
  const row = await createPendingAction({ employerId: ctx.employerId, actorUserId: ctx.userId, action: "onboarding_plan", payload, artifact, irreversible: false });
  if (!row) return NextResponse.json({ error: "Could not prepare the onboarding plan. Please try again." }, { status: 500 });
  return NextResponse.json({ plan: { pendingActionId: row.id, status: row.status, artifact: row.artifact } });
}
