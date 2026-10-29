import { redirect } from "next/navigation";
import { employerContext } from "@/lib/employer-auth";
import { canUseVoiceMode } from "@/lib/employer-plan";
import { getOrCreatePersona } from "@/lib/assistant-persona";
import { isFreeTier } from "@/lib/employer-free-tier";
import { AssistantClient } from "./assistant-client";

export const dynamic = "force-dynamic";

/** Every tier lands on the real panel now (Taylor Combined Build v5,
 *  Section E.1/E.3) — Free included: there is no lock icon and no full-page
 *  gate here anymore, because Free gets a real assistant experience
 *  (explainer mode, with the one-shot job-post exception), not a locked
 *  module. What differs by tier happens server-side, per chat turn, in
 *  app/api/employer/assistant/chat/route.ts — this page itself no longer
 *  branches on plan at all. No employerContext at all (never signed in)
 *  still redirects — that case is unreachable in practice since
 *  app/employer/layout.tsx already gates the whole portal, but failing
 *  closed here costs nothing. */
export default async function AssistantPage() {
  const ctx = await employerContext();
  if (!ctx) redirect("/employer");
  // Voice Mode (Scale+ only) needs the persona row up front so the header
  // shows the Assistant's name with no flash-of-default-then-rename; a
  // sub-Scale employer never fetches it at all, keeping their page load
  // identical to before this feature existed.
  const canVoice = canUseVoiceMode(ctx.access);
  const persona = canVoice ? await getOrCreatePersona(ctx.employerId) : null;
  return (
    <AssistantClient
      canVoice={canVoice}
      isFree={isFreeTier(ctx.access)}
      initialAssistantName={persona?.assistantName ?? null}
      initialVoiceIntroduced={persona?.voiceIntroduced ?? true}
      initialTtsVoice={persona?.ttsVoice ?? null}
      initialTtsRate={persona?.ttsRate ?? null}
    />
  );
}
