import { rateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { scoreResume } from "@/lib/ats-scan";
import { recordGeneration } from "@/lib/generations";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scores a resume against a job description and surfaces matched/missing
 * keywords + rewrite suggestions. Ported from the old site's `/api/ats-scan`
 * (same prompt, model, and keyword-overlap fallback). The ATS scanner is a
 * free-tier feature and unlimited for everyone — no per-day cap (only the
 * Pro-only tools, Resume Video and Web Studio, are gated).
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "ats-scan");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Your session expired. Please refresh and sign in again." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobPosting?: string };
  const { resume, jobPosting } = body;
  if (!resume || !jobPosting) {
    return NextResponse.json({ error: "Resume and job posting are required." }, { status: 400 });
  }

  try {
    const result = await scoreResume(resume, jobPosting);
    await recordGeneration(userId, "ats", result);
    return NextResponse.json(result);
  } catch (err) {
    const e = err as { message?: string };
    console.error("ATS scan error:", e?.message || err);
    return NextResponse.json({ error: "Analysis failed. Please try again." }, { status: 500 });
  }
}
