import { auth } from "@clerk/nextjs/server";
import { getAccess, isEmployer } from "@/lib/plan";
import { isScalePlusTier } from "@/lib/employer-plan";
import { OfficeClient, type OfficeTab } from "./office-client";

export const dynamic = "force-dynamic";

const VALID_TABS: OfficeTab[] = ["calculators", "charts", "spreadsheet", "report", "presentation"];

export default async function OfficePage({ searchParams }: { searchParams: { tab?: string } }) {
  const { userId } = await auth();
  const access = await getAccess();
  const initialTab = VALID_TABS.find((t) => t === searchParams?.tab);
  const canScale = isScalePlusTier(access);
  return (
    <OfficeClient
      canCharts={canScale}
      canSpreadsheet={canScale}
      canReport={canScale}
      canPresentation={canScale}
      // Signed-out = the anonymous employer taste: a brand-new account owns
      // its workspace from the moment it exists, so this reads true here too
      // (real saves are gated client-side via useEmployerDemo).
      canManage={!userId || isEmployer(access)}
      initialTab={initialTab}
    />
  );
}
