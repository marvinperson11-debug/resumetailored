/**
 * The 3 Checkr packages this build maps to (Checkr offers many more, including
 * 3 international packages that are intentionally NOT offered here — their
 * price varies by country, which is out of scope for this build), their
 * Checkr-side cost, and our price: Checkr cost + 15% platform margin, with
 * pass-through court/county fees itemized separately (those vary per county
 * and are billed at cost, no margin — "pass-through" means exactly that).
 * Slugs and costs are sourced from the live Checkr dashboard (Nov 6, 2026).
 * Pure — no DB/network.
 */

export type BgcPackageId = "basic" | "standard" | "premium";

export interface BgcPackage {
  id: BgcPackageId;
  checkrPackageSlug: string;
  label: string;
  description: string;
  /** Checkr's own price for this package, in cents. */
  checkrCostCents: number;
  /** Typical county/court pass-through fee shown separately, in cents (an
   *  estimate shown pre-order; the real amount settles from Checkr's report). */
  typicalPassThroughFeeCents: number;
}

export const BGC_PACKAGES: Record<BgcPackageId, BgcPackage> = {
  basic: {
    id: "basic",
    checkrPackageSlug: "checkrdirect_basic_plus_criminal",
    label: "Basic Plus Criminal",
    description: "SSN trace + sex offender registry + global watchlist + national criminal database search.",
    checkrCostCents: 2999,
    typicalPassThroughFeeCents: 0,
  },
  standard: {
    id: "standard",
    checkrPackageSlug: "checkrdirect_essential_criminal",
    label: "Essential Criminal",
    description: "Everything in Basic Plus, plus identity verification and unlimited county criminal searches.",
    checkrCostCents: 5499,
    typicalPassThroughFeeCents: 1000,
  },
  premium: {
    id: "premium",
    checkrPackageSlug: "checkrdirect_complete_criminal",
    label: "Complete Criminal",
    description: "Everything in Essential, plus unlimited state criminal search and federal criminal search.",
    checkrCostCents: 8999,
    typicalPassThroughFeeCents: 1500,
  },
};

export const PLATFORM_MARGIN = 0.15;

/** Our price for a package: Checkr cost + 15%, rounded to the nearest cent.
 *  Pass-through fees are returned separately, never folded into this number
 *  — the order confirmation must itemize them, not bury them in the price. */
export function priceForPackage(pkg: BgcPackage): { priceCents: number; passThroughFeeCents: number; totalCents: number } {
  const priceCents = Math.round(pkg.checkrCostCents * (1 + PLATFORM_MARGIN));
  return { priceCents, passThroughFeeCents: pkg.typicalPassThroughFeeCents, totalCents: priceCents + pkg.typicalPassThroughFeeCents };
}

export function isValidPackageId(id: string): id is BgcPackageId {
  return id === "basic" || id === "standard" || id === "premium";
}

/** States with fair-chance / ban-the-box timing restrictions on WHEN a
 *  criminal background check may run relative to a conditional offer.
 *  Representative, not a substitute for legal review — surfaced as a
 *  warning banner at order time, never a hard block (the employer may have
 *  already made a compliant conditional offer; this build has no way to
 *  know that, so it warns rather than assumes). */
export const FAIR_CHANCE_STATES = new Set(["CA", "CO", "CT", "HI", "IL", "MA", "MD", "MN", "NJ", "NM", "NY", "NV", "OR", "PA", "RI", "SC", "VT", "WA", "WI"]);

export function fairChanceWarning(candidateStateCode: string | null | undefined): boolean {
  if (!candidateStateCode) return false;
  return FAIR_CHANCE_STATES.has(candidateStateCode.trim().toUpperCase());
}
