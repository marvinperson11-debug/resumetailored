import { MessagesClient } from "./messages-client";

export const dynamic = "force-dynamic";

export default function MessagesPage({ searchParams }: { searchParams: { applicantId?: string } }) {
  const applicantId = Number(searchParams?.applicantId);
  return <MessagesClient initialApplicantId={Number.isFinite(applicantId) && applicantId > 0 ? applicantId : undefined} />;
}
