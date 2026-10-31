import { getAccess, isEmployer } from "@/lib/plan";
import { employerContext } from "@/lib/employer-auth";
import { employeeAddCurrentlyAllowed } from "@/lib/employer-free-tier";
import { EmployeesClient, type Tab } from "./employees-client";

export const dynamic = "force-dynamic";

const VALID_TABS: Tab[] = ["directory", "feed", "skills", "announcements", "onboarding", "training", "library"];

export default async function EmployeesPage({ searchParams }: { searchParams: { tab?: string; doc?: string } }) {
  const ctx = await employerContext();
  const access = ctx?.access ?? (await getAccess());
  const initialTab = VALID_TABS.find((t) => t === searchParams?.tab);
  const docId = Number(searchParams?.doc);
  // `locked` must track the SAME allowance the server enforces
  // (employeeAddCurrentlyAllowed) — a Free org with its one non-owner
  // employee slot still open must not be walled out before ever reaching
  // POST /api/employer/employees.
  const locked = ctx ? !(await employeeAddCurrentlyAllowed(access, ctx.employerId)) : true;
  return (
    <EmployeesClient
      canManage={isEmployer(access)}
      locked={locked}
      initialTab={initialTab}
      initialDocId={Number.isFinite(docId) && docId > 0 ? docId : undefined}
    />
  );
}
