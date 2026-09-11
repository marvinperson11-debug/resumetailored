import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deleteMilestone } from "@/lib/career-store";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const ok = await deleteMilestone(userId, id);
  return NextResponse.json({ ok });
}
