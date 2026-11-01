import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseSms } from "@/lib/employer-plan";
import { normalizeTier } from "@/lib/employer-tier";
import { getSmsCapStatus } from "@/lib/sms-quota";

export const runtime = "nodejs";

/** GET — this org's current-cycle segment usage against its tier cap. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseSms(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "sms" }, { status: 402 });
  const tier = ctx.access.isAdmin ? "corporate" : normalizeTier(ctx.access.tier);
  const status = await getSmsCapStatus(ctx.employerId, tier);
  return NextResponse.json({ status });
}
