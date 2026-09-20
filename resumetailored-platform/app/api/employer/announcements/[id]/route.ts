import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { updateAnnouncement, deleteAnnouncement } from "@/lib/announcements-store";

export const runtime = "nodejs";

/** PATCH — edit / pin / retire an announcement. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { title?: string; body?: string; pinned?: boolean; active?: boolean };
  const updated = await updateAnnouncement(ctx.employerId, id, b);
  if (!updated) return NextResponse.json({ error: "Could not update." }, { status: 400 });
  return NextResponse.json({ announcement: updated });
}

/** DELETE — remove an announcement. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await deleteAnnouncement(ctx.employerId, id);
  if (!ok) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
