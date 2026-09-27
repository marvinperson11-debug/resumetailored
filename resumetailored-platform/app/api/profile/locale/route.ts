import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { setUserLocalePreference } from "@/lib/locale-pref";
import { LOCALES } from "@/i18n/locales";

export const runtime = "nodejs";

/** POST { locale } → saves the signed-in user's account-wide language
 *  preference (Settings). Client also sets the `rt_locale` cookie itself so
 *  the change is visible immediately without waiting on this round-trip. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as { locale?: string };
  if (!(LOCALES as readonly string[]).includes(b.locale || "")) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const ok = await setUserLocalePreference(b.locale!);
  if (!ok) return NextResponse.json({ error: "Could not save your language preference." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
