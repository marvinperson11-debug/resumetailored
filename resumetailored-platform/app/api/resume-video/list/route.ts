import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { listVideoGenerations } from "@/lib/video-generations";

export const runtime = "nodejs";

/** List the signed-in user's generated resume videos (with public URLs) so the
 *  Personal Website tool can offer them for embedding. Pro-only. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", videos: [] }, { status: 401 });
  if (!(await isPro())) return NextResponse.json({ error: "pro_required", videos: [] }, { status: 402 });
  const videos = await listVideoGenerations(userId);
  return NextResponse.json({ videos });
}
