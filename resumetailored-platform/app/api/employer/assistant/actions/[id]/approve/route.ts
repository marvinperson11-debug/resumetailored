import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant, canAssistantMutate } from "@/lib/employer-plan";
import { resolveUserEmail } from "@/lib/email";
import { approvePendingAction } from "@/lib/assistant-mutations";
import { listQueuedForPendingAction } from "@/lib/assistant-send-queue";

export const runtime = "nodejs";

/** POST — approve one pending action. Employer-scoped (403 on a mismatch,
 *  distinct from a plain 404) and idempotent: approving an already-resolved
 *  row reports its current status instead of re-executing
 *  (lib/assistant-mutations.ts `approvePendingAction` is the one place this
 *  logic lives — the batch-approve route calls the exact same function). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseAssistant(ctx.access)) return NextResponse.json({ error: "portal_required" }, { status: 403 });
  if (!canAssistantMutate(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "Approving assistant actions needs the Scale plan." }, { status: 403 });
  }

  const actorEmail = await resolveUserEmail(ctx.userId).catch(() => null);
  const outcome = await approvePendingAction(ctx.employerId, ctx.userId, actorEmail, params.id, ctx.access);
  if (!outcome.found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (outcome.forbidden) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // message_candidates: hand back the queued send rows so the client can
  // render the undo countdown + Undo button right away.
  const sendQueue = outcome.status === "executed" ? await listQueuedForPendingAction(params.id) : [];

  return NextResponse.json({
    status: outcome.status,
    failureReason: outcome.failureReason ?? null,
    sendQueue: sendQueue.map((s) => ({ id: s.id, candidateId: s.candidateId, sendAt: s.sendAt, status: s.status })),
  });
}
