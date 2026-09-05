import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-6 py-24">
      <SignUp />
    </main>
  );
}
