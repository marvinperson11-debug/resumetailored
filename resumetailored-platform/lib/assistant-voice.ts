import { resolveFirstName } from "./welcome-email";
import { listPendingActions } from "./assistant-pending";
import { logAction } from "./assistant-audit";
import { markVoiceIntroduced, parseNameConfirmation, parseRenameIntent, renameAssistant, setEmployerDisplayName } from "./assistant-persona";

/**
 * Voice Mode (Prompt 7) — the I/O-layer logic that sits ABOVE
 * lib/assistant-chat.ts `runAssistantTurn`, which this module never calls
 * into and never modifies. Everything here is either a deterministic text
 * transform (markdown stripping, length capping) or a deterministic parse
 * (the onboarding yes/no/correction below) — no LLM call, ever, for any of
 * it.
 *
 * HARD RULE, verbatim: voice can never confirm an action. There is no
 * function anywhere in this module, or anywhere this module's exports are
 * called from, that reaches lib/assistant-mutations.ts `approvePendingAction`
 * or `executePendingAction`. A spoken "yes" while a card is pending is just
 * text like any other — at most it can rename the assistant or answer the
 * onboarding question, never approve anything. Approval stays a tap on the
 * card.
 */

export const SPOKEN_MAX_CHARS = 600;

/** Deterministic rename handling shared by both the typed-text chat route
 *  and the voice-chat route — a "call you X" / "your name is X" /
 *  "rename to X" message never reaches `runAssistantTurn` at all; it's
 *  applied directly and the model is never called for it (no tool use, no
 *  tokens spent, no turn-cap consumed). Returns the new name if the
 *  message matched, else null so the caller falls through to the normal
 *  turn. */
export async function tryHandleRenameIntent(
  employerId: string,
  actorUserId: string,
  actorEmail: string | null,
  latestUserText: string
): Promise<string | null> {
  const name = parseRenameIntent(latestUserText);
  if (!name) return null;
  await renameAssistant(employerId, name);
  await logAction({
    employerId,
    actorUserId,
    actorEmail,
    action: "assistant_rename",
    targetType: "assistant_persona",
    targetId: employerId,
    payload: { assistantName: name },
    status: "executed",
  });
  return name;
}

export function buildRenameConfirmation(name: string): string {
  return `Got it — I'll go by ${name} from now on.`;
}

/** The ONE fixed line read aloud whenever a turn drafted a new pending
 *  action — never the model's own prose, and never the artifact body
 *  (resolvedSpecifics/items), which stays visual-only on the card. */
export function buildPendingApprovalSpokenLine(actionTitle: string): string {
  return `I've prepared ${actionTitle} for your approval — review the card and tap approve.`;
}

function buildMultiplePendingApprovalSpokenLine(count: number): string {
  return `I've prepared ${count} items for your approval — review the cards and tap approve.`;
}

/** Markdown-stripped, length-capped plain text for TTS. Deterministic
 *  string transform only — never touches meaning, never summarizes. */
export function stripMarkdownForSpeech(text: string, maxLen: number = SPOKEN_MAX_CHARS): string {
  let out = (text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    // A line break after a word (not already sentence-ending punctuation)
    // becomes a spoken pause, not just whitespace — otherwise a heading
    // or list item run into the next line with no pause at all.
    .replace(/([^\s.!?])\n/g, "$1. ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (out.length > maxLen) {
    const cut = out.slice(0, maxLen);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    out = (lastStop > maxLen * 0.4 ? cut.slice(0, lastStop + 1) : cut).trim() + "…";
  }
  return out;
}

export interface BuildSpokenReplyInput {
  reply: string;
  /** Artifact titles of pending actions created DURING this turn (see
   *  `pendingTitlesCreatedSince` below) — never titles of cards that
   *  already existed, so correcting an existing card doesn't re-announce
   *  it. */
  newPendingTitles: string[];
}

/** The one place that decides what gets read aloud. A turn that drafted
 *  something new always gets the fixed approval line, regardless of
 *  whatever prose the model also returned; everything else is the model's
 *  own answer, cleaned up for speech. */
export function buildSpokenReply(input: BuildSpokenReplyInput): string {
  if (input.newPendingTitles.length === 1) return buildPendingApprovalSpokenLine(input.newPendingTitles[0]);
  if (input.newPendingTitles.length > 1) return buildMultiplePendingApprovalSpokenLine(input.newPendingTitles.length);
  return stripMarkdownForSpeech(input.reply);
}

/** Which of `after` weren't present in `before`, by id. The only signal this
 *  feature uses to know a turn drafted something — `runAssistantTurn`'s own
 *  return value carries no such record, by design (Constraints: zero
 *  changes to the turn pipeline). */
export function diffNewPendingActions<B extends { id: string }, A extends { id: string }>(before: B[], after: A[]): A[] {
  const beforeIds = new Set(before.map((a) => a.id));
  return after.filter((a) => !beforeIds.has(a.id));
}

/** Call BEFORE `runAssistantTurn`, keep the result, then pass it to
 *  `pendingTitlesCreatedSince` AFTER the turn resolves. */
export async function snapshotPendingIds(employerId: string): Promise<{ id: string }[]> {
  const rows = await listPendingActions(employerId);
  return rows.map((r) => ({ id: r.id }));
}

/** Artifact titles of every pending action created since `before` was
 *  captured. */
export async function pendingTitlesCreatedSince(employerId: string, before: { id: string }[]): Promise<string[]> {
  const after = await listPendingActions(employerId);
  return diffNewPendingActions(before, after).map((r) => r.artifact.title);
}

/* --------------------------------------------------------------------- *
 * First-voice-session onboarding exchange — the employer's own display
 * name. Entirely scripted (never an LLM call): a fixed greeting, a
 * deterministic parse of the answer, one of three fixed follow-up lines.
 * -------------------------------------------------------------------- */

export interface OnboardingGreeting {
  spoken: string;
  /** False when there was nothing to confirm (no resolvable first name) —
   *  the caller should mark the exchange done immediately without waiting
   *  for an answer. */
  awaitingConfirmation: boolean;
  proposedName: string | null;
}

/** The fixed greeting for an employer's first voice session
 *  (`voice_introduced === false`). `clerkFirstName` is read the normal way
 *  other features in this codebase read it (`clerkClient().users.getUser`),
 *  by the caller — this function is pure so it's directly testable. */
export function buildOnboardingGreeting(assistantName: string, clerkFirstName: string | null, email: string | null): OnboardingGreeting {
  const proposed = resolveFirstName(clerkFirstName, email);
  if (proposed === "there") {
    return { spoken: `Hi, I'm ${assistantName}. What can I help with today?`, awaitingConfirmation: false, proposedName: null };
  }
  return { spoken: `Hi, I'm ${assistantName}. Mind if I call you ${proposed}?`, awaitingConfirmation: true, proposedName: proposed };
}

export interface OnboardingAnswerResult {
  /** False when the answer didn't deterministically parse — the caller
   *  should ask again rather than guessing accept or decline. */
  handled: boolean;
  displayName: string | null;
  spoken: string;
}

/** Resolve the employer's answer to "Mind if I call you X?" and persist it.
 *  Deterministic parse only (lib/assistant-persona.ts `parseNameConfirmation`)
 *  — never an LLM call for this exchange. */
export async function resolveOnboardingAnswer(employerId: string, proposedName: string, answerText: string): Promise<OnboardingAnswerResult> {
  const parsed = parseNameConfirmation(answerText);
  if (!parsed) {
    return { handled: false, displayName: null, spoken: `Sorry, I didn't catch that — mind if I call you ${proposedName}?` };
  }
  if (!parsed.accepted) {
    await markVoiceIntroduced(employerId);
    return { handled: true, displayName: null, spoken: "No problem — I'll keep it general." };
  }
  const finalName = parsed.correctedName || proposedName;
  await setEmployerDisplayName(employerId, finalName);
  return { handled: true, displayName: finalName, spoken: `Got it, ${finalName}. What can I help with today?` };
}
