"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Plus, Video, Phone, MapPin, Check, X, Pencil, Trash2, ExternalLink } from "lucide-react";
import {
  INTERVIEW_MODES,
  type Interview,
  type InterviewMode,
  type InterviewStatus,
  type Applicant,
} from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Field, Input, Area, Picker, Badge, EmptyState, Modal } from "../components/ui";
import { cn } from "@/lib/utils";

const MODE_ICON = { video: Video, phone: Phone, onsite: MapPin } as const;
const MODE_LABEL = { video: "Video call", phone: "Phone", onsite: "On-site" } as const;
const STATUS_TONE: Record<InterviewStatus, "sky" | "teal" | "neutral"> = { scheduled: "sky", completed: "teal", cancelled: "neutral" };

export function SchedulerClient({ initialApplicantId }: { initialApplicantId?: number }) {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"upcoming" | "past" | "all">("upcoming");
  const [scheduling, setScheduling] = useState(!!initialApplicantId);
  const [editing, setEditing] = useState<Interview | null>(null);

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
    await fetch(`/api/employer/interviews/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  }
  async function del(id: number) {
    await fetch(`/api/employer/interviews/${id}`, { method: "DELETE" });
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
          onClose={() => setScheduling(false)}
          onSaved={async () => {
            setScheduling(false);
            await load();
          }}
        />
      )}
      {editing && (
        <InterviewForm existing={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />
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
}: {
  interview: Interview;
  onEdit: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const Icon = MODE_ICON[i.mode];
  const isLink = i.mode === "video" && /^https?:\/\//i.test(i.location);
  return (
    <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
          {i.location &&
            (isLink ? (
              <a href={i.location} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet hover:underline">
                Join link <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="truncate">{i.location}</span>
            ))}
          {i.interviewer && <span>with {i.interviewer}</span>}
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
    </Panel>
  );
}

function InterviewForm({
  existing,
  initialApplicantId,
  onClose,
  onSaved,
}: {
  existing?: Interview;
  initialApplicantId?: number;
  onClose: () => void;
  onSaved: () => void;
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
    };
    try {
      const res = await fetch(existing ? `/api/employer/interviews/${existing.id}` : "/api/employer/interviews", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || "Could not save.");
      onSaved();
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
        <Field label={mode === "onsite" ? "Location / address" : mode === "video" ? "Meeting link" : "Phone number"} hint="Optional">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={mode === "video" ? "https://meet.google.com/…" : mode === "onsite" ? "123 Main St, Suite 200" : "+1 555 000 0000"}
          />
        </Field>
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
