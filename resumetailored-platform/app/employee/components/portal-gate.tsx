import { Mail, LogIn, KeyRound } from "lucide-react";

/**
 * Access gate for /employee. This door is for INVITED TEAM MEMBERS of companies
 * on ResumeTailored — not for employers — so it must never show the employer
 * upsell or a marketing redirect.
 *
 *   - "explain"      → the visitor isn't a linked staff employee: explain what
 *     this area is and how to get in (invite email → sign in with the invited
 *     email → enter the invite code).
 *   - "misconfigured"→ a signed-in staff account whose employee row can't be
 *     resolved: tell them to contact their employer.
 */
export function EmployeePortalGate({ mode }: { mode: "explain" | "misconfigured" }) {
  if (mode === "misconfigured") {
    return (
      <Shell title="We couldn't load your portal">
        <p className="mt-3 text-sm text-white/70">
          Your account is set up as a team member, but we couldn&rsquo;t find your employee record. This usually means your
          employer needs to re-send your invite or finish adding you.
        </p>
        <p className="mt-4 text-sm text-white/70">Please contact your employer to sort this out.</p>
        <a href="/" className="mt-6 inline-block rounded-xl bg-violet px-5 py-2.5 text-sm font-semibold text-white">
          Back to ResumeTailored
        </a>
      </Shell>
    );
  }

  return (
    <Shell title="Employee portal">
      <p className="mt-3 text-sm text-white/70">
        This area is for <strong className="text-cream">invited team members</strong> of companies that use ResumeTailored.
        If your employer invited you, here&rsquo;s how to get in:
      </p>
      <ol className="mt-6 space-y-4 text-left">
        <Step icon={Mail} n={1} title="Open your invite email">
          Your employer sent you an invite with a link and a 6-digit code.
        </Step>
        <Step icon={LogIn} n={2} title="Sign in with your invited email">
          Use the same email address your employer invited — that&rsquo;s how your account is matched.
        </Step>
        <Step icon={KeyRound} n={3} title="Enter your invite code">
          Type the 6-digit code from the email to finish setting up your portal.
        </Step>
      </ol>
      <p className="mt-6 text-xs text-white/45">
        Haven&rsquo;t received an invite? Ask your employer to send you one. This portal isn&rsquo;t something you sign up for on
        your own.
      </p>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border-gold bg-white/5 p-8 text-center">
        <h1 className="font-serif text-2xl font-medium text-cream">{title}</h1>
        {children}
      </div>
    </main>
  );
}

function Step({ icon: Icon, n, title, children }: { icon: typeof Mail; n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet/15 text-violet">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <div className="text-sm font-semibold text-cream">
          {n}. {title}
        </div>
        <div className="mt-0.5 text-sm text-white/60">{children}</div>
      </div>
    </li>
  );
}
