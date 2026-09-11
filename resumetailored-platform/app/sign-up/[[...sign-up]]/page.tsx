"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SignUp, ClerkLoading, ClerkLoaded } from "@clerk/nextjs";

function SignUpInner() {
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
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, []);

  return (
    <main
      style={{ backgroundColor: "#0B0F19" }}
      className="flex min-h-screen flex-col items-center justify-center px-6 py-12"
    >
      <ClerkLoading>
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-violet" />
          <p className="text-sm text-white/70">Loading sign-up…</p>
          {slow && (
            <p className="mt-3 max-w-xs text-xs text-white/40">
              Still loading. If this doesn&rsquo;t clear, please refresh or try
              again shortly.
            </p>
          )}
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <SignUp
          forceRedirectUrl={dest}
          fallbackRedirectUrl={dest}
          signInForceRedirectUrl={dest}
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
