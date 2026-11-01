import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseSms } from "@/lib/employer-plan";
import { normalizeTier } from "@/lib/employer-tier";
import { purchaseOveragePack, OVERAGE_PACK_SEGMENTS, OVERAGE_PACK_PRICE_CENTS } from "@/lib/sms-quota";
import { flushQueuedForEmployer } from "@/lib/sms-queue-flush";
import { logAction } from "@/lib/assistant-audit";

export const runtime = "nodejs";

/**
 * POST — buy one overage pack (+500 segments / $10) for the current cycle.
 * Not a candidate-facing action (no candidate is contacted by this call
 * itself), so it doesn't require the `confirm: true` guard the send/order
 * routes do — it's a billing action the employer already triggered by
 * clicking "Buy more segments".
 *
 * Billing capture (card on file) is NOT wired here — this records the
 * purchase and immediately restores sending; actually charging the card is
 * a separate payments integration this build doesn't include. See the
 * build's final report for this gap.
 */
export async function POST() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseSms(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "sms" }, { status: 402 });
  const tier = ctx.access.isAdmin ? "corporate" : normalizeTier(ctx.access.tier);

  const status = await purchaseOveragePack(ctx.employerId, tier);
  if (!status) return NextResponse.json({ error: "purchase_failed" }, { status: 500 });

  await logAction({ employerId: ctx.employerId, actorUserId: ctx.userId, action: "sms.overage_purchased", targetType: "sms_overage", payload: { segments: OVERAGE_PACK_SEGMENTS, priceCents: OVERAGE_PACK_PRICE_CENTS }, status: "executed" });

  // "Restores sending immediately" — flush this org's queue right now
  // rather than waiting for the next 30-minute scan.
  const flush = await flushQueuedForEmployer(ctx.employerId);

  return NextResponse.json({ ok: true, status, flushed: flush });
}
