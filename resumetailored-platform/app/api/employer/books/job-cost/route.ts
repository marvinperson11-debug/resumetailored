import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseFullBooks } from "@/lib/employer-plan";
import { jobCostSummary } from "@/lib/books-store";

export const dynamic = "force-dynamic";

/** GET ?jobId= — cost-per-hire for one job (expenses tagged to it ÷ hires
 *  from its own pipeline). Corporate-only (full Books' hiring tie-in);
 *  mounted next to the job in jobs-client.tsx's BooksCostPanel. */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseFullBooks(ctx.access)) return NextResponse.json({ allowed: false });

  const jobId = Number(new URL(req.url).searchParams.get("jobId"));
  if (!Number.isFinite(jobId)) return NextResponse.json({ error: "jobId is required." }, { status: 400 });

  const summary = await jobCostSummary(ctx.employerId, jobId);
  if (!summary) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json({ allowed: true, summary });
}
