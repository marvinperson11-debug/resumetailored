"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import {
  weekStartISO,
  addDaysISO,
  weekLabel,
  weekDates,
  entryHours,
  formatHM,
  roundHours,
  REVIEW_STATUS_LABELS,
  DOW_LABELS,
  type WeekTimesheet,
} from "@/lib/time-hub";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-teal/20 text-teal",
  declined: "bg-red-500/20 text-red-300",
  pending: "bg-gold/20 text-gold",
};

/** The employee's own weekly hours — read-only, with a week stepper. Raw hours;
 *  approval status comes from the employer. */
export function EmployeeTimesheetClient() {
  const [week, setWeek] = useState(() => weekStartISO());
  const [data, setData] = useState<WeekTimesheet | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (w: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/employee/timesheet?week=${w}`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { timesheet?: WeekTimesheet };
      setData(d.timesheet || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(week);
  }, [week, load]);

  const isCurrent = week === weekStartISO();
  const status = data?.review?.status ?? "pending";

  // Group entries by day for the per-day summary.
  const byDay = useMemo(() => {
    const map = new Map<string, WeekTimesheet["entries"]>();
    for (const iso of weekDates(week)) map.set(iso, []);
    for (const e of data?.entries || []) {
      const day = e.clockIn.slice(0, 10);
      if (map.has(day)) map.get(day)!.push(e);
    }
    return map;
  }, [data, week]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-medium text-cream">My hours</h1>
        <p className="mt-1 text-sm text-white/60">Your weekly hours from the time clock. Raw hours only — no overtime math.</p>
      </header>

      {/* Week stepper */}
      <div className="glass flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setWeek((w) => addDaysISO(w, -7))}
          className="rounded-lg p-2 text-white/60 transition hover:bg-white/10 hover:text-cream"
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-sm font-medium text-cream">{weekLabel(week)}</div>
          {isCurrent && <div className="text-[11px] text-white/40">This week</div>}
        </div>
        <button
          onClick={() => setWeek((w) => addDaysISO(w, 7))}
          disabled={isCurrent}
          className="rounded-lg p-2 text-white/60 transition hover:bg-white/10 hover:text-cream disabled:opacity-30"
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="glass flex items-center gap-2 px-5 py-8 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* Total + status */}
          <div className="glass flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-white/40">Total this week</div>
              <div className="font-serif text-3xl font-medium text-cream tabular-nums">{roundHours(data?.totalHours || 0)}h</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-white/40">Status</div>
              <span className={cn("mt-1 inline-flex rounded-full px-3 py-1 text-xs font-semibold", STATUS_STYLE[status])}>
                {REVIEW_STATUS_LABELS[status]}
              </span>
            </div>
          </div>

          {data?.review?.note && (
            <div className="glass px-5 py-3 text-sm text-white/70">
              <span className="text-white/40">Note from your employer: </span>
              {data.review.note}
            </div>
          )}

          {/* Per-day breakdown */}
          <div className="glass overflow-hidden p-0">
            <ul className="divide-y divide-white/5">
              {weekDates(week).map((iso) => {
                const entries = byDay.get(iso) || [];
                const dow = DOW_LABELS[new Date(iso + "T00:00:00Z").getUTCDay()];
                const dayTotal = entries.reduce((a, e) => a + entryHours(e), 0);
                return (
                  <li key={iso} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-cream">
                        {dow}{" "}
                        <span className="text-white/40">
                          {new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                        </span>
                      </div>
                      <div className="text-sm tabular-nums text-white/70">{dayTotal > 0 ? formatHM(dayTotal) : "—"}</div>
                    </div>
                    {entries.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {entries.map((e) => (
                          <li key={e.id} className="flex items-center justify-between text-xs text-white/50">
                            <span>
                              {new Date(e.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                              {e.clockOut ? new Date(e.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "open"}
                              {e.note ? <span className="text-white/35"> · {e.note}</span> : null}
                            </span>
                            <span className="tabular-nums">{formatHM(entryHours(e))}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {(data?.entries || []).length === 0 && (
            <div className="glass flex flex-col items-center gap-2 px-5 py-10 text-center text-sm text-white/50">
              <Clock className="h-7 w-7 text-white/25" />
              No hours logged this week. Clock in from your portal home.
            </div>
          )}
        </>
      )}
    </div>
  );
}
