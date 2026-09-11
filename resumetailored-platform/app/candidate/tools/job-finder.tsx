"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase, Search, Bookmark, BookmarkCheck, ExternalLink, Trash2, Lock, MapPin,
  Check, X, Wand2, Copy, ChevronDown, Loader2, FileText, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, TextInput, Select, PrimaryButton } from "../components/ui";
import { parseSalary, salaryInsight } from "@/lib/jobs-ai";
import type { JobResult } from "@/app/api/jobs/search/route";
import type { ResumeDraft } from "@/lib/draft-types";

const EXPERIENCE_LEVELS = [
  { id: "any", label: "Any" }, { id: "entry", label: "Entry" }, { id: "mid", label: "Mid" },
  { id: "senior", label: "Senior" }, { id: "executive", label: "Executive" },
];
const JOB_TYPES = [
  { id: "full_time", label: "Full-time" }, { id: "contract", label: "Contract" },
  { id: "part_time", label: "Part-time" }, { id: "internship", label: "Internship" }, { id: "remote", label: "Remote" },
];
const STATUSES = ["saved", "applied", "interview", "offer", "rejected"] as const;
type JobStatus = (typeof STATUSES)[number];
const STATUS_TONE: Record<JobStatus, string> = {
  saved: "bg-white/10 text-white/70", applied: "bg-violet/20 text-violet",
  interview: "bg-gold/20 text-gold", offer: "bg-teal/15 text-teal", rejected: "bg-red-500/15 text-red-300",
};
const scoreColor = (n: number) => (n >= 75 ? "#14B8A6" : n >= 50 ? "#F59E0B" : "#f87171");
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

interface SavedRow { id: number; jobData: JobResult; status: JobStatus; notes: string | null }

export function JobFinderTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [resumeText, setResumeText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [level, setLevel] = useState("any");
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<JobResult[] | null>(null);
  const [lockedCount, setLockedCount] = useState(0);
  const [source, setSource] = useState<"live" | "ai" | null>(null);
  const [sort, setSort] = useState<"match" | "newest" | "salary">("match");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"search" | "saved">("search");
  const [saved, setSaved] = useState<SavedRow[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const [selected, setSelected] = useState<JobResult | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [pkg, setPkg] = useState<{ resume: string; coverLetter: string; linkedInMessage: string } | null>(null);
  const [busy, setBusy] = useState<"cover" | "package" | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [salaryOpen, setSalaryOpen] = useState(false);

  useEffect(() => {
    fetch("/api/resumes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || []))
      .catch(() => {});
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/save", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { jobs?: SavedRow[] };
      setSaved(d.jobs || []);
      setSavedIds(new Set((d.jobs || []).map((j) => j.jobData?.id).filter(Boolean)));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopiedKey(key); setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500); });
  }
  function toggleType(id: string) {
    setTypes((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function search() {
    if (!keywords.trim() && !location.trim() && resumeText.trim().length < 40) {
      setError("Add a resume, or a keyword/location, to find matches."); return;
    }
    setSearching(true); setError(null);
    try {
      const res = await fetch("/api/jobs/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: resumeText, keywords, location, experienceLevel: level, jobTypes: Array.from(types) }),
      });
      const d = (await res.json().catch(() => ({}))) as { jobs?: JobResult[]; lockedCount?: number; source?: "live" | "ai"; error?: string; message?: string };
      if (!res.ok) throw new Error(d.message || d.error || "Search failed.");
      setJobs(d.jobs || []);
      setLockedCount(d.lockedCount || 0);
      setSource(d.source || null);
      setSelected(d.jobs?.[0] || null);
      setCoverLetter(""); setPkg(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong."); setJobs([]);
    } finally { setSearching(false); }
  }

  async function save(job: JobResult) {
    setSavedIds((s) => new Set(s).add(job.id));
    await fetch("/api/jobs/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job }) });
    loadSaved();
  }
  async function remove(id: number) { await fetch(`/api/jobs/save/${id}`, { method: "DELETE" }); loadSaved(); }
  async function setStatus(id: number, status: JobStatus) {
    setSaved((cur) => cur.map((s) => (s.id === id ? { ...s, status } : s)));
    await fetch("/api/jobs/status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
  }
  async function markApplied(job: JobResult) {
    if (!savedIds.has(job.id)) await save(job);
    await loadSaved();
    const row = saved.find((s) => s.jobData?.id === job.id);
    // Re-fetch to get the id of a just-saved row, then set applied.
    const res = await fetch("/api/jobs/save", { cache: "no-store" });
    const d = (await res.json().catch(() => ({}))) as { jobs?: SavedRow[] };
    const found = (d.jobs || []).find((s) => s.jobData?.id === job.id) || row;
    if (found) { await setStatus(found.id, "applied"); loadSaved(); setView("saved"); }
  }

  async function genCover() {
    if (!isPro) { router.push("/candidate?upgrade=pro"); return; }
    if (!selected) return;
    if (resumeText.trim().length < 40) { setError("Add your resume in Search first."); return; }
    setBusy("cover"); setError(null);
    try {
      const jd = jobToJD(selected);
      const res = await fetch("/api/jobs/cover-letter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resume: resumeText, jobDescription: jd }) });
      if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
      const d = (await res.json().catch(() => ({}))) as { coverLetter?: string; error?: string; message?: string };
      if (!res.ok || !d.coverLetter) throw new Error(d.message || d.error || "Could not generate the cover letter.");
      setCoverLetter(d.coverLetter); setPkg(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(null); }
  }
  async function genPackage() {
    if (!isPro) { router.push("/candidate?upgrade=pro"); return; }
    if (!selected) return;
    if (resumeText.trim().length < 40) { setError("Add your resume in Search first."); return; }
    setBusy("package"); setError(null);
    try {
      const jd = jobToJD(selected);
      const res = await fetch("/api/jobs/apply-package", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resume: resumeText, jobDescription: jd }) });
      if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
      const d = (await res.json().catch(() => ({}))) as { resume?: string; coverLetter?: string; linkedInMessage?: string; error?: string; message?: string };
      if (!res.ok || !d.resume) throw new Error(d.message || d.error || "Could not build the package.");
      setPkg({ resume: d.resume, coverLetter: d.coverLetter || "", linkedInMessage: d.linkedInMessage || "" }); setCoverLetter("");
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(null); }
  }

  const sorted = useMemo(() => {
    if (!jobs) return null;
    const arr = [...jobs];
    if (sort === "match") arr.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    else if (sort === "salary") arr.sort((a, b) => (parseSalary(b.salary)?.[1] ?? 0) - (parseSalary(a.salary)?.[1] ?? 0));
    // "newest" keeps API order (already newest-ish from the source).
    return arr;
  }, [jobs, sort]);

  const insight = useMemo(() => {
    if (!selected || !jobs) return null;
    return salaryInsight(selected.salary, jobs.map((j) => j.salary), selected.matchScore);
  }, [selected, jobs]);

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">{isPro ? "Pro · unlimited matches + apply package" : "Free · 5 matches"}</span>
      {view === "search" && <PrimaryButton onClick={search} loading={searching}><Search className="h-4 w-4" /> Find matches</PrimaryButton>}
    </>
  );

  return (
    <ToolModal title="Job Finder" icon={Briefcase} onClose={onClose} footer={footer}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex gap-1 border-b border-border-gold p-2">
          <Tab active={view === "search"} onClick={() => setView("search")} label="Search" />
          <Tab active={view === "saved"} onClick={() => setView("saved")} label={`My Jobs${saved.length ? ` (${saved.length})` : ""}`} />
        </div>

        {view === "saved" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {saved.length === 0 ? (
              <div className="flex h-full min-h-[280px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">No saved jobs yet — save one from Search.</div>
            ) : (
              <ul className="mx-auto max-w-2xl space-y-2.5">
                {saved.map((s) => (
                  <li key={s.id} className="rounded-xl border border-border-gold bg-white/5 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-white">{s.jobData.title}</p>
                        <p className="text-sm text-white/60">{s.jobData.company}{s.jobData.location ? ` · ${s.jobData.location}` : ""}</p>
                        {s.jobData.salary && <p className="mt-0.5 text-xs font-semibold text-teal">{s.jobData.salary}</p>}
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", STATUS_TONE[s.status])}>{s.status}</span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <select value={s.status} onChange={(e) => setStatus(s.id, e.target.value as JobStatus)} className="rounded-lg border border-border-gold bg-white/5 px-2 py-1 text-xs text-cream outline-none [&>option]:bg-navy">
                        {STATUSES.map((st) => <option key={st} value={st}>{st[0].toUpperCase() + st.slice(1)}</option>)}
                      </select>
                      <button type="button" onClick={() => { setSelected(s.jobData); setView("search"); }} className="inline-flex items-center gap-1 rounded-lg border border-border-gold px-2.5 py-1 text-xs text-cream hover:bg-white/8">View</button>
                      {s.jobData.url && <a href={s.jobData.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border-gold px-2.5 py-1 text-xs text-cream hover:bg-white/8"><ExternalLink className="h-3 w-3" /> Apply</a>}
                      <button type="button" onClick={() => remove(s.id)} className="ml-auto inline-flex items-center gap-1 text-xs text-white/45 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /> Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[45%_55%]">
            {/* LEFT: search + list */}
            <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
              <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <div>
                  <Label>My resume</Label>
                  <TextArea rows={3} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste your resume to score matches…" />
                  {resumes.length > 0 && (
                    <Select className="mt-2" value="" onChange={(e) => { const d = resumes.find((r) => r.id === e.target.value); if (d) setResumeText(d.content.result || d.content.resumeText || ""); }}>
                      <option value="">…or use a saved resume</option>
                      {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                    </Select>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Keywords</Label><TextInput value={keywords} onChange={(e) => setKeywords(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="product manager" /></div>
                  <div><Label>Location</Label><TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="New York / remote" /></div>
                </div>
                <div>
                  <Label>Experience level</Label>
                  <Select value={level} onChange={(e) => setLevel(e.target.value)}>{EXPERIENCE_LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
                </div>
                <div>
                  <Label>Job type</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {JOB_TYPES.map((t) => (
                      <button key={t.id} type="button" onClick={() => toggleType(t.id)} className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", types.has(t.id) ? "border-violet bg-violet/20 text-white" : "border-border-gold text-muted-cream hover:bg-white/5")}>{t.label}</button>
                    ))}
                  </div>
                </div>
              </div>
              {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

              {sorted && sorted.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/45">{source === "ai" ? "AI-matched examples" : "Live matches"}</span>
                  <Select className="w-auto py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                    <option value="match">Best match</option><option value="newest">Newest</option><option value="salary">Salary (high→low)</option>
                  </Select>
                </div>
              )}

              {sorted && (sorted.length === 0 ? (
                <div className="flex min-h-[160px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">No matches. Try broader keywords or clear the location.</div>
              ) : (
                <ul className="space-y-2.5">
                  {sorted.map((job) => (
                    <li key={job.id}>
                      <button type="button" onClick={() => { setSelected(job); setCoverLetter(""); setPkg(null); }} className={cn("w-full rounded-xl border bg-white/5 p-3.5 text-left transition-colors", selected?.id === job.id ? "border-violet" : "border-border-gold hover:border-white/25")}>
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm font-bold text-white/70">{job.company.slice(0, 1).toUpperCase()}</div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-white">{job.title}</p>
                            <p className="truncate text-sm text-white/60">{job.company}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/50">
                              {job.location && <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {job.location}</span>}
                              {job.remote && <span className="rounded bg-teal/15 px-1.5 py-0.5 text-teal">Remote</span>}
                              {job.postedDate && <span>· {job.postedDate}</span>}
                            </div>
                            {job.salary && <p className="mt-0.5 text-xs font-semibold text-teal">{job.salary}</p>}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            {typeof job.matchScore === "number" && <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: `${scoreColor(job.matchScore)}22`, color: scoreColor(job.matchScore) }}>{job.matchScore}%</span>}
                            <span onClick={(e) => { e.stopPropagation(); save(job); }} role="button" aria-label="Save" className="text-white/50 hover:text-gold">{savedIds.has(job.id) ? <BookmarkCheck className="h-4 w-4 text-gold" /> : <Bookmark className="h-4 w-4" />}</span>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}

                  {lockedCount > 0 && (
                    <li>
                      <button type="button" onClick={() => router.push("/candidate?upgrade=pro")} className="relative block w-full overflow-hidden rounded-xl border border-border-gold p-3.5 text-left">
                        <div className="space-y-2 blur-sm" aria-hidden>
                          <div className="h-3 w-2/3 rounded bg-white/15" /><div className="h-2 w-1/2 rounded bg-white/10" /><div className="h-2 w-1/3 rounded bg-white/10" />
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-navy/50 text-sm font-semibold text-white"><Lock className="h-4 w-4 text-gold" /> Upgrade to see all matches</div>
                      </button>
                    </li>
                  )}
                </ul>
              ))}

              {!sorted && <div className="flex min-h-[200px] items-center justify-center text-sm text-white/45">Add your resume + a keyword, then Find matches.</div>}
            </div>

            {/* RIGHT: detail + actions */}
            <div className="flex min-h-0 flex-col bg-navy/40">
              {selected ? (
                <>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <h3 className="font-serif text-xl text-cream">{selected.title}</h3>
                    <p className="text-sm text-white/70">{selected.company}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/55">
                      {selected.location && <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {selected.location}</span>}
                      {selected.jobType && <span>{selected.jobType}</span>}
                      {selected.experienceLevel && <span>{selected.experienceLevel}</span>}
                      {selected.postedDate && <span>{selected.postedDate}</span>}
                    </div>
                    {selected.salary && <p className="mt-1.5 text-sm font-semibold text-teal">{selected.salary}</p>}

                    {selected.matchAnalysis && (
                      <div className="mt-4 rounded-xl border border-border-gold bg-white/5 p-3.5">
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">Match analysis {typeof selected.matchScore === "number" && <span style={{ color: scoreColor(selected.matchScore) }}>{selected.matchScore}%</span>}</div>
                        {selected.matchAnalysis.have.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1.5">{selected.matchAnalysis.have.map((k) => <span key={k} className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2 py-0.5 text-xs text-teal"><Check className="h-3 w-3" /> {k}</span>)}</div>}
                        {selected.matchAnalysis.missing.length > 0 && <div className="flex flex-wrap gap-1.5">{selected.matchAnalysis.missing.map((k) => <span key={k} className="inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-0.5 text-xs text-red-300"><X className="h-3 w-3" /> {k}</span>)}</div>}
                        {selected.matchAnalysis.missing.length > 0 && <p className="mt-2 text-xs text-white/60">Tip: if you truly have it, add <span className="text-cream">{selected.matchAnalysis.missing.slice(0, 3).join(", ")}</span> to your resume to raise this match.</p>}
                      </div>
                    )}

                    {(selected.description || selected.snippet) && (
                      <div className="mt-4">
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-cream">Job description</div>
                        <p className="whitespace-pre-wrap text-sm text-white/80">{selected.description || selected.snippet}</p>
                        {selected.requirements && selected.requirements.length > 0 && (
                          <ul className="mt-2 space-y-1">{selected.requirements.map((r, i) => <li key={i} className="flex gap-2 text-sm text-white/75"><span className="text-violet">▸</span> {r}</li>)}</ul>
                        )}
                      </div>
                    )}

                    {/* Salary insights (Pro) */}
                    {insight && (
                      <div className="mt-4 rounded-xl border border-border-gold bg-white/5">
                        <button type="button" onClick={() => (isPro ? setSalaryOpen((o) => !o) : router.push("/candidate?upgrade=pro"))} className="flex w-full items-center justify-between p-3 text-xs font-semibold uppercase tracking-wide text-muted-cream">
                          <span className="inline-flex items-center gap-1.5">{!isPro && <Lock className="h-3.5 w-3.5 text-gold" />} Salary insights</span>
                          <ChevronDown className={cn("h-4 w-4 transition-transform", salaryOpen && isPro && "rotate-180")} />
                        </button>
                        {isPro && salaryOpen && (
                          <div className="space-y-3 px-3 pb-3">
                            <p className="text-sm text-white/80">Role range{selected.location ? ` in ${selected.location}` : ""}: <span className="font-semibold text-cream">{money(insight.roleLow)} – {money(insight.roleHigh)}</span> (median {money(insight.roleMedian)}).</p>
                            <div>
                              <div className="mb-1 flex justify-between text-xs text-white/60"><span>Role median</span><span>{money(insight.roleMedian)}</span></div>
                              <div className="h-2 rounded-full bg-white/10"><div className="h-full rounded-full bg-white/40" style={{ width: `${Math.min(100, (insight.roleMedian / insight.roleHigh) * 100)}%` }} /></div>
                              <div className="mb-1 mt-2 flex justify-between text-xs text-teal"><span>Your estimated value</span><span>{money(insight.yourEstimate)}</span></div>
                              <div className="h-2 rounded-full bg-white/10"><div className="h-full rounded-full bg-teal" style={{ width: `${Math.min(100, (insight.yourEstimate / insight.roleHigh) * 100)}%` }} /></div>
                            </div>
                            <p className="text-[11px] text-white/40">Estimated from the listings on screen and your match — not a guarantee.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Generated outputs */}
                    {coverLetter && <OutputCard title="Cover letter" text={coverLetter} onCopy={() => copy(coverLetter, "cl")} copied={copiedKey === "cl"} />}
                    {pkg && (
                      <div className="mt-4 space-y-3">
                        <OutputCard title="Tailored resume" text={pkg.resume} onCopy={() => copy(pkg.resume, "pr")} copied={copiedKey === "pr"} />
                        <OutputCard title="Cover letter" text={pkg.coverLetter} onCopy={() => copy(pkg.coverLetter, "pc")} copied={copiedKey === "pc"} />
                        {pkg.linkedInMessage && <OutputCard title="LinkedIn message" text={pkg.linkedInMessage} onCopy={() => copy(pkg.linkedInMessage, "pl")} copied={copiedKey === "pl"} />}
                      </div>
                    )}
                  </div>

                  {/* Sticky action bar */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-border-gold bg-navy/70 p-3">
                    <button type="button" onClick={() => save(selected)} disabled={savedIds.has(selected.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-3 py-2 text-xs font-medium text-cream hover:bg-white/8 disabled:opacity-60">
                      {savedIds.has(selected.id) ? <BookmarkCheck className="h-4 w-4 text-gold" /> : <Bookmark className="h-4 w-4" />} {savedIds.has(selected.id) ? "Saved" : "Save"}
                    </button>
                    <button type="button" onClick={genCover} disabled={busy === "cover"} className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-3 py-2 text-xs font-medium text-cream hover:bg-white/8 disabled:opacity-60">
                      {busy === "cover" ? <Loader2 className="h-4 w-4 animate-spin" /> : isPro ? <FileText className="h-4 w-4 text-violet" /> : <Lock className="h-4 w-4 text-gold" />} Cover letter
                    </button>
                    <button type="button" onClick={genPackage} disabled={busy === "package"} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet to-indigo-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
                      {busy === "package" ? <Loader2 className="h-4 w-4 animate-spin" /> : isPro ? <Wand2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />} Apply package
                    </button>
                    <button type="button" onClick={() => markApplied(selected)} className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-3 py-2 text-xs font-medium text-cream hover:bg-white/8"><Send className="h-4 w-4" /> Mark applied</button>
                    {selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-3 py-2 text-xs text-cream hover:bg-white/8"><ExternalLink className="h-4 w-4" /> Apply on site</a>}
                  </div>
                </>
              ) : (
                <div className="flex h-full min-h-[280px] items-center justify-center p-8 text-center text-sm text-white/45">Select a job to see the match analysis and actions.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </ToolModal>
  );
}

function jobToJD(job: JobResult): string {
  return [
    `${job.title} at ${job.company}${job.location ? ` — ${job.location}` : ""}`,
    job.salary || "",
    job.description || job.snippet || "",
    (job.requirements || []).length ? `Requirements:\n- ${(job.requirements || []).join("\n- ")}` : "",
  ].filter(Boolean).join("\n\n");
}

function OutputCard({ title, text, onCopy, copied }: { title: string; text: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="mt-4 rounded-xl border border-border-gold bg-white/5 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-cream">{title}</span>
        <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 text-[11px] text-white/60 hover:text-cream">{copied ? <Check className="h-3.5 w-3.5 text-teal" /> : <Copy className="h-3.5 w-3.5" />} Copy</button>
      </div>
      <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-sm text-white/80">{text}</p>
    </div>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors", active ? "bg-violet/20 text-white" : "text-muted-cream hover:bg-white/5")}>{label}</button>
  );
}
