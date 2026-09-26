"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Building2, FileText, LogOut } from "lucide-react";

const SEEN_COOKIE = "rt_staff_door_seen";

function markSeen() {
  try {
    document.cookie = `${SEEN_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* best-effort — worst case they see this card again next time */
  }
}

/**
 * Shown once (per browser, via a long-lived cookie the root router checks)
 * the first time a workforce employee's session lands on "/" — the moment
 * their sign-in would otherwise silently bounce straight to /employee. Fixes
 * the dead end where a staff member who discovered the candidate side and
 * tried to sign up with their work email got blocked by Clerk's duplicate-
 * email check with no obvious way forward. Every choice here marks the
 * cookie so returning staff who just want their portal aren't nagged again.
 */
export function StaffWhichDoor({ company }: { company: string }) {
  const router = useRouter();
  const { signOut } = useClerk();

  function choose(path: string) {
    markSeen();
    router.push(path);
  }

  return (
    <main style={{ backgroundColor: "#0B0F19" }} className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border-gold bg-navy p-8 shadow-2xl">
        <h1 className="text-center font-serif text-2xl font-medium text-cream">Which door?</h1>
        <p className="mt-2 text-center text-sm text-white/60">
          You&rsquo;re signed in with your <strong className="text-cream">{company}</strong> team account. What would you like to do?
        </p>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => choose("/employee")}
            className="flex w-full items-center gap-3 rounded-xl border border-border-gold bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.06]"
          >
            <Building2 className="h-5 w-5 shrink-0 text-violet" />
            <span>
              <span className="block font-medium text-cream">Go to your employee portal</span>
              <span className="block text-xs text-white/50">Documents, messages, training, schedule.</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => choose("/candidate")}
            className="flex w-full items-center gap-3 rounded-xl border border-border-gold bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.06]"
          >
            <FileText className="h-5 w-5 shrink-0 text-violet" />
            <span>
              <span className="block font-medium text-cream">Use the career &amp; resume tools</span>
              <span className="block text-xs text-white/50">Same login — tailor a resume, write a cover letter, and more.</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => signOut({ redirectUrl: "/sign-up" })}
            className="flex w-full items-center gap-3 rounded-xl border border-white/10 p-4 text-left text-white/60 transition hover:bg-white/[0.03] hover:text-white/85"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span>
              <span className="block font-medium">Create a separate personal account</span>
              <span className="block text-xs text-white/40">Sign out, then sign up again with a different email address.</span>
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}
