import { NextResponse, type NextRequest } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { getInterview, signInterviewMedia } from "@/lib/employer-collab-store";

export const runtime = "nodejs";

/**
 * Redirect to a short-lived signed URL for an interview's recording or
 * transcript (private bucket). Owner-scoped. `?type=recording|transcript`.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const iv = await getInterview(employerId, id);
  if (!iv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const type = req.nextUrl.searchParams.get("type") === "transcript" ? "transcript" : "recording";
  const path = type === "transcript" ? iv.transcriptUrl : iv.recordingUrl;
  if (!path) return NextResponse.json({ error: "not_available" }, { status: 404 });

  const signed = await signInterviewMedia(employerId, path);
  if (!signed) return NextResponse.json({ error: "not_available" }, { status: 404 });
  return NextResponse.redirect(signed);
}
