"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignInButton() {
  return (
    <Button size="lg" onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
        <path fill="currentColor" d="M21.35 11.1H12v2.9h5.35c-.25 1.5-1.7 4.4-5.35 4.4-3.2 0-5.8-2.65-5.8-5.9s2.6-5.9 5.8-5.9c1.8 0 3.05.77 3.75 1.43l2.55-2.46C16.7 3.6 14.6 2.7 12 2.7 6.9 2.7 2.75 6.85 2.75 12S6.9 21.3 12 21.3c5.9 0 9.8-4.15 9.8-9.98 0-.67-.07-1.18-.15-1.72z" />
      </svg>
      Continue with Google
    </Button>
  );
}
