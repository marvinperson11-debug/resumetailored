import { SignIn } from "@clerk/nextjs";

// Clean, single-purpose sign-in: just the Clerk component centered on the
// charcoal + living-gradient background. No marketing copy, no extra buttons.
export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <SignIn fallbackRedirectUrl="/candidate" />
    </main>
  );
}
