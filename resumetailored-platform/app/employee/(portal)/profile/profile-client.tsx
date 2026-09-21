"use client";

import { useClerk } from "@clerk/nextjs";
import { UserCog } from "lucide-react";

/** Opens Clerk's account panel (photo/name/email) without leaving the portal. */
export function ManageAccountButton() {
  const { openUserProfile } = useClerk();
  return (
    <button
      type="button"
      onClick={() => openUserProfile()}
      className="inline-flex items-center gap-2 rounded-lg border border-border-gold px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-white/8"
    >
      <UserCog className="h-4 w-4" /> Manage account
    </button>
  );
}
