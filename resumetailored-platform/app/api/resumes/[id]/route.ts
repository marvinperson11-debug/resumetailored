import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deleteDraft } from "@/lib/resume-drafts";

export const runtime = "nodejs";

/** Delete one saved resume by id (FIX 8). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const ok = await deleteDraft(userId, params.id);
  if (!ok) return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
