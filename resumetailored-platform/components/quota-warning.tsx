"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { quotaState, quotaLeft } from "@/lib/quota-state";

/** Which meter this is — picks the translated feature name for the at-limit sentence. */
export type QuotaFeature =
  | "decoder"
  | "variants"
  | "instructions"
  | "esign"
  | "video"
  | "documents"
  | "jobs"
  | "candidates"
  | "seats";

/**
 * The one "running low" component used by every usage meter (candidate + employer).
 *
 *   ≥ 80% and not at the cap → pulsing amber badge "Running low: N left" + "Get more →"
 *   at the cap               → the same badge carrying "{feature} limit reached — upgrade for more"
 *                              + the same CTA (or `limitMessage`, to keep an existing hard-block sentence)
 *   otherwise                → renders nothing
 *
 * `used` / `limit` must be the values the server enforces with. `upgradeHref` is the Pro
 * upgrade modal on the candidate side (`/candidate?upgrade=pro`) or `/employer-checkout?...`
 * on the employer side; omit it (or pass `showCta={false}`) when the surrounding element is
 * already a link, and the CTA is drawn as plain text. The pulse is `motion-safe:` only, so
 * users with prefers-reduced-motion get a static badge.
 */
export function QuotaWarning({
  used,
  limit,
  feature,
  upgradeHref,
  showCta = true,
  limitMessage,
  className,
}: {
  used: number;
  limit: number | null | undefined;
  feature: QuotaFeature;
  upgradeHref?: string;
  showCta?: boolean;
  limitMessage?: ReactNode;
  className?: string;
}) {
  const tw = useTranslations("warning");
  const tl = useTranslations("limit");
  const state = quotaState(used, limit);
  if (state === "ok" || limit == null) return null;

  const text = state === "limit" ? limitMessage ?? tl("atLimit", { feature: tl(`feature.${feature}`) }) : tw("badge", { n: quotaLeft(used, limit) });
  const cta = tw("cta");

  return (
    <span role="status" className={cn("inline-flex flex-wrap items-center gap-x-2.5 gap-y-1", className)} data-quota-state={state}>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold motion-safe:animate-pulse">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
        {text}
      </span>
      {showCta &&
        (upgradeHref ? (
          <a href={upgradeHref} className="text-xs font-bold text-gold underline-offset-2 hover:underline">
            {cta}
          </a>
        ) : (
          <span className="text-xs font-bold text-gold">{cta}</span>
        ))}
    </span>
  );
}
