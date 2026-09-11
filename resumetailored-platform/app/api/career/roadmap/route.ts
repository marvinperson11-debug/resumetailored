import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildRoadmapPrompt, normalizeRoadmap } from "@/lib/career-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** AI career roadmap. PRO ONLY. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });
  if (!(await isPro())) return NextResponse.json({ error: "pro_required", message: "The AI career roadmap is a Pro feature." }, { status: 402 });

  const b = (await req.json().catch(() => ({}))) as { currentRole?: string; targetRole?: string; industry?: string; yearsExperience?: number | null; skills?: string[]; goals?: string[] };
  if (!(b.currentRole || "").trim() && !(b.targetRole || "").trim()) return NextResponse.json({ error: "Set your current and target role first." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildRoadmapPrompt({
    currentRole: (b.currentRole || "").trim(), targetRole: (b.targetRole || "").trim(), industry: (b.industry || "").trim(),
    yearsExperience: typeof b.yearsExperience === "number" ? b.yearsExperience : null,
    skills: Array.isArray(b.skills) ? b.skills.map(String) : [], goals: Array.isArray(b.goals) ? b.goals.map(String) : [],
  });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 2200, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const roadmap = normalizeRoadmap(extractJson(block && block.type === "text" ? block.text : ""));
    if (!roadmap) throw new Error("bad roadmap");
    return NextResponse.json({ ...roadmap });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not build the roadmap. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
