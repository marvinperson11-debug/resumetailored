/**
 * Client-safe tier vocabulary. lib/employer-plan.ts also holds server-only
 * helpers (Clerk lookups), so anything that renders a plan label in a client
 * component imports from here instead.
 */
export type EmployerTier = "free" | "portal" | "scale" | "corporate";

/** Normalize a free-form tier string to a known tier, defaulting to "free". */
export function normalizeTier(tier: string | null | undefined): EmployerTier {
  const t = (tier || "").trim().toLowerCase();
  if (t === "portal" || t === "scale" || t === "corporate") return t;
  // Legacy's internal name for the Portal tier.
  if (t === "pro") return "portal";
  return "free";
}
