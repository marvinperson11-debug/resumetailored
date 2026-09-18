import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { getInterview } from "@/lib/employer-collab-store";
import { createMeetingToken } from "@/lib/daily";

export const runtime = "nodejs";

/**
 * Host join link for the employer's "Join" button. For a recording-enabled
 * interview it mints an owner meeting token with `start_cloud_recording` so
 * cloud recording AUTO-STARTS when the host joins (a server-created public room
 * has no interactive Record click, so without this recording never starts —
 * which is why earlier sessions produced 0 recorded minutes). Then 302-redirects
 * into the Daily room. The candidate keeps joining via the plain emailed room
 * URL; recording is triggered by the host's token and covers the whole session.
 *
 * Auth-gated (employer session cookie); the candidate never uses this route.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.redirect(new URL("/sign-in", _req.url));

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.redirect(new URL("/employer/scheduler", _req.url));

  const iv = await getInterview(employerId, id);
  if (!iv || !iv.roomUrl) return NextResponse.redirect(new URL("/employer/scheduler", _req.url));

  let target = iv.roomUrl;
  if (iv.recordEnabled && iv.roomName) {
    // Token valid comfortably past the meeting end.
    const base = new Date(iv.scheduledAt).getTime() || Date.now();
    const expUnix = Math.floor((base + (iv.durationMin || 30) * 60_000 + 6 * 60 * 60_000) / 1000);
    const token = await createMeetingToken({ roomName: iv.roomName, expUnix, isOwner: true, startCloudRecording: true });
    if (token) target = `${iv.roomUrl}?t=${encodeURIComponent(token)}`;
    else console.error("[interviews/join] token mint failed; joining without auto-record", { id });
  }
  return NextResponse.redirect(target);
}
