"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Loader2, X, Lock, type LucideIcon } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Employer Portal UI kit. Same navy/violet tokens as the candidate app but a
 * more corporate register: solid panels (bg-white/[0.04] with a hairline
 * border), less glow, denser tables. Kept separate from the candidate `ui.tsx`
 * so the two areas can diverge without stepping on each other.
 */

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border border-border-gold bg-white/[0.04] p-5", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-serif text-2xl font-medium text-cream">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-white/60">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Btn({
  children,
  loading,
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-violet text-white hover:bg-violet/90",
    ghost: "border border-border-gold bg-white/[0.03] text-cream hover:bg-white/[0.08]",
    danger: "border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20",
  }[variant];
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        styles,
        className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-white/40">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet",
        className
      )}
      {...props}
    />
  );
}

export function Area({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full resize-y rounded-lg border border-border-gold bg-white/5 px-3 py-2.5 text-sm text-cream placeholder:text-white/35 outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet",
        className
      )}
      {...props}
    />
  );
}

export function Picker({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={cn(
        "w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet [&>option]:bg-navy [&>option]:text-cream",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

type Tone = "neutral" | "violet" | "teal" | "gold" | "red" | "sky";
const TONES: Record<Tone, string> = {
  neutral: "bg-white/10 text-white/70",
  violet: "bg-violet/20 text-violet",
  teal: "bg-teal/20 text-teal",
  gold: "bg-gold/20 text-gold",
  red: "bg-red-500/20 text-red-300",
  sky: "bg-sky-500/20 text-sky-300",
};
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", TONES[tone])}>{children}</span>;
}

/** Checkout route for the plan being upsold. Accepts a tier key ("free" →
 *  upsell Portal, "portal" → Scale, "scale" → Corporate) or a display label
 *  ("Portal", "Employer Portal", "Scale", "Corporate"). Never a marketing page. */
export function employerCheckoutHref(target?: string | null): string {
  const k = (target || "portal").toLowerCase();
  const plan = k.includes("corporate") ? "corporate" : k.includes("scale") ? "scale" : "portal";
  return `/employer-checkout?plan=${plan}`;
}

/** The plan to upsell TO for a caller currently on `tier`. */
export function nextUpgradePlan(tier?: string | null): "portal" | "scale" | "corporate" {
  return tier === "portal" ? "scale" : tier === "scale" || tier === "corporate" ? "corporate" : "portal";
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-gold px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/8">
        <Icon className="h-6 w-6 text-violet" />
      </div>
      <h3 className="font-serif text-lg font-medium text-cream">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-white/55">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** A friendly, in-place upgrade prompt for a tab/panel gated to a higher tier
 *  than the caller's — never a dead/disabled button with no explanation. Used
 *  by the Office suite's Scale+ tools (Charts now; Spreadsheet Creator, Report
 *  Writer, Presentation Builder in later phases). There's no in-app employer
 *  tier checkout, so the CTA points at the same marketing link the whole
 *  Employer Portal's own access gate (`LockedFeature`) uses. */
export function TierUpgradeNote({ feature, tier = "Scale" }: { feature: string; tier?: string }) {
  const t = useTranslations("employerUi");
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gold/40 bg-gold/5 px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold/15">
        <Lock className="h-5 w-5 text-gold" />
      </div>
      <h3 className="font-serif text-lg font-medium text-cream">{feature}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-white/55">{t("availableOnPlan", { feature, tier })}</p>
      <a
        href={employerCheckoutHref(tier)}
        className="mt-5 inline-block rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
      >
        {t("learnAboutUpgrading")}
      </a>
    </div>
  );
}

/** Closed set of module names the locked-module banner/snackbar can label by
 *  key (`employerUi.features.*`), so callers don't need their own `t()`. Office
 *  tools pass an already-translated `feature` string instead. */
export type LockedFeatureKey = "employeesHub" | "timesheets" | "careerSiteBuilder" | "timeOff" | "videoInterviews" | "shiftScheduling";

/**
 * Persistent, always-visible banner at the top of a module that's locked at
 * the caller's current tier — used by Video Interviews, the Employees hub,
 * the Time suite, and Office, matching the tier-gating spec: the page itself
 * still renders (never a full-page block), so the visitor sees exactly what
 * they'd get, clearly marked as not yet active.
 */
export function LockedModuleBanner({ feature, featureKey, tier }: { feature?: string; featureKey?: LockedFeatureKey; tier: string }) {
  const t = useTranslations("employerUi");
  const name = featureKey ? t(`features.${featureKey}`) : feature ?? "";
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3">
      <Lock className="h-4 w-4 shrink-0 text-gold" />
      <p className="min-w-[14rem] flex-1 break-words text-sm text-cream">
        {t.rich("lockedBanner.body", {
          feature: name,
          tier,
          strong: (chunks) => <strong className="font-semibold">{chunks}</strong>,
        })}
      </p>
      <a
        href={employerCheckoutHref(tier)}
        className="shrink-0 rounded-lg bg-gold px-3.5 py-1.5 text-xs font-bold text-navy transition-colors hover:bg-gold/90"
      >
        {t("lockedBanner.upgrade")}
      </a>
    </div>
  );
}

/**
 * Fires once a locked module's content is actually touched (typing, clicking
 * any control) — not on page load, and never withheld until a final
 * Save/submit. Spread `handlers` onto the module's outer content wrapper;
 * `touched` flips true (and stays true) on the first click/keydown/focus
 * inside it while `locked` is true. Pair with `<FirstTouchSnackbar/>`.
 */
export function useFirstTouch(locked: boolean) {
  const [touched, setTouched] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mark = useCallback(() => {
    if (locked) setTouched(true);
  }, [locked]);
  return {
    /** True once the snackbar should render (first touch, not yet dismissed). */
    touched: touched && !dismissed,
    dismiss: useCallback(() => setDismissed(true), []),
    handlers: locked ? { onClickCapture: mark, onKeyDownCapture: mark, onFocusCapture: mark } : {},
  };
}

/**
 * The inline gate itself: a dismissible toast fixed near the bottom of the
 * viewport, so it appears immediately wherever the visitor is on the page —
 * not anchored to one field, but never requiring a scroll back to the top
 * banner either. Shown only after `useFirstTouch` reports a real interaction.
 */
export function FirstTouchSnackbar({
  show,
  feature,
  featureKey,
  tier,
  onDismiss,
}: {
  show: boolean;
  feature?: string;
  featureKey?: LockedFeatureKey;
  tier: string;
  onDismiss: () => void;
}) {
  const t = useTranslations("employerUi");
  if (!show) return null;
  const name = featureKey ? t(`features.${featureKey}`) : feature ?? "";
  return (
    <div className="fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4">
      <div className="flex max-w-md items-center gap-3 rounded-xl border border-gold/40 bg-navy px-4 py-3 shadow-2xl">
        <Lock className="h-4 w-4 shrink-0 text-gold" />
        <p className="min-w-0 flex-1 break-words text-xs text-cream">
          {t.rich("snackbar.body", {
            feature: name,
            tier,
            strong: (chunks) => <strong>{chunks}</strong>,
            link: (chunks) => (
              <a href={employerCheckoutHref(tier)} className="font-bold text-gold underline underline-offset-2">
                {chunks}
              </a>
            ),
          })}
        </p>
        <button type="button" onClick={onDismiss} aria-label={t("snackbar.dismiss")} className="shrink-0 text-white/40 hover:text-white/70">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Persistent visible usage counter for a metered (not fully locked) feature —
 * job slots, candidate pipeline, e-sig sends, team seats. Shown from first
 * visit (never a surprise only encountered at the limit), with an upgrade CTA
 * that appears once the limit is actually hit.
 */
export type QuotaKind = "jobs" | "seats" | "candidates" | "video" | "esign" | "documents";

export function QuotaBar({
  kind,
  used,
  limit,
  nextTierLabel,
}: {
  /** Which metered feature this counts — picks the translated sentence. */
  kind: QuotaKind;
  used: number;
  /** `null` = unlimited (no bar, just a plain count). */
  limit: number | null;
  /** e.g. "Portal" — shown in the upgrade CTA once the limit is hit. */
  nextTierLabel?: string;
}) {
  const t = useTranslations("employerUi");
  const atLimit = limit !== null && used >= limit;
  // Sends enforce the cap server-side; a count above the plan max (e.g. history
  // carried over from a higher plan or an admin preview) displays as "max of max"
  // rather than an impossible "7 of 3".
  const shownUsed = limit !== null ? Math.min(used, limit) : used;
  const pct = limit !== null && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="mb-5 rounded-xl border border-border-gold bg-white/[0.03] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("text-sm font-medium", atLimit ? "text-gold" : "text-white/75")}>
          {limit === null ? t(`quota.unlimited.${kind}`, { used }) : t(`quota.usedOf.${kind}`, { used: shownUsed, limit })}
        </span>
        {atLimit && nextTierLabel && (
          <a
            href={employerCheckoutHref(nextTierLabel)}
            className="rounded-lg bg-gold px-3 py-1 text-xs font-bold text-navy transition-colors hover:bg-gold/90"
          >
            {t("quota.upgradeTo", { tier: nextTierLabel })}
          </a>
        )}
      </div>
      {limit !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={cn("h-full rounded-full transition-all", atLimit ? "bg-gold" : "bg-violet")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

interface UpgradeCardData {
  /** "free" | "portal" | "scale" — picks the translated plan name + pitch. */
  tier: "free" | "portal" | "scale";
  planLabel: string;
  used: number;
  limit: number;
  pitch: string;
}

/**
 * Slim, persistent upgrade card for the bottom of every non-locked employer
 * page (Dashboard, Hire, Candidates, Messages, Shortlists, E-Signatures,
 * Documents, Team — locked modules already show `LockedModuleBanner`, so
 * they never render this too). Self-fetching: every host page just drops in
 * `<UpgradeCard />`, and it decides on its own whether there's anything to
 * show — nothing for Corporate or the admin bypass, since both have
 * unlimited sends and nowhere further to upgrade. Never a popup, never
 * blocking — it renders in normal page flow, after everything else.
 */
export function UpgradeCard() {
  const t = useTranslations("employerUi");
  const [data, setData] = useState<UpgradeCardData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/employer/upgrade-card", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { data: null }))
      .then((d: { data?: UpgradeCardData | null }) => {
        if (!cancelled) setData(d.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3 rounded-xl border border-border-gold bg-white/[0.03] px-4 py-3 text-sm">
      <p className="min-w-[14rem] flex-1 break-words text-white/70">
        {t.rich("upgradeCard.body", {
          plan: t(`tierNames.${data.tier}`),
          used: data.used,
          limit: data.limit,
          pitch: t(`upgradeCard.pitch.${data.tier}`),
          strong: (chunks) => <strong className="font-semibold text-cream">{chunks}</strong>,
        })}
      </p>
      <a
        href={employerCheckoutHref(nextUpgradePlan(data.tier))}
        className="shrink-0 rounded-lg bg-gold px-3.5 py-1.5 text-xs font-bold text-navy transition-colors hover:bg-gold/90"
      >
        {t("upgradeCard.cta")}
      </a>
    </div>
  );
}

/** Centered modal dialog. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const t = useTranslations("employerUi");
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-navy/70 p-4 backdrop-blur-sm sm:items-center sm:p-8">
      {/* Cap the card to the (dynamic) viewport height and scroll the BODY
          internally, so on mobile the whole form is reachable and the last
          fields (Record toggle / Schedule button) never sit under the browser
          chrome. dvh tracks the collapsing address bar; the header stays put. */}
      <div className={cn("flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-border-gold bg-navy shadow-2xl sm:max-h-[calc(100dvh-4rem)]", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex shrink-0 items-center justify-between border-b border-border-gold px-5 py-4">
          <h2 className="font-serif text-lg font-medium text-cream">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")} className="text-muted-cream transition-colors hover:text-cream">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/** Right-side drawer (candidate detail). */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useTranslations("employerUi");
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-navy/60 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-xl flex-col border-l border-border-gold bg-navy shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-gold px-5 py-4">
          <h2 className="font-serif text-lg font-medium text-cream">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")} className="text-muted-cream transition-colors hover:text-cream">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/** A score chip coloured by band (green ≥66, amber ≥33, red below). */
export function ScoreChip({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <span className="text-xs text-white/35">—</span>;
  const color = score >= 66 ? "#14B8A6" : score >= 33 ? "#F59E0B" : "#f87171";
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color }}>
      {score}%
    </span>
  );
}
