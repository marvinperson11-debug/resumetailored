import { CandidatesClient } from "./candidates-client";

export const dynamic = "force-dynamic";

export default function CandidatesPage({ searchParams }: { searchParams: { jobId?: string } }) {
  const jobId = Number(searchParams?.jobId);
  return <CandidatesClient initialJobId={Number.isFinite(jobId) && jobId > 0 ? jobId : undefined} />;
}
