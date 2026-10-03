import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limit";
import { isIndividualPro } from "@/lib/plan";
import { localAtsFallback } from "@/lib/ai";
import { scoreResume, buildAtsReport } from "@/lib/ats-scan";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * ATS rewrite report: scores the ORIGINAL resume and the TAILORED resume against the
 * job posting (same scoring as /api/ats-scan) and returns the keyword delta plus
 * before/after match scores. Pro only. Non-Pro callers get a locked preview built
 * from the free, deterministic keyword-overlap score: a single real example delta,
 * no scores, no AI spend.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "tailor-ats-report");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Your session expired. Please refresh and sign in again." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; tailored?: string; jobPosting?: string };
  const resume = typeof body.resume === "string" ? body.resume : "";
  const tailored = typeof body.tailored === "string" ? body.tailored : "";
  const jobPosting = typeof body.jobPosting === "string" ? body.jobPosting : "";
  if (!resume.trim() || !tailored.trim() || !jobPosting.trim()) {
    return NextResponse.json({ error: "Resume, tailored resume and job posting are required." }, { status: 400 });
  }
  if (resume.length > 50000 || tailored.length > 50000 || jobPosting.length > 50000) {
    return NextResponse.json({ error: "Text is too long." }, { status: 400 });
  }

  if (!(await isIndividualPro())) {
    const report = buildAtsReport(localAtsFallback(resume, jobPosting), localAtsFallback(tailored, jobPosting), resume, tailored);
    const example = report.added[0]
      ? { keyword: report.added[0], kind: "added" as const }
      : report.strengthened[0]
        ? { keyword: report.strengthened[0].keyword, kind: "strengthened" as const }
        : null;
    return NextResponse.json({ locked: true, preview: example, addedCount: report.added.length }, { status: 200 });
  }

  try {
    const [before, after] = await Promise.all([scoreResume(resume, jobPosting), scoreResume(tailored, jobPosting)]);
    return NextResponse.json({ locked: false, report: buildAtsReport(before, after, resume, tailored) });
  } catch (err) {
    console.error("ATS report error:", (err as { message?: string })?.message || err);
    return NextResponse.json({ error: "Could not build the ATS report. Please try again." }, { status: 500 });
  }
}
