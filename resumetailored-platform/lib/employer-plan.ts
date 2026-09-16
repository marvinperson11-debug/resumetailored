/**
 * Employer plan / tier limits.
 *
 * The employer plan is one role (`plan: "employer"`) with a free-form `tier`
 * string on Clerk `publicMetadata` (see lib/plan.ts). This module maps that tier
 * to feature quotas. Today it governs DocuSign offer-letter sends, which are
 * capped per calendar month, across ALL employers:
 *
 *   Free       →  3 sends / month
 *   Portal     → 10 sends / month
 *   Scale      → 50 sends / month
 *   Corporate  → unlimited
 *
 * An employer with no tier set (or an unrecognized tier) falls back to Free, the
 * safe floor. The admin bypasses the cap entirely (treated as unlimited).
 */
import type { Access } from "./plan";

export type EmployerTier = "free" | "portal" | "scale" | "corporate";

/** Monthly DocuSign send limits by tier. `Infinity` means unlimited. */
export const DOCUSIGN_MONTHLY_SENDS: Record<EmployerTier, number> = {
  free: 3,
  portal: 10,
  scale: 50,
  corporate: Infinity,
};

/** Normalize a free-form tier string to a known tier, defaulting to "free". */
export function normalizeTier(tier: string | null | undefined): EmployerTier {
  const t = (tier || "").trim().toLowerCase();
  if (t === "portal" || t === "scale" || t === "corporate") return t;
  return "free";
}

/** Human label for a tier (for UI + upgrade copy). */
export function tierLabel(tier: EmployerTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** The monthly DocuSign send limit for a given access context. Admin ⇒ unlimited. */
export function docusignMonthlyLimit(access: Access): number {
  if (access.isAdmin) return Infinity;
  return DOCUSIGN_MONTHLY_SENDS[normalizeTier(access.tier)];
}

// ── Video interviews (Daily.co) ───────────────────────────────────────────────
/** Monthly video-interview limits by tier. `Infinity` = unlimited, 0 = blocked. */
export const VIDEO_MONTHLY: Record<EmployerTier, number> = {
  free: 0,
  portal: 10,
  scale: 50,
  corporate: Infinity,
};

/** Recording + transcription available from Portal up. */
export function canRecordInterviews(access: Access): boolean {
  if (access.isAdmin) return true;
  return normalizeTier(access.tier) !== "free";
}

/** AI interview summaries available from Scale up. */
export function canInterviewAiSummary(access: Access): boolean {
  if (access.isAdmin) return true;
  const t = normalizeTier(access.tier);
  return t === "scale" || t === "corporate";
}

/** The monthly video-interview limit for a given access context. */
export function videoMonthlyLimit(access: Access): number {
  if (access.isAdmin) return Infinity;
  return VIDEO_MONTHLY[normalizeTier(access.tier)];
}

/**
 * Whether an employer's tier includes AI interview summaries — resolved by
 * userId (Clerk publicMetadata.tier), for server contexts without a session
 * (the Daily webhook). Best-effort: any failure resolves to false. The admin
 * account always qualifies.
 */
export async function canUseAiSummaryForTier(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const { isAdminId } = await import("./admin");
    if (isAdminId(userId)) return true;
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const tier = normalizeTier((user?.publicMetadata as { tier?: string })?.tier);
    return tier === "scale" || tier === "corporate";
  } catch {
    return false;
  }
}

export interface VideoAllowance {
  allowed: boolean;
  limit: number; // Infinity = unlimited, 0 = not on this tier
  used: number;
  remaining: number;
  tier: EmployerTier;
  canRecord: boolean;
  canSummary: boolean;
  message: string;
}

/** Decide whether one more video interview is allowed this calendar month. */
export function checkVideoAllowance(access: Access, used: number): VideoAllowance {
  const tier = access.isAdmin ? "corporate" : normalizeTier(access.tier);
  const limit = videoMonthlyLimit(access);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
  const allowed = limit === Infinity ? true : remaining > 0;
  let message = "";
  if (!allowed) {
    message =
      limit === 0
        ? "Video interviews are a Pro feature. Upgrade to Portal to host video interviews with auto-generated join links."
        : `You've used all ${limit} video interviews included in your ${tierLabel(tier)} plan this month. Upgrade for more, or wait until next month.`;
  }
  return {
    allowed,
    limit,
    used,
    remaining,
    tier,
    canRecord: canRecordInterviews(access),
    canSummary: canInterviewAiSummary(access),
    message,
  };
}

export interface SendAllowance {
  allowed: boolean;
  limit: number; // Infinity = unlimited
  used: number;
  remaining: number; // Infinity = unlimited
  tier: EmployerTier;
  /** Friendly message when the cap is hit (empty when allowed). */
  message: string;
}

/**
 * Decide whether one more send is allowed, given the count already used this
 * calendar month. Pure — the caller supplies `used` from the store.
 */
export function checkSendAllowance(access: Access, used: number): SendAllowance {
  const tier = access.isAdmin ? "corporate" : normalizeTier(access.tier);
  const limit = docusignMonthlyLimit(access);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
  const allowed = remaining > 0;
  const nextTier = tier === "free" ? "Portal (10/mo)" : tier === "portal" ? "Scale (50/mo)" : "Corporate (unlimited)";
  const message = allowed
    ? ""
    : `You've used all ${limit} offer-letter sends included in your ${tierLabel(
        tier
      )} plan this month. Upgrade to ${nextTier} to send more, or wait until next month when your allowance resets.`;
  return { allowed, limit, used, remaining, tier, message };
}
