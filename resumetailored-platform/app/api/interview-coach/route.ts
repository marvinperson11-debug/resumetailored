import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { isPro } from "@/lib/plan";
import {
  buildInterviewQuestionsPrompt,
  buildInterviewFeedbackPrompt,
  extractJson,
  type InterviewQuestion,
  type InterviewFeedback,
} from "@/lib/tools-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Interview Coach — generates likely questions from a JD, and scores a typed
 *  answer. action: "questions" | "feedback". */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    jobText?: string;
    question?: string;
    answer?: string;
    role?: string;
  };
  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });
  const pro = await isPro();

  try {
    if (body.action === "feedback") {
      const question = (body.question || "").trim();
      const answer = (body.answer || "").trim();
      if (answer.length < 5) return NextResponse.json({ error: "Give the coach a real answer to review." }, { status: 400 });
      const { system, user } = buildInterviewFeedbackPrompt({ question, answer, role: body.role });
      const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 700, system, messages: [{ role: "user", content: user }] });
      const block = msg.content[0];
      const feedback = extractJson<InterviewFeedback>(block && block.type === "text" ? block.text : "");
      if (!feedback) throw new Error("bad feedback json");
      return NextResponse.json({ feedback, pro });
    }

    // Default: generate questions.
    const jobText = (body.jobText || "").trim();
    if (jobText.length < 40) return NextResponse.json({ error: "Paste the job description (a few sentences at least)." }, { status: 400 });
    const count = pro ? 12 : 5; // free = 5 questions, Pro = more
    const { system, user } = buildInterviewQuestionsPrompt(jobText, count);
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const parsed = extractJson<{ questions: InterviewQuestion[] }>(block && block.type === "text" ? block.text : "");
    const questions = (parsed?.questions || []).slice(0, count);
    if (!questions.length) throw new Error("no questions");
    return NextResponse.json({ questions, pro });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Something went wrong. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
