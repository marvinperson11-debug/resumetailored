import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { runCertReminderScan } from "@/lib/cert-cron";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Admin-only manual trigger for the certification-expiry reminder scan —
 * lets ops run/verify it on demand without waiting for the daily
 * `CERT_CRON=on` scheduler in instrumentation.ts. Same admin-gated,
 * platform-wide shape as the Training Library's seed route (this scan is
 * not employer-scoped: it walks every employer's certs).
 */
export async function GET(req: NextRequest) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!ctx.access.isAdmin) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  if (req.nextUrl.searchParams.get("do") !== "1") {
    return NextResponse.json({ ok: true, hint: "Open this URL with ?do=1 to run the scan now." });
  }
  const result = await runCertReminderScan();
  return NextResponse.json({ ok: true, ...result });
}
