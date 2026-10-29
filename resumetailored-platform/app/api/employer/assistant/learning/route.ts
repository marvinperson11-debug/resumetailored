import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { listLearnings, describeLearning, isSuggestable } from "@/lib/assistant-employer-learning";

export const runtime = "nodejs";

/** GET — this employer's own "What Taylor has learned about you" list
 *  (the Assistant panel's learning view). Same employer-scoping as every
 *  other Assistant surface — `listLearnings` filters by `employer_id` in
 *  the query itself, so there is no way to read another employer's rows
 *  through this route. */
export async function GET() {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await listLearnings(employerId);
  return NextResponse.json({
    learnings: rows.map((r) => ({
      id: r.id,
      category: r.category,
      signalKey: r.signalKey,
      signalValue: r.signalValue,
      sampleCount: r.sampleCount,
      corrected: r.corrected,
      suggestable: isSuggestable(r),
      description: describeLearning(r),
      updatedAt: r.updatedAt,
    })),
  });
}
