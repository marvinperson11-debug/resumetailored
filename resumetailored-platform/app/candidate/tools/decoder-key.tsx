"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileSearch, KeyRound, AlertTriangle, Eye, DollarSign, Users, Target, Lock,
  GitCompare, Check, Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, Select, PrimaryButton, UpgradeNote } from "../components/ui";
import { JdImport } from "./jd-import";
import type { DecodeResult, CompareResult, Depth, Severity } from "@/lib/decoder-ai";
import type { ResumeDraft } from "@/lib/draft-types";

const SEV_TONE: Record<Severity, string> = { info: "text-white/70", warning: "text-gold", danger: "text-red-300" };
const scoreColor = (n: number) => (n >= 66 ? "#14B8A6" : n >= 33 ? "#F59E0B" : "#f87171");
interface SavedJob { id: number; jobData: { id?: string; title?: string; company?: string; description?: string; snippet?: string } }

export function DecoderKeyTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [jdB, setJdB] = useState("");
  const [resume, setResume] = useState("");
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([]);
  const [depth, setDepth] = useState<Depth>("basic");
  const [compareMode, setCompareMode] = useState(false);
  const [result, setResult] = useState<DecodeResult | null>(null);
  const [cmp, setCmp] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);

  useEffect(() => {
    fetch("/api/resumes", { cache: "no-store" }).then((r) => r.json()).then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || [])).catch(() => {});
    fetch("/api/jobs/save", { cache: "no-store" }).then((r) => r.json()).then((d: { jobs?: SavedJob[] }) => setSavedJobs(d.jobs || [])).catch(() => {});
  }, []);

  function pickDepth(d: Depth) {
    if (d === "deep" && !isPro) { router.push("/candidate?upgrade=pro"); return; }
    setDepth(d);
  }
  function toggleCompare() {
    if (!isPro) { router.push("/candidate?upgrade=pro"); return; }
    setCompareMode((v) => !v); setResult(null); setCmp(null);
  }

  async function decode() {
    if (jd.trim().length < 40) { setError("Paste the job posting first."); return; }
    setLoading(true); setError(null); setLimited(false); setCmp(null);
    try {
      const res = await fetch("/api/decoder/decode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobDescription: jd, depth, resume: depth === "deep" ? resume : undefined }) });
      const d = (await res.json().catch(() => ({}))) as { result?: DecodeResult; error?: string; message?: string };
      if (res.status === 402) {
        if (d.error === "daily_limit") { setLimited(true); setError(d.message || "Daily limit reached."); return; }
        router.push("/candidate?upgrade=pro"); return;
      }
      if (!res.ok || !d.result) throw new Error(d.message || d.error || "Could not decode that posting.");
      setResult(d.result);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setLoading(false); }
  }
  async function decodeBoth() {
    if (jd.trim().length < 40 || jdB.trim().length < 40) { setError("Paste both postings to compare."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/decoder/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobA: jd, jobB: jdB, resume }) });
      if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
      const d = (await res.json().catch(() => ({}))) as { result?: CompareResult; error?: string; message?: string };
      if (!res.ok || !d.result) throw new Error(d.message || d.error || "Could not compare.");
      setCmp(d.result);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setLoading(false); }
  }

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">{isPro ? "Pro · unlimited + deep decode" : "Free · 1 basic decode/day"}</span>
      <PrimaryButton onClick={compareMode ? decodeBoth : decode} loading={loading}>
        {compareMode ? <GitCompare className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />} {compareMode ? "Decode both" : "Decode"}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="Decoder Key" icon={FileSearch} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-[45%_55%]">
        {/* LEFT */}
        <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          {/* Depth + compare controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border-gold p-0.5">
              <button type="button" onClick={() => pickDepth("basic")} className={cn("rounded-md px-3 py-1.5 text-xs font-medium", depth === "basic" && !compareMode ? "bg-violet text-white" : "text-muted-cream")}>Basic</button>
              <button type="button" onClick={() => pickDepth("deep")} className={cn("inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium", depth === "deep" && !compareMode ? "bg-violet text-white" : "text-muted-cream")}>{!isPro && <Lock className="h-3 w-3 text-gold" />} Deep</button>
            </div>
            <button type="button" onClick={toggleCompare} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium", compareMode ? "border-violet bg-violet/15 text-white" : "border-border-gold text-muted-cream hover:bg-white/5")}>{!isPro && <Lock className="h-3 w-3 text-gold" />}<GitCompare className="h-3.5 w-3.5" /> Compare two</button>
          </div>

          <JdImport onImport={setJd} label={compareMode ? "Import Job A from URL" : "Import posting from URL"} />
          {savedJobs.length > 0 && (
            <Select value="" onChange={(e) => { const s = savedJobs.find((x) => String(x.id) === e.target.value); if (s) { setJd(s.jobData.description || s.jobData.snippet || ""); } }}>
              <option value="">…or use a saved job from Job Finder</option>
              {savedJobs.map((s) => <option key={s.id} value={s.id}>{s.jobData.title} — {s.jobData.company}</option>)}
            </Select>
          )}
          <div>
            <Label>{compareMode ? "Job A" : "Job posting"}</Label>
            <TextArea rows={compareMode ? 6 : 11} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job posting…" />
          </div>
          {compareMode && (
            <div>
              <Label>Job B</Label>
              <TextArea rows={6} value={jdB} onChange={(e) => setJdB(e.target.value)} placeholder="Paste the second posting…" />
            </div>
          )}
          {depth === "deep" && !compareMode && isPro && resumes.length > 0 && (
            <Select value="" onChange={(e) => { const d = resumes.find((r) => r.id === e.target.value); if (d) setResume(d.content.result || d.content.resumeText || ""); }}>
              <option value="">Add a resume for your fit score (optional)…</option>
              {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select>
          )}

          {error && <p className={cn("rounded-lg border px-3 py-2 text-xs", limited ? "border-gold/40 bg-gold/10 text-gold" : "border-red-500/40 bg-red-500/10 text-red-300")}>{error}</p>}
          {limited && <UpgradeNote>You&apos;ve used today&apos;s free decode — Pro is unlimited + deep.</UpgradeNote>}
          {!isPro && !limited && <UpgradeNote>Pro unlocks Deep decode (salary, culture, hidden requirements, the real ask) + Compare mode.</UpgradeNote>}
        </div>

        {/* RIGHT */}
        <div className="min-h-0 overflow-y-auto bg-navy/40 p-4">
          {cmp ? <CompareView cmp={cmp} /> : result ? <DecodeView result={result} isPro={isPro} /> : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">
              Paste a posting and hit Decode — jargon translations, red flags, and (Pro) the real ask will appear here.
            </div>
          )}
        </div>
      </div>
    </ToolModal>
  );
}

function DecodeView({ result, isPro }: { result: DecodeResult; isPro: boolean }) {
  return (
    <div className="space-y-5">
      {/* Jargon translator */}
      {result.jargon.length > 0 && (
        <Card title="Jargon translator" icon={<KeyRound className="h-3.5 w-3.5 text-violet" />}>
          <ul className="space-y-2">
            {result.jargon.map((j, i) => (
              <li key={i} className="rounded-lg border border-border-gold bg-white/5 p-2.5">
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-cream">&ldquo;{j.phrase}&rdquo;</span><span className={cn("text-[10px] font-bold uppercase", SEV_TONE[j.severity])}>{j.severity}</span></div>
                <p className="mt-0.5 text-sm text-white/70">→ {j.translation}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Red flags */}
      {result.redFlags.length > 0 && (
        <Card title="Red flags" icon={<AlertTriangle className="h-3.5 w-3.5 text-red-300" />}>
          <div className="space-y-2">
            {result.redFlags.map((f, i) => (
              <div key={i} className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3">
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-cream">{f.title}</span><span title={`severity ${f.severity}/3`}>{"🚩".repeat(f.severity)}</span></div>
                <p className="mt-0.5 text-xs text-white/70">{f.explanation}</p>
                {f.interviewTip && <p className="mt-1.5 rounded bg-white/5 px-2 py-1 text-[11px] text-white/60"><span className="font-semibold text-teal">Ask:</span> {f.interviewTip}</p>}
              </div>
            ))}
          </div>
          {!isPro && <p className="mt-2 text-[11px] text-white/45">Free shows the top 3. Pro shows every red flag.</p>}
        </Card>
      )}

      {/* Hidden requirements */}
      {result.hiddenRequirements && result.hiddenRequirements.length > 0 && (
        <Card title="Hidden requirements" icon={<Eye className="h-3.5 w-3.5 text-gold" />}>
          <div className="space-y-2">
            {result.hiddenRequirements.map((h, i) => (
              <div key={i} className="rounded-lg border border-gold/30 bg-gold/[0.06] p-2.5">
                <p className="text-sm text-cream">🔍 {h.requirement}</p>
                {h.evidence && <p className="mt-0.5 text-xs text-white/55">From: &ldquo;{h.evidence}&rdquo;</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Salary decoder */}
      {result.salaryIntel && (
        <Card title="Salary decoder" icon={<DollarSign className="h-3.5 w-3.5 text-emerald-300" />}>
          <p className="text-sm text-white/85">{result.salaryIntel.assessment}{result.salaryIntel.estimatedRange ? ` · ${result.salaryIntel.estimatedRange}` : ""}</p>
          {result.salaryIntel.breakdown && <p className="mt-1 text-xs text-white/60">{result.salaryIntel.breakdown}</p>}
          {result.salaryIntel.leverage.length > 0 && <div className="mt-2"><div className="mb-1 text-[11px] font-semibold uppercase text-muted-cream">Negotiation leverage</div><ul className="space-y-0.5">{result.salaryIntel.leverage.map((l, i) => <li key={i} className="text-xs text-white/70">• {l}</li>)}</ul></div>}
        </Card>
      )}

      {/* Culture signals */}
      {result.cultureSignals && (
        <Card title="Culture signals" icon={<Users className="h-3.5 w-3.5 text-sky-300" />} right={<span className="text-xs font-bold" style={{ color: scoreColor(result.cultureSignals.cultureScore) }}>{result.cultureSignals.cultureScore}/100</span>}>
          <ul className="space-y-1.5">
            {result.cultureSignals.signals.map((s, i) => (
              <li key={i} className="text-sm"><span className="text-cream">&ldquo;{s.phrase}&rdquo;</span> <span className="text-white/60">→ {s.meaning}</span></li>
            ))}
          </ul>
          {result.cultureSignals.questions.length > 0 && <div className="mt-2"><div className="mb-1 text-[11px] font-semibold uppercase text-muted-cream">Ask in the interview</div><ul className="space-y-0.5">{result.cultureSignals.questions.map((q, i) => <li key={i} className="text-xs text-white/70">• {q}</li>)}</ul></div>}
        </Card>
      )}

      {/* The real ask */}
      {result.realAsk && (
        <Card title="The real ask" icon={<Target className="h-3.5 w-3.5 text-violet" />} right={typeof result.fitScore === "number" ? <span className="text-xs font-bold" style={{ color: scoreColor(result.fitScore) }}>Fit {result.fitScore}%</span> : undefined}>
          <p className="rounded-lg bg-violet/10 px-3 py-2 text-sm text-white/85">{result.realAsk.summary}</p>
          {result.realAsk.emphasize.length > 0 && <div className="mt-2"><div className="mb-1 text-[11px] font-semibold uppercase text-muted-cream">Emphasize in your application</div><ul className="space-y-0.5">{result.realAsk.emphasize.map((e, i) => <li key={i} className="flex gap-1.5 text-sm text-white/80"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" /> {e}</li>)}</ul></div>}
        </Card>
      )}
    </div>
  );
}

function CompareView({ cmp }: { cmp: CompareResult }) {
  const label = (w: "A" | "B" | "tie") => (w === "tie" ? "Tie" : `Job ${w}`);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-xl border border-border-gold bg-white/5 p-3.5">
        <Trophy className="h-6 w-6 text-gold" />
        <div><div className="text-xs uppercase tracking-wide text-muted-cream">Overall winner</div><div className="font-serif text-xl text-cream">{cmp.winner === "tie" ? "It's a tie" : `Job ${cmp.winner}`}</div></div>
      </div>
      <Card title="Category by category">
        <div className="space-y-2">
          {cmp.comparison.map((c, i) => (
            <div key={i} className="rounded-lg border border-border-gold bg-white/5 p-2.5">
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-cream">{c.category}</span><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", c.winner === "tie" ? "bg-white/10 text-white/60" : "bg-violet/20 text-violet")}>{label(c.winner)}</span></div>
              <p className="mt-0.5 text-xs text-white/65">{c.explanation}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Best choice for">
        <div className="grid grid-cols-2 gap-2">
          {(["growth", "pay", "culture", "learning"] as const).map((k) => (
            <div key={k} className="rounded-lg border border-border-gold bg-white/5 p-2.5"><div className="text-[11px] uppercase tracking-wide text-white/50">{k}</div><div className="text-sm font-semibold text-cream">{label(cmp.bestChoiceFor[k])}</div></div>
          ))}
        </div>
      </Card>
      {cmp.combinedRedFlags.length > 0 && (
        <Card title="Red flags across both" icon={<AlertTriangle className="h-3.5 w-3.5 text-red-300" />}>
          <ul className="space-y-1">{cmp.combinedRedFlags.map((f, i) => <li key={i} className="text-sm text-white/75">🚩 {f}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

function Card({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-cream">{title}</h4>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </div>
  );
}
