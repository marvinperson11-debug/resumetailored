import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deleteSavedJob } from "@/lib/job-saves";

export const runtime = "nodejs";

/** Remove one saved job by id. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await deleteSavedJob(userId, id);
  if (!ok) return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
