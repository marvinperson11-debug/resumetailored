/**
 * FCRA two-step adverse-action state machine: pre-adverse notice (+ report
 * copy + Summary of Rights) -> a configurable wait (default 5 BUSINESS days)
 * -> the adverse notice itself. Pure functions — no DB, no network; the
 * store (lib/bgc-store.ts) persists the stage transitions this module
 * decides are legal.
 *
 * "Cannot skip the waiting period" is enforced here, not just in the UI:
 * `canSendAdverseNotice` is the single source of truth the API route checks
 * before writing an `adverse_notice_sent` row, so there is no second code
 * path that could race past it.
 */

export type AdverseActionStage = "none" | "pre_adverse_sent" | "waiting" | "adverse_notice_sent" | "canceled";

export const DEFAULT_WAIT_BUSINESS_DAYS = 5;

/** Add `n` business days (Mon-Fri; no federal-holiday calendar — out of
 *  scope for this build) to `from`, at UTC midnight-safe granularity. */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

export interface AdverseActionState {
  stage: AdverseActionStage;
  preAdverseSentAt: string | null; // ISO
  waitUntil: string | null; // ISO — the earliest moment the notice may be sent
  adverseNoticeSentAt: string | null; // ISO
}

/** The state after sending the pre-adverse notice right now. */
export function startPreAdverse(now: Date = new Date(), waitBusinessDays = DEFAULT_WAIT_BUSINESS_DAYS): AdverseActionState {
  const waitUntil = addBusinessDays(now, waitBusinessDays);
  return { stage: "waiting", preAdverseSentAt: now.toISOString(), waitUntil: waitUntil.toISOString(), adverseNoticeSentAt: null };
}

/** Whether the adverse notice may be sent right now. False before a
 *  pre-adverse notice exists, false while still inside the wait window,
 *  false once already sent (or canceled) — each a distinct reason the
 *  caller can surface. */
export function canSendAdverseNotice(state: AdverseActionState, now: Date = new Date()): { allowed: boolean; reason?: "no_pre_adverse" | "still_waiting" | "already_sent" | "canceled" } {
  if (state.stage === "canceled") return { allowed: false, reason: "canceled" };
  if (state.stage === "adverse_notice_sent") return { allowed: false, reason: "already_sent" };
  if (state.stage === "none" || !state.waitUntil) return { allowed: false, reason: "no_pre_adverse" };
  if (now.getTime() < new Date(state.waitUntil).getTime()) return { allowed: false, reason: "still_waiting" };
  return { allowed: true };
}

export function completeAdverseNotice(state: AdverseActionState, now: Date = new Date()): AdverseActionState {
  return { ...state, stage: "adverse_notice_sent", adverseNoticeSentAt: now.toISOString() };
}
