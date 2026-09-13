import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { getShortlistMembers, addShortlistMember, removeShortlistMember } from "@/lib/employer-collab-store";

export const runtime = "nodejs";

/** GET — the applicants in this shortlist. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const members = await getShortlistMembers(employerId, id);
  return NextResponse.json({ members });
}

/** POST — add a candidate to the shortlist. Body: { applicantId }. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { applicantId?: number };
  const applicantId = Number(b.applicantId);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "bad applicantId" }, { status: 400 });
  const ok = await addShortlistMember(employerId, id, applicantId);
  if (!ok) return NextResponse.json({ error: "Could not add to shortlist (is the candidate yours?)." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** DELETE — remove a candidate from the shortlist. Body: { applicantId }. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { applicantId?: number };
  const applicantId = Number(b.applicantId);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "bad applicantId" }, { status: 400 });
  const ok = await removeShortlistMember(employerId, id, applicantId);
  return NextResponse.json({ ok });
}
