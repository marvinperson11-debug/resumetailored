import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAttributionReport } from "@/lib/employer-plan";
import { buildEmployerAttributionReport } from "@/lib/attribution-store";

export const runtime = "nodejs";

/** GET — "Applicants by channel", per job (`?jobId=`) or the account
 *  aggregate (Combined Build, Section 3). Scale+ and behind
 *  ATTRIBUTION_REPORT_ENABLED (lib/employer-plan.ts `canUseAttributionReport`).
 *  A caller below the gate gets `{ allowed: false }` with no report data —
 *  the UI renders the locked/graduation state from that, never a 403 (same
 *  pattern as the channels route's GET, so the panel can always render
 *  something rather than erroring out for most employers on this plan). */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseAttributionReport(ctx.access)) {
    return NextResponse.json({ allowed: false });
  }
  const jobIdRaw = new URL(req.url).searchParams.get("jobId");
  const jobId = jobIdRaw ? Number(jobIdRaw) : undefined;
  const report = await buildEmployerAttributionReport(ctx.employerId, Number.isFinite(jobId) ? jobId : undefined);
  return NextResponse.json({ allowed: true, report });
}
