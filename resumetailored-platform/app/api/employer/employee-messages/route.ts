import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { listThreadsForEmployer } from "@/lib/employee-messages-store";

export const runtime = "nodejs";

/** GET the employer's employee-message inbox: one summary per employee thread. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const threads = await listThreadsForEmployer(ctx.employerId);
  return NextResponse.json({ threads });
}
