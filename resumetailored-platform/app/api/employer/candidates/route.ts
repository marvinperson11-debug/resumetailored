import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { listApplicants, createApplicant, type ApplicantFilters } from "@/lib/employer-store";
import { isApplicantStatus } from "@/lib/employer-ai";

export const runtime = "nodejs";

/** GET applicants across all this employer's jobs, with filters + sort:
 *  ?jobId=&status=&minScore=&sort=newest|best */
export async function GET(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const filters: ApplicantFilters = {};
  const jobId = Number(url.searchParams.get("jobId"));
  if (Number.isFinite(jobId) && jobId > 0) filters.jobId = jobId;
  const status = url.searchParams.get("status");
  if (isApplicantStatus(status)) filters.status = status;
  const minScore = Number(url.searchParams.get("minScore"));
  if (Number.isFinite(minScore) && minScore > 0) filters.minScore = minScore;
  filters.sort = url.searchParams.get("sort") === "best" ? "best" : "newest";

  const applicants = await listApplicants(employerId, filters);
  return NextResponse.json({ applicants });
}

/** POST — manually add an applicant to one of this employer's jobs. (Applicants
 *  normally arrive from a public job page; this supports manual entry too.) */
export async function POST(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as {
    jobId?: number;
    name?: string;
    email?: string;
    resumeText?: string;
    coverLetter?: string;
  };
  const jobId = Number(b.jobId);
  if (!Number.isFinite(jobId)) return NextResponse.json({ error: "Pick a job for this applicant." }, { status: 400 });
  if (!(b.name || "").trim() || !(b.email || "").trim())
    return NextResponse.json({ error: "Name and email are required." }, { status: 400 });

  const applicant = await createApplicant(employerId, {
    jobId,
    name: (b.name || "").trim(),
    email: (b.email || "").trim(),
    resumeText: (b.resumeText || "").trim(),
    coverLetter: (b.coverLetter || "").trim(),
  });
  if (!applicant) return NextResponse.json({ error: "Could not add the applicant (is the job yours?)." }, { status: 400 });
  return NextResponse.json({ applicant });
}
