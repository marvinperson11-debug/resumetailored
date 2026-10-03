/**
 * Display-only classification of a usage meter. It never counts anything: callers pass
 * the SAME `used` / `limit` the server enforces with (API responses or server-computed
 * props), so what the meter shows can't drift from what is enforced.
 */
export type QuotaState = "ok" | "low" | "limit";

/** Warn from 80% of the cap. */
export const LOW_RATIO = 0.8;
/** Tiny caps (≤ 5, e.g. 3 decodes/day) never reach 80% before hitting the wall, so the
 *  last remaining use also counts as "running low" — but only once something was used. */
export const SMALL_CAP_MAX = 5;

export function quotaState(used: number, limit: number | null | undefined): QuotaState {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return "ok";
  if (used >= limit) return "limit";
  if (used > 0 && (used / limit >= LOW_RATIO || (limit <= SMALL_CAP_MAX && limit - used === 1))) return "low";
  return "ok";
}

/** How many are left (never negative). */
export function quotaLeft(used: number, limit: number): number {
  return Math.max(0, limit - used);
}
