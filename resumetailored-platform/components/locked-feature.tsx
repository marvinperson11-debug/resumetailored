import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * Full-page access gate shown when a user's role can't reach a feature.
 * - variant "pro": individual Pro tools (Resume Video, Web Studio) reached by a
 *   free user or an employer → offer the in-app Pro upgrade.
 * - variant "employer": the Employer Portal reached by an individual → explain
 *   an Employer account is required (no self-serve upgrade here).
 */
export function LockedFeature({
  feature,
  variant,
}: {
  feature: string;
  variant: "pro" | "employer";
}) {
  const isPro = variant === "pro";
  const message = isPro
    ? "This feature requires a Pro subscription."
    : "This feature requires an Employer account.";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
      <div className="glass w-full px-8 py-14 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
          <Lock className="h-5 w-5 text-gold" />
        </div>
        <h1 className="font-serif text-3xl font-medium text-white sm:text-4xl">{feature}</h1>
        <p className="mx-auto mt-4 max-w-md text-base text-white/70">{message}</p>

        {isPro ? (
          <>
            <Link
              href="/candidate?upgrade=pro"
              className="mt-8 inline-block rounded-xl bg-violet px-6 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(194,135,11,0.3)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(194,135,11,0.45)]"
            >
              Upgrade to Pro — $19/mo →
            </Link>
            <p className="mt-3 text-xs text-white/40">Cancel anytime. Lifetime also available.</p>
          </>
        ) : (
          <>
            <a
              href="https://resumetailored.com/for-employers"
              className="mt-8 inline-block rounded-xl bg-violet px-6 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(194,135,11,0.3)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(194,135,11,0.45)]"
            >
              Learn about Employer accounts →
            </a>
            <p className="mt-3 text-xs text-white/40">
              Employer tools are billed separately from individual Pro.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
