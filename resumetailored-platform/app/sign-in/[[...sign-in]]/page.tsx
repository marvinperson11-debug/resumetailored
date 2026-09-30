"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SignIn, ClerkLoading, ClerkLoaded } from "@clerk/nextjs";
import { InstallAppButton } from "@/components/pwa/install-app-button";

// Clean, single-purpose sign-in. ClerkLoading/ClerkLoaded guarantee the page
// is never a blank black void: a dark charcoal background + a "Loading sign-in…"
// state shows until clerk-js mounts the form (or if it is slow to load).
function SignInInner() {
  const t = useTranslations("authFlow");
  const [slow, setSlow] = useState(false);
  const params = useSearchParams();
  // Post-auth destination:
  //  - an internal ?redirect_url (used by the /join invite flow) wins,
  //  - a Pro-upgrade intent goes straight to the candidate dashboard's modal,
  //  - otherwise land on "/" so the server routes by ROLE (employer → /employer).
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
          <p className="text-sm text-white/70">{t("signInLoading")}</p>
          {slow && (
            <p className="mt-3 max-w-xs text-xs text-white/40">
              {t("stillLoading")}
            </p>
          )}
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <SignIn
          forceRedirectUrl={dest}
          fallbackRedirectUrl={dest}
          signUpForceRedirectUrl={dest}
        />
        {/* Invited workforce employees sign in the same way, then land in their
            scoped portal. This link points them at it (and their invite email
            drops them on /employee/accept directly). */}
        <a
          href="/employee"
          className="mt-6 text-sm text-white/50 underline-offset-4 transition-colors hover:text-white/80 hover:underline"
        >
          {t("employeePortalLink")}
        </a>
        <InstallAppButton
          label={t("downloadApp")}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
        />
      </ClerkLoaded>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<main style={{ backgroundColor: "#0B0F19", minHeight: "100vh" }} />}>
      <SignInInner />
    </Suspense>
  );
}
