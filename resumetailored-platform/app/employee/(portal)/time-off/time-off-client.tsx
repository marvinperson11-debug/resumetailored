"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, Plus } from "lucide-react";
import {
  TIME_OFF_KINDS,
  TIME_OFF_KIND_LABELS,
  TIME_OFF_STATUS_LABELS,
  timeOffRangeLabel,
  timeOffDays,
  type TimeOffRequest,
  type TimeOffKind,
} from "@/lib/time-hub";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-teal/20 text-teal",
  declined: "bg-red-500/20 text-red-300",
  pending: "bg-gold/20 text-gold",
};

/** Employee time off: request a range + type, see the status of past requests. */
export function EmployeeTimeOffClient() {
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/employee/time-off", { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { requests?: TimeOffRequest[] };
      setRequests(d.requests || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-medium text-cream">Time off</h1>
          <p className="mt-1 text-sm text-white/60">Request vacation, sick or other days off.</p>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet/90"
        >
          <Plus className="h-4 w-4" /> Request time off
        </button>
      </header>

      {open && <RequestForm onSubmitted={() => { setOpen(false); load(); }} onCancel={() => setOpen(false)} />}

      {loading ? (
        <div className="glass flex items-center gap-2 px-5 py-8 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : requests.length === 0 ? (
        <div className="glass flex flex-col items-center gap-2 px-5 py-12 text-center text-sm text-white/50">
          <CalendarClock className="h-7 w-7 text-white/25" />
          No time-off requests yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => (
            <li key={r.id} className="glass px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-cream">
                    {TIME_OFF_KIND_LABELS[r.kind]} · {timeOffRangeLabel(r)}
                  </div>
                  <div className="text-xs text-white/40">
                    {timeOffDays(r)} day{timeOffDays(r) === 1 ? "" : "s"}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </div>
                </div>
                <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-semibold", STATUS_STYLE[r.status])}>
                  {TIME_OFF_STATUS_LABELS[r.status]}
                </span>
              </div>
              {r.employerNote && (
                <p className="mt-2 border-t border-white/10 pt-2 text-sm text-white/70">
                  <span className="text-white/40">Employer note: </span>
                  {r.employerNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestForm({ onSubmitted, onCancel }: { onSubmitted: () => void; onCancel: () => void }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [kind, setKind] = useState<TimeOffKind>("vacation");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (saving) return;
    setSaving(true);
    setErr("");
    try {
      const r = await fetch("/api/employee/time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate: endDate || startDate, kind, reason: reason.trim() || undefined }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setErr(d.error || "Could not submit.");
      else onSubmitted();
    } catch {
      setErr("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass space-y-3 px-5 py-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50">Start date</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50">End date</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={startDate || undefined}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none"
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50">Type</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as TimeOffKind)}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none [&>option]:bg-navy"
        >
          {TIME_OFF_KINDS.map((k) => (
            <option key={k} value={k}>
              {TIME_OFF_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50">Reason (optional)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={1000}
          className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/30 focus:border-violet focus:outline-none"
          placeholder="Anything your employer should know"
        />
      </label>
      {err && <p className="text-xs text-red-300">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving || !startDate}
          className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit request
        </button>
        <button onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5">
          Cancel
        </button>
      </div>
    </div>
  );
}
