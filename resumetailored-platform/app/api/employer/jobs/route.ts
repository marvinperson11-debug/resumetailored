import { listingProblems } from "@/lib/job-quality";
import { NextResponse } from "next/server";
import { requireEmployerId, employerContext } from "@/lib/employer-auth";
import { checkJobAllowance } from "@/lib/employer-plan";
import { listJobs, createJob } from "@/lib/employer-store";
import { isJobStatus, REMOTE_TYPES, EMPLOYMENT_TYPES } from "@/lib/employer-ai";
import { cleanPayPeriod, payTransparencyProblems, payProblemsMessage, BENEFITS_MAX_CHARS } from "@/lib/pay-transparency";

export const runtime = "nodejs";

const clean = <T extends string>(v: unknown, allowed: readonly T[]): T | "" =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : "";
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

/** GET all job postings for this employer (with applicant counts). */
export async function GET() {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const jobs = await listJobs(employerId);
  return NextResponse.json({ jobs });
}

/** POST a new job posting (draft or published). */
export async function POST(req: Request) {
  const ctx = await employerContext();
  const employerId = ctx?.employerId || null;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  console.log("[jobs POST] userId:", employerId, "title:", String(b.title || "").slice(0, 80));
  if (!ctx || !employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const title = String(b.title || "").trim();
  const description = String(b.description || "").trim();
  if (title.length < 2) return NextResponse.json({ error: "Job title is required." }, { status: 400 });
  if (description.length < 10) return NextResponse.json({ error: "A job description is required." }, { status: 400 });

  const status = isJobStatus(b.status) ? b.status : "draft";
  const benefitsDescription = String(b.benefitsDescription || "").trim().slice(0, BENEFITS_MAX_CHARS);
  // Publishing needs a wage / good-faith wage range AND a general benefits description (drafts may omit them).
  if (status === "active") {
    const pay = payTransparencyProblems({ salaryMin: numOrNull(b.salaryMin), salaryMax: numOrNull(b.salaryMax), benefitsDescription });
    if (pay.length) return NextResponse.json({ error: payProblemsMessage(pay), code: "pay_transparency", problems: pay }, { status: 422 });
  }
  if (b.publicListed && status === "active") {
    const problems = listingProblems({ title, description, location: String(b.location || ""), salaryMin: numOrNull(b.salaryMin), salaryMax: numOrNull(b.salaryMax), benefitsDescription });
    if (problems.length) {
      return NextResponse.json({ error: "To appear on the public job board, add a real job title (not \"Any …\") and a description of at least 80 characters. You can still save it as a private posting.", code: "low_quality_listing", problems }, { status: 422 });
    }
  }
  if (status === "active") {
    const existing = await listJobs(employerId);
    const activeCount = existing.filter((j) => j.status === "active").length;
    const allowance = checkJobAllowance(ctx.access, activeCount);
    if (!allowance.allowed) return NextResponse.json({ error: allowance.message, code: "job_limit" }, { status: 402 });
  }

  try {
    const job = await createJob(employerId, {
      title,
      description,
      department: String(b.department || "").trim(),
      location: String(b.location || "").trim(),
      remoteType: clean(b.remoteType, REMOTE_TYPES),
      employmentType: clean(b.employmentType, EMPLOYMENT_TYPES),
      salaryMin: numOrNull(b.salaryMin),
      salaryMax: numOrNull(b.salaryMax),
      salaryCurrency: String(b.salaryCurrency || "USD").trim() || "USD",
      salaryPeriod: cleanPayPeriod(b.salaryPeriod),
      benefitsDescription,
      requirements: arr(b.requirements),
      niceToHaves: arr(b.niceToHaves),
      deadline: b.deadline ? String(b.deadline) : null,
      status,
      publicListed: !!b.publicListed,
    });
    if (!job) return NextResponse.json({ error: "Could not create the job. Please try again." }, { status: 500 });
    return NextResponse.json({ job });
  } catch (error) {
    console.error("[jobs POST] error:", error);
    return NextResponse.json({ error: "Could not create the job. Please try again." }, { status: 500 });
  }
}
