"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate, formatNumber, formatWeekdayTime } from "@/lib/format";
import { CalendarClock, Plus, Video, Phone, MapPin, Check, X, Pencil, Trash2, Download, FileText, Circle, Sparkles } from "lucide-react";
import {
  INTERVIEW_MODES,
  type Interview,
  type InterviewMode,
  type InterviewStatus,
  type InterviewRecommendation,
  type Applicant,
} from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Field, Input, Area, Picker, Badge, EmptyState, Modal, LockedModuleBanner, QuotaBar, useFirstTouch, FirstTouchSnackbar } from "../components/ui";
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
const STATUS_TONE: Record<InterviewStatus, "sky" | "teal" | "neutral"> = { scheduled: "sky", completed: "teal", cancelled: "neutral" };
const REC_TONE: Record<InterviewRecommendation, "teal" | "sky" | "gold" | "red"> = {
  strong_yes: "teal",
  yes: "sky",
  mixed: "gold",
  no: "red",
};

export function SchedulerClient({ initialApplicantId, gating }: { initialApplicantId?: number; gating: SchedulerGating }) {
  const t = useTranslations("employerScheduler");
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"upcoming" | "past" | "all">("upcoming");
  const [scheduling, setScheduling] = useState(!!initialApplicantId);
  const [editing, setEditing] = useState<Interview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const videoLocked = gating.videoLimit === 0;
  const { touched, dismiss, handlers } = useFirstTouch(videoLocked);

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

  // Auto-complete arrives server-side via the Daily webhook, so re-fetch when the
  // tab regains focus (e.g. after finishing a call in the Daily window) to show
  // the fresh 'completed' status without a manual page reload. Cheap + no-store.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const shown = interviews
    .filter((i) => {
      // Status-based, date-agnostic: an interview run early and completed belongs
      // in Past immediately (e.g. scheduled Sat, done Fri), and one not yet held
      // stays in Upcoming regardless of the clock.
      // A row with no real date is an unscheduled applicant, not an upcoming interview.
      if (view === "upcoming") return i.status === "scheduled" && !!i.scheduledAt && !Number.isNaN(new Date(i.scheduledAt).getTime());
      if (view === "past") return i.status === "completed" || i.status === "cancelled";
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
        setNotice(d.error || t("errorCouldNotUpdate"));
      }
    } catch {
      setNotice(t("errorCouldNotUpdateNetwork"));
    }
    load();
  }
  async function del(id: number) {
    try {
      const res = await fetch(`/api/employer/interviews/${id}`, { method: "DELETE" });
      if (!res.ok) setNotice(t("errorCouldNotDelete"));
    } catch {
      setNotice(t("errorCouldNotDeleteNetwork"));
    }
    load();
  }

  return (
    <div {...handlers}>
      {videoLocked && <LockedModuleBanner featureKey="videoInterviews" tier="Portal" />}
      <FirstTouchSnackbar show={touched} featureKey="videoInterviews" tier="Portal" onDismiss={dismiss} />
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Btn onClick={() => setScheduling(true)}>
            <Plus className="h-4 w-4" /> {t("scheduleInterview")}
          </Btn>
        }
      />

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("dismiss")} className="shrink-0 text-gold/70 hover:text-gold">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!videoLocked && gating.videoLimit !== null && (
        <QuotaBar
          kind="video"
          used={gating.videoUsed}
          limit={gating.videoLimit}
          nextTierLabel={gating.tier === "portal" ? "Scale" : gating.tier === "scale" ? "Corporate" : undefined}
        />
      )}
      {!videoLocked && gating.videoLimit !== null && (!gating.canRecord || !gating.canSummary) && (
        <p className="-mt-2 mb-4 text-xs text-white/45">
          {!gating.canRecord && t("recordingHint")}
          {gating.canRecord && !gating.canSummary && t("summariesHint")}
        </p>
      )}

      <div className="mb-4 flex gap-1 text-sm">
        {(["upcoming", "past", "all"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "rounded-lg px-3 py-1.5 font-semibold transition-colors",
              view === v ? "bg-violet/20 text-cream" : "text-white/55 hover:bg-white/5"
            )}
          >
            {t(`view.${v}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <Panel className="text-sm text-white/50">{t("loadingInterviews")}</Panel>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={view === "upcoming" ? t("noUpcomingInterviews") : t("noInterviews")}
          body={t("emptyStateBody")}
          action={
            <Btn onClick={() => setScheduling(true)}>
              <Plus className="h-4 w-4" /> {t("scheduleInterview")}
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
  const locale = useLocale();
  const t = useTranslations("employerScheduler");
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
          <span className="text-[10px] font-bold uppercase">{fmtMonth(i.scheduledAt, locale)}</span>
          <span className="text-xl font-bold leading-none">{fmtDay(i.scheduledAt, locale)}</span>
        </div>
        <div className="text-sm">
          <div className="font-semibold text-cream">{fmtTime(i.scheduledAt, locale)}</div>
          <div className="text-xs text-white/45">{t("durationMinutes", { count: i.durationMin })}</div>
        </div>
      </div>

      {/* Details */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-cream">{i.title}</span>
          <Badge tone={STATUS_TONE[i.status]}>{t(`interviewStatus.${i.status}`)}</Badge>
        </div>
        <div className="mt-0.5 text-sm text-white/60">
          {i.applicantName || t("candidateFallback")}
          {i.jobTitle ? ` · ${i.jobTitle}` : ""}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/50">
          <span className="inline-flex items-center gap-1">
            <Icon className="h-3.5 w-3.5" /> {t(`modeLabel.${i.mode}`)}
          </span>
          {!isLink && i.location && <span className="truncate">{i.location}</span>}
          {i.interviewer && <span>{t("withInterviewer", { name: i.interviewer })}</span>}
          {i.recordEnabled && i.status === "scheduled" && (
            <span className="inline-flex items-center gap-1 text-red-300">
              <Circle className="h-2.5 w-2.5 fill-current" /> {t("recordingOn")}
            </span>
          )}
        </div>
        {i.notes && <p className="mt-2 text-xs text-white/45">{i.notes}</p>}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {i.status === "scheduled" && (
          <>
            <button type="button" onClick={onComplete} className="rounded-md p-2 text-white/45 hover:bg-white/5 hover:text-teal" aria-label={t("markCompleted")} title={t("markCompleted")}>
              <Check className="h-4 w-4" />
            </button>
            <button type="button" onClick={onCancel} className="rounded-md p-2 text-white/45 hover:bg-white/5 hover:text-red-300" aria-label={t("cancel")} title={t("cancel")}>
              <X className="h-4 w-4" />
            </button>
            <button type="button" onClick={onEdit} className="rounded-md p-2 text-white/45 hover:bg-white/5 hover:text-cream" aria-label={t("edit")} title={t("editReschedule")}>
              <Pencil className="h-4 w-4" />
            </button>
          </>
        )}
        {i.status !== "scheduled" && (
          <button type="button" onClick={onReopen} className="rounded-md px-2 py-1 text-xs font-semibold text-violet hover:underline">
            {t("reopen")}
          </button>
        )}
        <button type="button" onClick={onDelete} className="rounded-md p-2 text-white/45 hover:bg-white/5 hover:text-red-300" aria-label={t("delete")} title={t("delete")}>
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
              <Video className="h-3.5 w-3.5" /> {t("join")}
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
              <Download className="h-3.5 w-3.5 text-violet" /> {t("recording")}
            </a>
          )}
          {i.transcriptUrl && (
            <a
              href={`/api/employer/interviews/${i.id}/recording?type=transcript`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream hover:bg-white/[0.08]"
            >
              <FileText className="h-3.5 w-3.5 text-violet" /> {t("transcript")}
            </a>
          )}
        </div>
      )}

      {/* AI summary (Scale+) */}
      {i.aiSummary ? (
        <div className="rounded-xl border border-border-gold bg-white/[0.03] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet" />
            <span className="text-sm font-semibold text-cream">{t("aiInterviewSummary")}</span>
            <Badge tone={REC_TONE[i.aiSummary.recommendation]}>{t(`recommendation.${i.aiSummary.recommendation}`)}</Badge>
          </div>
          {i.aiSummary.overview && <p className="mb-3 text-sm text-white/75">{i.aiSummary.overview}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SummaryList title={t("strengths")} tone="text-teal" items={i.aiSummary.strengths} />
            <SummaryList title={t("concerns")} tone="text-red-300" items={i.aiSummary.concerns} />
          </div>
          {i.aiSummary.followUps.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase text-muted-cream">{t("recommendedFollowUps")}</div>
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
            {t("summariesAreScalePlanFeature")}
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
  const t = useTranslations("employerScheduler");
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
    if (!applicantId) return setError(t("errorPickCandidate"));
    if (!title.trim()) return setError(t("errorNeedTitle"));
    if (!when || !Number.isFinite(new Date(when).getTime())) return setError(t("errorPickDateTime"));
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
      // Send the raw toggle value; the server re-checks tier with fresh access
      // and enforces canRecord there. Don't AND with the page-load gating.canRecord
      // here — a stale/transient page-load value must not silently drop recording.
      recordEnabled: mode === "video" ? recordEnabled : false,
    };
    try {
      const res = await fetch(existing ? `/api/employer/interviews/${existing.id}` : "/api/employer/interviews", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; warning?: string };
      if (!res.ok) throw new Error(d.error || t("errorCouldNotSave"));
      onSaved(d.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
      setSaving(false);
    }
  }

  return (
    <Modal title={existing ? t("editInterview") : t("scheduleInterview")} onClose={onClose} wide>
      <div className="space-y-4">
        {existing ? (
          <div className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2 text-sm text-white/70">
            {existing.applicantName}
            {existing.jobTitle ? ` · ${existing.jobTitle}` : ""}
          </div>
        ) : (
          <Field label={t("fieldCandidate")}>
            <Picker value={applicantId} onChange={(e) => setApplicantId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">{t("pickCandidateEllipsis")}</option>
              {applicants.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.jobTitle ? `— ${a.jobTitle}` : ""}
                </option>
              ))}
            </Picker>
          </Field>
        )}
        <Field label={t("fieldTitle")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("placeholderTitle")} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("fieldDateTime")}>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label={t("fieldDuration")}>
            <Picker value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
              {[15, 30, 45, 60, 90, 120].map((d) => (
                <option key={d} value={d}>
                  {t("durationMinutes", { count: d })}
                </option>
              ))}
            </Picker>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("fieldType")}>
            <Picker value={mode} onChange={(e) => setMode(e.target.value as InterviewMode)}>
              {INTERVIEW_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`modeLabel.${m}`)}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label={t("fieldInterviewer")} hint={t("optional")}>
            <Input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} placeholder={t("placeholderInterviewer")} />
          </Field>
        </div>
        <Field
          label={mode === "onsite" ? t("fieldLocationAddress") : mode === "video" ? t("fieldMeetingLink") : t("fieldPhoneNumber")}
          hint={mode === "video" ? t("hintMeetingLink") : t("optional")}
        >
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={mode === "video" ? t("placeholderMeetingLink") : mode === "onsite" ? t("placeholderAddress") : "+1 555 000 0000"}
          />
        </Field>

        {mode === "video" && !existing && (
          <div className="rounded-lg border border-border-gold bg-white/[0.03] p-3">
            {gating.videoLimit === 0 && !gating.videoAllowed ? (
              <p className="text-xs text-gold">
                {t("videoInterviewsAreProFeature")}
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
                  <span className="text-cream">{t("recordInterview")}</span>
                </label>
                <p className="mt-1 text-[11px] text-white/45">
                  {gating.canRecord
                    ? gating.canSummary
                      ? t("recordHintFull")
                      : t("recordHintNoSummary")
                    : t("recordHintNotAllowed")}
                </p>
              </>
            )}
          </div>
        )}

        <Field label={t("fieldNotes")} hint={t("hintNotes")}>
          <Area rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        <div className="flex justify-end">
          <Btn onClick={submit} loading={saving}>
            {existing ? t("saveChanges") : t("schedule")}
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
function fmtMonth(iso: string, locale: string): string {
  return formatDate(iso, locale, "monthShort");
}
function fmtDay(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? formatNumber(d.getDate(), locale, 0) : "";
}
function fmtTime(iso: string, locale: string): string {
  return formatWeekdayTime(iso, locale);
}
