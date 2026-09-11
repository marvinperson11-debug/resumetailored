import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { getApplicant, updateApplicant } from "@/lib/employer-store";
import { isApplicantStatus } from "@/lib/employer-ai";

export const runtime = "nodejs";

/** GET a single applicant (with match analysis + resume). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const applicant = await getApplicant(employerId, id);
  if (!applicant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ applicant });
}

/** PATCH — change status and/or notes. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { status?: string; notes?: string };
  const patch: { status?: import("@/lib/employer-ai").ApplicantStatus; notes?: string } = {};
  if (b.status !== undefined) {
    if (!isApplicantStatus(b.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
    patch.status = b.status;
  }
  if (b.notes !== undefined) patch.notes = String(b.notes);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const ok = await updateApplicant(employerId, id, patch);
  if (!ok) return NextResponse.json({ error: "Could not update the applicant." }, { status: 500 });
  const applicant = await getApplicant(employerId, id);
  return NextResponse.json({ ok: true, applicant });
}
