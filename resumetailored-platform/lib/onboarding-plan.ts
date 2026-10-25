import { wallClockToUtc, formatEmployerTime } from "./employer-time";

/**
 * Onboarding chase — the plan content itself (Prompt 6, Section 3). Pure and
 * deterministic (no LLM call, no DB): a day-one checklist, a first-week
 * schedule, a paperwork/e-sign list with real dates, and the EXACT reminder
 * message texts that will later send byte-identical to what's approved here.
 *
 * Deliberately template-based rather than LLM-generated (a judgment call —
 * see the Prompt 6 report): "approve what you see" means the employer must
 * be able to trust the dates and the exact wording never drift from what the
 * card showed, and a template sidesteps needing a second anti-fabrication
 * guard (on top of interview-summaries.ts's) for free-text date math an LLM
 * could get wrong. Every date is computed here, in code, from the offer's
 * own `startDate` and the employer's own timezone
 * (lib/employer-time.ts) — never left to a model.
 */

export interface OnboardingScheduleItem {
  dayOffset: number;
  label: string;
  dateDisplay: string;
}

export interface OnboardingPaperworkItem {
  item: string;
  dueDateDisplay: string;
}

export interface OnboardingReminder {
  /** Absolute UTC instant this reminder is queued to send at. */
  sendAt: string;
  /** Human label for the card, e.g. "3 days before start". */
  whenLabel: string;
  /** The EXACT text that will be sent — approving the card approves this
   *  literal string, byte for byte. */
  body: string;
}

export interface OnboardingPlanContent {
  /** YYYY-MM-DD calendar date — the field lib/employees-store.ts
   *  `createEmployee`'s `startDate` input expects, so the optional
   *  Employees-hub handoff (lib/assistant-mutations.ts
   *  `executeOnboardingPlan`) never has to re-derive or re-parse a date out
   *  of the human-readable display string below. */
  startDateIso: string;
  startDateDisplay: string;
  dayOneChecklist: string[];
  firstWeekSchedule: OnboardingScheduleItem[];
  paperwork: OnboardingPaperworkItem[];
  reminders: OnboardingReminder[];
}

export interface BuildOnboardingPlanInput {
  jobTitle: string;
  candidateName: string;
  companyName: string;
  /** The offer's own `startDate` field — free text from the employer, not
   *  guaranteed to parse. */
  startDateRaw: string;
  /** Fallback anchor when `startDateRaw` doesn't parse (the day the offer
   *  was signed) — never left blank, so a plan can always be built. */
  fallbackAnchorIso: string;
  employerTz: string;
}

const REMINDER_SEND_HOUR = "09:00:00";

function ymd(d: Date): { y: number; m: number; d: number } {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** Day `offset` relative to the anchor calendar date, as a "YYYY-MM-DD"
 *  wall-clock date string (UTC-based calendar arithmetic — the offer's
 *  start date is a CALENDAR day, not a specific instant, so this never
 *  needs DST-aware day math, only `formatEmployerTime`/`wallClockToUtc` do). */
function dateAt(anchor: Date, offset: number): string {
  const t = new Date(anchor.getTime() + offset * 24 * 60 * 60 * 1000);
  const { y, m, d } = ymd(t);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The real UTC instant + a employer-local display string for a reminder/
 *  schedule item at `offset` days from the anchor, at REMINDER_SEND_HOUR
 *  local time. */
function instantAt(anchor: Date, offset: number, tz: string): { iso: string; display: string } {
  const iso = wallClockToUtc(`${dateAt(anchor, offset)}T${REMINDER_SEND_HOUR}`, tz);
  return { iso, display: formatEmployerTime(iso, tz) };
}

/** Resolve the plan's anchor date: the offer's own startDate if parseable,
 *  else the fallback (when the offer was signed) — a plan is never refused
 *  just because `startDate` was entered as loose free text. */
export function resolveOnboardingAnchor(startDateRaw: string, fallbackAnchorIso: string): Date {
  const parsed = new Date(startDateRaw);
  if (Number.isFinite(parsed.getTime())) return parsed;
  const fallback = new Date(fallbackAnchorIso);
  return Number.isFinite(fallback.getTime()) ? fallback : new Date();
}

export function buildOnboardingPlan(input: BuildOnboardingPlanInput): OnboardingPlanContent {
  const anchor = resolveOnboardingAnchor(input.startDateRaw, input.fallbackAnchorIso);
  const startDateIso = dateAt(anchor, 0);
  const startDateDisplay = formatEmployerTime(instantAt(anchor, 0, input.employerTz).iso, input.employerTz);
  const firstName = (input.candidateName || "there").split(" ")[0] || input.candidateName || "there";
  const company = input.companyName || "the team";
  const role = input.jobTitle || "the role";

  const dayOneChecklist = [
    `Send ${input.candidateName || "the new hire"} their final offer paperwork and any tax/ID forms to complete before day one.`,
    `Set up their email, accounts, and any equipment they'll need for ${role}.`,
    `Add them to the team calendar and schedule their first-week meetings.`,
    `Line up a manager or buddy to greet them and walk through day one.`,
  ];

  const firstWeekSchedule: OnboardingScheduleItem[] = [
    { dayOffset: 0, label: "Day 1 — welcome, orientation, and paperwork" },
    { dayOffset: 1, label: "Day 2 — role-specific training begins" },
    { dayOffset: 2, label: "Day 3 — shadow a teammate / hands-on practice" },
    { dayOffset: 4, label: "Day 5 — first check-in with their manager" },
  ].map((s) => ({ ...s, dateDisplay: instantAt(anchor, s.dayOffset, input.employerTz).display }));

  const paperwork: OnboardingPaperworkItem[] = [
    { item: "Signed offer letter on file", dayOffset: -3 },
    { item: "Tax withholding + I-9/eligibility forms", dayOffset: 0 },
    { item: "Signed employee handbook acknowledgment", dayOffset: 2 },
  ].map(({ item, dayOffset }) => ({ item, dueDateDisplay: instantAt(anchor, dayOffset, input.employerTz).display }));

  const reminders: OnboardingReminder[] = [
    {
      ...instantAt(anchor, -3, input.employerTz),
      whenLabel: "3 days before start",
      body: `Hi ${firstName}, we're excited to have you join ${company} as ${role} on ${startDateDisplay}! Reply here anytime if you have questions before your first day.`,
    },
    {
      ...instantAt(anchor, 0, input.employerTz),
      whenLabel: "morning of start",
      body: `Good morning ${firstName}! Today's the day — welcome to ${company}. We can't wait to get started with you.`,
    },
    {
      ...instantAt(anchor, 4, input.employerTz),
      whenLabel: "end of first week",
      body: `Hi ${firstName}, hope your first week at ${company} went well! Let us know if there's anything you need as you settle into ${role}.`,
    },
  ].map(({ iso, whenLabel, body }) => ({ sendAt: iso, whenLabel, body }));

  return { startDateIso, startDateDisplay, dayOneChecklist, firstWeekSchedule, paperwork, reminders };
}
