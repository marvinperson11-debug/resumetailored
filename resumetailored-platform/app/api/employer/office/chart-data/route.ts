import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isScalePlusTier } from "@/lib/employer-plan";
import { chartDataForSource } from "@/lib/office-store";
import { isChartSource } from "@/lib/office-hub";

export const runtime = "nodejs";

/** GET ?source=applicants|timesheet|training — live chart data. Scale+ only,
 *  same gate as the Charts tab itself (defense in depth). */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isScalePlusTier(ctx.access)) return NextResponse.json({ error: "Charts are available on the Scale+ plan." }, { status: 403 });

  const source = new URL(req.url).searchParams.get("source");
  if (!isChartSource(source)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const points = await chartDataForSource(ctx.employerId, source);
  return NextResponse.json({ points });
}
