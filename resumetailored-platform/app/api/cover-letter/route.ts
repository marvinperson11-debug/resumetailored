import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { getAnthropic, buildTailorPrompts, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { isIndividualPro } from "@/lib/plan";
import { allTemplatesFree, PRO_TEMPLATE_MESSAGE } from "@/lib/template-gate";
import { recordGeneration } from "@/lib/generations";
import { cleanInstructions } from "@/lib/instructions";
import { getCustomInstructions } from "@/lib/user-prefs-store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Generates a cover letter from the candidate's info + job posting. This is the
 * same AI pipeline as `/api/tailor` with mode="cover_letter" (the old site used
 * one endpoint); it lives at its own route so the Cover Letter tool has a clean
 * surface. `resume` here is the candidate's background/highlights text.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "cover-letter");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Your session expired. Please refresh and sign in again." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobPosting?: string; customInstructions?: unknown; templateId?: unknown };
  // Server-side template gate (mirrors Legacy FREE_TPL_SIGS): a free account may only
  // use the free template ids; anything else is Pro.
  if (body.templateId !== undefined && !allTemplatesFree([body.templateId]) && !(await isIndividualPro())) {
    return NextResponse.json({ error: "pro_template", message: PRO_TEMPLATE_MESSAGE }, { status: 402 });
  }

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

  const customInstructions =
    typeof body.customInstructions === "string" ? cleanInstructions(body.customInstructions) : (await getCustomInstructions(userId)).instructions;

  const { system, user: userPrompt } = buildTailorPrompts({ resume: resume || "", jobPosting, mode: "cover_letter", customInstructions });

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = message.content[0];
    const text = block && block.type === "text" ? block.text : "";
    await recordGeneration(userId, "cover_letter", { text });
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
