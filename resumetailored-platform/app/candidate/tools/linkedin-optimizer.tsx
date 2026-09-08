"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Contact, Copy, Check, Loader2, Lock, Sparkles, Wand2, Link2, FileText, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, TextInput, PrimaryButton, SecondaryButton, UpgradeNote } from "../components/ui";
import type { LinkedinAnalysis, OptimizeSection } from "@/lib/linkedin-ai";
import type { ResumeDraft } from "@/lib/draft-types";

const ANALYZE_STEPS = ["Reading profile…", "Analyzing keywords…", "Scoring visibility…"];
const scoreColor = (n: number) => (n >= 75 ? "#14B8A6" : n >= 50 ? "#F59E0B" : "#f87171");

export function LinkedInOptimizerTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"paste" | "url">("paste");
  const [profileText, setProfileText] = useState("");
  const [url, setUrl] = useState("");
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [jobTitle, setJobTitle] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<LinkedinAnalysis | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);

  // Optimized copy (Pro).
  const [headlineOptions, setHeadlineOptions] = useState<string[]>([]);
  const [optimizedHeadline, setOptimizedHeadline] = useState("");
  const [aboutText, setAboutText] = useState("");
  const [experienceText, setExperienceText] = useState("");
  const [busySection, setBusySection] = useState<OptimizeSection | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [view, setView] = useState<"original" | "optimized">("original");
  const optimizeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/resumes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || []))
      .catch(() => {});
  }, []);

  // Cycle the progress-step label while analyzing.
  useEffect(() => {
    if (!analyzing) { setStep(0); return; }
    const t = setInterval(() => setStep((s) => (s + 1) % ANALYZE_STEPS.length), 900);
    return () => clearInterval(t);
  }, [analyzing]);

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    });
  }

  async function scrape() {
    if (!url.trim()) { setError("Paste a LinkedIn profile URL."); return; }
    setScraping(true);
    setError(null);
    try {
      const res = await fetch("/api/linkedin/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const d = (await res.json().catch(() => ({}))) as { text?: string; error?: string; blocked?: boolean };
      if (d.text) { setProfileText(d.text); setTab("paste"); }
      else setError(d.error || "Couldn't read that URL. Paste your profile text instead.");
    } catch {
      setError("Couldn't reach that URL. Paste your profile text instead.");
    } finally {
      setScraping(false);
    }
  }

  async function analyze() {
    if (profileText.trim().length < 40) { setError("Paste your LinkedIn profile (headline + About at least)."); return; }
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    try {
      const res = await fetch("/api/linkedin/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileText, jobTitle: jobTitle.trim() || undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { analysis?: LinkedinAnalysis; suggestionsTotal?: number; suggestionsTruncated?: boolean; error?: string; message?: string };
      if (!res.ok || !d.analysis) throw new Error(d.message || d.error || "Analysis failed.");
      setAnalysis(d.analysis);
      setTotal(d.suggestionsTotal || d.analysis.suggestions.length);
      setTruncated(!!d.suggestionsTruncated);
      if (!jobTitle.trim() && d.analysis.jobTitle) setJobTitle(d.analysis.jobTitle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function optimize(section: OptimizeSection) {
    if (!isPro) { router.push("/candidate?upgrade=pro"); return; }
    if (profileText.trim().length < 40) { setError("Analyze a profile first."); return; }
    setBusySection(section);
    setError(null);
    try {
      const res = await fetch("/api/linkedin/optimize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileText, section, jobTitle: jobTitle.trim() || undefined }),
      });
      if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
      const d = (await res.json().catch(() => ({}))) as { options?: string[]; error?: string; message?: string };
      if (!res.ok || !d.options?.length) throw new Error(d.message || d.error || "Could not generate copy.");
      if (section === "headline") { setHeadlineOptions(d.options); setOptimizedHeadline(d.options[0]); }
      else if (section === "about") setAboutText(d.options[0]);
      else setExperienceText(d.options[0]);
      setView("optimized");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusySection(null);
    }
  }

  function fixIt(section?: string) {
    optimizeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (section === "headline" || section === "about" || section === "experience") optimize(section);
  }

  // Composed optimized profile text (for Copy All + optimized preview).
  const optimizedFull = useMemo(() => {
    const skills = analysis ? [...analysis.presentKeywords, ...analysis.missingKeywords] : [];
    return [
      optimizedHeadline && `HEADLINE\n${optimizedHeadline}`,
      aboutText && `ABOUT\n${aboutText}`,
      experienceText && `EXPERIENCE\n${experienceText}`,
      skills.length ? `SKILLS\n${skills.join(" · ")}` : "",
    ].filter(Boolean).join("\n\n");
  }, [optimizedHeadline, aboutText, experienceText, analysis]);

  const hasOptimized = !!(optimizedHeadline || aboutText || experienceText);

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">{isPro ? "Pro · full rewrite" : "Free · score + top fixes"}</span>
      <PrimaryButton onClick={analyze} loading={analyzing}>
        <TrendingUp className="h-4 w-4" /> {analysis ? "Re-analyze" : "Analyze my profile"}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="LinkedIn Optimizer" icon={Contact} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-[45%_55%]">
        {/* LEFT: form + results */}
        <div className="min-h-0 space-y-5 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          {/* Input tabs */}
          <div>
            <div className="mb-2 inline-flex rounded-lg border border-border-gold p-0.5">
              <button type="button" onClick={() => setTab("paste")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium", tab === "paste" ? "bg-violet text-white" : "text-muted-cream")}><FileText className="h-3.5 w-3.5" /> Paste profile</button>
              <button type="button" onClick={() => setTab("url")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium", tab === "url" ? "bg-violet text-white" : "text-muted-cream")}><Link2 className="h-3.5 w-3.5" /> Paste URL</button>
            </div>

            {tab === "paste" ? (
              <>
                <TextArea rows={8} value={profileText} onChange={(e) => setProfileText(e.target.value)} placeholder="Paste your LinkedIn headline, About, experience and skills…" />
                {resumes.length > 0 && (
                  <select
                    className="mt-2 w-full rounded-xl border border-border-gold bg-white/5 px-3 py-2.5 text-sm text-cream outline-none [&>option]:bg-navy"
                    value="" onChange={(e) => { const d = resumes.find((r) => r.id === e.target.value); if (d) setProfileText(d.content.result || d.content.resumeText || ""); }}
                  >
                    <option value="">…or auto-fill from a saved resume</option>
                    {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                  </select>
                )}
              </>
            ) : (
              <div className="flex gap-2">
                <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/in/you" />
                <SecondaryButton onClick={scrape} disabled={scraping}>{scraping ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}</SecondaryButton>
              </div>
            )}
          </div>

          <div>
            <Label>Target role (optional — inferred if blank)</Label>
            <TextInput value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Senior Product Manager" />
          </div>

          {analyzing && (
            <div className="flex items-center gap-2 rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-xs text-muted-cream">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-violet" /> {ANALYZE_STEPS[step]}
            </div>
          )}
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

          {analysis && (
            <>
              {/* Score card */}
              <div className="rounded-xl border border-border-gold bg-white/5 p-4">
                <div className="flex items-center gap-5">
                  <Gauge score={analysis.score} />
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-cream">LinkedIn Profile Score</div>
                    <div className="font-serif text-lg text-cream">{analysis.jobTitle}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <SubScore label="Headline impact" n={analysis.breakdown.headline} />
                  <SubScore label="About SEO" n={analysis.breakdown.about} />
                  <SubScore label="Experience depth" n={analysis.breakdown.experience} />
                  <SubScore label="Keyword richness" n={analysis.breakdown.keywords} />
                </div>
              </div>

              {/* Suggestions */}
              {analysis.suggestions.length > 0 && (
                <div>
                  <Label>Suggestions</Label>
                  <ol className="space-y-2">
                    {analysis.suggestions.map((s, i) => (
                      <li key={i} className="rounded-xl border border-border-gold bg-white/5 p-3">
                        <div className="flex items-start gap-2">
                          <span className={cn("mt-0.5 h-5 w-5 shrink-0 rounded-full text-center text-xs font-bold leading-5", s.priority === "high" ? "bg-red-500/20 text-red-300" : s.priority === "low" ? "bg-white/10 text-white/60" : "bg-gold/20 text-gold")}>{i + 1}</span>
                          <div className="flex-1">
                            <p className="text-sm text-cream">{s.issue}</p>
                            <p className="mt-0.5 text-xs text-white/55">{s.fix}</p>
                            <button type="button" onClick={() => fixIt(s.section)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline"><Wand2 className="h-3 w-3" /> Fix it</button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {truncated && <UpgradeNote>Pro shows all {total} findings + AI-optimized rewrites (you see the top 3).</UpgradeNote>}
                </div>
              )}

              {/* Keyword insights */}
              {(analysis.presentKeywords.length > 0 || analysis.missingKeywords.length > 0) && (
                <div>
                  <Label>Keyword insights</Label>
                  {analysis.presentKeywords.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {analysis.presentKeywords.map((k) => <span key={k} className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2.5 py-1 text-xs text-teal"><Check className="h-3 w-3" /> {k}</span>)}
                    </div>
                  )}
                  {analysis.missingKeywords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.missingKeywords.map((k) => <span key={k} className="inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2.5 py-1 text-xs text-red-300">+ {k}</span>)}
                    </div>
                  )}
                </div>
              )}

              {/* Optimized copy (Pro) */}
              <div ref={optimizeRef} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet" />
                  <h4 className="text-sm font-semibold text-cream">AI-optimized copy {!isPro && <span className="ml-1 align-middle text-[10px] font-bold text-gold">PRO</span>}</h4>
                </div>
                <div className="flex flex-wrap gap-2">
                  <OptBtn label="Optimize headline" busy={busySection === "headline"} locked={!isPro} onClick={() => optimize("headline")} />
                  <OptBtn label="Optimize about" busy={busySection === "about"} locked={!isPro} onClick={() => optimize("about")} />
                  <OptBtn label="Rewrite experience" busy={busySection === "experience"} locked={!isPro} onClick={() => optimize("experience")} />
                </div>

                {headlineOptions.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-cream">Headline options</div>
                    {headlineOptions.map((h, i) => (
                      <div key={i} className={cn("rounded-lg border p-2 text-xs text-cream", optimizedHeadline === h ? "border-violet bg-violet/10" : "border-border-gold bg-white/5")}>
                        <p>{h}</p>
                        <div className="mt-1.5 flex gap-2">
                          <button type="button" onClick={() => copy(h, `h${i}`)} className="inline-flex items-center gap-1 text-[11px] text-white/60 hover:text-cream">{copiedKey === `h${i}` ? <Check className="h-3 w-3 text-teal" /> : <Copy className="h-3 w-3" />} Copy</button>
                          <button type="button" onClick={() => { setOptimizedHeadline(h); setView("optimized"); }} className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet hover:underline">Apply to preview</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {aboutText && <OptOut label="About" text={aboutText} copiedKey={copiedKey} onCopy={() => copy(aboutText, "about")} ck="about" onApply={() => setView("optimized")} />}
                {experienceText && <OptOut label="Experience" text={experienceText} copiedKey={copiedKey} onCopy={() => copy(experienceText, "exp")} ck="exp" onApply={() => setView("optimized")} />}
              </div>
            </>
          )}
        </div>

        {/* RIGHT: side-by-side preview */}
        <div className="flex min-h-0 flex-col bg-navy/40 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-border-gold p-0.5">
              <button type="button" onClick={() => setView("original")} className={cn("rounded-md px-3 py-1.5 text-xs font-medium", view === "original" ? "bg-violet text-white" : "text-muted-cream")}>Original</button>
              <button type="button" onClick={() => setView("optimized")} className={cn("rounded-md px-3 py-1.5 text-xs font-medium", view === "optimized" ? "bg-violet text-white" : "text-muted-cream")}>Optimized</button>
            </div>
            {view === "optimized" && hasOptimized && (
              <button type="button" onClick={() => copy(optimizedFull, "all")} className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-2.5 py-1.5 text-xs text-cream hover:bg-white/8">
                {copiedKey === "all" ? <Check className="h-3.5 w-3.5 text-teal" /> : <Copy className="h-3.5 w-3.5" />} Copy all
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border-gold bg-white/5 p-4 text-sm leading-relaxed">
            {view === "original" ? (
              profileText.trim() ? (
                <div className="whitespace-pre-wrap text-white/85">{profileText}</div>
              ) : (
                <div className="flex h-full min-h-[240px] items-center justify-center text-center text-white/40">Paste your profile, then Analyze.</div>
              )
            ) : hasOptimized ? (
              <div className="space-y-4">
                {optimizedHeadline && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-cream">Headline</div>
                    <p className="mt-1 rounded-lg bg-violet/15 px-3 py-2 font-medium text-violet">{optimizedHeadline}</p>
                  </div>
                )}
                {aboutText && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-cream">About</div>
                    <p className="mt-1 whitespace-pre-wrap text-white/85">{aboutText}</p>
                  </div>
                )}
                {experienceText && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-cream">Experience</div>
                    <div className="mt-1 whitespace-pre-wrap text-white/85">{experienceText}</div>
                  </div>
                )}
                {analysis && (analysis.presentKeywords.length > 0 || analysis.missingKeywords.length > 0) && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-cream">Skills</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {analysis.presentKeywords.map((k) => <span key={k} className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/80">{k}</span>)}
                      {analysis.missingKeywords.map((k) => <span key={k} className="rounded-full bg-teal/15 px-2 py-0.5 text-xs text-teal">{k}</span>)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-[240px] items-center justify-center text-center text-white/40">
                {isPro ? "Generate optimized copy on the left to see it here." : "Analyze your profile, then upgrade to Pro to generate optimized copy."}
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolModal>
  );
}

function Gauge({ score }: { score: number }) {
  const deg = Math.max(0, Math.min(100, score)) * 3.6;
  const color = scoreColor(score);
  return (
    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.1) 0deg)` }}>
      <div className="flex h-[62px] w-[62px] flex-col items-center justify-center rounded-full bg-navy">
        <span className="text-xl font-bold text-white">{score}</span>
        <span className="text-[8px] uppercase tracking-wide text-white/50">/ 100</span>
      </div>
    </div>
  );
}

function SubScore({ label, n }: { label: string; n: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]"><span className="text-white/60">{label}</span><span className="font-semibold text-cream">{n}</span></div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${n}%`, background: scoreColor(n) }} /></div>
    </div>
  );
}

function OptBtn({ label, busy, locked, onClick }: { label: string; busy: boolean; locked: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-3 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-white/8 disabled:opacity-60">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : locked ? <Lock className="h-3.5 w-3.5 text-gold" /> : <Sparkles className="h-3.5 w-3.5 text-violet" />} {label}
    </button>
  );
}

function OptOut({ label, text, onCopy, onApply, copiedKey, ck }: { label: string; text: string; onCopy: () => void; onApply: () => void; copiedKey: string | null; ck: string }) {
  return (
    <div className="mt-3 rounded-lg border border-border-gold bg-white/5 p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-cream">{label}</div>
      <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-white/85">{text}</p>
      <div className="mt-1.5 flex gap-2">
        <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 text-[11px] text-white/60 hover:text-cream">{copiedKey === ck ? <Check className="h-3 w-3 text-teal" /> : <Copy className="h-3 w-3" />} Copy</button>
        <button type="button" onClick={onApply} className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet hover:underline">Apply to preview</button>
      </div>
    </div>
  );
}
