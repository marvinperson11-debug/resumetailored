import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBackgroundChecks } from "@/lib/employer-plan";
import { getOrder, getAdverseActionState, recordReportViewed } from "@/lib/bgc-store";

export const runtime = "nodejs";

/** GET — one order's status + the adverse-action timeline. Viewing the
 *  result/report is itself an audited action (`bgc.report_viewed`). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBackgroundChecks(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "background_checks" }, { status: 402 });
  const order = await getOrder(ctx.employerId, params.id);
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const adverseAction = await getAdverseActionState(order.id);
  await recordReportViewed(ctx.employerId, order.id, ctx.userId);
  return NextResponse.json({ order, adverseAction });
}
