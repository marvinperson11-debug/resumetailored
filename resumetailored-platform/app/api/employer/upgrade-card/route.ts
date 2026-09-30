import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getUpgradeCardData } from "@/lib/employer-plan";

export const runtime = "nodejs";

/** Data for the persistent, in-page upgrade card shown at the bottom of every
 *  non-locked employer page. `data: null` for Corporate, the admin bypass, or
 *  when there's no employer context — the client renders nothing either way. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ data: null });
  const data = await getUpgradeCardData(ctx.access, ctx.employerId);
  return NextResponse.json({ data });
}
