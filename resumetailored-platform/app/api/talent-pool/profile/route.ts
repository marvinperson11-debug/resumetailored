import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveUserIdentity } from "@/lib/email";
import { getTalentPoolProfile, upsertTalentPoolProfile, setTalentPoolDiscoverable, previewForCandidate, type UpsertTalentPoolProfileInput } from "@/lib/talent-pool-store";
import { defaultVisibility } from "@/lib/talent-pool-core";

export const runtime = "nodejs";

/** GET — the signed-in candidate's own Talent Pool profile (creating no row
 *  yet if they've never saved one), plus the "this is what employers see"
 *  preview built from the SAME projection an employer would get. Free on
 *  every tier (Q1: candidate opt-in is free on all tiers) — no plan check. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const profile = await getTalentPoolProfile(userId);
  const identity = await resolveUserIdentity(userId);
  const preview = profile ? previewForCandidate(profile, identity) : null;
  return NextResponse.json({
    profile: profile ?? { isDiscoverable: false, headline: "", skills: [], location: "", desiredRoles: [], yearsExperience: null, workAuthorization: "", bio: "", visibility: defaultVisibility() },
    preview,
    identity,
  });
}

/** PATCH — either the master opt-in/opt-out switch (`discoverable`, checked
 *  first, same priority pattern as `stage` in app/api/tracker/route.ts) or a
 *  plain field/visibility edit. One call never does both, so a toggle can
 *  never be silently paired with an unreviewed field change. */
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.discoverable === "boolean") {
    const profile = await setTalentPoolDiscoverable(userId, body.discoverable);
    if (!profile) return NextResponse.json({ error: "Could not save (is the Talent Pool set up?)." }, { status: 500 });
    return NextResponse.json({ profile });
  }

  const patch: UpsertTalentPoolProfileInput = {};
  if (typeof body.headline === "string") patch.headline = body.headline;
  if (body.skills !== undefined) patch.skills = body.skills;
  if (typeof body.location === "string") patch.location = body.location;
  if (body.desiredRoles !== undefined) patch.desiredRoles = body.desiredRoles;
  if (body.yearsExperience !== undefined) patch.yearsExperience = typeof body.yearsExperience === "number" ? body.yearsExperience : null;
  if (typeof body.workAuthorization === "string") patch.workAuthorization = body.workAuthorization;
  if (typeof body.bio === "string") patch.bio = body.bio;
  if (body.visibility !== undefined) patch.visibility = body.visibility;

  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  const profile = await upsertTalentPoolProfile(userId, patch);
  if (!profile) return NextResponse.json({ error: "Could not save." }, { status: 500 });
  return NextResponse.json({ profile });
}
