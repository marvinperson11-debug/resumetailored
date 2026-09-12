import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserProfile, saveUserProfile, type UserProfile } from "@/lib/profile-store";

export const runtime = "nodejs";

/** GET the signed-in user's profile + settings (defaults if none saved). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const profile = await getUserProfile(userId);
  return NextResponse.json({ profile });
}

/** POST a partial update to the profile / settings toggles. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Partial<UserProfile>;
  const patch: Partial<UserProfile> = {};
  for (const k of ["phone", "location", "linkedinUrl", "websiteUrl", "bio"] as const) {
    if (typeof b[k] === "string") patch[k] = b[k] as string;
  }
  for (const k of ["profilePublic", "emailProduct", "emailTips"] as const) {
    if (typeof b[k] === "boolean") patch[k] = b[k] as boolean;
  }
  const ok = await saveUserProfile(userId, patch);
  if (!ok) return NextResponse.json({ error: "Could not save. Is the database configured?" }, { status: 500 });
  const profile = await getUserProfile(userId);
  return NextResponse.json({ ok: true, profile });
}
