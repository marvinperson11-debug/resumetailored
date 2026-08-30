import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { userIdFromExtensionToken } from "@/lib/extension-auth";
import { prisma } from "@/lib/prisma";
import { preflight, withCors } from "@/lib/cors";
import type { ApplyData, ResumeData, SuggestedAnswer } from "@/lib/types";

type Params = { params: { id: string } };

// The browser extension runs on the employer's origin, so it authenticates
// with a bearer token (created on the profile page). Falls back to the
// session cookie when the dashboard itself calls this.
async function resolveUser(req: Request): Promise<string | null> {
  const bearer = req.headers.get("authorization");
  const fromToken = await userIdFromExtensionToken(bearer);
  if (fromToken) return fromToken;
  return getSessionUserId();
}

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get("origin"));
}

// GET /api/jobs/:id/apply-data — flattened payload the content script fills from
export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const userId = await resolveUser(req);
  if (!userId) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }), origin);

  const job = await prisma.jobApplication.findFirst({ where: { id: params.id, userId } });
  if (!job) return withCors(NextResponse.json({ error: "not_found" }, { status: 404 }), origin);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { resumeData: true } });
  // Prefer the job-specific tailored resume; fall back to the base resume.
  const resume = (job.tailoredResume ?? user?.resumeData) as unknown as ResumeData | null;

  if (!resume) {
    return withCors(
      NextResponse.json({ error: "no_resume", message: "No resume on file." }, { status: 400 }),
      origin
    );
  }

  const payload: ApplyData = {
    jobApplicationId: job.id,
    company: job.companyName,
    role: job.roleTitle,
    jobUrl: job.jobUrl,
    status: job.status,
    personal: resume.personalInfo,
    workExperience: resume.workExperience ?? [],
    education: resume.education ?? [],
    skills: resume.skills ?? [],
    coverLetter: job.coverLetter ?? null,
    suggestedAnswers: (job.suggestedAnswers as unknown as SuggestedAnswer[]) ?? [],
    preferredSalary: resume.preferredSalary ?? null,
    startDate: resume.startDate ?? null,
  };

  return withCors(NextResponse.json({ applyData: payload }, { status: 200 }), origin);
}

// POST /api/jobs/:id/apply-data — "Sync status": the user hit Submit on the
// employer's site, so the extension marks this job APPLIED.
export async function POST(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const userId = await resolveUser(req);
  if (!userId) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }), origin);

  const job = await prisma.jobApplication.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  });
  if (!job) return withCors(NextResponse.json({ error: "not_found" }, { status: 404 }), origin);

  const updated = await prisma.jobApplication.update({
    where: { id: job.id },
    data: { status: "APPLIED", appliedAt: new Date() },
    select: { id: true, status: true, appliedAt: true },
  });
  return withCors(NextResponse.json({ job: updated }, { status: 200 }), origin);
}
