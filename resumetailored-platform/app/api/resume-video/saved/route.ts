import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseVideoBackend } from "@/lib/saved-videos-store";
import { listSavedVideos, MAX_SAVED_VIDEOS } from "@/lib/saved-videos";

export const runtime = "nodejs";

/**
 * The signed-in user's saved resume videos, newest first — summaries only (no resume text, no headshot);
 * "Edit" fetches one video's full setup from /saved/[id]. Owner-only: the list is scoped by the session's user id.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", videos: [] }, { status: 401 });
  const be = supabaseVideoBackend();
  if (!be) return NextResponse.json({ videos: [], max: MAX_SAVED_VIDEOS });
  const rows = await listSavedVideos(be, userId);
  return NextResponse.json({
    max: MAX_SAVED_VIDEOS,
    videos: rows.map((r) => ({
      id: r.id,
      title: r.title,
      scriptSource: r.scriptSource,
      toWhom: r.toWhom,
      voice: r.settings.voice,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt,
    })),
  });
}
