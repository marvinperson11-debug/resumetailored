import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAnthropic, buildTailorPrompts, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { recordGeneration } from "@/lib/generations";
import type { Mode } from "@/lib/resume-templates";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Tailors a resume and/or cover letter to a job posting. Ported from the old
 * site's `/api/tailor`: same prompts, same model (claude-sonnet-4-6). Requires
 * a signed-in Clerk user (the account, not a daily quota, guards the AI budget).
 * Tailoring itself is free + unlimited for signed-in users.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Your session expired. Please refresh and sign in again." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobPosting?: string; mode?: Mode };
  const { resume, jobPosting, mode } = body;

  if (!mode || !["resume", "cover_letter", "both"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode." }, { status: 400 });
  }
  if (!jobPosting || typeof jobPosting !== "string") {
    return NextResponse.json({ error: "Job posting is required." }, { status: 400 });
  }
  if (mode !== "cover_letter" && (!resume || typeof resume !== "string")) {
    return NextResponse.json({ error: "Resume is required." }, { status: 400 });
  }
  // Cost floor: cap request size (a few thousand words is realistic).
  if (jobPosting.length > 50000 || (resume && resume.length > 50000)) {
    return NextResponse.json({ error: "Text is too long. Please paste the resume/job posting text only." }, { status: 400 });
  }

  const anthropic = getAnthropic();
  if (!anthropic) {
    return NextResponse.json({ error: "not_configured", message: "AI is not configured. Set ANTHROPIC_API_KEY." }, { status: 501 });
  }

  const { system, user: userPrompt } = buildTailorPrompts({ resume, jobPosting, mode });

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = message.content[0];
    const text = block && block.type === "text" ? block.text : "";
    // Persist for the dashboard (both = a resume + a cover letter in one call).
    await recordGeneration(userId, mode === "cover_letter" ? "cover_letter" : "resume", { text, mode });
    return NextResponse.json({ result: text });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error("Claude API error:", e?.status, e?.message || err);
    let userMessage = "AI processing failed. Please try again.";
    if (e?.status === 401) userMessage = "AI service authentication error. Please contact support.";
    else if (e?.status === 429) userMessage = "AI is rate limited. Please wait a moment and try again.";
    else if (isProviderUnavailable(err)) userMessage = "AI service is temporarily busy. Please try again in 30 seconds.";
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
