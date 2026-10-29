import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isFreeTier } from "@/lib/employer-free-tier";
import { getFreeUsageSnapshot } from "@/lib/assistant-free-usage";

export const runtime = "nodejs";

/** GET the Free-plan assistant usage meter — numbers only (Section E.5).
 *  No warning strings, no "you're near your limit" language: the client
 *  renders plain counts against plain limits, e.g. "hour 6/60 · day 34/400 ·
 *  ceiling 2,000". Portal/Scale/Corporate don't have this usage model at
 *  all — they get a 204, nothing to show. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!isFreeTier(ctx.access)) return new NextResponse(null, { status: 204 });
  const snapshot = await getFreeUsageSnapshot(ctx.employerId);
  return NextResponse.json(snapshot);
}
