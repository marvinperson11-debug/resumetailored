import { NextResponse } from "next/server";
import { currentUser, clerkClient } from "@clerk/nextjs/server";
import { getAccess } from "@/lib/plan";

/**
 * Claims the free Employer Portal tier for the SIGNED-IN user — the
 * no-purchase-required half of the employer onboarding flow (the paid half is
 * /api/create-employer-checkout-session).
 *
 * Writes `publicMetadata` directly on the caller's OWN verified Clerk userId
 * (never looked up by email) — deliberately the opposite shape of the bug in
 * the old site's _syncPlanToClerk that mispatched an unrelated account: there
 * is no search step here to get wrong, because the actor and the target are
 * provably the same account (Clerk's own session, not client input).
 *
 * An account that already has a non-free role (an existing candidate Pro
 * subscriber, an invited team member, etc.) is not silently switched: the
 * first call without `confirm: true` returns 409 with the current plan so the
 * client can show a "you'll lose X access" prompt, and only a second call
 * with `confirm: true` performs the switch. An account already on the
 * employer plan is left untouched (idempotent) — this never downgrades an
 * existing paid tier back to free.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const access = await getAccess();
  if (access.isAdmin) {
    return NextResponse.json({ error: "admin_cannot_claim" }, { status: 400 });
  }
  if (access.plan === "employer") {
    // Already an employer at whatever tier they have — never touch it here.
    return NextResponse.json({ ok: true, alreadyEmployer: true });
  }

  const body = await req.json().catch(() => ({} as { confirm?: boolean }));
  const isSwitch = access.plan === "pro" || access.plan === "employee";
  if (isSwitch && body.confirm !== true) {
    return NextResponse.json(
      { error: "confirm_required", currentPlan: access.plan },
      { status: 409 }
    );
  }

  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(user.id, {
      publicMetadata: {
        plan: "employer",
        type: "organization",
        tier: "free",
        subscribedAt: new Date().toISOString(),
      },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "claim_failed" }, { status: 502 });
  }
}
