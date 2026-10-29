import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { cancelReminder } from "@/lib/employer-reminders";

export const runtime = "nodejs";

/** DELETE — cancel a still-pending reminder (the Scheduler panel's own
 *  cancel button; the same operation as the assistant's cancel_reminder
 *  tool, just from the UI instead of chat). A reminder already fired or
 *  already cancelled comes back as `{ok:true, cancelled:false}`, not an
 *  error — same honesty convention as the tool. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = String(params.id || "");
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const result = await cancelReminder(employerId, id);
  if (!result.found) return NextResponse.json({ error: "Reminder not found." }, { status: 404 });
  return NextResponse.json({ ok: true, cancelled: result.cancelled });
}
