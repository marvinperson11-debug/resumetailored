import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { listJobs, createJob } from "@/lib/employer-store";
import { isJobStatus, REMOTE_TYPES, EMPLOYMENT_TYPES } from "@/lib/employer-ai";

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
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(b.title || "").trim();
  const description = String(b.description || "").trim();
  if (title.length < 2) return NextResponse.json({ error: "Job title is required." }, { status: 400 });
  if (description.length < 10) return NextResponse.json({ error: "A job description is required." }, { status: 400 });

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
    requirements: arr(b.requirements),
    niceToHaves: arr(b.niceToHaves),
    deadline: b.deadline ? String(b.deadline) : null,
    status: isJobStatus(b.status) ? b.status : "draft",
  });
  if (!job) return NextResponse.json({ error: "Could not create the job. Is the database configured?" }, { status: 500 });
  return NextResponse.json({ job });
}
