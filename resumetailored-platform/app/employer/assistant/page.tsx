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
 *  branches on plan at all.
 *
 *  A signed-out visitor (no employerContext) is now the anonymous employer
 *  taste (Nov 2026 nav widening) rather than a redirect: the panel renders
 *  exactly as a brand-new Free account would (canVoice/isFree both resolve
 *  off the same FREE access object getAccess() already returns for an
 *  anonymous caller), with no persona to fetch. The "Send" action itself is
 *  gated in the client via useEmployerDemo() — hitting it opens the
 *  create-account prompt in place rather than ever reaching the chat route. */
export default async function AssistantPage() {
  const ctx = await employerContext();
  const canVoice = ctx ? canUseVoiceMode(ctx.access) : false;
  // Voice Mode (Scale+ only) needs the persona row up front so the header
  // shows the Assistant's name with no flash-of-default-then-rename; a
  // sub-Scale employer (or a signed-out visitor) never fetches it at all,
  // keeping their page load identical to before this feature existed.
  const persona = ctx && canVoice ? await getOrCreatePersona(ctx.employerId) : null;
  return (
    <AssistantClient
      canVoice={canVoice}
      isFree={ctx ? isFreeTier(ctx.access) : true}
      initialAssistantName={persona?.assistantName ?? null}
      initialVoiceIntroduced={persona?.voiceIntroduced ?? true}
      initialTtsVoice={persona?.ttsVoice ?? null}
      initialTtsRate={persona?.ttsRate ?? null}
    />
  );
}
