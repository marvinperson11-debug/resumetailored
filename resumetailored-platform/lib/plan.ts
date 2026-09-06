import { currentUser, clerkClient } from "@clerk/nextjs/server";

export type Plan = "pro" | "free";

/**
 * The signed-in user's plan, read from Clerk `publicMetadata.plan`.
 *
 * The Stripe webhook on the old site (resumetailored.com) sets
 * `publicMetadata.plan = "pro"` on the buyer's Clerk account after a successful
 * payment. But a pay-first buyer can complete checkout BEFORE their Clerk
 * account exists, so the webhook finds no user to flag. To cover that gap, when
 * the flag is unset we back it off the old site's subscriber DB (the source of
 * truth) via the shared-secret `/api/entitlement` endpoint, and — if Pro —
 * write the flag onto Clerk so every later read is instant.
 *
 * Fully defensive: any failure resolves to "free" (the safe default) and never
 * throws, so a dashboard render is never blocked by this check.
 */
export async function getPlan(): Promise<Plan> {
  try {
    const user = await currentUser();
    if (!user) return "free";

    const meta = (user.publicMetadata ?? {}) as { plan?: string };
    if (meta.plan === "pro") return "pro";
    if (meta.plan === "free") return "free";

    // Flag unset → attempt a one-time backfill from the old subscriber DB.
    const email = user.emailAddresses?.[0]?.emailAddress;
    const base = process.env.LEGACY_SITE_URL || "https://resumetailored.com";
    const secret = process.env.ENTITLEMENT_SYNC_SECRET;
    if (!email || !secret) return "free";

    const res = await fetch(
      `${base}/api/entitlement?email=${encodeURIComponent(email)}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      }
    );
    if (!res.ok) return "free";
    const data = (await res.json()) as { pro?: boolean };
    if (!data.pro) return "free";

    // Persist so the next read skips the network round-trip.
    try {
      const client = await clerkClient();
      await client.users.updateUserMetadata(user.id, {
        publicMetadata: { plan: "pro", subscribedAt: new Date().toISOString() },
      });
    } catch {
      // Non-fatal: the user is still Pro this request; we retry the write next time.
    }
    return "pro";
  } catch {
    return "free";
  }
}

export async function isPro(): Promise<boolean> {
  return (await getPlan()) === "pro";
}
