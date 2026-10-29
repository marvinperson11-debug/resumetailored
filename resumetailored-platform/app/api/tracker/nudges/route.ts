import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDueNudges, dismissNudge } from "@/lib/tracker-nudges";

export const runtime = "nodejs";

/** GET — the follow-up nudges due right now (Combined Build, Section 1).
 *  In-app only — delivered by the client polling/checking this on load,
 *  never an email (Marvin's decision: nudge digest off by default, in-app
 *  only). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const nudges = await getDueNudges(userId);
  return NextResponse.json({
    nudges: nudges.map((n) => ({ applicationId: n.application.id, jobTitle: n.application.jobTitle, company: n.application.company, stage: n.stage, daysDwelling: n.daysDwelling, message: n.message })),
  });
}

/** POST — dismiss the current nudge for one tracked application. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { applicationId?: string };
  if (!body.applicationId) return NextResponse.json({ error: "applicationId is required." }, { status: 400 });
  const ok = await dismissNudge(userId, body.applicationId);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
