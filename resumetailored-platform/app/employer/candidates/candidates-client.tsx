"use client";

import { useCallback, useEffect, useState } from "react";
import { Users, Plus, Sparkles, Check, X, Mail, CalendarClock, Star, Ban } from "lucide-react";
import {
  APPLICANT_STATUSES,
  type Applicant,
  type ApplicantStatus,
  type JobPosting,
  type MatchAnalysis,
} from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Field, Input, Area, Picker, Badge, EmptyState, Modal, Drawer, ScoreChip } from "../components/ui";

const STATUS_TONE: Record<ApplicantStatus, "neutral" | "sky" | "violet" | "gold" | "teal" | "red"> = {
  new: "sky",
  reviewed: "neutral",
  shortlisted: "violet",
  interviewed: "gold",
  hired: "teal",
  rejected: "red",
};

const MESSAGE_TEMPLATES: Record<string, (name: string) => string> = {
  "Invite to interview": (n) => `Hi ${n},\n\nThanks for applying — we'd love to set up a short interview. Are you available this week? Let me know a couple of times that work and I'll send a calendar invite.\n\nBest,`,
  "Request more info": (n) => `Hi ${n},\n\nThanks for your application. Could you share a bit more about your experience with the core requirements for this role? A few specifics would help us move forward.\n\nBest,`,
  "Polite rejection": (n) => `Hi ${n},\n\nThank you for taking the time to apply. After careful review we've decided to move forward with other candidates whose experience more closely matches this role. We truly appreciate your interest and wish you the best.\n\nBest,`,
};

export function CandidatesClient({ initialJobId }: { initialJobId?: number }) {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobId, setJobId] = useState<number | "">(initialJobId ?? "");
  const [status, setStatus] = useState<ApplicantStatus | "">("");
  const [minScore, setMinScore] = useState<number | "">("");
  const [sort, setSort] = useState<"newest" | "best">("newest");
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (jobId) q.set("jobId", String(jobId));
      if (status) q.set("status", status);
      if (minScore) q.set("minScore", String(minScore));
      q.set("sort", sort);
      const res = await fetch(`/api/employer/candidates?${q.toString()}`, { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { applicants?: Applicant[] };
      setApplicants(d.applicants || []);
    } finally {
      setLoading(false);
    }
  }, [jobId, status, minScore, sort]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    fetch("/api/employer/jobs", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { jobs?: JobPosting[] }) => setJobs(d.jobs || []))
      .catch(() => {});
  }, []);

  const open = applicants.find((a) => a.id === openId) || null;

  return (
    <div>
      <PageHeader
        title="Candidates"
        subtitle="Every applicant across your roles, with AI match scoring."
        action={
          <Btn onClick={() => setAdding(true)} disabled={jobs.length === 0}>
            <Plus className="h-4 w-4" /> Add applicant
          </Btn>
        }
      />

      {/* Filters */}
      <Panel className="mb-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Job">
            <Picker value={jobId} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">All jobs</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label="Status">
            <Picker value={status} onChange={(e) => setStatus(e.target.value as ApplicantStatus | "")}>
              <option value="">Any status</option>
              {APPLICANT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label="Min match">
            <Picker value={minScore} onChange={(e) => setMinScore(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Any score</option>
              <option value={80}>80%+</option>
              <option value={60}>60%+</option>
              <option value={40}>40%+</option>
            </Picker>
          </Field>
          <Field label="Sort">
            <Picker value={sort} onChange={(e) => setSort(e.target.value as "newest" | "best")}>
              <option value="newest">Newest first</option>
              <option value="best">Best match first</option>
            </Picker>
          </Field>
        </div>
      </Panel>

      {loading ? (
        <Panel className="text-sm text-white/50">Loading candidates…</Panel>
      ) : applicants.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No candidates yet"
          body={jobs.length === 0 ? "Post a job first, then applicants will appear here." : "No applicants match these filters. Add one manually or adjust the filters."}
        />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border-gold text-left text-xs uppercase tracking-wide text-white/45">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Applied for</th>
                <th className="px-4 py-3 font-semibold">Match</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Applied</th>
              </tr>
            </thead>
            <tbody>
              {applicants.map((a) => (
                <tr key={a.id} className="cursor-pointer border-b border-border-gold/50 last:border-0 hover:bg-white/[0.03]" onClick={() => setOpenId(a.id)}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-cream">{a.name}</div>
                    <div className="text-xs text-white/45">{a.email}</div>
                  </td>
                  <td className="px-4 py-3 text-white/70">{a.jobTitle || "—"}</td>
                  <td className="px-4 py-3">
                    <ScoreChip score={a.matchScore} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-white/60">{fmtDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {open && <CandidateDrawer applicant={open} onClose={() => setOpenId(null)} onChanged={load} />}
      {adding && <AddApplicant jobs={jobs} defaultJobId={typeof jobId === "number" ? jobId : undefined} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await load(); }} />}
    </div>
  );
}

// ── Candidate detail drawer ───────────────────────────────────────────────────
function CandidateDrawer({ applicant, onClose, onChanged }: { applicant: Applicant; onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<ApplicantStatus>(applicant.status);
  const [notes, setNotes] = useState(applicant.notes);
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(applicant.matchAnalysis);
  const [scoring, setScoring] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [msgTemplate, setMsgTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function score() {
    setScoring(true);
    setError(null);
    try {
      const res = await fetch("/api/employer/match-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicantId: applicant.id, jobId: applicant.jobId, refresh: true }),
      });
      const d = (await res.json().catch(() => ({}))) as { analysis?: MatchAnalysis; error?: string };
      if (!res.ok || !d.analysis) throw new Error(d.error || "Could not score this candidate.");
      setAnalysis(d.analysis);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setScoring(false);
    }
  }

  async function updateStatus(next: ApplicantStatus) {
    setStatus(next);
    await fetch(`/api/employer/candidates/${applicant.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    onChanged();
  }
  async function saveNotes() {
    setSavingNote(true);
    try {
      await fetch(`/api/employer/candidates/${applicant.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) });
      onChanged();
    } finally {
      setSavingNote(false);
    }
  }

  const mailto = () => {
    const body = msgTemplate && MESSAGE_TEMPLATES[msgTemplate] ? MESSAGE_TEMPLATES[msgTemplate](applicant.name.split(" ")[0] || applicant.name) : "";
    window.location.href = `mailto:${applicant.email}?subject=${encodeURIComponent("Regarding your application")}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Drawer title={applicant.name} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[status]}>{status}</Badge>
          {applicant.jobTitle && <span className="text-sm text-white/60">for {applicant.jobTitle}</span>}
          <a href={`mailto:${applicant.email}`} className="text-sm text-violet hover:underline">
            {applicant.email}
          </a>
        </div>

        {/* Match analysis */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-cream">Match analysis</h3>
            <button type="button" onClick={score} disabled={scoring} className="inline-flex items-center gap-1.5 rounded-md border border-violet/40 bg-violet/10 px-2.5 py-1 text-xs font-semibold text-violet hover:bg-violet/20 disabled:opacity-50">
              <Sparkles className="h-3.5 w-3.5" /> {scoring ? "Scoring…" : analysis ? "Re-score" : "Score with AI"}
            </button>
          </div>
          {error && <p className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          {analysis ? (
            <div className="space-y-3 rounded-xl border border-border-gold bg-white/[0.03] p-4">
              <div className="flex items-center gap-3">
                <div className="text-3xl font-bold" style={{ color: analysis.score >= 66 ? "#14B8A6" : analysis.score >= 33 ? "#F59E0B" : "#f87171" }}>
                  {analysis.score}%
                </div>
                <div className="text-xs text-white/60">
                  <div>Experience: {analysis.breakdown.experienceMatch}%</div>
                  <div>Skills: {analysis.breakdown.skillsMatch}%</div>
                </div>
              </div>
              {analysis.summary && <p className="text-sm text-white/75">{analysis.summary}</p>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase text-teal">Requirements met</div>
                  <ul className="space-y-1">
                    {analysis.breakdown.requiredMet.length ? analysis.breakdown.requiredMet.map((r, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-white/75"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" /> {r}</li>
                    )) : <li className="text-xs text-white/40">—</li>}
                  </ul>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase text-red-300">Missing</div>
                  <ul className="space-y-1">
                    {analysis.breakdown.missing.length ? analysis.breakdown.missing.map((r, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-white/75"><X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" /> {r}</li>
                    )) : <li className="text-xs text-white/40">—</li>}
                  </ul>
                </div>
              </div>
              {analysis.strengths.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase text-muted-cream">Top strengths</div>
                  <ul className="space-y-0.5">{analysis.strengths.map((s, i) => <li key={i} className="text-xs text-white/75">• {s}</li>)}</ul>
                </div>
              )}
              {analysis.gaps.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase text-muted-cream">Gaps to consider</div>
                  <ul className="space-y-0.5">{analysis.gaps.map((s, i) => <li key={i} className="text-xs text-white/75">• {s}</li>)}</ul>
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-border-gold p-4 text-sm text-white/50">
              {applicant.resumeText ? "Not scored yet. Run AI scoring to see requirement-by-requirement fit." : "No resume on file for this applicant, so there's nothing to score."}
            </p>
          )}
        </section>

        {/* Resume + cover letter */}
        {applicant.resumeText && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-cream">Resume</h3>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border-gold bg-white/[0.03] p-3 text-xs text-white/70">{applicant.resumeText}</pre>
          </section>
        )}
        {applicant.coverLetter && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-cream">Cover letter</h3>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border-gold bg-white/[0.03] p-3 text-xs text-white/70">{applicant.coverLetter}</pre>
          </section>
        )}

        {/* Status + notes */}
        <section className="space-y-3">
          <Field label="Status">
            <Picker value={status} onChange={(e) => updateStatus(e.target.value as ApplicantStatus)}>
              {APPLICANT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label="Private notes">
            <Area rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes visible only to your team…" />
          </Field>
          <Btn variant="ghost" onClick={saveNotes} loading={savingNote}>
            Save notes
          </Btn>
        </section>

        {/* Actions */}
        <section className="space-y-3 border-t border-border-gold pt-4">
          <Field label="Send a message">
            <div className="flex gap-2">
              <Picker value={msgTemplate} onChange={(e) => setMsgTemplate(e.target.value)}>
                <option value="">Blank email…</option>
                {Object.keys(MESSAGE_TEMPLATES).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Picker>
              <Btn variant="ghost" onClick={mailto} className="shrink-0">
                <Mail className="h-4 w-4" /> Compose
              </Btn>
            </div>
          </Field>
          <button
            type="button"
            onClick={() => alert("Calendar scheduling is coming soon — paste a Calendly/Google link in your message for now.")}
            className="flex w-full items-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-sm text-cream hover:bg-white/[0.08]"
          >
            <CalendarClock className="h-4 w-4 text-violet" /> Schedule interview
          </button>
          <div className="flex gap-2">
            <Btn onClick={() => updateStatus("shortlisted")} className="flex-1">
              <Star className="h-4 w-4" /> Shortlist
            </Btn>
            <Btn variant="danger" onClick={() => updateStatus("rejected")} className="flex-1">
              <Ban className="h-4 w-4" /> Reject
            </Btn>
          </div>
        </section>
      </div>
    </Drawer>
  );
}

// ── Manual add applicant ──────────────────────────────────────────────────────
function AddApplicant({ jobs, defaultJobId, onClose, onSaved }: { jobs: JobPosting[]; defaultJobId?: number; onClose: () => void; onSaved: () => void }) {
  const [jobId, setJobId] = useState<number | "">(defaultJobId ?? (jobs[0]?.id ?? ""));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!jobId) return setError("Pick a job.");
    if (!name.trim() || !email.trim()) return setError("Name and email are required.");
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/employer/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, name, email, resumeText, coverLetter }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || "Could not add applicant.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Add applicant" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Job">
          <Picker value={jobId} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : "")}>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </Picker>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" />
          </Field>
          <Field label="Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@email.com" />
          </Field>
        </div>
        <Field label="Resume text" hint="Paste the resume so AI scoring can run">
          <Area rows={5} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste the candidate's resume…" />
        </Field>
        <Field label="Cover letter" hint="Optional">
          <Area rows={3} value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        <div className="flex justify-end">
          <Btn onClick={submit} loading={saving}>
            Add applicant
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
