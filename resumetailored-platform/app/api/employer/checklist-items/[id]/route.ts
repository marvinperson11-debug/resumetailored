import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { setChecklistItemDone } from "@/lib/checklist-store";

export const runtime = "nodejs";

/** PATCH toggle one checklist item's done state. Body: { done: boolean }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can check off onboarding items." }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { done?: boolean };
  const item = await setChecklistItemDone(ctx.employerId, id, !!b.done);
  if (!item) return NextResponse.json({ error: "Could not update the item." }, { status: 400 });
  return NextResponse.json({ item });
}
