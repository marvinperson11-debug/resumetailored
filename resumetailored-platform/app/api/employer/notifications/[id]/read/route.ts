import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { markRead } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** POST mark one notification read for the current reader — called on click,
 *  right before following its deep link. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await markRead(ctx.userId, id);
  return NextResponse.json({ ok: true });
}
