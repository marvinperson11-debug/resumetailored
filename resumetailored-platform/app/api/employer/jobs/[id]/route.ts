import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { checkJobAllowance } from "@/lib/employer-plan";
import { updateJob, deleteJob, duplicateJob, getJob, listJobs } from "@/lib/employer-store";
import { isJobStatus, REMOTE_TYPES, EMPLOYMENT_TYPES } from "@/lib/employer-ai";
import { cleanPayPeriod, payTransparencyProblems, payProblemsMessage, BENEFITS_MAX_CHARS } from "@/lib/pay-transparency";
import { isJobPublished } from "@/lib/job-faq";
import { autoDisableJobFaqOnUnpublish } from "@/lib/job-faq-store";
import { checkFreeJobEdit } from "@/lib/employer-free-tier";

export const runtime = "nodejs";

const clean = <T extends string>(v: unknown, allowed: readonly T[]): T | "" =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : "";
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

/** PATCH — edit a job, change its status (pause/close/activate), or duplicate it.
 *  `{ action: "duplicate" }` clones the job; `{ status }` alone flips status. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  const employerId = ctx?.employerId || null;
  if (!ctx || !employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (b.action === "duplicate") {
    const job = await duplicateJob(employerId, id);
    if (!job) return NextResponse.json({ error: "Could not duplicate." }, { status: 500 });
    return NextResponse.json({ job });
  }

  // Reactivating/publishing a job (status → active) counts against the Free
  // job-slot limit the same as creating one active from scratch.
  let jobBeforePatch: Awaited<ReturnType<typeof getJob>> = null;
  if (b.status !== undefined && isJobStatus(b.status) && b.status === "active") {
    jobBeforePatch = await getJob(employerId, id);
    if (jobBeforePatch && jobBeforePatch.status !== "active") {
      const existing = await listJobs(employerId);
      const activeCount = existing.filter((j) => j.status === "active" && j.id !== id).length;
      const allowance = checkJobAllowance(ctx.access, activeCount);
      if (!allowance.allowed) return NextResponse.json({ error: allowance.message, code: "job_limit" }, { status: 402 });
    }
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
  if (b.salaryPeriod !== undefined) patch.salaryPeriod = cleanPayPeriod(b.salaryPeriod);
  if (b.benefitsDescription !== undefined) patch.benefitsDescription = String(b.benefitsDescription).trim().slice(0, BENEFITS_MAX_CHARS);
  if (b.requirements !== undefined) patch.requirements = arr(b.requirements);
  if (b.niceToHaves !== undefined) patch.niceToHaves = arr(b.niceToHaves);
  if (b.deadline !== undefined) patch.deadline = b.deadline ? String(b.deadline) : null;
  if (b.status !== undefined && isJobStatus(b.status)) patch.status = b.status;
  if (b.publicListed !== undefined) patch.publicListed = !!b.publicListed;

  // EDIT RULE (Free plan, Section E.4): title + role category lock once the
  // post has published once; a closed post only ever reactivates AS IS; a
  // substantial description rewrite reads as a new role. Checked against
  // the job as it stood BEFORE this patch, and only against fields this
  // patch actually tries to change to a DIFFERENT value — re-submitting the
  // same title back is not an edit. Paid tiers are unaffected (checkFreeJobEdit
  // is a no-op for anything but Free).
  {
    const current = jobBeforePatch ?? (await getJob(employerId, id));
    jobBeforePatch = current;
    if (current) {
      const changedPatch: { title?: string; department?: string; description?: string; status?: string } = {};
      if (patch.title !== undefined && patch.title !== current.title) changedPatch.title = patch.title as string;
      if (patch.department !== undefined && patch.department !== current.department) changedPatch.department = patch.department as string;
      if (patch.description !== undefined && patch.description !== current.description) changedPatch.description = patch.description as string;
      if (patch.status !== undefined && patch.status !== current.status) changedPatch.status = patch.status as string;
      const tier = ctx.access.isAdmin ? "corporate" : ctx.access.tier || "free";
      const gate = checkFreeJobEdit({
        tier,
        status: current.status,
        title: current.title,
        department: current.department,
        description: current.description,
        publishedAt: current.publishedAt ?? null,
        patch: changedPatch,
      });
      if (!gate.allowed) return NextResponse.json({ error: gate.message, code: "free_tier_graduation" }, { status: 402 });
    }
  }

  // A posting that is (or is becoming) active must carry a wage / good-faith wage range and a
  // general benefits description. Checked on the MERGED result, so neither re-activating an
  // incomplete job nor blanking the fields of a live one gets past it. Pausing/closing is never blocked.
  {
    const current = await getJob(employerId, id);
    const effStatus = (patch.status as string | undefined) ?? current?.status;
    if (effStatus === "active") {
      const merged = {
        salaryMin: patch.salaryMin !== undefined ? (patch.salaryMin as number | null) : current?.salaryMin ?? null,
        salaryMax: patch.salaryMax !== undefined ? (patch.salaryMax as number | null) : current?.salaryMax ?? null,
        benefitsDescription: patch.benefitsDescription !== undefined ? (patch.benefitsDescription as string) : current?.benefitsDescription ?? "",
      };
      const pay = payTransparencyProblems(merged);
      if (pay.length) return NextResponse.json({ error: payProblemsMessage(pay), code: "pay_transparency", problems: pay }, { status: 422 });
    }
  }

  // The FIRST time this job goes active+public (migration 0071) — Google
  // Jobs markup's datePosted and the default 30-day validThrough both derive
  // from this (lib/job-posting-lifecycle.ts computeValidThrough). Never reset
  // on a later update, so load the pre-patch row if we haven't already.
  {
    const current = jobBeforePatch ?? (await getJob(employerId, id));
    const effStatus = (patch.status as string | undefined) ?? current?.status;
    const effPublicListed = patch.publicListed !== undefined ? (patch.publicListed as boolean) : !!current?.publicListed;
    if (effStatus === "active" && effPublicListed && !current?.publishedAt) {
      patch.publishedAt = new Date().toISOString();
    }
  }

  const ok = await updateJob(employerId, id, patch);
  if (!ok) return NextResponse.json({ error: "Could not update the job." }, { status: 500 });
  const job = await getJob(employerId, id);

  // Job-status transition hook: a status/listing change that leaves the job
  // not published must turn Candidate Q&A off for it too (lib/job-faq-store.ts
  // `autoDisableJobFaqOnUnpublish`) — best-effort, never blocks the response.
  if ((patch.status !== undefined || patch.publicListed !== undefined) && job && !isJobPublished(job)) {
    await autoDisableJobFaqOnUnpublish(employerId, id).catch((e) => console.error("[employer/jobs] autoDisableJobFaqOnUnpublish failed", { id, error: e }));
  }

  return NextResponse.json({ ok: true, job });
}

/** DELETE a job posting (its applicants cascade). Not offered on the Free
 *  plan (Section E.4) — a Free employer's one job post is permanent, never
 *  swappable, so there is no "delete and start over" path to close. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  const employerId = ctx?.employerId || null;
  if (!ctx || !employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!ctx.access.isAdmin && (ctx.access.tier || "free") === "free") {
    return NextResponse.json({ error: "Deleting a job post isn't offered on the Free plan — upgrading unlocks posting and managing as many roles as you need on the Portal plan.", code: "free_tier_graduation" }, { status: 402 });
  }
  const ok = await deleteJob(employerId, id);
  if (!ok) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
