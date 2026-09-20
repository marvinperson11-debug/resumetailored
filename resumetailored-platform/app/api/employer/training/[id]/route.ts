import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { getTrainingDoc, complianceGrid, deleteTrainingDoc } from "@/lib/training-store";
import { getLibraryItem } from "@/lib/training-library";

export const runtime = "nodejs";

/** GET one training doc + its compliance grid (assignees × their ack). When the
 *  doc was created from a Library video, its `libraryItem` (embed + source) rides
 *  along so the drawer can render the watch step. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const doc = await getTrainingDoc(ctx.employerId, Number(params.id));
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [grid, libraryItem] = await Promise.all([
    complianceGrid(ctx.employerId, doc),
    doc.libraryItemId ? getLibraryItem(doc.libraryItemId) : Promise.resolve(null),
  ]);
  return NextResponse.json({ doc, grid, libraryItem });
}

/** DELETE a training doc (owner only). Acknowledgments cascade. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can delete training." }, { status: 403 });
  const ok = await deleteTrainingDoc(ctx.employerId, Number(params.id));
  return NextResponse.json({ ok });
}
