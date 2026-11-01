import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseSms } from "@/lib/employer-plan";
import { listConversations } from "@/lib/sms-store";

export const runtime = "nodejs";

/** GET — this org's SMS conversation list (candidate inbox), newest first. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseSms(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "sms" }, { status: 402 });
  const conversations = await listConversations(ctx.employerId);
  return NextResponse.json({ conversations });
}
