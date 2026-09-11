import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { addGoal, countGoals } from "@/lib/career-store";
import { isGoalCategory, isPriority, isGoalStatus } from "@/lib/career-ai";

export const runtime = "nodejs";

const FREE_GOAL_LIMIT = 3;

/** Add a career goal. Free users are capped at 3 goals. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as { title?: string; category?: string; priority?: string; targetDate?: string; status?: string; progress?: number; notes?: string };
  if (!b.title?.trim()) return NextResponse.json({ error: "A goal title is required." }, { status: 400 });

  if (!(await isPro())) {
    const n = await countGoals(userId);
    if (n >= FREE_GOAL_LIMIT) {
      return NextResponse.json({ error: "goal_limit", message: `Free covers ${FREE_GOAL_LIMIT} goals. Upgrade to Pro for unlimited.` }, { status: 402 });
    }
  }

  const goal = await addGoal(userId, {
    title: b.title.trim(),
    category: isGoalCategory(b.category) ? b.category : "skill",
    priority: isPriority(b.priority) ? b.priority : "medium",
    targetDate: b.targetDate || null,
    status: isGoalStatus(b.status) ? b.status : "not_started",
    progress: typeof b.progress === "number" ? b.progress : 0,
    notes: b.notes || null,
  });
  if (!goal) return NextResponse.json({ error: "save_failed", message: "Could not save the goal (is career_goals set up?)." }, { status: 500 });
  return NextResponse.json({ goal });
}
