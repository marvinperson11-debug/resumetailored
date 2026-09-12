"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export const LOCALE_COOKIE = "rt_locale";

/** Persist the locale in a cookie the server reads (i18n/request.ts). */
export function setLocaleCookie(locale: string) {
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=31536000;samesite=lax`;
  } catch {
    /* ignore */
  }
}

const OPTIONS = [
  { code: "en", flag: "🇺🇸", label: "English" },
  { code: "zh", flag: "🇨🇳", label: "中文" },
];

/** Flag-based language toggle. Writes the cookie and refreshes so server +
 *  client components re-render in the chosen language. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();

  const pick = (code: string) => {
    if (code === locale) return;
    setLocaleCookie(code);
    router.refresh();
  };

  return (
    <div className={cn("flex items-center gap-0.5 rounded-full border border-border-gold bg-white/5 p-0.5", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.code}
          type="button"
          onClick={() => pick(o.code)}
          aria-pressed={locale === o.code}
          aria-label={o.label}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            locale === o.code ? "bg-violet text-white" : "text-muted-cream hover:text-cream"
          )}
        >
          <span aria-hidden className="text-sm leading-none">{o.flag}</span>
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
