import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getEmployeeByInviteToken, linkClerkUser } from "@/lib/employees-store";
import { getEmployerProfile } from "@/lib/employer-store";

export const runtime = "nodejs";

/**
 * Self-contained invite acceptance for an invitee who has NO account yet. Given
 * a valid token + 6-digit code + a chosen password, this creates the Clerk
 * account (email + password) with the scoped staff metadata already set, binds
 * the employee row (consuming the code), and returns a one-time **sign-in
 * ticket** the branded page uses to establish the session in-browser — so the
 * flow never touches the hosted Clerk sign-in/up pages.
 *
 * No auth is required (the invitee has no session yet); the token is the secret
 * and the code is the second factor. If an account already exists for the email,
 * this returns `accountExists: true` so the page switches to the sign-in path.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { token?: string; code?: string; password?: string };
  const token = (b.token || "").trim();
  const code = (b.code || "").trim();
  const password = b.password || "";
  if (!token) return NextResponse.json({ error: "Missing invite token." }, { status: 400 });

  const invite = await getEmployeeByInviteToken(token);
  if (!invite || !invite.employerId) {
    return NextResponse.json({ error: "This invite is no longer valid. Ask your employer to resend it." }, { status: 400 });
  }
  if (!invite.email) {
    return NextResponse.json({ error: "This invite has no email on file. Ask your employer to re-add you." }, { status: 400 });
  }
  // Second factor. A legacy invite with no stored code accepts on the token alone.
  if (invite.inviteCode && invite.inviteCode !== code) {
    return NextResponse.json({ error: "That invite code is incorrect." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Choose a password of at least 8 characters." }, { status: 400 });
  }

  const client = await clerkClient();

  // If an account already exists for this email, don't create a duplicate —
  // tell the page to use the sign-in path instead.
  try {
    const existing = await client.users.getUserList({ emailAddress: [invite.email] });
    if (existing.data.length > 0) {
      return NextResponse.json({ accountExists: true, error: "An account already exists for this email — sign in instead." }, { status: 409 });
    }
  } catch {
    // Lookup failure: fall through to create; a duplicate create will throw below
    // and be surfaced as an error.
  }

  const profile = await getEmployerProfile(invite.employerId);

  let userId: string;
  try {
    const created = await client.users.createUser({
      emailAddress: [invite.email],
      password,
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
    userId = created.id;
  } catch (e: unknown) {
    // Surface Clerk's own message (weak/pwned password, duplicate email, …).
    const msg =
      (e && typeof e === "object" && "errors" in e && Array.isArray((e as { errors?: { message?: string }[] }).errors)
        ? (e as { errors: { message?: string }[] }).errors[0]?.message
        : "") || "Could not create your account. Please try a different password.";
    // A duplicate-email race resolves to the sign-in path.
    const dup = /already|taken|exists/i.test(msg);
    return NextResponse.json({ error: msg, ...(dup ? { accountExists: true } : {}) }, { status: dup ? 409 : 400 });
  }

  // Bind the employee row to the new account and consume the invite (clears
  // token + code). This MUST succeed before we hand back a sign-in ticket — the
  // employee has to appear linked/accepted on the employer side, and their
  // portal access resolves via clerk_user_id, so a redirect on an unbound row
  // would strand them. Retry once, then fail loudly rather than sign them in.
  let bound = await linkClerkUser(invite.employerId, invite.id, userId);
  if (!bound) bound = await linkClerkUser(invite.employerId, invite.id, userId);
  if (!bound) {
    return NextResponse.json(
      { error: "Your account was created but could not be linked. Please contact your employer to resend the invite." },
      { status: 500 }
    );
  }

  // One-time ticket the page redeems client-side to open the session.
  try {
    const ticket = await client.signInTokens.createSignInToken({ userId, expiresInSeconds: 600 });
    return NextResponse.json({ ticket: ticket.token });
  } catch {
    return NextResponse.json({ error: "Your account was created, but sign-in could not start. Please sign in." }, { status: 500 });
  }
}
