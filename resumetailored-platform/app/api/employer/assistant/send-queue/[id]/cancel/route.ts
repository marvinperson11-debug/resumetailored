import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant, canAssistantMutate } from "@/lib/employer-plan";
import { getSendQueueById, cancelQueued } from "@/lib/assistant-send-queue";

export const runtime = "nodejs";

/** POST — the Undo button for an approved `message_candidates` action. Only
 *  works on a still-`queued` row (within its undo window); once a row is
 *  `sent`, this answers 409 so the client can show "This can't be unsent"
 *  (docs/assistant-confirmation-card.md — the label itself is shown from the
 *  moment of approval, this route is just what makes "too late" real). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseAssistant(ctx.access)) return NextResponse.json({ error: "portal_required" }, { status: 403 });
  if (!canAssistantMutate(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "This needs the Scale plan." }, { status: 403 });
  }

  const existing = await getSendQueueById(params.id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (existing.employerId !== ctx.employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (existing.status === "sent") {
    return NextResponse.json({ error: "already_sent", message: "This can't be unsent.", status: "sent" }, { status: 409 });
  }
  if (existing.status !== "queued") return NextResponse.json({ status: existing.status });

  const ok = await cancelQueued(ctx.employerId, params.id);
  return NextResponse.json({ status: ok ? "cancelled" : existing.status });
}
