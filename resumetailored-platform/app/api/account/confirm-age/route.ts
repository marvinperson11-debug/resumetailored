import { NextResponse } from "next/server";
import { currentUser, clerkClient } from "@clerk/nextjs/server";

/**
 * Records a signed-in user's one-time self-attestation that they are at
 * least 13 years old (app/confirm-age/page.tsx shows that step right after
 * sign-up, before any other page is reachable). Writes publicMetadata on the
 * caller's OWN verified Clerk userId, never looked up by email, same safety
 * shape as app/api/employer/claim-free/route.ts.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(user.id, {
      publicMetadata: {
        ageConfirmed: true,
        ageConfirmedAt: new Date().toISOString(),
      },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
