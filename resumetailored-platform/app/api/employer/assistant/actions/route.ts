import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant } from "@/lib/employer-plan";
import { listPendingActions } from "@/lib/assistant-pending";

export const runtime = "nodejs";

/** GET the employer's own pending-approvals inbox: every still-pending,
 *  not-yet-expired action a mutating tool has drafted this chat (or a
 *  teammate's chat) session. Portal tier and up, same gate as the chat route
 *  — a sub-Portal employer never sees the assistant panel at all, so this
 *  endpoint never needs to be reachable for them either. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseAssistant(ctx.access)) return NextResponse.json({ error: "portal_required" }, { status: 403 });

  const actions = await listPendingActions(ctx.employerId);
  return NextResponse.json({
    actions: actions.map((a) => ({
      id: a.id,
      action: a.action,
      artifact: a.artifact,
      irreversible: a.irreversible,
      status: a.status,
      failureReason: a.failureReason,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
    })),
  });
}
