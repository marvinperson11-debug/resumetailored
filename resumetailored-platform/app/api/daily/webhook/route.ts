import { NextResponse } from "next/server";
import {
  verifyDailySignature,
  interviewIdFromRoomName,
  getRecording,
  getTranscriptText,
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

/** Only small assets go to Supabase Storage (50MB per-object hard limit). The
 *  video never does — it stays in Daily's cloud. Transcript/audio must be under
 *  this to be archived; anything larger is skipped rather than 413'ing. */
const MAX_SUPABASE_ASSET_BYTES = 10 * 1024 * 1024;

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
  // Log delivery + payload so the whole path is verifiable from Railway.
  console.log("[daily webhook] received", JSON.stringify({ type, roomName, recordingId, interviewId, payload }).slice(0, 800));
  if (!interviewId) return NextResponse.json({ ok: true, note: "no interview for room" });

  const owner = await getInterviewOwner(interviewId);
  if (!owner || !owner.employerId) {
    console.error("[daily webhook] no owner for interview", { interviewId, roomName });
    return NextResponse.json({ ok: true, note: "interview not found" });
  }

  try {
    let transcriptUrl: string | undefined;

    // The VIDEO stays in Daily's cloud storage — a 2-min interview is ~100MB+,
    // far over Supabase Storage's 50MB per-object limit (uploading it 413'd and
    // the interview never completed). We store only Daily's recording id; the
    // download route fetches a fresh signed URL from Daily on demand.
    const dailyRecordingId = recordingId || undefined;

    // Transcript (best-effort; requires transcription enabled on the Daily
    // domain). Small text, safe to archive — but still size-guarded so no large
    // asset can 413 the way the video did.
    const rec = recordingId ? await getRecording(recordingId) : null;
    const transcript = rec?.sessionId ? await getTranscriptText(rec.sessionId) : null;
    if (transcript) {
      const buf = Buffer.from(transcript, "utf8");
      if (buf.length <= MAX_SUPABASE_ASSET_BYTES) {
        const path = await uploadInterviewMedia(owner.employerId, interviewId, {
          data: buf,
          contentType: "text/plain",
          filename: "transcript.txt",
        });
        if (path) transcriptUrl = path;
      } else {
        console.error("[daily webhook] transcript too large for Supabase; skipping upload", { interviewId, bytes: buf.length });
      }
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

    // Video alone completes the interview — transcript is best-effort and may be
    // absent (transcription not enabled on the domain).
    const updated = await updateInterviewMedia(interviewId, { recordingId: dailyRecordingId, transcriptUrl, aiSummary, status: "completed" });
    console.log("[daily webhook] interview updated", JSON.stringify({ interviewId, recordingId: dailyRecordingId, hasTranscript: !!transcriptUrl, status: "completed", updated }));
  } catch (e) {
    console.error("[daily webhook] processing failed", e);
    // Still 200 so Daily doesn't hammer retries; the manual-complete fallback remains.
  }

  return NextResponse.json({ ok: true });
}
