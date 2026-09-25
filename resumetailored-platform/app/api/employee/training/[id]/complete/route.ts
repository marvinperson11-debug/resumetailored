import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { employeeMarkComplete } from "@/lib/training-store";
import { getQuizForDoc } from "@/lib/quiz-store";

export const runtime = "nodejs";

/** POST mark a (no-quiz) training complete, in-house — no DocuSign. A doc
 *  with a quiz attached must go through /quiz instead (completion is the
 *  passing attempt), so this route refuses those. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const docId = Number(params.id);
  if (!Number.isFinite(docId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const quiz = await getQuizForDoc(ctx.employerId, docId);
  if (quiz) return NextResponse.json({ error: "This training has a quiz — take it to complete." }, { status: 400 });

  const ack = await employeeMarkComplete(ctx.employerId, ctx.employeeId, docId);
  if (!ack) return NextResponse.json({ error: "Could not mark this complete." }, { status: 400 });
  return NextResponse.json({ ack });
}
