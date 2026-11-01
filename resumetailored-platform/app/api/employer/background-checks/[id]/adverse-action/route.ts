import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBackgroundChecks } from "@/lib/employer-plan";
import { getOrder, startPreAdverseAction, sendAdverseNoticeAction, cancelAdverseAction, getAdverseActionState } from "@/lib/bgc-store";

export const runtime = "nodejs";

/**
 * POST — advance the FCRA two-step adverse-action flow for one order.
 * `action: "start_pre_adverse"` sends the pre-adverse notice and starts the
 * wait; `action: "send_adverse_notice"` sends the final notice, but ONLY
 * once lib/adverse-action.ts's own wait check passes — there is no request
 * shape that skips it, confirm:true included, because the check runs
 * AFTER the confirmation gate, not instead of it.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBackgroundChecks(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "background_checks" }, { status: 402 });

  let body: { action?: string; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (body.confirm !== true) return NextResponse.json({ error: "confirmation_required" }, { status: 400 });

  const order = await getOrder(ctx.employerId, params.id);
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.action === "start_pre_adverse") {
    const result = await startPreAdverseAction(order, ctx.userId, null);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  } else if (body.action === "send_adverse_notice") {
    const result = await sendAdverseNoticeAction(order, ctx.userId, null);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  } else if (body.action === "cancel") {
    await cancelAdverseAction(order, ctx.userId, null);
  } else {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }

  const adverseAction = await getAdverseActionState(order.id);
  return NextResponse.json({ ok: true, adverseAction });
}
