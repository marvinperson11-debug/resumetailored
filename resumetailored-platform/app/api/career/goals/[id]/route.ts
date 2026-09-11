import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { updateGoal, deleteGoal } from "@/lib/career-store";
import { isGoalCategory, isPriority, isGoalStatus, type CareerGoal } from "@/lib/career-ai";

export const runtime = "nodejs";

/** Update a goal (status / progress / fields). Free — everyone can edit. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as Partial<CareerGoal>;
  const patch: Partial<CareerGoal> = {};
  if (typeof b.title === "string") patch.title = b.title;
  if (isGoalCategory(b.category)) patch.category = b.category;
  if (isPriority(b.priority)) patch.priority = b.priority;
  if (b.targetDate !== undefined) patch.targetDate = b.targetDate;
  if (isGoalStatus(b.status)) patch.status = b.status;
  if (typeof b.progress === "number") patch.progress = b.progress;
  if (b.notes !== undefined) patch.notes = b.notes;

  const ok = await updateGoal(userId, id, patch);
  return NextResponse.json({ ok });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const ok = await deleteGoal(userId, id);
  return NextResponse.json({ ok });
}
