"use client";

import { useCallback, useEffect, useState } from "react";
import { Plane, Check, X, Loader2 } from "lucide-react";
import {
  TIME_OFF_TONE,
  timeOffDays,
  type TimeOffRequest,
  type TimeOffStatus,
} from "@/lib/time-hub";
import { PageHeader, Panel, Btn, Badge, EmptyState, Area, LockedModuleBanner, useFirstTouch, FirstTouchSnackbar } from "../components/ui";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { formatDateRange } from "@/lib/format";

interface Row {
  request: TimeOffRequest;
  employee: { id: number; name: string; role: string } | null;
}

const FILTERS: (TimeOffStatus | "all")[] = ["pending", "approved", "declined", "all"];

/** Employer time-off requests: filter by status, approve/decline with a note. */
export function TimeOffClient({ locked = false }: { locked?: boolean }) {
  const t = useTranslations("employerTimeOff");
  const tc = useTranslations("employeeCommon");
  const [filter, setFilter] = useState<TimeOffStatus | "all">("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const { touched, dismiss, handlers } = useFirstTouch(locked);

  const load = useCallback(async (f: TimeOffStatus | "all") => {
    setLoading(true);
    try {
      const qs = f === "all" ? "" : `?status=${f}`;
      const r = await fetch(`/api/employer/time-off${qs}`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { rows?: Row[] };
      setRows(d.rows || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  return (
    <div {...handlers}>
      {locked && <LockedModuleBanner featureKey="timeOff" tier="Portal" />}
      <FirstTouchSnackbar show={touched} featureKey="timeOff" tier="Portal" onDismiss={dismiss} />
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="mb-6 inline-flex rounded-lg border border-border-gold bg-white/[0.03] p-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
              filter === f ? "bg-violet text-white" : "text-muted-cream hover:text-cream"
            )}
          >
            {f === "all" ? t("filters.all") : tc(`reviewStatus.${f}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <Panel className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </Panel>
      ) : rows.length === 0 ? (
        <EmptyState icon={Plane} title={t("emptyTitle")} body={filter === "pending" ? t("emptyPending") : t("emptyFilter")} />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <RequestRow key={row.request.id} row={row} onReviewed={() => load(filter)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestRow({ row, onReviewed }: { row: Row; onReviewed: () => void }) {
  const locale = useLocale();
  const t = useTranslations("employerTimeOff");
  const tc = useTranslations("employeeCommon");
  const { request: r, employee } = row;
  const [note, setNote] = useState(r.employerNote || "");
  const [saving, setSaving] = useState<TimeOffStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: TimeOffStatus) {
    setSaving(status);
    setError(null);
    try {
      const res = await fetch(`/api/employer/time-off/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: note.trim() || undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(d.error || t("errors.decision"));
        return;
      }
      onReviewed();
    } finally {
      setSaving(null);
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-cream">{employee?.name || t("formerEmployee")}</div>
          <div className="mt-0.5 text-sm text-white/70">
            {tc(`timeOffKinds.${r.kind}`)} · {formatDateRange(r.startDate, r.endDate, locale)}{" "}
            <span className="text-white/40">
              ({tc("days", { count: timeOffDays(r) })})
            </span>
          </div>
          {r.reason && <p className="mt-1 text-sm text-white/55">{r.reason}</p>}
        </div>
        <Badge tone={TIME_OFF_TONE[r.status]}>{tc(`reviewStatus.${r.status}`)}</Badge>
      </div>

      {r.employerNote && !expanded && (
        <p className="mt-2 text-xs text-white/45">
          <span className="text-white/35">{t("yourNote")} </span>
          {r.employerNote}
        </p>
      )}

      <div className="mt-3">
        {expanded ? (
          <div className="space-y-3">
            <Area value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("notePh")} />
            {error && <p className="text-sm text-gold">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Btn variant="primary" onClick={() => decide("approved")} loading={saving === "approved"} disabled={!!saving}>
                <Check className="h-4 w-4" /> {t("approve")}
              </Btn>
              <Btn variant="danger" onClick={() => decide("declined")} loading={saving === "declined"} disabled={!!saving}>
                <X className="h-4 w-4" /> {t("decline")}
              </Btn>
              <Btn variant="ghost" onClick={() => setExpanded(false)} disabled={!!saving}>
                {tc("cancel")}
              </Btn>
            </div>
          </div>
        ) : (
          <Btn variant="ghost" onClick={() => setExpanded(true)}>
            {r.status === "pending" ? t("review") : t("changeDecision")}
          </Btn>
        )}
      </div>
    </Panel>
  );
}
