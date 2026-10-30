import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canContactTalentPool } from "@/lib/employer-plan";
import { resolveUserEmail, resolveUserIdentity } from "@/lib/email";
import { getUserProfile } from "@/lib/profile-store";
import { getDiscoverableProfileById, listSentContactRequests, createContactRequest } from "@/lib/talent-pool-store";
import { notifyCandidateOfNewRequest } from "@/lib/talent-pool-notify";

export const runtime = "nodejs";

/** GET — the employer's own sent contact requests, each carrying the
 *  candidate's name and — ONLY once `status === "accepted"` (Q3) — their
 *  contact details: the account email that is this platform's own contact
 *  channel (resolveUserEmail), plus a phone number if the candidate has one
 *  saved on their general profile. A pending/declined/withdrawn row never
 *  carries contact fields at all (undefined, not blank), so there is
 *  nothing for the client to accidentally render early. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canContactTalentPool(ctx.access)) return NextResponse.json({ error: "Contacting Talent Pool candidates is available on the Scale plan and above.", code: "tier_locked" }, { status: 402 });

  const requests = await listSentContactRequests(ctx.employerId);
  const out = [];
  for (const r of requests) {
    const identity = await resolveUserIdentity(r.candidateId);
    const base = { ...r, candidateName: identity.name || "Candidate" };
    if (r.status === "accepted") {
      const [email, generalProfile] = await Promise.all([resolveUserEmail(r.candidateId), getUserProfile(r.candidateId)]);
      out.push({ ...base, contact: { email: email || null, phone: generalProfile.phone || null } });
    } else {
      out.push(base);
    }
  }
  return NextResponse.json({ requests: out });
}

/** POST — send a new contact request. Scale and above (Q1); the 10-pending
 *  cap and decline-blocks-resend rule (Q1/Q3/Q7) are enforced inside
 *  createContactRequest, before any row is written. On success, the
 *  candidate is emailed (lib/talent-pool-notify.ts) — fire-and-forget, never
 *  blocks the response. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canContactTalentPool(ctx.access)) return NextResponse.json({ error: "Contacting Talent Pool candidates is available on the Scale plan and above.", code: "tier_locked" }, { status: 402 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const profileId = String(body.profileId || "").trim();
  const message = String(body.message || "");
  if (!profileId) return NextResponse.json({ error: "profileId is required." }, { status: 400 });

  const profile = await getDiscoverableProfileById(profileId);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await createContactRequest(ctx.employerId, profile, message);
  if (!result.ok || !result.request) return NextResponse.json({ error: result.reason || "Could not save." }, { status: 400 });

  await notifyCandidateOfNewRequest(profile.candidateId, ctx.employerId).catch(() => {});
  return NextResponse.json({ request: result.request });
}
