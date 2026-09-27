import { getAccess, isEmployer } from "@/lib/plan";
import { isScalePlusTier } from "@/lib/employer-plan";
import { OfficeClient, type OfficeTab } from "./office-client";

export const dynamic = "force-dynamic";

const VALID_TABS: OfficeTab[] = ["calculators", "charts", "spreadsheet", "report"];

export default async function OfficePage({ searchParams }: { searchParams: { tab?: string } }) {
  const access = await getAccess();
  const initialTab = VALID_TABS.find((t) => t === searchParams?.tab);
  const canScale = isScalePlusTier(access);
  return (
    <OfficeClient
      canCharts={canScale}
      canSpreadsheet={canScale}
      canReport={canScale}
      canManage={isEmployer(access)}
      initialTab={initialTab}
    />
  );
}
