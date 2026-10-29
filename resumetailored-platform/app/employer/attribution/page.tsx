import { AttributionClient } from "./attribution-client";

// "Applicants by channel" (Combined Build, Section 3). Signed-in employer
// pages are default-deny under /employer/* unless explicitly listed as
// anonymous-employer-taste (middleware.ts `isEmployerTastePage`) — this page
// isn't one of the three taste pages, so a guest is already redirected to
// sign-in before this ever renders.
export const dynamic = "force-dynamic";

export default function AttributionPage({ searchParams }: { searchParams: { jobId?: string } }) {
  const jobId = searchParams?.jobId ? Number(searchParams.jobId) : undefined;
  return <AttributionClient jobId={Number.isFinite(jobId) ? jobId : undefined} />;
}
