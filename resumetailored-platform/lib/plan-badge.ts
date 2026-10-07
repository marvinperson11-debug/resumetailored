import type { Access } from "./plan";
import { normalizeTier, type EmployerTier } from "./employer-tier";

/**
 * The ONE place that decides which plan a plan badge / "Current plan" line shows.
 *
 * An account can be Pro on the candidate side and Free on the employer side at
 * the same time (the platform admin is the real case: the admin bypass is
 * `plan:"pro"` with no employer tier). The two sides therefore read different
 * fields of `Access`, and each side must show ITS OWN plan:
 *   - candidate pages → candidate plan (Pro / Free / via-employer)
 *   - employer pages  → employer tier  (Free / Portal / Scale / Corporate) —
 *     the stored tier, NOT an admin shortcut, so it always agrees with
 *     Settings → "Current plan"
 *   - neutral pages   → no badge at all (never borrow either side's plan)
 *
 * Entitlements (what the admin can actually use) are decided elsewhere by
 * `access.isAdmin`; this module is display-only.
 */
export type BadgeSide = "candidate" | "employer" | "neutral";
export type PlanBadge =
  | { side: "candidate"; plan: "pro" | "free" | "employee" }
  | { side: "employer"; tier: EmployerTier };

/** Which side of the product a pathname belongs to. */
export function sideOfPath(pathname: string | null | undefined): BadgeSide {
  const p = pathname || "";
  if (p === "/candidate" || p.startsWith("/candidate/")) return "candidate";
  if (p === "/employer" || p.startsWith("/employer/")) return "employer";
  return "neutral";
}

/** The badge for `side`, or null when there is nothing honest to show. */
export function planBadgeFor(side: BadgeSide, access: Access): PlanBadge | null {
  if (side === "candidate") {
    // The admin bypass is Pro on the candidate side (access.plan is already
    // "pro" for it; the isAdmin check keeps that true if that ever changes).
    const plan = access.isAdmin || access.plan === "pro" ? "pro" : access.plan === "employee" ? "employee" : "free";
    return { side, plan };
  }
  if (side === "employer") return { side, tier: normalizeTier(access.tier) };
  return null;
}

/** Convenience: badge for a pathname. */
export function planBadgeForPath(pathname: string | null | undefined, access: Access): PlanBadge | null {
  return planBadgeFor(sideOfPath(pathname), access);
}
