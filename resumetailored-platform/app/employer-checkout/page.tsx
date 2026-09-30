"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { PRICES_USD } from "@/lib/format";
import { useFormat } from "@/lib/use-format";
import { Btn, Panel } from "@/app/employer/components/ui";

type Plan = "free" | "portal" | "scale" | "corporate";
const VALID_PLANS: Plan[] = ["free", "portal", "scale", "corporate"];
/** Display-only list prices (Stripe is the source of truth for what is charged). */
const PLAN_PRICE: Record<Exclude<Plan, "free">, number> = {
  portal: PRICES_USD.employerPortal,
  scale: PRICES_USD.employerScale,
  corporate: PRICES_USD.employerCorporate,
};

/**
 * Landing point for every employer CTA on the marketing site (free-start and
 * the three paid plans alike) — one consistent link shape
 * (`/employer-checkout?plan=free|portal|scale|corporate`) whether the visitor
 * is signed in yet or not. Deliberately NOT nested under /employer: that
 * layout gates on already HAVING employer access, which nobody hitting this
 * page yet does.
 *
 * - `plan=free` calls /api/employer/claim-free directly (no Stripe involved).
 * - A paid plan calls /api/create-employer-checkout-session and redirects to
 *   the returned Stripe URL — the plan only ever activates on a completed
 *   payment, via the existing webhook.
 *
 * Signed-out visitors never reach this component: middleware.ts sends them to
 * sign-up first with this exact URL (plan included) as `redirect_url`, so the
 * chosen plan survives the whole signup round-trip in the URL itself.
 */
function EmployerCheckoutInner() {
  const t = useTranslations("employerCheckout");
  const fmt = useFormat();
  const router = useRouter();
  const params = useSearchParams();
  const rawPlan = params.get("plan");
  const plan = (VALID_PLANS as string[]).includes(rawPlan || "") ? (rawPlan as Plan) : null;

  const [status, setStatus] = useState<"working" | "confirm" | "error">("working");
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claimFree = useCallback(
    async (confirm: boolean) => {
      setStatus("working");
      setError(null);
      try {
        const res = await fetch("/api/employer/claim-free", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm }),
        });
        if (res.status === 409) {
          const d = (await res.json().catch(() => ({}))) as { currentPlan?: string };
          setCurrentPlan(d.currentPlan || null);
          setStatus("confirm");
          return;
        }
        if (!res.ok) throw new Error("claim_failed");
        router.replace("/employer");
      } catch {
        setError(t("claimError"));
        setStatus("error");
      }
    },
    [router, t]
  );

  const startCheckout = useCallback(async (paidPlan: Exclude<Plan, "free">) => {
    setStatus("working");
    setError(null);
    try {
      const res = await fetch("/api/create-employer-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: paidPlan, returnUrl: `${window.location.origin}/employer` }),
      });
      const d = (await res.json().catch(() => ({}))) as { url?: string };
      if (!res.ok || !d.url) throw new Error("checkout_failed");
      window.location.href = d.url;
    } catch {
      setError(t("checkoutError"));
      setStatus("error");
    }
  }, [t]);

  useEffect(() => {
    if (!plan) {
      setError(t("unknownPlan"));
      setStatus("error");
      return;
    }
    if (plan === "free") claimFree(false);
    else startCheckout(plan);
    // Run once on mount for the plan in the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet/15">
            <Building2 className="h-5 w-5 text-violet" />
          </div>
          <span className="font-serif text-xl font-medium text-cream">Employer Portal</span>
        </div>

        {status === "working" && (
          <Panel className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-violet" />
            <p className="text-sm text-white/60">
              {plan === "free" ? t("settingUpFree") : t("takingToCheckout")}
            </p>
          </Panel>
        )}

        {status === "confirm" && (
          <Panel className="space-y-4 text-center">
            <p className="text-sm text-white/85">
              {t.rich("confirm", {
                current: currentPlan === "pro" ? t("current.pro") : currentPlan === "employee" ? t("current.employee") : currentPlan ?? "",
                plan: !plan || plan === "free" ? t("plan.free") : t(`plan.${plan}`, { price: fmt.money(PLAN_PRICE[plan]) }),
                lose: currentPlan === "pro" ? t("lose.pro") : t("lose.other"),
                strong: (chunks) => <strong className="text-cream">{chunks}</strong>,
              })}
            </p>
            <div className="flex justify-center gap-3">
              <Btn variant="ghost" onClick={() => router.push("/")}>
                {t("cancel")}
              </Btn>
              <Btn onClick={() => claimFree(true)}>{t("switch")}</Btn>
            </div>
          </Panel>
        )}

        {status === "error" && (
          <Panel className="space-y-4 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <Btn variant="ghost" onClick={() => router.push("/")}>
              {t("backHome")}
            </Btn>
          </Panel>
        )}
      </div>
    </main>
  );
}

export default function EmployerCheckoutPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-navy" />}>
      <EmployerCheckoutInner />
    </Suspense>
  );
}
