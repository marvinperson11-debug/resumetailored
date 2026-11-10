import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseOnboardingTools } from "@/lib/employer-plan";
import { getPaperworkForEmployee, signIdDocumentUrl } from "@/lib/paperwork-store";

export const runtime = "nodejs";

/** GET a short-lived signed URL for this employee's uploaded I-9
 *  ID/work-authorization document, so the employer can actually look at it
 *  before verifying Section 2. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseOnboardingTools(ctx.access)) return NextResponse.json({ error: "The paperwork packet is part of the Portal plan." }, { status: 403 });
  const employeeId = Number(params.id);
  const paperwork = await getPaperworkForEmployee(ctx.employerId, employeeId);
  const idDocPath = paperwork.i9?.data?.idDocPath as string | undefined;
  if (!idDocPath) return NextResponse.json({ url: null });
  const url = await signIdDocumentUrl(ctx.employerId, idDocPath);
  return NextResponse.json({ url });
}
