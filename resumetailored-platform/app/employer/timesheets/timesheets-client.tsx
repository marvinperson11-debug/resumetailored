"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, ChevronLeft, ChevronRight, Download, Check, X, Loader2 } from "lucide-react";
import {
  weekStartISO,
  addDaysISO,
  weekDates,
  entryHours,
  formatHM,
  roundHours,
  REVIEW_TONE,
  type TimeEntry,
  type TimesheetReview,
  type ReviewStatus,
} from "@/lib/time-hub";
import { useLocale, useTranslations } from "next-intl";
import { formatDate, formatDateRange, formatDateTime, formatTime, weekdayName } from "@/lib/format";
import { PageHeader, Panel, Btn, Badge, EmptyState, Area, LockedModuleBanner, useFirstTouch, FirstTouchSnackbar } from "../components/ui";

interface Row {
  employee: { id: number; name: string; email: string; role: string; inviteStatus: string };
  entries: TimeEntry[];
  totalHours: number;
  review: TimesheetReview | null;
}

/** Employer weekly timesheets: per-employee hours + approve/decline + CSV export.
 *  Raw hours only. */
export function TimesheetsClient({ locked = false }: { locked?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("employerTimesheets");
  const tc = useTranslations("employeeCommon");
  const [week, setWeek] = useState(() => weekStartISO());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const { touched, dismiss, handlers } = useFirstTouch(locked);

  const load = useCallback(async (w: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/employer/timesheets?week=${w}`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { rows?: Row[] };
      setRows(d.rows || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(week);
  }, [week, load]);

  const isCurrent = week === weekStartISO();
  const anyHours = rows.some((r) => r.entries.length > 0);

  return (
    <div {...handlers}>
      {locked && <LockedModuleBanner featureKey="timesheets" tier="Portal" />}
      <FirstTouchSnackbar show={touched} featureKey="timesheets" tier="Portal" onDismiss={dismiss} />
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <a
            href={`/api/employer/timesheets/export?week=${week}`}
            className="inline-flex items-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-white/[0.08]"
          >
            <Download className="h-4 w-4" /> {t("exportCsv")}
          </a>
        }
      />

      {/* Week stepper */}
      <Panel className="mb-6 flex items-center justify-between !py-3">
        <button onClick={() => setWeek((w) => addDaysISO(w, -7))} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-cream" aria-label={t("previousWeek")}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-sm font-medium text-cream">{formatDateRange(week, addDaysISO(week, 6), locale)}</div>
          {isCurrent && <div className="text-[11px] text-white/40">{t("thisWeek")}</div>}
        </div>
        <button
          onClick={() => setWeek((w) => addDaysISO(w, 7))}
          disabled={isCurrent}
          className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-cream disabled:opacity-30"
          aria-label={t("nextWeek")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </Panel>

      {loading ? (
        <Panel className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </Panel>
      ) : rows.length === 0 ? (
        <EmptyState icon={Clock} title={t("noEmployeesTitle")} body={t("noEmployeesBody")} />
      ) : !anyHours ? (
        <EmptyState icon={Clock} title={t("noHoursTitle")} body={t("noHoursBody")} />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <TimesheetRow
              key={row.employee.id}
              row={row}
              week={week}
              open={openId === row.employee.id}
              onToggle={() => setOpenId((id) => (id === row.employee.id ? null : row.employee.id))}
              onReviewed={() => load(week)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TimesheetRow({ row, week, open, onToggle, onReviewed }: { row: Row; week: string; open: boolean; onToggle: () => void; onReviewed: () => void }) {
  const locale = useLocale();
  const t = useTranslations("employerTimesheets");
  const tc = useTranslations("employeeCommon");
  const [note, setNote] = useState(row.review?.note || "");
  const [saving, setSaving] = useState<ReviewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = row.review?.status || "pending";

  async function review(next: ReviewStatus) {
    setSaving(next);
    setError(null);
    try {
      const r = await fetch("/api/employer/timesheets/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: row.employee.id, weekStart: week, status: next, note: note.trim() || undefined }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(d.error || t("errors.review"));
        return;
      }
      onReviewed();
    } finally {
      setSaving(null);
    }
  }

  // Bucket entries by UTC day for the detail view.
  const byDay = new Map<string, TimeEntry[]>();
  for (const iso of weekDates(week)) byDay.set(iso, []);
  for (const e of row.entries) {
    const day = e.clockIn.slice(0, 10);
    if (byDay.has(day)) byDay.get(day)!.push(e);
  }

  return (
    <Panel className="!p-0">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <div className="min-w-0">
          <div className="truncate font-medium text-cream">{row.employee.name}</div>
          <div className="truncate text-xs text-white/45">{row.employee.role || "—"}</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-lg font-medium text-cream">{t("hoursShort", { hours: roundHours(row.totalHours) })}</span>
          <Badge tone={REVIEW_TONE[status]}>{tc(`reviewStatus.${status}`)}</Badge>
        </div>
      </button>

      {open && (
        <div className="border-t border-border-gold px-5 py-4">
          {row.entries.length === 0 ? (
            <p className="text-sm text-white/50">{t("noHoursClocked")}</p>
          ) : (
            <ul className="mb-4 divide-y divide-white/5">
              {weekDates(week).map((iso) => {
                const entries = byDay.get(iso) || [];
                if (entries.length === 0) return null;
                const dow = weekdayName(new Date(iso + "T00:00:00Z").getUTCDay(), locale);
                const dayTotal = entries.reduce((a, e) => a + entryHours(e), 0);
                return (
                  <li key={iso} className="py-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-cream">
                        {dow}{" "}
                        <span className="text-white/40">
                          {formatDate(iso, locale, "monthDay")}
                        </span>
                      </span>
                      <span className="tabular-nums text-white/70">{formatHM(dayTotal)}</span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {entries.map((e) => (
                        <li key={e.id} className="flex items-center justify-between text-xs text-white/50">
                          <span>
                            {formatTime(e.clockIn, locale)} –{" "}
                            {e.clockOut ? formatTime(e.clockOut, locale) : t("open")}
                            {e.note ? <span className="text-white/35"> · {e.note}</span> : null}
                          </span>
                          <span className="tabular-nums">{formatHM(entryHours(e))}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}

          <Area value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("notePh")} className="mb-3" />
          {error && <p className="mb-3 text-sm text-gold">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" onClick={() => review("approved")} loading={saving === "approved"} disabled={!!saving}>
              <Check className="h-4 w-4" /> {t("approve")}
            </Btn>
            <Btn variant="danger" onClick={() => review("declined")} loading={saving === "declined"} disabled={!!saving}>
              <X className="h-4 w-4" /> {t("decline")}
            </Btn>
            {status !== "pending" && (
              <Btn variant="ghost" onClick={() => review("pending")} loading={saving === "pending"} disabled={!!saving}>
                {t("reset")}
              </Btn>
            )}
          </div>
          {row.review?.reviewedAt && (
            <p className="mt-2 text-xs text-white/35">{t("lastReviewed", { when: formatDateTime(row.review.reviewedAt, locale) })}</p>
          )}
        </div>
      )}
    </Panel>
  );
}
