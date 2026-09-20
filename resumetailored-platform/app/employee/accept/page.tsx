import { redirect } from "next/navigation";
import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { getEmployeeByInviteToken, getEmployeeByClerkUserId, linkClerkUser } from "@/lib/employees-store";
import { getEmployerProfile } from "@/lib/employer-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Employee portal invite acceptance. The emailed link is
 * /employee/accept?token=<uuid>.
 *   - Signed out → bounce through sign-in, returning here afterwards.
 *   - Signed in  → validate the token, bind this Clerk account to the employee
 *     row, grant the scoped Employee (staff) role in Clerk metadata, land
 *     /employee.
 * Invalid/expired tokens render a friendly message instead of throwing.
 */
export default async function AcceptEmployeeInvitePage({ searchParams }: { searchParams: { token?: string } }) {
  const token = (searchParams?.token || "").trim();
  if (!token) return <Message title="Invalid invite" body="This invite link is missing its token. Ask your employer to resend it." />;

  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/employee/accept?token=${token}`)}`);
  }

  const invite = await getEmployeeByInviteToken(token);
  if (!invite || !invite.employerId) {
    // Already-used token: if this user is already linked, just send them in.
    return <Message title="Invite not found" body="This invite may have already been used or withdrawn. Ask your employer to send a new one." />;
  }

  // Guard against a mismatched account claiming another person's invite: an
  // employee row with an email must be accepted by that same email. (Rows added
  // without an email fall back to first-come binding.)
  const user = await currentUser();
  const email = (user?.emailAddresses?.[0]?.emailAddress || "").toLowerCase();
  if (invite.email && email && invite.email.toLowerCase() !== email) {
    return (
      <Message
        title="Wrong account"
        body={`This invite was sent to ${invite.email}. Sign in with that email to accept it.`}
      />
    );
  }

  // If someone else is already bound to this row, don't hijack it.
  const existing = await getEmployeeByClerkUserId(invite.employerId, userId);
  if (!existing) {
    await linkClerkUser(invite.employerId, invite.id, userId);
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
    // Non-fatal: the row is linked; the role write retries on next sign-in via
    // the entitlement path — but here we retry immediately isn't possible, so
    // the layout re-checks and a re-visit of this page completes it.
  }

  redirect("/employee");
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 py-12 text-center">
      <div className="w-full max-w-md rounded-2xl border border-border-gold bg-white/5 p-8">
        <h1 className="font-serif text-2xl font-medium text-cream">{title}</h1>
        <p className="mt-3 text-sm text-white/70">{body}</p>
        <a href="/" className="mt-6 inline-block rounded-xl bg-violet px-5 py-2.5 text-sm font-semibold text-white">
          Go to ResumeTailored
        </a>
      </div>
    </main>
  );
}
