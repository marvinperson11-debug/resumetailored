import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBackgroundChecks, normalizeTier } from "@/lib/employer-plan";
import { getEmployerSettings, setBgcBillingMode } from "@/lib/bgc-store";

export const runtime = "nodejs";

/** GET — this org's background-check billing mode (per_check or invoiced). */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBackgroundChecks(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "background_checks" }, { status: 402 });
  const settings = await getEmployerSettings(ctx.employerId);
  return NextResponse.json({ settings });
}

/** PATCH — switch to invoiced billing. Corporate-only: every other tier
 *  pays per check with a card on file. */
export async function PATCH(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBackgroundChecks(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "background_checks" }, { status: 402 });
  const tier = ctx.access.isAdmin ? "corporate" : normalizeTier(ctx.access.tier);

  let body: { billingMode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (body.billingMode !== "per_check" && body.billingMode !== "invoiced") return NextResponse.json({ error: "bad_billing_mode" }, { status: 400 });
  if (body.billingMode === "invoiced" && tier !== "corporate") return NextResponse.json({ error: "corporate_only" }, { status: 403 });

  const ok = await setBgcBillingMode(ctx.employerId, body.billingMode);
  if (!ok) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
