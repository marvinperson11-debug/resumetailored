import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { updateApplication, deleteApplication, type ApplicationInput } from "@/lib/applications";

export const runtime = "nodejs";

/** Update one application. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as ApplicationInput;
  const application = await updateApplication(userId, id, body);
  if (!application) return NextResponse.json({ error: "Could not update." }, { status: 500 });
  return NextResponse.json({ application });
}

/** Delete one application. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await deleteApplication(userId, id);
  if (!ok) return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
