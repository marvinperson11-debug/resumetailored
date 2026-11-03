import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getAccess } from "@/lib/plan";
import { cancelSubscription } from "@/lib/subscription";

/**
 * Self-serve "Cancel subscription" for a candidate Pro user. Mirrors
 * app/api/create-checkout-session/route.ts: the email comes from the Clerk
 * session (never the request body), and Stripe itself stays on the old site
 * — this just proxies to its shared-secret /api/app-cancel-subscription.
 *
 * Sets cancel_at_period_end, not an immediate cancel: the caller keeps Pro
 * access through the current period. No refund is issued or requested here.
 */
export async function POST() {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  if (!email) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  // Only an individual Pro subscriber has a Stripe subscription of their own
  // to cancel — not an employer's employee (Pro via the employer) and not
  // the admin bypass (no real subscription). Pro/Free keeps coming from the
  // existing Clerk-metadata path; this never re-derives it independently.
  const access = await getAccess();
  if (access.plan !== "pro" || access.isAdmin) {
    return NextResponse.json({ error: "not_pro", message: "This account has no Pro subscription to cancel." }, { status: 403 });
  }

  const result = await cancelSubscription(email);
  if (!result.ok) {
    const status = result.status >= 400 && result.status < 600 ? result.status : 502;
    return NextResponse.json({ error: result.error || "cancel_failed", message: result.message }, { status });
  }
  return NextResponse.json({ cancelAtPeriodEnd: result.cancelAtPeriodEnd, currentPeriodEnd: result.currentPeriodEnd });
}
