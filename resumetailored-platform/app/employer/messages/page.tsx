import { MessagesTabs } from "./messages-tabs";

export const dynamic = "force-dynamic";

export default function MessagesPage({ searchParams }: { searchParams: { applicantId?: string; view?: string; employeeId?: string } }) {
  const applicantId = Number(searchParams?.applicantId);
  const employeeId = Number(searchParams?.employeeId);
  return (
    <MessagesTabs
      initialApplicantId={Number.isFinite(applicantId) && applicantId > 0 ? applicantId : undefined}
      initialMode={searchParams?.view === "employees" ? "employees" : undefined}
      initialEmployeeId={Number.isFinite(employeeId) && employeeId > 0 ? employeeId : undefined}
    />
  );
}
