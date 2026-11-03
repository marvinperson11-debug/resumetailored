/**
 * Server-to-server proxy to the legacy site's individual-Pro subscription
 * endpoints — the app has no Stripe key and no subscription id of its own
 * (see lib/plan.ts's getAccess() header comment: Stripe lives on the old
 * site). Shared by the settings page's server-rendered status and the
 * cancel API route, so both talk to the legacy app the same way.
 */

export type SubscriptionStatus = {
  pro: boolean;
  lifetime?: boolean;
  cancelAtPeriodEnd?: boolean;
  /** Unix seconds, as returned by Stripe. */
  currentPeriodEnd?: number;
};

export type CancelResult =
  | { ok: true; cancelAtPeriodEnd: boolean; currentPeriodEnd?: number }
  | { ok: false; status: number; error?: string; message?: string };

function legacyBase() {
  return process.env.LEGACY_SITE_URL || "https://resumetailored.com";
}

/** Read-only: does this email have a live Stripe subscription, and is it set to cancel? Returns null on any failure (fails open to "don't show cancellation UI", never blocks the settings page). */
export async function getSubscriptionStatus(email: string): Promise<SubscriptionStatus | null> {
  const secret = process.env.ENTITLEMENT_SYNC_SECRET;
  if (!secret) return null;
  try {
    const res = await fetch(`${legacyBase()}/api/app-subscription-status?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    return (await res.json()) as SubscriptionStatus;
  } catch {
    return null;
  }
}

/** Sets cancel_at_period_end on the email's active Pro subscription. Never issues a refund. */
export async function cancelSubscription(email: string): Promise<CancelResult> {
  const secret = process.env.ENTITLEMENT_SYNC_SECRET;
  if (!secret) return { ok: false, status: 501, error: "not_configured" };
  try {
    const res = await fetch(`${legacyBase()}/api/app-cancel-subscription`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { cancelAtPeriodEnd?: boolean; currentPeriodEnd?: number; error?: string; message?: string };
    if (!res.ok) return { ok: false, status: res.status, error: data.error, message: data.message };
    return { ok: true, cancelAtPeriodEnd: !!data.cancelAtPeriodEnd, currentPeriodEnd: data.currentPeriodEnd };
  } catch {
    return { ok: false, status: 502, error: "cancel_unavailable" };
  }
}
