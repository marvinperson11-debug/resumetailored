"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine, Check, X, Lightbulb, Crown } from "lucide-react";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, PrimaryButton } from "../components/ui";
import type { AtsResult } from "@/lib/ai";

const VERDICT_TONE: Record<string, string> = {
  "Strong Match": "text-teal",
  "Good Match": "text-teal",
  "Fair Match": "text-gold",
  "Weak Match": "text-red-400",
};

export function AtsScannerTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const router = useRouter();
  const [resumeText, setResumeText] = useState("");
  const [jobText, setJobText] = useState("");
  const [result, setResult] = useState<AtsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  async function scan() {
    if (!resumeText.trim() || !jobText.trim()) {
      setError("Paste both your resume and the job posting.");
      return;
    }
    setLoading(true);
    setError(null);
    setLimitReached(false);
    try {
      const res = await fetch("/api/ats-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: resumeText, jobPosting: jobText }),
      });
      const data = (await res.json().catch(() => ({}))) as AtsResult & { error?: string; message?: string };
      if (res.status === 402) {
        setLimitReached(true);
        return;
      }
      if (!res.ok || typeof data.score !== "number") {
        throw new Error(data.message || data.error || "Analysis failed. Please try again.");
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const footer = (
    <>
      {!isPro && <span className="mr-auto hidden text-xs text-white/45 sm:block">Free: 1 scan/day · Pro: unlimited</span>}
      <PrimaryButton onClick={scan} loading={loading}>
        <ScanLine className="h-4 w-4" /> {result ? "Scan Again" : "Scan Resume"}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="ATS Score Checker" icon={ScanLine} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        {/* Left: form */}
        <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          <div>
            <Label>Your resume</Label>
            <TextArea rows={10} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste your resume text…" />
          </div>
          <div>
            <Label>Job description</Label>
            <TextArea rows={10} value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder="Paste the job description…" />
          </div>
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>

        {/* Right: results */}
        <div className="min-h-0 overflow-y-auto bg-navy/40 p-5">
          {limitReached ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold/15">
                <Crown className="h-5 w-5 text-gold" />
              </div>
              <h3 className="font-serif text-xl font-medium text-cream">You&rsquo;ve used today&rsquo;s free scan</h3>
              <p className="mt-2 max-w-xs text-sm text-white/60">Upgrade to Pro for unlimited ATS scans, every template, and watermark-free exports.</p>
              <button
                type="button"
                onClick={() => router.push("/candidate?upgrade=pro")}
                className="mt-6 rounded-xl bg-violet px-5 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(139,92,246,0.35)] transition-all hover:-translate-y-0.5"
              >
                Upgrade to Pro — $19/mo →
              </button>
            </div>
          ) : result ? (
            <div className="space-y-6">
              <ScoreGauge score={result.score} verdict={result.verdict} />
              <KeywordList title="Matched keywords" tone="match" items={result.matched} />
              <KeywordList title="Missing keywords" tone="miss" items={result.missing} />
              {result.suggestions?.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-cream">
                    <Lightbulb className="h-3.5 w-3.5 text-gold" /> Suggestions
                  </h4>
                  <ul className="space-y-2">
                    {result.suggestions.map((s, i) => (
                      <li key={i} className="rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-white/80">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.fallback && (
                <p className="text-xs text-white/40">Offline estimate (AI unavailable) — keyword overlap only.</p>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">
              Your match score, keywords, and rewrite suggestions will appear here.
            </div>
          )}
        </div>
      </div>
    </ToolModal>
  );
}

function ScoreGauge({ score, verdict }: { score: number; verdict: string }) {
  const tone = VERDICT_TONE[verdict] || "text-cream";
  const deg = Math.max(0, Math.min(100, score)) * 3.6;
  const color = score >= 60 ? "#14B8A6" : score >= 40 ? "#F59E0B" : "#f87171";
  return (
    <div className="flex items-center gap-5">
      <div
        className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.1) 0deg)` }}
      >
        <div className="flex h-[76px] w-[76px] flex-col items-center justify-center rounded-full bg-navy">
          <span className="text-2xl font-bold text-white">{score}</span>
          <span className="text-[9px] uppercase tracking-wide text-white/50">/ 100</span>
        </div>
      </div>
      <div>
        <div className={`font-serif text-2xl font-medium ${tone}`}>{verdict}</div>
        <p className="mt-1 text-sm text-white/55">ATS keyword match against this job.</p>
      </div>
    </div>
  );
}

function KeywordList({ title, tone, items }: { title: string; tone: "match" | "miss"; items: string[] }) {
  if (!items?.length) return null;
  const isMatch = tone === "match";
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{title}</h4>
      <div className="flex flex-wrap gap-1.5">
        {items.map((kw, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
              isMatch ? "bg-teal/15 text-teal" : "bg-red-500/12 text-red-300"
            }`}
          >
            {isMatch ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {kw}
          </span>
        ))}
      </div>
    </div>
  );
}
