import { getCounter, bumpCounter, dayPeriod, hourPeriod } from "./usage-counter";
import { logAction } from "./assistant-audit";

/**
 * Free-tier Assistant usage model (Taylor Combined Build v5, Section E.5 —
 * Amendment 1: NO monthly cap of any kind). This module is the ONLY place a
 * Free employer's assistant usage is throttled. There is deliberately no
 * monthly counter, no "80% used" warning, and no "at your monthly limit"
 * message anywhere in this file or its callers — `test:assistant` greps the
 * built surface for exactly that absence.
 *
 * Three independent checks, in order of how often a real one-hire employer
 * could ever hit them:
 *   1. Hourly rate limit (ASSISTANT_FREE_HOURLY_LIMIT, default 60) — anti-
 *      hammering. A friendly throttle with retry-after semantics; never
 *      tier/graduation copy, because this has nothing to do with the plan.
 *   2. Daily rate limit (ASSISTANT_FREE_DAILY_LIMIT, default 400) — same
 *      shape, same reasoning, a longer window.
 *   3. Fair-use ceiling (ASSISTANT_FREE_CEILING_TURNS, default 2000/day) —
 *      set high enough that no real one-hire employer ever reaches it. At the
 *      ceiling the turn is NOT blocked (never a hard wall): the caller is
 *      told to soft-throttle (slow the response to a crawl) and shown an
 *      honest "our team will take a look" message, and one `usage_flag`
 *      audit row is written per turn past the ceiling so the pattern is
 *      visible for review. This is shaped like abuse detection, not like a
 *      plan pitch, on purpose.
 *
 * Voice turns cost ASSISTANT_VOICE_TURN_WEIGHT times (default 2) as much
 * against all three of the above — a spoken reply is more expensive to
 * generate than a text one, so it should count for more.
 */

const COUNTER_KIND = "assistant_turn_free";

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

export function freeHourlyLimit(): number {
  return envInt("ASSISTANT_FREE_HOURLY_LIMIT", 60);
}

export function freeDailyLimit(): number {
  return envInt("ASSISTANT_FREE_DAILY_LIMIT", 400);
}

export function freeCeilingTurns(): number {
  return envInt("ASSISTANT_FREE_CEILING_TURNS", 2000);
}

export function voiceTurnWeight(): number {
  return envInt("ASSISTANT_VOICE_TURN_WEIGHT", 2);
}

/** How much one turn counts against every limit/ceiling below. */
export function turnWeight(isVoice: boolean): number {
  return isVoice ? voiceTurnWeight() : 1;
}

export const FREE_THROTTLE_MESSAGE = "Give me a minute — you're moving fast. Try again shortly.";
export const FREE_CEILING_MESSAGE = "You've hit an unusually high usage level — our team will take a look. Thanks for your patience.";

/** Seconds remaining until the current UTC hour/day rolls over — the
 *  retry-after value for a throttled turn. */
function secondsUntilNextHour(now: number): number {
  const d = new Date(now);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1, 0, 0, 0));
  return Math.max(1, Math.round((next.getTime() - now) / 1000));
}
function secondsUntilNextDay(now: number): number {
  const d = new Date(now);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
  return Math.max(1, Math.round((next.getTime() - now) / 1000));
}

export type FreeUsageCheck =
  | { blocked: false }
  | { blocked: true; reason: "hourly" | "daily"; message: string; retryAfterSeconds: number }
  | { blocked: "ceiling"; message: string };

/** Pure given its two counter reads: decide whether this turn may proceed,
 *  should be throttled (hourly/daily), or has crossed the fair-use ceiling
 *  (soft-throttle, never blocked). Exported separately from the I/O wrapper
 *  below so the three-way decision itself is directly unit-testable with no
 *  database involved. */
export function evaluateFreeUsage(hourUsed: number, dayUsed: number, weight: number, now = Date.now()): FreeUsageCheck {
  const ceiling = freeCeilingTurns();
  if (dayUsed + weight > ceiling) {
    return { blocked: "ceiling", message: FREE_CEILING_MESSAGE };
  }
  const hourly = freeHourlyLimit();
  if (hourUsed + weight > hourly) {
    return { blocked: true, reason: "hourly", message: FREE_THROTTLE_MESSAGE, retryAfterSeconds: secondsUntilNextHour(now) };
  }
  const daily = freeDailyLimit();
  if (dayUsed + weight > daily) {
    return { blocked: true, reason: "daily", message: FREE_THROTTLE_MESSAGE, retryAfterSeconds: secondsUntilNextDay(now) };
  }
  return { blocked: false };
}

/** I/O wrapper: reads this employer's current hour/day counters and applies
 *  `evaluateFreeUsage`. A ceiling hit also writes the one audit row
 *  (best-effort; never throws, never blocks the turn on its own failure). */
export async function checkFreeUsage(employerId: string, isVoice: boolean, now = Date.now()): Promise<FreeUsageCheck> {
  const weight = turnWeight(isVoice);
  const [hourUsed, dayUsed] = await Promise.all([
    getCounter(employerId, COUNTER_KIND, hourPeriod(new Date(now))),
    getCounter(employerId, COUNTER_KIND, dayPeriod(new Date(now))),
  ]);
  const result = evaluateFreeUsage(hourUsed ?? 0, dayUsed ?? 0, weight, now);
  if (result.blocked === "ceiling") {
    await logAction({
      employerId,
      actorUserId: employerId,
      action: "usage_flag",
      targetType: null,
      targetId: null,
      payload: { hourUsed: hourUsed ?? 0, dayUsed: dayUsed ?? 0, weight, ceiling: freeCeilingTurns(), window: "day" },
      status: "executed",
    }).catch(() => {});
  }
  return result;
}

/** Record one turn against both the hourly and daily counters, weighted for
 *  voice. Call after a turn actually ran (including a soft-throttled ceiling
 *  turn — it still happened) — never after a turn that was blocked outright. */
export async function recordFreeUsage(employerId: string, isVoice: boolean, now = Date.now()): Promise<void> {
  const weight = turnWeight(isVoice);
  await Promise.all([
    bumpCounter(employerId, COUNTER_KIND, hourPeriod(new Date(now)), weight),
    bumpCounter(employerId, COUNTER_KIND, dayPeriod(new Date(now)), weight),
  ]);
}

export interface FreeUsageSnapshot {
  hour: { used: number; limit: number };
  day: { used: number; limit: number };
  ceiling: number;
}

/** Transparency-only numbers for the assistant panel's usage meter — no
 *  warning strings, no cutoff language; the caller renders plain numbers. */
export async function getFreeUsageSnapshot(employerId: string, now = Date.now()): Promise<FreeUsageSnapshot> {
  const [hourUsed, dayUsed] = await Promise.all([
    getCounter(employerId, COUNTER_KIND, hourPeriod(new Date(now))),
    getCounter(employerId, COUNTER_KIND, dayPeriod(new Date(now))),
  ]);
  return {
    hour: { used: hourUsed ?? 0, limit: freeHourlyLimit() },
    day: { used: dayUsed ?? 0, limit: freeDailyLimit() },
    ceiling: freeCeilingTurns(),
  };
}

/** Artificial slowdown for a ceiling-crossing turn ("soft throttle to a
 *  crawl") — the turn still completes, it just takes longer. A separate,
 *  named function (rather than an inline setTimeout at the call site) so a
 *  test can stub it to run instantly. */
export async function crawlDelay(): Promise<void> {
  const ms = envInt("ASSISTANT_FREE_CEILING_DELAY_MS", 4000);
  await new Promise((resolve) => setTimeout(resolve, ms));
}
