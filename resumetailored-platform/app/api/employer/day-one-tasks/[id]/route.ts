import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { canUseOnboardingTools } from "@/lib/employer-plan";
import { setDayOneTaskDone } from "@/lib/day-one-tasks";

export const runtime = "nodejs";

/** PATCH toggle one day-one task's done state (employer-only — these are
 *  operational tasks about the new hire: accounts, calendar invites, buddy
 *  assigned, not something the new hire does themselves). Body: { done }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can check off day-one tasks." }, { status: 403 });
  if (!canUseOnboardingTools(ctx.access)) return NextResponse.json({ error: "The onboarding task list is part of the Portal plan." }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { done?: boolean };
  const task = await setDayOneTaskDone(ctx.employerId, id, !!b.done);
  if (!task) return NextResponse.json({ error: "Could not update the task." }, { status: 400 });
  return NextResponse.json({ task });
}
