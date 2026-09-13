import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { markThreadRead } from "@/lib/employer-collab-store";

export const runtime = "nodejs";

/** PATCH — mark a candidate's inbound messages as read. Body: { applicantId }. */
export async function PATCH(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { applicantId?: number };
  const applicantId = Number(b.applicantId);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "bad applicantId" }, { status: 400 });

  const ok = await markThreadRead(employerId, applicantId);
  return NextResponse.json({ ok });
}
