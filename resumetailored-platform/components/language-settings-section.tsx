"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Languages, Check } from "lucide-react";
import { LOCALES, type Locale } from "@/i18n/locales";
import { setLocaleCookie } from "./language-switcher";

const FLAGS: Record<Locale, string> = { en: "🇺🇸", zh: "🇨🇳", es: "🇪🇸", hi: "🇮🇳", fr: "🇫🇷" };

/**
 * "Language" Settings card — shared by the candidate, employer, and employee
 * Settings pages. Saves the account-wide preference (Clerk
 * publicMetadata.locale, via lib/locale-pref.ts) that i18n/request.ts falls
 * back to on a device with no `rt_locale` cookie yet (a first visit, or the
 * emails a *-notify.ts sender writes with no request context at all) — and
 * also sets the cookie itself, so THIS device reflects the change immediately
 * without waiting on the round-trip.
 */
export function LanguageSettingsSection() {
  const locale = useLocale() as Locale;
  const t = useTranslations("lang");
  const ts = useTranslations("shell.languagePref");
  const router = useRouter();
  const [saving, setSaving] = useState<Locale | null>(null);
  const [saved, setSaved] = useState(false);

  async function pick(code: Locale) {
    if (code === locale) return;
    setSaving(code);
    setSaved(false);
    setLocaleCookie(code);
    try {
      await fetch("/api/profile/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: code }),
      });
      setSaved(true);
    } catch {
      /* the cookie switch below still applies this device's UI language */
    } finally {
      setSaving(null);
      router.refresh();
    }
  }

  return (
    <div className="rounded-2xl border border-border-gold bg-white/[0.03] p-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-cream">
        <Languages className="h-4 w-4 text-violet" /> {t("label")}
      </h2>
      <p className="mb-4 text-xs text-white/50">
        {ts("description")}
      </p>
      <div className="flex flex-wrap gap-2">
        {LOCALES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => pick(code)}
            disabled={saving !== null}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              locale === code ? "border-violet bg-violet/15 text-violet" : "border-border-gold text-muted-cream hover:bg-white/5"
            }`}
          >
            <span aria-hidden>{FLAGS[code]}</span>
            {t(code)}
            {locale === code && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
      </div>
      {saved && <p className="mt-3 flex items-center gap-1 text-xs text-teal"><Check className="h-3.5 w-3.5" /> {ts("saved")}</p>}
    </div>
  );
}
