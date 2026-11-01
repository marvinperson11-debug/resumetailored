/**
 * SMS segment metering: monthly per-org caps by tier, pooled across team
 * seats at every tier (the counter is keyed on `employerId`, which is
 * already the one shared workspace id every seat resolves to — see
 * lib/employer-auth.ts), plus the overage graduation step. Counter storage
 * reuses `usage_counters` (migration 0043, already applied) exactly like
 * lib/video-quota.ts does — no new table.
 *
 * Soft cap, never a hard block: a send that would exceed the effective cap
 * is not refused, it's QUEUED (lib/sms-send.ts) for the rest of the cycle.
 * Purchasing an overage pack raises the effective cap immediately — the
 * caller (the overage route) is responsible for then flushing the queue
 * (lib/sms-queue-flush.ts), so "restores sending immediately" is true in
 * practice, not just in the cap math.
 */
import type { EmployerTier } from "./employer-tier";
import { getCounter, bumpCounter, monthPeriod } from "./usage-counter";

export const SMS_SEGMENTS_COUNTER_KIND = "sms_segments";
export const SMS_OVERAGE_COUNTER_KIND = "sms_overage_segments";

/** Monthly segment caps by tier. Free has no SMS access at all (gated
 *  earlier, in lib/employer-plan.ts `canUseSms`) so it has no entry here
 *  that matters — 0 is defensive, not reachable in practice. */
export const SMS_MONTHLY_SEGMENTS: Record<EmployerTier, number> = {
  free: 0,
  portal: 250,
  scale: 1000,
  corporate: 5000,
};

export const OVERAGE_PACK_SEGMENTS = 500;
export const OVERAGE_PACK_PRICE_CENTS = 1000; // $10 per additional 500 segments

export interface SmsCapStatus {
  tier: EmployerTier;
  period: string;
  baseLimit: number;
  overagePurchased: number;
  effectiveLimit: number;
  used: number;
  remaining: number;
  /** True once `used` reaches (or passes) the effective limit — the UI's
   *  warn-and-offer-overage banner condition. */
  atCap: boolean;
}

export function capStatusFrom(tier: EmployerTier, used: number, overagePurchased: number, period = monthPeriod()): SmsCapStatus {
  const baseLimit = SMS_MONTHLY_SEGMENTS[tier];
  const effectiveLimit = baseLimit + overagePurchased;
  return {
    tier,
    period,
    baseLimit,
    overagePurchased,
    effectiveLimit,
    used,
    remaining: Math.max(0, effectiveLimit - used),
    atCap: used >= effectiveLimit,
  };
}

/** Current cap status for this org, reading both counters. An unavailable
 *  store reads as 0 used (fail open on the READ side only — the WRITE side,
 *  `reserveSegments`, fails closed by refusing to consume when it can't
 *  confirm the counter moved). */
export async function getSmsCapStatus(employerId: string, tier: EmployerTier, now = new Date()): Promise<SmsCapStatus> {
  const period = monthPeriod(now);
  const [used, overage] = await Promise.all([getCounter(employerId, SMS_SEGMENTS_COUNTER_KIND, period), getCounter(employerId, SMS_OVERAGE_COUNTER_KIND, period)]);
  return capStatusFrom(tier, used ?? 0, overage ?? 0, period);
}

export interface ReserveResult {
  /** True: the segments were consumed against the cap — send it. False:
   *  sending now would exceed the effective cap — queue it instead, do NOT
   *  consume anything (so a later cap increase sees the true unconsumed
   *  total, not a double-count). */
  reserved: boolean;
  status: SmsCapStatus;
}

/** Atomically reserve `segments` against this cycle's cap. Reads the
 *  current totals, and only bumps the real counter when the reservation
 *  fits — there is a narrow race window between the read and the bump
 *  (two sends landing at the same instant could both read "fits" and both
 *  bump), which is the same trade-off lib/video-quota.ts already accepts
 *  for its own monthly cap; a strict RPC-level compare-and-set was judged
 *  not worth a new stored procedure for a SOFT cap that only ever queues,
 *  never blocks. */
export async function reserveSegments(employerId: string, tier: EmployerTier, segments: number, now = new Date()): Promise<ReserveResult> {
  const status = await getSmsCapStatus(employerId, tier, now);
  if (status.used + segments > status.effectiveLimit) {
    return { reserved: false, status };
  }
  const newUsed = await bumpCounter(employerId, SMS_SEGMENTS_COUNTER_KIND, status.period, segments);
  if (newUsed === null) {
    console.error("[sms-quota] reserveSegments: counter store unavailable, refusing to consume", employerId);
    return { reserved: false, status };
  }
  return { reserved: true, status: { ...status, used: newUsed, remaining: Math.max(0, status.effectiveLimit - newUsed), atCap: newUsed >= status.effectiveLimit } };
}

/** Purchase one overage pack (+500 segments) for the current cycle. Returns
 *  the new cap status, or null if the counter store is unavailable. */
export async function purchaseOveragePack(employerId: string, tier: EmployerTier, now = new Date()): Promise<SmsCapStatus | null> {
  const period = monthPeriod(now);
  const newOverage = await bumpCounter(employerId, SMS_OVERAGE_COUNTER_KIND, period, OVERAGE_PACK_SEGMENTS);
  if (newOverage === null) return null;
  const used = (await getCounter(employerId, SMS_SEGMENTS_COUNTER_KIND, period)) ?? 0;
  return capStatusFrom(tier, used, newOverage, period);
}
