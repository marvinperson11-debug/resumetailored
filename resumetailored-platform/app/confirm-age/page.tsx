"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useUser } from "@clerk/nextjs";

/**
 * One-time age self-attestation shown right after sign-up, before any other
 * page is reachable (app/sign-up/[[...sign-up]]/page.tsx routes its
 * post-sign-up redirect here first). Clerk's prebuilt <SignUp/> has no
 * built-in age/date-of-birth field, so this records the confirmation on the
 * user's own Clerk record (publicMetadata.ageConfirmed, written by
 * /api/account/confirm-age) instead. A user who already confirmed skips
 * straight through — this is meant to be seen once.
 */
function ConfirmAgeInner() {
  const t = useTranslations("authFlow");
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const params = useSearchParams();

  const redirectUrl = params.get("redirect_url");
  const dest = redirectUrl && /^\/(?!\/)/.test(redirectUrl) ? redirectUrl : "/";

  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      router.replace(`/sign-in?redirect_url=${encodeURIComponent(`/confirm-age?redirect_url=${encodeURIComponent(dest)}`)}`);
      return;
    }
    if (user.publicMetadata?.ageConfirmed) {
      router.replace(dest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, user, dest]);

  async function handleConfirm() {
    if (!checked || submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      const res = await fetch("/api/account/confirm-age", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      await user?.reload();
      router.replace(dest);
    } catch {
      setError(true);
      setSubmitting(false);
    }
  }

  if (!isLoaded || !user || user.publicMetadata?.ageConfirmed) {
    return (
      <main
        style={{ backgroundColor: "#0B0F19" }}
        className="flex min-h-screen flex-col items-center justify-center px-6 py-12"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-violet" />
        <p className="mt-4 text-sm text-white/70">{t("ageConfirmLoading")}</p>
      </main>
    );
  }

  return (
    <main
      style={{ backgroundColor: "#0B0F19" }}
      className="flex min-h-screen flex-col items-center justify-center px-6 py-12"
    >
      <div className="w-full max-w-md rounded-2xl border border-border-gold bg-white/5 p-8">
        <h1 className="font-serif text-2xl font-medium text-cream">{t("ageConfirmTitle")}</h1>
        <p className="mt-3 text-sm text-white/70">{t("ageConfirmBody")}</p>

        <label className="mt-6 flex items-start gap-3 text-sm text-white/80">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/30 bg-transparent"
          />
          <span>{t("ageConfirmCheckbox")}</span>
        </label>

        {error && <p className="mt-3 text-sm text-red-400">{t("ageConfirmError")}</p>}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={!checked || submitting}
          className="mt-6 w-full rounded-xl bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("ageConfirmContinue")}
        </button>
      </div>
    </main>
  );
}

export default function ConfirmAgePage() {
  return (
    <Suspense fallback={<main style={{ backgroundColor: "#0B0F19", minHeight: "100vh" }} />}>
      <ConfirmAgeInner />
    </Suspense>
  );
}
