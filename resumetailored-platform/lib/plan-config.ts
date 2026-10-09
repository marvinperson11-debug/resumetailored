/**
 * The ONE place for list prices and plan limits. The server-side enforcement (lib/video-quota.ts), the in-app
 * strings (ICU parameters, never typed-in numbers) and the tests all read from here. The public site's static
 * pages can't import this file, so test/plan-copy.js in the legacy app asserts that every price and limit
 * printed there equals what is declared below.
 */

/** List prices, display only. Checkout amounts live in Stripe and are never read from here. */
export const PRICES_USD = {
  pro: 19,
  proLifetime: 129,
  employerPortal: 49,
  employerScale: 99,
  employerCorporate: 299,
} as const;

/** Resume Videos per UTC calendar month. Free and every employer tier get none (the feature is Pro-gated). */
export const RESUME_VIDEO_MONTHLY_LIMITS = {
  /** Pro monthly ($19/mo). */
  pro: 10,
  /** Pro Lifetime ($129 one-time). */
  proLifetime: 40,
} as const;

/** Pro Lifetime tailoring-variant sets per UTC month (enforced in lib/tailor-variants.ts). */
export const LIFETIME_VARIANT_MONTHLY_CAP = 30;

/** ICU parameters for every in-app string that prints a price or a plan limit — so no number is typed into a translation. */
export const PLAN_COPY_PARAMS = {
  proPrice: PRICES_USD.pro,
  lifetimePrice: PRICES_USD.proLifetime,
  proVideos: RESUME_VIDEO_MONTHLY_LIMITS.pro,
  lifetimeVideos: RESUME_VIDEO_MONTHLY_LIMITS.proLifetime,
  variantSets: LIFETIME_VARIANT_MONTHLY_CAP,
} as const;
