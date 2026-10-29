"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Link2, Loader2, X, ExternalLink, Pencil, Trash2, BellOff, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { useLocale } from "next-intl";
import { Label, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from "../components/ui";
import { TRACKER_STAGES, type TrackerStage, emptyClipFieldNames, capturedLabel } from "@/lib/tracker-core";
import type { ResumeDraft } from "@/lib/draft-types";

interface TrackedNote {
  id: string;
  text: string;
  createdAt: string;
}
interface TrackedApplication {
  id: string;
  jobTitle: string;
  company: string;
  location: string | null;
  postingUrl: string | null;
  description: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  source: "manual" | "clip_url" | "share_target" | "our_job";
  sourceJobId: number | null;
  stage: TrackerStage;
  stageChangedAt: string;
  notes: TrackedNote[];
  nudgesOff: boolean;
  lastVerifiedAt: string | null;
  archived: boolean;
}
interface DueNudge {
  applicationId: string;
  jobTitle: string;
  company: string;
  stage: TrackerStage;
  daysDwelling: number;
  message: string;
}
interface AtsHistoryEntry {
  id: string;
  score: number;
  verdict: string;
  resumeLabel: string | null;
  runAt: string;
}
interface RealStatus {
  status: string;
  statusChangedAt: string;
  label: string;
}

const STAGE_TONE: Record<TrackerStage, string> = {
  Clipped: "border-l-white/25",
  Applied: "border-l-violet/60",
  Interviewing: "border-l-gold/60",
  Offer: "border-l-teal/60",
  Rejected: "border-l-red-500/50",
  Withdrawn: "border-l-white/15",
};

export function TrackerBoard() {
  const t = useTranslations("tracker");
  const locale = useLocale();
  const tRef = useRef(t);
  tRef.current = t;

  const [apps, setApps] = useState<TrackedApplication[] | null>(null);
  const [nudges, setNudges] = useState<DueNudge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clipping, setClipping] = useState(false);
  const [clipUrl, setClipUrl] = useState("");
  const [clipError, setClipError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TrackedApplication | null>(null);
  const [dragOverStage, setDragOverStage] = useState<TrackerStage | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/tracker", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { applications?: TrackedApplication[]; error?: string };
      if (!res.ok) throw new Error(data.error || tRef.current("errors.load"));
      setApps(data.applications || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : tRef.current("errors.generic"));
      setApps([]);
    }
  }, []);

  const loadNudges = useCallback(async () => {
    try {
      const res = await fetch("/api/tracker/nudges", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { nudges?: DueNudge[] };
      setNudges(data.nudges || []);
    } catch {
      /* non-critical — the board still works without nudges */
    }
  }, []);

  useEffect(() => {
    load();
    loadNudges();
  }, [load, loadNudges]);

  async function dismissNudge(applicationId: string) {
    setNudges((cur) => cur.filter((n) => n.applicationId !== applicationId));
    await fetch("/api/tracker/nudges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }) });
  }

  async function submitClip() {
    const url = clipUrl.trim();
    if (!url) return;
    setClipping(true);
    setClipError(null);
    try {
      const res = await fetch("/api/tracker/clip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const data = (await res.json().catch(() => ({}))) as { application?: TrackedApplication; error?: string };
      if (!res.ok || !data.application) throw new Error(data.error || t("errors.clipFailed"));
      setApps((cur) => [data.application!, ...(cur || [])]);
      setClipUrl("");
    } catch (e) {
      setClipError(e instanceof Error ? e.message : t("errors.clipFailed"));
    } finally {
      setClipping(false);
    }
  }

  async function moveStage(id: string, stage: TrackerStage) {
    setApps((cur) => (cur ? cur.map((a) => (a.id === id ? { ...a, stage } : a)) : cur));
    const res = await fetch(`/api/tracker/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) });
    if (!res.ok) load(); // revert to server truth on failure
  }

  function onDrop(stage: TrackerStage, e: React.DragEvent) {
    e.preventDefault();
    setDragOverStage(null);
    const id = e.dataTransfer.getData("text/plain");
    const app = (apps || []).find((a) => a.id === id);
    if (app && app.stage !== stage) moveStage(id, stage);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 pb-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-medium text-white sm:text-3xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-white/55">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <SecondaryButton onClick={() => setClipping(true)}>
            <Link2 className="h-4 w-4" /> {t("clipButton")}
          </SecondaryButton>
          <PrimaryButton onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("addButton")}
          </PrimaryButton>
        </div>
      </header>

      {nudges.length > 0 && (
        <div className="space-y-2">
          {nudges.map((n) => (
            <div key={n.applicationId} className="flex items-center justify-between gap-3 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-cream">
              <span>{n.message}</span>
              <button type="button" onClick={() => dismissNudge(n.applicationId)} className="shrink-0 text-xs font-semibold text-white/60 hover:text-cream">
                {t("nudgeDismiss")}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      {clipping && (
        <Overlay onClose={() => { setClipping(false); setClipError(null); setClipUrl(""); }}>
          <h3 className="font-serif text-lg text-white">{t("clipTitle")}</h3>
          <p className="mt-1 text-sm text-white/55">{t("clipHint")}</p>
          <div className="mt-3">
            <TextInput value={clipUrl} onChange={(e) => setClipUrl(e.target.value)} placeholder="https://…" autoFocus />
          </div>
          {clipError && <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{clipError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <SecondaryButton onClick={() => { setClipping(false); setClipError(null); setClipUrl(""); }}>{t("cancel")}</SecondaryButton>
            <PrimaryButton onClick={submitClip} loading={clipping && !clipError}>{t("clipSubmit")}</PrimaryButton>
          </div>
        </Overlay>
      )}

      {apps === null ? (
        <div className="flex items-center justify-center py-20 text-white/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
          {TRACKER_STAGES.map((stage) => {
            const list = apps.filter((a) => a.stage === stage && !a.archived);
            return (
              <section
                key={stage}
                className={cn("w-[260px] shrink-0 rounded-xl p-1.5 transition-colors", dragOverStage === stage ? "bg-white/5" : "")}
                onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage); }}
                onDragLeave={() => setDragOverStage((cur) => (cur === stage ? null : cur))}
                onDrop={(e) => onDrop(stage, e)}
              >
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">{t(`stages.${stage}`)}</h2>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70">{list.length}</span>
                </div>
                <div className="space-y-2.5">
                  {list.map((app) => (
                    <TrackerCard key={app.id} app={app} locale={locale} onOpen={() => setEditing(app)} />
                  ))}
                  {list.length === 0 && <p className="px-1 py-6 text-center text-xs text-white/30">{t("columnEmpty")}</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {(adding || editing) && (
        <TrackerForm
          initial={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(saved) => {
            setApps((cur) => {
              const list = cur ? [...cur] : [];
              const i = list.findIndex((x) => x.id === saved.id);
              if (i >= 0) list[i] = saved;
              else list.unshift(saved);
              return list;
            });
            setAdding(false);
            setEditing(null);
          }}
          onDeleted={(id) => {
            setApps((cur) => (cur ? cur.filter((x) => x.id !== id) : cur));
            setEditing(null);
          }}
        />
      )}
    </div>
  );

  function formatSalary(min: number | null, max: number | null): string {
    if (min === null && max === null) return "";
    if (min !== null && max !== null && min !== max) return `${formatMoney(min, locale, { compact: true })}–${formatMoney(max, locale, { compact: true })}`;
    return formatMoney((min ?? max) as number, locale, { compact: true });
  }

  function TrackerCard({ app, onOpen }: { app: TrackedApplication; locale: string; onOpen: () => void }) {
    const captured = capturedLabel(app.lastVerifiedAt);
    const missing = emptyClipFieldNames({
      jobTitle: app.jobTitle,
      company: app.company,
      location: app.location || "",
      description: app.description || "",
      salaryMin: app.salaryMin,
      salaryMax: app.salaryMax,
    });
    const salary = formatSalary(app.salaryMin, app.salaryMax);
    return (
      <div
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", app.id)}
        onClick={onOpen}
        className={cn("cursor-pointer rounded-xl border-l-2 border border-border-gold bg-white/[0.03] p-3.5 transition-colors hover:bg-white/[0.06]", STAGE_TONE[app.stage])}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-cream">{app.jobTitle || t("untitledRole")}</div>
          <div className="truncate text-xs text-white/60">{app.company || t("unknownCompany")}</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/45">
          {app.location && <span>{app.location}</span>}
          {salary && <span>{salary}</span>}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            {app.source !== "manual" && captured && <span>{t("capturedOn", { date: captured })}</span>}
            {app.nudgesOff && <BellOff className="h-3 w-3" />}
          </div>
          {missing.length > 0 && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold">{t("fillThisIn")}</span>}
        </div>
      </div>
    );
  }
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border-gold bg-navy p-5 shadow-2xl">{children}</div>
    </div>
  );
}

interface TrackerFormFields {
  jobTitle: string;
  company: string;
  location: string;
  postingUrl: string;
  description: string;
  salaryMin: number | null;
  salaryMax: number | null;
}

const EMPTY: TrackerFormFields = {
  jobTitle: "",
  company: "",
  location: "",
  postingUrl: "",
  description: "",
  salaryMin: null,
  salaryMax: null,
};

function TrackerForm({
  initial,
  onClose,
  onSaved,
  onDeleted,
}: {
  initial: TrackedApplication | null;
  onClose: () => void;
  onSaved: (a: TrackedApplication) => void;
  onDeleted: (id: string) => void;
}) {
  const t = useTranslations("tracker");
  const [form, setForm] = useState<TrackerFormFields>(
    initial
      ? { jobTitle: initial.jobTitle, company: initial.company, location: initial.location || "", postingUrl: initial.postingUrl || "", description: initial.description || "", salaryMin: initial.salaryMin, salaryMax: initial.salaryMax }
      : EMPTY
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [notes, setNotes] = useState<TrackedNote[]>(initial?.notes || []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nudgesOff, setNudgesOff] = useState(!!initial?.nudgesOff);
  const [realStatus, setRealStatus] = useState<RealStatus | null>(null);
  const [atsHistory, setAtsHistory] = useState<AtsHistoryEntry[]>([]);
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [scoring, setScoring] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!initial) return;
    fetch(`/api/tracker/${initial.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { realStatus?: RealStatus | null }) => setRealStatus(d.realStatus || null))
      .catch(() => {});
    fetch(`/api/tracker/${initial.id}/ats-score`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { history?: AtsHistoryEntry[] }) => setAtsHistory(d.history || []))
      .catch(() => {});
    fetch("/api/resumes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || []))
      .catch(() => {});
  }, [initial]);

  async function save() {
    if (!form.jobTitle.trim() && !form.company.trim()) {
      setErr(t("errors.required"));
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const url = initial ? `/api/tracker/${initial.id}` : "/api/tracker";
      const res = await fetch(url, {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, nudgesOff: initial ? nudgesOff : undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { application?: TrackedApplication; error?: string };
      if (!res.ok || !data.application) throw new Error(data.error || t("errors.save"));
      onSaved(data.application);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    if (!initial || !noteText.trim()) return;
    const res = await fetch(`/api/tracker/${initial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: noteText }) });
    const data = (await res.json().catch(() => ({}))) as { application?: TrackedApplication };
    if (data.application) {
      setNotes(data.application.notes);
      setNoteText("");
    }
  }

  async function runAtsScan() {
    if (!initial || !resumeId) return;
    const resume = resumes.find((r) => r.id === resumeId);
    if (!resume) return;
    setScoring(true);
    try {
      const res = await fetch(`/api/tracker/${initial.id}/ats-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: resume.content.result || resume.content.resumeText, resumeId: resume.id, resumeLabel: resume.title, jobPosting: form.description }),
      });
      const data = (await res.json().catch(() => ({}))) as { entry?: AtsHistoryEntry; error?: string };
      if (res.ok && data.entry) setAtsHistory((cur) => [data.entry!, ...cur]);
      else setErr(data.error || t("errors.atsFailed"));
    } finally {
      setScoring(false);
    }
  }

  async function remove() {
    if (!initial) return;
    await fetch(`/api/tracker/${initial.id}`, { method: "DELETE" });
    onDeleted(initial.id);
  }

  return (
    <Overlay onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-serif text-lg text-white">{initial ? t("form.editTitle") : t("addButton")}</h3>
        <button type="button" onClick={onClose} aria-label={t("close")} className="text-white/50 hover:text-cream"><X className="h-5 w-5" /></button>
      </div>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        {initial?.source === "our_job" && (
          <p className="rounded-lg border border-violet/30 bg-violet/10 px-3 py-2 text-xs text-violet">{t("ourJobBadge")}</p>
        )}
        {realStatus && (
          <p className="rounded-lg border border-teal/30 bg-teal/10 px-3 py-2 text-xs text-teal">{t("realStatus", { status: realStatus.status, label: realStatus.label })}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("form.jobTitle")}</Label><TextInput value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} /></div>
          <div><Label>{t("form.company")}</Label><TextInput value={form.company} onChange={(e) => set("company", e.target.value)} /></div>
          <div><Label>{t("form.location")}</Label><TextInput value={form.location} onChange={(e) => set("location", e.target.value)} /></div>
          <div><Label>{t("form.postingUrl")}</Label><TextInput value={form.postingUrl} onChange={(e) => set("postingUrl", e.target.value)} placeholder="https://…" /></div>
          <div><Label>{t("form.salaryMin")}</Label><TextInput value={form.salaryMin ?? ""} onChange={(e) => set("salaryMin", e.target.value ? Number(e.target.value) : null)} inputMode="numeric" /></div>
          <div><Label>{t("form.salaryMax")}</Label><TextInput value={form.salaryMax ?? ""} onChange={(e) => set("salaryMax", e.target.value ? Number(e.target.value) : null)} inputMode="numeric" /></div>
        </div>
        <div><Label>{t("form.description")}</Label><TextArea rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
        {form.postingUrl && <a href={form.postingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-violet hover:underline"><ExternalLink className="h-3 w-3" /> {t("form.openPosting")}</a>}

        {initial && (
          <>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-white/60">
              <input type="checkbox" checked={nudgesOff} onChange={(e) => setNudgesOff(e.target.checked)} className="h-4 w-4 accent-violet" />
              {t("form.nudgesOff")}
            </label>

            <div className="rounded-lg border border-border-gold bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/60"><Pencil className="h-3.5 w-3.5" /> {t("notesTitle")}</div>
              <div className="space-y-2">
                {notes.map((n) => (
                  <p key={n.id} className="rounded-md bg-white/5 px-2.5 py-1.5 text-xs text-white/75">{n.text}</p>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <TextInput value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("notePlaceholder")} />
                <SecondaryButton onClick={addNote} className="px-3 py-2 text-xs">{t("addNote")}</SecondaryButton>
              </div>
            </div>

            <div className="rounded-lg border border-border-gold bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/60"><History className="h-3.5 w-3.5" /> {t("atsTitle")}</div>
              <div className="flex gap-2">
                <Select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                  <option value="">{t("form.selectResume")}</option>
                  {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </Select>
                <SecondaryButton onClick={runAtsScan} className="px-3 py-2 text-xs" disabled={!resumeId || scoring}>{scoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("runScan")}</SecondaryButton>
              </div>
              <div className="mt-2 space-y-1">
                {atsHistory.map((h) => (
                  <p key={h.id} className="text-xs text-white/60">{t("atsEntry", { score: h.score, label: h.resumeLabel || "" })}</p>
                ))}
                {atsHistory.length === 0 && <p className="text-xs text-white/30">{t("atsEmpty")}</p>}
              </div>
            </div>
          </>
        )}

        {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</p>}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border-gold pt-4">
        {initial ? (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/60">{t("confirmDelete")}</span>
              <button type="button" onClick={remove} className="rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500">{t("delete")}</button>
              <SecondaryButton onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs">{t("cancel")}</SecondaryButton>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/50 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /> {t("delete")}</button>
          )
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <SecondaryButton onClick={onClose}>{t("cancel")}</SecondaryButton>
          <PrimaryButton onClick={save} loading={saving}>{initial ? t("form.save") : t("addButton")}</PrimaryButton>
        </div>
      </div>
    </Overlay>
  );
}
