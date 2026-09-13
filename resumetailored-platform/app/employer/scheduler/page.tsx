import { SchedulerClient } from "./scheduler-client";

export const dynamic = "force-dynamic";

export default function SchedulerPage({ searchParams }: { searchParams: { applicantId?: string } }) {
  const applicantId = Number(searchParams?.applicantId);
  return <SchedulerClient initialApplicantId={Number.isFinite(applicantId) && applicantId > 0 ? applicantId : undefined} />;
}
