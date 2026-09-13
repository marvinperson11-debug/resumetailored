"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Admin-only Candidate/Employer view switcher. Lives at the BOTTOM of the
 * sidebar (candidate + employer), above Sign out — never in the top bar.
 * Rendered as a small, subtle segmented toggle with a gold accent on the
 * active view. Visibility is gated by the caller (admin only).
 */
export function AdminViewToggle({ className }: { className?: string }) {
  const pathname = usePathname();
  const t = useTranslations("topbar");
  const onEmployer = pathname.startsWith("/employer");
  const cls = (active: boolean) =>
    cn(
      "flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-center text-xs font-semibold transition-colors",
      active ? "bg-gold text-navy shadow-[0_0_12px_rgba(194,135,11,0.35)]" : "bg-white/5 text-muted-cream hover:text-cream"
    );
  return (
    <div className={cn("flex items-center gap-1 rounded-lg border border-gold/30 bg-gold/5 p-0.5", className)} title={t("admin")}>
      <Link href="/candidate" className={cls(!onEmployer)}>
        👤 Candidate
      </Link>
      <Link href="/employer" className={cls(onEmployer)}>
        🏢 Employer
      </Link>
    </div>
  );
}
