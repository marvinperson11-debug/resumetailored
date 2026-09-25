import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listTrainingDocs, listAcknowledgmentsForEmployee } from "@/lib/training-store";
import { docIdsWithQuiz } from "@/lib/quiz-store";

export const runtime = "nodejs";

/** GET every training item assigned to (or self-assigned by) the current
 *  employee, each with their own acknowledgment and whether it has a quiz. */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [docs, acks] = await Promise.all([
    listTrainingDocs(ctx.employerId),
    listAcknowledgmentsForEmployee(ctx.employerId, ctx.employeeId),
  ]);
  const ackByDoc = new Map(acks.map((a) => [a.trainingDocId, a] as const));
  const mine = docs.filter((d) => ackByDoc.has(d.id));
  const quizDocIds = await docIdsWithQuiz(ctx.employerId, mine.map((d) => d.id));

  const items = mine.map((doc) => ({
    doc: { id: doc.id, title: doc.title, docKind: doc.docKind, libraryItemId: doc.libraryItemId },
    ack: ackByDoc.get(doc.id)!,
    hasQuiz: quizDocIds.has(doc.id),
  }));
  return NextResponse.json({ items });
}
