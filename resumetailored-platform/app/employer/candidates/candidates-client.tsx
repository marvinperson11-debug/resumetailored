"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Users, UserCheck, Plus, Sparkles, Check, X, Mail, MessageSquare, CalendarClock, Star, Ban, FileSignature } from "lucide-react";
import {
  APPLICANT_STATUSES,
  type Applicant,
  type ApplicantStatus,
  type JobPosting,
  type MatchAnalysis,
} from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Field, Input, Area, Picker, Badge, EmptyState, Modal, Drawer, ScoreChip, QuotaBar, UpgradeCard } from "../components/ui";
import { SendDocumentModal } from "../components/send-document-modal";

const STATUS_TONE: Record<ApplicantStatus, "neutral" | "sky" | "violet" | "gold" | "teal" | "red"> = {
  new: "sky",
  reviewed: "neutral",
  shortlisted: "violet",
  interviewed: "gold",
  "offer extended": "gold",
  hired: "teal",
  rejected: "red",
};

// Mailto composer templates. `id` keys the translated label/body lookup
// (t(`mailtoTemplates.${id}.label`) / t(`mailtoTemplates.${id}.body`, {name})).
const MAILTO_TEMPLATE_IDS = ["inviteToInterview", "requestMoreInfo", "politeRejection"] as const;

export function CandidatesClient({ initialJobId, pipelineLimit = null }: { initialJobId?: number; pipelineLimit?: number | null }) {
  const t = useTranslations("employerCandidates");
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobId, setJobId] = useState<number | "">(initialJobId ?? "");
  const [status, setStatus] = useState<ApplicantStatus | "">("");
  const [minScore, setMinScore] = useState<number | "">("");
  const [sort, setSort] = useState<"newest" | "best">("newest");
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  // Total pipeline size for the quota counter — independent of the table's own
  // filters (jobId/status/minScore), which would otherwise undercount it.
  const [pipelineUsed, setPipelineUsed] = useState(0);
  const loadPipelineCount = useCallback(async () => {
    if (pipelineLimit === null) return;
    try {
      const res = await fetch("/api/employer/candidates", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { applicants?: Applicant[] };
      setPipelineUsed((d.applicants || []).filter((a) => a.status !== "rejected").length);
    } catch {
      /* best-effort */
    }
  }, [pipelineLimit]);
  useEffect(() => {
    loadPipelineCount();
  }, [loadPipelineCount]);

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
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Btn onClick={() => setAdding(true)} disabled={jobs.length === 0}>
            <Plus className="h-4 w-4" /> {t("addApplicant")}
          </Btn>
        }
      />

      {pipelineLimit !== null && (
        <QuotaBar kind="candidates" used={pipelineUsed} limit={pipelineLimit} nextTierLabel="Employer Portal" />
      )}

      {/* Filters */}
      <Panel className="mb-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t("fieldJob")}>
            <Picker value={jobId} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">{t("allJobs")}</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label={t("fieldStatus")}>
            <Picker value={status} onChange={(e) => setStatus(e.target.value as ApplicantStatus | "")}>
              <option value="">{t("anyStatus")}</option>
              {APPLICANT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`applicantStatus.${s}`)}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label={t("fieldMinMatch")}>
            <Picker value={minScore} onChange={(e) => setMinScore(e.target.value ? Number(e.target.value) : "")}>
              <option value="">{t("anyScore")}</option>
              <option value={80}>80%+</option>
              <option value={60}>60%+</option>
              <option value={40}>40%+</option>
            </Picker>
          </Field>
          <Field label={t("fieldSort")}>
            <Picker value={sort} onChange={(e) => setSort(e.target.value as "newest" | "best")}>
              <option value="newest">{t("sortNewest")}</option>
              <option value="best">{t("sortBestMatch")}</option>
            </Picker>
          </Field>
        </div>
      </Panel>

      {loading ? (
        <Panel className="text-sm text-white/50">{t("loadingCandidates")}</Panel>
      ) : applicants.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("emptyStateTitle")}
          body={jobs.length === 0 ? t("emptyStateBodyNoJobs") : t("emptyStateBodyNoMatch")}
        />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border-gold text-left text-xs uppercase tracking-wide text-white/45">
                <th className="px-4 py-3 font-semibold">{t("colName")}</th>
                <th className="px-4 py-3 font-semibold">{t("colAppliedFor")}</th>
                <th className="px-4 py-3 font-semibold">{t("colMatch")}</th>
                <th className="px-4 py-3 font-semibold">{t("colStatus")}</th>
                <th className="px-4 py-3 font-semibold">{t("colApplied")}</th>
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
                    <Badge tone={STATUS_TONE[a.status]}>{t(`applicantStatus.${a.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-white/60">{fmtDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {open && <CandidateDrawer applicant={open} onClose={() => setOpenId(null)} onChanged={load} />}
      {adding && (
        <AddApplicant
          jobs={jobs}
          defaultJobId={typeof jobId === "number" ? jobId : undefined}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await Promise.all([load(), loadPipelineCount()]);
          }}
        />
      )}

      <UpgradeCard />
    </div>
  );
}

// ── Candidate detail drawer ───────────────────────────────────────────────────
function CandidateDrawer({ applicant, onClose, onChanged }: { applicant: Applicant; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations("employerCandidates");
  const [status, setStatus] = useState<ApplicantStatus>(applicant.status);
  const [notes, setNotes] = useState(applicant.notes);
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(applicant.matchAnalysis);
  const [scoring, setScoring] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [msgTemplate, setMsgTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showOffer, setShowOffer] = useState(false);
  const [empState, setEmpState] = useState<"idle" | "adding" | "added" | "error">("idle");

  // Lifecycle hook: turn a hired candidate into an employee, prefilled from the
  // applicant record (name/email/role). One-click; safe to run once.
  async function addAsEmployee() {
    setEmpState("adding");
    const res = await fetch("/api/employer/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: applicant.name, email: applicant.email, role: applicant.jobTitle || "", status: "active" }),
    });
    setEmpState(res.ok ? "added" : "error");
  }

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
      if (!res.ok || !d.analysis) throw new Error(d.error || t("errorCouldNotScore"));
      setAnalysis(d.analysis);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
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
    const body = msgTemplate ? t(`mailtoTemplates.${msgTemplate}.body`, { name: applicant.name.split(" ")[0] || applicant.name }) : "";
    window.location.href = `mailto:${applicant.email}?subject=${encodeURIComponent(t("emailSubject"))}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Drawer title={applicant.name} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[status]}>{t(`applicantStatus.${status}`)}</Badge>
          {applicant.jobTitle && <span className="text-sm text-white/60">{t("forJobTitle", { jobTitle: applicant.jobTitle })}</span>}
          <a href={`mailto:${applicant.email}`} className="text-sm text-violet hover:underline">
            {applicant.email}
          </a>
        </div>

        {/* Pinned action row — always visible at the top, no scrolling needed. */}
        <section className="space-y-2 rounded-xl border border-border-gold bg-white/[0.03] p-3">
          <Btn onClick={() => setShowOffer(true)} className="w-full">
            <FileSignature className="h-4 w-4" /> {t("sendDocument")}
          </Btn>
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => updateStatus("shortlisted")}>
              <Star className="h-4 w-4" /> {t("shortlist")}
            </Btn>
            <Btn variant="danger" onClick={() => updateStatus("rejected")}>
              <Ban className="h-4 w-4" /> {t("reject")}
            </Btn>
            <Link
              href={`/employer/messages?applicantId=${applicant.id}`}
              className="flex items-center justify-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2 text-sm font-semibold text-cream hover:bg-white/[0.08]"
            >
              <MessageSquare className="h-4 w-4 text-violet" /> {t("message")}
            </Link>
            <Link
              href={`/employer/scheduler?applicantId=${applicant.id}`}
              className="flex items-center justify-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2 text-sm font-semibold text-cream hover:bg-white/[0.08]"
            >
              <CalendarClock className="h-4 w-4 text-violet" /> {t("schedule")}
            </Link>
          </div>
        </section>

        {/* Match analysis */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-cream">{t("matchAnalysis")}</h3>
            <button type="button" onClick={score} disabled={scoring} className="inline-flex items-center gap-1.5 rounded-md border border-violet/40 bg-violet/10 px-2.5 py-1 text-xs font-semibold text-violet hover:bg-violet/20 disabled:opacity-50">
              <Sparkles className="h-3.5 w-3.5" /> {scoring ? t("scoring") : analysis ? t("reScore") : t("scoreWithAi")}
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
                  <div>{t("experienceLabel")}: {analysis.breakdown.experienceMatch}%</div>
                  <div>{t("skillsLabel")}: {analysis.breakdown.skillsMatch}%</div>
                </div>
              </div>
              {analysis.summary && <p className="text-sm text-white/75">{analysis.summary}</p>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase text-teal">{t("requirementsMet")}</div>
                  <ul className="space-y-1">
                    {analysis.breakdown.requiredMet.length ? analysis.breakdown.requiredMet.map((r, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-white/75"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" /> {r}</li>
                    )) : <li className="text-xs text-white/40">—</li>}
                  </ul>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase text-red-300">{t("missing")}</div>
                  <ul className="space-y-1">
                    {analysis.breakdown.missing.length ? analysis.breakdown.missing.map((r, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-white/75"><X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" /> {r}</li>
                    )) : <li className="text-xs text-white/40">—</li>}
                  </ul>
                </div>
              </div>
              {analysis.strengths.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase text-muted-cream">{t("topStrengths")}</div>
                  <ul className="space-y-0.5">{analysis.strengths.map((s, i) => <li key={i} className="text-xs text-white/75">• {s}</li>)}</ul>
                </div>
              )}
              {analysis.gaps.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase text-muted-cream">{t("gapsToConsider")}</div>
                  <ul className="space-y-0.5">{analysis.gaps.map((s, i) => <li key={i} className="text-xs text-white/75">• {s}</li>)}</ul>
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-border-gold p-4 text-sm text-white/50">
              {applicant.resumeText ? t("notScoredYet") : t("noResumeToScore")}
            </p>
          )}
        </section>

        {/* Resume + cover letter */}
        {applicant.resumeText && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-cream">{t("resume")}</h3>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border-gold bg-white/[0.03] p-3 text-xs text-white/70">{applicant.resumeText}</pre>
          </section>
        )}
        {applicant.coverLetter && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-cream">{t("coverLetter")}</h3>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border-gold bg-white/[0.03] p-3 text-xs text-white/70">{applicant.coverLetter}</pre>
          </section>
        )}

        {/* Status + notes */}
        <section className="space-y-3">
          <Field label={t("fieldStatus")}>
            <Picker value={status} onChange={(e) => updateStatus(e.target.value as ApplicantStatus)}>
              {APPLICANT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`applicantStatus.${s}`)}
                </option>
              ))}
            </Picker>
          </Field>
          {status === "hired" && (
            <div className="rounded-lg border border-teal/40 bg-teal/10 p-3">
              {empState === "added" ? (
                <p className="flex items-center gap-2 text-sm text-teal">
                  <UserCheck className="h-4 w-4" /> {t("addedToEmployees")}
                </p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-cream">{t("hiredAddToWorkforce", { firstName: applicant.name.split(" ")[0] })}</p>
                  <Btn onClick={addAsEmployee} loading={empState === "adding"}>
                    <UserCheck className="h-4 w-4" /> {t("addAsEmployee")}
                  </Btn>
                </div>
              )}
              {empState === "error" && <p className="mt-2 text-xs text-red-300">{t("errorCouldNotAddEmployee")}</p>}
            </div>
          )}
          <Field label={t("fieldPrivateNotes")}>
            <Area rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("placeholderNotes")} />
          </Field>
          <Btn variant="ghost" onClick={saveNotes} loading={savingNote}>
            {t("saveNotes")}
          </Btn>
        </section>

        {/* Actions */}
        {/* Email composer lives with the details below the pinned actions. */}
        <section className="space-y-3 border-t border-border-gold pt-4">
          <Field label={t("fieldSendEmail")}>
            <div className="flex gap-2">
              <Picker value={msgTemplate} onChange={(e) => setMsgTemplate(e.target.value)}>
                <option value="">{t("blankEmail")}</option>
                {MAILTO_TEMPLATE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`mailtoTemplates.${id}.label`)}
                  </option>
                ))}
              </Picker>
              <Btn variant="ghost" onClick={mailto} className="shrink-0">
                <Mail className="h-4 w-4" /> {t("compose")}
              </Btn>
            </div>
          </Field>
        </section>
      </div>
      {showOffer && (
        <SendDocumentModal
          applicantId={applicant.id}
          candidateName={applicant.name}
          candidateEmail={applicant.email}
          defaultPosition={applicant.jobTitle}
          onClose={() => setShowOffer(false)}
          onSent={onChanged}
        />
      )}
    </Drawer>
  );
}

// ── Reusable resume/cover source field: paste · upload · generate ─────────────
function DocSourceField({
  label,
  kind,
  value,
  onChange,
  name,
  jobId,
  rows,
  hint,
}: {
  label: string;
  kind: "resume" | "cover";
  value: string;
  onChange: (v: string) => void;
  name: string;
  jobId: number | "";
  rows: number;
  hint?: string;
}) {
  const t = useTranslations("employerCandidates");
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [busy, setBusy] = useState<false | "upload" | "ai">(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy("upload");
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch("/api/employer/candidates/extract", { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !d.text) setErr(d.error || t("errorCouldNotReadFile"));
      else onChange(d.text);
    } catch {
      setErr(t("errorUploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy("ai");
    setErr(null);
    try {
      const res = await fetch("/api/employer/candidates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name, jobId: jobId || undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !d.text) setErr(d.error || t("errorCouldNotGenerate"));
      else onChange(d.text);
    } catch {
      setErr(t("errorGenerationFailed"));
    } finally {
      setBusy(false);
    }
  }

  const seg = (m: "paste" | "upload", text: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
        mode === m ? "bg-violet text-white" : "border border-border-gold bg-white/[0.03] text-muted-cream hover:bg-white/[0.08]"
      }`}
    >
      {text}
    </button>
  );

  return (
    <Field label={label} hint={hint}>
      <div className="mb-2 flex items-center gap-2">
        {seg("paste", t("pasteText"))}
        {seg("upload", t("uploadFile"))}
        <button
          type="button"
          onClick={generate}
          disabled={!!busy}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-violet/40 bg-violet/10 px-2.5 py-1 text-xs font-semibold text-violet hover:bg-violet/20 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" /> {busy === "ai" ? t("generating") : t("generateWithAi")}
        </button>
      </div>
      {mode === "upload" && (
        <div className="mb-2">
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            disabled={busy === "upload"}
            onChange={(e) => onFile(e.target.files?.[0])}
            className="block w-full text-xs text-muted-cream file:mr-3 file:rounded-md file:border-0 file:bg-violet/20 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-violet hover:file:bg-violet/30"
          />
          <p className="mt-1 text-[11px] text-white/40">{busy === "upload" ? t("readingFile") : t("fileHint")}</p>
        </div>
      )}
      <Area rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={kind === "resume" ? t("placeholderPasteResume") : t("placeholderPasteCoverLetter")} />
      {err && <p className="mt-1 text-xs text-red-300">{err}</p>}
    </Field>
  );
}

// ── Manual add applicant ──────────────────────────────────────────────────────
function AddApplicant({ jobs, defaultJobId, onClose, onSaved }: { jobs: JobPosting[]; defaultJobId?: number; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("employerCandidates");
  const [jobId, setJobId] = useState<number | "">(defaultJobId ?? (jobs[0]?.id ?? ""));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!jobId) return setError(t("errorPickJob"));
    if (!name.trim() || !email.trim()) return setError(t("errorNameEmailRequired"));
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/employer/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, name, email, resumeText, coverLetter }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || t("errorCouldNotAddApplicant"));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
      setSaving(false);
    }
  }

  return (
    <Modal title={t("addApplicant")} onClose={onClose}>
      <div className="space-y-4">
        <Field label={t("fieldJob")}>
          <Picker value={jobId} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : "")}>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </Picker>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("fieldName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" />
          </Field>
          <Field label={t("fieldEmail")}>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@email.com" />
          </Field>
        </div>
        <DocSourceField
          label={t("resume")}
          kind="resume"
          value={resumeText}
          onChange={setResumeText}
          name={name}
          jobId={jobId}
          rows={5}
          hint={t("hintResume")}
        />
        <DocSourceField
          label={t("coverLetter")}
          kind="cover"
          value={coverLetter}
          onChange={setCoverLetter}
          name={name}
          jobId={jobId}
          rows={3}
          hint={t("optional")}
        />
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        <div className="flex justify-end">
          <Btn onClick={submit} loading={saving}>
            {t("addApplicant")}
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
