import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getConnectionStatus, monthlySendCount } from "@/lib/docusign-store";
import { isDocusignConfigured } from "@/lib/docusign";
import { checkSendAllowance } from "@/lib/employer-plan";

export const runtime = "nodejs";

/** Connection + monthly-usage summary for the /employer/docusign status page. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [connection, used] = await Promise.all([
    getConnectionStatus(ctx.employerId),
    monthlySendCount(ctx.employerId),
  ]);
  const allowance = checkSendAllowance(ctx.access, used);

  return NextResponse.json({
    configured: isDocusignConfigured(),
    connection,
    usage: {
      used: allowance.used,
      tier: allowance.tier,
      limit: allowance.limit === Infinity ? null : allowance.limit,
      remaining: allowance.remaining === Infinity ? null : allowance.remaining,
    },
  });
}
