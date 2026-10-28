import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant, canUseVoiceMode } from "@/lib/employer-plan";
import { getOrCreatePersona } from "@/lib/assistant-persona";
import { LockedFeature } from "@/components/locked-feature";
import { AssistantClient } from "./assistant-client";

export const dynamic = "force-dynamic";

/** Portal tier and above for the real panel. Below Portal (Free tier), the
 *  nav tab now renders LIKE every other locked module (Employees/Time/Career
 *  Site — see EmployerSidebar's `lockedHrefs`) instead of being omitted, so
 *  this page must render something too: the full-page gate (Voice Fix Round
 *  2, Section F) rather than the previous redirect back to the dashboard. No
 *  employerContext at all (never signed in) still redirects — that case is
 *  unreachable in practice since app/employer/layout.tsx already gates the
 *  whole portal, but failing closed here costs nothing. */
export default async function AssistantPage() {
  const ctx = await employerContext();
  if (!ctx) redirect("/employer");
  if (!canUseAssistant(ctx.access)) {
    const t = await getTranslations("employerNav");
    return <LockedFeature feature={t("assistant")} variant="assistant" />;
  }
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
