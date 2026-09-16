import { NextResponse } from "next/server";
import {
  verifyDailySignature,
  interviewIdFromRoomName,
  getRecordingDownloadLink,
  getRecording,
  getTranscriptText,
  downloadToBuffer,
} from "@/lib/daily";
import {
  getInterviewOwner,
  updateInterviewMedia,
  uploadInterviewMedia,
} from "@/lib/employer-collab-store";
import { getApplicant } from "@/lib/employer-store";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildInterviewSummaryPrompt, normalizeInterviewSummary } from "@/lib/employer-ai";
import { canUseAiSummaryForTier } from "@/lib/employer-plan";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Daily.co Connect webhook. On `recording.ready-to-download`, archive the
 * recording + transcript to the private interview-recordings bucket, mark the
 * interview completed, and (Scale+ tiers) generate an AI summary from the
 * transcript. Optional HMAC verification via DAILY_WEBHOOK_SECRET. Best-effort:
 * partial failures never break the 200 response (Daily retries otherwise).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.DAILY_WEBHOOK_SECRET || "";
  const ok = verifyDailySignature(raw, req.headers.get("x-webhook-timestamp"), req.headers.get("x-webhook-signature"), secret);
  if (!ok) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  // Daily's test/verification pings and other event types are acknowledged.
  const type = String(body.type || body.event || "");
  const payload = (body.payload as Record<string, unknown>) || {};
  if (!/recording/i.test(type) || !/ready/i.test(type)) {
    return NextResponse.json({ ok: true, ignored: type || "unknown" });
  }

  const recordingId = String(payload.recording_id || payload.recordingId || payload.id || "");
  const roomName = String(payload.room_name || payload.roomName || "");
  const interviewId = interviewIdFromRoomName(roomName);
  if (!interviewId) return NextResponse.json({ ok: true, note: "no interview for room" });

  const owner = await getInterviewOwner(interviewId);
  if (!owner || !owner.employerId) return NextResponse.json({ ok: true, note: "interview not found" });

  try {
    let recordingUrl: string | undefined;
    let transcriptUrl: string | undefined;

    // Recording → private bucket.
    if (recordingId) {
      const dl = await getRecordingDownloadLink(recordingId);
      if (dl) {
        const buf = await downloadToBuffer(dl);
        if (buf) {
          const path = await uploadInterviewMedia(owner.employerId, interviewId, {
            data: buf,
            contentType: "video/mp4",
            filename: "recording.mp4",
          });
          if (path) recordingUrl = path;
        }
      }
    }

    // Transcript (best-effort; requires transcription enabled on the Daily domain).
    const rec = recordingId ? await getRecording(recordingId) : null;
    const transcript = rec?.sessionId ? await getTranscriptText(rec.sessionId) : null;
    if (transcript) {
      const path = await uploadInterviewMedia(owner.employerId, interviewId, {
        data: Buffer.from(transcript, "utf8"),
        contentType: "text/plain",
        filename: "transcript.txt",
      });
      if (path) transcriptUrl = path;
    }

    // AI summary (Scale+ tiers) from the transcript.
    let aiSummary;
    if (transcript && (await canUseAiSummaryForTier(owner.employerId))) {
      const anthropic = getAnthropic();
      if (anthropic) {
        try {
          const applicant = await getApplicant(owner.employerId, owner.applicantId);
          const { system, user } = buildInterviewSummaryPrompt({
            transcript,
            jobTitle: owner.jobTitle,
            candidateName: applicant?.name,
          });
          const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1400, system, messages: [{ role: "user", content: user }] });
          const block = msg.content[0];
          const parsed = extractJson(block && block.type === "text" ? block.text : "");
          if (parsed) aiSummary = normalizeInterviewSummary(parsed);
        } catch (e) {
          if (!isProviderUnavailable(e)) console.error("[daily webhook] summary failed", e);
        }
      }
    }

    await updateInterviewMedia(interviewId, { recordingUrl, transcriptUrl, aiSummary, status: "completed" });
  } catch (e) {
    console.error("[daily webhook] processing failed", e);
    // Still 200 so Daily doesn't hammer retries; the manual-complete fallback remains.
  }

  return NextResponse.json({ ok: true });
}
