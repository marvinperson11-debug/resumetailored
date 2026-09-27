"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/locales";

export const LOCALE_COOKIE = "rt_locale";

/** Persist the locale in a cookie the server reads (i18n/request.ts). */
export function setLocaleCookie(locale: string) {
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=31536000;samesite=lax`;
  } catch {
    /* ignore */
  }
}

const OPTIONS: { code: Locale; flag: string }[] = [
  { code: "en", flag: "🇺🇸" },
  { code: "zh", flag: "🇨🇳" },
  { code: "es", flag: "🇪🇸" },
  { code: "hi", flag: "🇮🇳" },
  { code: "fr", flag: "🇫🇷" },
];

/**
 * Language dropdown — five locales (English, 中文, Español, हिन्दी, Français).
 * Writes the cookie and refreshes so server + client components re-render in
 * the chosen language. A dropdown rather than a row of chips: five options no
 * longer fit comfortably as inline pills, especially on mobile where the
 * switcher sits centered in a 16-unit-tall top bar.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("lang");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const pick = (code: Locale) => {
    setOpen(false);
    if (code === locale) return;
    setLocaleCookie(code);
    router.refresh();
  };

  const current = OPTIONS.find((o) => o.code === locale) ?? OPTIONS[0];

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("label")}
        className="flex items-center gap-1.5 rounded-full border border-border-gold bg-white/5 px-2.5 py-1 text-xs font-medium text-muted-cream transition-colors hover:text-cream"
      >
        <span aria-hidden className="text-sm leading-none">{current.flag}</span>
        <span className="hidden sm:inline">{t(current.code)}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("label")}
          className="absolute left-1/2 top-full z-20 mt-1.5 w-40 -translate-x-1/2 overflow-hidden rounded-lg border border-border-gold bg-navy shadow-xl"
        >
          {OPTIONS.map((o) => (
            <button
              key={o.code}
              type="button"
              role="option"
              aria-selected={locale === o.code}
              onClick={() => pick(o.code)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                locale === o.code ? "bg-violet/15 text-violet" : "text-cream hover:bg-white/5"
              )}
            >
              <span aria-hidden className="text-sm leading-none">{o.flag}</span>
              <span className="flex-1">{t(o.code)}</span>
              {locale === o.code && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
