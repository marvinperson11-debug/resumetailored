/**
 * Pure locale constants/helpers — no server-only imports (no `cookies()`,
 * `headers()`, or Clerk), so this file is safe to import from CLIENT
 * components (the language switcher, the Settings language picker) as well
 * as server code. `i18n/request.ts` (the next-intl request-config entry
 * point, which DOES need server-only APIs) re-exports these for convenience,
 * but anything reachable from a "use client" component must import from
 * HERE, not from request.ts — importing a value (not just a type) from
 * request.ts pulls its `@clerk/nextjs/server` import into the client bundle
 * and breaks the build.
 */
export const LOCALES = ["en", "zh", "es", "hi", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "rt_locale";

export function resolveLocale(value: string | undefined | null): Locale {
  return (LOCALES as readonly string[]).includes(value || "") ? (value as Locale) : DEFAULT_LOCALE;
}

/** Pick the first supported locale from an Accept-Language header, e.g.
 *  "fr-FR,fr;q=0.9,en;q=0.8" → "fr". Only consulted when no cookie/saved
 *  preference exists yet — a first-visit default, never an override. */
export function pickFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const tags = header.split(",").map((part) => part.split(";")[0].trim().toLowerCase());
  for (const tag of tags) {
    const base = tag.split("-")[0];
    if ((LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return null;
}
