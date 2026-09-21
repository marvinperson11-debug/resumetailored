"use client";

import { useCallback, useEffect, useState } from "react";
import { UserCheck, GraduationCap, BookOpen, PlayCircle, ExternalLink, Plus, Send, Trash2, FileText, ShieldCheck, Mail, Megaphone, Pin, PinOff } from "lucide-react";
import {
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  INVITE_STATUS_LABELS,
  DOC_KINDS,
  DOC_KIND_LABELS,
  complianceState,
  COMPLIANCE_TONE,
  type Employee,
  type EmployeeStatus,
  type InviteStatus,
  type Announcement,
  type TrainingDoc,
  type Acknowledgment,
  type DocKind,
  type AckCell,
  type TrainingLibraryItem,
} from "@/lib/employee-hub";
import { Panel, PageHeader, Btn, Field, Input, Area, Picker, Badge, EmptyState, Modal, Drawer } from "../components/ui";

const STATUS_TONE: Record<EmployeeStatus, "teal" | "gold" | "neutral"> = { active: "teal", on_leave: "gold", offboarded: "neutral" };
const INVITE_TONE: Record<InviteStatus, "teal" | "gold" | "neutral"> = { none: "neutral", invited: "gold", accepted: "teal" };

type Tab = "directory" | "announcements" | "training" | "library";
const TAB_META: Record<Tab, { label: string; icon: typeof UserCheck }> = {
  directory: { label: "Directory", icon: UserCheck },
  announcements: { label: "Announcements", icon: Megaphone },
  training: { label: "Training", icon: GraduationCap },
  library: { label: "Library", icon: BookOpen },
};

interface EmployerDoc {
  id: number;
  title: string;
}
interface TrainingRollup {
  doc: TrainingDoc;
  assigned: number;
  counts: { signed: number; waived: number; pending: number; overdue: number };
}

export function EmployeesClient({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<Tab>("directory");
  // "Use in training" from the Library switches to the Training tab and opens
  // the composer prefilled; the nonce lets the same item be re-picked.
  const [preset, setPreset] = useState<TrainingLibraryItem | null>(null);
  const [presetNonce, setPresetNonce] = useState(0);

  function useInTraining(item: TrainingLibraryItem) {
    setPreset(item);
    setPresetNonce((n) => n + 1);
    setTab("training");
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Your workforce, training & compliance — no time clock, no payroll."
      />
      <div className="mb-6 inline-flex rounded-lg border border-border-gold bg-white/[0.03] p-1">
        {(Object.keys(TAB_META) as Tab[]).map((t) => {
          const Icon = TAB_META[t].icon;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === t ? "bg-violet text-white" : "text-muted-cream hover:text-cream"
              }`}
            >
              <Icon className="h-4 w-4" />
              {TAB_META[t].label}
            </button>
          );
        })}
      </div>
      {tab === "directory" && <Directory canManage={canManage} />}
      {tab === "announcements" && <Announcements canManage={canManage} />}
      {tab === "training" && <Training canManage={canManage} preset={preset} presetNonce={presetNonce} />}
      {tab === "library" && <Library canManage={canManage} onUseInTraining={useInTraining} />}
    </div>
  );
}

/* ─────────────────────────── Directory (Part A) ─────────────────────────── */
function Directory({ canManage }: { canManage: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/employer/employees").then((r) => r.json()).catch(() => ({}));
    setEmployees(res.employees || []);
    setRoles(res.roles || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const open = employees.find((e) => e.id === openId) || null;

  return (
    <div>
      <div className="mb-4 flex justify-end">
        {canManage && (
          <Btn onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add employee
          </Btn>
        )}
      </div>
      {loading ? (
        <Panel className="text-sm text-white/55">Loading…</Panel>
      ) : employees.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title="No employees yet"
          body="Add your team here, or turn a hired candidate into an employee from their profile."
          action={canManage ? <Btn onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add employee</Btn> : undefined}
        />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-gold text-xs uppercase tracking-wide text-white/45">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Start</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Portal</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => setOpenId(e.id)}
                  className="cursor-pointer border-b border-border-gold/50 transition-colors last:border-0 hover:bg-white/[0.03]"
                >
                  <td className="px-4 py-3 font-medium text-cream">{e.name}</td>
                  <td className="px-4 py-3 text-white/70">{e.role || "—"}</td>
                  <td className="px-4 py-3 text-white/60">{e.email || "—"}</td>
                  <td className="px-4 py-3 text-white/60">{e.startDate || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[e.status]}>{EMPLOYEE_STATUS_LABELS[e.status]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={INVITE_TONE[e.inviteStatus]}>{INVITE_STATUS_LABELS[e.inviteStatus]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {adding && <AddEmployee roles={roles} onClose={() => setAdding(false)} onSaved={load} />}
      {open && <EmployeeDrawer employee={open} canManage={canManage} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function AddEmployee({ roles, onClose, onSaved }: { roles: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [startDate, setStartDate] = useState("");
  const [status, setStatus] = useState<EmployeeStatus>("active");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim()) {
      setErr("A name is required.");
      return;
    }
    setSaving(true);
    setErr("");
    const res = await fetch("/api/employer/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, role, startDate, status }),
    });
    setSaving(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || "Could not add employee.");
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal title="Add employee" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" />
        </Field>
        <Field label="Email">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@company.com" type="email" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Line Cook" list="emp-roles" />
            <datalist id="emp-roles">
              {roles.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>
          <Field label="Start date">
            <Input value={startDate} onChange={(e) => setStartDate(e.target.value)} type="date" />
          </Field>
        </div>
        <Field label="Status">
          <Picker value={status} onChange={(e) => setStatus(e.target.value as EmployeeStatus)}>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EMPLOYEE_STATUS_LABELS[s]}
              </option>
            ))}
          </Picker>
        </Field>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn onClick={submit} loading={saving}>
            Add employee
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function EmployeeDrawer({
  employee,
  canManage,
  onClose,
  onChanged,
}: {
  employee: Employee;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<EmployeeStatus>(employee.status);
  const [checklist, setChecklist] = useState<{ ack: Acknowledgment; doc: TrainingDoc }[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>(employee.inviteStatus);
  const [inviteCode, setInviteCode] = useState(employee.inviteCode);
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");

  const loadDetail = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/employer/employees/${employee.id}`).then((r) => r.json()).catch(() => ({}));
    setChecklist(res.checklist || []);
    setLoading(false);
  }, [employee.id]);
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  async function saveStatus(next: EmployeeStatus) {
    setStatus(next);
    await fetch(`/api/employer/employees/${employee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    onChanged();
  }

  async function remove() {
    if (!confirm(`Remove ${employee.name}? Their training records are deleted too.`)) return;
    await fetch(`/api/employer/employees/${employee.id}`, { method: "DELETE" });
    onChanged();
    onClose();
  }

  async function invite(action?: "resend" | "regenerate") {
    setInviting(true);
    setInviteMsg("");
    try {
      const res = await fetch(`/api/employer/employees/${employee.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action ? { action } : {}),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; emailed?: boolean; code?: string };
      if (!res.ok) {
        setInviteMsg(d.error || "Could not send the invite.");
      } else {
        setInviteStatus("invited");
        if (d.code) setInviteCode(d.code);
        setInviteMsg(
          action === "regenerate"
            ? d.emailed
              ? "New code generated and emailed."
              : "New code generated (email isn't configured)."
            : d.emailed
              ? "Invite emailed."
              : "Invite created — email isn't configured. Share the code and link manually."
        );
        onChanged();
      }
    } finally {
      setInviting(false);
    }
  }

  return (
    <Drawer title={employee.name} onClose={onClose}>
      <div className="space-y-6">
        <section className="space-y-2 text-sm">
          <Row label="Email" value={employee.email || "—"} />
          <Row label="Role" value={employee.role || "—"} />
          <Row label="Start date" value={employee.startDate || "—"} />
        </section>

        {canManage && (
          <Field label="Status">
            <Picker value={status} onChange={(e) => saveStatus(e.target.value as EmployeeStatus)}>
              {EMPLOYEE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EMPLOYEE_STATUS_LABELS[s]}
                </option>
              ))}
            </Picker>
          </Field>
        )}

        {canManage && (
          <section className="rounded-lg border border-border-gold bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-cream">
                <Mail className="h-4 w-4 text-violet" /> Employee portal
              </div>
              <Badge tone={INVITE_TONE[inviteStatus]}>{INVITE_STATUS_LABELS[inviteStatus]}</Badge>
            </div>
            <p className="mt-1 text-xs text-white/45">
              {inviteStatus === "accepted"
                ? "This employee has an active portal login."
                : "Invite them to view their documents, message you, and see announcements. The email carries a 6-digit code they enter to finish."}
            </p>

            {inviteStatus === "invited" && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-cream">
                <span className="text-white/60">Invite pending</span>
                {inviteCode && (
                  <>
                    <span className="text-white/40">— code</span>
                    <code className="rounded bg-white/10 px-2 py-0.5 font-mono tracking-widest text-cream">{inviteCode}</code>
                  </>
                )}
              </div>
            )}

            {inviteStatus !== "accepted" && (
              <div className="mt-2 flex flex-wrap gap-2">
                {inviteStatus === "invited" ? (
                  <>
                    <Btn onClick={() => invite("resend")} loading={inviting} disabled={!employee.email}>
                      <Send className="h-4 w-4" /> Resend
                    </Btn>
                    <Btn variant="ghost" onClick={() => invite("regenerate")} loading={inviting} disabled={!employee.email}>
                      Regenerate code
                    </Btn>
                  </>
                ) : (
                  <Btn onClick={() => invite()} loading={inviting} disabled={!employee.email}>
                    <Send className="h-4 w-4" /> Invite to portal
                  </Btn>
                )}
                {!employee.email && <p className="mt-1 w-full text-xs text-gold">Add an email to this employee first.</p>}
              </div>
            )}
            {inviteMsg && <p className="mt-2 text-xs text-white/60">{inviteMsg}</p>}
          </section>
        )}

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-cream">
            <ShieldCheck className="h-4 w-4 text-violet" /> Acknowledgments
          </h3>
          {loading ? (
            <p className="text-sm text-white/50">Loading…</p>
          ) : checklist.length === 0 ? (
            <p className="text-sm text-white/50">No training assigned yet.</p>
          ) : (
            <ul className="space-y-2">
              {checklist.map(({ ack, doc }) => {
                const state = complianceState(ack);
                return (
                  <li key={ack.id} className="flex items-center justify-between rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-cream">{doc.title}</div>
                      <div className="text-xs text-white/45">
                        {DOC_KIND_LABELS[doc.docKind]}
                        {ack.dueAt ? ` · due ${ack.dueAt.slice(0, 10)}` : ""}
                        {typeof ack.score === "number" ? ` · quiz ${ack.score}%` : ""}
                      </div>
                    </div>
                    <Badge tone={COMPLIANCE_TONE[state]}>{state}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {canManage && (
          <div className="border-t border-border-gold pt-4">
            <Btn variant="danger" onClick={remove}>
              <Trash2 className="h-4 w-4" /> Remove employee
            </Btn>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-white/45">{label}</span>
      <span className="text-right text-cream">{value}</span>
    </div>
  );
}

/* ─────────────────────── Announcements (Phase 1) ────────────────────────── */
function Announcements({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/employer/announcements").then((r) => r.json()).catch(() => ({}));
    setItems(res.announcements || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function post() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/employer/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, pinned }),
      });
      if (res.ok) {
        setTitle("");
        setBody("");
        setPinned(true);
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: number, patch: Partial<Pick<Announcement, "pinned" | "active">>) {
    await fetch(`/api/employer/announcements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await load();
  }

  async function remove(id: number) {
    if (!confirm("Delete this announcement?")) return;
    await fetch(`/api/employer/announcements/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <Panel>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cream">
            <Megaphone className="h-4 w-4 text-violet" /> New announcement
          </h3>
          <div className="space-y-3">
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Office closed Friday" maxLength={200} />
            </Field>
            <Field label="Message" hint="Optional. Shown on every invited employee's portal home.">
              <Area value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={8000} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-violet" />
              Pin to the top of the portal home
            </label>
            <Btn onClick={post} loading={saving} disabled={!title.trim()}>
              <Send className="h-4 w-4" /> Post announcement
            </Btn>
          </div>
        </Panel>
      )}

      {loading ? (
        <Panel className="text-sm text-white/55">Loading…</Panel>
      ) : items.length === 0 ? (
        <EmptyState icon={Megaphone} title="No announcements" body="Post a note here and it appears on every invited employee's portal home." />
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <Panel key={a.id} className={a.active ? "" : "opacity-60"}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {a.pinned && <Pin className="h-3.5 w-3.5 text-gold" />}
                    <span className="font-medium text-cream">{a.title}</span>
                    {!a.active && <Badge tone="neutral">Retired</Badge>}
                  </div>
                  {a.body && <p className="mt-1 whitespace-pre-wrap text-sm text-white/70">{a.body}</p>}
                  <div className="mt-1 text-xs text-white/40">{new Date(a.createdAt).toLocaleString()}</div>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => patch(a.id, { pinned: !a.pinned })} title={a.pinned ? "Unpin" : "Pin"} className="rounded-md p-1.5 text-white/60 hover:bg-white/5 hover:text-cream">
                      {a.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </button>
                    <button onClick={() => patch(a.id, { active: !a.active })} className="rounded-md px-2 py-1 text-xs text-white/60 hover:bg-white/5 hover:text-cream">
                      {a.active ? "Retire" : "Restore"}
                    </button>
                    <button onClick={() => remove(a.id)} title="Delete" className="rounded-md p-1.5 text-red-300/80 hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Training (Part B) ──────────────────────────── */
function Training({
  canManage,
  preset,
  presetNonce,
}: {
  canManage: boolean;
  preset?: TrainingLibraryItem | null;
  presetNonce?: number;
}) {
  const [rollup, setRollup] = useState<TrainingRollup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [presetItem, setPresetItem] = useState<TrainingLibraryItem | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/employer/training").then((r) => r.json()).catch(() => ({}));
    setRollup(res.training || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // Open the composer prefilled when a Library item is sent over ("Use in training").
  useEffect(() => {
    if (presetNonce && preset) {
      setPresetItem(preset);
      setCreating(true);
    }
  }, [presetNonce, preset]);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        {canManage && (
          <Btn onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New training
          </Btn>
        )}
      </div>
      {loading ? (
        <Panel className="text-sm text-white/55">Loading…</Panel>
      ) : rollup.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No training items yet"
          body="Author an SOP, safety doc or policy in the Documents creator, then assign it here — or upload a PDF."
          action={canManage ? <Btn onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New training</Btn> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {rollup.map((r) => (
            <Panel
              key={r.doc.id}
              className="cursor-pointer transition-colors hover:bg-white/[0.06]"
            >
              <div onClick={() => setOpenId(r.doc.id)} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone="violet">{DOC_KIND_LABELS[r.doc.docKind]}</Badge>
                    <span className="truncate font-medium text-cream">{r.doc.title}</span>
                  </div>
                  <div className="mt-1 text-xs text-white/45">
                    Assigned to {r.doc.assignTo === "all" ? "everyone" : r.doc.assignTo} · {r.assigned} employee{r.assigned === 1 ? "" : "s"}
                    {r.doc.requireSignature ? " · signature required" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.counts.signed > 0 && <Badge tone="teal">{r.counts.signed} signed</Badge>}
                  {r.counts.pending > 0 && <Badge tone="gold">{r.counts.pending} pending</Badge>}
                  {r.counts.overdue > 0 && <Badge tone="red">{r.counts.overdue} overdue</Badge>}
                  {r.counts.waived > 0 && <Badge tone="neutral">{r.counts.waived} waived</Badge>}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
      {creating && (
        <NewTraining
          preset={presetItem}
          onClose={() => {
            setCreating(false);
            setPresetItem(null);
          }}
          onSaved={load}
        />
      )}
      {openId !== null && <ComplianceDrawer docId={openId} canManage={canManage} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function NewTraining({ preset, onClose, onSaved }: { preset?: TrainingLibraryItem | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(preset?.title || "");
  const [docKind, setDocKind] = useState<DocKind>(preset ? "training" : "policy");
  const [libraryItem, setLibraryItem] = useState<TrainingLibraryItem | null>(preset ?? null);
  const [docs, setDocs] = useState<EmployerDoc[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [sourceDocumentId, setSourceDocumentId] = useState<string>("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [assignTo, setAssignTo] = useState("all");
  const [dueAt, setDueAt] = useState("");
  const [requireSignature, setRequireSignature] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/employer/documents").then((r) => r.json()).then((d) => setDocs(d.documents || [])).catch(() => {});
    fetch("/api/employer/employees").then((r) => r.json()).then((d) => setRoles(d.roles || [])).catch(() => {});
  }, []);

  async function submit() {
    if (!title.trim()) {
      setErr("A title is required.");
      return;
    }
    if (!libraryItem && !sourceDocumentId && !bodyHtml.trim() && !pdfUrl.trim()) {
      setErr("Add content: pick from the Library, an authored document, paste content, or add a PDF URL.");
      return;
    }
    setSaving(true);
    setErr("");
    const res = await fetch("/api/employer/training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        docKind,
        libraryItemId: libraryItem ? libraryItem.id : undefined,
        sourceDocumentId: !libraryItem && sourceDocumentId ? Number(sourceDocumentId) : undefined,
        bodyHtml: libraryItem || sourceDocumentId ? undefined : bodyHtml,
        pdfUrl: libraryItem ? undefined : pdfUrl,
        assignTo,
        dueAt,
        requireSignature,
      }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error || "Could not create training item.");
      return;
    }
    if (data.sendWarning) {
      setNotice(`Assigned to ${data.assigned}. ${data.sent ? `${data.sent} signing request(s) sent. ` : ""}${data.sendWarning}`);
      onSaved();
      return; // keep the modal open so the warning is read; owner closes it
    }
    onSaved();
    onClose();
  }

  return (
    <Modal title="New training item" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kitchen safety SOP" />
          </Field>
          <Field label="Kind">
            <Picker value={docKind} onChange={(e) => setDocKind(e.target.value as DocKind)}>
              {DOC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DOC_KIND_LABELS[k]}
                </option>
              ))}
            </Picker>
          </Field>
        </div>

        {libraryItem ? (
          <div className="rounded-lg border border-violet/40 bg-violet/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-cream">
                {libraryItem.kind === "video" ? <PlayCircle className="h-4 w-4 text-violet" /> : <FileText className="h-4 w-4 text-violet" />}
                <span>
                  From Library: <strong>{libraryItem.title}</strong>
                </span>
                <Badge tone="sky">{libraryItem.provider}</Badge>
              </div>
              <button onClick={() => setLibraryItem(null)} className="text-xs text-white/60 hover:text-cream">
                Change
              </button>
            </div>
            <p className="mt-1 text-xs text-white/45">
              {libraryItem.kind === "video" ? "Employees watch the embedded video, then complete the signature/quiz step." : "The document content is shown to employees to review."}
            </p>
          </div>
        ) : (
          <>
            <Field label="Content source" hint="Pick from the built-in Library, author a document in the Documents creator, or paste content / link a PDF.">
              <Picker value={sourceDocumentId} onChange={(e) => setSourceDocumentId(e.target.value)}>
                <option value="">— Paste content or link a PDF below —</option>
                {docs.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    Use document: {d.title}
                  </option>
                ))}
              </Picker>
            </Field>

            {!sourceDocumentId && (
              <>
                <Field label="Content (HTML or plain text)">
                  <Area rows={5} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} placeholder="Paste the SOP / policy text, or leave blank and link a PDF…" />
                </Field>
                <Field label="…or PDF URL (upload fallback)">
                  <Input value={pdfUrl} onChange={(e) => setPdfUrl(e.target.value)} placeholder="https://…/handbook.pdf" />
                </Field>
              </>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Assign to">
            <Picker value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="all">Everyone</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  Role: {r}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label="Due date (optional)">
            <Input value={dueAt} onChange={(e) => setDueAt(e.target.value)} type="date" />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-cream">
          <input type="checkbox" checked={requireSignature} onChange={(e) => setRequireSignature(e.target.checked)} className="h-4 w-4 accent-violet" />
          Require e-signature (sends each assignee a signing request)
        </label>

        {err && <p className="text-sm text-red-300">{err}</p>}
        {notice && <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">{notice}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Btn variant="ghost" onClick={onClose}>
            {notice ? "Done" : "Cancel"}
          </Btn>
          {!notice && (
            <Btn onClick={submit} loading={saving}>
              <Send className="h-4 w-4" /> Create & assign
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ComplianceDrawer({
  docId,
  canManage,
  onClose,
  onChanged,
}: {
  docId: number;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [doc, setDoc] = useState<TrainingDoc | null>(null);
  const [grid, setGrid] = useState<AckCell[]>([]);
  const [libraryItem, setLibraryItem] = useState<TrainingLibraryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/employer/training/${docId}`).then((r) => r.json()).catch(() => ({}));
    setDoc(res.doc || null);
    setGrid(res.grid || []);
    setLibraryItem(res.libraryItem || null);
    setLoading(false);
  }, [docId]);
  useEffect(() => {
    load();
  }, [load]);

  async function remindAll() {
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/employer/training/${docId}/remind`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? `Reminders sent: ${data.sent}/${data.outstanding} outstanding.` : data.error || "Could not send reminders.");
  }

  async function remindOne(employeeId: number) {
    const res = await fetch(`/api/employer/training/${docId}/remind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? (data.sent ? "Reminder sent." : "Nothing to remind (already complete or no email).") : "Could not send reminder.");
  }

  async function setAck(ackId: number, status: "signed" | "waived" | "pending") {
    await fetch(`/api/employer/acknowledgments/${ackId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
    onChanged();
  }

  return (
    <Drawer title={doc?.title || "Training"} onClose={onClose}>
      {loading ? (
        <p className="text-sm text-white/50">Loading…</p>
      ) : !doc ? (
        <p className="text-sm text-white/50">Not found.</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet">{DOC_KIND_LABELS[doc.docKind]}</Badge>
            {doc.requireSignature && <Badge tone="sky">Signature required</Badge>}
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-violet hover:underline">
                <FileText className="h-3.5 w-3.5" /> PDF
              </a>
            )}
            {libraryItem && <Badge tone="gold">Library · {libraryItem.provider}</Badge>}
          </div>

          {libraryItem?.kind === "video" && libraryItem.embedUrl && (
            <div>
              <div className="aspect-video overflow-hidden rounded-xl border border-border-gold bg-black">
                <iframe
                  src={libraryItem.embedUrl}
                  title={libraryItem.title}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <a href={libraryItem.sourceUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-white/45 hover:text-cream">
                <ExternalLink className="h-3 w-3" /> Source: {libraryItem.provider} (official channel)
              </a>
            </div>
          )}

          {canManage && (
            <div className="flex items-center gap-2">
              <Btn variant="ghost" onClick={remindAll} loading={busy}>
                <Send className="h-4 w-4" /> Send reminders (pending & overdue)
              </Btn>
            </div>
          )}
          {msg && <p className="text-sm text-teal">{msg}</p>}

          <div className="overflow-hidden rounded-xl border border-border-gold">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-gold text-xs uppercase tracking-wide text-white/45">
                  <th className="px-3 py-2 font-semibold">Employee</th>
                  <th className="px-3 py-2 font-semibold">State</th>
                  {canManage && <th className="px-3 py-2 font-semibold">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {grid.map(({ employee, ack }) => {
                  const state = ack ? complianceState(ack) : "pending";
                  return (
                    <tr key={employee.id} className="border-b border-border-gold/50 last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium text-cream">{employee.name}</div>
                        <div className="text-xs text-white/45">
                          {employee.role || "—"}
                          {ack && typeof ack.score === "number" ? ` · quiz ${ack.score}% (${ack.attempts})` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={COMPLIANCE_TONE[state]}>{state}</Badge>
                      </td>
                      {canManage && (
                        <td className="px-3 py-2">
                          {ack && state !== "signed" && (
                            <div className="flex flex-wrap gap-1.5">
                              {(state === "pending" || state === "overdue") && employee.email && (
                                <button onClick={() => remindOne(employee.id)} className="rounded border border-border-gold px-2 py-1 text-xs text-cream hover:bg-white/10">
                                  Remind
                                </button>
                              )}
                              <button onClick={() => setAck(ack.id, "signed")} className="rounded border border-teal/40 px-2 py-1 text-xs text-teal hover:bg-teal/10">
                                Mark signed
                              </button>
                              {state !== "waived" && (
                                <button onClick={() => setAck(ack.id, "waived")} className="rounded border border-border-gold px-2 py-1 text-xs text-white/60 hover:bg-white/10">
                                  Waive
                                </button>
                              )}
                            </div>
                          )}
                          {ack && state === "signed" && <span className="text-xs text-white/40">—</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* ─────────────────────── Built-in Training Library ──────────────────────── */
function Library({ canManage, onUseInTraining }: { canManage: boolean; onUseInTraining: (item: TrainingLibraryItem) => void }) {
  const [items, setItems] = useState<TrainingLibraryItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category !== "all") params.set("category", category);
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/employer/training-library?${params}`).then((r) => r.json()).catch(() => ({}));
    setItems(res.items || []);
    if (res.categories) setCategories(res.categories);
    setLoading(false);
  }, [category, q]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0); // debounce the search box
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div>
      <p className="mb-4 text-sm text-white/55">
        Free, ready-to-assign workplace training from official US-government sources (OSHA, NIOSH, CDC, DOL, FEMA, CISA, FDA). Videos are embedded from each agency&rsquo;s official channel; every item links its source.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCategory("all")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${category === "all" ? "bg-violet text-white" : "border border-border-gold text-muted-cream hover:bg-white/5"}`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${category === c ? "bg-violet text-white" : "border border-border-gold text-muted-cream hover:bg-white/5"}`}
          >
            {c}
          </button>
        ))}
        <div className="ml-auto w-full sm:w-56">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search library…" />
        </div>
      </div>

      {loading ? (
        <Panel className="text-sm text-white/55">Loading…</Panel>
      ) : items.length === 0 ? (
        <EmptyState icon={BookOpen} title="Nothing here yet" body="No library items match — try another category or clear the search. (The library is seeded by migration 0030.)" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <Panel key={item.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                {item.kind === "video" ? <PlayCircle className="h-4 w-4 text-violet" /> : <FileText className="h-4 w-4 text-violet" />}
                <Badge tone="sky">{item.provider}</Badge>
                <span className="text-xs text-white/45">{item.category}</span>
              </div>
              <h3 className="font-medium text-cream">{item.title}</h3>

              {item.kind === "video" && item.embedUrl ? (
                <div className="aspect-video overflow-hidden rounded-lg border border-border-gold bg-black">
                  <iframe
                    src={item.embedUrl}
                    title={item.title}
                    className="h-full w-full"
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div
                  className="prose-training max-h-56 overflow-y-auto rounded-lg border border-border-gold bg-white/[0.03] p-3 text-sm text-white/75 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-cream [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2 [&_ul]:mb-2"
                  dangerouslySetInnerHTML={{ __html: item.bodyHtml || "" }}
                />
              )}

              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-white/45 hover:text-cream">
                  <ExternalLink className="h-3 w-3" /> Source
                </a>
                {canManage && (
                  <Btn onClick={() => onUseInTraining(item)}>
                    <Plus className="h-4 w-4" /> Use in training
                  </Btn>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
