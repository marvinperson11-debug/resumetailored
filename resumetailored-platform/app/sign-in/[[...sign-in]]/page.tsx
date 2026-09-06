"use client";

import { useEffect, useState } from "react";
import { SignIn, ClerkLoading, ClerkLoaded } from "@clerk/nextjs";

// Clean, single-purpose sign-in. ClerkLoading/ClerkLoaded guarantee the page
// is never a blank black void: a dark charcoal background + a "Loading sign-in…"
// state shows until clerk-js mounts the form (or if it is slow to load).
export default function SignInPage() {
  const [slow, setSlow] = useState(false);
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
          <p className="text-sm text-white/70">Loading sign-in…</p>
          {slow && (
            <p className="mt-3 max-w-xs text-xs text-white/40">
              Still loading. If this doesn&rsquo;t clear, please refresh or try
              again shortly.
            </p>
          )}
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <SignIn fallbackRedirectUrl="/candidate" />
      </ClerkLoaded>
    </main>
  );
}
