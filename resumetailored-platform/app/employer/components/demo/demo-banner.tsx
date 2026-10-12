"use client";

import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { useEmployerDemo } from "./demo-provider";

/** Top of every page in the anonymous employer taste: this is sample data, and here is the way out of it. */
export function DemoBanner() {
  const t = useTranslations("employerDemo");
  const demo = useEmployerDemo();
  return (
    <div
      role="status"
      data-employer-demo-banner
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm text-cream"
    >
      <span className="min-w-[12rem] flex-1 leading-snug">{t("banner")}</span>
      <button
        type="button"
        onClick={() => demo?.startSignUp()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold px-3.5 py-1.5 text-xs font-bold text-navy transition-opacity hover:opacity-90"
      >
        <Sparkles className="h-3.5 w-3.5" /> {t("createAccount")}
      </button>
    </div>
  );
}
