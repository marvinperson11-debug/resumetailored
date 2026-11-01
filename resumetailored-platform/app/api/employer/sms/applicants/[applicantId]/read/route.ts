import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseSms } from "@/lib/employer-plan";
import { getConversationByApplicant, markConversationRead } from "@/lib/sms-store";

export const runtime = "nodejs";

/** POST — clear the unread badge for this candidate's thread. */
export async function POST(req: Request, { params }: { params: { applicantId: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseSms(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "sms" }, { status: 402 });
  const applicantId = Number(params.applicantId);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "bad_applicant" }, { status: 400 });
  const conversation = await getConversationByApplicant(ctx.employerId, applicantId);
  if (conversation) await markConversationRead(ctx.employerId, conversation.id);
  return NextResponse.json({ ok: true });
}
