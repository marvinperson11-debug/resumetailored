import { currentUser, clerkClient } from "@clerk/nextjs/server";
import { LOCALES, resolveLocale, DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

/**
 * Per-account locale preference, stored on Clerk `publicMetadata.locale` —
 * same storage convention as `plan`/`tier` in lib/plan.ts. This is the
 * account-wide default a signed-in user sets in Settings; it's read by
 * i18n/request.ts as a fallback when no device cookie is set yet, and by
 * server-side email senders (which have no request/cookie context at all —
 * see `getRecipientLocale`).
 */

function readLocaleFromMetadata(meta: unknown): Locale | null {
  const raw = (meta as { locale?: string } | null | undefined)?.locale;
  return raw && (LOCALES as readonly string[]).includes(raw) ? (raw as Locale) : null;
}

/** The signed-in user's saved locale preference, or null if unset/signed out. */
export async function getUserLocalePreference(): Promise<Locale | null> {
  try {
    const user = await currentUser();
    return readLocaleFromMetadata(user?.publicMetadata);
  } catch {
    return null;
  }
}

/** Persist the signed-in user's locale preference — called from Settings.
 *  Best-effort; never throws. */
export async function setUserLocalePreference(locale: string): Promise<boolean> {
  try {
    const user = await currentUser();
    if (!user) return false;
    const client = await clerkClient();
    await client.users.updateUserMetadata(user.id, { publicMetadata: { locale: resolveLocale(locale) } });
    return true;
  } catch {
    return false;
  }
}

/** The locale to send an email in for a specific Clerk user id — server-only,
 *  no request/cookie context (used by the *-notify.ts senders, which run
 *  outside any page request). Falls back to DEFAULT_LOCALE (English) when
 *  unset, the id is missing, or Clerk is unreachable. */
export async function getRecipientLocale(userId: string | null | undefined): Promise<Locale> {
  if (!userId) return DEFAULT_LOCALE;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return readLocaleFromMetadata(user.publicMetadata) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
