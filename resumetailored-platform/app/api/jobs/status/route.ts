import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { updateJobStatus, isJobStatus } from "@/lib/job-saves";

export const runtime = "nodejs";

/** Update a saved job's tracker status (saved → applied → interview → offer →
 *  rejected). Free — the basic tracker is available to everyone. */
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { id?: number; status?: string; notes?: string };
  const id = Number(body.id);
  if (!id || !isJobStatus(body.status)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const ok = await updateJobStatus(userId, id, body.status, typeof body.notes === "string" ? body.notes : undefined);
  return NextResponse.json({ ok });
}
