import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveUserEmail } from "@/lib/email";
import {
  getTrackedApplication,
  updateTrackedApplication,
  addNote,
  moveStage,
  deleteTrackedApplication,
  logEvent,
  findOurJobApplicantStatus,
  type UpdateTrackedApplicationInput,
} from "@/lib/tracker-store";

export const runtime = "nodejs";

/** GET one tracked application. For an "our_job" card, also resolves the
 *  REAL employer-pipeline stage when a matching `applicants` row exists
 *  (Combined Build, Section 4) — labeled "from the employer portal" so the
 *  candidate never mistakes it for their own self-managed stage. `null`
 *  (no match, or an external posting) means self-managed: the client must
 *  never render an employer-status surface in that case. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const application = await getTrackedApplication(userId, params.id);
  if (!application) return NextResponse.json({ error: "not found" }, { status: 404 });

  let realStatus: { status: string; statusChangedAt: string; label: string } | null = null;
  if (application.sourceJobId) {
    const email = await resolveUserEmail(userId).catch(() => null);
    if (email) {
      const match = await findOurJobApplicantStatus(application.sourceJobId, email);
      if (match) realStatus = { ...match, label: "from the employer portal" };
    }
  }
  return NextResponse.json({ application, realStatus });
}

/** PATCH — stage move, a new note, archive/nudge toggles, or a plain field
 *  edit. One of `stage` / `note` takes priority over a plain field patch so
 *  a single call never tries to do two different things at once. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.stage !== undefined) {
    const result = await moveStage(userId, params.id, body.stage);
    if (!result.ok) return NextResponse.json({ error: result.reason || "Could not move stage." }, { status: 400 });
    return NextResponse.json({ application: result.application });
  }

  if (typeof body.note === "string" && body.note.trim()) {
    const application = await addNote(userId, params.id, body.note);
    if (!application) return NextResponse.json({ error: "Could not save note." }, { status: 400 });
    await logEvent(userId, params.id, "note_added", {});
    return NextResponse.json({ application });
  }

  const patch: UpdateTrackedApplicationInput = {};
  if (typeof body.jobTitle === "string") patch.jobTitle = body.jobTitle;
  if (typeof body.company === "string") patch.company = body.company;
  if (body.location !== undefined) patch.location = typeof body.location === "string" ? body.location : null;
  if (body.postingUrl !== undefined) patch.postingUrl = typeof body.postingUrl === "string" ? body.postingUrl : null;
  if (body.description !== undefined) patch.description = typeof body.description === "string" ? body.description : null;
  if (body.salaryMin !== undefined) patch.salaryMin = typeof body.salaryMin === "number" ? body.salaryMin : null;
  if (body.salaryMax !== undefined) patch.salaryMax = typeof body.salaryMax === "number" ? body.salaryMax : null;
  if (typeof body.nudgesOff === "boolean") patch.nudgesOff = body.nudgesOff;
  if (typeof body.archived === "boolean") patch.archived = body.archived;

  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  const application = await updateTrackedApplication(userId, params.id, patch);
  if (!application) return NextResponse.json({ error: "Could not save." }, { status: 400 });
  if (typeof body.archived === "boolean") await logEvent(userId, params.id, body.archived ? "archived" : "unarchived", {});
  else await logEvent(userId, params.id, "edited", { fields: Object.keys(patch) });
  return NextResponse.json({ application });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const ok = await deleteTrackedApplication(userId, params.id);
  if (!ok) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
