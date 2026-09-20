import { MessagesTabs } from "./messages-tabs";

export const dynamic = "force-dynamic";

export default function MessagesPage({ searchParams }: { searchParams: { applicantId?: string } }) {
  const applicantId = Number(searchParams?.applicantId);
  return <MessagesTabs initialApplicantId={Number.isFinite(applicantId) && applicantId > 0 ? applicantId : undefined} />;
}
