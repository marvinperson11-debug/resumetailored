import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { listForEmployer } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** GET the employer bell's recent notifications for the CURRENT reader (the
 *  account owner, or a teammate with employer-portal access) — each flagged
 *  with whether this reader specifically has read it. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const items = await listForEmployer(ctx.employerId, ctx.userId);
  return NextResponse.json({ items });
}
