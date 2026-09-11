import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildInsightsPrompt, normalizeInsights, velocityScore } from "@/lib/career-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** AI career insights (on-track / top actions / velocity). PRO ONLY. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });
  if (!(await isPro())) return NextResponse.json({ error: "pro_required", message: "Career insights are a Pro feature." }, { status: 402 });

  const b = (await req.json().catch(() => ({}))) as {
    currentRole?: string; targetRole?: string;
    milestones?: { title?: string; date?: string }[]; goals?: { title?: string; status?: string }[];
  };
  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const milestones = Array.isArray(b.milestones) ? b.milestones : [];
  const goals = Array.isArray(b.goals) ? b.goals : [];
  const vel = velocityScore(
    milestones.map((m) => ({ date: m.date || "" })),
    goals.map((g) => ({ status: g.status || "not_started" }))
  );

  const { system, user } = buildInsightsPrompt({
    currentRole: (b.currentRole || "").trim(), targetRole: (b.targetRole || "").trim(),
    milestones: milestones.map((m) => `${m.title || ""} (${m.date || ""})`),
    goals: goals.map((g) => `${g.title || ""} [${g.status || ""}]`),
    velocityScore: vel,
  });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 700, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const insights = normalizeInsights(extractJson(block && block.type === "text" ? block.text : ""), vel);
    if (!insights) throw new Error("bad insights");
    return NextResponse.json({ ...insights });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not generate insights. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
