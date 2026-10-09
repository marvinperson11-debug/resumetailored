import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseVideoBackend } from "@/lib/saved-videos-store";
import { getSavedVideo, deleteSavedVideo } from "@/lib/saved-videos";

export const runtime = "nodejs";

/** One saved video's full setup (script, source, voice, colour, headshot + position, opener/closer, recipient,
 *  resume text) so the creator can be pre-filled exactly as it was made. Owner-only; someone else's id is a 404. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const be = supabaseVideoBackend();
  const row = be ? await getSavedVideo(be, userId, params.id) : null;
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    video: {
      id: row.id,
      title: row.title,
      script: row.script,
      scriptSource: row.scriptSource,
      scriptEdited: row.scriptEdited,
      toWhom: row.toWhom,
      opener: row.opener,
      closer: row.closer,
      template: row.template,
      resumeText: row.resumeText,
      settings: row.settings,
      createdAt: row.createdAt,
    },
  });
}

/** Delete a saved video: its MP4 and script file, then the row. Owner-only. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const be = supabaseVideoBackend();
  const ok = be ? await deleteSavedVideo(be, userId, params.id) : false;
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
