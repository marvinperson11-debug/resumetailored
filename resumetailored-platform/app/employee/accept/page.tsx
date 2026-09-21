import { clerkClient } from "@clerk/nextjs/server";
import { getEmployeeByInviteToken } from "@/lib/employees-store";
import { getEmployerProfile } from "@/lib/employer-store";
import { AcceptClient } from "./accept-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Employee portal invite acceptance — a SELF-CONTAINED, branded flow. The emailed
 * link is /employee/accept?token=<uuid> and carries a 6-digit code.
 *
 * This page never redirects to the hosted Clerk sign-in/up pages. It resolves the
 * invited email + company from the token and whether an account already exists,
 * then renders the branded form. All auth (create account with password, or sign
 * in with password, then bind the employee) happens in-place via Clerk's client
 * hooks + the /api/employee/accept[/create] endpoints, so the journey from the
 * email link to inside the portal is one uninterrupted branded experience.
 */
export default async function AcceptEmployeeInvitePage({ searchParams }: { searchParams: { token?: string } }) {
  const token = (searchParams?.token || "").trim();
  if (!token) return <Message title="Invalid invite" body="This invite link is missing its token. Ask your employer to resend it." />;

  const invite = await getEmployeeByInviteToken(token);
  if (!invite || !invite.employerId || !invite.email) {
    return <Message title="Invite not found" body="This invite may have already been used or withdrawn. Ask your employer to send a new one." />;
  }

  const profile = await getEmployerProfile(invite.employerId);
  const company = profile?.companyName || "your team";

  // Does an account already exist for this email? Picks the sign-in vs. create
  // form. On lookup failure default to the create path — the create endpoint
  // re-checks and returns accountExists so the client can still switch.
  let accountExists = false;
  try {
    const client = await clerkClient();
    const list = await client.users.getUserList({ emailAddress: [invite.email] });
    accountExists = list.data.length > 0;
  } catch {
    accountExists = false;
  }

  return <AcceptClient token={token} email={invite.email} company={company} accountExists={accountExists} />;
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
