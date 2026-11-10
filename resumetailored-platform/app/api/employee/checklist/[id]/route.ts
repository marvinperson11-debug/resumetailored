import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { isLegalChecklistLabel } from "@/lib/checklist-hub";
import { getChecklistItemOwner, setChecklistItemDone } from "@/lib/checklist-store";

export const runtime = "nodejs";

/** PATCH — the new hire checks off one of their OWN onboarding checklist
 *  items. Body: { done: boolean }.
 *
 *  Two checks before this ever touches the row: the item must belong to
 *  this employee's own checklist (not just any item in the employer's
 *  workspace), and it must not be one of the employer-only legal items (ID
 *  collected, W-4 signed) — Decision #3. Those still only move through the
 *  employer-side PATCH /api/employer/checklist-items/:id. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const owner = await getChecklistItemOwner(ctx.employerId, id);
  if (!owner || owner.employeeId !== ctx.employeeId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (isLegalChecklistLabel(owner.label)) {
    return NextResponse.json({ error: "Your employer confirms this item — it isn't something you can check off yourself." }, { status: 403 });
  }

  const b = (await req.json().catch(() => ({}))) as { done?: boolean };
  const item = await setChecklistItemDone(ctx.employerId, id, !!b.done);
  if (!item) return NextResponse.json({ error: "Could not update the item." }, { status: 400 });
  return NextResponse.json({ item });
}
