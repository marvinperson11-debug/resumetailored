"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, Pencil, Send, Loader2, Plane, Info } from "lucide-react";
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
  parseISODate,
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
  // A single editor target: adding a new shift on (employeeId, date), or editing
  // an existing one. Published weeks stay fully editable through this.
  const [editor, setEditor] = useState<{ employeeId: number; date: string; shift?: Shift } | null>(null);
  // Tapping a time-off badge opens its own editor (date range + withdraw)
  // without leaving the grid.
  const [timeOffEditor, setTimeOffEditor] = useState<{ request: TimeOffRequest; employeeName: string } | null>(null);

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
  const hasPublished = !!data?.shifts.some((s) => s.published);
  // "Publish updates" once a week already has live shifts and you've since added
  // drafts; "Publish week" for a first publish; disabled + "Published" when there
  // is nothing pending. Editing/deleting an already-published shift is live
  // immediately, so it doesn't need this button.
  const publishLabel = data?.hasDrafts ? (hasPublished ? "Publish updates" : "Publish week") : "Published";

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle="Post each employee's shifts for the week, then publish so they appear in the employee's portal. Published weeks stay editable — new shifts go live when you publish updates; edits to a live shift apply right away."
        action={
          <Btn onClick={publish} loading={publishing} disabled={!data?.hasDrafts}>
            <Send className="h-4 w-4" /> {publishLabel}
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
              onAdd={(date) => setEditor({ employeeId: emp.id, date })}
              onEdit={(shift) => setEditor({ employeeId: emp.id, date: shift.shiftDate, shift })}
              onEditTimeOff={(request) => setTimeOffEditor({ request, employeeName: emp.name })}
            />
          ))}
        </div>
      )}

      {editor && data && (
        <ShiftModal
          employee={data.employees.find((e) => e.id === editor.employeeId)!}
          date={editor.date}
          shift={editor.shift}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            load(week);
          }}
        />
      )}

      {timeOffEditor && (
        <TimeOffEditModal
          request={timeOffEditor.request}
          employeeName={timeOffEditor.employeeName}
          onClose={() => setTimeOffEditor(null)}
          onSaved={() => {
            setTimeOffEditor(null);
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
  onEdit,
  onEditTimeOff,
}: {
  emp: Emp;
  days: string[];
  shifts: Shift[];
  availability: AvailabilitySlot[];
  timeOff: TimeOffRequest[];
  onAdd: (date: string) => void;
  onEdit: (shift: Shift) => void;
  onEditTimeOff: (request: TimeOffRequest) => void;
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
            <div key={iso} className="flex min-h-[128px] flex-col p-2">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">
                {DOW_LABELS[d.getUTCDay()]} {d.getUTCDate()}
              </div>

              {off && (
                <button
                  type="button"
                  onClick={() => onEditTimeOff(off)}
                  className="mb-1 flex w-full items-center gap-1 rounded bg-gold/15 px-1.5 py-1 text-left text-[10px] font-medium text-gold transition hover:brightness-110"
                  title={`${TIME_OFF_KIND_LABELS[off.kind]} — tap to change dates or withdraw`}
                >
                  <Plane className="h-3 w-3 shrink-0" /> <span className="truncate">{TIME_OFF_KIND_LABELS[off.kind]}</span>
                </button>
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
                  <ShiftChip key={s.id} shift={s} onEdit={() => onEdit(s)} />
                ))}
              </div>

              {/* A big, always-visible add target that fills the rest of the cell —
                  works the same on desktop and touch (the tiny top-right "+" was
                  easy to miss and read as "locked" once a week was published). */}
              <button
                onClick={() => onAdd(iso)}
                className="mt-1 flex min-h-[36px] flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-white/15 text-[11px] font-medium text-white/45 transition hover:border-violet hover:bg-violet/10 hover:text-violet"
                aria-label={`Add a shift on ${DOW_LABELS[d.getUTCDay()]} ${d.getUTCDate()} for ${emp.name}`}
              >
                <Plus className="h-3.5 w-3.5" /> {dayShifts.length ? "Add" : "Add shift"}
              </button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function ShiftChip({ shift, onEdit }: { shift: Shift; onEdit: () => void }) {
  // The whole chip is a tap target that opens the editor (start/end/note +
  // delete). Published = solid violet; draft = dashed gold. The pencil is a hint,
  // not the only hit area, so it works on touch.
  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn(
        "flex w-full items-center justify-between gap-1 rounded px-1.5 py-1.5 text-left text-[11px] transition hover:brightness-110",
        shift.published ? "bg-violet/20 text-violet" : "border border-dashed border-gold/40 bg-gold/10 text-gold"
      )}
      title={`${formatHHMM(shift.startTime)}–${formatHHMM(shift.endTime)}${shift.note ? " · " + shift.note : ""}${shift.published ? " (live)" : " (draft)"} — tap to edit`}
    >
      <span className="truncate">
        {formatHHMM(shift.startTime)}–{formatHHMM(shift.endTime)}
      </span>
      <Pencil className="h-3 w-3 shrink-0 opacity-60" />
    </button>
  );
}

function ShiftModal({
  employee,
  date,
  shift,
  onClose,
  onSaved,
}: {
  employee: Emp;
  date: string;
  shift?: Shift;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!shift;
  const [startTime, setStartTime] = useState(shift?.startTime || "09:00");
  const [endTime, setEndTime] = useState(shift?.endTime || "17:00");
  const [note, setNote] = useState(shift?.note || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");
  const label = useMemo(() => {
    const d = new Date(date + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  }, [date]);

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const r = editing
        ? await fetch(`/api/employer/schedule/${shift!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startTime, endTime, note: note.trim() }),
          })
        : await fetch("/api/employer/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employeeId: employee.id, shiftDate: date, startTime, endTime, note: note.trim() || undefined }),
          });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setErr(d.error || "Could not save the shift.");
      else onSaved();
    } catch {
      setErr("Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setDeleting(true);
    setErr("");
    try {
      const r = await fetch(`/api/employer/schedule/${shift!.id}`, { method: "DELETE" });
      if (!r.ok) {
        setErr("Could not delete the shift.");
        setDeleting(false);
      } else {
        onSaved();
      }
    } catch {
      setErr("Network error.");
      setDeleting(false);
    }
  }

  // What happens on save, in plain terms: a live (published) shift edit is
  // instant; a draft (or a brand-new shift) goes live on the next "Publish".
  const liveHint = editing && shift!.published
    ? "This shift is live — your changes reach the employee right away."
    : "New shifts are drafts until you publish updates for the week.";

  return (
    <Modal title={`${editing ? "Edit" : "Add"} shift — ${employee.name}`} onClose={onClose}>
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
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {liveHint}
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <div className="flex items-center justify-between gap-2">
          <div>
            {editing && (
              <Btn variant="danger" onClick={remove} loading={deleting} disabled={saving}>
                <Trash2 className="h-4 w-4" /> Delete
              </Btn>
            )}
          </div>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={onClose} disabled={saving || deleting}>
              Cancel
            </Btn>
            <Btn onClick={save} loading={saving} disabled={deleting}>
              {editing ? "Save shift" : (<><Plus className="h-4 w-4" /> Add shift</>)}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function TimeOffEditModal({
  request,
  employeeName,
  onClose,
  onSaved,
}: {
  request: TimeOffRequest;
  employeeName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startDate, setStartDate] = useState(request.startDate);
  const [endDate, setEndDate] = useState(request.endDate);
  const [saving, setSaving] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!parseISODate(startDate) || !parseISODate(endDate)) {
      setErr("Enter valid dates.");
      return;
    }
    if (endDate < startDate) {
      setErr("The end date can't be before the start date.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const r = await fetch(`/api/employer/time-off/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setErr(d.error || "Could not save the dates.");
      else onSaved();
    } catch {
      setErr("Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function withdraw() {
    setWithdrawing(true);
    setErr("");
    try {
      const r = await fetch(`/api/employer/time-off/${request.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "declined", note: "Withdrawn from the schedule." }),
      });
      if (!r.ok) {
        setErr("Could not withdraw the request.");
        setWithdrawing(false);
      } else {
        onSaved();
      }
    } catch {
      setErr("Network error.");
      setWithdrawing(false);
    }
  }

  return (
    <Modal title={`${TIME_OFF_KIND_LABELS[request.kind]} — ${employeeName}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End">
            <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        {request.reason && <p className="text-sm text-white/55">{request.reason}</p>}
        <div className="flex items-start gap-2 text-xs text-white/40">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> This request is approved and live on the schedule — changes apply
          right away.
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <div className="flex items-center justify-between gap-2">
          <Btn variant="danger" onClick={withdraw} loading={withdrawing} disabled={saving}>
            <Trash2 className="h-4 w-4" /> Withdraw
          </Btn>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={onClose} disabled={saving || withdrawing}>
              Cancel
            </Btn>
            <Btn onClick={save} loading={saving} disabled={withdrawing}>
              Save dates
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}
