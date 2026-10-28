import { redirect } from "next/navigation";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant, canUseVoiceMode } from "@/lib/employer-plan";
import { getOrCreatePersona } from "@/lib/assistant-persona";
import { AssistantClient } from "./assistant-client";

export const dynamic = "force-dynamic";

/** Portal tier and above only — there is no locked-but-visible state for this
 *  page (unlike Employees/Time/Career Site): a sub-Portal employer who types
 *  this URL directly is sent back to the dashboard, same as "no UI entry
 *  point" in the sidebar (lib/employer-plan.ts `canUseAssistant`). */
export default async function AssistantPage() {
  const ctx = await employerContext();
  if (!ctx || !canUseAssistant(ctx.access)) redirect("/employer");
  // Voice Mode (Scale+ only) needs the persona row up front so the header
  // shows the Assistant's name with no flash-of-default-then-rename; a
  // sub-Scale employer never fetches it at all, keeping their page load
  // identical to before this feature existed.
  const canVoice = canUseVoiceMode(ctx.access);
  const persona = canVoice ? await getOrCreatePersona(ctx.employerId) : null;
  return (
    <AssistantClient
      canVoice={canVoice}
      initialAssistantName={persona?.assistantName ?? null}
      initialVoiceIntroduced={persona?.voiceIntroduced ?? true}
      initialTtsVoice={persona?.ttsVoice ?? null}
      initialTtsRate={persona?.ttsRate ?? null}
    />
  );
}
