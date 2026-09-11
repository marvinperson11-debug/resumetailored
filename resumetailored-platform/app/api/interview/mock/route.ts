import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildMockPrompt, normalizeMock, isInterviewType, isDifficulty, type QA } from "@/lib/interview-ai";
import { saveInterviewSession } from "@/lib/interview-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MOCK_Q = 6;

/** Stateful mock interview. PRO ONLY. Returns the next question, or (once
 *  MAX_MOCK_Q answers are in) a final report which is saved to Supabase. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  if (!(await isPro())) {
    return NextResponse.json({ error: "pro_required", message: "The full mock interview is a Pro feature." }, { status: 402 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    resume?: string; jobDescription?: string; type?: string; difficulty?: string; previousQAs?: QA[];
  };
  const jobDescription = (body.jobDescription || "").trim();
  if (jobDescription.length < 40) return NextResponse.json({ error: "Set up the interview (paste a job description) first." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const type = isInterviewType(body.type) ? body.type : "behavioral";
  const difficulty = isDifficulty(body.difficulty) ? body.difficulty : "mid";
  const previousQAs = Array.isArray(body.previousQAs)
    ? body.previousQAs
        .filter((qa) => qa && typeof qa.question === "string" && typeof qa.answer === "string")
        .map((qa) => ({ question: String(qa.question).slice(0, 800), answer: String(qa.answer).slice(0, 3000) }))
        .slice(0, MAX_MOCK_Q)
    : [];

  const { system, user } = buildMockPrompt({ resume: (body.resume || "").trim(), jobDescription, type, difficulty, previousQAs, maxQuestions: MAX_MOCK_Q });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 900, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const out = normalizeMock(extractJson(block && block.type === "text" ? block.text : ""));
    if (!out.isFinal && !out.nextQuestion) throw new Error("empty mock reply");

    if (out.isFinal && out.report) {
      saveInterviewSession(userId, {
        jobDescription, resumeText: (body.resume || "").trim(),
        interviewType: type, difficulty, qas: previousQAs, report: out.report,
      });
    }
    return NextResponse.json({ nextQuestion: out.nextQuestion, isFinal: out.isFinal, report: out.report, index: previousQAs.length, max: MAX_MOCK_Q });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "The mock interview hit a snag. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
