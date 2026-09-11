import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { addMilestone } from "@/lib/career-store";
import { isMilestoneType } from "@/lib/career-ai";

export const runtime = "nodejs";

/** Add a career milestone. Free — the basic timeline is available to everyone. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { type?: string; title?: string; date?: string; description?: string; impact?: string };
  if (!b.title?.trim()) return NextResponse.json({ error: "A milestone title is required." }, { status: 400 });
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });

  const milestone = await addMilestone(userId, {
    type: isMilestoneType(b.type) ? b.type : "job",
    title: b.title.trim(), date: b.date, description: b.description || null, impact: b.impact || null,
  });
  if (!milestone) return NextResponse.json({ error: "save_failed", message: "Could not save (is career_milestones set up?)." }, { status: 500 });
  return NextResponse.json({ milestone });
}
