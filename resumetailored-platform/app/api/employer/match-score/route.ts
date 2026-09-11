import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildMatchScorePrompt, normalizeMatch, localMatchFallback } from "@/lib/employer-ai";
import { getApplicant, getJob, getCachedMatch, cacheMatch, updateApplicant } from "@/lib/employer-store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Score a resume against a role. Two modes:
 *  - Pass { applicantId, jobId } to score a stored applicant — the result is
 *    cached in match_scores and written back onto the applicant row, and a
 *    prior cache hit is returned without re-billing.
 *  - Or pass { jobDescription, jobRequirements[], resumeText } for an ad-hoc score.
 */
export async function POST(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as {
    applicantId?: number;
    jobId?: number;
    jobTitle?: string;
    jobDescription?: string;
    jobRequirements?: string[];
    resumeText?: string;
    refresh?: boolean;
  };

  let jobTitle = (b.jobTitle || "").trim();
  let jobDescription = (b.jobDescription || "").trim();
  let requirements = Array.isArray(b.jobRequirements) ? b.jobRequirements.map((x) => String(x)) : [];
  let resumeText = (b.resumeText || "").trim();
  const applicantId = Number(b.applicantId);
  const jobId = Number(b.jobId);
  const stored = Number.isFinite(applicantId) && Number.isFinite(jobId);

  // Stored mode: hydrate from the DB (and honor ownership + the cache).
  if (stored) {
    const applicant = await getApplicant(employerId, applicantId);
    const job = await getJob(employerId, jobId);
    if (!applicant || !job) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!b.refresh) {
      const cached = await getCachedMatch(applicantId, jobId);
      if (cached) return NextResponse.json({ analysis: cached, cached: true });
    }
    jobTitle = job.title;
    jobDescription = job.description;
    requirements = job.requirements;
    resumeText = applicant.resumeText;
  }

  if (jobDescription.length < 10) return NextResponse.json({ error: "A job description is required to score." }, { status: 400 });
  if (resumeText.length < 10) return NextResponse.json({ error: "No resume text to score for this candidate." }, { status: 400 });

  const anthropic = getAnthropic();
  let analysis = null as ReturnType<typeof normalizeMatch>;
  if (anthropic) {
    const { system, user } = buildMatchScorePrompt({ jobTitle, jobDescription, requirements, resumeText });
    try {
      const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1400, system, messages: [{ role: "user", content: user }] });
      const block = msg.content[0];
      analysis = normalizeMatch(extractJson(block && block.type === "text" ? block.text : ""));
    } catch (err) {
      if (!isProviderUnavailable(err)) {
        return NextResponse.json({ error: "Could not score this candidate. Please try again." }, { status: 500 });
      }
    }
  }
  // Fall back to a deterministic keyword estimate if the AI was unavailable.
  if (!analysis) analysis = localMatchFallback(requirements, jobDescription, resumeText);

  if (stored) {
    await cacheMatch(applicantId, jobId, analysis);
    await updateApplicant(employerId, applicantId, { matchScore: analysis.score, matchAnalysis: analysis });
  }
  return NextResponse.json({ analysis });
}
