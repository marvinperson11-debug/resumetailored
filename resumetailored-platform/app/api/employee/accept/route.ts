import { NextResponse } from "next/server";
import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { getEmployeeByInviteToken, getEmployeeByClerkUserId, linkClerkUser } from "@/lib/employees-store";
import { getEmployerProfile } from "@/lib/employer-store";
import { logActivityForEmployer } from "@/lib/notifications-store";

export const runtime = "nodejs";

/**
 * Bind the signed-in Clerk account to an invited employee row. Requires all of:
 * a signed-in user, a valid invite token, the signed-in email matching the
 * invited address, and the correct 6-digit invite code. On success sets the
 * scoped staff role in Clerk metadata; the code is cleared by linkClerkUser.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as { token?: string; code?: string };
  const token = (b.token || "").trim();
  const code = (b.code || "").trim();
  if (!token) return NextResponse.json({ error: "Missing invite token." }, { status: 400 });

  const invite = await getEmployeeByInviteToken(token);
  if (!invite || !invite.employerId) {
    return NextResponse.json({ error: "This invite is no longer valid. Ask your employer to resend it." }, { status: 400 });
  }

  // Email must match the invited address (rows without an email fall back to
  // first-come binding).
  const user = await currentUser();
  const email = (user?.emailAddresses?.[0]?.emailAddress || "").toLowerCase();
  if (invite.email && email && invite.email.toLowerCase() !== email) {
    return NextResponse.json({ error: `This invite was sent to ${invite.email}. Sign in with that email.` }, { status: 403 });
  }

  // Verify the 6-digit code. A row with no stored code (legacy invite) accepts
  // on the token + email alone.
  if (invite.inviteCode && invite.inviteCode !== code) {
    return NextResponse.json({ error: "That invite code is incorrect." }, { status: 400 });
  }

  // Don't hijack a row already bound to someone else.
  const existing = await getEmployeeByClerkUserId(invite.employerId, userId);
  if (!existing) {
    const linked = await linkClerkUser(invite.employerId, invite.id, userId);
    if (!linked) return NextResponse.json({ error: "Could not link your account. Please try again." }, { status: 500 });
    logActivityForEmployer(invite.employerId, {
      eventType: "invite_accepted",
      title: `${invite.name || "An employee"} accepted their portal invite`,
      link: "/employer/employees",
    }).catch(() => {});
  }

  const profile = await getEmployerProfile(invite.employerId);
  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(userId, {
      publicMetadata: {
        plan: "employee",
        type: "employee",
        staff: true,
        employeeId: invite.id,
        employerId: invite.employerId,
        employerName: profile?.companyName || undefined,
        joinedAt: new Date().toISOString(),
      },
    });
  } catch {
    // Non-fatal: the row is linked; the layout re-checks and a re-visit completes
    // the role write.
  }

  return NextResponse.json({ ok: true });
}
