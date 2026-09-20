"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Admin-only plan-preview switcher. Lives at the bottom of the sidebar, next to
 * the Candidate/Employer toggle. Forces getAccess() to report the chosen plan
 * for the session via the `rt_plan_preview` cookie, which the server only honors
 * AFTER the admin id check — so a non-admin forging the cookie gets nothing.
 * Visibility is gated by the caller (admin only).
 */
const COOKIE = "rt_plan_preview";

const EMPLOYER_OPTS: { plan: string; label: string }[] = [
  { plan: "free", label: "Free" },
  { plan: "portal", label: "Portal" },
  { plan: "scale", label: "Scale" },
  { plan: "corporate", label: "Corporate" },
];
const CANDIDATE_OPTS: { plan: string; label: string }[] = [
  { plan: "free", label: "Free" },
  { plan: "pro", label: "Pro" },
];

function readCookie(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : "";
}

export function PlanPreviewSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const side: "employer" | "candidate" = pathname.startsWith("/employer") ? "employer" : "candidate";
  const opts = side === "employer" ? EMPLOYER_OPTS : CANDIDATE_OPTS;
  const [current, setCurrent] = useState("");

  useEffect(() => {
    const raw = readCookie();
    const [s, p] = raw.split(":");
    setCurrent(s === side ? p || "" : "");
  }, [side]);

  function choose(plan: string) {
    const next = plan === current ? "" : plan; // click the active chip to clear
    if (next) {
      document.cookie = `${COOKIE}=${encodeURIComponent(`${side}:${next}`)}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
    } else {
      document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`;
    }
    setCurrent(next);
    router.refresh();
  }

  return (
    <div className="mt-2 rounded-lg border border-gold/30 bg-gold/5 p-1.5">
      <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gold/80">Preview plan</div>
      <div className="flex flex-wrap gap-1">
        {opts.map((o) => (
          <button
            key={o.plan}
            type="button"
            onClick={() => choose(o.plan)}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
              current === o.plan ? "bg-gold text-navy shadow-[0_0_12px_rgba(194,135,11,0.35)]" : "bg-white/5 text-muted-cream hover:text-cream"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
