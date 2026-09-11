import { redirect } from "next/navigation";
import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { getInviteByToken, acceptInvite, getEmployerProfile } from "@/lib/employer-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team-invite acceptance. A recruiter's invite link is /join?token=<uuid>.
 *  - Signed out → bounce through sign-in, returning here afterwards.
 *  - Signed in  → validate the token, set the Employee role (with the employer
 *    they belong to) in Clerk metadata, activate their team row, land /employer.
 * Invalid/expired tokens render a friendly message instead of throwing.
 */
export default async function JoinPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = (searchParams?.token || "").trim();
  if (!token) return <JoinMessage title="Invalid invite" body="This invite link is missing its token. Ask your admin to resend it." />;

  const { userId } = await auth();
  if (!userId) {
    // Return to this exact link after authenticating.
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/join?token=${token}`)}`);
  }

  const invite = await getInviteByToken(token);
  if (!invite) {
    return <JoinMessage title="Invite not found" body="This invite may have already been used or withdrawn. Ask your admin to send a new one." />;
  }

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  const profile = await getEmployerProfile(invite.employerId);

  // Activate the team row and grant the Employee role scoped to this employer.
  await acceptInvite(token, userId, email);
  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(userId, {
      publicMetadata: {
        plan: "employee",
        type: "employee",
        employerId: invite.employerId,
        employerName: profile?.companyName || undefined,
        joinedAt: new Date().toISOString(),
      },
    });
  } catch {
    // Non-fatal: the team row is active; the role write retries on next sign-in.
  }

  redirect("/employer");
}

function JoinMessage({ title, body }: { title: string; body: string }) {
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
