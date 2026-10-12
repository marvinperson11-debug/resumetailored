"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { peekEmployerDraft } from "@/lib/employer-demo";

/**
 * Signed-in employer layout only. If the visitor built a job post in the demo before signing up, the
 * draft is waiting in sessionStorage: take them to the new-job form, which puts it back (once, and it
 * only fills the form). With no draft this renders nothing and does nothing.
 */
export function EmployerDraftRestorer() {
  const router = useRouter();
  useEffect(() => {
    if (peekEmployerDraft()) router.replace("/employer/jobs?new=1");
  }, [router]);
  return null;
}
