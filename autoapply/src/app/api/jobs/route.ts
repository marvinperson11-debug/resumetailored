import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/jobs — list the signed-in user's job applications
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const jobs = await prisma.jobApplication.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      companyName: true,
      roleTitle: true,
      jobUrl: true,
      status: true,
      matchScore: true,
      matchSummary: true,
      coverLetter: true,
      appliedAt: true,
      createdAt: true,
      sourceQueueId: true,
    },
  });
  return NextResponse.json({ jobs });
}

const addSchema = z.object({
  companyName: z.string().min(1).max(200),
  roleTitle: z.string().min(1).max(200),
  jobUrl: z.string().url().max(2000),
  jobDescription: z.string().min(20).max(40000),
});

// POST /api/jobs — add a job (paste URL + description)
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = addSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const job = await prisma.jobApplication.create({
    data: { userId, status: "NEW", ...parsed.data },
  });
  return NextResponse.json({ job }, { status: 201 });
}
