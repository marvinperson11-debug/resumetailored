import { auth } from "@clerk/nextjs/server";
import { getTranslations } from "next-intl/server";
import { getAccess, resolveEmployerId } from "@/lib/plan";
import { candidatePipelineLimit } from "@/lib/employer-plan";
import { isFreeTier, getFreeTierState, refillCooldownOk, freeRefillCooldownDays } from "@/lib/employer-free-tier";
import { getEmployerTimezone, formatEmployerTime } from "@/lib/employer-time";
import { CandidatesClient } from "./candidates-client";
import { DemoPipeline } from "../components/demo/demo-pipeline";
import { demoCandidatesFor, demoJobFor } from "../components/demo/demo-copy";

export const dynamic = "force-dynamic";

export default async function CandidatesPage({ searchParams }: { searchParams: { jobId?: string } }) {
  // Signed out = the anonymous employer taste: the sample pipeline (fixtures only), as Kanban columns.
  const { userId } = await auth();
  if (!userId) {
    const td = await getTranslations("employerDemo");
    return <DemoPipeline candidates={demoCandidatesFor(td)} jobTitle={demoJobFor(td).title} />;
  }
  const jobId = Number(searchParams?.jobId);
  const access = await getAccess();
  const limit = candidatePipelineLimit(access);

  // Taylor v5 Fix, Section C: once a Free employer has consumed their one
  // candidate-slot refill, the next one is on a 30-day cooldown
  // (lib/employer-free-tier.ts refillCooldownOk). Surface the refill date
  // while that cooldown is active — hidden once it clears, and never shown
  // to a paid tier.
  let cooldownUntil: string | null = null;
  if (isFreeTier(access)) {
    const employerId = resolveEmployerId(access, userId);
    if (employerId) {
      const freeState = await getFreeTierState(employerId);
      const cooldownDays = freeRefillCooldownDays();
      if (freeState.lastCandidateRefillAt && !refillCooldownOk(freeState.lastCandidateRefillAt, Date.now(), cooldownDays)) {
        const endMs = new Date(freeState.lastCandidateRefillAt).getTime() + cooldownDays * 86_400_000;
        const tz = await getEmployerTimezone(employerId);
        cooldownUntil = formatEmployerTime(endMs, tz);
      }
    }
  }

  return (
    <CandidatesClient
      initialJobId={Number.isFinite(jobId) && jobId > 0 ? jobId : undefined}
      pipelineLimit={limit === Infinity ? null : limit}
      cooldownUntil={cooldownUntil}
    />
  );
}
