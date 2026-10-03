import type { Access } from "./plan";
import { getCounter, bumpCounter, monthPeriod } from "./usage-counter";

/** Pro tailoring variants: usage tracking + the Lifetime monthly cap. */
export const VARIANT_COUNTER_KIND = "tailor_variants";
/** Lifetime ($129 one-time) accounts get this many 3-variant generations per UTC calendar month. */
export const LIFETIME_VARIANT_MONTHLY_CAP = 30;

export const LIFETIME_CAP_MESSAGE = `You've used all ${LIFETIME_VARIANT_MONTHLY_CAP} AI tailoring variant sets included with Pro Lifetime this month. Your normal single tailoring is still unlimited. Switch to monthly Pro ($19/mo) for unlimited variants, or your allowance resets on the 1st.`;

/** Resolve whether this Pro account is Lifetime. Clerk metadata carries `lifetime` (set by the
 *  Legacy webhook); accounts that predate the flag are looked up once from Legacy and cached
 *  into Clerk. Any failure resolves to false (monthly = unlimited, fair-use rate limited). */
export async function isLifetimeAccount(access: Access, userId: string, email?: string | null): Promise<boolean> {
  if (access.isAdmin || access.plan !== "pro") return false;
  if (typeof access.lifetime === "boolean") return access.lifetime;
  const base = process.env.LEGACY_SITE_URL || "https://resumetailored.com";
  const secret = process.env.ENTITLEMENT_SYNC_SECRET;
  if (!email || !secret) return false;
  try {
    const res = await fetch(`${base}/api/entitlement?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { lifetime?: boolean };
    const lifetime = data.lifetime === true;
    try {
      const { clerkClient } = await import("@clerk/nextjs/server");
      const client = await clerkClient();
      await client.users.updateUserMetadata(userId, { publicMetadata: { lifetime } });
    } catch {
      /* non-fatal: resolved again next time */
    }
    return lifetime;
  } catch {
    console.error("[variants] could not resolve lifetime flag for", userId);
    return false;
  }
}

export interface VariantUsage {
  used: number;
  /** null = unlimited */
  limit: number | null;
}

export async function variantUsage(userId: string, lifetime: boolean): Promise<VariantUsage> {
  const used = (await getCounter(userId, VARIANT_COUNTER_KIND, monthPeriod())) ?? 0;
  return { used, limit: lifetime ? LIFETIME_VARIANT_MONTHLY_CAP : null };
}

/** Record one successful 3-variant generation for this month. */
export async function recordVariantGeneration(userId: string): Promise<number | null> {
  return bumpCounter(userId, VARIANT_COUNTER_KIND, monthPeriod(), 1);
}
