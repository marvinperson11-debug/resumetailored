"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Check, Loader2, KeyRound, Bell } from "lucide-react";

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

/**
 * Employee Settings — Notifications + Account (change password) only. No billing,
 * appearance, privacy, connected accounts, or account deletion (this is the
 * employer's managed staff account).
 */
export function EmployeeSettingsClient({ initial }: { initial: { emailProduct: boolean; emailTips: boolean } }) {
  const { user } = useUser();

  const [emailProduct, setEmailProduct] = useState(initial.emailProduct);
  const [emailTips, setEmailTips] = useState(initial.emailTips);
  const [prefSaved, setPrefSaved] = useState(false);

  async function savePrefs(patch: { emailProduct?: boolean; emailTips?: boolean }) {
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
        <p className="mt-1 text-sm text-white/60">Manage your notifications and password.</p>
      </div>

      {/* Notifications */}
      <div className={card}>
        <h2 className={h2}>
          <Bell className="h-4 w-4 text-violet" /> Notifications
        </h2>
        <p className={sub}>Choose which emails you receive.</p>
        <div className="divide-y divide-border-gold/60">
          <Toggle
            label="Product updates"
            hint="New features and important changes."
            on={emailProduct}
            onChange={(v) => {
              setEmailProduct(v);
              savePrefs({ emailProduct: v });
            }}
          />
          <Toggle
            label="Tips & career advice"
            hint="Occasional resume and career tips."
            on={emailTips}
            onChange={(v) => {
              setEmailTips(v);
              savePrefs({ emailTips: v });
            }}
          />
        </div>
        {prefSaved && (
          <p className="mt-3 flex items-center gap-1 text-xs text-teal">
            <Check className="h-3.5 w-3.5" /> Preferences saved
          </p>
        )}
      </div>

      {/* Account — change password only */}
      <AccountSection hasUser={!!user} />
    </div>
  );
}

function AccountSection({ hasUser }: { hasUser: boolean }) {
  const { user } = useUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

  return (
    <div className={card}>
      <h2 className={h2}>
        <KeyRound className="h-4 w-4 text-violet" /> Account
      </h2>
      <p className={sub}>Change your password.</p>

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className={inputCls} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" autoComplete="current-password" />
          <input className={inputCls} type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8 chars)" autoComplete="new-password" />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={changePassword}
            disabled={pwBusy || !hasUser}
            className="inline-flex items-center gap-2 rounded-lg border border-border-gold px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-white/8 disabled:opacity-50"
          >
            {pwBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update password
          </button>
          {pwMsg && <span className={`text-xs ${pwMsg.ok ? "text-teal" : "text-red-300"}`}>{pwMsg.text}</span>}
        </div>
      </div>
    </div>
  );
}
