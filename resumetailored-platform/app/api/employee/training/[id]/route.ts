import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { getTrainingDoc, getAcknowledgmentByDocAndEmployee } from "@/lib/training-store";
import { getLibraryItem } from "@/lib/training-library";
import { getQuizForDoc } from "@/lib/quiz-store";
import { toPublicQuestions } from "@/lib/quiz-hub";

export const runtime = "nodejs";

/** GET one training item's content for the current employee — only if it's
 *  actually assigned to them (an acknowledgment row exists). The quiz, if
 *  any, comes back WITHOUT correctIndex; scoring happens server-side on
 *  submit. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const docId = Number(params.id);
  if (!Number.isFinite(docId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const ack = await getAcknowledgmentByDocAndEmployee(ctx.employerId, docId, ctx.employeeId);
  if (!ack) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const doc = await getTrainingDoc(ctx.employerId, docId);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [libraryItem, quiz] = await Promise.all([
    doc.libraryItemId ? getLibraryItem(doc.libraryItemId) : Promise.resolve(null),
    getQuizForDoc(ctx.employerId, docId),
  ]);

  return NextResponse.json({
    doc,
    ack,
    libraryItem,
    quiz: quiz ? { questions: toPublicQuestions(quiz.questions), passThreshold: quiz.passThreshold } : null,
  });
}
