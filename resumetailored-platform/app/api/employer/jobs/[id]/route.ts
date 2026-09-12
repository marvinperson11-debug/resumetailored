import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { updateJob, deleteJob, duplicateJob, getJob } from "@/lib/employer-store";
import { isJobStatus, REMOTE_TYPES, EMPLOYMENT_TYPES } from "@/lib/employer-ai";

export const runtime = "nodejs";

const clean = <T extends string>(v: unknown, allowed: readonly T[]): T | "" =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : "";
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

/** PATCH — edit a job, change its status (pause/close/activate), or duplicate it.
 *  `{ action: "duplicate" }` clones the job; `{ status }` alone flips status. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (b.action === "duplicate") {
    const job = await duplicateJob(employerId, id);
    if (!job) return NextResponse.json({ error: "Could not duplicate." }, { status: 500 });
    return NextResponse.json({ job });
  }

  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) patch.title = String(b.title).trim();
  if (b.description !== undefined) patch.description = String(b.description).trim();
  if (b.department !== undefined) patch.department = String(b.department).trim();
  if (b.location !== undefined) patch.location = String(b.location).trim();
  if (b.remoteType !== undefined) patch.remoteType = clean(b.remoteType, REMOTE_TYPES);
  if (b.employmentType !== undefined) patch.employmentType = clean(b.employmentType, EMPLOYMENT_TYPES);
  if (b.salaryMin !== undefined) patch.salaryMin = numOrNull(b.salaryMin);
  if (b.salaryMax !== undefined) patch.salaryMax = numOrNull(b.salaryMax);
  if (b.salaryCurrency !== undefined) patch.salaryCurrency = String(b.salaryCurrency).trim() || "USD";
  if (b.requirements !== undefined) patch.requirements = arr(b.requirements);
  if (b.niceToHaves !== undefined) patch.niceToHaves = arr(b.niceToHaves);
  if (b.deadline !== undefined) patch.deadline = b.deadline ? String(b.deadline) : null;
  if (b.status !== undefined && isJobStatus(b.status)) patch.status = b.status;
  if (b.publicListed !== undefined) patch.publicListed = !!b.publicListed;

  const ok = await updateJob(employerId, id, patch);
  if (!ok) return NextResponse.json({ error: "Could not update the job." }, { status: 500 });
  const job = await getJob(employerId, id);
  return NextResponse.json({ ok: true, job });
}

/** DELETE a job posting (its applicants cascade). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await deleteJob(employerId, id);
  if (!ok) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
