import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { listReminders, type ReminderStatus } from "@/lib/employer-reminders";

export const runtime = "nodejs";

function parseStatus(v: string | null): ReminderStatus | undefined {
  return v === "pending" || v === "fired" || v === "cancelled" ? v : undefined;
}

/** GET — this employer's own reminders (the Scheduler page's Reminders
 *  panel). ?status= narrows to one state; omitted returns every status. */
export async function GET(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const reminders = await listReminders(employerId, parseStatus(url.searchParams.get("status")));
  return NextResponse.json({ reminders });
}
