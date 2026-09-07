"use client";

import { useCallback, useEffect, useState } from "react";
import { Briefcase, Search, Bookmark, BookmarkCheck, Sparkles, ExternalLink, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextInput, PrimaryButton, UpgradeNote } from "../components/ui";
import { useTools } from "../components/tools-context";
import { emptyDraftContent } from "@/lib/draft-types";
import type { JobResult } from "@/app/api/jobs/search/route";

export function JobFinderTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const { openResume } = useTools();
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [remote, setRemote] = useState(false);
  const [jobs, setJobs] = useState<JobResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"search" | "saved">("search");
  const [saved, setSaved] = useState<{ id: number; jobData: JobResult }[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/save", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { jobs?: { id: number; jobData: JobResult }[] };
      setSaved(data.jobs || []);
      setSavedIds(new Set((data.jobs || []).map((j) => j.jobData?.id).filter(Boolean)));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  async function search() {
    if (!query.trim() && !location.trim()) {
      setError("Enter a keyword, location, or both to search.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, location, salaryMin: salaryMin ? Number(salaryMin) : undefined, remote }),
      });
      const data = (await res.json().catch(() => ({}))) as { jobs?: JobResult[]; error?: string; message?: string };
      if (!res.ok) throw new Error(data.message || data.error || "Search failed.");
      setJobs(data.jobs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }

  async function save(job: JobResult) {
    setSavedIds((s) => new Set(s).add(job.id));
    await fetch("/api/jobs/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job }) });
    loadSaved();
  }
  async function remove(id: number) {
    await fetch(`/api/jobs/save/${id}`, { method: "DELETE" });
    loadSaved();
  }

  function tailor(job: JobResult) {
    const jd = `${job.title} at ${job.company}${job.location ? ` — ${job.location}` : ""}\n\n${job.snippet}${job.url ? `\n\nSource: ${job.url}` : ""}`;
    openResume({ ...emptyDraftContent(), jobText: jd }); // opens the AI Resume Builder with the JD pre-filled
  }

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">{isPro ? "Pro · up to 50 results + filters" : "Free · 10 results"}</span>
      {view === "search" && (
        <PrimaryButton onClick={search} loading={loading}>
          <Search className="h-4 w-4" /> Search
        </PrimaryButton>
      )}
    </>
  );

  const list = view === "saved" ? saved.map((s) => s.jobData) : jobs;

  return (
    <ToolModal title="Job Finder" icon={Briefcase} onClose={onClose} footer={footer}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex gap-1 border-b border-border-gold p-2">
          <Tab active={view === "search"} onClick={() => setView("search")} label="Search" />
          <Tab active={view === "saved"} onClick={() => setView("saved")} label={`My Jobs${saved.length ? ` (${saved.length})` : ""}`} />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
          {view === "search" && (
            <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
              <div>
                <Label>Job title / keyword</Label>
                <TextInput value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="e.g. product manager" />
              </div>
              <div>
                <Label>Location</Label>
                <TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. New York (blank = nationwide)" />
              </div>
              {isPro ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Min salary</Label>
                    <TextInput type="number" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} placeholder="80000" />
                  </div>
                  <label className="flex cursor-pointer items-end gap-2 pb-2.5 text-sm text-cream">
                    <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} className="h-4 w-4 accent-violet" />
                    Remote only
                  </label>
                </div>
              ) : (
                <UpgradeNote>Pro unlocks salary, remote &amp; date filters + up to 50 results.</UpgradeNote>
              )}
              {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
            </div>
          )}

          <div className={cn("min-h-0 overflow-y-auto bg-navy/40 p-4", view === "saved" && "lg:col-span-2")}>
            {list === null ? (
              <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-white/45">Search live listings to get started.</div>
            ) : list.length === 0 ? (
              <div className="flex h-full min-h-[280px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">
                {view === "saved" ? "No saved jobs yet — save one from Search." : "No matches. Try a broader keyword or clear the location."}
              </div>
            ) : (
              <ul className="space-y-3">
                {list.map((job) => (
                  <li key={job.id} className="rounded-xl border border-border-gold bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-white">{job.title}</p>
                        <p className="text-sm text-white/60">{job.company}{job.location ? ` · ${job.location}` : ""}</p>
                        {job.salary && <p className="mt-0.5 text-xs font-semibold text-teal">{job.salary}</p>}
                      </div>
                      {view === "search" ? (
                        <button type="button" onClick={() => save(job)} disabled={savedIds.has(job.id)} aria-label="Save job" className="shrink-0 text-white/50 hover:text-gold disabled:text-gold">
                          {savedIds.has(job.id) ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
                        </button>
                      ) : (
                        <button type="button" onClick={() => { const s = saved.find((x) => x.jobData?.id === job.id); if (s) remove(s.id); }} aria-label="Remove" className="shrink-0 text-white/50 hover:text-red-300">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {job.snippet && <p className="mt-2 line-clamp-3 text-sm text-white/70">{job.snippet}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => tailor(job)} className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white hover:-translate-y-0.5 transition-transform">
                        <Sparkles className="h-3.5 w-3.5" /> Build my resume for this
                      </button>
                      {job.url && (
                        <a href={job.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-3 py-1.5 text-xs text-cream hover:bg-white/8">
                          <ExternalLink className="h-3.5 w-3.5" /> View
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </ToolModal>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors", active ? "bg-violet/20 text-white" : "text-muted-cream hover:bg-white/5")}
    >
      {label}
    </button>
  );
}
