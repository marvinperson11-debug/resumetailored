import { getAccess } from "@/lib/plan";
import { candidatePipelineLimit } from "@/lib/employer-plan";
import { CandidatesClient } from "./candidates-client";

export const dynamic = "force-dynamic";

export default async function CandidatesPage({ searchParams }: { searchParams: { jobId?: string } }) {
  const jobId = Number(searchParams?.jobId);
  const access = await getAccess();
  const limit = candidatePipelineLimit(access);
  return (
    <CandidatesClient
      initialJobId={Number.isFinite(jobId) && jobId > 0 ? jobId : undefined}
      pipelineLimit={limit === Infinity ? null : limit}
    />
  );
}
