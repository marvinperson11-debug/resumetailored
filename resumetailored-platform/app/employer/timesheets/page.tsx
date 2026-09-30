import { getAccess } from "@/lib/plan";
import { canUseTimeSuite } from "@/lib/employer-plan";
import { TimesheetsClient } from "./timesheets-client";

export const dynamic = "force-dynamic";

export default async function TimesheetsPage() {
  const access = await getAccess();
  return <TimesheetsClient locked={!canUseTimeSuite(access)} />;
}
