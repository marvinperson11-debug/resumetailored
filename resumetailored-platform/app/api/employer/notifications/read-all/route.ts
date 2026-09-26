import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { listForEmployer, markAllRead } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** POST mark every currently-visible employer notification read for this reader. */
export async function POST() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const items = await listForEmployer(ctx.employerId, ctx.userId, 100);
  await markAllRead(ctx.userId, items.map((i) => i.id));
  return NextResponse.json({ ok: true });
}
