"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { ProUpgradeModal } from "@/components/pro-upgrade-modal";

type Toast = { kind: "success" | "info"; text: string } | null;

/**
 * Client controller for the sign-up-first Pro flow. Mounted on the candidate
 * dashboard, it:
 *   - opens the upgrade modal when the URL carries ?upgrade=pro (set by the
 *     marketing site's Pro CTAs and carried through sign-in),
 *   - starts Stripe checkout via /api/create-checkout-session,
 *   - shows a toast + refreshes the server-rendered plan on ?payment=success,
 *   - shows a toast + closes on ?payment=cancelled,
 * stripping the query params after handling so a refresh does not re-trigger.
 */
function UpgradeFlowInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const stripParams = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  // React to ?upgrade=pro and ?payment=... on load / navigation.
  useEffect(() => {
    if (params.get("upgrade") === "pro") {
      setOpen(true);
      setError(null);
      stripParams();
      return;
    }
    const payment = params.get("payment");
    if (payment === "success") {
      setOpen(false);
      setToast({ kind: "success", text: "Welcome to Pro! 🎉" });
      stripParams();
      // The webhook grants Pro server-side; re-run the server components so the
      // sidebar flips to "Pro · active". A short delay covers propagation.
      const t = setTimeout(() => router.refresh(), 1500);
      return () => clearTimeout(t);
    }
    if (payment === "cancelled") {
      setOpen(false);
      setToast({ kind: "info", text: "Payment cancelled — you have not been charged." });
      stripParams();
    }
  }, [params, router, stripParams]);

  // Auto-dismiss the toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const startCheckout = useCallback(async (plan: "pro" | "lifetime") => {
    setLoading(true);
    setError(null);
    try {
      const returnUrl = `${window.location.origin}/candidate`;
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, returnUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(
          data.error === "not_signed_in"
            ? "Please sign in first, then try again."
            : "Secure checkout could not be opened. Please try again."
        );
      }
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout is temporarily unavailable.");
      setLoading(false);
    }
  }, []);

  return (
    <>
      <ProUpgradeModal
        open={open}
        loading={loading}
        error={error}
        onStart={startCheckout}
        onClose={() => setOpen(false)}
      />
      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-[110] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border-gold bg-navy px-4 py-3 text-sm font-medium text-cream shadow-2xl"
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-teal" />
          ) : (
            <XCircle className="h-4 w-4 text-muted-cream" />
          )}
          {toast.text}
        </div>
      )}
    </>
  );
}

export function UpgradeFlow() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <UpgradeFlowInner />
    </Suspense>
  );
}
