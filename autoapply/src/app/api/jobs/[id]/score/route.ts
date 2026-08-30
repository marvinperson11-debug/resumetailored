import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scoreMatch } from "@/lib/ai";
import type { ResumeData } from "@/lib/types";

export const maxDuration = 60;

type Params = { params: { id: string } };

// POST /api/jobs/:id/score — AI match score of resume vs. this JD
export async function POST(_req: Request, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [user, job] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { resumeData: true } }),
    prisma.jobApplication.findFirst({ where: { id: params.id, userId } }),
  ]);

  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!user?.resumeData) {
    return NextResponse.json({ error: "no_resume", message: "Upload a resume on your profile first." }, { status: 400 });
  }

  let result;
  try {
    result = await scoreMatch(user.resumeData as unknown as ResumeData, job.jobDescription);
  } catch (err) {
    console.error("score failed", err);
    return NextResponse.json({ error: "score_failed" }, { status: 502 });
  }

  const updated = await prisma.jobApplication.update({
    where: { id: job.id },
    data: {
      matchScore: Math.max(0, Math.min(100, Math.round(result.score))),
      matchSummary: result.summary,
      matchBreakdown: result.breakdown,
    },
    select: { id: true, matchScore: true, matchSummary: true, matchBreakdown: true },
  });

  return NextResponse.json({ job: updated, missingKeywords: result.missingKeywords });
}
