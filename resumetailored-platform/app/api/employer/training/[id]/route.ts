import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { getTrainingDoc, complianceGrid, deleteTrainingDoc } from "@/lib/training-store";

export const runtime = "nodejs";

/** GET one training doc + its compliance grid (assignees × their ack). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const doc = await getTrainingDoc(ctx.employerId, Number(params.id));
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const grid = await complianceGrid(ctx.employerId, doc);
  return NextResponse.json({ doc, grid });
}

/** DELETE a training doc (owner only). Acknowledgments cascade. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can delete training." }, { status: 403 });
  const ok = await deleteTrainingDoc(ctx.employerId, Number(params.id));
  return NextResponse.json({ ok });
}
