import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { setAckStatus } from "@/lib/training-store";
import { isAckStatus } from "@/lib/employee-hub";

export const runtime = "nodejs";

/**
 * PATCH an acknowledgment's status manually — `waived` (excuse an employee),
 * `signed` (record an offline acknowledgment), or back to `pending`. Owner only.
 * The DocuSign webhook flips signature-required rows to `signed` on its own; this
 * is the manual override.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can change acknowledgments." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { status?: string };
  if (!isAckStatus(b.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });

  const ack = await setAckStatus(ctx.employerId, Number(params.id), b.status);
  if (!ack) return NextResponse.json({ error: "Could not update the acknowledgment." }, { status: 400 });
  return NextResponse.json({ ack });
}
