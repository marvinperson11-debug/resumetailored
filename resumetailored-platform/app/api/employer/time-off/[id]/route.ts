import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseEmployerPortal } from "@/lib/plan";
import { setTimeOffStatus } from "@/lib/time-store";
import { isTimeOffStatus } from "@/lib/time-hub";

export const runtime = "nodejs";

/** POST { status: "approved"|"declined"|"pending", note? } → the employer's
 *  decision on one time-off request. An approved request surfaces on the
 *  schedule for its dates. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx || !canUseEmployerPortal(ctx.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { status?: string; note?: string };
  if (!isTimeOffStatus(b.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });

  const request = await setTimeOffStatus(ctx.employerId, id, b.status, b.note || "", ctx.userId);
  if (!request) return NextResponse.json({ error: "Could not update the request." }, { status: 400 });
  return NextResponse.json({ request });
}
