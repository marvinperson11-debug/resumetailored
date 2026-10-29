import { NextResponse } from "next/server";
import { requireEmployerId, employerContext } from "@/lib/employer-auth";
import { checkCandidateAllowance } from "@/lib/employer-plan";
import { listApplicants, createApplicant, type ApplicantFilters } from "@/lib/employer-store";
import { isApplicantStatus } from "@/lib/employer-ai";
import { isFreeTier, getFreeTierState, candidateAddAllowed, refillCooldownOk, freeRefillCooldownDays, recordCandidateRefill, requireTierFor } from "@/lib/employer-free-tier";
import { logAction } from "@/lib/assistant-audit";

export const runtime = "nodejs";

/** GET applicants across all this employer's jobs, with filters + sort:
 *  ?jobId=&status=&minScore=&sort=newest|best */
export async function GET(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const filters: ApplicantFilters = {};
  const jobId = Number(url.searchParams.get("jobId"));
  if (Number.isFinite(jobId) && jobId > 0) filters.jobId = jobId;
  const status = url.searchParams.get("status");
  if (isApplicantStatus(status)) filters.status = status;
  const minScore = Number(url.searchParams.get("minScore"));
  if (Number.isFinite(minScore) && minScore > 0) filters.minScore = minScore;
  filters.sort = url.searchParams.get("sort") === "best" ? "best" : "newest";

  const applicants = await listApplicants(employerId, filters);
  return NextResponse.json({ applicants });
}

/** POST — manually add an applicant to one of this employer's jobs. (Applicants
 *  normally arrive from a public job page — never blocked by this limit, see
 *  createPublicApplicant — this manual entry path is the one gated.) */
export async function POST(req: Request) {
  const ctx = await employerContext();
  const employerId = ctx?.employerId || null;
  if (!ctx || !employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as {
    jobId?: number;
    name?: string;
    email?: string;
    resumeText?: string;
    coverLetter?: string;
  };
  const jobId = Number(b.jobId);
  if (!Number.isFinite(jobId)) return NextResponse.json({ error: "Pick a job for this applicant." }, { status: 400 });
  if (!(b.name || "").trim() || !(b.email || "").trim())
    return NextResponse.json({ error: "Name and email are required." }, { status: 400 });

  const pipelineCount = (await listApplicants(employerId)).filter((a) => a.status !== "rejected").length;

  if (isFreeTier(ctx.access)) {
    // CANDIDATE (Free plan, Section E.4): one active slot, plus a rolling
    // refill cooldown so a slot that just freed can't be cycled instantly.
    const freeState = await getFreeTierState(employerId);
    const ceilingGate = requireTierFor(ctx.access, "candidate_add", "You've got a candidate slot filled", candidateAddAllowed(pipelineCount, freeState.candidatesActive));
    if (!ceilingGate.allowed) return NextResponse.json({ error: ceilingGate.message, code: "free_tier_graduation" }, { status: 402 });

    const cooldownOk = refillCooldownOk(freeState.lastCandidateRefillAt, Date.now(), freeRefillCooldownDays());
    if (!cooldownOk) {
      // Logged for review — a genuine rapid reject-then-add pattern is just
      // repeated hits of this exact branch, visible in the audit log without
      // a separate "cycling" table.
      await logAction({
        employerId,
        actorUserId: ctx.userId,
        action: "candidate_refill_cooldown_blocked",
        targetType: null,
        targetId: null,
        payload: { lastCandidateRefillAt: freeState.lastCandidateRefillAt, cooldownDays: freeRefillCooldownDays() },
        status: "executed",
      }).catch(() => {});
      const cooldownGate = requireTierFor(ctx.access, "candidate_refill_cooldown", "You recently filled your candidate slot", false);
      return NextResponse.json({ error: cooldownGate.message, code: "free_tier_graduation" }, { status: 402 });
    }
  } else {
    const allowance = checkCandidateAllowance(ctx.access, pipelineCount);
    if (!allowance.allowed) return NextResponse.json({ error: allowance.message, code: "candidate_limit" }, { status: 402 });
  }

  const applicant = await createApplicant(employerId, {
    jobId,
    name: (b.name || "").trim(),
    email: (b.email || "").trim(),
    resumeText: (b.resumeText || "").trim(),
    coverLetter: (b.coverLetter || "").trim(),
  });
  if (!applicant) return NextResponse.json({ error: "Could not add the applicant (is the job yours?)." }, { status: 400 });
  if (isFreeTier(ctx.access)) await recordCandidateRefill(employerId);
  return NextResponse.json({ applicant });
}
