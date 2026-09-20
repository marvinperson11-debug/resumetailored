"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

/**
 * Persistent amber banner shown while an admin plan preview is active. Reads the
 * `rt_plan_preview` cookie client-side (renders nothing when absent), so it
 * appears on every page — including a locked/gated page reached while previewing
 * a lower plan — giving a reliable "Exit preview" everywhere. Exiting only
 * clears the cookie; the server ignores it for non-admins regardless.
 */
const COOKIE = "rt_plan_preview";
const LABELS: Record<string, string> = { free: "Free", portal: "Portal", scale: "Scale", corporate: "Corporate", pro: "Pro" };

function readCookie(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : "";
}

export function PlanPreviewBanner() {
  const router = useRouter();
  const [preview, setPreview] = useState<{ side: string; plan: string } | null>(null);

  useEffect(() => {
    const raw = readCookie();
    const [side, plan] = raw.split(":");
    setPreview(side && plan ? { side, plan } : null);
  }, []);

  if (!preview) return null;
  const planLabel = LABELS[preview.plan] || preview.plan;
  const sideLabel = preview.side === "employer" ? "Employer" : "Candidate";

  function exit() {
    document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`;
    setPreview(null);
    router.refresh();
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-gold px-4 py-1.5 text-center text-xs font-semibold text-navy shadow-md">
      <span>
        Previewing as {planLabel} {sideLabel}
      </span>
      <button
        type="button"
        onClick={exit}
        className="inline-flex items-center gap-1 rounded-md bg-navy/15 px-2 py-0.5 font-semibold text-navy transition-colors hover:bg-navy/25"
      >
        <X className="h-3 w-3" /> Exit preview
      </button>
    </div>
  );
}
