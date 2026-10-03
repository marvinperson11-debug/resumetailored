import { NextResponse } from "next/server";
import { requireEmployerId, employerContext } from "@/lib/employer-auth";
import { checkVideoAllowance } from "@/lib/employer-plan";
import { updateInterview, deleteInterview, getInterview, monthlyVideoCount, recordVideoInterview, type InterviewInput } from "@/lib/employer-collab-store";
import { notifyCandidateOfInterview } from "@/lib/employer-notify";
import { isInterviewMode, isInterviewStatus, type InterviewStatus } from "@/lib/employer-ai";
import { deleteRoom } from "@/lib/daily";

export const runtime = "nodejs";

/** PATCH — reschedule, edit, cancel, or complete an interview. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as Partial<InterviewInput> & { status?: string };
  const patch: Partial<InterviewInput> & { status?: InterviewStatus } = {};
  let switchedToVideo = false;
  if (b.title !== undefined) patch.title = String(b.title);
  if (b.scheduledAt !== undefined) {
    if (!Number.isFinite(new Date(b.scheduledAt).getTime())) return NextResponse.json({ error: "bad date" }, { status: 400 });
    patch.scheduledAt = new Date(b.scheduledAt).toISOString();
  }
  if (b.durationMin !== undefined) patch.durationMin = Number(b.durationMin) || 30;
  if (b.mode !== undefined) {
    if (!isInterviewMode(b.mode)) return NextResponse.json({ error: "bad mode" }, { status: 400 });
    // Switching an existing interview TO video spends a video-interview slot, same as creating one.
    if (b.mode === "video") {
      const cur = await getInterview(employerId, id);
      if (cur && cur.mode !== "video") {
        const ctx = await employerContext();
        if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
        const allowance = checkVideoAllowance(ctx.access, await monthlyVideoCount(employerId));
        if (!allowance.allowed) return NextResponse.json({ error: allowance.message, code: "video_limit" }, { status: 402 });
        switchedToVideo = true;
      }
    }
    patch.mode = b.mode;
  }
  if (b.location !== undefined) patch.location = String(b.location);
  if (b.interviewer !== undefined) patch.interviewer = String(b.interviewer);
  if (b.notes !== undefined) patch.notes = String(b.notes);
  if (b.jobId !== undefined) patch.jobId = Number.isFinite(Number(b.jobId)) ? Number(b.jobId) : null;
  if (b.status !== undefined) {
    if (!isInterviewStatus(b.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
    patch.status = b.status;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const ok = await updateInterview(employerId, id, patch);
  if (!ok) return NextResponse.json({ error: "Could not update the interview." }, { status: 400 });
  if (switchedToVideo) await recordVideoInterview(employerId);
  // Best-effort: email the candidate when the interview is cancelled or moved,
  // and free the Daily room on cancel.
  if (patch.status === "cancelled" || patch.scheduledAt !== undefined) {
    getInterview(employerId, id)
      .then((iv) => {
        if (!iv) return;
        if (patch.status === "cancelled" && iv.roomName) deleteRoom(iv.roomName).catch(() => {});
        return notifyCandidateOfInterview(employerId, iv, patch.status === "cancelled" ? "cancelled" : "rescheduled");
      })
      .catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

/** DELETE — remove an interview. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  // Free the Daily room before deleting the row (best-effort).
  const existing = await getInterview(employerId, id);
  if (existing?.roomName) deleteRoom(existing.roomName).catch(() => {});
  const ok = await deleteInterview(employerId, id);
  return NextResponse.json({ ok });
}
