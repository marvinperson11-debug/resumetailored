import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { saveProfile } from "@/lib/career-store";

export const runtime = "nodejs";

/** Upsert the user's career profile. Free — everyone gets a profile. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { currentRole?: string; targetRole?: string; industry?: string; yearsExperience?: number | string };
  const yrs = Number(b.yearsExperience);
  const ok = await saveProfile(userId, {
    currentRole: (b.currentRole || "").toString().slice(0, 120),
    targetRole: (b.targetRole || "").toString().slice(0, 120),
    industry: (b.industry || "").toString().slice(0, 60),
    yearsExperience: Number.isFinite(yrs) && yrs >= 0 ? Math.min(60, Math.round(yrs)) : null,
  });
  return NextResponse.json({ ok });
}
