import { getAccess, isEmployer } from "@/lib/plan";
import { EmployeesClient, type Tab } from "./employees-client";

export const dynamic = "force-dynamic";

const VALID_TABS: Tab[] = ["directory", "feed", "skills", "announcements", "onboarding", "training", "library"];

export default async function EmployeesPage({ searchParams }: { searchParams: { tab?: string; doc?: string } }) {
  const access = await getAccess();
  const initialTab = VALID_TABS.find((t) => t === searchParams?.tab);
  const docId = Number(searchParams?.doc);
  return (
    <EmployeesClient
      canManage={isEmployer(access)}
      initialTab={initialTab}
      initialDocId={Number.isFinite(docId) && docId > 0 ? docId : undefined}
    />
  );
}
