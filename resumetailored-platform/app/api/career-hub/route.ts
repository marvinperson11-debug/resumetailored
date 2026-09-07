import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { isPro } from "@/lib/plan";
import { buildCareerPrompt, extractJson, type CareerRoadmap } from "@/lib/tools-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Career Hub — career-path explorer + skill-gap roadmap. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { currentRole?: string; years?: string; targetRole?: string };
  const currentRole = (body.currentRole || "").trim();
  if (!currentRole) return NextResponse.json({ error: "Tell us your current role." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const pro = await isPro();
  const { system, user } = buildCareerPrompt({ currentRole, years: (body.years || "").trim() || "a few", targetRole: (body.targetRole || "").trim(), pro });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const roadmap = extractJson<CareerRoadmap>(block && block.type === "text" ? block.text : "");
    if (!roadmap) throw new Error("bad roadmap json");
    return NextResponse.json({ roadmap, pro });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Something went wrong. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
