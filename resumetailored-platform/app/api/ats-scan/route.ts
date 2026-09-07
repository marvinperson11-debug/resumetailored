import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getAnthropic, buildAtsPrompt, localAtsFallback, isProviderUnavailable, CLAUDE_MODEL, type AtsResult } from "@/lib/ai";
import { recordGeneration } from "@/lib/generations";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scores a resume against a job description and surfaces matched/missing
 * keywords + rewrite suggestions. Ported from the old site's `/api/ats-scan`
 * (same prompt, model, and keyword-overlap fallback). The ATS scanner is a
 * free-tier feature and unlimited for everyone — no per-day cap (only the
 * Pro-only tools, Resume Video and Web Studio, are gated).
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobPosting?: string };
  const { resume, jobPosting } = body;
  if (!resume || !jobPosting) {
    return NextResponse.json({ error: "Resume and job posting are required." }, { status: 400 });
  }

  const anthropic = getAnthropic();
  if (!anthropic) {
    // No key configured → still return a useful (deterministic) result.
    const result = localAtsFallback(resume, jobPosting);
    await recordGeneration(user.id, "ats", result);
    return NextResponse.json(result);
  }

  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildAtsPrompt(resume, jobPosting) }],
    });
    const block = msg.content[0];
    const raw = (block && block.type === "text" ? block.text : "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const result = JSON.parse(jsonMatch[0]) as AtsResult;
    await recordGeneration(user.id, "ats", result);
    return NextResponse.json(result);
  } catch (err) {
    const e = err as { message?: string };
    console.error("ATS scan error:", e?.message || err);
    if (isProviderUnavailable(err)) {
      const result = localAtsFallback(resume, jobPosting);
      await recordGeneration(user.id, "ats", result);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Analysis failed. Please try again." }, { status: 500 });
  }
}
