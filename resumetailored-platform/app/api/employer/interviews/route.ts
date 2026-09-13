import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { listInterviews, createInterview, type InterviewInput } from "@/lib/employer-collab-store";
import { isInterviewMode, isInterviewStatus } from "@/lib/employer-ai";

export const runtime = "nodejs";

/** GET — this employer's interviews, soonest first. ?status=&applicantId= filter. */
export async function GET(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const filters: { status?: import("@/lib/employer-ai").InterviewStatus; applicantId?: number } = {};
  const status = url.searchParams.get("status");
  if (isInterviewStatus(status)) filters.status = status;
  const applicantId = Number(url.searchParams.get("applicantId"));
  if (Number.isFinite(applicantId) && applicantId > 0) filters.applicantId = applicantId;

  const interviews = await listInterviews(employerId, filters);
  return NextResponse.json({ interviews });
}

/** POST — schedule an interview. */
export async function POST(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as Partial<InterviewInput>;
  const applicantId = Number(b.applicantId);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "Pick a candidate." }, { status: 400 });
  if (!(b.title || "").trim()) return NextResponse.json({ error: "Give the interview a title." }, { status: 400 });
  if (!b.scheduledAt || !Number.isFinite(new Date(b.scheduledAt).getTime()))
    return NextResponse.json({ error: "Pick a date and time." }, { status: 400 });

  const interview = await createInterview(employerId, {
    applicantId,
    jobId: Number.isFinite(Number(b.jobId)) ? Number(b.jobId) : null,
    title: b.title || "",
    scheduledAt: new Date(b.scheduledAt).toISOString(),
    durationMin: Number(b.durationMin) || 30,
    mode: isInterviewMode(b.mode) ? b.mode : "video",
    location: b.location || "",
    interviewer: b.interviewer || "",
    notes: b.notes || "",
  });
  if (!interview) return NextResponse.json({ error: "Could not schedule (is this candidate yours?)." }, { status: 400 });
  return NextResponse.json({ interview });
}
