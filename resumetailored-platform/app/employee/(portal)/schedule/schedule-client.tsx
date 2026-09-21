"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader2, Plus, Trash2, Clock3, Palmtree } from "lucide-react";
import {
  formatHHMM,
  shiftHours,
  formatHM,
  availabilityDayLabel,
  DOW_LABELS,
  TIME_OFF_KIND_LABELS,
  timeOffRangeLabel,
  type Shift,
  type AvailabilitySlot,
  type TimeOffRequest,
  type AvailabilityKind,
} from "@/lib/time-hub";
import { cn } from "@/lib/utils";

/** Employee "My schedule": published shifts + approved time off on one timeline,
 *  plus an availability editor (recurring + date-specific) the employer sees. */
export function EmployeeScheduleClient() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOffRequest[]>([]);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sched, avail] = await Promise.all([
        fetch("/api/employee/schedule", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        fetch("/api/employee/availability", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      setShifts(sched.shifts || []);
      setTimeOff(sched.approvedTimeOff || []);
      setSlots(avail.slots || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Merge shifts + approved time off into date buckets for the timeline.
  const dateKeys = Array.from(
    new Set([...shifts.map((s) => s.shiftDate), ...timeOff.flatMap((t) => [t.startDate])])
  ).sort();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-serif text-3xl font-medium text-cream">My schedule</h1>
        <p className="mt-1 text-sm text-white/60">Your published shifts and approved time off. Set your availability below.</p>
      </header>

      {loading ? (
        <div className="glass flex items-center gap-2 px-5 py-8 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* Upcoming shifts + time off */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-white/70">
              <CalendarDays className="h-4 w-4 text-violet" /> Upcoming
            </div>
            {shifts.length === 0 && timeOff.length === 0 ? (
              <div className="glass px-6 py-8 text-center text-sm text-white/50">
                No published shifts yet. Your employer will post your schedule here.
              </div>
            ) : (
              <ul className="space-y-2">
                {dateKeys.map((iso) => {
                  const dayShifts = shifts.filter((s) => s.shiftDate === iso);
                  const dayOff = timeOff.filter((t) => t.startDate <= iso && iso <= t.endDate);
                  const d = new Date(iso + "T00:00:00Z");
                  return (
                    <li key={iso} className="glass px-5 py-3">
                      <div className="mb-1.5 text-sm font-medium text-cream">
                        {DOW_LABELS[d.getUTCDay()]}{" "}
                        <span className="text-white/40">
                          {d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {dayShifts.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 text-sm text-white/75">
                            <Clock3 className="h-3.5 w-3.5 text-teal" />
                            <span className="font-medium text-cream">
                              {formatHHMM(s.startTime)} – {formatHHMM(s.endTime)}
                            </span>
                            <span className="text-white/40">({formatHM(shiftHours(s))})</span>
                            {s.note ? <span className="text-white/45">· {s.note}</span> : null}
                          </div>
                        ))}
                        {dayOff.map((t) => (
                          <div key={`off-${t.id}`} className="flex items-center gap-2 text-sm text-gold">
                            <Palmtree className="h-3.5 w-3.5" />
                            <span>Time off — {TIME_OFF_KIND_LABELS[t.kind]}</span>
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {timeOff.length > 0 && (
              <p className="text-xs text-white/40">
                Approved time off:{" "}
                {timeOff.map((t) => `${TIME_OFF_KIND_LABELS[t.kind]} (${timeOffRangeLabel(t)})`).join(", ")}
              </p>
            )}
          </section>

          {/* Availability editor */}
          <AvailabilityEditor slots={slots} onChange={load} />
        </>
      )}
    </div>
  );
}

function AvailabilityEditor({ slots, onChange }: { slots: AvailabilitySlot[]; onChange: () => void }) {
  const [kind, setKind] = useState<AvailabilityKind>("recurring");
  const [weekday, setWeekday] = useState(1); // Monday
  const [date, setDate] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [available, setAvailable] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function add() {
    if (saving) return;
    setSaving(true);
    setErr("");
    try {
      const r = await fetch("/api/employee/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          weekday: kind === "recurring" ? weekday : undefined,
          specificDate: kind === "date" ? date : undefined,
          startTime: start,
          endTime: end,
          available,
          note: note.trim() || undefined,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(d.error || "Could not save.");
      } else {
        setNote("");
        setDate("");
        onChange();
      }
    } catch {
      setErr("Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    await fetch(`/api/employee/availability/${id}`, { method: "DELETE" }).catch(() => {});
    onChange();
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-white/70">
        <Clock3 className="h-4 w-4 text-violet" /> My availability
      </div>
      <p className="text-xs text-white/45">Let your employer know when you can (or can&rsquo;t) work. They see this while building the schedule.</p>

      {/* Existing slots */}
      {slots.length > 0 && (
        <ul className="space-y-2">
          {slots.map((s) => (
            <li key={s.id} className="glass flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    s.available ? "bg-teal/20 text-teal" : "bg-red-500/20 text-red-300"
                  )}
                >
                  {s.available ? "Available" : "Unavailable"}
                </span>
                <span className="text-cream">{availabilityDayLabel(s)}</span>
                <span className="text-white/50">
                  {formatHHMM(s.startTime)} – {formatHHMM(s.endTime)}
                </span>
                {s.note ? <span className="text-white/35">· {s.note}</span> : null}
              </div>
              <button onClick={() => remove(s.id)} className="text-white/40 transition hover:text-red-300" aria-label="Remove">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add form */}
      <div className="glass space-y-3 px-4 py-4">
        <div className="flex flex-wrap gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AvailabilityKind)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none [&>option]:bg-navy"
          >
            <option value="recurring">Every week</option>
            <option value="date">Specific date</option>
          </select>
          {kind === "recurring" ? (
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none [&>option]:bg-navy"
            >
              {DOW_LABELS.map((label, i) => (
                <option key={i} value={i}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none"
            />
          )}
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none"
          />
          <span className="self-center text-white/40">–</span>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none"
          />
          <select
            value={available ? "1" : "0"}
            onChange={(e) => setAvailable(e.target.value === "1")}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none [&>option]:bg-navy"
          >
            <option value="1">Available</option>
            <option value="0">Unavailable</option>
          </select>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          placeholder="Note (optional)"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/30 focus:border-violet focus:outline-none"
        />
        {err && <p className="text-xs text-red-300">{err}</p>}
        <button
          onClick={add}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add availability
        </button>
      </div>
    </section>
  );
}
