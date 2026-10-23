import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { runCertReminderScan } from "@/lib/cert-cron";
import { runInterviewReminderScan } from "@/lib/interview-reminders";
import { runDailyBriefScan } from "@/lib/assistant-brief";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Admin-only manual trigger for the platform-wide reminder scans — lets ops
 * run/verify them on demand without waiting for the `CERT_CRON=on` scheduler
 * in instrumentation.ts. Same admin-gated, platform-wide shape as the
 * Training Library's seed route (neither scan is employer-scoped: each walks
 * every employer's rows). Runs the certification scan (unchanged) AND the
 * interview reminder scan (lib/interview-reminders.ts) AND the daily morning
 * brief scan (lib/assistant-brief.ts) — one manual trigger for everything
 * instrumentation.ts's one CERT_CRON-gated tick now runs.
 *
 * `?force=1` additionally runs the brief scan in verification mode
 * (lib/assistant-brief.ts `runDailyBriefScan`'s `force` option): it bypasses
 * the due-check and quiet-skip so ops can actually SEE a rendered brief on
 * demand, and it never writes `last_brief_at` — a forced run must not
 * consume the employer's real daily slot.
 */
export async function GET(req: NextRequest) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!ctx.access.isAdmin) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  if (req.nextUrl.searchParams.get("do") !== "1") {
    return NextResponse.json({ ok: true, hint: "Open this URL with ?do=1 to run the scans now. Add &force=1 to force-verify the daily brief without consuming the real daily slot." });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  const certs = await runCertReminderScan();
  const interviews = await runInterviewReminderScan();
  const brief = await runDailyBriefScan(Date.now(), { force });
  return NextResponse.json({ ok: true, ...certs, interviews, brief });
}
