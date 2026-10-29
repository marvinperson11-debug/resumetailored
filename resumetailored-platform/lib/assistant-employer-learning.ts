import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEmployerTimezone, localHourInTz } from "./employer-time";

/**
 * Per-employer learning for the Employer Portal AI Assistant
 * (assistant_employer_learning, migration 0076, Taylor Combined Build v5,
 * Section D) — deterministic, OBSERVATION-ONLY extractors that notice
 * patterns in what an employer has actually APPROVED (never a mere draft,
 * and never anything the employer rejected or never approved), so Taylor
 * can offer a learned default as a SUGGESTION. This module never sends,
 * applies, or schedules anything on its own — every classifier here is a
 * pure function from already-committed data to a label, and every write is
 * a tally used only to decide what to show the employer, who can accept,
 * correct, or delete each item from "What Taylor has learned about you".
 *
 * Call `observeApprovedAction` exactly once, from
 * lib/assistant-mutations.ts `approvePendingAction`, AFTER the real
 * mutation has actually succeeded — never from a tool executor that only
 * drafts a card (lib/assistant-tools.ts), and never from a card that was
 * cancelled or failed. Best-effort throughout, same posture as
 * lib/assistant-audit.ts `logAction`: a learning-store hiccup must never
 * block or fail the approval that triggered it.
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export type LearningCategory = "message_style" | "interview_pattern" | "name_preference";

export interface LearningRow {
  id: string;
  employerId: string;
  category: LearningCategory;
  signalKey: string;
  signalValue: string;
  counts: Record<string, number>;
  sampleCount: number;
  corrected: boolean;
  createdAt: string;
  updatedAt: string;
}

const COLS = "id, employer_id, category, signal_key, signal_value, counts_json, sample_count, corrected, created_at, updated_at";

function mapRow(r: Record<string, unknown>): LearningRow {
  return {
    id: r.id as string,
    employerId: (r.employer_id as string) || "",
    category: (r.category as LearningCategory) || "message_style",
    signalKey: (r.signal_key as string) || "",
    signalValue: (r.signal_value as string) || "",
    counts: (r.counts_json as Record<string, number>) || {},
    sampleCount: typeof r.sample_count === "number" ? r.sample_count : 0,
    corrected: !!r.corrected,
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

/* ───────────────────────────────────────────────────────────────────────── *
 * Deterministic classifiers — pure functions, never an LLM call, never
 * touching the network or the clock (beyond the plain numbers a caller
 * already resolved). Each one maps already-approved content to one label;
 * an "unspecified" result is deliberately never recorded by the caller
 * below — there is nothing deterministic to learn from a message that
 * simply doesn't match any known pattern, and recording noise would only
 * dilute a real pattern once one emerges.
 * ──────────────────────────────────────────────────────────────────────── */

function firstNonEmptyLine(text: string): string {
  return (text.split(/\r?\n/).find((l) => l.trim().length > 0) || "").trim();
}

export type MessageGreetingTone = "casual" | "formal" | "unspecified";

/** The OPENING line's tone — "Hi"/"Hey"/"Hello" vs. a formal "Dear Mr./Ms./
 *  Mrs./Mx./Dr. …" salutation. */
export function classifyMessageGreeting(message: string): MessageGreetingTone {
  const line = firstNonEmptyLine(message);
  if (!line) return "unspecified";
  if (/^dear\s+(mr\.?|mrs\.?|ms\.?|mx\.?|dr\.?)\s+\S/i.test(line)) return "formal";
  if (/^(hi|hey|hello)\b/i.test(line)) return "casual";
  return "unspecified";
}

export type MessageSignoffTone = "warm" | "formal" | "none";

const WARM_SIGNOFF_RE = /^(best|thanks|thank you|cheers|warmly|talk soon)[,!.]?\s*$/i;
const FORMAL_SIGNOFF_RE = /^(sincerely|regards|best regards|respectfully)[,!.]?\s*$/i;

/** Whether — and how — the message closes with a sign-off line. Checked
 *  against the last two non-empty lines (the sign-off word itself, e.g.
 *  "Best,", is commonly followed by a name on its own line). "none" is
 *  recorded as a real signal, not skipped — "this employer doesn't bother
 *  with a sign-off" is itself a learnable habit. */
export function classifyMessageSignoff(message: string): MessageSignoffTone {
  const lines = message
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(-2)) {
    if (FORMAL_SIGNOFF_RE.test(line)) return "formal";
    if (WARM_SIGNOFF_RE.test(line)) return "warm";
  }
  return "none";
}

export type MessageLength = "short" | "medium" | "long";

/** Bucketed by character count of the trimmed message body. */
export function classifyMessageLength(message: string): MessageLength {
  const len = message.trim().length;
  if (len < 300) return "short";
  if (len < 800) return "medium";
  return "long";
}

export type CandidateAddressing = "first_name" | "formal_title" | "unspecified";

/** How the employer tends to ADDRESS the candidate, distinct from general
 *  tone above: a literal `{{firstName}}` personalization token is the
 *  clearest possible first-name signal (it's the exact mechanism
 *  message_candidates uses to personalize); a formal "Dear Mr./Ms. …"
 *  opening is the clearest formal-title signal. A bare "Hi" with no name
 *  token at all doesn't tell us how they address the candidate by NAME, so
 *  it stays "unspecified" here even though classifyMessageGreeting would
 *  call it "casual". */
export function classifyCandidateAddressing(message: string): CandidateAddressing {
  if (/\{\{\s*firstName\s*\}\}/i.test(message)) return "first_name";
  const line = firstNonEmptyLine(message);
  if (/^dear\s+(mr\.?|mrs\.?|ms\.?|mx\.?|dr\.?)\s+\S/i.test(line)) return "formal_title";
  // Split rather than one case-insensitive regex: the greeting word ("Hi"/
  // "hi") should match regardless of case, but the name token right after it
  // must stay genuinely capitalized — a single /i flag would also blur that
  // second check and match a lowercase word as if it were a name.
  const [rawFirst = "", rawSecond = ""] = line.split(/\s+/, 2);
  const first = rawFirst.replace(/[,!.:]+$/, "");
  const second = rawSecond.replace(/[,!.:]+$/, "");
  if (/^(hi|hey|hello)$/i.test(first) && /^[A-Z][a-z'-]+$/.test(second)) return "first_name";
  return "unspecified";
}

const COMMON_INTERVIEW_DURATIONS = [15, 30, 45, 60];

/** Bucketed to the common durations the scheduler already offers; anything
 *  else is "other" rather than every odd value getting its own bucket. */
export function classifyInterviewDuration(durationMin: number | null | undefined): string {
  if (typeof durationMin !== "number" || !Number.isFinite(durationMin)) return "unspecified";
  return COMMON_INTERVIEW_DURATIONS.includes(durationMin) ? String(durationMin) : "other";
}

export type InterviewModeSignal = "video" | "phone" | "onsite" | "unspecified";

export function classifyInterviewMode(mode: string | null | undefined): InterviewModeSignal {
  return mode === "video" || mode === "phone" || mode === "onsite" ? mode : "unspecified";
}

export type TimeOfDay = "morning" | "afternoon" | "evening";

/** `hour` is the LOCAL hour-of-day (0-23) in the employer's own timezone —
 *  callers resolve that via lib/employer-time.ts before calling this, so the
 *  bucketing itself stays a trivial, directly-testable pure function. */
export function classifyInterviewTimeOfDay(hour: number): TimeOfDay {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** The weekday abbreviation (e.g. "Tue") `ms` falls on in `tz` — the one
 *  place this module turns an instant into a day-of-week label, exported so
 *  a caller (including a test computing what it expects) never needs its
 *  own separate Intl call to agree with what actually gets recorded. */
export function weekdayAbbrevInTz(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(ms));
}

/* ───────────────────────────────────────────────────────────────────────── *
 * The store — upsert-on-observe, read/delete/correct for the employer-
 * visible view.
 * ──────────────────────────────────────────────────────────────────────── */

export const MIN_SAMPLES_FOR_SUGGESTION = 3;
export const MIN_SHARE_FOR_SUGGESTION = 0.6;

/** Whether a learned item is strong enough to present as a settled habit —
 *  an explicit employer correction is always authoritative regardless of
 *  sample size; otherwise it needs both a minimum number of observations
 *  AND a clear majority, so three mixed observations never look like a
 *  confident pattern. Pure, so the threshold is directly testable without
 *  touching the store. */
export function isSuggestable(row: Pick<LearningRow, "sampleCount" | "counts" | "signalValue" | "corrected">): boolean {
  if (row.corrected) return true;
  if (row.sampleCount < MIN_SAMPLES_FOR_SUGGESTION) return false;
  const dominant = row.counts[row.signalValue] || 0;
  return dominant / row.sampleCount >= MIN_SHARE_FOR_SUGGESTION;
}

/** Fixed, hand-written sentences — not translated, same convention as
 *  lib/hiring-report.ts's plain-English `report` text: this is DATA-driven
 *  prose describing what was actually observed, not static UI chrome, so it
 *  doesn't carry a next-intl key. Falls back to a plain key:value sentence
 *  for any signal this function doesn't recognize by name, so a future
 *  signal key is never silently unreadable. */
export function describeLearning(row: Pick<LearningRow, "category" | "signalKey" | "signalValue">): string {
  const { category, signalKey, signalValue } = row;
  if (category === "message_style" && signalKey === "greeting_tone") {
    return signalValue === "casual" ? 'You tend to open candidate messages casually (e.g. "Hi").' : 'You tend to open candidate messages formally (e.g. "Dear Ms. …").';
  }
  if (category === "message_style" && signalKey === "signoff_tone") {
    if (signalValue === "warm") return 'You usually sign off warmly (e.g. "Best,").';
    if (signalValue === "formal") return 'You usually sign off formally (e.g. "Sincerely,").';
    return "You usually skip a sign-off.";
  }
  if (category === "message_style" && signalKey === "message_length") {
    return `Your candidate messages tend to be ${signalValue}.`;
  }
  if (category === "name_preference" && signalKey === "candidate_addressing") {
    return signalValue === "first_name" ? "You tend to address candidates by first name." : 'You tend to address candidates formally (e.g. "Dear Ms. …").';
  }
  if (category === "interview_pattern" && signalKey === "duration") {
    return signalValue === "other" ? "Your interview durations vary." : `You usually schedule ${signalValue}-minute interviews.`;
  }
  if (category === "interview_pattern" && signalKey === "mode") {
    return `You usually schedule ${signalValue} interviews.`;
  }
  if (category === "interview_pattern" && signalKey === "time_of_day") {
    return `You usually schedule interviews in the ${signalValue}.`;
  }
  if (category === "interview_pattern" && signalKey === "day_of_week") {
    return `You usually schedule interviews on ${signalValue}.`;
  }
  return `${signalKey}: ${signalValue}`;
}

/** The most-observed value wins; a tie keeps whatever's already stored
 *  rather than flapping to whichever key `Object.entries` happens to visit
 *  last. */
function dominantValue(counts: Record<string, number>, currentValue: string): string {
  let best = currentValue;
  let bestCount = counts[currentValue] || 0;
  for (const [value, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Record one observed value for (employerId, category, signalKey) —
 *  creates the row on first observation, otherwise tallies it in and
 *  recomputes the dominant value. A row the employer has explicitly
 *  CORRECTED (`corrected: true`) is left completely alone: the correction
 *  is authoritative until the employer changes it again themselves, never
 *  silently overwritten by a fresh batch of observations. Best-effort —
 *  never throws. */
async function upsertSignal(employerId: string, category: LearningCategory, signalKey: string, observedValue: string): Promise<void> {
  const c = db();
  if (!c || !employerId || !signalKey || !observedValue) return;
  try {
    const { data: existing } = await c
      .from("assistant_employer_learning")
      .select(COLS)
      .eq("employer_id", employerId)
      .eq("category", category)
      .eq("signal_key", signalKey)
      .maybeSingle();
    if (!existing) {
      await c.from("assistant_employer_learning").insert({
        employer_id: employerId,
        category,
        signal_key: signalKey,
        signal_value: observedValue,
        counts_json: { [observedValue]: 1 },
        sample_count: 1,
        corrected: false,
      });
      return;
    }
    const row = mapRow(existing);
    if (row.corrected) return;
    const counts = { ...row.counts, [observedValue]: (row.counts[observedValue] || 0) + 1 };
    const sampleCount = row.sampleCount + 1;
    await c
      .from("assistant_employer_learning")
      .update({ counts_json: counts, sample_count: sampleCount, signal_value: dominantValue(counts, row.signalValue), updated_at: new Date().toISOString() })
      .eq("id", row.id);
  } catch (e) {
    console.error("[assistant-employer-learning] upsertSignal threw", { employerId, category, signalKey, error: e });
  }
}

async function observeMessageText(employerId: string, message: string): Promise<void> {
  const greeting = classifyMessageGreeting(message);
  if (greeting !== "unspecified") await upsertSignal(employerId, "message_style", "greeting_tone", greeting);
  await upsertSignal(employerId, "message_style", "signoff_tone", classifyMessageSignoff(message));
  await upsertSignal(employerId, "message_style", "message_length", classifyMessageLength(message));
  const addressing = classifyCandidateAddressing(message);
  if (addressing !== "unspecified") await upsertSignal(employerId, "name_preference", "candidate_addressing", addressing);
}

async function observeInterview(employerId: string, p: { scheduledAt?: unknown; durationMin?: unknown; mode?: unknown }): Promise<void> {
  const durationMin = typeof p.durationMin === "number" ? p.durationMin : null;
  const mode = typeof p.mode === "string" ? p.mode : null;

  const durationSignal = classifyInterviewDuration(durationMin);
  if (durationSignal !== "unspecified") await upsertSignal(employerId, "interview_pattern", "duration", durationSignal);
  const modeSignal = classifyInterviewMode(mode);
  if (modeSignal !== "unspecified") await upsertSignal(employerId, "interview_pattern", "mode", modeSignal);

  const scheduledAt = typeof p.scheduledAt === "string" ? p.scheduledAt : "";
  const ms = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  if (!Number.isFinite(ms)) return;
  const tz = await getEmployerTimezone(employerId);
  await upsertSignal(employerId, "interview_pattern", "time_of_day", classifyInterviewTimeOfDay(localHourInTz(ms, tz)));
  await upsertSignal(employerId, "interview_pattern", "day_of_week", weekdayAbbrevInTz(ms, tz));
}

/** The one entry point a caller needs — dispatches by the pending action's
 *  own `action` name, exactly as recorded on an ALREADY-EXECUTED row
 *  (lib/assistant-mutations.ts `approvePendingAction`, after
 *  `executePendingAction` reports `ok: true`). Every other action name is a
 *  silent no-op: this module only ever learns from message_candidates,
 *  send_offer, and schedule_interviews — never from a job post, a pipeline
 *  move, or anything else there's no defined signal for. Never throws. */
export async function observeApprovedAction(employerId: string, action: string, payload: Record<string, unknown>): Promise<void> {
  try {
    if (action === "message_candidates") {
      const message = typeof payload.message === "string" ? payload.message : "";
      if (message.trim().length >= 2) await observeMessageText(employerId, message);
    } else if (action === "send_offer") {
      // send_offer's `message` is an optional personal note alongside the
      // DocuSign letter (often empty) — a higher floor than
      // message_candidates avoids learning a "style" from a one-word note.
      const message = typeof payload.message === "string" ? payload.message : "";
      if (message.trim().length >= 10) await observeMessageText(employerId, message);
    } else if (action === "schedule_interviews") {
      await observeInterview(employerId, payload as { scheduledAt?: unknown; durationMin?: unknown; mode?: unknown });
    }
  } catch (e) {
    console.error("[assistant-employer-learning] observeApprovedAction threw", { employerId, action, error: e });
  }
}

/** This employer's OWN learned items, most recently updated first — always
 *  scoped, never a cross-employer read. Best-effort: an unreachable store
 *  resolves to []. */
export async function listLearnings(employerId: string): Promise<LearningRow[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c.from("assistant_employer_learning").select(COLS).eq("employer_id", employerId).order("updated_at", { ascending: false });
    if (error || !data) return [];
    return data.map(mapRow);
  } catch (e) {
    console.error("[assistant-employer-learning] listLearnings threw", e);
    return [];
  }
}

/** Delete one learned item outright — "What Taylor has learned about you"'s
 *  per-item delete. Scoped to (employerId, id) so one employer can never
 *  delete another's row. A later batch of new observations starts a fresh
 *  tally for the same (category, signal_key) from zero, exactly as if
 *  nothing had ever been learned — deleting is a full reset, not a
 *  dismissal flag. */
export async function deleteLearning(employerId: string, id: string): Promise<{ found: boolean }> {
  const c = db();
  if (!c || !employerId || !id) return { found: false };
  try {
    const existing = await c.from("assistant_employer_learning").select("id").eq("id", id).eq("employer_id", employerId).maybeSingle();
    if (!existing.data) return { found: false };
    await c.from("assistant_employer_learning").delete().eq("id", id).eq("employer_id", employerId);
    return { found: true };
  } catch (e) {
    console.error("[assistant-employer-learning] deleteLearning threw", { employerId, id, error: e });
    return { found: false };
  }
}

/** Correct a learned item to an explicit value — "What Taylor has learned
 *  about you"'s per-item correct. Pins `corrected: true` so this value is
 *  never silently overwritten by a later observation (see `upsertSignal`),
 *  and resets the tally to reflect the correction alone — the old,
 *  possibly-wrong tally that led to the mistaken value is no longer
 *  meaningful once the employer has stated the truth directly. Scoped to
 *  (employerId, id); a blank value is rejected rather than stored. */
export async function correctLearning(employerId: string, id: string, value: string): Promise<{ found: boolean }> {
  const v = value.trim();
  if (!v) return { found: false };
  const c = db();
  if (!c || !employerId || !id) return { found: false };
  try {
    const existing = await c.from("assistant_employer_learning").select(COLS).eq("id", id).eq("employer_id", employerId).maybeSingle();
    if (!existing.data) return { found: false };
    await c
      .from("assistant_employer_learning")
      .update({ signal_value: v, counts_json: { [v]: 1 }, sample_count: 1, corrected: true, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("employer_id", employerId);
    return { found: true };
  } catch (e) {
    console.error("[assistant-employer-learning] correctLearning threw", { employerId, id, error: e });
    return { found: false };
  }
}
