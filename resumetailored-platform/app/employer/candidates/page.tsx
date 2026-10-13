import { auth } from "@clerk/nextjs/server";
import { getTranslations } from "next-intl/server";
import { getAccess } from "@/lib/plan";
import { candidatePipelineLimit } from "@/lib/employer-plan";
import { resumeViewerEnabled } from "@/lib/resume-viewer-flag";
import { CandidatesClient } from "./candidates-client";
import { DemoPipeline } from "../components/demo/demo-pipeline";
import { demoCandidatesFor, demoJobFor } from "../components/demo/demo-copy";

export const dynamic = "force-dynamic";

export default async function CandidatesPage({ searchParams }: { searchParams: { jobId?: string } }) {
  // Signed out = the anonymous employer taste: the sample pipeline (fixtures only), as Kanban columns.
  const { userId } = await auth();
  if (!userId) {
    const td = await getTranslations("employerDemo");
    return <DemoPipeline candidates={demoCandidatesFor(td)} jobTitle={demoJobFor(td).title} resumeViewer={resumeViewerEnabled()} />;
  }
  const jobId = Number(searchParams?.jobId);
  const access = await getAccess();
  const limit = candidatePipelineLimit(access);
  return (
    <CandidatesClient
      initialJobId={Number.isFinite(jobId) && jobId > 0 ? jobId : undefined}
      pipelineLimit={limit === Infinity ? null : limit}
      resumeViewer={resumeViewerEnabled()}
    />
  );
}
