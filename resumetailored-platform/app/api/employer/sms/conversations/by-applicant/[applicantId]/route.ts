import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseSms } from "@/lib/employer-plan";
import { getApplicant } from "@/lib/employer-store";
import { getConversationByApplicant, listMessages } from "@/lib/sms-store";
import { isOptedIn } from "@/lib/sms-consent";

export const runtime = "nodejs";

/** GET — the SMS thread for one candidate (null conversation if there is no
 *  thread yet — viewing never creates one). Also returns whether this
 *  candidate has an active SMS consent, so the UI can disable the compose
 *  box with an explainer before the employer even tries to send. */
export async function GET(req: Request, { params }: { params: { applicantId: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseSms(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "sms" }, { status: 402 });
  const applicantId = Number(params.applicantId);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "bad_applicant" }, { status: 400 });
  const applicant = await getApplicant(ctx.employerId, applicantId);
  if (!applicant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [conversation, consented] = await Promise.all([getConversationByApplicant(ctx.employerId, applicantId), isOptedIn(applicantId)]);
  const messages = conversation ? await listMessages(conversation.id) : [];
  return NextResponse.json({ conversation, messages, consented, hasPhone: !!applicant.phoneNormalized });
}
