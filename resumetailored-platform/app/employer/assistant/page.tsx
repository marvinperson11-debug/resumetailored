import { redirect } from "next/navigation";
import { getAccess } from "@/lib/plan";
import { canUseAssistant } from "@/lib/employer-plan";
import { AssistantClient } from "./assistant-client";

export const dynamic = "force-dynamic";

/** Portal tier and above only — there is no locked-but-visible state for this
 *  page (unlike Employees/Time/Career Site): a sub-Portal employer who types
 *  this URL directly is sent back to the dashboard, same as "no UI entry
 *  point" in the sidebar (lib/employer-plan.ts `canUseAssistant`). */
export default async function AssistantPage() {
  const access = await getAccess();
  if (!canUseAssistant(access)) redirect("/employer");
  return <AssistantClient />;
}
