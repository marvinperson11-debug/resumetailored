/**
 * Application Tracker — pure core (Combined Build, Sections 1 & 2). No DB,
 * no network — Kanban stage shape, stage-dwell nudge timing, and the
 * honesty-rule field shape the clip extractor and the manual-add form both
 * produce. Mirrors the lib/career-hub.js / lib/resume-writeback.js pattern:
 * everything decidable without a database call lives here so it is directly
 * unit-testable.
 */

export const TRACKER_STAGES = ["Clipped", "Applied", "Interviewing", "Offer", "Rejected", "Withdrawn"] as const;
export type TrackerStage = (typeof TRACKER_STAGES)[number];

export function isTrackerStage(v: unknown): v is TrackerStage {
  return typeof v === "string" && (TRACKER_STAGES as readonly string[]).includes(v);
}

export const TRACKER_SOURCES = ["manual", "clip_url", "share_target", "our_job"] as const;
export type TrackerSource = (typeof TRACKER_SOURCES)[number];

// ── Stage-dwell nudges (Section 1) ──────────────────────────────────────────

/** Stages that ever produce a dwell nudge, and their default window in days.
 *  Every other stage (Clipped, Offer, Rejected, Withdrawn) never nudges —
 *  those are either not-yet-applied or already-resolved states. */
const DWELL_STAGES = ["Applied", "Interviewing"] as const;
type DwellStage = (typeof DWELL_STAGES)[number];
function isDwellStage(stage: TrackerStage): stage is DwellStage {
  return (DWELL_STAGES as readonly string[]).includes(stage);
}

const DEFAULT_DWELL_DAYS: Record<DwellStage, number> = { Applied: 14, Interviewing: 7 };

/** The dwell window for one stage, in days — env-overridable ONLY for tests
 *  (the live verification checklist shortens it rather than waiting two real
 *  weeks for a nudge to fire). `TRACKER_NUDGE_APPLIED_DAYS` /
 *  `TRACKER_NUDGE_INTERVIEWING_DAYS`; any non-positive/non-finite value
 *  falls back to the default. */
export function nudgeWindowDays(stage: DwellStage): number {
  const envKey = stage === "Applied" ? "TRACKER_NUDGE_APPLIED_DAYS" : "TRACKER_NUDGE_INTERVIEWING_DAYS";
  const v = Number(process.env[envKey]);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DWELL_DAYS[stage];
}

export interface NudgeCheckInput {
  stage: TrackerStage;
  /** When this application last had real activity in this stage — for
   *  Applied, that's just stageChangedAt; for Interviewing, the spec calls
   *  for "7d post-last-event", so the caller passes the most recent
   *  application_event's created_at (falling back to stageChangedAt when
   *  there is no later event yet). */
  referenceTime: string;
  nudgesOff: boolean;
}

export interface NudgeCheckResult {
  due: boolean;
  stage: TrackerStage;
  daysDwelling: number;
}

/** Decide whether a stage-dwell nudge is due right now, purely from the
 *  dwell window — this does NOT decide "once per window" on its own; the
 *  caller (lib/tracker-nudges.ts) tracks a fired/dismissed history against
 *  `referenceTime` so a dismissed nudge stays dismissed and a still-pending
 *  one keeps showing, which is a richer rule than this function alone could
 *  express. */
export function checkDwellNudge(input: NudgeCheckInput, now: number = Date.now()): NudgeCheckResult {
  const notDue: NudgeCheckResult = { due: false, stage: input.stage, daysDwelling: 0 };
  if (input.nudgesOff) return notDue;
  if (!isDwellStage(input.stage)) return notDue;
  const ref = new Date(input.referenceTime).getTime();
  if (!Number.isFinite(ref)) return notDue;
  const daysDwelling = Math.floor((now - ref) / 86_400_000);
  if (daysDwelling < nudgeWindowDays(input.stage)) return { due: false, stage: input.stage, daysDwelling };
  return { due: true, stage: input.stage, daysDwelling };
}

/** Nudge copy — NEVER invents employer behavior. "No response yet" is
 *  derived only from stage dwell, never phrased as if we know anything about
 *  what the employer has or hasn't done (per the spec's honesty rule). */
export function buildNudgeMessage(stage: TrackerStage, company: string, jobTitle: string, daysDwelling: number): string {
  const who = company ? `your ${jobTitle || "application"} at ${company}` : jobTitle || "this application";
  if (stage === "Applied") {
    return `It's been ${daysDwelling} days since you applied to ${who} — no response yet. Want to follow up?`;
  }
  return `It's been ${daysDwelling} days since your last update on ${who} — no response yet. Want to follow up?`;
}

// ── Honesty-rule field shape (Section 2) ────────────────────────────────────

/** Every field the clip extractor can fill. A field that could not be
 *  extracted is `null` (or `""` for strings) — NEVER a guess. The caller
 *  (the UI) renders a "fill this in" affordance for any empty field; this
 *  module never invents company, salary, dates, or requirements. */
export interface ClipFields {
  jobTitle: string;
  company: string;
  location: string;
  description: string;
  salaryMin: number | null;
  salaryMax: number | null;
}

export const EMPTY_CLIP_FIELDS: ClipFields = {
  jobTitle: "",
  company: "",
  location: "",
  description: "",
  salaryMin: null,
  salaryMax: null,
};

/** Which of a ClipFields object's fields are empty (and so should render the
 *  "fill this in" affordance) — pure, used identically by the API response
 *  and any later re-check. */
export function emptyClipFieldNames(fields: ClipFields): (keyof ClipFields)[] {
  return (Object.keys(fields) as (keyof ClipFields)[]).filter((k) => {
    const v = fields[k];
    return v === null || v === "";
  });
}

/** "Captured <date>" label for an externally-clipped card — external
 *  postings rot, so every clipped (non-manual, non-our_job) card shows when
 *  its facts were last verified. Pure formatting, locale-agnostic (ISO date
 *  only); the UI layer applies locale formatting on top if it wants to. */
export function capturedLabel(lastVerifiedAt: string | null): string | null {
  if (!lastVerifiedAt) return null;
  const d = new Date(lastVerifiedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ── Stage transitions ────────────────────────────────────────────────────────

/** Pure validation: is this a real stage move (not a no-op), and is the
 *  target a real stage? The route layer is responsible for persistence and
 *  for logging the application_events row this implies. */
export function validateStageMove(fromStage: TrackerStage, toStage: unknown): { ok: true; toStage: TrackerStage } | { ok: false; reason: string } {
  if (!isTrackerStage(toStage)) return { ok: false, reason: `stage must be one of: ${TRACKER_STAGES.join(", ")}.` };
  if (toStage === fromStage) return { ok: false, reason: "already in that stage." };
  return { ok: true, toStage };
}
