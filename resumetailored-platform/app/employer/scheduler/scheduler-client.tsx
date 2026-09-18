"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Plus, Video, Phone, MapPin, Check, X, Pencil, Trash2, Download, FileText, Circle, Sparkles } from "lucide-react";
import {
  INTERVIEW_MODES,
  RECOMMENDATION_LABELS,
  type Interview,
  type InterviewMode,
  type InterviewStatus,
  type InterviewRecommendation,
  type Applicant,
} from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Field, Input, Area, Picker, Badge, EmptyState, Modal } from "../components/ui";
import { cn } from "@/lib/utils";

export interface SchedulerGating {
  tier: string;
  canRecord: boolean;
  canSummary: boolean;
  videoUsed: number;
  videoLimit: number | null; // null = unlimited
  videoRemaining: number | null;
  videoAllowed: boolean;
}

const MODE_ICON = { video: Video, phone: Phone, onsite: MapPin } as const;
const MODE_LABEL = { video: "Video call", phone: "Phone", onsite: "On-site" } as const;
const STATUS_TONE: Record<InterviewStatus, "sky" | "teal" | "neutral"> = { scheduled: "sky", completed: "teal", cancelled: "neutral" };
const REC_TONE: Record<InterviewRecommendation, "teal" | "sky" | "gold" | "red"> = {
  strong_yes: "teal",
  yes: "sky",
  mixed: "gold",
  no: "red",
};

export function SchedulerClient({ initialApplicantId, gating }: { initialApplicantId?: number; gating: SchedulerGating }) {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"upcoming" | "past" | "all">("upcoming");
  const [scheduling, setScheduling] = useState(!!initialApplicantId);
  const [editing, setEditing] = useState<Interview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employer/interviews", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { interviews?: Interview[] };
      setInterviews(d.interviews || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const now = Date.now();
  const shown = interviews
    .filter((i) => {
      const t = new Date(i.scheduledAt).getTime();
      if (view === "upcoming") return i.status !== "cancelled" && t >= now - 60 * 60 * 1000;
      if (view === "past") return t < now - 60 * 60 * 1000 || i.status !== "scheduled";
      return true;
    })
    .sort((a, b) => {
      const ta = new Date(a.scheduledAt).getTime();
      const tb = new Date(b.scheduledAt).getTime();
      return view === "past" ? tb - ta : ta - tb;
    });

  async function patch(id: number, body: Record<string, unknown>) {
    // Surface failures instead of silently reloading (a failed PATCH used to
    // look like "the page refreshed but nothing changed").
    try {
      const res = await fetch(`/api/employer/interviews/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setNotice(d.error || "Couldn't update the interview. Please try again.");
      }
    } catch {
      setNotice("Couldn't update the interview (network error).");
    }
    load();
  }
  async function del(id: number) {
    try {
      const res = await fetch(`/api/employer/interviews/${id}`, { method: "DELETE" });
      if (!res.ok) setNotice("Couldn't delete the interview. Please try again.");
    } catch {
      setNotice("Couldn't delete the interview (network error).");
    }
    load();
  }

  return (
    <div>
      <PageHeader
        title="Interview Scheduler"
        subtitle="Plan and track interviews with your candidates."
        action={
          <Btn onClick={() => setScheduling(true)}>
            <Plus className="h-4 w-4" /> Schedule interview
          </Btn>
        }
      />

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 text-gold/70 hover:text-gold">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {gating.videoLimit !== null && (
        <p className="mb-4 text-xs text-white/45">
          Video interviews this month: <span className="text-white/70">{gating.videoUsed}</span>
          {" / "}
          {gating.videoLimit} ({gating.tier} plan)
          {!gating.canRecord && " · recording is a Portal+ feature"}
          {gating.canRecord && !gating.canSummary && " · AI summaries are a Scale+ feature"}
        </p>
      )}

      <div className="mb-4 flex gap-1 text-sm">
        {(["upcoming", "past", "all"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "rounded-lg px-3 py-1.5 font-semibold capitalize transition-colors",
              view === v ? "bg-violet/20 text-cream" : "text-white/55 hover:bg-white/5"
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {loading ? (
        <Panel className="text-sm text-white/50">Loading interviews…</Panel>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={view === "upcoming" ? "No upcoming interviews" : "No interviews"}
          body="Schedule an interview with a candidate to see it here."
          action={
            <Btn onClick={() => setScheduling(true)}>
              <Plus className="h-4 w-4" /> Schedule interview
            </Btn>
          }
        />
      ) : (
        <div className="space-y-3">
          {shown.map((i) => (
            <InterviewCard
              key={i.id}
              interview={i}
              onEdit={() => setEditing(i)}
              hasSummaryTier={gating.canSummary}
              onComplete={() => patch(i.id, { status: "completed" })}
              onCancel={() => patch(i.id, { status: "cancelled" })}
              onReopen={() => patch(i.id, { status: "scheduled" })}
              onDelete={() => del(i.id)}
            />
          ))}
        </div>
      )}

      {scheduling && (
        <InterviewForm
          initialApplicantId={initialApplicantId}
          gating={gating}
          onClose={() => setScheduling(false)}
          onSaved={async (warning) => {
            setScheduling(false);
            setNotice(warning || null);
            await load();
          }}
        />
      )}
      {editing && (
        <InterviewForm
          existing={editing}
          gating={gating}
          onClose={() => setEditing(null)}
          onSaved={async (warning) => {
            setEditing(null);
            setNotice(warning || null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function InterviewCard({
  interview: i,
  onEdit,
  onComplete,
  onCancel,
  onReopen,
  onDelete,
  hasSummaryTier,
}: {
  interview: Interview;
  onEdit: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onReopen: () => void;
  onDelete: () => void;
  hasSummaryTier: boolean;
}) {
  const Icon = MODE_ICON[i.mode];
  const joinUrl = i.roomUrl || (i.mode === "video" && /^https?:\/\//i.test(i.location) ? i.location : "");
  const isLink = !!joinUrl;
  // For our own Daily rooms, the host joins through the server join route, which
  // mints an owner token that auto-starts cloud recording (a plain room URL
  // never starts recording). A manual meeting link is opened directly.
  const joinHref = i.roomUrl ? `/api/employer/interviews/${i.id}/join` : joinUrl;
  // Join is available for any non-terminal interview that has a room — not only
  // status === "scheduled". A room-backed row must always offer Join, even if the
  // status is an unexpected value (e.g. a drifted 'pending').
  const isActive = i.status !== "completed" && i.status !== "cancelled";
  return (
    <Panel className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* Date block */}
      <div className="flex w-full shrink-0 items-center gap-3 sm:w-40">
        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-violet/15 text-violet">
          <span className="text-[10px] font-bold uppercase">{fmtMonth(i.scheduledAt)}</span>
          <span className="text-xl font-bold leading-none">{fmtDay(i.scheduledAt)}</span>
        </div>
        <div className="text-sm">
          <div className="font-semibold text-cream">{fmtTime(i.scheduledAt)}</div>
          <div className="text-xs text-white/45">{i.durationMin} min</div>
        </div>
      </div>

      {/* Details */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-cream">{i.title}</span>
          <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge>
        </div>
        <div className="mt-0.5 text-sm text-white/60">
          {i.applicantName || "Candidate"}
          {i.jobTitle ? ` · ${i.jobTitle}` : ""}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/50">
          <span className="inline-flex items-center gap-1">
            <Icon className="h-3.5 w-3.5" /> {MODE_LABEL[i.mode]}
          </span>
          {!isLink && i.location && <span className="truncate">{i.location}</span>}
          {i.interviewer && <span>with {i.interviewer}</span>}
          {i.recordEnabled && i.status === "scheduled" && (
            <span className="inline-flex items-center gap-1 text-red-300">
              <Circle className="h-2.5 w-2.5 fill-current" /> Recording on
            </span>
          )}
        </div>
        {i.notes && <p className="mt-2 text-xs text-white/45">{i.notes}</p>}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {i.status === "scheduled" && (
          <>
            <button type="button" onClick={onComplete} className="rounded-md p-2 text-white/45 hover:bg-white/5 hover:text-teal" aria-label="Mark completed" title="Mark completed">
              <Check className="h-4 w-4" />
            </button>
            <button type="button" onClick={onCancel} className="rounded-md p-2 text-white/45 hover:bg-white/5 hover:text-red-300" aria-label="Cancel" title="Cancel">
              <X className="h-4 w-4" />
            </button>
            <button type="button" onClick={onEdit} className="rounded-md p-2 text-white/45 hover:bg-white/5 hover:text-cream" aria-label="Edit" title="Edit / reschedule">
              <Pencil className="h-4 w-4" />
            </button>
          </>
        )}
        {i.status !== "scheduled" && (
          <button type="button" onClick={onReopen} className="rounded-md px-2 py-1 text-xs font-semibold text-violet hover:underline">
            Reopen
          </button>
        )}
        <button type="button" onClick={onDelete} className="rounded-md p-2 text-white/45 hover:bg-white/5 hover:text-red-300" aria-label="Delete" title="Delete">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      </div>

      {/* Video: join + recording/transcript links */}
      {(isLink || i.recordingId || i.recordingUrl || i.transcriptUrl) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-gold pt-3">
          {isLink && isActive && (
            <a
              href={joinHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet/90"
            >
              <Video className="h-3.5 w-3.5" /> Join
            </a>
          )}
          {(i.recordingId || i.recordingUrl) && (
            <a
              // Daily-cloud recordings (recordingId) resolve to a fresh URL via
              // recording-download; legacy Supabase ones fall through the same route.
              href={i.recordingId ? `/api/employer/interviews/${i.id}/recording-download` : `/api/employer/interviews/${i.id}/recording?type=recording`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream hover:bg-white/[0.08]"
            >
              <Download className="h-3.5 w-3.5 text-violet" /> Recording
            </a>
          )}
          {i.transcriptUrl && (
            <a
              href={`/api/employer/interviews/${i.id}/recording?type=transcript`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream hover:bg-white/[0.08]"
            >
              <FileText className="h-3.5 w-3.5 text-violet" /> Transcript
            </a>
          )}
        </div>
      )}

      {/* AI summary (Scale+) */}
      {i.aiSummary ? (
        <div className="rounded-xl border border-border-gold bg-white/[0.03] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet" />
            <span className="text-sm font-semibold text-cream">AI interview summary</span>
            <Badge tone={REC_TONE[i.aiSummary.recommendation]}>{RECOMMENDATION_LABELS[i.aiSummary.recommendation]}</Badge>
          </div>
          {i.aiSummary.overview && <p className="mb-3 text-sm text-white/75">{i.aiSummary.overview}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SummaryList title="Strengths" tone="text-teal" items={i.aiSummary.strengths} />
            <SummaryList title="Concerns" tone="text-red-300" items={i.aiSummary.concerns} />
          </div>
          {i.aiSummary.followUps.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase text-muted-cream">Recommended follow-ups</div>
              <ul className="space-y-0.5">
                {i.aiSummary.followUps.map((s, idx) => (
                  <li key={idx} className="text-xs text-white/70">• {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        i.status === "completed" &&
        i.recordEnabled &&
        !hasSummaryTier && (
          <p className="rounded-lg border border-dashed border-border-gold px-3 py-2 text-xs text-white/45">
            🔒 AI interview summaries are a Scale-plan feature.
          </p>
        )
      )}
    </Panel>
  );
}

function SummaryList({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return (
    <div>
      <div className={cn("mb-1 text-[11px] font-semibold uppercase", tone)}>{title}</div>
      {items.length ? (
        <ul className="space-y-0.5">
          {items.map((s, i) => (
            <li key={i} className="text-xs text-white/70">• {s}</li>
          ))}
        </ul>
      ) : (
        <span className="text-xs text-white/35">—</span>
      )}
    </div>
  );
}

function InterviewForm({
  existing,
  initialApplicantId,
  gating,
  onClose,
  onSaved,
}: {
  existing?: Interview;
  initialApplicantId?: number;
  gating: SchedulerGating;
  onClose: () => void;
  onSaved: (warning?: string) => void;
}) {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [applicantId, setApplicantId] = useState<number | "">(existing?.applicantId ?? initialApplicantId ?? "");
  const [title, setTitle] = useState(existing?.title || "");
  const [when, setWhen] = useState(existing ? toLocalInput(existing.scheduledAt) : defaultWhen());
  const [durationMin, setDurationMin] = useState(existing?.durationMin || 30);
  const [mode, setMode] = useState<InterviewMode>(existing?.mode || "video");
  const [location, setLocation] = useState(existing?.location || "");
  const [interviewer, setInterviewer] = useState(existing?.interviewer || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [recordEnabled, setRecordEnabled] = useState(existing?.recordEnabled ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing) return;
    fetch("/api/employer/candidates", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { applicants?: Applicant[] }) => setApplicants(d.applicants || []))
      .catch(() => {});
  }, [existing]);

  const selectedApplicant = applicants.find((a) => a.id === applicantId);

  async function submit() {
    if (!applicantId) return setError("Pick a candidate.");
    if (!title.trim()) return setError("Give the interview a title.");
    if (!when || !Number.isFinite(new Date(when).getTime())) return setError("Pick a date and time.");
    setSaving(true);
    setError(null);
    const body = {
      applicantId,
      jobId: existing ? undefined : selectedApplicant?.jobId ?? null,
      title,
      scheduledAt: new Date(when).toISOString(),
      durationMin,
      mode,
      location,
      interviewer,
      notes,
      recordEnabled: mode === "video" && gating.canRecord ? recordEnabled : false,
    };
    try {
      const res = await fetch(existing ? `/api/employer/interviews/${existing.id}` : "/api/employer/interviews", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; warning?: string };
      if (!res.ok) throw new Error(d.error || "Could not save.");
      onSaved(d.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <Modal title={existing ? "Edit interview" : "Schedule interview"} onClose={onClose} wide>
      <div className="space-y-4">
        {existing ? (
          <div className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2 text-sm text-white/70">
            {existing.applicantName}
            {existing.jobTitle ? ` · ${existing.jobTitle}` : ""}
          </div>
        ) : (
          <Field label="Candidate">
            <Picker value={applicantId} onChange={(e) => setApplicantId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Pick a candidate…</option>
              {applicants.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.jobTitle ? `— ${a.jobTitle}` : ""}
                </option>
              ))}
            </Picker>
          </Field>
        )}
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Technical screen, Final round…" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date & time">
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Duration">
            <Picker value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
              {[15, 30, 45, 60, 90, 120].map((d) => (
                <option key={d} value={d}>
                  {d} minutes
                </option>
              ))}
            </Picker>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Picker value={mode} onChange={(e) => setMode(e.target.value as InterviewMode)}>
              {INTERVIEW_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label="Interviewer" hint="Optional">
            <Input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} placeholder="Who's running it?" />
          </Field>
        </div>
        <Field
          label={mode === "onsite" ? "Location / address" : mode === "video" ? "Meeting link" : "Phone number"}
          hint={mode === "video" ? "Optional — leave blank and we'll auto-generate a video room link" : "Optional"}
        >
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={mode === "video" ? "Auto-generated — or paste your own link" : mode === "onsite" ? "123 Main St, Suite 200" : "+1 555 000 0000"}
          />
        </Field>

        {mode === "video" && !existing && (
          <div className="rounded-lg border border-border-gold bg-white/[0.03] p-3">
            {gating.videoLimit === 0 && !gating.videoAllowed ? (
              <p className="text-xs text-gold">
                🔒 Video interviews are a Pro feature. Upgrade to Portal to host video interviews with auto-generated join
                links, recording, and transcripts.
              </p>
            ) : (
              <>
                <label className={cn("flex items-center gap-2 text-sm", !gating.canRecord && "opacity-60")}>
                  <input
                    type="checkbox"
                    checked={recordEnabled}
                    disabled={!gating.canRecord}
                    onChange={(e) => setRecordEnabled(e.target.checked)}
                    className="h-4 w-4 accent-violet"
                  />
                  <span className="text-cream">Record interview</span>
                </label>
                <p className="mt-1 text-[11px] text-white/45">
                  {gating.canRecord
                    ? gating.canSummary
                      ? "Records the call and generates a transcript + AI summary when it ends."
                      : "Records the call and generates a transcript. AI summaries are a Scale-plan feature."
                    : "🔒 Recording + transcription are available on Portal and above."}
                </p>
              </>
            )}
          </div>
        )}

        <Field label="Notes" hint="Optional — visible only to your team">
          <Area rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        <div className="flex justify-end">
          <Btn onClick={submit} loading={saving}>
            {existing ? "Save changes" : "Schedule"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── date helpers ────────────────────────────────────────────────────────────
function defaultWhen(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  d.setHours(10);
  return toLocalInput(d.toISOString());
}
/** ISO → value for <input type="datetime-local"> (local time, no zone). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: "short" }) : "";
}
function fmtDay(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? String(d.getDate()) : "";
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}
