import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getEmployeeByInviteToken } from "@/lib/employees-store";
import { getEmployerProfile } from "@/lib/employer-store";
import { AcceptForm } from "./accept-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Employee portal invite acceptance. The emailed link is
 * /employee/accept?token=<uuid> and carries a 6-digit code shown in the email.
 *   - Signed out → bounce through sign-in, returning here afterwards.
 *   - Signed in  → validate the token + that the signed-in email matches the
 *     invited address, then render the code-entry form. Binding happens in
 *     POST /api/employee/accept, which re-verifies token + email + code.
 * Invalid/expired tokens and wrong accounts render a friendly message.
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
    return <Message title="Invite not found" body="This invite may have already been used or withdrawn. Ask your employer to send a new one." />;
  }

  // The signed-in email must match the invited address (rows added without an
  // email fall back to first-come binding).
  const user = await currentUser();
  const email = (user?.emailAddresses?.[0]?.emailAddress || "").toLowerCase();
  if (invite.email && email && invite.email.toLowerCase() !== email) {
    return <Message title="Wrong account" body={`This invite was sent to ${invite.email}. Sign in with that email to accept it.`} />;
  }

  const profile = await getEmployerProfile(invite.employerId);
  const company = profile?.companyName || "your team";
  return <AcceptForm token={token} email={invite.email || email} company={company} />;
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
