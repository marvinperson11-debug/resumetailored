import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { deleteConnection } from "@/lib/docusign-store";

export const runtime = "nodejs";

/** Disconnect DocuSign: delete the stored tokens for this employer. Only the
 *  account owner (not an invited employee) may disconnect. */
export async function POST() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (ctx.access.plan !== "employer" && !ctx.access.isAdmin) {
    return NextResponse.json({ error: "Only the account owner can disconnect DocuSign." }, { status: 403 });
  }
  const ok = await deleteConnection(ctx.employerId);
  return NextResponse.json({ ok });
}
