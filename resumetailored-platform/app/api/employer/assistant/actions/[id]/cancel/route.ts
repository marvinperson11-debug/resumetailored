import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant, canAssistantMutate } from "@/lib/employer-plan";
import { cancelPendingAction } from "@/lib/assistant-mutations";

export const runtime = "nodejs";

/** POST — dismiss a still-pending action. A no-op on anything already
 *  resolved (reports the current status rather than erroring) — there is no
 *  persistent "rejected" state (docs/assistant-confirmation-card.md), the
 *  row just stops being in the pending inbox. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseAssistant(ctx.access)) return NextResponse.json({ error: "portal_required" }, { status: 403 });
  if (!canAssistantMutate(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "This needs the Scale plan." }, { status: 403 });
  }

  const outcome = await cancelPendingAction(ctx.employerId, params.id);
  if (!outcome.found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (outcome.forbidden) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ status: outcome.status });
}
