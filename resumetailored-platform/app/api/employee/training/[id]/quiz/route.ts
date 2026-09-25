import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { getAcknowledgmentByDocAndEmployee, recordQuizAttempt } from "@/lib/training-store";
import { getQuizForDoc } from "@/lib/quiz-store";
import { scoreQuiz } from "@/lib/quiz-hub";

export const runtime = "nodejs";

/**
 * POST submit quiz answers. Body: { answers: number[] } (one choice index per
 * question, in question order). Scored server-side against the real answer
 * key (never sent to the client). Passing (score >= passThreshold) completes
 * the acknowledgment in-house; failing shows per-question results + a retake
 * — attempts and the best score ride on the acknowledgment, already visible
 * in the employer's compliance grid.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const docId = Number(params.id);
  if (!Number.isFinite(docId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const ack = await getAcknowledgmentByDocAndEmployee(ctx.employerId, docId, ctx.employeeId);
  if (!ack) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const quiz = await getQuizForDoc(ctx.employerId, docId);
  if (!quiz) return NextResponse.json({ error: "This training has no quiz." }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { answers?: unknown };
  const answers = Array.isArray(b.answers) ? b.answers.map((a) => Number(a)) : [];

  const result = scoreQuiz(quiz.questions, answers, quiz.passThreshold);
  const updated = await recordQuizAttempt(ctx.employerId, ack.id, result.score, result.passed);
  if (!updated) return NextResponse.json({ error: "Could not record your attempt." }, { status: 500 });

  return NextResponse.json({
    score: result.score,
    passed: result.passed,
    passThreshold: quiz.passThreshold,
    correct: result.correct,
    attempts: updated.attempts,
    bestScore: updated.score,
  });
}
