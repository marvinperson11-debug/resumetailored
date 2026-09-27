import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { LOCALES, resolveLocale, pickFromAcceptLanguage, DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from "./locales";

/**
 * Cookie-based locale (no i18n routing) — the language switcher writes the
 * `rt_locale` cookie and calls router.refresh(); server components re-render
 * with the new locale and the client provider picks up the new messages.
 *
 * Resolution order when no cookie is set yet (a first visit, or a new
 * device): the signed-in user's saved Settings preference (Clerk
 * publicMetadata.locale — see lib/locale-pref.ts), then the browser's
 * Accept-Language header, then DEFAULT_LOCALE. The cookie always wins once
 * set, so a quick switch from the top-bar dropdown never fights the saved
 * account default.
 */
export default getRequestConfig(async () => {
  const cookieValue = cookies().get(LOCALE_COOKIE)?.value;

  let locale: Locale;
  if (cookieValue) {
    locale = resolveLocale(cookieValue);
  } else {
    let saved: Locale | null = null;
    try {
      const user = await currentUser();
      const raw = (user?.publicMetadata as { locale?: string } | undefined)?.locale;
      if (raw && (LOCALES as readonly string[]).includes(raw)) saved = raw as Locale;
    } catch {
      /* signed out (or Clerk unavailable for this request) — fall through */
    }
    locale = saved ?? pickFromAcceptLanguage(headers().get("accept-language")) ?? DEFAULT_LOCALE;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
