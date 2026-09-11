"use client";

import { useEffect, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { Crown, Check, Loader2, KeyRound, Trash2, Bell, Eye, Sparkles, Link2 } from "lucide-react";
import type { UserProfile } from "@/lib/profile-store";

const card = "rounded-2xl border border-border-gold bg-white/[0.03] p-6";
const h2 = "mb-1 flex items-center gap-2 text-sm font-semibold text-cream";
const sub = "mb-4 text-xs text-white/50";
const inputCls =
  "w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet";

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-cream">{label}</div>
        {hint && <div className="text-xs text-white/45">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-violet" : "bg-white/15"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export function SettingsClient({ initial, planLabel, isProPlan }: { initial: UserProfile; planLabel: string; isProPlan: boolean }) {
  const { user } = useUser();
  const { signOut } = useClerk();

  // Notifications + privacy (persisted to Supabase).
  const [emailProduct, setEmailProduct] = useState(initial.emailProduct);
  const [emailTips, setEmailTips] = useState(initial.emailTips);
  const [profilePublic, setProfilePublic] = useState(initial.profilePublic);
  const [prefSaved, setPrefSaved] = useState(false);

  // Appearance (per-device, localStorage).
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem("rt_reduce_motion") === "1";
      setReduceMotion(v);
      document.documentElement.classList.toggle("rt-reduce-motion", v);
    } catch {
      /* ignore */
    }
  }, []);
  function setMotion(v: boolean) {
    setReduceMotion(v);
    try {
      localStorage.setItem("rt_reduce_motion", v ? "1" : "0");
      document.documentElement.classList.toggle("rt-reduce-motion", v);
    } catch {
      /* ignore */
    }
  }

  async function savePrefs(patch: Partial<UserProfile>) {
    setPrefSaved(false);
    try {
      await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      setPrefSaved(true);
      setTimeout(() => setPrefSaved(false), 2000);
    } catch {
      /* best-effort */
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-medium text-cream">Settings</h1>
        <p className="mt-1 text-sm text-white/60">Manage your account, plan, and preferences.</p>
      </div>

      {/* Plan & billing */}
      <div className={card}>
        <h2 className={h2}><Crown className="h-4 w-4 text-gold" /> Plan &amp; billing</h2>
        <p className={sub}>Your current plan and upgrade options.</p>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-gold bg-white/[0.03] p-4">
          <div>
            <div className="text-sm font-semibold text-cream">{planLabel}</div>
            <div className="text-xs text-white/45">{isProPlan ? "Watermark-free exports, all templates, video & website." : "Unlimited tailoring + cover letters, with a small export watermark."}</div>
          </div>
          {!isProPlan && (
            <a href="/candidate?upgrade=pro" className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet/90">
              <Sparkles className="h-4 w-4" /> Upgrade to Pro
            </a>
          )}
        </div>
        <p className="mt-3 text-xs text-white/40">Billing history and receipts are managed through our payment provider (Stripe). Contact support to retrieve past invoices.</p>
      </div>

      {/* Notifications */}
      <div className={card}>
        <h2 className={h2}><Bell className="h-4 w-4 text-violet" /> Notifications</h2>
        <p className={sub}>Choose which emails you receive.</p>
        <div className="divide-y divide-border-gold/60">
          <Toggle label="Product updates" hint="New features and important changes." on={emailProduct} onChange={(v) => { setEmailProduct(v); savePrefs({ emailProduct: v }); }} />
          <Toggle label="Tips & career advice" hint="Occasional resume and job-search tips." on={emailTips} onChange={(v) => { setEmailTips(v); savePrefs({ emailTips: v }); }} />
        </div>
      </div>

      {/* Appearance */}
      <div className={card}>
        <h2 className={h2}><Eye className="h-4 w-4 text-violet" /> Appearance</h2>
        <p className={sub}>ResumeTailored uses a dark theme throughout the app.</p>
        <div className="divide-y divide-border-gold/60">
          <Toggle label="Reduce motion" hint="Turns off the animated background and transitions." on={reduceMotion} onChange={setMotion} />
        </div>
      </div>

      {/* Privacy */}
      <div className={card}>
        <h2 className={h2}><Eye className="h-4 w-4 text-violet" /> Privacy</h2>
        <p className={sub}>Control whether your profile can be shown publicly.</p>
        <div className="divide-y divide-border-gold/60">
          <Toggle
            label="Make my profile public"
            hint="Allows a public profile page to be shown. Off by default."
            on={profilePublic}
            onChange={(v) => { setProfilePublic(v); savePrefs({ profilePublic: v }); }}
          />
        </div>
      </div>

      {/* Connected accounts */}
      <ConnectedAccounts />

      {/* Account (password + danger zone) */}
      <AccountSection onSignOut={() => signOut({ redirectUrl: "/" })} hasUser={!!user} />

      {prefSaved && (
        <p className="flex items-center gap-1 text-xs text-teal">
          <Check className="h-3.5 w-3.5" /> Preferences saved
        </p>
      )}
    </div>
  );
}

function ConnectedAccounts() {
  const { user, isLoaded } = useUser();
  const [busy, setBusy] = useState<string | null>(null);
  if (!isLoaded) return null;
  const accounts = user?.externalAccounts || [];

  const pretty = (p: string) => p.replace(/^oauth_/, "").replace(/^\w/, (c) => c.toUpperCase());

  async function disconnect(id: string) {
    const acc = user?.externalAccounts.find((a) => a.id === id);
    if (!acc) return;
    if (!confirm("Disconnect this account?")) return;
    setBusy(id);
    try {
      await acc.destroy();
      await user?.reload();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={card}>
      <h2 className={h2}><Link2 className="h-4 w-4 text-violet" /> Connected accounts</h2>
      <p className={sub}>Sign-in methods linked to your account.</p>
      {accounts.length === 0 ? (
        <p className="text-sm text-white/45">No social accounts connected. You sign in with email &amp; password.</p>
      ) : (
        <div className="divide-y divide-border-gold/60">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-4 py-2.5">
              <div>
                <div className="text-sm text-cream">{pretty(a.provider)}</div>
                <div className="text-xs text-white/45">{a.emailAddress || "Connected"}</div>
              </div>
              <button
                type="button"
                onClick={() => disconnect(a.id)}
                disabled={busy === a.id}
                className="rounded-lg border border-border-gold px-3 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-white/8 disabled:opacity-50"
              >
                {busy === a.id ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountSection({ onSignOut, hasUser }: { onSignOut: () => void; hasUser: boolean }) {
  const { user } = useUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delText, setDelText] = useState("");

  async function changePassword() {
    if (next.length < 8) {
      setPwMsg({ ok: false, text: "New password must be at least 8 characters." });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    try {
      await user?.updatePassword({ currentPassword: current || undefined, newPassword: next });
      setPwMsg({ ok: true, text: "Password updated." });
      setCurrent("");
      setNext("");
    } catch (e) {
      const msg = (e as { errors?: { message?: string }[] })?.errors?.[0]?.message || "Could not update password.";
      setPwMsg({ ok: false, text: msg });
    } finally {
      setPwBusy(false);
    }
  }

  async function deleteAccount() {
    if (delText !== "DELETE") return;
    setDelBusy(true);
    try {
      await user?.delete();
      onSignOut();
    } catch {
      setDelBusy(false);
      alert("Could not delete the account. Please contact support.");
    }
  }

  return (
    <div className={card}>
      <h2 className={h2}><KeyRound className="h-4 w-4 text-violet" /> Account</h2>
      <p className={sub}>Change your password or delete your account.</p>

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className={inputCls} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" autoComplete="current-password" />
          <input className={inputCls} type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8 chars)" autoComplete="new-password" />
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={changePassword} disabled={pwBusy || !hasUser} className="inline-flex items-center gap-2 rounded-lg border border-border-gold px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-white/8 disabled:opacity-50">
            {pwBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update password
          </button>
          {pwMsg && <span className={`text-xs ${pwMsg.ok ? "text-teal" : "text-red-300"}`}>{pwMsg.text}</span>}
        </div>
      </div>

      {/* Danger zone */}
      <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4">
        <div className="mb-1 text-sm font-semibold text-red-200">Danger zone</div>
        <p className="mb-3 text-xs text-white/55">Deleting your account is permanent and removes your resumes, drafts, and settings.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input className={inputCls + " sm:max-w-[220px]"} value={delText} onChange={(e) => setDelText(e.target.value)} placeholder='Type "DELETE" to confirm' />
          <button
            type="button"
            onClick={deleteAccount}
            disabled={delText !== "DELETE" || delBusy}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {delBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete account
          </button>
        </div>
      </div>
    </div>
  );
}
