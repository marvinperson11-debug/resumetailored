import { getAccess } from "@/lib/plan";
import { requireEmployerId } from "@/lib/employer-auth";
import { monthlyVideoCount } from "@/lib/employer-collab-store";
import { checkVideoAllowance } from "@/lib/employer-plan";
import { SchedulerClient, type SchedulerGating } from "./scheduler-client";

export const dynamic = "force-dynamic";

export default async function SchedulerPage({ searchParams }: { searchParams: { applicantId?: string } }) {
  const applicantId = Number(searchParams?.applicantId);
  const access = await getAccess();
  const employerId = await requireEmployerId();
  const used = employerId ? await monthlyVideoCount(employerId) : 0;
  const a = checkVideoAllowance(access, used);
  const gating: SchedulerGating = {
    tier: a.tier,
    canRecord: a.canRecord,
    canSummary: a.canSummary,
    videoUsed: a.used,
    videoLimit: a.limit === Infinity ? null : a.limit,
    videoRemaining: a.remaining === Infinity ? null : a.remaining,
    videoAllowed: a.allowed,
  };
  return <SchedulerClient initialApplicantId={Number.isFinite(applicantId) && applicantId > 0 ? applicantId : undefined} gating={gating} />;
}
