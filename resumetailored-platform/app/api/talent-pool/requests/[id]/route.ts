import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { respondToContactRequest } from "@/lib/talent-pool-store";
import { notifyEmployerOfResponse } from "@/lib/talent-pool-notify";

export const runtime = "nodejs";

/** PATCH — a candidate accepts or declines one of their own incoming
 *  requests. Validated through the pure state machine in
 *  lib/talent-pool-core.ts (pending → accepted|declined only); on success,
 *  the employer is notified in-app + by email (lib/talent-pool-notify.ts) —
 *  on accept, that email is also where their contact details become
 *  visible to that employer (Q3), inside the employer's own requests view. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.status !== "accepted" && body.status !== "declined") {
    return NextResponse.json({ error: "status must be 'accepted' or 'declined'." }, { status: 400 });
  }

  const result = await respondToContactRequest(userId, params.id, body.status);
  if (!result.ok || !result.request) return NextResponse.json({ error: result.reason || "Could not save." }, { status: 400 });

  await notifyEmployerOfResponse(result.request.employerId, userId, body.status === "accepted").catch(() => {});
  return NextResponse.json({ request: result.request });
}
