import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildSkillGapPrompt, normalizeSkillGap } from "@/lib/career-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** AI skill-gap analysis. PRO ONLY. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });
  if (!(await isPro())) return NextResponse.json({ error: "pro_required", message: "Skill-gap analysis is a Pro feature." }, { status: 402 });

  const b = (await req.json().catch(() => ({}))) as { currentSkills?: string[]; targetRole?: string; industry?: string };
  if (!(b.targetRole || "").trim()) return NextResponse.json({ error: "Set a target role first." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildSkillGapPrompt({
    currentSkills: Array.isArray(b.currentSkills) ? b.currentSkills.map(String) : [],
    targetRole: (b.targetRole || "").trim(), industry: (b.industry || "").trim(),
  });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1800, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const gap = normalizeSkillGap(extractJson(block && block.type === "text" ? block.text : ""));
    if (!gap) throw new Error("bad gap");
    return NextResponse.json({ ...gap });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not analyze the skill gap. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
