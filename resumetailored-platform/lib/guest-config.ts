/**
 * Guest free-tier configuration that must be readable from instrumentation.ts.
 *
 * Kept free of imports on purpose: instrumentation.ts is also compiled for the edge runtime,
 * where lib/guest.ts (node:crypto, node:net, supabase) cannot be bundled. This file only reads
 * process.env, so it can be imported from either.
 */

export const DEFAULT_DAILY_BUDGET_USD = 25;

/** The HMAC key behind every guest id. Throws when unset/short; see assertGuestConfig. */
export function guestSalt(): string {
  const salt = process.env.GUEST_QUOTA_SALT || "";
  if (salt.length < 16) {
    throw new Error(
      "GUEST_QUOTA_SALT must be set to a secret of at least 16 characters (e.g. `openssl rand -hex 32`). Guest free-tier quotas are keyed on it."
    );
  }
  return salt;
}

/** Called from instrumentation.ts at server start: refuse to boot without the salt rather
 *  than discover it on the first anonymous request (a missing salt would otherwise fall back
 *  to guessable ids). */
export function assertGuestConfig(): void {
  guestSalt();
}

export function guestBudgetUsd(): number {
  const n = Number(process.env.GUEST_DAILY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_BUDGET_USD;
}
