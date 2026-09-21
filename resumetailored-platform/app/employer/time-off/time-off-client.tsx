"use client";

import { useCallback, useEffect, useState } from "react";
import { Plane, Check, X, Loader2 } from "lucide-react";
import {
  TIME_OFF_KIND_LABELS,
  TIME_OFF_STATUS_LABELS,
  TIME_OFF_TONE,
  timeOffRangeLabel,
  timeOffDays,
  type TimeOffRequest,
  type TimeOffStatus,
} from "@/lib/time-hub";
import { PageHeader, Panel, Btn, Badge, EmptyState, Area } from "../components/ui";
import { cn } from "@/lib/utils";

interface Row {
  request: TimeOffRequest;
  employee: { id: number; name: string; role: string } | null;
}

const FILTERS: { key: TimeOffStatus | "all"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
  { key: "all", label: "All" },
];

/** Employer time-off requests: filter by status, approve/decline with a note. */
export function TimeOffClient() {
  const [filter, setFilter] = useState<TimeOffStatus | "all">("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

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
    <div>
      <PageHeader title="Time off" subtitle="Review your team's time-off requests. Approved days show up on the schedule. No accrual balances." />

      <div className="mb-6 inline-flex rounded-lg border border-border-gold bg-white/[0.03] p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
              filter === f.key ? "bg-violet text-white" : "text-muted-cream hover:text-cream"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Panel className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </Panel>
      ) : rows.length === 0 ? (
        <EmptyState icon={Plane} title="Nothing here" body={filter === "pending" ? "No pending requests. You're all caught up." : "No requests match this filter."} />
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
  const { request: r, employee } = row;
  const [note, setNote] = useState(r.employerNote || "");
  const [saving, setSaving] = useState<TimeOffStatus | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function decide(status: TimeOffStatus) {
    setSaving(status);
    try {
      await fetch(`/api/employer/time-off/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: note.trim() || undefined }),
      });
      onReviewed();
    } finally {
      setSaving(null);
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-cream">{employee?.name || "Former employee"}</div>
          <div className="mt-0.5 text-sm text-white/70">
            {TIME_OFF_KIND_LABELS[r.kind]} · {timeOffRangeLabel(r)}{" "}
            <span className="text-white/40">
              ({timeOffDays(r)} day{timeOffDays(r) === 1 ? "" : "s"})
            </span>
          </div>
          {r.reason && <p className="mt-1 text-sm text-white/55">{r.reason}</p>}
        </div>
        <Badge tone={TIME_OFF_TONE[r.status]}>{TIME_OFF_STATUS_LABELS[r.status]}</Badge>
      </div>

      {r.employerNote && !expanded && (
        <p className="mt-2 text-xs text-white/45">
          <span className="text-white/35">Your note: </span>
          {r.employerNote}
        </p>
      )}

      <div className="mt-3">
        {expanded ? (
          <div className="space-y-3">
            <Area value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note to the employee (optional)" />
            <div className="flex flex-wrap gap-2">
              <Btn variant="primary" onClick={() => decide("approved")} loading={saving === "approved"} disabled={!!saving}>
                <Check className="h-4 w-4" /> Approve
              </Btn>
              <Btn variant="danger" onClick={() => decide("declined")} loading={saving === "declined"} disabled={!!saving}>
                <X className="h-4 w-4" /> Decline
              </Btn>
              <Btn variant="ghost" onClick={() => setExpanded(false)} disabled={!!saving}>
                Cancel
              </Btn>
            </div>
          </div>
        ) : (
          <Btn variant="ghost" onClick={() => setExpanded(true)}>
            {r.status === "pending" ? "Review" : "Change decision"}
          </Btn>
        )}
      </div>
    </Panel>
  );
}
