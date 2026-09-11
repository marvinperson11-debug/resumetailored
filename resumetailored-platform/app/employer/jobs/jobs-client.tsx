"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Plus, Pencil, Pause, Play, XCircle, Copy, Users, Trash2, Sparkles, X } from "lucide-react";
import {
  REMOTE_TYPES,
  EMPLOYMENT_TYPES,
  type JobPosting,
  type JobStatus,
  type RemoteType,
  type EmploymentType,
} from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Field, Input, Area, Picker, Badge, EmptyState, Modal } from "../components/ui";

const STATUS_TONE: Record<JobStatus, "neutral" | "teal" | "gold" | "red"> = {
  draft: "neutral",
  active: "teal",
  paused: "gold",
  closed: "red",
};

export function JobsClient({ openNew }: { openNew: boolean }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<JobPosting | "new" | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employer/jobs", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { jobs?: JobPosting[] };
      setJobs(d.jobs || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (openNew) setEditing("new");
  }, [openNew]);

  async function patch(id: number, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      await fetch(`/api/employer/jobs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await load();
    } finally {
      setBusyId(null);
    }
  }
  async function remove(id: number) {
    if (!confirm("Delete this job and all its applicants? This cannot be undone.")) return;
    setBusyId(id);
    try {
      await fetch(`/api/employer/jobs/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle="Create, publish, and manage your open roles."
        action={
          <Btn onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Post new job
          </Btn>
        }
      />

      {loading ? (
        <Panel className="text-sm text-white/50">Loading jobs…</Panel>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs yet"
          body="Post your first role to start collecting and scoring applicants."
          action={
            <Btn onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Post new job
            </Btn>
          }
        />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border-gold text-left text-xs uppercase tracking-wide text-white/45">
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Applicants</th>
                <th className="px-4 py-3 font-semibold">Posted</th>
                <th className="px-4 py-3 font-semibold">Expires</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-border-gold/50 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-cream">{j.title}</div>
                    <div className="text-xs text-white/45">{[j.department, j.location].filter(Boolean).join(" · ") || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <a href={`/employer/candidates?jobId=${j.id}`} className="inline-flex items-center gap-1 text-cream hover:text-violet">
                      <Users className="h-3.5 w-3.5" /> {j.applicantCount ?? 0}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-white/60">{fmtDate(j.createdAt)}</td>
                  <td className="px-4 py-3 text-white/60">{j.deadline ? fmtDate(j.deadline) : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn title="Edit" onClick={() => setEditing(j)} disabled={busyId === j.id}>
                        <Pencil className="h-4 w-4" />
                      </IconBtn>
                      {j.status === "active" ? (
                        <IconBtn title="Pause" onClick={() => patch(j.id, { status: "paused" })} disabled={busyId === j.id}>
                          <Pause className="h-4 w-4" />
                        </IconBtn>
                      ) : (
                        <IconBtn title="Activate" onClick={() => patch(j.id, { status: "active" })} disabled={busyId === j.id}>
                          <Play className="h-4 w-4" />
                        </IconBtn>
                      )}
                      {j.status !== "closed" && (
                        <IconBtn title="Close" onClick={() => patch(j.id, { status: "closed" })} disabled={busyId === j.id}>
                          <XCircle className="h-4 w-4" />
                        </IconBtn>
                      )}
                      <IconBtn title="Duplicate" onClick={() => patch(j.id, { action: "duplicate" })} disabled={busyId === j.id}>
                        <Copy className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn title="View applicants" onClick={() => router.push(`/employer/candidates?jobId=${j.id}`)}>
                        <Users className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn title="Delete" onClick={() => remove(j.id)} disabled={busyId === j.id} danger>
                        <Trash2 className="h-4 w-4" />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {editing && (
        <JobEditor
          job={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
            if (openNew) router.replace("/employer/jobs");
          }}
          onSaved={async () => {
            setEditing(null);
            if (openNew) router.replace("/employer/jobs");
            await load();
          }}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled, danger }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md p-1.5 transition-colors disabled:opacity-40 ${danger ? "text-red-300 hover:bg-red-500/15" : "text-muted-cream hover:bg-white/8 hover:text-cream"}`}
    >
      {children}
    </button>
  );
}

// ── Job editor modal ──────────────────────────────────────────────────────────
function JobEditor({ job, onClose, onSaved }: { job: JobPosting | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(job?.title || "");
  const [department, setDepartment] = useState(job?.department || "");
  const [locCity, setLocCity] = useState(job?.location || "");
  const [remoteType, setRemoteType] = useState<RemoteType | "">(job?.remoteType || "");
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">(job?.employmentType || "");
  const [salaryMin, setSalaryMin] = useState(job?.salaryMin?.toString() || "");
  const [salaryMax, setSalaryMax] = useState(job?.salaryMax?.toString() || "");
  const [currency, setCurrency] = useState(job?.salaryCurrency || "USD");
  const [description, setDescription] = useState(job?.description || "");
  const [requirements, setRequirements] = useState<string[]>(job?.requirements?.length ? job.requirements : [""]);
  const [niceToHaves, setNiceToHaves] = useState<string[]>(job?.niceToHaves?.length ? job.niceToHaves : [""]);
  const [deadline, setDeadline] = useState(job?.deadline || "");
  const [saving, setSaving] = useState<null | JobStatus>(null);
  const [assisting, setAssisting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assist() {
    setAssisting(true);
    setError(null);
    try {
      const res = await fetch("/api/employer/jobs/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, notes: description, department, location: locCity, employmentType }),
      });
      const d = (await res.json().catch(() => ({}))) as { description?: string; error?: string };
      if (!res.ok || !d.description) throw new Error(d.error || "Could not improve the description.");
      setDescription(d.description);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setAssisting(false);
    }
  }

  async function save(status: JobStatus) {
    if (title.trim().length < 2) {
      setError("Give the role a title.");
      return;
    }
    if (description.trim().length < 10) {
      setError("Add a job description (or use Improve to draft one).");
      return;
    }
    setSaving(status);
    setError(null);
    const body = {
      title,
      department,
      location: locCity,
      remoteType,
      employmentType,
      salaryMin: salaryMin ? Number(salaryMin) : null,
      salaryMax: salaryMax ? Number(salaryMax) : null,
      salaryCurrency: currency,
      description,
      requirements: requirements.map((s) => s.trim()).filter(Boolean),
      niceToHaves: niceToHaves.map((s) => s.trim()).filter(Boolean),
      deadline: deadline || null,
      status,
    };
    try {
      const res = job
        ? await fetch(`/api/employer/jobs/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/employer/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || "Could not save the job.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSaving(null);
    }
  }

  return (
    <Modal title={job ? "Edit job" : "Post a job"} onClose={onClose} wide>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <Field label="Job title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Product Designer" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Department">
            <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Design" />
          </Field>
          <Field label="Location (city)">
            <Input value={locCity} onChange={(e) => setLocCity(e.target.value)} placeholder="San Francisco, CA" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Work model">
            <Picker value={remoteType} onChange={(e) => setRemoteType(e.target.value as RemoteType | "")}>
              <option value="">Select…</option>
              {REMOTE_TYPES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label="Employment type">
            <Picker value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType | "")}>
              <option value="">Select…</option>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Picker>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Salary min">
            <Input value={salaryMin} onChange={(e) => setSalaryMin(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="90000" />
          </Field>
          <Field label="Salary max">
            <Input value={salaryMax} onChange={(e) => setSalaryMax(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="130000" />
          </Field>
          <Field label="Currency">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="USD" />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-cream">Job description</span>
            <button
              type="button"
              onClick={assist}
              disabled={assisting}
              className="inline-flex items-center gap-1.5 rounded-md border border-violet/40 bg-violet/10 px-2.5 py-1 text-xs font-semibold text-violet transition-colors hover:bg-violet/20 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" /> {assisting ? "Improving…" : "Improve with AI"}
            </button>
          </div>
          <Area rows={7} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Rough notes are fine — hit “Improve with AI” to turn them into a polished, inclusive description." />
        </div>

        <BulletEditor label="Requirements" items={requirements} setItems={setRequirements} placeholder="5+ years in product design" />
        <BulletEditor label="Nice-to-haves" items={niceToHaves} setItems={setNiceToHaves} placeholder="Experience with design systems" />

        <Field label="Application deadline" hint="Optional">
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>

        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border-gold pt-4">
        <Btn variant="ghost" onClick={() => save("draft")} loading={saving === "draft"}>
          Save draft
        </Btn>
        <Btn onClick={() => save("active")} loading={saving === "active"}>
          {job ? "Save & publish" : "Publish now"}
        </Btn>
      </div>
    </Modal>
  );
}

function BulletEditor({ label, items, setItems, placeholder }: { label: string; items: string[]; setItems: (v: string[]) => void; placeholder: string }) {
  const set = (i: number, v: string) => setItems(items.map((x, idx) => (idx === i ? v : x)));
  const add = () => setItems([...items, ""]);
  const del = (i: number) => setItems(items.length > 1 ? items.filter((_, idx) => idx !== i) : [""]);
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream">{label}</span>
      <div className="space-y-2">
        {items.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={v} onChange={(e) => set(i, e.target.value)} placeholder={placeholder} />
            <button type="button" onClick={() => del(i)} aria-label="Remove" className="shrink-0 rounded-md p-2 text-muted-cream hover:bg-white/8 hover:text-cream">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet hover:text-violet/80">
        <Plus className="h-3.5 w-3.5" /> Add {label.toLowerCase().replace(/s$/, "")}
      </button>
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
