import { getAccess } from "@/lib/plan";
import { canUseTimeSuite } from "@/lib/employer-plan";
import { TimeOffClient } from "./time-off-client";

export const dynamic = "force-dynamic";

export default async function EmployerTimeOffPage() {
  const access = await getAccess();
  return <TimeOffClient locked={!canUseTimeSuite(access)} />;
}
