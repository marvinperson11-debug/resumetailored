import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { getInterview, signInterviewMedia } from "@/lib/employer-collab-store";
import { getRecordingDownloadLink } from "@/lib/daily";

export const runtime = "nodejs";

/**
 * Owner-scoped download for an interview's VIDEO recording. The video lives in
 * Daily's cloud (too large for Supabase), so we fetch a FRESH access link from
 * Daily on each request — raw recording links expire, a stored one would rot —
 * and 302-redirect to it. Falls back to a signed Supabase URL for any legacy
 * recording that was archived there before this change.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const iv = await getInterview(employerId, id);
  if (!iv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Preferred path: Daily cloud recording → fresh signed URL each time.
  if (iv.recordingId) {
    const link = await getRecordingDownloadLink(iv.recordingId);
    if (link) return NextResponse.redirect(link);
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  // Legacy: a recording that was uploaded to Supabase before we switched.
  if (iv.recordingUrl) {
    const signed = await signInterviewMedia(employerId, iv.recordingUrl);
    if (signed) return NextResponse.redirect(signed);
  }
  return NextResponse.json({ error: "not_available" }, { status: 404 });
}
