import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

/**
 * Cookie-based locale (no i18n routing) — the language switcher writes the
 * `rt_locale` cookie and calls router.refresh(); server components re-render
 * with the new locale and the client provider picks up the new messages.
 */
export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "rt_locale";

export function resolveLocale(value: string | undefined | null): Locale {
  return (LOCALES as readonly string[]).includes(value || "") ? (value as Locale) : DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const store = cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
