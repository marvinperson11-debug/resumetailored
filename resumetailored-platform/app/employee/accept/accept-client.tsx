"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSignIn, useUser, useClerk } from "@clerk/nextjs";
import { Loader2, Building2 } from "lucide-react";

interface Props {
  token: string;
  email: string;
  company: string;
  accountExists: boolean;
}

/**
 * Branded, self-contained invite acceptance. Never navigates to the hosted Clerk
 * sign-in/up pages. Three paths, all landing inside /employee:
 *   - already signed in AS the invitee → enter code only → bind.
 *   - no account yet → code + password (+ confirm) → create account server-side,
 *     redeem a sign-in ticket in-browser.
 *   - account exists → code + password → Clerk password sign-in (custom flow) →
 *     bind.
 * Signed in as someone else → a "switch account" step (sign out, stay on page).
 */
export function AcceptClient({ token, email, company, accountExists: accountExistsInitial }: Props) {
  const router = useRouter();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { isLoaded: userLoaded, user } = useUser();
  const clerk = useClerk();

  const [accountExists, setAccountExists] = useState(accountExistsInitial);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Is the current session already the invitee? Then only the code is needed.
  const alreadyInvitee = useMemo(
    () => !!user?.emailAddresses?.some((e) => e.emailAddress.toLowerCase() === email.toLowerCase()),
    [user, email]
  );
  // Signed in as a DIFFERENT person — must switch accounts first.
  const signedInAsOther = !!user && !alreadyInvitee;

  async function activateTicket(ticket: string) {
    if (!signIn) throw new Error("not-ready");
    const res = await signIn.create({ strategy: "ticket", ticket });
    await setActive({ session: res.createdSessionId });
  }

  function clerkErr(e: unknown, fallback: string): string {
    const errs = (e as { errors?: { message?: string; longMessage?: string }[] })?.errors;
    return (Array.isArray(errs) && (errs[0]?.longMessage || errs[0]?.message)) || fallback;
  }

  async function bind(): Promise<boolean> {
    const r = await fetch("/api/employee/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, code: code.trim() }),
    });
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!r.ok || !d.ok) {
      setErr(d.error || "That invite code is incorrect.");
      return false;
    }
    return true;
  }

  function done() {
    // Hard navigation (not router.push): forces a fresh server round-trip so the
    // /employee layout renders with the now-staff session, and leaves no chance
    // for a lingering client-side auth/task SPA state to strand the new hire on a
    // Clerk "setup" screen. The account is already bound + staff-tagged server-side.
    if (typeof window !== "undefined") window.location.assign("/employee");
    else router.push("/employee");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !isLoaded) return;
    setErr("");

    // Path 1: already the invitee → just bind the code.
    if (alreadyInvitee) {
      setBusy(true);
      const ok = await bind();
      if (ok) return done();
      setBusy(false);
      return;
    }

    // Path 2: existing account → password sign-in (custom flow) then bind.
    if (accountExists) {
      if (!password) return setErr("Enter your password.");
      setBusy(true);
      try {
        const res = await signIn!.create({ identifier: email, password });
        if (res.status !== "complete") {
          setErr("Extra verification is required for this account. Please contact your employer.");
          setBusy(false);
          return;
        }
        await setActive({ session: res.createdSessionId });
        const ok = await bind();
        if (ok) return done();
        // Wrong code: session is live now; a retry re-binds with the corrected code.
        setBusy(false);
      } catch (e) {
        setErr(clerkErr(e, "Incorrect password. Please try again."));
        setBusy(false);
      }
      return;
    }

    // Path 3: no account → create with a password, then redeem the ticket.
    if (password.length < 8) return setErr("Choose a password of at least 8 characters.");
    if (password !== confirm) return setErr("Those passwords don't match.");
    setBusy(true);
    try {
      const r = await fetch("/api/employee/accept/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim(), password }),
      });
      const d = (await r.json().catch(() => ({}))) as { ticket?: string; error?: string; accountExists?: boolean };
      if (d.accountExists) {
        // An account exists after all — switch to the sign-in path (keep the code).
        setAccountExists(true);
        setConfirm("");
        setErr("You already have an account — enter your password to continue.");
        setBusy(false);
        return;
      }
      if (!r.ok || !d.ticket) {
        setErr(d.error || "Could not create your account. Please try again.");
        setBusy(false);
        return;
      }
      await activateTicket(d.ticket);
      return done();
    } catch (e) {
      setErr(clerkErr(e, "Something went wrong. Please try again."));
      setBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!isLoaded || !userLoaded) return <Shell company={company}><Spinner /></Shell>;

  if (signedInAsOther) {
    return (
      <Shell company={company}>
        <p className="mt-4 text-sm text-white/70">
          You&rsquo;re signed in as <span className="text-cream">{user?.primaryEmailAddress?.emailAddress}</span>. This
          invitation is for <span className="text-cream">{email}</span>.
        </p>
        <button
          onClick={() => clerk.signOut({ redirectUrl: typeof window !== "undefined" ? window.location.href : undefined })}
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-violet px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet/90"
        >
          Sign out &amp; continue
        </button>
      </Shell>
    );
  }

  const showConfirm = !accountExists && !alreadyInvitee;
  const showPassword = !alreadyInvitee;

  return (
    <Shell company={company}>
      <p className="mt-3 text-sm text-white/70">
        Signed in as <span className="text-cream">{email}</span>.{" "}
        {alreadyInvitee
          ? "Enter your invite code to finish."
          : accountExists
            ? "Enter your invite code and password to continue."
            : "Set a password and enter your invite code to create your portal."}
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-3 text-left">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50">Invite code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label="Invite code"
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-center text-xl font-semibold tracking-[0.35em] text-cream placeholder:text-white/25 focus:border-violet focus:outline-none"
          />
        </label>

        {showPassword && (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50">
              {accountExists ? "Password" : "Create a password"}
            </span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={accountExists ? "current-password" : "new-password"}
              placeholder={accountExists ? "Your password" : "At least 8 characters"}
              aria-label="Password"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-cream placeholder:text-white/25 focus:border-violet focus:outline-none"
            />
          </label>
        )}

        {showConfirm && (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50">Confirm password</span>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              aria-label="Confirm password"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-cream placeholder:text-white/25 focus:border-violet focus:outline-none"
            />
          </label>
        )}

        {err && <p className="text-sm text-red-300">{err}</p>}

        <button
          type="submit"
          disabled={busy || code.length !== 6 || (showPassword && !password)}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet/90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {alreadyInvitee ? "Enter portal" : accountExists ? "Sign in & join" : "Create account & join"}
        </button>
      </form>
      <p className="mt-4 text-xs text-white/40">Didn&rsquo;t get a code? Ask your employer to resend your invite.</p>
    </Shell>
  );
}

function Shell({ company, children }: { company: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border-gold bg-white/5 p-8 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet/15 text-violet">
          <Building2 className="h-6 w-6" />
        </span>
        <h1 className="font-serif text-2xl font-medium text-cream">
          You&rsquo;ve been invited to {company}&rsquo;s team portal
        </h1>
        {children}
      </div>
    </main>
  );
}

function Spinner() {
  return (
    <div className="mt-6 flex items-center justify-center gap-2 text-sm text-white/60">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );
}
