import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseAssistant, canAssistantMutate } from "@/lib/employer-plan";
import { resolveUserEmail } from "@/lib/email";
import { approvePendingAction } from "@/lib/assistant-mutations";

export const runtime = "nodejs";

const MAX_BATCH = 50;

/** POST { ids: string[] } — approve several pending actions in one request
 *  (docs/assistant-confirmation-card.md "batch approval"; this is for
 *  approving several SEPARATE cards from the inbox at once, not a
 *  per-item-within-one-card partial approve, which the card format doesn't
 *  support). Each id goes through the exact same `approvePendingAction` the
 *  single-approve route uses — there is one approval code path, called
 *  either once or in a loop. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canUseAssistant(ctx.access)) return NextResponse.json({ error: "portal_required" }, { status: 403 });
  if (!canAssistantMutate(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "Approving assistant actions needs the Scale plan." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_BATCH) : [];
  if (!ids.length) return NextResponse.json({ error: "ids is required" }, { status: 400 });

  const actorEmail = await resolveUserEmail(ctx.userId).catch(() => null);
  const results: { id: string; status: string | null; failureReason: string | null }[] = [];
  for (const id of ids) {
    const outcome = await approvePendingAction(ctx.employerId, ctx.userId, actorEmail, id);
    if (!outcome.found) {
      results.push({ id, status: "not_found", failureReason: null });
    } else if (outcome.forbidden) {
      results.push({ id, status: "forbidden", failureReason: null });
    } else {
      results.push({ id, status: outcome.status, failureReason: outcome.failureReason ?? null });
    }
  }
  return NextResponse.json({ results });
}
