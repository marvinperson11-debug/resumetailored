import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseSms } from "@/lib/employer-plan";
import { normalizeTier } from "@/lib/employer-tier";
import { getApplicant, getEmployerProfile } from "@/lib/employer-store";
import { sendCandidateSms } from "@/lib/sms-send";

export const runtime = "nodejs";

/**
 * POST — send one SMS to this candidate. Requires `confirm: true` in the
 * body: the UI must show its own explicit confirmation before setting it
 * (this check is defense-in-depth, not the only confirmation — see the
 * build's guardrail that every candidate-facing send needs one). A missing
 * or false `confirm` is refused BEFORE anything else runs (consent,
 * suppression, quota), so a bypass of the confirmation step can never
 * accidentally send.
 */
export async function POST(req: Request, { params }: { params: { applicantId: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseSms(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "sms" }, { status: 402 });

  const applicantId = Number(params.applicantId);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "bad_applicant" }, { status: 400 });

  let body: { body?: string; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (body.confirm !== true) return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  const text = (body.body || "").trim();
  if (!text) return NextResponse.json({ error: "empty_message" }, { status: 400 });
  if (text.length > 1600) return NextResponse.json({ error: "message_too_long" }, { status: 400 });

  const applicant = await getApplicant(ctx.employerId, applicantId);
  if (!applicant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const profile = await getEmployerProfile(ctx.employerId);
  const result = await sendCandidateSms({
    employerId: ctx.employerId,
    tier: ctx.access.isAdmin ? "corporate" : normalizeTier(ctx.access.tier),
    employerDisplayName: profile?.companyName || "Your employer",
    actorUserId: ctx.userId,
    actorEmail: null,
    applicantId,
    body: text,
  });

  if (!result.ok) return NextResponse.json({ error: result.deniedReason || "send_failed" }, { status: result.deniedReason === "send_failed" ? 502 : 409 });
  return NextResponse.json({ ok: true, queued: !!result.queued, queueReason: result.queueReason, message: result.message });
}
