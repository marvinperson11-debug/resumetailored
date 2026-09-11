import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildQuestionsPrompt, normalizeQuestions, isInterviewType, isDifficulty } from "@/lib/interview-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Generate interview questions + coaching. All signed-in users; free users get
 *  the first 5 (with the true total so the UI can show the locked count). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobDescription?: string; type?: string; difficulty?: string };
  const jobDescription = (body.jobDescription || "").trim();
  if (jobDescription.length < 40) return NextResponse.json({ error: "Paste the job description (a few sentences at least)." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const type = isInterviewType(body.type) ? body.type : "behavioral";
  const difficulty = isDifficulty(body.difficulty) ? body.difficulty : "mid";
  const pro = await isPro();
  const FULL = 15;
  const FREE = 5;

  const { system, user } = buildQuestionsPrompt({ resume: (body.resume || "").trim(), jobDescription, type, difficulty, count: FULL });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 2600, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const { questions, coaching } = normalizeQuestions(extractJson(block && block.type === "text" ? block.text : ""));
    if (!questions.length) throw new Error("no questions");
    const total = questions.length;
    const visible = pro ? questions : questions.slice(0, FREE);
    return NextResponse.json({ questions: visible, coaching, pro, total, lockedCount: pro ? 0 : Math.max(0, total - visible.length) });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not generate questions. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
