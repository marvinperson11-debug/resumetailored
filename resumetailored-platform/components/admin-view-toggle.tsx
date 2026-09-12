"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Admin-only Candidate/Employer view switcher (top bar). */
export function AdminViewToggle() {
  const pathname = usePathname();
  const t = useTranslations("topbar");
  const onEmployer = pathname.startsWith("/employer");
  const cls = (active: boolean) =>
    cn("rounded-full px-2.5 py-1 text-xs font-semibold transition-colors", active ? "bg-gold text-navy" : "text-muted-cream hover:text-cream");
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-gold/40 bg-gold/10 p-0.5" title={t("admin")}>
      <Link href="/candidate" className={cls(!onEmployer)}>{t("candidateView")}</Link>
      <Link href="/employer" className={cls(onEmployer)}>{t("employerView")}</Link>
    </div>
  );
}
