"use client";

import { useState } from "react";
import { Contact, Copy, Check } from "lucide-react";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, TextInput, PrimaryButton, UpgradeNote } from "../components/ui";

export function LinkedInOptimizerTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const [profileText, setProfileText] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    if (!profileText.trim() || !targetRole.trim()) {
      setError("Paste your headline + About section and the role you're targeting.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/linkedin-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileText, targetRole }),
      });
      const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string; message?: string };
      if (!res.ok || !data.result) throw new Error(data.message || data.error || "Optimization failed.");
      setResult(data.result.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    navigator.clipboard?.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">Optimizes for LinkedIn search + recruiters</span>
      <PrimaryButton onClick={run} loading={loading}>
        <Contact className="h-4 w-4" /> {result ? "Re-optimize" : "Optimize"}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="LinkedIn Optimizer" icon={Contact} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          <div>
            <Label>Your LinkedIn headline + About</Label>
            <TextArea rows={10} value={profileText} onChange={(e) => setProfileText(e.target.value)} placeholder="Paste your current headline and About/summary (and experience bullets if you have them)…" />
          </div>
          <div>
            <Label>Target role</Label>
            <TextInput value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g. Senior Product Manager" />
          </div>
          {!isPro && <UpgradeNote>Pro adds skill suggestions + keyword-density analysis.</UpgradeNote>}
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>

        <div className="min-h-0 overflow-y-auto bg-navy/40 p-5">
          {result ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-2.5 py-1.5 text-xs text-cream hover:bg-white/8">
                  {copied ? <Check className="h-3.5 w-3.5 text-teal" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy all"}
                </button>
              </div>
              <div className="space-y-1 rounded-xl border border-border-gold bg-white/5 p-4 text-sm leading-relaxed text-cream">
                {result.split("\n").map((line, i) => {
                  const isHeader = /^[A-Z][A-Z\s&/()-]{4,}$/.test(line.trim());
                  const isBullet = /^[•\-*]\s/.test(line.trim());
                  if (!line.trim()) return <div key={i} className="h-2" />;
                  if (isHeader) return <div key={i} className="pt-2 text-xs font-bold uppercase tracking-wide text-violet">{line.trim()}</div>;
                  if (isBullet) return <div key={i} className="pl-3 text-white/80">• {line.trim().replace(/^[•\-*]\s*/, "")}</div>;
                  return <div key={i} className="text-white/85">{line.replace(/\*\*/g, "")}</div>;
                })}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">
              Your optimized headline, About section, and experience bullets will appear here.
            </div>
          )}
        </div>
      </div>
    </ToolModal>
  );
}
