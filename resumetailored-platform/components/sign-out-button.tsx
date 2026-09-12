"use client";

import { useClerk } from "@clerk/nextjs";
import { LogOut } from "lucide-react";

/**
 * Explicit "Sign out" control. Calls Clerk's signOut() and redirects to the
 * public landing page ("/"). Styling is passed in via `className` so the same
 * button fits the candidate sidebar and the employer top nav.
 */
export function SignOutButton({
  className,
  label = "Sign out",
}: {
  className?: string;
  label?: string;
}) {
  const { signOut } = useClerk();
  return (
    <button
      type="button"
      onClick={() => signOut({ redirectUrl: "/" })}
      className={className}
    >
      <LogOut className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
