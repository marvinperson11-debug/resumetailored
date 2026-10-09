import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limit";
import { isIndividualPro } from "@/lib/plan";
import { cleanVideoSettings, MAX_HEADSHOT_DATA_URL_CHARS } from "@/lib/video-settings";
import { getVideoSettings, saveVideoSettings } from "@/lib/video-settings-store";

export const runtime = "nodejs";

/** The signed-in Pro user's saved Video settings (voice, background, headshot + placement). */
export async function GET(req: Request) {
  const limited = rateLimit(req, "resume-video-settings");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  return NextResponse.json({ settings: await getVideoSettings(userId) });
}

export async function PUT(req: Request) {
  const limited = rateLimit(req, "resume-video-settings");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  if (!(await isIndividualPro())) return NextResponse.json({ error: "pro_required" }, { status: 402 });

  const raw = (await req.json().catch(() => null)) as { settings?: { headshot?: unknown } } | null;
  const given = raw?.settings;
  if (!given || typeof given !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const settings = cleanVideoSettings(given);
  // A headshot that was sent but didn't pass validation is an error the user should see — not a silent drop.
  if (typeof given.headshot === "string" && given.headshot && !settings.headshot) {
    const tooBig = given.headshot.length > MAX_HEADSHOT_DATA_URL_CHARS;
    return NextResponse.json({ error: tooBig ? "headshot_too_large" : "headshot_invalid" }, { status: 400 });
  }
  const ok = await saveVideoSettings(userId, settings);
  // Persisting is best-effort (e.g. before the migration is run): the settings still apply to this session.
  return NextResponse.json({ ok, saved: ok, settings });
}
