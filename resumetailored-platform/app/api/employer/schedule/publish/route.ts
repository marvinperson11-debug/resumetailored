import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseEmployerPortal } from "@/lib/plan";
import { publishWeek } from "@/lib/time-store";
import { weekStartISO } from "@/lib/time-hub";

export const runtime = "nodejs";

/** POST { weekStart } → publish every draft shift in that week to employees. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { weekStart?: string };
  const weekStart = weekStartISO(b.weekStart || undefined);
  const published = await publishWeek(ctx.employerId, weekStart);
  if (published === null) return NextResponse.json({ error: "Could not publish the schedule." }, { status: 500 });
  return NextResponse.json({ published });
}
