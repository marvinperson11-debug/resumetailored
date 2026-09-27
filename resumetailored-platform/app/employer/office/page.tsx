import { getAccess, isEmployer } from "@/lib/plan";
import { isScalePlusTier } from "@/lib/employer-plan";
import { OfficeClient, type OfficeTab } from "./office-client";

export const dynamic = "force-dynamic";

const VALID_TABS: OfficeTab[] = ["calculators", "charts"];

export default async function OfficePage({ searchParams }: { searchParams: { tab?: string } }) {
  const access = await getAccess();
  const initialTab = VALID_TABS.find((t) => t === searchParams?.tab);
  return <OfficeClient canCharts={isScalePlusTier(access)} canManage={isEmployer(access)} initialTab={initialTab} />;
}
