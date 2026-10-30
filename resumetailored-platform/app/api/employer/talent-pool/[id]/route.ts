import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canBrowseTalentPool } from "@/lib/employer-plan";
import { resolveUserIdentity } from "@/lib/email";
import { getDiscoverableProfileById, previewForCandidate } from "@/lib/talent-pool-store";

export const runtime = "nodejs";

/** GET one Talent Pool profile's detail view — same visibility rules as a
 *  search card (Q2/Q3): only fields the candidate made visible, never
 *  contact info. Portal and above, same gate as the search route — an
 *  employer can't bypass the tier check by guessing a profile id directly. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canBrowseTalentPool(ctx.access)) return NextResponse.json({ error: "Talent Pool is available on the Portal plan and above.", code: "tier_locked" }, { status: 402 });

  const profile = await getDiscoverableProfileById(params.id);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });
  const identity = await resolveUserIdentity(profile.candidateId);
  const result = previewForCandidate(profile, identity);
  return NextResponse.json({ id: profile.id, profile: result });
}
