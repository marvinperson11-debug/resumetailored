"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, KeyRound } from "lucide-react";

/**
 * Code-entry step of invite acceptance. The token + email are already validated
 * server-side; this collects the 6-digit code and posts it to
 * /api/employee/accept, which binds the account on a correct code.
 */
export function AcceptForm({ token, email, company }: { token: string; email: string; company: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/employee/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && d.ok) {
        router.push("/employee");
        router.refresh();
      } else {
        setErr(d.error || "That code didn't work. Check the code in your invite email and try again.");
        setBusy(false);
      }
    } catch {
      setErr("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 py-12">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border-gold bg-white/5 p-8 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet/15 text-violet">
          <KeyRound className="h-6 w-6" />
        </span>
        <h1 className="font-serif text-2xl font-medium text-cream">Join {company}</h1>
        <p className="mt-2 text-sm text-white/70">
          Signed in as <span className="text-cream">{email}</span>. Enter the 6-digit invite code from your email to finish.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label="Invite code"
          className="mt-6 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-center text-2xl font-semibold tracking-[0.4em] text-cream placeholder:text-white/25 focus:border-violet focus:outline-none"
        />
        {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet/90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Enter portal
        </button>
        <p className="mt-4 text-xs text-white/40">Didn&rsquo;t get a code? Ask your employer to resend your invite.</p>
      </form>
    </main>
  );
}
