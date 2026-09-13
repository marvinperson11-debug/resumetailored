import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { updateShortlist, deleteShortlist } from "@/lib/employer-collab-store";

export const runtime = "nodejs";

/** PATCH — rename / re-describe a shortlist. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { name?: string; description?: string };
  const patch: { name?: string; description?: string } = {};
  if (b.name !== undefined) patch.name = String(b.name);
  if (b.description !== undefined) patch.description = String(b.description);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const ok = await updateShortlist(employerId, id, patch);
  if (!ok) return NextResponse.json({ error: "Could not update the shortlist." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** DELETE — remove a shortlist (members are cascade-deleted). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await deleteShortlist(employerId, id);
  return NextResponse.json({ ok });
}
