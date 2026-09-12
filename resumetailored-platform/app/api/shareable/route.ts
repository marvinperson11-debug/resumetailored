import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getMyProfile, upsertProfile, usernameAvailable, cleanUsername, type ShareableProfile } from "@/lib/shareable-store";

export const runtime = "nodejs";

/** The user's own shareable profile, or a username-availability check.
 *  FREE for every signed-in user (no Pro gate). */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const url = new URL(req.url);
  const check = url.searchParams.get("check");
  if (check != null) {
    const u = cleanUsername(check);
    if (!u) return NextResponse.json({ available: false, reason: "invalid" });
    return NextResponse.json({ available: await usernameAvailable(u, userId), normalized: u });
  }

  const profile = await getMyProfile(userId);
  const origin = url.origin;
  return NextResponse.json({
    profile,
    url: profile ? `${origin}/u/${profile.username}` : null,
  });
}

/** Create or update the profile. Username must be unique across the platform. */
export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Partial<ShareableProfile> & { username?: string };
  if (!body.username) return NextResponse.json({ error: "invalid_username", message: "Pick a username first." }, { status: 400 });

  const res = await upsertProfile(userId, { ...body, username: body.username });
  if (!res.ok) {
    const status = res.error === "username_taken" ? 409 : res.error === "invalid_username" ? 400 : 500;
    const message =
      res.error === "username_taken" ? "That username is taken — try another."
      : res.error === "invalid_username" ? "Username must be 3–30 letters, numbers or hyphens."
      : "Could not save (is the shareable_profiles table set up?).";
    return NextResponse.json({ error: res.error, message }, { status });
  }
  const origin = new URL(req.url).origin;
  return NextResponse.json({ profile: res.profile, url: `${origin}/u/${res.profile.username}` });
}
