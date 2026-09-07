import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getAnthropic, buildTailorPrompts, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { recordGeneration } from "@/lib/generations";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Generates a cover letter from the candidate's info + job posting. This is the
 * same AI pipeline as `/api/tailor` with mode="cover_letter" (the old site used
 * one endpoint); it lives at its own route so the Cover Letter tool has a clean
 * surface. `resume` here is the candidate's background/highlights text.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobPosting?: string };
  const { resume, jobPosting } = body;

  if (!jobPosting || typeof jobPosting !== "string") {
    return NextResponse.json({ error: "Job details are required." }, { status: 400 });
  }
  if (jobPosting.length > 50000 || (resume && resume.length > 50000)) {
    return NextResponse.json({ error: "Text is too long. Please paste the text only." }, { status: 400 });
  }

  const anthropic = getAnthropic();
  if (!anthropic) {
    return NextResponse.json({ error: "not_configured", message: "AI is not configured. Set ANTHROPIC_API_KEY." }, { status: 501 });
  }

  const { system, user: userPrompt } = buildTailorPrompts({ resume: resume || "", jobPosting, mode: "cover_letter" });

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = message.content[0];
    const text = block && block.type === "text" ? block.text : "";
    await recordGeneration(user.id, "cover_letter", { text });
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
