"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SignUp, ClerkLoading, ClerkLoaded } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { InstallAppButton } from "@/components/pwa/install-app-button";

function SignUpInner() {
  const t = useTranslations("publicSignUp");
  const [slow, setSlow] = useState(false);
  const params = useSearchParams();
  // Post-auth destination: an internal ?redirect_url (the /join invite flow)
  // wins; a Pro-upgrade intent opens the candidate dashboard's modal; otherwise
  // land on "/" so the server routes by ROLE (employer/employee → /employer).
  const redirectUrl = params.get("redirect_url");
  const safeRedirect = redirectUrl && /^\/(?!\/)/.test(redirectUrl) ? redirectUrl : null;
  const dest = safeRedirect
    ? safeRedirect
    : params.get("upgrade") === "pro"
      ? "/candidate?upgrade=pro"
      : "/";

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main
      style={{ backgroundColor: "#0B0F19" }}
      className="flex min-h-screen flex-col items-center justify-center px-6 py-12"
    >
      <ClerkLoading>
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-violet" />
          <p className="text-sm text-white/70">{t("loadingSignUp")}</p>
          {slow && (
            <p className="mt-3 max-w-xs text-xs text-white/40">{t("stillLoading")}</p>
          )}
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <SignUp
          forceRedirectUrl={dest}
          fallbackRedirectUrl={dest}
          signInForceRedirectUrl={dest}
        />
        {/* Pre-empts the confusing dead end where a workforce employee tries
            to sign up here with their work email, Clerk blocks the
            duplicate, and there's no obvious next step — the same login
            already works for both. */}
        <p className="mt-6 max-w-xs text-center text-xs text-white/40">
          {t("alreadyPartOfTeam")}{" "}
          <a href="/sign-in" className="text-white/60 underline-offset-4 hover:text-white/85 hover:underline">
            {t("signInInstead")}
          </a>{" "}
          {t("alreadyPartOfTeamSuffix")}
        </p>
        <InstallAppButton
          label={t("downloadTheApp")}
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
        />
      </ClerkLoaded>
    </main>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<main style={{ backgroundColor: "#0B0F19", minHeight: "100vh" }} />}>
      <SignUpInner />
    </Suspense>
  );
}
