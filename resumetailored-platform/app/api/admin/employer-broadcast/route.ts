import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import {
  listEmployerBroadcastRecipients,
  sendTaylorBroadcast,
  EMPLOYER_BROADCAST_SUBJECT,
} from "@/lib/employer-broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only one-off broadcast: emails every real outside employer about
 * Taylor, the AI hiring assistant. Without `?do=1` this only previews who
 * would receive it and sends nothing; `?do=1` runs the send.
 */
export async function GET(req: NextRequest) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!ctx.access.isAdmin) return NextResponse.json({ error: "Admin only." }, { status: 403 });

  const { recipients, skipped } = await listEmployerBroadcastRecipients();

  if (req.nextUrl.searchParams.get("do") !== "1") {
    return NextResponse.json({
      ok: true,
      preview: true,
      count: recipients.length,
      recipients: recipients.map((r) => ({ company: r.company, email: r.email })),
      skipped,
      subject: EMPLOYER_BROADCAST_SUBJECT,
    });
  }

  const { sent, failed, errors } = await sendTaylorBroadcast(recipients);
  return NextResponse.json({ ok: true, sent, failed, errors });
}
