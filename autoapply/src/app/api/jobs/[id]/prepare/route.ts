import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { prepareApplication } from "@/lib/ai";
import { syncStatusToMain } from "@/lib/queue-writeback";
import type { ResumeData } from "@/lib/types";

export const maxDuration = 120;

type Params = { params: { id: string } };

// POST /api/jobs/:id/prepare — tailor resume + cover letter + answers
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

  let prepared;
  try {
    prepared = await prepareApplication(
      user.resumeData as unknown as ResumeData,
      job.companyName,
      job.roleTitle,
      job.jobDescription
    );
  } catch (err) {
    console.error("prepare failed", err);
    return NextResponse.json({ error: "prepare_failed" }, { status: 502 });
  }

  const updated = await prisma.jobApplication.update({
    where: { id: job.id },
    data: {
      tailoredResume: prepared.tailoredResume as object,
      coverLetter: prepared.coverLetter,
      suggestedAnswers: prepared.suggestedAnswers as object,
      // Only advance NEW → PREPARED; never regress an already-APPLIED job.
      status: job.status === "NEW" ? "PREPARED" : job.status,
    },
  });

  // Mirror the status back to the main app's queue if this job came from there.
  await syncStatusToMain(userId, updated.sourceQueueId, updated.status);

  return NextResponse.json({ job: updated });
}
