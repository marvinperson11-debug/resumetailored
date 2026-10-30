import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getEmployerProfile } from "@/lib/employer-store";
import { listIncomingContactRequests } from "@/lib/talent-pool-store";

export const runtime = "nodejs";

/** GET — the signed-in candidate's incoming contact requests, newest first,
 *  each carrying the requesting employer's company name so the candidate
 *  knows who's asking before they accept/decline. This list IS the
 *  candidate's "in-app" surface for this feature (see
 *  lib/talent-pool-notify.ts's header comment) — always live, no separate
 *  read/unread state to maintain. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const requests = await listIncomingContactRequests(userId);
  const companies = new Map<string, string>();
  for (const r of requests) {
    if (companies.has(r.employerId)) continue;
    const profile = await getEmployerProfile(r.employerId);
    companies.set(r.employerId, profile?.companyName || "An employer");
  }
  return NextResponse.json({ requests: requests.map((r) => ({ ...r, employerCompany: companies.get(r.employerId) || "An employer" })) });
}
