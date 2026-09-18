import { NextResponse } from "next/server";
import { requireEmployerId, employerContext } from "@/lib/employer-auth";
import {
  listInterviews,
  createInterview,
  setInterviewRoom,
  getInterview,
  monthlyVideoCount,
  type InterviewInput,
} from "@/lib/employer-collab-store";
import { notifyCandidateOfInterview, notifyInterviewerOfInterview } from "@/lib/employer-notify";
import { isInterviewMode, isInterviewStatus } from "@/lib/employer-ai";
import { checkVideoAllowance } from "@/lib/employer-plan";
import { createRoom, isDailyConfigured } from "@/lib/daily";

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

/** POST — schedule an interview. Video mode auto-creates a Daily room (tier
 *  gated), stores it on the row, and emails both sides the join link. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employerId = ctx.employerId;

  const b = (await req.json().catch(() => ({}))) as Partial<InterviewInput> & { recordEnabled?: boolean };
  const applicantId = Number(b.applicantId);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "Pick a candidate." }, { status: 400 });
  if (!(b.title || "").trim()) return NextResponse.json({ error: "Give the interview a title." }, { status: 400 });
  if (!b.scheduledAt || !Number.isFinite(new Date(b.scheduledAt).getTime()))
    return NextResponse.json({ error: "Pick a date and time." }, { status: 400 });

  const mode = isInterviewMode(b.mode) ? b.mode : "video";
  const scheduledAt = new Date(b.scheduledAt).toISOString();
  const durationMin = Number(b.durationMin) || 30;

  // Tier gating: video interviews are metered per calendar month.
  let allowance = null as ReturnType<typeof checkVideoAllowance> | null;
  if (mode === "video") {
    const used = await monthlyVideoCount(employerId);
    allowance = checkVideoAllowance(ctx.access, used);
    if (!allowance.allowed) {
      return NextResponse.json({ error: allowance.message, code: "video_limit" }, { status: 402 });
    }
  }
  const recordEnabled = mode === "video" && !!b.recordEnabled && !!allowance?.canRecord;
  // Trace exactly what the toggle sent vs. what we resolved, so a dropped
  // Record flag is diagnosable end-to-end ([daily.createRoom] shows the rest).
  console.log("[interviews POST] record decision", JSON.stringify({ mode, bodyRecordEnabled: !!b.recordEnabled, canRecord: !!allowance?.canRecord, recordEnabled }));

  const interview = await createInterview(employerId, {
    applicantId,
    jobId: Number.isFinite(Number(b.jobId)) ? Number(b.jobId) : null,
    title: b.title || "",
    scheduledAt,
    durationMin,
    mode,
    location: b.location || "",
    interviewer: b.interviewer || "",
    notes: b.notes || "",
    recordEnabled,
  });
  if (!interview) return NextResponse.json({ error: "Could not schedule (is this candidate yours?)." }, { status: 400 });

  // Video: auto-create a Daily room. Graceful degradation — if Daily is
  // unreachable, keep the interview with its manual link + a warning.
  let warning: string | undefined;
  let finalInterview = interview;
  if (mode === "video" && isDailyConfigured()) {
    const expUnix = Math.floor((new Date(scheduledAt).getTime() + durationMin * 60_000 + 24 * 60 * 60_000) / 1000);
    const room = await createRoom({ interviewId: interview.id, expUnix, enableRecording: recordEnabled });
    if (room) {
      await setInterviewRoom(employerId, interview.id, { roomUrl: room.url, roomName: room.name, location: room.url });
      finalInterview = (await getInterview(employerId, interview.id)) || { ...interview, roomUrl: room.url, roomName: room.name, location: room.url };
      // Guard: recording was requested but Daily didn't accept it — surface it
      // now instead of silently handing over a non-recordable room.
      if (recordEnabled && !room.recordingEnabled) {
        console.error("[interviews POST] recording requested but room created WITHOUT enable_recording", { interviewId: interview.id });
        warning = "The interview was scheduled, but recording could not be enabled on the video room. Delete and reschedule, or contact support — the call will not be recorded.";
      }
    } else {
      warning = "The interview was scheduled, but we couldn't create a video room automatically. Add a meeting link manually, or edit the interview to retry.";
    }
  } else if (mode === "video" && !isDailyConfigured()) {
    warning = "Video rooms aren't configured on this deployment (DAILY_API_KEY is unset). The interview was scheduled — add a meeting link manually.";
  }

  // Best-effort emails to both sides.
  notifyCandidateOfInterview(employerId, finalInterview, "scheduled").catch(() => {});
  notifyInterviewerOfInterview(employerId, ctx.userId, finalInterview).catch(() => {});

  return NextResponse.json({ interview: finalInterview, warning });
}
