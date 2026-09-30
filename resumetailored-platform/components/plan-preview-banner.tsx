"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("planPreview");
  const [preview, setPreview] = useState<{ side: string; plan: string } | null>(null);

  const pathname = usePathname();

  // The cookie is the source of truth for the active preview. Re-read it on every
  // navigation, on tab focus, and when the switcher announces a change — reading
  // it once on mount left the banner stale (e.g. "Previewing as Pro Candidate"
  // after the state had gone back to Free).
  useEffect(() => {
    const sync = () => {
      const [side, plan] = readCookie().split(":");
      setPreview(side && plan ? { side, plan } : null);
    };
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("rt-plan-preview-change", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("rt-plan-preview-change", sync);
    };
  }, [pathname]);

  if (!preview) return null;
  const planLabel = LABELS[preview.plan] || preview.plan;
  const sideLabel = preview.side === "employer" ? t("side.employer") : t("side.candidate");

  function exit() {
    document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`;
    setPreview(null);
    window.dispatchEvent(new Event("rt-plan-preview-change"));
    router.refresh();
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-gold px-4 py-1.5 text-center text-xs font-semibold text-navy shadow-md">
      <span>
        {t("previewingAs", { plan: planLabel, side: sideLabel })}
      </span>
      <button
        type="button"
        onClick={exit}
        className="inline-flex items-center gap-1 rounded-md bg-navy/15 px-2 py-0.5 font-semibold text-navy transition-colors hover:bg-navy/25"
      >
        <X className="h-3 w-3" /> {t("exit")}
      </button>
    </div>
  );
}
