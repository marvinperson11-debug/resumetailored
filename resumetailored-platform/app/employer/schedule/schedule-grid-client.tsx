"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, Send, Loader2, Plane, Info } from "lucide-react";
import {
  weekStartISO,
  addDaysISO,
  weekLabel,
  weekDates,
  formatHHMM,
  shiftHours,
  formatHM,
  availabilityDayLabel,
  DOW_LABELS,
  TIME_OFF_KIND_LABELS,
  type Shift,
  type AvailabilitySlot,
  type TimeOffRequest,
} from "@/lib/time-hub";
import { PageHeader, Panel, Btn, EmptyState, Modal, Field, Input } from "../components/ui";
import { cn } from "@/lib/utils";

interface Emp {
  id: number;
  name: string;
  role: string;
  inviteStatus: string;
}
interface Data {
  weekStart: string;
  days: string[];
  employees: Emp[];
  shifts: Shift[];
  availability: AvailabilitySlot[];
  timeOff: TimeOffRequest[];
  hasDrafts: boolean;
}

/** Employer weekly shift grid: post shifts per employee/day, then publish. Shows
 *  each employee's submitted availability and approved time off as overlays. */
export function ScheduleGridClient() {
  const [week, setWeek] = useState(() => weekStartISO());
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState("");
  const [add, setAdd] = useState<{ employeeId: number; date: string } | null>(null);

  const load = useCallback(async (w: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/employer/schedule?week=${w}`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as Data;
      setData(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(week);
  }, [week, load]);

  async function publish() {
    setPublishing(true);
    try {
      const r = await fetch("/api/employer/schedule/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: week }),
      });
      const d = (await r.json().catch(() => ({}))) as { published?: number };
      setToast(d.published ? `Published ${d.published} shift${d.published === 1 ? "" : "s"}.` : "Schedule is up to date.");
      setTimeout(() => setToast(""), 3000);
      load(week);
    } finally {
      setPublishing(false);
    }
  }

  const isCurrent = week === weekStartISO();
  const days = data?.days || weekDates(week);

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle="Post each employee's shifts for the week, then publish so they appear in the employee's portal."
        action={
          <Btn onClick={publish} loading={publishing} disabled={!data?.hasDrafts}>
            <Send className="h-4 w-4" /> {data?.hasDrafts ? "Publish week" : "Published"}
          </Btn>
        }
      />

      {toast && <div className="mb-4 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2 text-sm text-teal">{toast}</div>}

      {/* Week stepper */}
      <Panel className="mb-6 flex items-center justify-between !py-3">
        <button onClick={() => setWeek((w) => addDaysISO(w, -7))} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-cream" aria-label="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-sm font-medium text-cream">{weekLabel(week)}</div>
          {isCurrent && <div className="text-[11px] text-white/40">This week</div>}
        </div>
        <button onClick={() => setWeek((w) => addDaysISO(w, 7))} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-cream" aria-label="Next week">
          <ChevronRight className="h-4 w-4" />
        </button>
      </Panel>

      {loading ? (
        <Panel className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </Panel>
      ) : !data || data.employees.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No employees yet" body="Add employees in the Employees tab, then post their shifts here." />
      ) : (
        <div className="space-y-4">
          {data.employees.map((emp) => (
            <EmployeeRow
              key={emp.id}
              emp={emp}
              days={days}
              shifts={data.shifts.filter((s) => s.employeeId === emp.id)}
              availability={data.availability.filter((a) => a.employeeId === emp.id)}
              timeOff={data.timeOff.filter((t) => t.employeeId === emp.id)}
              onAdd={(date) => setAdd({ employeeId: emp.id, date })}
              onChanged={() => load(week)}
            />
          ))}
        </div>
      )}

      {add && data && (
        <AddShiftModal
          employee={data.employees.find((e) => e.id === add.employeeId)!}
          date={add.date}
          onClose={() => setAdd(null)}
          onSaved={() => {
            setAdd(null);
            load(week);
          }}
        />
      )}
    </div>
  );
}

function EmployeeRow({
  emp,
  days,
  shifts,
  availability,
  timeOff,
  onAdd,
  onChanged,
}: {
  emp: Emp;
  days: string[];
  shifts: Shift[];
  availability: AvailabilitySlot[];
  timeOff: TimeOffRequest[];
  onAdd: (date: string) => void;
  onChanged: () => void;
}) {
  const weekHours = shifts.reduce((a, s) => a + shiftHours(s), 0);

  return (
    <Panel className="!p-0">
      <div className="flex items-center justify-between border-b border-border-gold px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-cream">{emp.name}</span>
          {emp.role && <span className="text-xs text-white/40">{emp.role}</span>}
        </div>
        <span className="text-xs tabular-nums text-white/50">{weekHours > 0 ? formatHM(weekHours) : "—"} scheduled</span>
      </div>

      <div className="grid grid-cols-1 divide-y divide-white/5 sm:grid-cols-7 sm:divide-x sm:divide-y-0">
        {days.map((iso) => {
          const d = new Date(iso + "T00:00:00Z");
          const dayShifts = shifts.filter((s) => s.shiftDate === iso);
          const off = timeOff.find((t) => t.startDate <= iso && iso <= t.endDate);
          const avail = availability.filter(
            (a) => (a.kind === "recurring" && a.weekday === d.getUTCDay()) || (a.kind === "date" && a.specificDate === iso)
          );
          return (
            <div key={iso} className="min-h-[92px] p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                  {DOW_LABELS[d.getUTCDay()]} {d.getUTCDate()}
                </span>
                <button onClick={() => onAdd(iso)} className="rounded p-0.5 text-white/40 transition hover:bg-white/10 hover:text-violet" aria-label="Add shift">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {off && (
                <div className="mb-1 flex items-center gap-1 rounded bg-gold/15 px-1.5 py-1 text-[10px] font-medium text-gold">
                  <Plane className="h-3 w-3" /> {TIME_OFF_KIND_LABELS[off.kind]}
                </div>
              )}

              {avail.length > 0 && (
                <div className="mb-1 space-y-0.5">
                  {avail.map((a) => (
                    <div
                      key={a.id}
                      className={cn("truncate rounded px-1.5 py-0.5 text-[10px]", a.available ? "bg-teal/10 text-teal/90" : "bg-red-500/10 text-red-300/90")}
                      title={`${a.available ? "Available" : "Unavailable"} ${availabilityDayLabel(a)} ${formatHHMM(a.startTime)}–${formatHHMM(a.endTime)}${a.note ? " · " + a.note : ""}`}
                    >
                      {a.available ? "✓" : "✗"} {formatHHMM(a.startTime)}–{formatHHMM(a.endTime)}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                {dayShifts.map((s) => (
                  <ShiftChip key={s.id} shift={s} onChanged={onChanged} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function ShiftChip({ shift, onChanged }: { shift: Shift; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/employer/schedule/${shift.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-1 rounded px-1.5 py-1 text-[11px]",
        shift.published ? "bg-violet/20 text-violet" : "border border-dashed border-gold/40 bg-gold/10 text-gold"
      )}
      title={`${formatHHMM(shift.startTime)}–${formatHHMM(shift.endTime)}${shift.note ? " · " + shift.note : ""}${shift.published ? "" : " (draft)"}`}
    >
      <span className="truncate">
        {formatHHMM(shift.startTime)}–{formatHHMM(shift.endTime)}
      </span>
      <button onClick={remove} disabled={busy} className="shrink-0 opacity-0 transition group-hover:opacity-100" aria-label="Delete shift">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
      </button>
    </div>
  );
}

function AddShiftModal({ employee, date, onClose, onSaved }: { employee: Emp; date: string; onClose: () => void; onSaved: () => void }) {
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const label = useMemo(() => {
    const d = new Date(date + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  }, [date]);

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const r = await fetch("/api/employer/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employee.id, shiftDate: date, startTime, endTime, note: note.trim() || undefined }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setErr(d.error || "Could not add the shift.");
      else onSaved();
    } catch {
      setErr("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Add shift — ${employee.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-white/70">
          <CalendarDays className="h-4 w-4 text-violet" /> {label}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Note" hint="Optional — e.g. a station or location.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Front desk" />
        </Field>
        <div className="flex items-start gap-2 text-xs text-white/40">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> New shifts are drafts until you publish the week.
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn onClick={save} loading={saving}>
            <Plus className="h-4 w-4" /> Add shift
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
