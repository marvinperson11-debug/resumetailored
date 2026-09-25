import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { getLibraryItem } from "@/lib/training-library";
import { selfAssignFromLibrary } from "@/lib/training-store";

export const runtime = "nodejs";

/** POST "Take this training" — the employee self-assigns a Library item.
 *  Body: { libraryItemId }. Returns the (found-or-created) training doc id so
 *  the client can open it in My training. */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { libraryItemId?: number };
  const item = Number.isFinite(b.libraryItemId) ? await getLibraryItem(Number(b.libraryItemId)) : null;
  if (!item) return NextResponse.json({ error: "Library item not found." }, { status: 404 });

  const result = await selfAssignFromLibrary(ctx.employerId, ctx.employeeId, item);
  if (!result) return NextResponse.json({ error: "Could not start this training." }, { status: 500 });
  return NextResponse.json({ docId: result.doc.id });
}
